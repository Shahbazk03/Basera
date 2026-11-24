import type { ApiErrorBody } from '@estate/shared';

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? (status === 0 ? 'Network error — check your connection' : `Request failed (${status})`));
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.body?.code;
  }

  get details(): { path: string; message: string }[] {
    return this.body?.details ?? [];
  }

  get requestId(): string | undefined {
    return this.body?.requestId;
  }

  /** Field path → message, for mapping server validation errors onto form fields. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) if (d.path && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type Query = Record<string, QueryValue>;

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  cache?: RequestCache;
  /** Next.js fetch cache hints (server components) */
  next?: { revalidate?: number | false; tags?: string[] };
}

export interface ApiClientConfig {
  /** '' for same-origin browser usage (requests go through the app's /api/v1 rewrite). */
  baseUrl: string;
  /** Extra headers (e.g. forwarded cookies on the server). */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Browser only: on 401, refresh the session once and retry. */
  refreshOn401?: boolean;
  /** Called when the session cannot be refreshed. */
  onAuthFailure?: () => void;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(config: ApiClientConfig) {
  const base = config.baseUrl.replace(/\/$/, '');
  let refreshing: Promise<boolean> | null = null;

  function refreshSession(): Promise<boolean> {
    if (!refreshing) {
      refreshing = fetch(`${base}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => {
          setTimeout(() => {
            refreshing = null;
          }, 0);
        });
    }
    return refreshing;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${base}/api/v1${path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...(config.getHeaders ? await config.getHeaders() : {}), ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.formData) body = opts.formData;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const init: RequestInit & { next?: RequestOptions['next'] } = { method, headers, body, credentials: 'include', signal: opts.signal };
    if (opts.cache) init.cache = opts.cache;
    if (opts.next) init.next = opts.next;

    let res: Response;
    try {
      res = await fetch(url, init);
      if (res.status === 401 && config.refreshOn401 && !path.startsWith('/auth/refresh') && !path.startsWith('/auth/login')) {
        if (await refreshSession()) res = await fetch(url, init);
        else config.onAuthFailure?.();
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError(0, null);
    }

    if (!res.ok) {
      let errBody: ApiErrorBody | null = null;
      try {
        errBody = (await res.json()) as ApiErrorBody;
      } catch {
        errBody = null;
      }
      throw new ApiError(res.status, errBody);
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
  }

  return {
    request,
    refreshSession,
    get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'query'>) => request<T>('GET', path, { ...opts, query }),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) => request<T>('POST', path, { ...opts, body }),
    put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) => request<T>('PUT', path, { ...opts, body }),
    patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) => request<T>('PATCH', path, { ...opts, body }),
    delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
    /** Multipart upload to POST /files. */
    upload: (file: File | Blob, purpose: string, organizationId?: string, fileName?: string) => {
      const fd = new FormData();
      fd.set('file', file, fileName ?? (file instanceof File ? file.name : 'upload'));
      fd.set('purpose', purpose);
      if (organizationId) fd.set('organizationId', organizationId);
      return request<UploadedFile>('POST', '/files', { formData: fd });
    },
  };
}

export interface UploadedFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  url: string | null;
}

/** Human message for any thrown value. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Too many requests — please wait a moment and try again.';
    if (err.status >= 500) return `${fallback}${err.requestId ? ` (ref ${err.requestId.slice(0, 8)})` : ''}`;
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
