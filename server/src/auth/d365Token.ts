import { DefaultAzureCredential, type AccessToken } from '@azure/identity';
import { config } from '../config.js';

/**
 * Acquires application tokens for the D365 F&O environment.
 *
 * In Azure this resolves to the Container App's user-assigned managed identity,
 * which must be registered inside D365 under
 *   System administration > Setup > Microsoft Entra ID applications
 * against a service account user. Locally, DefaultAzureCredential falls back to
 * `az login` or to an app registration supplied via AZURE_* variables, so no
 * code path differs between environments.
 */
const credential = new DefaultAzureCredential(
  config.AZURE_MANAGED_IDENTITY_CLIENT_ID
    ? { managedIdentityClientId: config.AZURE_MANAGED_IDENTITY_CLIENT_ID }
    : {},
);

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
