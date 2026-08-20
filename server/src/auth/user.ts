import type { FastifyReply, FastifyRequest } from 'fastify';
import { authEnabled, config } from '../config.js';

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

/**
 * Checks a signed-in user against ALLOWED_USERS.
 *
 * An empty allowlist permits everyone the identity provider admitted, which is
 * the right default: the gate is then Entra ID itself, and duplicating that
 * list here would only create a second place to forget to update.
 */
export function isAllowed(user: AppUser): boolean {
  if (config.ALLOWED_USERS.length === 0) return true;
  return config.ALLOWED_USERS.includes(user.name.trim().toLowerCase());
}

/** Fastify preHandler that rejects unauthenticated and unauthorised requests. */
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

  if (!isAllowed(user)) {
    // Logged so an unexpected denial can be traced to the exact name that was
    // compared, which is usually a UPN-versus-email mismatch.
    request.log.warn({ user: user.name }, 'user is not on the allowlist');
    await reply.code(403).send({
      error: 'forbidden',
      message: `${user.name} is not authorised to use this application. Ask an administrator to add you.`,
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
