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
  /**
   * Browser only: tab-only accounts. A tab that signs in while the browser's main account is in use
   * keeps its own account: the slot the API returns (X-Session-Slot) is kept in sessionStorage and
   * sent with every request. See backend/src/common/auth/cookies.ts.
   */
  sessionSlots?: boolean;
}

const SLOT_STORAGE_KEY = 'estate.sessionSlot';
const MAIN_SLOT = 'main';
const NO_SESSION_SLOT = 'none';
const TAB_SLOT_PATTERN = /^[a-z0-9]{12,24}$/;

let storageUsable: boolean | null = null;

/** Whether tabs can hold their own accounts here (needs working sessionStorage). */
export function tabSessionsSupported(): boolean {
  if (storageUsable !== null) return storageUsable;
  try {
    const store = window.sessionStorage;
    store.setItem('estate.probe', '1');
    storageUsable = store.getItem('estate.probe') === '1';
    store.removeItem('estate.probe');
  } catch {
    storageUsable = false;
  }
  return storageUsable;
}

/** This tab's account: a tab slot id, 'main', 'none', or null (a fresh tab: the browser's main account). */
export function tabSessionSlot(): string | null {
  if (typeof window === 'undefined' || !tabSessionsSupported()) return null;
  try {
    return window.sessionStorage.getItem(SLOT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeTabSlot(slot: string | null): void {
  if (typeof window === 'undefined' || !tabSessionsSupported()) return;
  try {
    if (slot === null) window.sessionStorage.removeItem(SLOT_STORAGE_KEY);
    else window.sessionStorage.setItem(SLOT_STORAGE_KEY, slot);
  } catch {
    /* storage unavailable */
  }
}

function isTabSlot(slot: string | null): boolean {
  return slot !== null && TAB_SLOT_PATTERN.test(slot);
}

let pageCacheGuard = false;
/**
 * A page restored by Back/Forward from the browser's page cache keeps the UI of the account it was
 * loaded with; reload it when this tab has switched account since.
 */
function guardPageCache(): void {
  if (pageCacheGuard || typeof window === 'undefined') return;
  pageCacheGuard = true;
  let slotWhenHidden: string | null = null;
  window.addEventListener('pagehide', () => {
    slotWhenHidden = tabSessionSlot();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && tabSessionSlot() !== slotWhenHidden) window.location.reload();
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(config: ApiClientConfig) {
  const base = config.baseUrl.replace(/\/$/, '');
  let refreshing: Promise<boolean> | null = null;
  if (config.sessionSlots) guardPageCache();

  function slotHeaders(): Record<string, string> {
    if (!config.sessionSlots || typeof window === 'undefined') return {};
    // Without sessionStorage a tab cannot remember an account of its own: use the main one only.
    if (!tabSessionsSupported()) return { 'X-Session-Slot': MAIN_SLOT };
    const slot = tabSessionSlot();
    return slot ? { 'X-Session-Slot': slot } : {};
  }

  /** Remembers the account the API put this tab in (sign-in, refresh) or that it signed out of. */
  function rememberSlot(res: Response, path: string): void {
    if (!config.sessionSlots || !res.ok) return;
    if (path.startsWith('/auth/logout-all')) return writeTabSlot(null);
    // After signing out a tab-only account the tab stays signed out (it must not show the main account).
    if (path.startsWith('/auth/logout')) return writeTabSlot(isTabSlot(tabSessionSlot()) ? NO_SESSION_SLOT : null);
    const slot = res.headers.get('x-session-slot');
    if (slot) writeTabSlot(slot);
  }

  function refreshSession(): Promise<boolean> {
    if (!refreshing) {
      refreshing = fetch(`${base}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', ...slotHeaders() } })
        .then((r) => {
          rememberSlot(r, '/auth/refresh');
          return r.ok;
        })
        .catch(() => false)
        .finally(() => {
          setTimeout(() => {
            refreshing = null;
          }, 0);
        });
    }
    return refreshing;
  }

  /** Sends a request (refreshing the session once on 401) and returns the successful response. */
  async function send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const url = `${base}/api/v1${path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...slotHeaders(), ...(config.getHeaders ? await config.getHeaders() : {}), ...opts.headers };
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
        if (await refreshSession()) res = await fetch(url, { ...init, headers: { ...headers, ...slotHeaders() } });
        else config.onAuthFailure?.();
      }
      rememberSlot(res, path);
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
    return res;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await send(method, path, opts);
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
  }

  /**
   * Downloads a file (e.g. a CSV export) as this tab's account and saves it. Use this instead of a plain
   * link: a link cannot send the tab's account, so it would always use the browser's main account.
   */
  async function download(path: string, fallbackName = 'download'): Promise<void> {
    const res = await send('GET', path.replace(/^\/api\/v1(?=\/)/, ''), { headers: { Accept: '*/*' } });
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? decodeURIComponent(match[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return {
    request,
    refreshSession,
    download,
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
    /**
     * "Use another account in this tab": the tab leaves its account (a tab-only account is signed out;
     * the browser's main account stays for the other tabs) and its next sign-in stays in this tab.
     */
    async useAnotherAccountInThisTab(): Promise<void> {
      if (isTabSlot(tabSessionSlot())) {
        try {
          await request('POST', '/auth/logout');
        } catch {
          /* already signed out */
        }
      }
      writeTabSlot(NO_SESSION_SLOT);
    },
    /** Signs every account of this app out of this browser (main and tab-only accounts). */
    async signOutEverywhere(): Promise<void> {
      await request('POST', '/auth/logout-all');
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
