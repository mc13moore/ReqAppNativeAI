import { config } from '../config.js';
import { getD365Token, invalidateD365Token } from '../auth/d365Token.js';

export class D365Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'D365Error';
  }
}

export interface ODataQuery {
  select?: string[];
  filter?: string;
  orderby?: string;
  top?: number;
  skip?: number;
  count?: boolean;
  expand?: string;
  crossCompany?: boolean;
}

export interface ODataCollection<T> {
  value: T[];
  count?: number;
  nextLink?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: ODataQuery;
  body?: unknown;
  /** Set false for $metadata, which is XML. */
  json?: boolean;
}

function buildSearchParams(query: ODataQuery = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.select?.length) params.set('$select', query.select.join(','));
  if (query.filter) params.set('$filter', query.filter);
  if (query.orderby) params.set('$orderby', query.orderby);
  if (query.top !== undefined) params.set('$top', String(query.top));
  if (query.skip !== undefined) params.set('$skip', String(query.skip));
  if (query.count) params.set('$count', 'true');
  if (query.expand) params.set('$expand', query.expand);
  // cross-company is an F&O-specific option that widens reads beyond the
  // caller's default legal entity. It is a bare option, not an OData $ one.
  if (query.crossCompany) params.set('cross-company', 'true');
  return params;
}

/**
 * Escapes a value for use inside an OData string literal. OData escapes a
 * single quote by doubling it -- backslashes are not escape characters here,
 * so doubling is both necessary and sufficient.
 */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Builds an entity key predicate such as (dataAreaId='usmf',RequisitionNumber='00042'). */
export function odataKey(key: Record<string, string | number>): string {
  const parts = Object.entries(key).map(([name, value]) =>
    typeof value === 'number'
      ? `${name}=${value}`
      : `${name}=${odataString(value)}`,
  );
  return `(${parts.join(',')})`;
}

function parseErrorBody(status: number, text: string): D365Error {
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: string; message?: string | { value?: string }; innererror?: unknown };
    };
    const raw = parsed.error?.message;
    const message =
      typeof raw === 'string' ? raw : raw?.value ?? 'D365 request failed';
    return new D365Error(
      status,
      parsed.error?.code || `http_${status}`,
      message,
      parsed.error?.innererror,
    );
  } catch {
    return new D365Error(
      status,
      `http_${status}`,
      text.slice(0, 1000) || `D365 request failed with status ${status}`,
    );
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(
  url: string,
  options: RequestOptions,
  attempt: number,
): Promise<Response> {
  const token = await getD365Token();
  const isJson = options.json !== false;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: isJson ? 'application/json' : 'application/xml',
    'OData-Version': '4.0',
    'OData-MaxVersion': '4.0',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    // Ask F&O to return the created record so the caller learns the
    // server-assigned requisition number without a second round trip.
    headers['Prefer'] = 'return=representation';
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(config.D365_TIMEOUT_MS),
  });

  if (response.status === 401 && attempt === 1) {
    // The cached token may have been revoked early; drop it and retry once.
    invalidateD365Token();
    return send(url, options, attempt + 1);
  }

  if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 250;
    await sleep(delay);
    return send(url, options, attempt + 1);
  }

  return response;
}

/** Issues a request against the /data OData endpoint. */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const params = buildSearchParams(options.query);
  const qs = params.toString();
  const url = `${config.D365_BASE_URL}/data/${path}${qs ? `?${qs}` : ''}`;

  let response: Response;
  try {
    response = await send(url, options, 1);
  } catch (cause) {
    const message =
      cause instanceof Error && cause.name === 'TimeoutError'
        ? `D365 did not respond within ${config.D365_TIMEOUT_MS}ms`
        : `Could not reach D365 at ${config.D365_BASE_URL}`;
    throw new D365Error(504, 'upstream_unreachable', message, String(cause));
  }

  if (!response.ok) {
    throw parseErrorBody(response.status, await response.text());
  }

  if (response.status === 204) return undefined as T;
  if (options.json === false) return (await response.text()) as T;
  return (await response.json()) as T;
}

/** Reads an entity collection, normalising OData's @odata.* envelope fields. */
export async function list<T>(
  entitySet: string,
  query: ODataQuery = {},
): Promise<ODataCollection<T>> {
  const raw = await request<Record<string, unknown>>(entitySet, { query });
  return {
    value: (raw['value'] as T[]) ?? [],
    count: raw['@odata.count'] as number | undefined,
    nextLink: raw['@odata.nextLink'] as string | undefined,
  };
}

/** Fetches the raw $metadata XML document. */
export async function metadataXml(): Promise<string> {
  return request<string>('$metadata', { json: false });
}
