'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { enumLabel, PROJECT_TYPES } from '@estate/shared';
import { Button, Input, Select } from '@estate/ui';

const STATUS_OPTIONS = [
  ['BOOKING_OPEN', 'Booking open'],
  ['CLOSING_SOON', 'Closing soon'],
  ['UPCOMING', 'Upcoming'],
  ['PRE_LAUNCH', 'Pre-launch'],
  ['SOLD_OUT', 'Sold out'],
  ['COMPLETED', 'Completed'],
] as const;

const BUDGETS: { label: string; min?: number; max?: number }[] = [
  { label: 'Under ₹40 L', max: 4_000_000 },
  { label: '₹40 L – ₹75 L', min: 4_000_000, max: 7_500_000 },
  { label: '₹75 L – ₹1.5 Cr', min: 7_500_000, max: 15_000_000 },
  { label: 'Above ₹1.5 Cr', min: 15_000_000 },
];

/** URL-driven project filters (server renders the results). */
export function ProjectFilters({ localities }: { localities: { name: string; slug: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  React.useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const budgetIndex = BUDGETS.findIndex((b) => String(b.min ?? '') === (params.get('minPrice') ?? '') && String(b.max ?? '') === (params.get('maxPrice') ?? ''));
  const active = ['q', 'locality', 'projectType', 'status', 'minPrice', 'maxPrice'].some((k) => params.get(k));

  return (
    <div className="grid gap-3 rounded-xl border border-line bg-surface p-3 shadow-card md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: q.trim() || undefined });
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Project, locality or developer" leading={<Search />} aria-label="Search projects" />
      </form>
      <Select value={params.get('locality') ?? ''} onChange={(e) => set({ locality: e.target.value || undefined })} aria-label="Locality">
        <option value="">All localities</option>
        {localities.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </Select>
      <Select value={params.get('projectType') ?? ''} onChange={(e) => set({ projectType: e.target.value || undefined })} aria-label="Project type">
        <option value="">All project types</option>
        {PROJECT_TYPES.map((t) => (
          <option key={t} value={t}>
            {enumLabel(t)}
          </option>
        ))}
      </Select>
      <Select value={params.get('status') ?? ''} onChange={(e) => set({ status: e.target.value || undefined })} aria-label="Status">
        <option value="">Any status</option>
        {STATUS_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Select
        value={budgetIndex >= 0 ? String(budgetIndex) : ''}
        onChange={(e) => {
          const b = BUDGETS[Number(e.target.value)];
          set({ minPrice: b?.min ? String(b.min) : undefined, maxPrice: b?.max ? String(b.max) : undefined });
        }}
        aria-label="Budget"
      >
        <option value="">Any budget</option>
        {BUDGETS.map((b, i) => (
          <option key={b.label} value={i}>
            {b.label}
          </option>
        ))}
      </Select>
      {active ? (
        <Button variant="ghost" onClick={() => router.push(pathname, { scroll: false })}>
          <X /> Clear
        </Button>
      ) : (
        <span className="hidden md:block" />
      )}
    </div>
  );
}
