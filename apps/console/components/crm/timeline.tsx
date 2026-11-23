import * as React from 'react';
import { ArrowRightLeft, CalendarClock, Inbox, Info, Mail, MapPin, MessageCircle, MessageSquare, Phone, Reply, StickyNote, UserCheck, Users, type LucideIcon } from 'lucide-react';
import { formatDateTime } from '@estate/shared';
import { cn } from '@estate/ui';
import type { Activity } from './types';

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  CALL: { icon: Phone, tone: 'bg-info-soft text-info' },
  EMAIL: { icon: Mail, tone: 'bg-info-soft text-info' },
  WHATSAPP: { icon: MessageCircle, tone: 'bg-success-soft text-success' },
  SMS: { icon: MessageSquare, tone: 'bg-info-soft text-info' },
  NOTE: { icon: StickyNote, tone: 'bg-ink-100 text-ink-600' },
  MEETING: { icon: Users, tone: 'bg-brand-soft text-brand-strong' },
  SITE_VISIT: { icon: MapPin, tone: 'bg-brand-soft text-brand-strong' },
  STATUS_CHANGE: { icon: ArrowRightLeft, tone: 'bg-warning-soft text-warning' },
  ASSIGNMENT: { icon: UserCheck, tone: 'bg-brand-soft text-brand-strong' },
  FOLLOW_UP: { icon: CalendarClock, tone: 'bg-warning-soft text-warning' },
  ENQUIRY: { icon: Inbox, tone: 'bg-success-soft text-success' },
  CUSTOMER_RESPONSE: { icon: Reply, tone: 'bg-success-soft text-success' },
  SYSTEM: { icon: Info, tone: 'bg-ink-100 text-ink-500' },
};

function duration(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min${s ? ` ${s}s` : ''}` : `${s}s`;
}

/** Chronological activity feed for a lead (newest first). */
export function ActivityTimeline({ items }: { items: Activity[] }) {
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-ink-500">No activity yet.</p>;
  return (
    <ol className="relative px-5 py-4">
      {items.map((a, i) => {
        const meta = ICONS[a.type] ?? ICONS.SYSTEM;
        const Icon = meta.icon;
        return (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 ? <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-line" /> : null}
            <span className={cn('relative z-10 grid size-8 shrink-0 place-items-center rounded-full', meta.tone)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-ink-900">{a.summary}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {formatDateTime(a.occurredAt)}
                {a.performedBy ? ` · ${a.performedBy.fullName}` : ' · System'}
                {a.direction ? ` · ${a.direction.toLowerCase()}` : ''}
                {a.outcome ? ` · ${a.outcome}` : ''}
                {duration(a.durationSeconds) ? ` · ${duration(a.durationSeconds)}` : ''}
              </p>
              {a.details ? <p className="mt-1.5 whitespace-pre-line rounded-md bg-ink-50 px-3 py-2 text-[13px] text-ink-700">{a.details}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
