import { config } from '../config.js';
import {
  D365Error,
  list,
  odataKey,
  odataString,
  request,
  type ODataCollection,
} from './client.js';
import {
  COMPANY_FIELD,
  LINE_NUMBER_FIELD,
  LINE_PARENT_FIELD,
  buildPayload,
  hasCompanyField,
  headerEntity,
  lineEntity,
  listFields,
} from './entities.js';
import { resolvePreparer } from './preparer.js';

export type Record365 = Record<string, unknown>;

/**
 * D365 stores dataAreaId lowercase and its OData key lookups are
 * case-sensitive, so every company value is normalised on the way in.
 */
export const normaliseCompany = (company?: string): string =>
  (company?.trim() || config.D365_DEFAULT_COMPANY).toLowerCase();

/**
 * Builds the company filter and cross-company flag for an entity.
 *
 * Entities without a dataAreaId property reject every mention of it with HTTP
 * 400, so for those the request carries no company scoping at all and D365
 * applies the service account's default company.
 */
function companyScope(
  entity: typeof headerEntity,
  company: string,
): { filters: string[]; crossCompany: boolean } {
  if (!hasCompanyField(entity)) return { filters: [], crossCompany: false };
  return {
    filters: [`${COMPANY_FIELD} eq ${odataString(company)}`],
    crossCompany: true,
  };
}

/** Builds the key predicate for a record, including dataAreaId only if declared. */
function recordKey(
  entity: typeof headerEntity,
  company: string,
  values: Record<string, string | number>,
): string {
  const key: Record<string, string | number> = hasCompanyField(entity)
    ? { [COMPANY_FIELD]: company, ...values }
    : { ...values };
  return odataKey(key);
}

export interface ListHeadersOptions {
  company?: string;
  search?: string;
  status?: string;
  top?: number;
  skip?: number;
}

export async function listHeaders(
  options: ListHeadersOptions = {},
): Promise<ODataCollection<Record365> & { company: string }> {
  const company = normaliseCompany(options.company);
  const scope = companyScope(headerEntity, company);
  const filters = [...scope.filters];

  if (options.search?.trim()) {
    const term = options.search.trim();
    filters.push(
      `(contains(RequisitionNumber,${odataString(term)}) or contains(RequisitionName,${odataString(term)}))`,
    );
  }
  if (options.status?.trim()) {
    filters.push(`RequisitionStatus eq ${odataString(options.status.trim())}`);
  }

  const result = await list<Record365>(headerEntity.entitySet, {
    select: listFields(headerEntity),
    filter: filters.length ? filters.join(' and ') : undefined,
    orderby: 'RequisitionNumber desc',
    top: Math.min(options.top ?? 50, 500),
    skip: options.skip ?? 0,
    count: true,
    crossCompany: scope.crossCompany,
  });

  return { ...result, company };
}

export async function getHeader(
  company: string,
  requisitionNumber: string,
): Promise<Record365> {
  const normalised = normaliseCompany(company);
  const key = recordKey(headerEntity, normalised, {
    RequisitionNumber: requisitionNumber,
  });
  return request<Record365>(`${headerEntity.entitySet}${key}`, {
    query: { crossCompany: hasCompanyField(headerEntity) },
  });
}

export async function listLines(
  company: string,
  requisitionNumber: string,
): Promise<ODataCollection<Record365>> {
  const normalised = normaliseCompany(company);
  const scope = companyScope(lineEntity, normalised);

  return list<Record365>(lineEntity.entitySet, {
    select: listFields(lineEntity),
    filter: [
      ...scope.filters,
      `${LINE_PARENT_FIELD} eq ${odataString(requisitionNumber)}`,
    ].join(' and '),
    orderby: `${LINE_NUMBER_FIELD} asc`,
    top: 500,
    count: true,
    crossCompany: scope.crossCompany,
  });
}

/**
 * Reads requisition lines in bulk, across requisitions.
 *
 * The header entity carries no total, so any spend figure has to come from the
 * lines. Fetching them one requisition at a time would mean one round trip per
 * row on every dashboard load; a single unfiltered read grouped in memory is
 * far cheaper and returns exactly the same records.
 */
