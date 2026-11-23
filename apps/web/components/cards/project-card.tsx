import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, CalendarClock, MapPin } from 'lucide-react';
import { enumLabel, formatDate, formatPriceRange, type ProjectCard as Card } from '@estate/shared';
import { Badge, StatusBadge } from '@estate/ui';

const STATUS_COPY: Record<string, string> = {
  UPCOMING: 'Upcoming',
  PRE_LAUNCH: 'Pre-launch',
  BOOKING_OPEN: 'Booking open',
  CLOSING_SOON: 'Closing soon',
  SOLD_OUT: 'Sold out',
  CLOSED: 'Booking closed',
  COMPLETED: 'Completed',
};

export function bookingNote(p: Pick<Card, 'status' | 'bookingOpensAt' | 'bookingClosesAt'>): string | null {
  if ((p.status === 'UPCOMING' || p.status === 'PRE_LAUNCH') && p.bookingOpensAt) return `Bookings open ${formatDate(p.bookingOpensAt)}`;
  if ((p.status === 'BOOKING_OPEN' || p.status === 'CLOSING_SOON') && p.bookingClosesAt) return `Bookings close ${formatDate(p.bookingClosesAt)}`;
  return null;
}

export function ProjectCard({ p }: { p: Card }) {
  const note = bookingNote(p);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow duration-200 hover:shadow-raised">
      <div className="relative aspect-[16/10] overflow-hidden bg-ink-100">
        {p.heroImageUrl ? <Image src={p.heroImageUrl} alt={p.name} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : null}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <StatusBadge status={p.status} label={STATUS_COPY[p.status]} className="shadow-sm" />
          {p.isDemo ? <Badge tone="onImage" size="sm">Demo</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-[18px] font-semibold leading-snug text-ink-900">
          <Link href={`/projects/${p.slug}`} className="after:absolute after:inset-0">
            {p.name}
          </Link>
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-500">
          <MapPin className="size-3.5 shrink-0" /> {p.locality.name}, {p.city.name}
        </p>
        {p.developer ? (
          <p className="mt-1 text-[13px] text-ink-500">
            by <span className="font-medium text-ink-700">{p.developer.name}</span>
            {p.developer.isVerified ? <BadgeCheck className="ml-1 inline size-3.5 text-success" aria-label="Verified developer" /> : null}
          </p>
        ) : null}
        <p className="tabular mt-4 font-display text-[18px] font-bold text-ink-900">{formatPriceRange(p.priceMin, p.priceMax)}</p>
        {p.unitTypes.length ? <p className="mt-1 line-clamp-1 text-[13px] text-ink-600">{p.unitTypes.join(' · ')}</p> : <p className="mt-1 text-[13px] text-ink-500">{enumLabel(p.projectType)}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5 text-[12.5px] text-ink-500" style={{ marginTop: '1rem' }}>
          <span>{p.totalUnits > 0 ? `${p.availableUnits} of ${p.totalUnits} units available` : enumLabel(p.projectType)}</span>
          {note ? (
            <span className="inline-flex items-center gap-1 font-medium text-ink-700">
              <CalendarClock className="size-3.5" /> {note}
            </span>
          ) : p.possessionDate ? (
            <span>Possession {formatDate(p.possessionDate)}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
