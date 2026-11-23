'use client';

import * as React from 'react';
import { enumLabel } from '@estate/shared';
import { cn, Tooltip } from '@estate/ui';
import { type AttendanceMonth, hoursOf, timeOf, WEEKDAYS } from './types';

const STATE_STYLE: Record<string, string> = {
  PRESENT: 'bg-success-soft text-success border-success/20',
  HALF_DAY: 'bg-warning-soft text-warning border-warning/25',
  ABSENT: 'bg-danger-soft text-danger border-danger/20',
  ON_LEAVE: 'bg-info-soft text-info border-info/20',
  HOLIDAY: 'bg-brand-soft text-brand-strong border-brand/20',
  WEEKLY_OFF: 'bg-ink-50 text-ink-400 border-line',
  NOT_MARKED: 'bg-surface text-danger border-danger/30 border-dashed',
  UPCOMING: 'bg-surface text-ink-400 border-line',
  NOT_EMPLOYED: 'bg-ink-50 text-ink-300 border-line',
};

const SHORT: Record<string, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Off',
  NOT_MARKED: 'Not marked',
  UPCOMING: '',
  NOT_EMPLOYED: '—',
};

/** Month grid of attendance states (self, manager and HR views). */
export function AttendanceCalendar({ data }: { data: AttendanceMonth }) {
  const firstDow = new Date(`${data.days[0].date}T00:00:00Z`).getUTCDay();
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-ink-400">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {data.days.map((d) => {
          const label = d.holiday ?? d.leave ?? SHORT[d.state] ?? enumLabel(d.state);
          const detail = d.record ? `${timeOf(d.record.checkInAt)} – ${timeOf(d.record.checkOutAt)} · ${hoursOf(d.record.workMinutes)}${d.record.isLate ? ' · late' : ''}${d.record.source !== 'WEB' && d.record.source !== 'SYSTEM' ? ` · ${enumLabel(d.record.source)}` : ''}` : label;
          return (
            <Tooltip key={d.date} content={`${d.date}: ${enumLabel(d.state)}${detail ? ` — ${detail}` : ''}`}>
              <div className={cn('flex min-h-11 flex-col rounded-md border px-1.5 py-1 text-left sm:min-h-[72px] sm:px-2', STATE_STYLE[d.state] ?? 'border-line')} aria-label={`${d.date}: ${label}`}>
                <span className="flex items-center justify-between text-[12px] font-semibold">
                  {Number(d.date.slice(8))}
                  {d.record?.isLate ? <span className="size-1.5 rounded-full bg-warning" aria-label="Late" /> : null}
                </span>
                <span className="mt-auto hidden truncate text-[11px] leading-tight sm:block">{label}</span>
                {d.record?.checkInAt ? <span className="hidden truncate text-[10.5px] opacity-75 sm:block">{timeOf(d.record.checkInAt)}</span> : null}
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-500">
        {(['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'NOT_MARKED'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm border', STATE_STYLE[s])} />
            {enumLabel(s)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AttendanceSummary({ data }: { data: AttendanceMonth }) {
  const items = [
    ['Present', data.summary.present],
    ['Half days', data.summary.halfDay],
    ['Absent', data.summary.absent],
    ['On leave', data.summary.onLeave],
    ['Not marked', data.summary.notMarked],
    ['Late arrivals', data.summary.late],
    ['Hours worked', data.summary.workHours],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-line px-3 py-2.5">
          <dt className="text-[11.5px] text-ink-500">{label}</dt>
          <dd className="tabular mt-0.5 text-lg font-semibold text-ink-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
