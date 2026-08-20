import {
  ClientSecretCredential,
  DefaultAzureCredential,
  type AccessToken,
  type TokenCredential,
} from '@azure/identity';
import { config, d365AuthMode } from '../config.js';

/**
 * Acquires application tokens for the D365 F&O environment.
 *
 * Two topologies are supported, and which one applies is decided entirely by
 * whether the D365 environment shares an Entra tenant with the Azure
 * subscription hosting this app.
 *
 * Same tenant -- DefaultAzureCredential resolves to the container's
 * user-assigned managed identity in Azure, or to `az login` locally. No secret
 * exists anywhere. Preferred whenever it is possible.
 *
 * Different tenants -- a managed identity is a service principal belonging to
 * one tenant and cannot be presented to another. Entra will still issue a
 * token, but D365 rejects it with a bare 401 because the issuer is not the
 * tenant it trusts. The only way through is an app registration created inside
 * the D365 tenant, which necessarily means a client secret.
 *
 * Either way, the identity must also be listed in D365 under
 *   System administration > Setup > Microsoft Entra ID applications
 * and mapped to a user, or every request returns 401.
 */
function createCredential(): TokenCredential {
  if (d365AuthMode === 'service-principal') {
    // Constructed explicitly rather than leaving DefaultAzureCredential to pick
    // EnvironmentCredential off its chain: relying on chain ordering makes the
    // active identity implicit, and a silent fall-through to the wrong one is
    // very hard to diagnose from a 401.
    return new ClientSecretCredential(
      config.D365_TENANT_ID!,
      config.D365_CLIENT_ID!,
      config.D365_CLIENT_SECRET!,
    );
  }

  return new DefaultAzureCredential(
    config.AZURE_MANAGED_IDENTITY_CLIENT_ID
      ? { managedIdentityClientId: config.AZURE_MANAGED_IDENTITY_CLIENT_ID }
      : {},
  );
}

const credential = createCredential();

const scope = `${config.D365_BASE_URL}/.default`;

/** Refresh this many milliseconds before actual expiry to avoid edge-of-life 401s. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let cached: AccessToken | null = null;
let inFlight: Promise<AccessToken> | null = null;

function isFresh(token: AccessToken | null): token is AccessToken {
  return token !== null && token.expiresOnTimestamp - REFRESH_BUFFER_MS > Date.now();
}

export async function getD365Token(): Promise<string> {
  if (isFresh(cached)) return cached.token;

  // Collapse concurrent refreshes so a burst of requests triggers one token call.
  inFlight ??= credential
    .getToken(scope)
    .then((token) => {
      if (!token) throw new Error('Entra ID returned no token for scope ' + scope);
      cached = token;
      return token;
    })
    .finally(() => {
      inFlight = null;
    });

  const token = await inFlight;
  return token.token;
}

/** Drops the cached token so the next call re-authenticates. Used after a 401. */
export function invalidateD365Token(): void {
  cached = null;
}

/** Non-secret description of the active credential, for the diagnostics page. */
export function describeD365Credential(): {
  mode: string;
  tenantId?: string;
  clientId?: string;
} {
  return d365AuthMode === 'service-principal'
    ? {
        mode: 'service principal (cross-tenant)',
        tenantId: config.D365_TENANT_ID,
        clientId: config.D365_CLIENT_ID,
      }
    : {
        mode: config.AZURE_MANAGED_IDENTITY_CLIENT_ID
          ? 'managed identity (same tenant)'
          : 'developer sign-in (az login)',
        clientId: config.AZURE_MANAGED_IDENTITY_CLIENT_ID,
      };
}
