import { config } from '../config.js';
import { list } from './client.js';
import { lineEntity } from './entities.js';
import { listAllLines } from './requisitions.js';

export interface LookupOption {
  value: string;
  label: string;
}

export interface LookupResult {
  kind: string;
  options: LookupOption[];
  /**
   * 'entity'   - read from a dedicated D365 reference entity
   * 'observed' - distinct values found on existing requisition lines
   * 'none'     - neither worked; the form falls back to free text
   */
  source: 'entity' | 'observed' | 'none';
  /** Entity actually queried, for the diagnostics screen. */
  entity?: string;
  /** Why the dedicated entity was not usable. */
  error?: string;
}

interface LookupDefinition {
  kind: string;
  entity: string;
  valueField: string;
  labelField: string;
  /** Field on the requisition line that holds the same value. */
  observedFrom?: string;
}

function definitions(): LookupDefinition[] {
  return [
    {
      kind: 'categories',
      entity: config.D365_CATEGORY_ENTITY,
      valueField: config.D365_CATEGORY_FIELD,
      labelField: config.D365_CATEGORY_FIELD,
      observedFrom: 'ProcurementProductCategoryName',
    },
    {
      kind: 'employees',
      entity: config.D365_EMPLOYEE_ENTITY,
      valueField: config.D365_EMPLOYEE_NUMBER_FIELD,
      labelField: config.D365_EMPLOYEE_NAME_FIELD,
      observedFrom: 'RequisitionerPersonnelNumber',
    },
    {
      kind: 'vendors',
      entity: config.D365_VENDOR_ENTITY,
      valueField: config.D365_VENDOR_NUMBER_FIELD,
      labelField: config.D365_VENDOR_NAME_FIELD,
      observedFrom: 'VendorAccountNumber',
    },
    {
      kind: 'units',
      entity: config.D365_UNIT_ENTITY,
      valueField: config.D365_UNIT_FIELD,
      labelField: config.D365_UNIT_FIELD,
      observedFrom: 'PurchaseUnitSymbol',
    },
  ];
}

/**
 * Reference data is cached for the process lifetime.
 *
 * Vendors, categories and units change on a scale of weeks; re-reading them on
 * every form load would add a round trip to D365 for no benefit.
 */
const cache = new Map<string, { result: LookupResult; at: number }>();
const TTL_MS = 10 * 60 * 1000;

/** Distinct values of one field across existing requisition lines. */
async function observedValues(field: string): Promise<string[]> {
  const lines = await listAllLines(2000);
  const values = new Set<string>();

  for (const record of lines.value) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) values.add(value.trim());
  }

  return [...values].sort();
}

/**
 * Loads a dropdown's options.
 *
 * Tries the dedicated reference entity first, because that gives the full
 * catalogue with display names. Falls back to the distinct values already
 * present on requisition lines: a smaller list, but every entry is guaranteed
 * valid in this environment, which matters more on a form that writes back.
 */
export async function loadLookup(kind: string, refresh = false): Promise<LookupResult> {
  const definition = definitions().find((d) => d.kind === kind);
  if (!definition) {
    return { kind, options: [], source: 'none', error: `Unknown lookup "${kind}".` };
  }

  const cached = cache.get(kind);
  if (cached && !refresh && Date.now() - cached.at < TTL_MS) return cached.result;

  let result: LookupResult;

  try {
    if (!definition.entity) throw new Error('No reference entity configured.');

    const select =
      definition.valueField === definition.labelField
        ? [definition.valueField]
        : [definition.valueField, definition.labelField];

    const response = await list<Record<string, unknown>>(definition.entity, {
      select,
      orderby: definition.labelField,
      top: 500,
    });

    const options = response.value
      .map((record) => {
        const value = record[definition.valueField];
        const label = record[definition.labelField];
        return {
          value: typeof value === 'string' ? value.trim() : String(value ?? '').trim(),
          label:
            typeof label === 'string' && label.trim()
              ? label.trim()
              : String(value ?? '').trim(),
        };
      })
      .filter((option) => option.value);

    if (options.length === 0) throw new Error('Reference entity returned no rows.');

    result = { kind, options, source: 'entity', entity: definition.entity };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (definition.observedFrom) {
      try {
        const values = await observedValues(definition.observedFrom);
        result = {
          kind,
          options: values.map((value) => ({ value, label: value })),
          source: values.length > 0 ? 'observed' : 'none',
          entity: lineEntity.entitySet,
          error: message,
        };
      } catch {
        result = { kind, options: [], source: 'none', error: message };
      }
    } else {
      result = { kind, options: [], source: 'none', error: message };
    }
  }

  cache.set(kind, { result, at: Date.now() });
  return result;
}

export async function loadAllLookups(refresh = false): Promise<Record<string, LookupResult>> {
  const kinds = definitions().map((d) => d.kind);
  const results = await Promise.all(kinds.map((kind) => loadLookup(kind, refresh)));
  return Object.fromEntries(results.map((result) => [result.kind, result]));
}
