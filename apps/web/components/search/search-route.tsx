import type { Metadata } from 'next';
import type { PropertySearchResult } from '@estate/shared';
import { apiGet, siteUrl } from '@/lib/api-server';
import { SearchView, searchQuery, searchTitle, type SearchParamsRecord } from './search-view';

export interface SearchRouteProps {
  params: Promise<{ city: string; locality?: string[] }>;
  searchParams: Promise<SearchParamsRecord>;
}

export async function searchMetadata(mode: 'buy' | 'rent', props: SearchRouteProps): Promise<Metadata> {
  const { city, locality } = await props.params;
  const searchParams = await props.searchParams;
  const ctx = { mode, citySlug: city, localitySlug: locality?.[0], searchParams };
  const result = await apiGet<PropertySearchResult>('/public/properties', { ...searchQuery(ctx), pageSize: '1' }, { revalidate: 60 });
  const title = searchTitle(ctx, result);
  const path = `/${mode}/${city}${locality?.[0] ? `/${locality[0]}` : ''}`;
  const filtered = Object.keys(searchParams).some((k) => k !== 'page');
  return {
    title,
    description: `${result.meta.total} ${result.meta.total === 1 ? 'listing' : 'listings'} — ${title.toLowerCase()}. Compare prices, photos and verified details, and enquire directly.`,
    alternates: { canonical: `${siteUrl()}${path}` },
    // Filter combinations are not indexed to avoid duplicate content; canonical pages are.
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export async function SearchRoute({ mode, props }: { mode: 'buy' | 'rent'; props: SearchRouteProps }) {
  const { city, locality } = await props.params;
  const searchParams = await props.searchParams;
  return <SearchView mode={mode} citySlug={city} localitySlug={locality?.[0]} searchParams={searchParams} />;
}
