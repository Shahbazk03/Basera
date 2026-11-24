import type { MetadataRoute } from 'next';
import type { Paginated, ProjectCard, PropertyCard } from '@estate/shared';
import { apiGetOptional, getSettings, siteUrl } from '@/lib/api-server';

export const revalidate = 3600;

interface SitemapData {
  enabled: boolean;
  properties: { slug: string; updatedAt: string }[];
  projects: { slug: string; updatedAt: string }[];
  pages: { slug: string; updatedAt: string }[];
  localities?: { citySlug: string; slug: string }[];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const settings = await getSettings();
  const city = settings.marketplace.defaultCitySlug || 'lucknow';
  const now = new Date();

  // Preferred source: the CMS sitemap feed (published content only). The sitemap can be switched off in settings.
  const data = await apiGetOptional<SitemapData>('/public/sitemap-data', undefined, 3600);
  if (data && data.enabled === false) return [];

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/buy/${city}`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/rent/${city}`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/projects`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/sell`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/partners/register`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/faqs`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/contact`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const localityLinks = data?.localities ?? ((await apiGetOptional<{ slug: string; activeListings: number }[]>(`/public/cities/${city}/localities`, undefined, 3600)) ?? []).filter((x) => x.activeListings > 0).map((l) => ({ citySlug: city, slug: l.slug }));
  for (const l of localityLinks) {
    entries.push({ url: `${base}/buy/${l.citySlug}/${l.slug}`, changeFrequency: 'daily', priority: 0.7 });
  }

  if (data) {
    for (const p of data.properties) entries.push({ url: `${base}/property/${p.slug}`, lastModified: new Date(p.updatedAt), changeFrequency: 'weekly', priority: 0.6 });
    for (const p of data.projects) entries.push({ url: `${base}/projects/${p.slug}`, lastModified: new Date(p.updatedAt), changeFrequency: 'weekly', priority: 0.8 });
    for (const p of data.pages) entries.push({ url: `${base}/${p.slug}`, lastModified: new Date(p.updatedAt), changeFrequency: 'monthly', priority: 0.3 });
    return entries;
  }

  // Fallback: walk the public search endpoints.
  for (let page = 1; page <= 20; page += 1) {
    const res = await apiGetOptional<Paginated<PropertyCard>>('/public/properties', { city, pageSize: 48, page, sort: 'newest' }, 3600);
    if (!res?.data.length) break;
    for (const p of res.data) entries.push({ url: `${base}/property/${p.slug}`, changeFrequency: 'weekly', priority: 0.6 });
    if (page >= res.meta.totalPages) break;
  }
  const projects = await apiGetOptional<Paginated<ProjectCard> | ProjectCard[]>('/public/projects', { pageSize: 48 }, 3600);
  const list = Array.isArray(projects) ? projects : (projects?.data ?? []);
  for (const p of list) entries.push({ url: `${base}/projects/${p.slug}`, changeFrequency: 'weekly', priority: 0.8 });
  return entries;
}
