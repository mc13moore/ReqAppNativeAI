import { config } from '../config.js';
import { D365Error, list } from './client.js';
import { lineEntity } from './entities.js';
import { listAllLines } from './requisitions.js';

export interface LookupOption {
  value: string;
  label: string;
}

export interface LookupAttempt {
  entity: string;
  outcome: 'ok' | 'not-found' | 'rejected' | 'empty' | 'no-matching-field';
  detail?: string;
  /** Field names the probe row actually carried, when one came back. */
  sampleFields?: string[];
}

export interface LookupResult {
  kind: string;
  options: LookupOption[];
  /**
   * 'entity'   - read from a D365 reference entity
   * 'observed' - distinct values already on requisition lines
   * 'none'     - nothing worked; the form falls back to free text
   */
  source: 'entity' | 'observed' | 'none';
  entity?: string;
  valueField?: string;
  labelField?: string;
  /** Every entity tried, in order, with what happened. Drives diagnostics. */
  attempts: LookupAttempt[];
  truncated?: boolean;
}

interface LookupDefinition {
  kind: string;
  /** Entity sets to probe, in order. */
  entities: string[];
  /** Acceptable value-field names, best first. */
  valueFields: string[];
  /** Acceptable label-field names, best first. */
  labelFields: string[];
  /** Field on the requisition line holding the same value, for the last resort. */
  observedFrom: string;
}

/**
 * Candidate reference entities and field names.
 *
 * F&O public entity and property names vary by version, and guessing a single
 * pair has already cost this project several rounds of 400s and 404s. Rather
 * than assert names, each entity is probed with a one-row read and the field
 * names are then taken from the row that comes back -- so the only thing that
 * has to be right is that one of the entity names exists.
 */
function definitions(): LookupDefinition[] {
  const configured = (entity: string, rest: string[]) =>
    entity ? [entity, ...rest.filter((e) => e !== entity)] : rest;

  return [
    {
      kind: 'vendors',
      entities: configured(config.D365_VENDOR_ENTITY, [
        'VendorsV2',
        'Vendors',
        'VendorsV3',
        'VendorMasters',
      ]),
      valueFields: [
        config.D365_VENDOR_NUMBER_FIELD,
        'VendorAccountNumber',
        'VendorAccount',
        'AccountNum',
      ],
      labelFields: [
        config.D365_VENDOR_NAME_FIELD,
        'VendorOrganizationName',
        'VendorName',
        'OrganizationName',
        'Name',
      ],
      observedFrom: 'VendorAccountNumber',
    },
    {
      kind: 'employees',
      entities: configured(config.D365_EMPLOYEE_ENTITY, [
        'Employees',
        'Workers',
        'EmployeesV2',
        'WorkersV2',
      ]),
      valueFields: [config.D365_EMPLOYEE_NUMBER_FIELD, 'PersonnelNumber', 'WorkerPersonnelNumber'],
      labelFields: [config.D365_EMPLOYEE_NAME_FIELD, 'Name', 'FullName', 'PersonName'],
      observedFrom: 'RequisitionerPersonnelNumber',
    },
    {
      kind: 'categories',
      entities: configured(config.D365_CATEGORY_ENTITY, [
        'ProcurementCategories',
        'ProcurementCategoryHierarchies',
        'ProcurementCategoryHierarchyDetails',
        'ProductCategories',
        'EcoResProductCategories',
      ]),
      valueFields: [
        config.D365_CATEGORY_FIELD,
        'ProcurementCategoryName',
        'CategoryName',
        'Name',
      ],
      labelFields: ['ProcurementCategoryName', 'CategoryName', 'Name', 'Description'],
      observedFrom: 'ProcurementProductCategoryName',
    },
    {
      kind: 'units',
      entities: configured(config.D365_UNIT_ENTITY, [
        'UnitOfMeasures',
        'UnitsOfMeasure',
        'UnitOfMeasureTranslations',
      ]),
      valueFields: [config.D365_UNIT_FIELD, 'UnitOfMeasureSymbol', 'Symbol', 'UnitSymbol'],
      labelFields: ['Description', 'UnitOfMeasureName', 'Name'],
      observedFrom: 'PurchaseUnitSymbol',
    },
  ];
}

const cache = new Map<string, { result: LookupResult; at: number }>();
const TTL_MS = 15 * 60 * 1000;

/** Long enough for a real vendor master without pulling an unbounded table. */
const MAX_OPTIONS = 1000;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();

/**
 * Reads one row to find out whether the entity exists and what it contains.
 *
 * Deliberately issues no $select: naming a field that does not exist turns a
 * cheap probe into a 400, which is exactly the failure this is trying to avoid.
 * The field names are read off the row instead.
 */
async function probe(entity: string): Promise<
  | { ok: true; fields: string[]; companyScoped: boolean }
  | { ok: false; attempt: LookupAttempt }