export async function listAllLines(top = 2000): Promise<ODataCollection<Record365>> {
  return list<Record365>(lineEntity.entitySet, {
    select: listFields(lineEntity),
    orderby: `${LINE_PARENT_FIELD} desc, ${LINE_NUMBER_FIELD} asc`,
    top,
    count: true,
    crossCompany: hasCompanyField(lineEntity),
  });
}

export class ValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'ValidationError';
  }
}

export interface CreateHeaderContext {
  /** Legal entity chosen on the create screen. */
  company: string;
  /** Email of the signed-in user, used to resolve the preparer. */
  userEmail?: string;
}

export async function createHeader(
  context: CreateHeaderContext,
  body: Record365,
): Promise<Record365> {
  const { payload, errors } = buildPayload(headerEntity, body);

  const company = normaliseCompany(context.company);

  if (hasCompanyField(headerEntity)) {
    payload[COMPANY_FIELD] = company;
  }

  // The buying legal entity follows the chosen company rather than being keyed
  // in separately; F&O stores the code uppercase.
  payload['ProjectBuyingLegalEntityId'] = company.toUpperCase();

  // D365 identifies the preparer by personnel number, so the signed-in user's
  // address is translated before the record is written. Creating a requisition
  // attributed to the wrong person is worse than refusing to create one, so an
  // unresolved preparer is a validation failure rather than a silent default.
  const preparer = await resolvePreparer(context.userEmail);
  if (!preparer.personnelNumber) {
    errors.push(
      preparer.error
        ? `Could not determine the preparer for ${context.userEmail ?? 'the signed-in user'}: ${preparer.error}`
        : `No D365 personnel number is mapped to ${context.userEmail ?? 'the signed-in user'}. Set D365_DEFAULT_PREPARER, or check the preparer lookup at /api/me/preparer.`,
    );
  } else {
    payload['PreparerPersonnelNumber'] = preparer.personnelNumber;
  }

  if (errors.length) throw new ValidationError(errors);

  return request<Record365>(headerEntity.entitySet, {
    method: 'POST',
    body: payload,
    query: { crossCompany: hasCompanyField(headerEntity) },
  });
}

export async function createLine(
  company: string,
  requisitionNumber: string,
  body: Record365,
): Promise<Record365> {
  const { payload, errors } = buildPayload(lineEntity, body);
  if (errors.length) throw new ValidationError(errors);

  const normalised = normaliseCompany(company);
  if (hasCompanyField(lineEntity)) {
    payload[COMPANY_FIELD] = normalised;
  }
  payload[LINE_PARENT_FIELD] = requisitionNumber;

  if (payload[LINE_NUMBER_FIELD] === undefined) {
    payload[LINE_NUMBER_FIELD] = await nextLineNumber(normalised, requisitionNumber);
  }

  return request<Record365>(lineEntity.entitySet, {
    method: 'POST',
    body: payload,
    query: { crossCompany: hasCompanyField(lineEntity) },
  });
}

/**
 * Picks the next line number by reading the current maximum.
 *
 * This is a read-then-write and is therefore not safe against two people
 * adding a line to the same requisition at the same instant. That is an
 * accepted trade-off for a small test-focused user base; the alternative is
 * letting F&O assign it, which the OData line entity does not do reliably.
 */
async function nextLineNumber(
  company: string,
  requisitionNumber: string,
): Promise<number> {
  try {
    const scope = companyScope(lineEntity, company);
    const existing = await list<Record<string, unknown>>(lineEntity.entitySet, {
      select: [LINE_NUMBER_FIELD],
      filter: [
        ...scope.filters,
        `${LINE_PARENT_FIELD} eq ${odataString(requisitionNumber)}`,
      ].join(' and '),
      orderby: `${LINE_NUMBER_FIELD} desc`,
      top: 1,
      crossCompany: scope.crossCompany,
    });
    const highest = existing.value[0]?.[LINE_NUMBER_FIELD];
    return typeof highest === 'number' ? highest + 1 : 1;
  } catch (err) {
    // A failure here should not block the create; fall back to the first line.
    if (err instanceof D365Error) return 1;
    throw err;
  }
}
