'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, MapPin, Search, X } from 'lucide-react';
import { Button, cn, Popover, PopoverAnchor, PopoverContent, Select } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { useDebounced } from '@/lib/use-debounced';

type Mode = 'buy' | 'rent' | 'projects' | 'commercial';

interface Suggestion {
  type: 'city' | 'locality' | 'project';
  id: string;
  label: string;
  sublabel: string;
  slug: string;
  citySlug: string | null;
}

export interface HeroPropertyType {
  slug: string;
  name: string;
  segment: string;
}

const BUY_BUDGETS: [string, string, string][] = [
  ['', '2500000', 'Under ₹25 L'],
  ['2500000', '5000000', '₹25 L – ₹50 L'],
  ['5000000', '10000000', '₹50 L – ₹1 Cr'],
  ['10000000', '20000000', '₹1 Cr – ₹2 Cr'],
  ['20000000', '50000000', '₹2 Cr – ₹5 Cr'],
  ['50000000', '', 'Above ₹5 Cr'],
];
const RENT_BUDGETS: [string, string, string][] = [
  ['', '10000', 'Under ₹10,000'],
  ['10000', '20000', '₹10,000 – ₹20,000'],
  ['20000', '40000', '₹20,000 – ₹40,000'],
  ['40000', '100000', '₹40,000 – ₹1 L'],
  ['100000', '', 'Above ₹1 L'],
];

/** Location autocomplete (localities, cities, projects) with keyboard support. */
export function LocationAutocomplete({ citySlug, value, onSelect, onClear, placeholder, className }: { citySlug: string; value: Suggestion | null; onSelect: (s: Suggestion) => void; onClear: () => void; placeholder?: string; className?: string }) {
  const [text, setText] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [active, setActive] = React.useState(0);
  const debounced = useDebounced(text, 200);
  const listId = React.useId();

  React.useEffect(() => {
    if (!debounced.trim()) {
      setItems([]);
      return;
    }
    let cancelled = false;
    api
      .get<Suggestion[]>('/public/locations/suggest', { q: debounced.trim(), city: citySlug })
      .then((r) => {
        if (!cancelled) {
          setItems(r);
          setActive(0);
          setOpen(true);
        }
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [debounced, citySlug]);

  if (value) {
    return (
      <div className={cn('flex h-12 items-center gap-2 rounded-lg px-3', className)}>
        <MapPin className="size-4 shrink-0 text-brand" />
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-brand-soft py-1 pl-3 pr-1.5 text-sm font-medium text-ink-900">
          <span className="truncate">{value.label}</span>
          <button type="button" onClick={onClear} className="rounded-full p-0.5 text-ink-500 hover:bg-brand-muted hover:text-ink-900" aria-label={`Remove ${value.label}`}>
            <X className="size-3.5" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <Popover open={open && items.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative flex h-12 items-center gap-2 px-3', className)}>
          <MapPin className="size-4 shrink-0 text-ink-400" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => items.length && setOpen(true)}
            onKeyDown={(e) => {
              if (!items.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => (a + 1) % items.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a - 1 + items.length) % items.length);
              } else if (e.key === 'Enter' && open) {
                e.preventDefault();
                onSelect(items[active]);
                setText('');
                setOpen(false);
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={placeholder ?? 'Locality, landmark or project'}
            className="h-full w-full min-w-0 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Search location"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        <ul id={listId} role="listbox">
          {items.map((s, i) => (
            <li key={`${s.type}-${s.id}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onSelect(s);
                  setText('');
                  setOpen(false);
                }}
                className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', i === active ? 'bg-ink-100' : '')}
              >
                {s.type === 'project' ? <Building2 className="size-4 text-ink-400" /> : <MapPin className="size-4 text-ink-400" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{s.label}</span>
                  <span className="block truncate text-xs text-ink-500">{s.sublabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function HeroSearch({ citySlug, propertyTypes }: { citySlug: string; propertyTypes: HeroPropertyType[] }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>('buy');
  const [location, setLocation] = React.useState<Suggestion | null>(null);
  const [type, setType] = React.useState('');
  const [budget, setBudget] = React.useState('');

  const types = propertyTypes.filter((t) => (mode === 'commercial' ? t.segment === 'COMMERCIAL' : t.segment !== 'COMMERCIAL' || mode === 'rent'));
  const budgets = mode === 'rent' ? RENT_BUDGETS : BUY_BUDGETS;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (location?.type === 'project') {
      router.push(`/projects/${location.slug}`);
      return;
    }
    if (mode === 'projects') {
      const q = new URLSearchParams();
      if (location?.type === 'locality') q.set('locality', location.slug);
      router.push(`/projects${q.size ? `?${q}` : ''}`);
      return;
    }
    const city = location?.citySlug ?? citySlug;
    const base = `/${mode === 'rent' ? 'rent' : 'buy'}/${city}${location?.type === 'locality' ? `/${location.slug}` : ''}`;
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (mode === 'commercial') q.set('segment', 'COMMERCIAL');
    if (budget) {
      const [min, max] = budget.split('-');
      if (min) q.set('minPrice', min);
      if (max) q.set('maxPrice', max);
    }
    router.push(`${base}${q.size ? `?${q}` : ''}`);
  }

  const tabs: { value: Mode; label: string }[] = [
    { value: 'buy', label: 'Buy' },
    { value: 'rent', label: 'Rent' },
    { value: 'projects', label: 'New projects' },
    { value: 'commercial', label: 'Commercial' },
  ];

  return (
    <form onSubmit={submit} className="w-full max-w-4xl" role="search" aria-label="Search properties">
      <div role="tablist" className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={mode === t.value}
            onClick={() => {
              setMode(t.value);
              setBudget('');
              setType('');
            }}
            className={cn('rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors', mode === t.value ? 'bg-surface text-ink-900' : 'bg-white/10 text-white/85 hover:bg-white/20')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 rounded-b-xl rounded-tr-xl bg-surface p-2 shadow-overlay md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-0 md:divide-x md:divide-line">
        <LocationAutocomplete citySlug={citySlug} value={location} onSelect={setLocation} onClear={() => setLocation(null)} />
        {mode !== 'projects' ? (
          <div className="px-1 md:px-2">
            <Select aria-label="Property type" value={type} onChange={(e) => setType(e.target.value)} className="h-12 border-0 shadow-none hover:border-0 focus-visible:ring-0">
              <option value="">All property types</option>
              {types.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="hidden md:block" />
        )}
        {mode !== 'projects' ? (
          <div className="px-1 md:px-2">
            <Select aria-label="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} className="h-12 border-0 shadow-none hover:border-0 focus-visible:ring-0">
              <option value="">Any budget</option>
              {budgets.map(([min, max, label]) => (
                <option key={label} value={`${min}-${max}`}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="hidden md:block" />
        )}
        <div className="md:pl-2">
          <Button type="submit" size="xl" className="h-12 w-full px-7">
            <Search /> Search
          </Button>
        </div>
      </div>
    </form>
  );
}
