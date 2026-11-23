import type { MetadataRoute } from 'next';
import { getSettings, siteUrl } from '@/lib/api-server';

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const s = await getSettings();
  if (!s.seo.robotsAllowIndexing) {
    // Non-production environments (and production until enabled in settings) are never indexed.
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/login', '/register', '/api/', '/site/', '/domain-not-found'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
