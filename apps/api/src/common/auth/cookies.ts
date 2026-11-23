import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';

/** The frontend a request came through. */
export type ClientApp = 'web' | 'console';

/**
 * Cookie names per frontend. The public website and the business console keep independent sessions —
 * signing in on one never replaces the session of the other, even when both share a host
 * (browsers do not separate cookies by port, so http://localhost:3200 and :3300 would otherwise collide).
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

export function authCookieNames(req: Pick<Request, 'headers'> | undefined) {
  return AUTH_COOKIES[clientApp(req)];
}

function base(): CookieOptions {
  return { httpOnly: true, secure: env().COOKIE_SECURE, sameSite: 'lax' };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const e = env();
  const n = authCookieNames(res.req);
  res.cookie(n.access, accessToken, { ...base(), path: '/', maxAge: e.ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(n.refresh, refreshToken, { ...base(), path: REFRESH_COOKIE_PATH, maxAge: e.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
  res.cookie(n.hint, '1', { ...base(), httpOnly: false, path: '/', maxAge: e.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
}

export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(authCookieNames(res.req).access, accessToken, { ...base(), path: '/', maxAge: env().ACCESS_TOKEN_TTL_SECONDS * 1000 });
}

export function clearAuthCookies(res: Response): void {
  const n = authCookieNames(res.req);
  res.clearCookie(n.access, { ...base(), path: '/' });
  res.clearCookie(n.refresh, { ...base(), path: REFRESH_COOKIE_PATH });
  res.clearCookie(n.hint, { ...base(), httpOnly: false, path: '/' });
}

/** The refresh token of the app the request came through. */
export function readRefreshCookie(req: Request): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[authCookieNames(req).refresh];
}

/** True when the request carries any session cookie of either app (CSRF protection applies). */
export function hasAuthCookie(cookies: Record<string, string> | undefined): boolean {
  if (!cookies) return false;
  return Object.values(AUTH_COOKIES).some((n) => Boolean(cookies[n.access] || cookies[n.refresh]));
}
