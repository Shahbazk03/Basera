'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { formatDateTime, type ProjectStatus } from '@estate/shared';
import { cn } from '@estate/ui';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/**
 * Display-only countdown. The status itself always comes from the server (which derives it from the
 * booking window and live inventory); when a boundary passes we simply re-fetch the server page.
 * The clock is aligned to the server's time so a wrong device clock cannot change what is shown.
 */
export function BookingStatus({
  status,
  bookingOpensAt,
  bookingClosesAt,
  serverTime,
  tone = 'dark',
  className,
}: {
  status: ProjectStatus;
  bookingOpensAt: string | null;
  bookingClosesAt: string | null;
  serverTime: string;
  tone?: 'dark' | 'light';
  className?: string;
}) {
  const router = useRouter();
  const offset = React.useRef<number | null>(null);
  const [now, setNow] = React.useState<number | null>(null);
  const refreshed = React.useRef(false);

  React.useEffect(() => {
    offset.current = new Date(serverTime).getTime() - Date.now();
    const tick = () => setNow(Date.now() + (offset.current ?? 0));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [serverTime]);

  const target =
    (status === 'UPCOMING' || status === 'PRE_LAUNCH') && bookingOpensAt
      ? { at: new Date(bookingOpensAt).getTime(), label: 'Bookings open in', when: `Bookings open ${formatDateTime(bookingOpensAt)}` }
      : (status === 'BOOKING_OPEN' || status === 'CLOSING_SOON') && bookingClosesAt
        ? { at: new Date(bookingClosesAt).getTime(), label: 'Bookings close in', when: `Bookings close ${formatDateTime(bookingClosesAt)}` }
        : null;

  React.useEffect(() => {
    if (!target || now === null || refreshed.current) return;
    if (now >= target.at) {
      refreshed.current = true;
      const t = setTimeout(() => router.refresh(), 1500);
      return () => clearTimeout(t);
    }
  }, [now, target, router]);

  if (!target) return null;
  const remaining = now === null ? null : target.at - now;
  const p = remaining === null ? null : parts(remaining);
  const dark = tone === 'dark';
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', dark ? 'text-white/85' : 'text-ink-700', className)}>
      <span className="inline-flex items-center gap-1.5">
        <CalendarClock className="size-4" aria-hidden />
        {target.when}
      </span>
      {p && remaining !== null ? (
        remaining > 0 ? (
          <span className={cn('tabular rounded-md px-2 py-0.5 font-medium', dark ? 'bg-white/12 text-white' : 'bg-ink-100 text-ink-900')} aria-live="off">
            {target.label} {p.d > 0 ? `${p.d}d ` : ''}
            {String(p.h).padStart(2, '0')}h {String(p.m).padStart(2, '0')}m {p.d === 0 ? `${String(p.s).padStart(2, '0')}s` : ''}
          </span>
        ) : (
          <span className={cn('rounded-md px-2 py-0.5 font-medium', dark ? 'bg-white/12 text-white' : 'bg-ink-100 text-ink-900')}>Updating status…</span>
        )
      ) : null}
    </div>
  );
}
