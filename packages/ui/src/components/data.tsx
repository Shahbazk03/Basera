import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

// ───────────── Table primitives ─────────────

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    // `relative` contains absolutely positioned sr-only header text, which otherwise widens the page on phones.
    <div className={cn('relative w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-line bg-ink-50/70 text-[12px] font-medium uppercase tracking-wide text-ink-500">{children}</thead>;
}

export function TH({ className, children, align, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th scope="col" className={cn('whitespace-nowrap px-4 py-2.5 font-medium', align === 'right' && 'text-right', align === 'center' && 'text-center', className)} {...props}>
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({ className, onClick, children, selected }: { className?: string; onClick?: () => void; children: React.ReactNode; selected?: boolean }) {
  return (
    <tr onClick={onClick} className={cn('transition-colors', onClick && 'cursor-pointer hover:bg-ink-50/80', selected && 'bg-brand-soft/60', className)}>
      {children}
    </tr>
  );
}

export function TD({ className, children, align, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={cn('px-4 py-3 align-middle text-ink-700', align === 'right' && 'text-right', align === 'center' && 'text-center', className)} {...props}>
      {children}
    </td>
  );
}

// ───────────── Pagination ─────────────

export interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  hrefForPage?: (page: number) => string;
  className?: string;
}

function pageWindow(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function Pagination({ page, totalPages, total, pageSize, onPageChange, hrefForPage, className }: PaginationProps) {
  if (totalPages <= 1 && !total) return null;
  const item = (p: number, label: React.ReactNode, opts: { disabled?: boolean; active?: boolean; aria?: string } = {}) => {
    const cls = cn(
      'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] font-medium transition-colors',
      opts.active ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100',
      opts.disabled && 'pointer-events-none opacity-40',
    );
    if (hrefForPage && !opts.disabled) {
      return (
        <a key={`${p}-${String(label)}`} href={hrefForPage(p)} aria-label={opts.aria} aria-current={opts.active ? 'page' : undefined} className={cls}>
          {label}
        </a>
      );
    }
    return (
      <button key={`${p}-${String(label)}`} type="button" aria-label={opts.aria} aria-current={opts.active ? 'page' : undefined} disabled={opts.disabled} onClick={() => onPageChange?.(p)} className={cls}>
        {label}
      </button>
    );
  };
  const from = total !== undefined && pageSize ? (page - 1) * pageSize + 1 : null;
  const to = total !== undefined && pageSize ? Math.min(total, page * pageSize) : null;
  return (
    <nav aria-label="Pagination" className={cn('flex flex-col items-center justify-between gap-3 sm:flex-row', className)}>
      {total !== undefined ? (
        <p className="tabular text-[13px] text-ink-500">
          {total === 0 ? 'No results' : `Showing ${from?.toLocaleString('en-IN')}–${to?.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}
        </p>
      ) : (
        <span />
      )}
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          {item(page - 1, <ChevronLeft className="size-4" />, { disabled: page <= 1, aria: 'Previous page' })}
          {pageWindow(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-ink-400">
                …
              </span>
            ) : (
              item(p, p, { active: p === page, aria: `Page ${p}` })
            ),
          )}
          {item(page + 1, <ChevronRight className="size-4" />, { disabled: page >= totalPages, aria: 'Next page' })}
        </div>
      ) : null}
    </nav>
  );
}
