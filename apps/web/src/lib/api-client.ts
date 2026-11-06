export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    /** Structured error payload, e.g. the current incident on a version conflict. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  code?: string;
  message?: string;
  requestId?: string;
  details?: unknown;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  params: Record<string, string | undefined>,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const qs = query.size > 0 ? `?${query}` : '';

  const res = await fetch(`/api/v1${path}${qs}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal,
  });

  if (res.ok) return (await res.json()) as T;

  // A full navigation on purpose: it drops all client state (query cache, sockets) with the session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (res.status === 401) window.location.assign(`${window.location.origin}/login`);
  const error = (await res.json().catch(() => null)) as ErrorBody | null;
  throw new ApiError(
    res.status,
    error?.code ?? 'UNAVAILABLE',
    error?.message ?? 'The service is unavailable right now.',
    error?.requestId,
    error?.details,
  );
}

/**
 * JSON API helpers (same-origin, proxied by Next). Expired or missing sessions send the
 * user to the login page; other failures surface as `ApiError` with the request ID so
 * support can correlate them with server logs (NFR-OBS-001).
 */
export function apiGet<T>(
  path: string,
  params: Record<string, string | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  return request<T>('GET', path, params, undefined, signal);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, {}, body);
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, {}, body);
}
