import { AreaUnit } from './enums';
import { ENUM_LABELS } from './enums';

const inrFull = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberIn = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** ₹45,00,000 */
export function formatINR(value: number | string | null | undefined, opts: { precise?: boolean } = {}): string {
  const n = toNumber(value);
  if (n === null) return '—';
  return opts.precise ? inrPrecise.format(n) : inrFull.format(n);
}

/** Compact Indian notation: ₹45 L, ₹1.25 Cr, ₹18,500 */
export function formatPriceCompact(value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return '—';
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, '');
  if (n >= 1e7) return `₹${trim(n / 1e7)} Cr`;
  if (n >= 1e5) return `₹${trim(n / 1e5)} L`;
  return inrFull.format(n);
}

export function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return 'Price on request';
  if (min != null && max != null && min !== max) return `${formatPriceCompact(min)} – ${formatPriceCompact(max)}`;
  return formatPriceCompact((min ?? max) as number);
}

export function formatNumber(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return n === null ? '—' : numberIn.format(n);
}

export function formatArea(value: number | string | null | undefined, unit: AreaUnit | string = 'SQFT'): string {
  const n = toNumber(value);
  if (n === null) return '—';
  return `${numberIn.format(n)} ${ENUM_LABELS[unit] ?? unit.toLowerCase()}`;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value) : value;
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = (d.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(d);
}

export function slugify(input: string, maxLength = 80): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Builds a wa.me click-to-chat link (no API involved). */
export function whatsappLink(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
