/**
 * Host classification shared by proxy.ts and the microsite routes.
 * "Marketplace" hosts serve the main website; any other host is looked up as a project microsite domain.
 *  • PLATFORM_MAIN_HOSTS (comma-separated), the root domain and www.<root>;
 *  • *.vercel.app — the platform's own deployment addresses (production and preview), never a customer domain.
 */
const ROOT = (process.env.PLATFORM_ROOT_DOMAIN ?? 'localhost').toLowerCase();
const MAIN_HOSTS = new Set(
  (process.env.PLATFORM_MAIN_HOSTS ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

export function isMarketplaceHost(host: string): boolean {
  return !host || MAIN_HOSTS.has(host) || host === ROOT || host === `www.${ROOT}` || host.endsWith('.vercel.app');
}

/** Lower-cased host without port or trailing dot. */
export function normalizeHost(raw: string | null | undefined): string {
  return (raw ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}
