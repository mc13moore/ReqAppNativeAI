import type { FastifyReply, FastifyRequest } from 'fastify';
import { authEnabled } from '../config.js';

export interface AppUser {
  id: string;
  name: string;
  provider: string;
  roles: string[];
}

interface ClientPrincipalClaim {
  typ: string;
  val: string;
}

interface ClientPrincipal {
  auth_typ?: string;
  name_typ?: string;
  role_typ?: string;
  claims?: ClientPrincipalClaim[];
}

const LOCAL_USER: AppUser = {
  id: 'local-dev',
  name: 'Local developer',
  provider: 'none',
  roles: [],
};

/**
 * Reads the principal that Container Apps built-in authentication injects.
 *
 * These headers are only trustworthy because the platform strips any
 * client-supplied copy before the request reaches the container. That is true
 * for Container Apps EasyAuth; if this app is ever moved behind a different
 * proxy, this function must be replaced with real token validation.
 */
export function readUser(request: FastifyRequest): AppUser | null {
  if (!authEnabled) return LOCAL_USER;

  const encoded = request.headers['x-ms-client-principal'];
  if (typeof encoded !== 'string' || encoded.length === 0) {
    // Fall back to the simpler headers, which are present for some providers.
    const name = request.headers['x-ms-client-principal-name'];
    const id = request.headers['x-ms-client-principal-id'];
    if (typeof name === 'string' && typeof id === 'string') {
      return { id, name, provider: 'aad', roles: [] };
    }
    return null;
  }

  try {
    const principal = JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8'),
    ) as ClientPrincipal;

    const claims = principal.claims ?? [];
    const claim = (...types: string[]) =>
      claims.find((c) => types.includes(c.typ))?.val;

    const roleType = principal.role_typ ?? 'roles';

    return {
      id:
        claim(
          'http://schemas.microsoft.com/identity/claims/objectidentifier',
          'oid',
          'sub',
        ) ?? 'unknown',
      name:
        claim(
          principal.name_typ ?? 'name',
          'name',
          'preferred_username',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
        ) ?? 'unknown',
      provider: principal.auth_typ ?? 'aad',
      roles: claims.filter((c) => c.typ === roleType).map((c) => c.val),
    };
  } catch {
    return null;
  }
}

/** Fastify preHandler that rejects unauthenticated requests. */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = readUser(request);
  if (!user) {
    await reply.code(401).send({
      error: 'unauthenticated',
      message: 'Sign in required.',
    });
    return;
  }
  request.user = user;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AppUser;
  }
}
