import { micrositeRequest } from '@/lib/microsite-host';

/** robots.txt for a project microsite host (proxy.ts rewrites <host>/robots.txt here). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const site = await micrositeRequest(req, slug);
  if (!site) return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/'];
  // Only the canonical address advertises a sitemap; other mapped hosts point search engines at it via <link rel="canonical">.
  if (site.isCanonicalHost) lines.push(`Sitemap: ${new URL('/sitemap.xml', site.canonicalUrl).toString()}`);
  return new Response(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
