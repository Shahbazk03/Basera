'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SlidersHorizontal, X } from 'lucide-react';
import type { PropertySearchFacets } from '@estate/shared';
import { Button, CheckboxField, cn, Input, Select, Switch } from '@estate/ui';

export interface FilterOption {
  slug: string;
  name: string;
}

const BUY_PRICES = [1000000, 2500000, 5000000, 7500000, 10000000, 15000000, 20000000, 30000000, 50000000, 100000000];
const RENT_PRICES = [5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 200000];

function priceLabel(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toString().replace(/\.0+$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toString().replace(/\.0+$/, '')} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return React.useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      next.delete('page');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
}

function csvToggle(current: string | null, value: string): string | null {
  const set = new Set((current ?? '').split(',').filter(Boolean));
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return set.size ? [...set].join(',') : null;
}

function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn('border-b border-line py-5 first:pt-0 last:border-0', className)}>
      <legend className="mb-3 text-[13px] font-semibold text-ink-900">{title}</legend>
      {children}
    </fieldset>
  );
}

export function FiltersPanel({ mode, facets, amenities, onLocalityPage, cityHref }: { mode: 'buy' | 'rent'; facets: PropertySearchFacets; amenities: FilterOption[]; onLocalityPage: boolean; cityHref: string }) {
  const params = useSearchParams();
  const set = useParamSetter();
  const get = (k: string) => params.get(k);
  const prices = mode === 'rent' ? RENT_PRICES : BUY_PRICES;
  const [minArea, setMinArea] = React.useState(get('minArea') ?? '');
  const [maxArea, setMaxArea] = React.useState(get('maxArea') ?? '');
  React.useEffect(() => {
    setMinArea(get('minArea') ?? '');
    setMaxArea(get('maxArea') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const has = (k: string, v: string) => (get(k) ?? '').split(',').includes(v);

  return (
    <div className="text-sm">
      <Group title="Property type">
        <div className="flex flex-col gap-2.5">
          {facets.propertyTypes.length ? (
            facets.propertyTypes.map((t) => (
              <CheckboxField
                key={t.slug}
                checked={has('type', t.slug)}
                onCheckedChange={() => set({ type: csvToggle(get('type'), t.slug) })}
                label={
                  <span className="flex w-full items-center justify-between gap-3">
                    {t.name}
                    <span className="tabular text-xs text-ink-400">{t.count}</span>
                  </span>
                }
              />
            ))
          ) : (
            <p className="text-ink-500">No listings yet</p>
          )}
        </div>
      </Group>

      <Group title={mode === 'rent' ? 'Monthly rent' : 'Budget'}>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Minimum price" value={get('minPrice') ?? ''} onChange={(e) => set({ minPrice: e.target.value })}>
            <option value="">No min</option>
            {prices.map((p) => (
              <option key={p} value={p}>
                {priceLabel(p)}
              </option>
            ))}
          </Select>
          <Select aria-label="Maximum price" value={get('maxPrice') ?? ''} onChange={(e) => set({ maxPrice: e.target.value })}>
            <option value="">No max</option>
            {prices.map((p) => (
              <option key={p} value={p}>
                {priceLabel(p)}
              </option>
            ))}
          </Select>
        </div>
      </Group>

      <Group title="Bedrooms">
        <div className="flex flex-wrap gap-2">
          {['1', '2', '3', '4', '5+'].map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={has('bedrooms', b)}
              onClick={() => set({ bedrooms: csvToggle(get('bedrooms'), b) })}
              className={cn('h-9 min-w-12 rounded-full border px-3 text-[13px] font-medium transition-colors', has('bedrooms', b) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong text-ink-700 hover:border-ink-400')}
            >
              {b} BHK
            </button>
          ))}
        </div>
      </Group>

      {!onLocalityPage && facets.localities.length ? (
        <Group title="Locality">
          <div className="flex max-h-56 flex-col gap-2.5 overflow-y-auto pr-1">
            {facets.localities.map((l) => (
              <CheckboxField
                key={l.slug}
                checked={has('locality', l.slug)}
                onCheckedChange={() => set({ locality: csvToggle(get('locality'), l.slug) })}
                label={
                  <span className="flex w-full items-center justify-between gap-3">
                    {l.name}
                    <span className="tabular text-xs text-ink-400">{l.count}</span>
                  </span>
                }
              />
            ))}
          </div>
        </Group>
      ) : onLocalityPage ? (
        <Group title="Locality">
          <Link href={cityHref} className="text-[13px] font-medium text-brand-strong hover:underline">
            Show the whole city
          </Link>
        </Group>
      ) : null}

      <Group title="Area (sq.ft)">
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ minArea, maxArea });
          }}
        >
          <Input aria-label="Minimum area" inputMode="numeric" placeholder="Min" value={minArea} onChange={(e) => setMinArea(e.target.value.replace(/\D/g, ''))} onBlur={() => set({ minArea, maxArea })} />
          <Input aria-label="Maximum area" inputMode="numeric" placeholder="Max" value={maxArea} onChange={(e) => setMaxArea(e.target.value.replace(/\D/g, ''))} onBlur={() => set({ minArea, maxArea })} />
        </form>
      </Group>

      <Group title="Furnishing">
        <div className="flex flex-col gap-2.5">
          {[
            ['FULLY_FURNISHED', 'Fully furnished'],
            ['SEMI_FURNISHED', 'Semi furnished'],
            ['UNFURNISHED', 'Unfurnished'],
          ].map(([v, l]) => (
            <CheckboxField key={v} checked={has('furnishing', v)} onCheckedChange={() => set({ furnishing: csvToggle(get('furnishing'), v) })} label={l} />
          ))}
        </div>
      </Group>

      <Group title="Possession">
        <div className="flex flex-wrap gap-2">
          {[
            ['', 'Any'],
            ['READY_TO_MOVE', 'Ready to move'],
            ['UNDER_CONSTRUCTION', 'Under construction'],
          ].map(([v, l]) => (
            <button
              key={l}
              type="button"
              aria-pressed={(get('possession') ?? '') === v}
              onClick={() => set({ possession: v })}
              className={cn('h-8 rounded-full border px-3 text-[13px] font-medium transition-colors', (get('possession') ?? '') === v ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong text-ink-700 hover:border-ink-400')}
            >
              {l}
            </button>
          ))}
        </div>
      </Group>

      {amenities.length ? (
        <Group title="Amenities">
          <div className="flex flex-col gap-2.5">
            {amenities.map((a) => (
              <CheckboxField key={a.slug} checked={has('amenities', a.slug)} onCheckedChange={() => set({ amenities: csvToggle(get('amenities'), a.slug) })} label={a.name} />
            ))}
          </div>
        </Group>
      ) : null}

      <Group title="Listed by">
        <Select aria-label="Listed by" value={get('source') ?? ''} onChange={(e) => set({ source: e.target.value })}>
          <option value="">Anyone</option>
          <option value="OWNER">Owners</option>
          <option value="BROKER">Brokers</option>
          <option value="DEVELOPER">Developers</option>
          <option value="COMPANY">Listed by us</option>
        </Select>
        <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
          <span className="text-ink-800">Verified listings only</span>
          <Switch checked={get('verified') === 'true'} onCheckedChange={(v) => set({ verified: v ? 'true' : null })} aria-label="Verified listings only" />
        </label>
      </Group>
    </div>
  );
}

/** Mobile: filters in a full-height sheet. */
export function MobileFilters(props: React.ComponentProps<typeof FiltersPanel> & { activeCount: number }) {
  const [open, setOpen] = React.useState(false);
  const params = useSearchParams();
  React.useEffect(() => setOpen(false), [params]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal /> Filters{props.activeCount ? ` (${props.activeCount})` : ''}
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-950/40" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[90vw] max-w-sm flex-col bg-surface shadow-overlay">
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <DialogPrimitive.Title className="font-display text-base font-semibold text-ink-900">Filters</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Refine search results</DialogPrimitive.Description>
            <DialogPrimitive.Close className="rounded-md p-2 text-ink-500 hover:bg-ink-100" aria-label="Close filters">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <FiltersPanel {...props} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SortSelect({ value }: { value: string }) {
  const set = useParamSetter();
  return (
    <Select aria-label="Sort results" value={value} onChange={(e) => set({ sort: e.target.value === 'relevance' ? null : e.target.value })} className="h-9 w-44 text-[13px]">
      <option value="relevance">Most relevant</option>
      <option value="newest">Newest first</option>
      <option value="price_asc">Price: low to high</option>
      <option value="price_desc">Price: high to low</option>
      <option value="area_desc">Largest first</option>
    </Select>
  );
}
