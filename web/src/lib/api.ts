import type {
  AnalyticsResponse,
  AppConfig,
  AppUser,
  AssistantIntent,
  AssistantReply,
  CreateWithLinesResult,
  D365Health,
  LookupResult,
  PropertyInfo,
  Record365,
  RequisitionDetailView,
  Schema,
  WorkspaceListResponse,
} from './types';

/**
 * Error carrying the structured shape the API returns, so callers can show the
 * per-field validation messages and the verbatim upstream complaint rather
 * than a single opaque string.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: string[] = [],
    readonly source?: string,
    readonly detail?: string,
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
    const detail = body['detail'];
    throw new ApiError(
      response.status,
      typeof body['message'] === 'string' ? body['message'] : `Request failed (${response.status}).`,
      Array.isArray(body['errors']) ? (body['errors'] as string[]) : [],
      typeof body['source'] === 'string' ? body['source'] : undefined,
      typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : undefined,
    );
  }

  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  /* --- system --- */
  config: () => call<AppConfig>('/config'),
  me: () => call<{ user: AppUser }>('/me'),
  schema: () => call<Schema>('/schema'),
  checkD365: () => call<D365Health>('/health/d365'),
  lookups: () => call<Record<string, LookupResult>>('/lookups'),

  /* --- workspace (read projections) --- */
  requisitions: (params: {
    search?: string;
    status?: string;
    company?: string;
    vendor?: string;
    category?: string;
    top?: number;
    skip?: number;
  }) => call<WorkspaceListResponse>(`/workspace/requisitions${qs(params)}`),

  requisitionDetail: (company: string, requisitionNumber: string) =>
    call<RequisitionDetailView>(
      `/workspace/requisitions/${encodeURIComponent(company)}/${encodeURIComponent(requisitionNumber)}`,
    ),

  analytics: () => call<AnalyticsResponse>('/workspace/analytics'),

  /* --- assistant --- */
  ask: (body: {
    prompt: string;
    intent: AssistantIntent;
    company?: string;
    requisitionNumber?: string;
  }) => call<AssistantReply>('/assistant/ask', { method: 'POST', body: JSON.stringify(body) }),

  /* --- writes (direct D365 pass-through) --- */
  createRequisition: (body: Record365) =>
    call<Record365>('/requisitions', { method: 'POST', body: JSON.stringify(body) }),

  createRequisitionWithLines: (body: {
    company?: string;
    header: Record365;
    lines: Record365[];
  }) =>
    call<CreateWithLinesResult>('/requisitions/with-lines', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createLine: (company: string, requisitionNumber: string, body: Record365) =>
    call<Record365>(
      `/requisitions/${encodeURIComponent(company)}/${encodeURIComponent(requisitionNumber)}/lines`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /* --- metadata explorer --- */
  searchEntities: (search: string) =>
    call<{ count: number; truncated: boolean; value: { name: string; entityType: string }[] }>(
      `/metadata/entities${qs({ search })}`,
    ),

  describeEntity: (name: string) =>
    call<{ entitySet: string; entityType: string; properties: PropertyInfo[] }>(
      `/metadata/entities/${encodeURIComponent(name)}`,
    ),
};
