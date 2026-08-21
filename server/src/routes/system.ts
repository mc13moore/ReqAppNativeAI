import type { FastifyInstance } from 'fastify';
import { authEnabled, config } from '../config.js';
import { readUser, requireUser } from '../auth/user.js';
import { describeD365Credential, getD365Token } from '../auth/d365Token.js';
import { D365Error, list } from '../d365/client.js';
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

    const credentialInfo = describeD365Credential();

    try {
      await getD365Token();
    } catch (err) {
      return reply.code(503).send({
        status: 'failed',
        stage: 'token',
        credential: credentialInfo,
        message:
          credentialInfo.mode.startsWith('service principal')
            ? 'Could not acquire an Entra ID token using the configured service principal. Check D365_TENANT_ID, D365_CLIENT_ID and D365_CLIENT_SECRET, and that the secret has not expired.'
            : 'Could not acquire an Entra ID token for the D365 environment. Check the managed identity assignment and D365_BASE_URL.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const credential = credentialInfo;

    try {
      // No $select and no cross-company: this check exists to prove the
      // identity can read the entity, and naming any specific property would
      // make it fail with a 400 whenever the configured schema is wrong --
      // reporting a connectivity problem that does not exist.
      await list(headerEntity.entitySet, { top: 1 });
    } catch (err) {
      const status = err instanceof D365Error ? err.status : undefined;

      // 401 and 404 fail in the same place but mean opposite things, and
      // conflating them sends people to rewrite entity names when the real
      // problem is that D365 never accepted the caller.
      const message =
        status === 401
          ? [
              'D365 accepted the connection but rejected the identity (401).',
              `The token was issued for client ${credential.clientId ?? 'unknown'} using ${credential.mode}.`,
              'Either that client ID is not listed under System administration > Setup >',
              'Microsoft Entra ID applications, or it was issued by a different Entra tenant',
              'than the one D365 trusts. A managed identity cannot be used across tenants.',
            ].join(' ')
          : status === 404
            ? `The entity set "${headerEntity.entitySet}" does not exist in this environment (404). Use the entity explorer below to find the correct name, then update server/src/d365/entities.ts.`
            : `Token acquired, but querying ${headerEntity.entitySet} failed${
                status ? ` with HTTP ${status}` : ''
              }. ${
                status === 403
                  ? `The identity is recognised but not permitted to read this entity. Check the D365 user mapped to client ${credential.clientId ?? 'unknown'} has the required security roles.`
                  : status === 400
                    ? 'D365 rejected the query itself, which usually means a selected field does not exist on this entity.'
                    : 'See the upstream detail below.'
              }`;

      return reply.code(503).send({
        status: 'failed',
        stage: 'query',
        upstreamStatus: status,
        credential,
        message,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      status: 'ok',
      environment: config.D365_BASE_URL,
      credential,
      elapsedMs: Date.now() - started,
    };
  });
}
