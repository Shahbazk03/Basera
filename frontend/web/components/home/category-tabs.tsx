'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { PropertyCard as PropertyCardData } from '@estate/shared';
import { cn } from '@estate/ui';
import { PropertyCard } from '@/components/cards/property-card';

export interface CategoryTab {
  key: string;
  label: string;
  title: string;
  subtitle: string | null;
  href: string;
  items: PropertyCardData[];
}

/** Residential plots / commercial spaces in one tabbed band (avoids repeating identical sections). */
export function CategoryTabs({ tabs }: { tabs: CategoryTab[] }) {
  const [active, setActive] = React.useState(() => [...tabs].sort((a, b) => Math.min(b.items.length, 4) - Math.min(a.items.length, 4))[0]?.key);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!tab) return null;
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-[26px] font-bold leading-tight text-ink-900 md:text-[30px]">{tab.title}</h2>
          {tab.subtitle ? <p className="mt-2 text-[15px] text-ink-500">{tab.subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-4">
          <div role="tablist" className="inline-flex rounded-lg bg-surface p-1 shadow-card ring-1 ring-line">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab.key}
                onClick={() => setActive(t.key)}
                className={cn('rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors', t.key === tab.key ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Link href={tab.href} className="hidden items-center gap-1.5 text-sm font-semibold text-brand-strong hover:underline sm:inline-flex">
            View all <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
      {tab.items.length ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {tab.items.map((p) => (
            <PropertyCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-500">No live listings in this category yet.</p>
      )}
    </div>
  );
}
