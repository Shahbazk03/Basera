'use client';

import * as React from 'react';
import { cn } from '@estate/ui';

/**
 * Small, honest chart primitives (dataviz method):
 *  • single series → one validated hue (#2a78d6), no legend box (the title names it);
 *  • two series → validated categorical slots 1–2 (#2a78d6 / #eb6834) with a legend;
 *  • ordinal states → validated one-hue ramp (#86b6ef → #0d366b) with a legend;
 *  • thin marks (≤24px), 4px rounded data-end square at the baseline, 2px surface gaps;
 *  • every mark has a hover/focus tooltip; values are also printed or in a table view.
 * Text always uses ink tokens — never the series colour.
 */
export const SERIES_1 = '#2a78d6';
export const SERIES_2 = '#eb6834';
export const ORDINAL_4 = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'] as const;

// ───────────── Tooltip ─────────────

interface TipState {
  x: number;
  y: number;
  rows: { label: string; value: string; color?: string }[];
  title?: string;
}

function useTooltip() {
  const [tip, setTip] = React.useState<TipState | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const show = (e: React.PointerEvent | React.FocusEvent, data: Omit<TipState, 'x' | 'y'>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    let x: number;
    let y: number;
    if ('clientX' in e) {
      x = e.clientX - box.left;
      y = e.clientY - box.top;
    } else {
      const t = (e.target as HTMLElement).getBoundingClientRect();
      x = t.left - box.left + t.width / 2;
      y = t.top - box.top;
    }
    setTip({ ...data, x, y });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-36 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-raised"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.title ? <p className="mb-1 font-medium text-ink-500">{tip.title}</p> : null}
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 whitespace-nowrap">
          {r.color ? <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: r.color }} /> : null}
          <span className="tabular font-semibold text-ink-900">{r.value}</span>
          <span className="text-ink-500">{r.label}</span>
        </p>
      ))}
    </div>
  ) : null;
  return { ref, show, hide, node };
}

// ───────────── Bar list (single series, horizontal) ─────────────

export function BarList({
  items,
  format = (n) => n.toLocaleString('en-IN'),
  emptyText = 'No data for this period.',
  ariaLabel,
  onSelect,
}: {
  items: { key: string; label: string; value: number }[];
  format?: (n: number) => string;
  emptyText?: string;
  ariaLabel: string;
  onSelect?: (key: string) => void;
}) {
  const { ref, show, hide, node } = useTooltip();
  const max = Math.max(0, ...items.map((i) => i.value));
  if (!items.length || max === 0) return <p className="py-6 text-center text-sm text-ink-500">{emptyText}</p>;
  return (
    <div ref={ref} className="relative" role="list" aria-label={ariaLabel}>
      {items.map((it) => {
        const pct = max ? (it.value / max) * 100 : 0;
        return (
          <div
            key={it.key}
            role="listitem"
            tabIndex={0}
            aria-label={`${it.label}: ${format(it.value)}`}
            onPointerMove={(e) => show(e, { rows: [{ label: it.label, value: format(it.value) }] })}
            onPointerLeave={hide}
            onFocus={(e) => show(e, { rows: [{ label: it.label, value: format(it.value) }] })}
            onBlur={hide}
            onClick={onSelect ? () => onSelect(it.key) : undefined}
            className={cn('group grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 py-1.5 outline-none transition-colors hover:bg-ink-50 focus-visible:bg-ink-50', onSelect && 'cursor-pointer')}
          >
            <span className="truncate text-[13px] text-ink-700">{it.label}</span>
            <span className="relative h-2.5 w-full">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[filter] group-hover:brightness-110"
                style={{ width: `${Math.max(pct, it.value > 0 ? 1.5 : 0)}%`, background: SERIES_1 }}
              />
            </span>
            <span className="tabular min-w-10 text-right text-[13px] font-medium text-ink-900">{format(it.value)}</span>
          </div>
        );
      })}
      {node}
    </div>
  );
}

