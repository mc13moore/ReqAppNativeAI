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

  /** Per-request timeout against D365, in milliseconds. */
  D365_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * Client ID of the user-assigned managed identity. Set in Azure; leave unset
   * locally so DefaultAzureCredential falls back to the Azure CLI login or to
   * AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID.
   */
  AZURE_MANAGED_IDENTITY_CLIENT_ID: z.string().optional(),

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
  return parsed.data;
}

export const config = load();

/** True when user auth is enforced. */
export const authEnabled = config.AUTH_MODE === 'easyauth';
