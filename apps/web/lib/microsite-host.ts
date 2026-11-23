/**
 * Server-side helpers for requests that proxy.ts rewrote from a mapped project host
 * (platform subdomain or verified custom domain) to /site/<slug>/….
 */

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const ROOT = (process.env.PLATFORM_ROOT_DOMAIN ?? 'localhost').toLowerCase();
const MAIN_HOSTS = new Set(
  (process.env.PLATFORM_MAIN_HOSTS ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

export function isMarketplaceHost(host: string): boolean {
  return !host || MAIN_HOSTS.has(host) || host === ROOT || host === `www.${ROOT}`;
}

export function requestHost(headers: Headers): string {
  return (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export interface MicrositeRequest {
  host: string;
  /** The project's canonical URL (primary domain, or the marketplace page when no primary domain is set). */
  canonicalUrl: string;
  /** True when this host is the address search engines should index. */
  isCanonicalHost: boolean;
}

/**
 * Confirms that the request host is an ACTIVE domain mapped to exactly this project (same rule as the
 * microsite page) and returns its canonical address. Returns null for marketplace hosts, unknown or
 * unverified hosts, and hosts mapped to another project.
 */
export async function micrositeRequest(req: Request, slug: string): Promise<MicrositeRequest | null> {
  const host = requestHost(req.headers);
  if (isMarketplaceHost(host)) return null;
  try {
    const mapped = await fetch(`${API}/api/v1/public/domains/resolve?host=${encodeURIComponent(host)}`, { headers: { Accept: 'application/json' }, next: { revalidate: 30 } });
    if (!mapped.ok) return null;
    const { projectSlug } = (await mapped.json()) as { projectSlug?: string };
    if (projectSlug !== slug) return null;
    const project = await fetch(`${API}/api/v1/public/projects/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' }, next: { revalidate: 30 } });
    if (!project.ok) return null;
    const { canonicalUrl } = (await project.json()) as { canonicalUrl: string };
    return { host, canonicalUrl, isCanonicalHost: new URL(canonicalUrl).hostname === host };
  } catch {
    return null;
  }
}
