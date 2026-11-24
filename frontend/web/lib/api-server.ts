import { notFound } from 'next/navigation';
import { ApiError, createApiClient, type Query } from '@estate/api-client';
import type { PublicSettings } from '@estate/shared';

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Server-side client for public endpoints (no user cookies are forwarded). */
const client = createApiClient({ baseUrl: API, getHeaders: () => ({ 'x-estate-internal': '1' }) });

/** GET a public endpoint with ISR caching; 404s become Next.js notFound(). */
export async function apiGet<T>(path: string, query?: Query, opts: { revalidate?: number | false; tags?: string[]; allowNotFound?: boolean } = {}): Promise<T> {
  try {
    return await client.get<T>(path, query, { next: { revalidate: opts.revalidate ?? 60, tags: opts.tags } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && !opts.allowNotFound) notFound();
    throw err;
  }
}

/** Like apiGet but returns null instead of throwing (optional page fragments). */
export async function apiGetOptional<T>(path: string, query?: Query, revalidate = 60): Promise<T | null> {
  try {
    return await client.get<T>(path, query, { next: { revalidate } });
  } catch {
    return null;
  }
}

const FALLBACK_SETTINGS: PublicSettings = {
  brand: { name: 'Basera', tagline: '', logoUrl: null, primaryColor: '#0f766e' },
  contact: { phone: '', whatsapp: '', email: '', address: '', hours: '' },
  company: { legalName: '', reraAgentNumber: '' },
  social: [],
  marketplace: { defaultCitySlug: 'lucknow' },
  seo: { defaultTitle: 'Property marketplace', defaultDescription: '', robotsAllowIndexing: false },
  environment: 'local',
  integrations: { maps: 'osm', captcha: false },
};

/** Admin-managed public settings (brand, contact, SEO). Cached for 5 minutes. */
export async function getSettings(): Promise<PublicSettings> {
  return (await apiGetOptional<PublicSettings>('/public/settings', undefined, 300)) ?? FALLBACK_SETTINGS;
}

export function siteUrl(): string {
  return (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3200').replace(/\/$/, '');
}
