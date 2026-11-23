import Link from 'next/link';
import { ChevronRight, SearchX, X } from 'lucide-react';
import { enumLabel, formatNumber, type PropertySearchResult } from '@estate/shared';
import { EmptyState, Pagination } from '@estate/ui';
import { apiGet, siteUrl } from '@/lib/api-server';
import { PropertyRow } from '@/components/cards/property-card';
import { FiltersPanel, MobileFilters, SortSelect, type FilterOption } from './filters-panel';

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const FILTER_KEYS = ['type', 'locality', 'segment', 'minPrice', 'maxPrice', 'minArea', 'maxArea', 'bedrooms', 'bathrooms', 'furnishing', 'amenities', 'possession', 'verified', 'source', 'q', 'projectId', 'lat', 'lng', 'radiusKm'] as const;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export interface SearchContext {
  mode: 'buy' | 'rent';
  citySlug: string;
  localitySlug?: string;
  searchParams: SearchParamsRecord;
}

export function searchQuery({ mode, citySlug, localitySlug, searchParams }: SearchContext) {
  const query: Record<string, string | undefined> = { listingType: mode === 'rent' ? 'RENT' : 'SALE', city: citySlug };
  for (const k of FILTER_KEYS) query[k] = first(searchParams[k]);
  if (localitySlug) query.locality = localitySlug;
  query.sort = first(searchParams.sort);
  query.page = first(searchParams.page);
  query.pageSize = '20';
  return query;
}

export function searchTitle(ctx: SearchContext, result: Pick<PropertySearchResult, 'appliedCity' | 'facets'>, typeName?: string | null): string {
  const cityName = result.appliedCity?.name ?? ctx.citySlug;
  const localityName = ctx.localitySlug ? (result.facets.localities.find((l) => l.slug === ctx.localitySlug)?.name ?? enumLabel(ctx.localitySlug.replace(/-/g, '_'))) : null;
  const what = typeName ?? (first(ctx.searchParams.segment) === 'COMMERCIAL' ? 'Commercial property' : 'Property');
  return `${what} for ${ctx.mode === 'rent' ? 'rent' : 'sale'} in ${localityName ? `${localityName}, ` : ''}${cityName}`;
}

