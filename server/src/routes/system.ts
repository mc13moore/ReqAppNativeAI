import type { FastifyInstance } from 'fastify';
import { authEnabled, config } from '../config.js';
import { readUser, requireUser } from '../auth/user.js';
import { getD365Token } from '../auth/d365Token.js';
import { list } from '../d365/client.js';
import { headerEntity, lineEntity } from '../d365/entities.js';

export default async function systemRoutes(app: FastifyInstance) {
  /**
   * Liveness probe. Deliberately does not touch D365 or Entra ID: Container
   * Apps polls this on every cold start, and a probe that depends on an
   * upstream would turn a D365 outage into a restart loop.
   */
  app.get('/health', async () => ({ status: 'ok' }));

  /** Identity of the signed-in user, as seen through built-in authentication. */
  app.get('/me', { preHandler: requireUser }, async (request) => ({
    user: request.user,
    authMode: config.AUTH_MODE,
  }));

  /** Non-secret configuration the frontend needs to render itself. */
  app.get('/config', async (request) => ({
    defaultCompany: config.D365_DEFAULT_COMPANY,
    headerEntitySet: headerEntity.entitySet,
    lineEntitySet: lineEntity.entitySet,
    authEnabled,
    signedIn: readUser(request) !== null,
  }));

  /**
   * Readiness check that exercises the full path: acquire a token as the
   * managed identity, then read a single row. This is the fastest way to tell
   * a token problem apart from a D365 permission problem.
   */
  app.get('/health/d365', { preHandler: requireUser }, async (_request, reply) => {
    const started = Date.now();

    try {
      await getD365Token();
    } catch (err) {
      return reply.code(503).send({
        status: 'failed',
        stage: 'token',
        message:
          'Could not acquire an Entra ID token for the D365 environment. Check the managed identity assignment and D365_BASE_URL.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await list(headerEntity.entitySet, { top: 1, select: ['dataAreaId'], crossCompany: true });
    } catch (err) {
      return reply.code(503).send({
        status: 'failed',
        stage: 'query',
        message: `Token acquired, but querying ${headerEntity.entitySet} failed. Confirm the identity is registered under System administration > Setup > Microsoft Entra ID applications, and that the entity name is correct.`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      status: 'ok',
      environment: config.D365_BASE_URL,
      elapsedMs: Date.now() - started,
    };
  });
}