// ───────────── Grouped columns (two series over time) ─────────────

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(abs >= 1e8 ? 0 : 1).replace(/\.0$/, '')} Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(abs >= 1e6 ? 0 : 1).replace(/\.0$/, '')} L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export function GroupedColumns({
  data,
  series,
  format,
  height = 220,
  ariaLabel,
}: {
  data: { key: string; label: string; values: number[] }[];
  series: { name: string; color: string }[];
  format: (n: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const { ref, show, hide, node } = useTooltip();
  const max = niceMax(Math.max(0, ...data.flatMap((d) => d.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const allZero = data.every((d) => d.values.every((v) => v === 0));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4" aria-hidden>
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-ink-600">
            <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      {allZero ? (
        <p className="py-10 text-center text-sm text-ink-500">No money movement recorded in this period.</p>
      ) : (
        <div ref={ref} className="relative" role="img" aria-label={ariaLabel}>
          <div className="relative grid grid-cols-[3.25rem_minmax(0,1fr)]" style={{ height }}>
            <div className="relative">
              {ticks.map((t) => (
                <span key={t} className="tabular absolute right-2 -translate-y-1/2 text-[11px] text-ink-400" style={{ top: `${100 - (t / max) * 100}%` }}>
                  {compactNumber(t)}
                </span>
              ))}
            </div>
            <div className="relative border-b border-ink-200">
              {ticks.slice(1).map((t) => (
                <span key={t} aria-hidden className="absolute inset-x-0 h-px bg-ink-100" style={{ top: `${100 - (t / max) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-end justify-around gap-1 px-1">
                {data.map((d) => (
                  <div
                    key={d.key}
                    tabIndex={0}
                    aria-label={`${d.label}: ${series.map((s, i) => `${s.name} ${format(d.values[i])}`).join(', ')}`}
                    onPointerMove={(e) => show(e, { title: d.label, rows: series.map((s, i) => ({ label: s.name, value: format(d.values[i]), color: s.color })) })}
                    onPointerLeave={hide}
                    onFocus={(e) => show(e, { title: d.label, rows: series.map((s, i) => ({ label: s.name, value: format(d.values[i]), color: s.color })) })}
                    onBlur={hide}
                    className="group flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-md outline-none hover:bg-ink-50/70 focus-visible:bg-ink-50/70"
                  >
                    {d.values.map((v, i) => (
                      <span
                        key={series[i].name}
                        className="block w-full max-w-[18px] rounded-t-[4px] transition-[filter] group-hover:brightness-110"
                        style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: series[i].color }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-[3.25rem_minmax(0,1fr)]">
            <span />
            <div className="flex justify-around gap-1 px-1">
              {data.map((d) => (
                <span key={d.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-500">
                  {d.label}
                </span>
              ))}
            </div>
          </div>
          {node}
        </div>
      )}
    </div>
  );
}

// ───────────── Thin segmented bar (parts of one whole) ─────────────

export function SegmentedBar({ parts, ariaLabel }: { parts: { label: string; value: number; color: string }[]; ariaLabel: string }) {
  const { ref, show, hide, node } = useTooltip();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <span className="text-xs text-ink-400">No units</span>;
  return (
    <div ref={ref} className="relative flex h-2 w-full min-w-28 gap-[2px]" role="img" aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span
            key={p.label}
            tabIndex={0}
            onPointerMove={(e) => show(e, { rows: [{ label: p.label, value: `${p.value} (${Math.round((p.value / total) * 100)}%)`, color: p.color }] })}
            onPointerLeave={hide}
            onFocus={(e) => show(e, { rows: [{ label: p.label, value: `${p.value} (${Math.round((p.value / total) * 100)}%)`, color: p.color }] })}
            onBlur={hide}
            className="block h-full rounded-full outline-none transition-[filter] first:rounded-l-full last:rounded-r-full hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ink-300"
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
      {node}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-hidden>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-ink-600">
          <span className="size-2.5 rounded-[2px]" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