export async function SearchView(ctx: SearchContext) {
  const { mode, citySlug, localitySlug, searchParams } = ctx;
  const query = searchQuery(ctx);
  const [result, amenities] = await Promise.all([
    apiGet<PropertySearchResult>('/public/properties', query, { revalidate: 30 }),
    apiGet<FilterOption[]>('/public/amenities', { for: 'property' }, { revalidate: 600 }),
  ]);
  const types = (first(searchParams.type) ?? '').split(',').filter(Boolean);
  const typeName = types.length === 1 ? (result.facets.propertyTypes.find((t) => t.slug === types[0])?.name ?? null) : null;
  const title = searchTitle(ctx, result, typeName);
  const basePath = `/${mode}/${citySlug}${localitySlug ? `/${localitySlug}` : ''}`;
  const cityHref = `/${mode}/${citySlug}`;

  const activeChips: { key: string; label: string; href: string }[] = [];
  const paramString = (omit: string, value?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      const val = first(v);
      if (!val || k === 'page') continue;
      if (k === omit) {
        if (value) {
          const rest = val.split(',').filter((x) => x !== value);
          if (rest.length) p.set(k, rest.join(','));
        }
        continue;
      }
      p.set(k, val);
    }
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  for (const t of types) activeChips.push({ key: `type-${t}`, label: result.facets.propertyTypes.find((x) => x.slug === t)?.name ?? t, href: paramString('type', t) });
  for (const b of (first(searchParams.bedrooms) ?? '').split(',').filter(Boolean)) activeChips.push({ key: `bed-${b}`, label: `${b} BHK`, href: paramString('bedrooms', b) });
  for (const l of (first(searchParams.locality) ?? '').split(',').filter(Boolean)) activeChips.push({ key: `loc-${l}`, label: result.facets.localities.find((x) => x.slug === l)?.name ?? l, href: paramString('locality', l) });
  if (first(searchParams.minPrice) || first(searchParams.maxPrice)) activeChips.push({ key: 'price', label: 'Budget', href: paramString('minPrice').replace(/([?&])maxPrice=[^&]*/, '$1').replace(/[?&]$/, '') });
  if (first(searchParams.verified) === 'true') activeChips.push({ key: 'verified', label: 'Verified only', href: paramString('verified') });
  if (first(searchParams.segment)) activeChips.push({ key: 'segment', label: enumLabel(first(searchParams.segment)), href: paramString('segment') });
  for (const f of (first(searchParams.furnishing) ?? '').split(',').filter(Boolean)) activeChips.push({ key: `furn-${f}`, label: enumLabel(f), href: paramString('furnishing', f) });
  if (first(searchParams.possession)) activeChips.push({ key: 'possession', label: enumLabel(first(searchParams.possession)), href: paramString('possession') });
  if (first(searchParams.source)) activeChips.push({ key: 'source', label: `By ${enumLabel(first(searchParams.source)).toLowerCase()}`, href: paramString('source') });

  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (first(v) && k !== 'page') qs.set(k, first(v)!);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl() },
      { '@type': 'ListItem', position: 2, name: `${mode === 'rent' ? 'Rent' : 'Buy'} in ${result.appliedCity?.name ?? citySlug}`, item: `${siteUrl()}${cityHref}` },
      ...(localitySlug ? [{ '@type': 'ListItem', position: 3, name: title, item: `${siteUrl()}${basePath}` }] : []),
    ],
  };

  return (
    <div className="bg-canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c') }} />
      <div className="border-b border-line bg-surface">
        <div className="container-page py-6">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-ink-500">
            <Link href="/" className="hover:text-ink-900">
              Home
            </Link>
            <ChevronRight className="size-3.5" />
            <Link href={cityHref} className="hover:text-ink-900">
              {mode === 'rent' ? 'Rent' : 'Buy'} in {result.appliedCity?.name ?? citySlug}
            </Link>
            {localitySlug ? (
              <>
                <ChevronRight className="size-3.5" />
                <span className="text-ink-700">{result.facets.localities.find((l) => l.slug === localitySlug)?.name ?? localitySlug}</span>
              </>
            ) : null}
          </nav>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-bold leading-tight text-ink-900 md:text-[28px]">{title}</h1>
              <p className="mt-1 text-sm text-ink-500">
                {formatNumber(result.meta.total)} {result.meta.total === 1 ? 'listing' : 'listings'}
                {result.facets.priceRange.min != null && result.meta.total > 0 ? ` · priced from ${mode === 'rent' ? '₹' + formatNumber(result.facets.priceRange.min) + '/month' : '₹' + formatNumber(result.facets.priceRange.min)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-ink-100 p-1 text-[13px] font-medium">
                <Link href={`/buy/${citySlug}${localitySlug ? `/${localitySlug}` : ''}`} className={mode === 'buy' ? 'rounded-md bg-surface px-3 py-1 text-ink-900 shadow-card' : 'px-3 py-1 text-ink-600 hover:text-ink-900'}>
                  Buy
                </Link>
                <Link href={`/rent/${citySlug}${localitySlug ? `/${localitySlug}` : ''}`} className={mode === 'rent' ? 'rounded-md bg-surface px-3 py-1 text-ink-900 shadow-card' : 'px-3 py-1 text-ink-600 hover:text-ink-900'}>
                  Rent
                </Link>
              </div>
              <MobileFilters mode={mode} facets={result.facets} amenities={amenities.slice(0, 10)} onLocalityPage={Boolean(localitySlug)} cityHref={cityHref} activeCount={activeChips.length} />
              <SortSelect value={first(searchParams.sort) ?? 'relevance'} />
            </div>
          </div>
          {activeChips.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeChips.map((c) => (
                <Link key={c.key} href={c.href} scroll={false} aria-label={`Remove filter: ${c.label}`} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface py-1 pl-3 pr-2 text-[12.5px] font-medium text-ink-800 hover:border-ink-400">
                  {c.label}
                  <X className="size-3.5 text-ink-400" />
                </Link>
              ))}
              <Link href={basePath} className="text-[12.5px] font-medium text-brand-strong hover:underline">
                Clear all
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      <div className="container-page grid grid-cols-1 gap-8 py-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border border-line bg-surface p-5">
            <FiltersPanel mode={mode} facets={result.facets} amenities={amenities.slice(0, 10)} onLocalityPage={Boolean(localitySlug)} cityHref={cityHref} />
          </div>
        </aside>
        <section aria-label="Search results" className="min-w-0">
          {result.data.length ? (
            <ul className="flex flex-col gap-4">
              {result.data.map((p) => (
                <li key={p.id}>
                  <PropertyRow p={p} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-line bg-surface">
              <EmptyState
                icon={<SearchX />}
                title="No listings match these filters"
                description="Try widening the budget, removing a filter or searching the whole city."
                action={
                  <Link href={cityHref} className="text-sm font-semibold text-brand-strong hover:underline">
                    See all listings in {result.appliedCity?.name ?? 'the city'}
                  </Link>
                }
              />
            </div>
          )}
          {result.meta.totalPages > 1 ? (
            <div className="mt-8">
              <Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} hrefForPage={pageHref} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
