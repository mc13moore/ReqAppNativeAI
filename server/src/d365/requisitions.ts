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
  LINE_PARENT_FIELD,
  buildPayload,
  headerEntity,
  lineEntity,
  listFields,
} from './entities.js';

export type Record365 = Record<string, unknown>;

/**
 * D365 stores dataAreaId lowercase and its OData key lookups are
 * case-sensitive, so every company value is normalised on the way in.
 */
export const normaliseCompany = (company?: string): string =>
  (company?.trim() || config.D365_DEFAULT_COMPANY).toLowerCase();

export interface ListHeadersOptions {
  company?: string;
  search?: string;
  status?: string;
  top?: number;
  skip?: number;
}

/**
 * Reads requisition headers for one legal entity.
 *
 * cross-company=true plus an explicit dataAreaId filter is deliberate: without
 * it, F&O silently scopes results to the default company of the service
 * account, which makes the company selector in the UI appear broken.
 */
export async function listHeaders(
  options: ListHeadersOptions = {},
): Promise<ODataCollection<Record365> & { company: string }> {
  const company = normaliseCompany(options.company);
  const filters = [`dataAreaId eq ${odataString(company)}`];

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
    filter: filters.join(' and '),
    orderby: 'RequisitionNumber desc',
    top: Math.min(options.top ?? 50, 500),
    skip: options.skip ?? 0,
    count: true,
    crossCompany: true,
  });

  return { ...result, company };
}

export async function getHeader(
  company: string,
  requisitionNumber: string,
): Promise<Record365> {
  const key = odataKey({
    dataAreaId: normaliseCompany(company),
    RequisitionNumber: requisitionNumber,
  });
  return request<Record365>(`${headerEntity.entitySet}${key}`, {
    query: { crossCompany: true },
  });
}

export async function listLines(
  company: string,
  requisitionNumber: string,
): Promise<ODataCollection<Record365>> {
  return list<Record365>(lineEntity.entitySet, {
    select: listFields(lineEntity),
    filter: [
      `dataAreaId eq ${odataString(normaliseCompany(company))}`,
      `${LINE_PARENT_FIELD} eq ${odataString(requisitionNumber)}`,
    ].join(' and '),
    orderby: 'LineNumber asc',
    top: 500,
    count: true,
    crossCompany: true,
  });
}

export class ValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'ValidationError';
  }
}

export async function createHeader(
  company: string,
  body: Record365,
): Promise<Record365> {
  const { payload, errors } = buildPayload(headerEntity, body);
  if (errors.length) throw new ValidationError(errors);

  payload['dataAreaId'] = normaliseCompany(company);

  return request<Record365>(headerEntity.entitySet, {
    method: 'POST',
    body: payload,
    query: { crossCompany: true },
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
  payload['dataAreaId'] = normalised;
  payload[LINE_PARENT_FIELD] = requisitionNumber;

  if (payload['LineNumber'] === undefined) {
    payload['LineNumber'] = await nextLineNumber(normalised, requisitionNumber);
  }

  return request<Record365>(lineEntity.entitySet, {
    method: 'POST',
    body: payload,
    query: { crossCompany: true },
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
    const existing = await list<{ LineNumber?: number }>(lineEntity.entitySet, {
      select: ['LineNumber'],
      filter: [
        `dataAreaId eq ${odataString(company)}`,
        `${LINE_PARENT_FIELD} eq ${odataString(requisitionNumber)}`,
      ].join(' and '),
      orderby: 'LineNumber desc',
      top: 1,
      crossCompany: true,
    });
    const highest = existing.value[0]?.LineNumber;
    return typeof highest === 'number' ? highest + 1 : 1;
  } catch (err) {
    // A failure here should not block the create; fall back to the first line.
    if (err instanceof D365Error) return 1;
    throw err;
  }
}
