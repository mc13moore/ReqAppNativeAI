import { config } from '../config.js';
import { D365Error, list, odataString } from './client.js';

export interface PreparerResolution {
  personnelNumber: string | null;
  /** Where the value came from, for the diagnostics endpoint. */
  source: 'lookup' | 'default' | 'unresolved';
  /** Present when the lookup was attempted and failed, rather than missing. */
  error?: string;
}

/**
 * Successful lookups are cached for the process lifetime.
 *
 * The mapping from a person to their personnel number effectively never
 * changes, and a requisition create would otherwise pay for an extra round
 * trip to D365 every time.
 */
const cache = new Map<string, string>();

/**
 * Translates a signed-in user's email address into a D365 personnel number.
 *
 * Returns rather than throws on failure: a preparer that cannot be resolved
 * should surface as a clear validation message on the create, not as an opaque
 * error from an unrelated-looking lookup.
 */
export async function resolvePreparer(email?: string): Promise<PreparerResolution> {
  const normalised = email?.trim().toLowerCase();

  if (normalised) {
    const cached = cache.get(normalised);
    if (cached) return { personnelNumber: cached, source: 'lookup' };
  }

  if (normalised && config.D365_PREPARER_ENTITY) {
    try {
      const result = await list<Record<string, unknown>>(config.D365_PREPARER_ENTITY, {
        select: [config.D365_PREPARER_NUMBER_FIELD],
        filter: `${config.D365_PREPARER_EMAIL_FIELD} eq ${odataString(normalised)}`,
        top: 1,
      });

      const value = result.value[0]?.[config.D365_PREPARER_NUMBER_FIELD];
      if (typeof value === 'string' && value.trim()) {
        cache.set(normalised, value);
        return { personnelNumber: value, source: 'lookup' };
      }
    } catch (err) {
      const message = err instanceof D365Error ? `HTTP ${err.status}: ${err.message}` : String(err);
      if (config.D365_DEFAULT_PREPARER) {
        return {
          personnelNumber: config.D365_DEFAULT_PREPARER,
          source: 'default',
          error: message,
        };
      }
      return { personnelNumber: null, source: 'unresolved', error: message };
    }
  }

  if (config.D365_DEFAULT_PREPARER) {
    return { personnelNumber: config.D365_DEFAULT_PREPARER, source: 'default' };
  }

  return { personnelNumber: null, source: 'unresolved' };
}

/** Non-secret description of how preparer resolution is configured. */
export function describePreparerLookup(): Record<string, string> {
  return {
    entity: config.D365_PREPARER_ENTITY || '(disabled)',
    emailField: config.D365_PREPARER_EMAIL_FIELD,
    numberField: config.D365_PREPARER_NUMBER_FIELD,
    fallback: config.D365_DEFAULT_PREPARER || '(none)',
  };
}
