import type { Metadata } from 'next';
import { apiGetOptional, siteUrl } from '@/lib/api-server';

export interface SeoOverride {
  path: string;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
}

/** Admin-managed SEO override for a website path (CMS → FAQs & SEO), or null. */
export function getSeoOverride(path: string): Promise<SeoOverride | null> {
  return apiGetOptional<SeoOverride | null>('/public/seo', { path }, 60);
}

/**
 * Builds page metadata: an SEO override for the path wins over the page's own values, which win over
 * the defaults passed in. A custom SEO title is used as-is (no brand suffix).
 */
export function buildMetadata(
  path: string,
  base: { title: string; description?: string | null; seoTitle?: string | null; canonicalUrl?: string | null; ogImageUrl?: string | null; noIndex?: boolean },
  override: SeoOverride | null,
): Metadata {
  const custom = override?.title || base.seoTitle;
  const description = override?.description || base.description || undefined;
  const image = override?.ogImageUrl || base.ogImageUrl || null;
  const noIndex = Boolean(override?.noIndex || base.noIndex);
  return {
    title: custom ? { absolute: custom } : base.title,
    description,
    alternates: { canonical: override?.canonicalUrl || base.canonicalUrl || `${siteUrl()}${path}` },
    openGraph: { title: custom || base.title, description, url: `${siteUrl()}${path}`, ...(image ? { images: [{ url: image }] } : {}) },
    ...(noIndex ? { robots: { index: false, follow: true } } : {}),
  };
}
