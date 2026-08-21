import { config } from '../config.js';
import { list } from './client.js';
import { lineEntity } from './entities.js';
import { describeEntitySet, findEntitySets } from './metadata.js';
import { listAllLines } from './requisitions.js';

export interface LookupOption {
  value: string;
  label: string;
}

export interface LookupResult {
  kind: string;
  options: LookupOption[];
  /**
   * 'entity'     - read from a D365 reference entity
   * 'discovered' - reference entity found by searching $metadata
   * 'observed'   - distinct values already on requisition lines
   * 'none'       - nothing worked; the form falls back to free text
   */
  source: 'entity' | 'discovered' | 'observed' | 'none';
  entity?: string;
  valueField?: string;
  labelField?: string;
  error?: string;
  truncated?: boolean;
}

interface Candidate {
  entity: string;
  valueField: string;
  labelField?: string;
}

interface LookupDefinition {
  kind: string;
  /** Tried in order. The first that exists in $metadata with its value field wins. */
  candidates: Candidate[];
  /** Entity-set names matching this are searched when no candidate resolves. */
  discoverPattern?: string;
  /** Field names accepted as the value when auto-discovering. */
  discoverValueFields?: string[];
  discoverLabelFields?: string[];
  /** Field on the requisition line holding the same value, for the last resort. */
  observedFrom?: string;
}

/**
 * Candidate reference entities, most specific first.
 *
 * F&O public entity names vary by version, and guessing a single name has
 * already cost this project several rounds of 400s and 404s. Each lookup
 * therefore carries several plausible names, every one is checked against the
 * live $metadata document before being queried, and anything explicitly
 * configured takes priority over the built-in guesses.
 */
function definitions(): LookupDefinition[] {
  return [
    {
      kind: 'vendors',
      candidates: [
        ...(config.D365_VENDOR_ENTITY
          ? [
              {
                entity: config.D365_VENDOR_ENTITY,
                valueField: config.D365_VENDOR_NUMBER_FIELD,
                labelField: config.D365_VENDOR_NAME_FIELD,
              },
            ]
          : []),
        { entity: 'VendorsV2', valueField: 'VendorAccountNumber', labelField: 'VendorOrganizationName' },
        { entity: 'Vendors', valueField: 'VendorAccountNumber', labelField: 'VendorName' },
        { entity: 'VendorsV3', valueField: 'VendorAccountNumber', labelField: 'VendorOrganizationName' },
      ],
      discoverPattern: 'vendor',
      discoverValueFields: ['VendorAccountNumber', 'AccountNum', 'VendorAccount'],
      discoverLabelFields: ['VendorOrganizationName', 'VendorName', 'Name', 'OrganizationName'],
      observedFrom: 'VendorAccountNumber',
    },
    {
      kind: 'employees',
      candidates: [
        ...(config.D365_EMPLOYEE_ENTITY
          ? [
              {
                entity: config.D365_EMPLOYEE_ENTITY,
                valueField: config.D365_EMPLOYEE_NUMBER_FIELD,
                labelField: config.D365_EMPLOYEE_NAME_FIELD,
              },
            ]
          : []),
        { entity: 'Employees', valueField: 'PersonnelNumber', labelField: 'Name' },
        { entity: 'Workers', valueField: 'PersonnelNumber', labelField: 'Name' },
        { entity: 'EmployeesV2', valueField: 'PersonnelNumber', labelField: 'Name' },
      ],
      discoverPattern: 'employee',
      discoverValueFields: ['PersonnelNumber', 'WorkerPersonnelNumber'],
      discoverLabelFields: ['Name', 'FullName', 'PersonName'],
      observedFrom: 'RequisitionerPersonnelNumber',
    },
    {
      kind: 'categories',
      candidates: [
        ...(config.D365_CATEGORY_ENTITY
          ? [{ entity: config.D365_CATEGORY_ENTITY, valueField: config.D365_CATEGORY_FIELD }]
          : []),
        { entity: 'ProcurementCategories', valueField: 'Name' },
        { entity: 'ProcurementCategoryHierarchies', valueField: 'CategoryName' },
        { entity: 'ProductCategories', valueField: 'CategoryName' },
      ],
      discoverPattern: 'categor',
      discoverValueFields: ['Name', 'CategoryName', 'ProcurementCategoryName'],
      observedFrom: 'ProcurementProductCategoryName',
    },
    {
      kind: 'units',
      candidates: [
        ...(config.D365_UNIT_ENTITY
          ? [{ entity: config.D365_UNIT_ENTITY, valueField: config.D365_UNIT_FIELD }]
          : []),
        { entity: 'UnitOfMeasures', valueField: 'UnitOfMeasureSymbol' },
        { entity: 'UnitOfMeasures', valueField: 'Symbol' },
        { entity: 'UnitsOfMeasure', valueField: 'UnitSymbol' },
      ],
      discoverPattern: 'unitofmeasure',
      discoverValueFields: ['UnitOfMeasureSymbol', 'Symbol', 'UnitSymbol'],
      observedFrom: 'PurchaseUnitSymbol',
    },
  ];
}

