import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { config } from './config.js';
import { D365Error } from './d365/client.js';
import { ValidationError } from './d365/requisitions.js';
import assistantRoutes from './routes/assistant.js';
import metadataRoutes from './routes/metadata.js';
import requisitionRoutes from './routes/requisitions.js';
import systemRoutes from './routes/system.js';
import workspaceRoutes from './routes/workspace.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, config.WEB_DIST);

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    // Container Apps collects stdout into Log Analytics, so structured JSON
    // in production and human-readable output is unnecessary there.
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  },
  // Container Apps terminates TLS at the ingress and forwards the original
  // client details in X-Forwarded-* headers.
  trustProxy: true,
  bodyLimit: 1_000_000,
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ValidationError) {
    return reply.code(400).send({
      error: 'validation_failed',
      message: 'The submitted values are not valid.',
      errors: error.errors,
    });
  }

  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: 'bad_request',
      message: 'The request was malformed.',
      errors: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    });
  }

  if (error instanceof D365Error) {
    request.log.warn({ code: error.code, status: error.status }, 'D365 request failed');
    // Surface the upstream status where it is meaningful to the caller, but
    // never let a raw 401 from D365 read as "you are signed out of this app".
    const status = error.status === 401 || error.status === 403 ? 502 : error.status;
    return reply.code(status).send({
      error: error.code,
      message: error.message,
      source: 'd365',
      // D365's innererror names the exact entity set or property it rejected,
      // which is the difference between "something failed" and a fix.
      detail: error.detail ? JSON.stringify(error.detail) : undefined,
    });
  }

  request.log.error({ err: error }, 'unhandled error');
  return reply.code(500).send({
    error: 'internal_error',
    message: 'Something went wrong.',
  });
});

await app.register(systemRoutes, { prefix: '/api' });
await app.register(requisitionRoutes, { prefix: '/api' });
await app.register(metadataRoutes, { prefix: '/api' });
await app.register(workspaceRoutes, { prefix: '/api' });
await app.register(assistantRoutes, { prefix: '/api' });

if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });

  // Single-page app fallback: any non-API GET that did not match a file is
  // handed to the client router. Unmatched API routes stay a clean 404 JSON.
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' });
  });
} else {
  app.log.warn({ webDist }, 'frontend build not found; serving API only');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    { environment: config.D365_BASE_URL, company: config.D365_DEFAULT_COMPANY, authMode: config.AUTH_MODE },
    'server ready',
  );
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