> {
  try {
    const response = await list<Record<string, unknown>>(entity, { top: 1 });
    const row = response.value[0];

    if (!row) {
      return { ok: false, attempt: { entity, outcome: 'empty', detail: 'Entity returned no rows.' } };
    }

    const fields = Object.keys(row).filter((key) => !key.startsWith('@'));

    // Most F&O master data is scoped by legal entity. Reading it without
    // cross-company returns only the service account's default company, which
    // is why a vendor list can come back with a single row while the vendor
    // master holds hundreds.
    return { ok: true, fields, companyScoped: fields.includes('dataAreaId') };
  } catch (err) {
    const status = err instanceof D365Error ? err.status : undefined;
    return {
      ok: false,
      attempt: {
        entity,
        outcome: status === 404 ? 'not-found' : 'rejected',
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
    };
  }
}

async function fetchOptions(
  entity: string,
  valueField: string,
  labelField: string | undefined,
  crossCompany: boolean,
): Promise<LookupOption[]> {
  const select = labelField && labelField !== valueField ? [valueField, labelField] : [valueField];

  const response = await list<Record<string, unknown>>(entity, {
    select,
    orderby: valueField,
    top: MAX_OPTIONS,
    crossCompany,
  });

  const seen = new Set<string>();
  const options: LookupOption[] = [];

  for (const record of response.value) {
    const value = text(record[valueField]);
    if (!value || seen.has(value)) continue;
    seen.add(value);

    const label = labelField ? text(record[labelField]) : '';
    options.push({ value, label: label || value });
  }

  return options;
}

async function observedValues(field: string): Promise<string[]> {
  const lines = await listAllLines(2000);
  const values = new Set<string>();

  for (const record of lines.value) {
    const value = text(record[field]);
    if (value) values.add(value);
  }

  return [...values].sort();
}

/**
 * Loads a dropdown's options.
 *
 * Probes each candidate entity in turn, takes the field names from whichever
 * one answers, and falls back to the distinct values already present on
 * requisition lines. Every attempt is recorded so the diagnostics screen can
 * show exactly which entity names were tried and what D365 said about each --
 * that record is what turns a missing dropdown into a fixable problem.
 */
export async function loadLookup(kind: string, refresh = false): Promise<LookupResult> {
  const definition = definitions().find((d) => d.kind === kind);
  if (!definition) {
    return { kind, options: [], source: 'none', attempts: [] };
  }

  const cached = cache.get(kind);
  if (cached && !refresh && Date.now() - cached.at < TTL_MS) return cached.result;

  const attempts: LookupAttempt[] = [];
  let result: LookupResult | null = null;

  for (const entity of definition.entities) {
    const probed = await probe(entity);

    if (!probed.ok) {
      attempts.push(probed.attempt);
      continue;
    }

    const available = new Set(probed.fields);
    const valueField = definition.valueFields.find((f) => f && available.has(f));

    if (!valueField) {
      attempts.push({
        entity,
        outcome: 'no-matching-field',
        detail: `None of ${definition.valueFields.filter(Boolean).join(', ')} exist on this entity.`,
        sampleFields: probed.fields.slice(0, 30),
      });
      continue;
    }

    const labelField = definition.labelFields.find(
      (f) => f && f !== valueField && available.has(f),
    );

    try {
      let options: LookupOption[];
      try {
        options = await fetchOptions(entity, valueField, labelField, probed.companyScoped);
      } catch (err) {
        // Not every company-scoped entity accepts cross-company. Retrying
        // without it returns the default company's rows, which is still far
        // better than dropping the dropdown entirely.
        if (!probed.companyScoped) throw err;
        attempts.push({
          entity,
          outcome: 'rejected',
          detail: `cross-company rejected, retrying scoped: ${
            err instanceof Error ? err.message.slice(0, 200) : String(err)
          }`,
        });
        options = await fetchOptions(entity, valueField, labelField, false);
      }

      if (options.length === 0) {
        attempts.push({ entity, outcome: 'empty', detail: 'Query returned no usable values.' });
        continue;
      }

      attempts.push({
        entity,
        outcome: 'ok',
        detail: `${options.length} options${probed.companyScoped ? ' across all legal entities' : ''}`,
      });
      result = {
        kind,
        options,
        source: 'entity',
        entity,
        valueField,
        labelField,
        attempts,
        truncated: options.length >= MAX_OPTIONS,
      };
      break;
    } catch (err) {
      attempts.push({
        entity,
        outcome: 'rejected',
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
    }
  }

  if (!result) {
    try {
      const values = await observedValues(definition.observedFrom);
      result = {
        kind,
        options: values.map((value) => ({ value, label: value })),
        source: values.length > 0 ? 'observed' : 'none',
        entity: values.length > 0 ? lineEntity.entitySet : undefined,
        valueField: definition.observedFrom,
        attempts,
      };
    } catch {
      result = { kind, options: [], source: 'none', attempts };
    }
  }

  cache.set(kind, { result, at: Date.now() });
  return result;
}

export async function loadAllLookups(refresh = false): Promise<Record<string, LookupResult>> {
  const kinds = definitions().map((d) => d.kind);
  // Sequential rather than parallel: four concurrent probe-and-fetch chains
  // against F&O is enough to trip its throttling, and the whole set is cached
  // for fifteen minutes afterwards.
  const results: LookupResult[] = [];
  for (const kind of kinds) {
    results.push(await loadLookup(kind, refresh));
  }
  return Object.fromEntries(results.map((result) => [result.kind, result]));
}