const cache = new Map<string, { result: LookupResult; at: number }>();
const TTL_MS = 15 * 60 * 1000;

/** Maximum options fetched. Long enough for a real vendor master. */
const MAX_OPTIONS = 1000;

async function queryOptions(
  entity: string,
  valueField: string,
  labelField: string | undefined,
): Promise<LookupOption[]> {
  const select = labelField && labelField !== valueField ? [valueField, labelField] : [valueField];

  const response = await list<Record<string, unknown>>(entity, {
    select,
    orderby: valueField,
    top: MAX_OPTIONS,
  });

  const seen = new Set<string>();
  const options: LookupOption[] = [];

  for (const record of response.value) {
    const rawValue = record[valueField];
    const value = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);

    const rawLabel = labelField ? record[labelField] : undefined;
    const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : value;

    options.push({ value, label });
  }

  return options;
}

/** Finds the first candidate that actually exists, according to $metadata. */
async function resolveCandidate(
  candidates: Candidate[],
): Promise<{ candidate: Candidate; note?: string } | null> {
  for (const candidate of candidates) {
    try {
      const described = await describeEntitySet(candidate.entity);
      if (!described) continue;

      const names = new Set(described.properties.map((p) => p.name));
      if (!names.has(candidate.valueField)) continue;

      return {
        candidate: {
          entity: described.entitySet,
          valueField: candidate.valueField,
          // Drop a label field the entity does not actually have rather than
          // letting $select fail the whole query with a 400.
          labelField:
            candidate.labelField && names.has(candidate.labelField)
              ? candidate.labelField
              : undefined,
        },
      };
    } catch {
      // Metadata unavailable: fall through and let the caller try the next
      // strategy rather than failing the lookup outright.
      continue;
    }
  }
  return null;
}

/** Searches $metadata for any entity set carrying one of the expected fields. */
async function discover(definition: LookupDefinition): Promise<Candidate | null> {
  if (!definition.discoverPattern || !definition.discoverValueFields) return null;

  try {
    const matches = await findEntitySets(definition.discoverPattern);

    for (const match of matches.slice(0, 25)) {
      const described = await describeEntitySet(match.name);
      if (!described) continue;

      const names = new Set(described.properties.map((p) => p.name));
      const valueField = definition.discoverValueFields.find((f) => names.has(f));
      if (!valueField) continue;

      const labelField = definition.discoverLabelFields?.find((f) => names.has(f));
      return { entity: described.entitySet, valueField, labelField };
    }
  } catch {
    return null;
  }

  return null;
}

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
 * Four strategies in descending order of quality: a configured or known
 * entity, an entity discovered from $metadata, values already present on
 * requisition lines, and finally nothing -- at which point the form offers a
 * free-text input rather than an empty select.
 */
export async function loadLookup(kind: string, refresh = false): Promise<LookupResult> {
  const definition = definitions().find((d) => d.kind === kind);
  if (!definition) {
    return { kind, options: [], source: 'none', error: `Unknown lookup "${kind}".` };
  }

  const cached = cache.get(kind);
  if (cached && !refresh && Date.now() - cached.at < TTL_MS) return cached.result;

  let result: LookupResult | null = null;
  let lastError: string | undefined;

  const resolved = await resolveCandidate(definition.candidates);
  if (resolved) {
    try {
      const options = await queryOptions(
        resolved.candidate.entity,
        resolved.candidate.valueField,
        resolved.candidate.labelField,
      );
      if (options.length > 0) {
        result = {
          kind,
          options,
          source: 'entity',
          entity: resolved.candidate.entity,
          valueField: resolved.candidate.valueField,
          labelField: resolved.candidate.labelField,
          truncated: options.length >= MAX_OPTIONS,
        };
      } else {
        lastError = `${resolved.candidate.entity} returned no rows.`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  } else {
    lastError = 'No known reference entity matched in $metadata.';
  }

  if (!result) {
    const found = await discover(definition);
    if (found) {
      try {
        const options = await queryOptions(found.entity, found.valueField, found.labelField);
        if (options.length > 0) {
          result = {
            kind,
            options,
            source: 'discovered',
            entity: found.entity,
            valueField: found.valueField,
            labelField: found.labelField,
            error: lastError,
            truncated: options.length >= MAX_OPTIONS,
          };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  if (!result && definition.observedFrom) {
    try {
      const values = await observedValues(definition.observedFrom);
      result = {
        kind,
        options: values.map((value) => ({ value, label: value })),
        source: values.length > 0 ? 'observed' : 'none',
        entity: lineEntity.entitySet,
        error: lastError,
      };
    } catch {
      /* fall through to 'none' */
    }
  }

  result ??= { kind, options: [], source: 'none', error: lastError };

  cache.set(kind, { result, at: Date.now() });
  return result;
}

export async function loadAllLookups(refresh = false): Promise<Record<string, LookupResult>> {
  const kinds = definitions().map((d) => d.kind);
  const results = await Promise.all(kinds.map((kind) => loadLookup(kind, refresh)));
  return Object.fromEntries(results.map((result) => [result.kind, result]));
}
