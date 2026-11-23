import { NextResponse, type NextRequest } from 'next/server';
import { isMarketplaceHost, normalizeHost } from './lib/hosts';

/**
 * Host-based routing for project microsites.
 *  • Main marketplace hosts (PLATFORM_MAIN_HOSTS, the root domain, www.<root> and *.vercel.app — see lib/hosts.ts)
 *    are served normally.
 *  • Any other host is looked up via GET /api/v1/public/domains/resolve — only ACTIVE (verified)
 *    domains of published projects resolve — and rewritten to /site/<project-slug>/<path>.
 *  • Unknown hosts get a 404; arbitrary unverified domains are never served.
 */

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
// Shared assets and the API stay as they are on every host. robots.txt and sitemap.xml are NOT passed
// through: on a mapped host they are rewritten to the microsite's own (app/site/[slug]/robots.txt, sitemap.xml).
const PASS_THROUGH = /^\/(?:_next|api|uploads|images)(?:\/|$)|^\/(?:favicon\.ico|icon\.svg)$/;

const cache = new Map<string, { slug: string | null; expires: number }>();
const TTL_MS = 60_000;

async function resolve(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && hit.expires > Date.now()) return hit.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(`${API}/api/v1/public/domains/resolve?host=${encodeURIComponent(host)}`, { headers: { Accept: 'application/json', 'x-estate-internal': '1' }, cache: 'no-store' });
    if (res.ok) slug = ((await res.json()) as { projectSlug?: string }).projectSlug ?? null;
    else if (res.status !== 404) return hit?.slug ?? null; // API hiccup: keep the previous answer, do not cache
  } catch {
    return hit?.slug ?? null;
  }
  cache.set(host, { slug, expires: Date.now() + TTL_MS });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return slug;
}

export async function proxy(req: NextRequest) {
  const host = normalizeHost(req.headers.get('x-forwarded-host') ?? req.headers.get('host'));
  if (isMarketplaceHost(host)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (PASS_THROUGH.test(pathname)) return NextResponse.next();
  // /site/* is internal: on a mapped host it is treated like any other path (and 404s inside the microsite).

  const slug = await resolve(host);
  if (!slug) return NextResponse.rewrite(new URL('/domain-not-found', req.url));
  const url = req.nextUrl.clone();
  url.pathname = `/site/${slug}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  const res = NextResponse.rewrite(url);
  res.headers.set('x-microsite-host', host);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
