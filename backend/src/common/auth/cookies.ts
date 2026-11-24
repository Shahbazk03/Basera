import { randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';

/** The frontend a request came through. */
export type ClientApp = 'web' | 'console';

/**
 * Cookie names per frontend. The public website and the business console keep independent sessions —
 * signing in on one never replaces the session of the other, even when both share a host
 * (browsers do not separate cookies by port, so http://localhost:3200 and :3300 would otherwise collide).
 * The bare names hold the browser's main session; tab-only accounts add a slot suffix (see below).
 */
export const AUTH_COOKIES: Record<ClientApp, { access: string; refresh: string; hint: string }> = {
  web: { access: 'estate_at', refresh: 'estate_rt', hint: 'estate_session' },
  console: { access: 'estate_console_at', refresh: 'estate_console_rt', hint: 'estate_console_session' },
};
/** Website cookie names (kept for API docs and tooling). */
export const ACCESS_COOKIE = AUTH_COOKIES.web.access;
export const REFRESH_COOKIE = AUTH_COOKIES.web.refresh;
/** Non-secret, script-readable hint that a session may exist (lets frontends skip /auth/me for anonymous visitors). */
export const SESSION_HINT_COOKIE = AUTH_COOKIES.web.hint;
/** Refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Tab-only accounts ("session slots"). A browser has one MAIN session (bare cookie names, exactly as
 * before) used by ordinary tabs, new tabs and plain links. A tab can additionally hold its own account
 * in a slot: cookies `<prefix>_<slot>`, and the tab sends `X-Session-Slot: <slot>` (kept in sessionStorage).
 * Nothing is ever guessed: no header (or `main`) always means the main session; `none` means no session.
 * Naming a slot grants nothing — a browser only ever sends its own cookies.
 */
export const SESSION_SLOT_HEADER = 'x-session-slot';
export const MAIN_SLOT = 'main';
export const NO_SESSION_SLOT = 'none';
const SLOT_PATTERN = /^[a-z0-9]{12,24}$/;
/** Tab-only accounts kept per browser and app (besides the main session); the oldest are signed out first. */
export const MAX_TAB_SLOTS = 5;

type CookieRequest = Pick<Request, 'headers'> & { cookies?: Record<string, string> };
type AppCookies = (typeof AUTH_COOKIES)[ClientApp];

let consoleHost: string | undefined;
function consoleHostname(): string {
  if (consoleHost === undefined) {
    try {
      consoleHost = new URL(env().CONSOLE_PUBLIC_URL).host.toLowerCase();
    } catch {
      consoleHost = '';
    }
  }
  return consoleHost;
}

/**
 * Identifies the console by the host the request arrived on: the Next.js proxy (and Caddy in production)
 * forward it as X-Forwarded-Host. Everything else — website, project microsites, direct API calls — is "web".
 * Choosing a cookie name grants nothing: a client only ever sends its own cookies.
 */
export function clientApp(req: Pick<Request, 'headers'> | undefined): ClientApp {
  if (!req) return 'web';
  const raw = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  const host = (Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim().toLowerCase();
  return host !== '' && host === consoleHostname() ? 'console' : 'web';
}

export function authCookieNames(req: Pick<Request, 'headers'> | undefined): AppCookies {
  return AUTH_COOKIES[clientApp(req)];
}

function slotCookie(prefix: string, slot: string): string {
  return slot === MAIN_SLOT ? prefix : `${prefix}_${slot}`;
}

export function isTabSlotId(value: string | undefined | null): value is string {
  return typeof value === 'string' && SLOT_PATTERN.test(value);
}

/** What the tab asked for: `main`, `none`, a tab slot id, or undefined (no or malformed header). */
export function requestedSlot(req: CookieRequest): string | undefined {
  const raw = req.headers[SESSION_SLOT_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return value === MAIN_SLOT || value === NO_SESSION_SLOT || isTabSlotId(value) ? value : undefined;
}

/** The session this request acts in: the tab's own slot, else the main session; null for `none`. */
export function sessionSlot(req: CookieRequest): string | null {
  const requested = requestedSlot(req);
  if (requested === NO_SESSION_SLOT) return null;
  return requested ?? MAIN_SLOT;
}

/** Tab slots this browser holds cookies for, newest first. */
export function tabSlots(req: CookieRequest): string[] {
  const n = authCookieNames(req);
  const found = new Set<string>();
  for (const name of Object.keys(req.cookies ?? {})) {
    for (const prefix of [n.access, n.refresh]) {
      const rest = name.startsWith(`${prefix}_`) ? name.slice(prefix.length + 1) : '';
      if (isTabSlotId(rest)) found.add(rest);
    }
  }
  return [...found].sort().reverse();
}

/** Time-ordered random id for a new tab slot. */
export function newTabSlotId(): string {
  return Date.now().toString(36).padStart(10, '0') + randomBytes(4).toString('hex');
}

function base(): CookieOptions {
  return { httpOnly: true, secure: env().COOKIE_SECURE, sameSite: 'lax' };
}

function longLived(): number {
  return env().REFRESH_TOKEN_TTL_DAYS * 86_400_000;
}

/** Stores a session's tokens in `slot` and tells the tab which slot it now holds. */
export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, slot: string): void {
  const n = authCookieNames(res.req);
  res.cookie(slotCookie(n.access, slot), accessToken, { ...base(), path: '/', maxAge: env().ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(slotCookie(n.refresh, slot), refreshToken, { ...base(), path: REFRESH_COOKIE_PATH, maxAge: longLived() });
  res.cookie(n.hint, '1', { ...base(), httpOnly: false, path: '/', maxAge: longLived() });
  res.setHeader('X-Session-Slot', slot);
}

export function setAccessCookie(res: Response, accessToken: string): void {
  const slot = sessionSlot(res.req as CookieRequest);
  if (!slot) return;
  res.cookie(slotCookie(authCookieNames(res.req).access, slot), accessToken, { ...base(), path: '/', maxAge: env().ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.setHeader('X-Session-Slot', slot);
}

/** Expires one slot's cookies. */
export function clearSlotCookies(res: Response, slot: string): void {
  const n = authCookieNames(res.req);
  res.clearCookie(slotCookie(n.access, slot), { ...base(), path: '/' });
  res.clearCookie(slotCookie(n.refresh, slot), { ...base(), path: REFRESH_COOKIE_PATH });
}

/** Signs this request's slot out of the browser; other slots stay signed in. */
export function clearAuthCookies(res: Response): void {
  const req = res.req as CookieRequest;
  const slot = sessionSlot(req);
  if (!slot) return;
  clearSlotCookies(res, slot);
  const n = authCookieNames(req);
  const othersRemain = slot === MAIN_SLOT ? tabSlots(req).length > 0 : Boolean(req.cookies?.[n.access] || req.cookies?.[n.refresh]) || tabSlots(req).some((s) => s !== slot);
  if (!othersRemain) res.clearCookie(n.hint, { ...base(), httpOnly: false, path: '/' });
}

/** Signs every session of this app out of the browser (main and all tab slots). */
export function clearAllAuthCookies(res: Response): void {
  const req = res.req as CookieRequest;
  for (const slot of [MAIN_SLOT, ...tabSlots(req)]) clearSlotCookies(res, slot);
  res.clearCookie(authCookieNames(req).hint, { ...base(), httpOnly: false, path: '/' });
}

/** The access token of this request's slot. */
export function readAccessCookie(req: CookieRequest): string | undefined {
  const slot = sessionSlot(req);
  return slot ? req.cookies?.[slotCookie(authCookieNames(req).access, slot)] : undefined;
}

/** The refresh token of a slot (refresh cookies are only sent to the auth endpoints). */
export function readRefreshCookieOf(req: CookieRequest, slot: string): string | undefined {
  return req.cookies?.[slotCookie(authCookieNames(req).refresh, slot)];
}

/** The refresh token of this request's slot. */
export function readRefreshCookie(req: Request): string | undefined {
  const slot = sessionSlot(req as CookieRequest);
  return slot ? readRefreshCookieOf(req as CookieRequest, slot) : undefined;
}

/** True when the request carries any session cookie of either app (CSRF protection applies). */
export function hasAuthCookie(cookies: Record<string, string> | undefined): boolean {
  if (!cookies) return false;
  const prefixes = Object.values(AUTH_COOKIES).flatMap((n) => [n.access, n.refresh]);
  return Object.entries(cookies).some(([name, value]) => Boolean(value) && prefixes.some((p) => name === p || name.startsWith(`${p}_`)));
}
