'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn, Input, Select } from '@estate/ui';
import { useDebounced } from '@/lib/hooks';

/** Debounced search box bound to a URL param. */
export function SearchBox({ value, onChange, placeholder = 'Search…', className }: { value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string; className?: string }) {
  const [text, setText] = React.useState(value ?? '');
  const debounced = useDebounced(text, 350);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if ((debounced || undefined) !== (value || undefined)) onChange(debounced || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  React.useEffect(() => setText(value ?? ''), [value]);
  return (
    <div className={cn('w-full sm:w-72', className)}>
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        leading={<Search />}
        trailing={
          text ? (
            <button type="button" className="pointer-events-auto text-ink-400 hover:text-ink-700" onClick={() => setText('')} aria-label="Clear search">
              <X />
            </button>
          ) : undefined
        }
        aria-label={placeholder}
      />
    </div>
  );
}

export function FilterSelect({ value, onChange, options, placeholder, className, label }: { value: string | undefined; onChange: (v: string | undefined) => void; options: { value: string; label: string }[]; placeholder: string; className?: string; label?: string }) {
  return (
    <div className={cn('w-full sm:w-48', className)}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label ?? placeholder}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center', className)}>{children}</div>;
}

/** Status tabs with counts, bound to a URL param. */
export function StatusTabs({ tabs, value, onChange, counts }: { tabs: { value: string | undefined; label: string }[]; value: string | undefined; onChange: (v: string | undefined) => void; counts?: Record<string, number> }) {
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  return (
    <div className="scrollbar-none -mb-px flex gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
      {tabs.map((t) => {
        const active = (t.value ?? '') === (value ?? '');
        const count = t.value ? counts?.[t.value] : total;
        return (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn('-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[13.5px] font-medium transition-colors', active ? 'border-brand text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900')}
          >
            {t.label}
            {count !== undefined ? <span className={cn('tabular rounded-full px-1.5 text-[11px]', active ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600')}>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
