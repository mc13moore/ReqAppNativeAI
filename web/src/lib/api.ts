import type {
  AppConfig,
  AppUser,
  ListResponse,
  PropertyInfo,
  Record365,
  RequisitionDetail,
  Schema,
} from './types';

/**
 * Error carrying the structured shape the API returns, so callers can show the
 * per-field validation messages rather than a single opaque string.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: string[] = [],
    readonly source?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  // Built-in authentication redirects unauthenticated browsers to a sign-in
  // page; an HTML response to an API call means the session has lapsed.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (response.status === 401 || response.redirected) {
      throw new ApiError(401, 'Your session has expired. Reload the page to sign in again.');
    }
    throw new ApiError(response.status, `Unexpected response from the server (${response.status}).`);
  }

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body['message'] === 'string' ? body['message'] : `Request failed (${response.status}).`,
      Array.isArray(body['errors']) ? (body['errors'] as string[]) : [],
      typeof body['source'] === 'string' ? body['source'] : undefined,
    );
  }

  return body as T;
}

export const api = {
  config: () => call<AppConfig>('/config'),

  me: () => call<{ user: AppUser }>('/me'),

  schema: () => call<Schema>('/schema'),

  listRequisitions: (params: {
    company?: string;
    search?: string;
    top?: number;
    skip?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.company) query.set('company', params.company);
    if (params.search) query.set('search', params.search);
    if (params.top !== undefined) query.set('top', String(params.top));
    if (params.skip !== undefined) query.set('skip', String(params.skip));
    return call<ListResponse>(`/requisitions?${query}`);
  },

  getRequisition: (company: string, requisitionNumber: string) =>
    call<RequisitionDetail>(
      `/requisitions/${encodeURIComponent(company)}/${encodeURIComponent(requisitionNumber)}`,
    ),

  createRequisition: (body: Record365) =>
    call<Record365>('/requisitions', { method: 'POST', body: JSON.stringify(body) }),

  createLine: (company: string, requisitionNumber: string, body: Record365) =>
    call<Record365>(
      `/requisitions/${encodeURIComponent(company)}/${encodeURIComponent(requisitionNumber)}/lines`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  checkD365: () =>
    call<{ status: string; environment: string; elapsedMs: number }>('/health/d365'),

  searchEntities: (search: string) =>
    call<{ count: number; truncated: boolean; value: { name: string; entityType: string }[] }>(
      `/metadata/entities?search=${encodeURIComponent(search)}`,
    ),

  describeEntity: (name: string) =>
    call<{ entitySet: string; entityType: string; properties: PropertyInfo[] }>(
      `/metadata/entities/${encodeURIComponent(name)}`,
    ),
};
