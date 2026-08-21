import { z } from 'zod';

/**
 * All runtime configuration arrives as environment variables so the same image
 * can run locally, in a sandbox environment, and in production without a rebuild.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Root URL of the D365 Finance & Operations environment, with no trailing
   * slash and no /data suffix -- for example
   * https://contoso-dev.sandbox.operations.dynamics.com
   *
   * This doubles as the Entra ID resource for token acquisition: the scope
   * requested is `${D365_BASE_URL}/.default`.
   */
  D365_BASE_URL: z
    .string()
    .url('D365_BASE_URL must be a full https URL')
    .transform((v) => v.replace(/\/+$/, '')),

  /** Legal entity (dataAreaId) used when a request does not specify one. */
  D365_DEFAULT_COMPANY: z.string().min(1).default('usmf'),

  /**
   * Entity set names. Overridable because the exact public collection names
   * differ across F&O versions and ISV extensions. Use /api/metadata/entities
   * against your own instance to confirm before changing these.
   */
  D365_HEADER_ENTITY: z.string().min(1).default('PurchaseRequisitionHeaders'),
  D365_LINE_ENTITY: z.string().min(1).default('PurchaseRequisitionLines'),

  /** Seconds to cache the parsed $metadata document. It rarely changes. */
  D365_METADATA_TTL_SECONDS: z.coerce.number().int().nonnegative().default(3600),

  /**
   * How the preparer on a new requisition is resolved from the signed-in user.
   *
   * D365 identifies a preparer by personnel number, not by email, so the
   * signed-in user's address has to be translated. The entity and field names
   * are configurable because the right source differs between environments --
   * SystemUsers is the usual one, but Workers or a custom entity may be
   * correct instead. Check with /api/me/preparer before relying on it.
   */
  D365_PREPARER_ENTITY: z.string().default('SystemUsers'),
  D365_PREPARER_EMAIL_FIELD: z.string().default('Email'),
  D365_PREPARER_NUMBER_FIELD: z.string().default('PersonnelNumber'),

  /**
   * Personnel number used when the lookup finds nothing, or when it is turned
   * off by clearing D365_PREPARER_ENTITY. Without either, creating a
   * requisition fails rather than inventing a preparer.
   */
  D365_DEFAULT_PREPARER: z.string().default(''),

  /** Per-request timeout against D365, in milliseconds. */
  D365_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * Client ID of the user-assigned managed identity. Only usable when the
   * Azure subscription and the D365 environment share an Entra tenant.
   */
  AZURE_MANAGED_IDENTITY_CLIENT_ID: z.string().optional(),

  /**
   * Explicit service-principal credentials for D365, used when the D365
   * environment lives in a different Entra tenant than the Azure subscription
   * hosting this app.
   *
   * A managed identity exists in exactly one tenant and cannot be used across
   * tenants: the token would be issued by the wrong issuer and D365 rejects it
   * with a 401. An app registration created inside the D365 tenant, and listed
   * under System administration > Setup > Microsoft Entra ID applications, is
   * the only workable option in that topology.
   *
   * Supply all three or none.
   */
  D365_TENANT_ID: z.string().optional(),
  D365_CLIENT_ID: z.string().optional(),
  D365_CLIENT_SECRET: z.string().optional(),

  /**
   * 'easyauth' trusts the X-MS-CLIENT-PRINCIPAL headers injected by Container
   * Apps built-in authentication. 'none' disables user auth and is intended
   * only for local development.
   */
  AUTH_MODE: z.enum(['easyauth', 'none']).default('easyauth'),

  /**
   * Optional allowlist of sign-in names, comma separated and case-insensitive.
   * Empty means any user the identity provider lets through is accepted.
   *
   * This is a second gate behind Entra ID, not a replacement for it: sign-in is
   * still required, and this only narrows who may proceed afterwards. Useful
   * when the tenant allows everyone to sign in but only a few people should be
   * able to write requisitions.
   */
  ALLOWED_USERS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Directory holding the built frontend, resolved relative to the compiled
   * entrypoint. Two levels up lands on the repo root from server/dist and on
   * the repo root from server/src, so one default covers dev and the image.
   */
  WEB_DIST: z.string().default('../../web/dist'),

});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  const { D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET } = parsed.data;
  const supplied = [D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET].filter(Boolean).length;

  // Partial credentials are always a mistake, and failing here is far kinder
  // than a 401 from D365 an hour later.
  if (supplied > 0 && supplied < 3) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  D365_TENANT_ID, D365_CLIENT_ID and D365_CLIENT_SECRET must be set together.\n' +
        `  Currently set: ${[
          D365_TENANT_ID && 'D365_TENANT_ID',
          D365_CLIENT_ID && 'D365_CLIENT_ID',
          D365_CLIENT_SECRET && 'D365_CLIENT_SECRET',
        ]
          .filter(Boolean)
          .join(', ')}`,
    );
  }

  return parsed.data;
}

export const config = load();

/** True when user auth is enforced. */
export const authEnabled = config.AUTH_MODE === 'easyauth';

/**
 * Which credential the app uses to reach D365.
 *
 * 'service-principal' is required when D365 sits in a different Entra tenant
 * than this app; 'default' covers managed identity in Azure and `az login`
 * locally, both of which only work same-tenant.
 */
export const d365AuthMode: 'service-principal' | 'default' =
  config.D365_CLIENT_ID && config.D365_CLIENT_SECRET && config.D365_TENANT_ID
    ? 'service-principal'
    : 'default';
