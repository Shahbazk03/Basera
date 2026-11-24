'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarCheck, ChevronLeft, ChevronRight, MapPin, Phone } from 'lucide-react';
import { SITE_VISIT_STATUSES, enumLabel, localDateString, type Paginated } from '@estate/shared';
import { Button, Card, PageHeader, StatusBadge } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { UpdateVisitDialog } from '@/components/crm/dialogs';
import type { SiteVisit } from '@/components/crm/types';

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function SiteVisitsPage() {
  const { can } = useSession();
  const today = localDateString(new Date());
  const { values, set } = useListParams<{ from?: string; status?: string; assignee?: string }>();
  const from = values.from ?? today;
  const to = addDays(from, 6);
  const query = useApi<Paginated<SiteVisit> & { statusCounts: Record<string, number> }>('/crm/site-visits', { from, to, status: values.status, assignee: values.assignee, pageSize: 100 });
  const [visit, setVisit] = React.useState<SiteVisit | null>(null);

  const grouped = React.useMemo(() => {
    const m = new Map<string, SiteVisit[]>();
    for (const v of query.data?.data ?? []) {
      const day = localDateString(new Date(v.scheduledAt));
      m.set(day, [...(m.get(day) ?? []), v]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [query.data]);

  return (
    <>
      <PageHeader
        title="Site visits"
        description="A week-by-week agenda of customer site visits. Requested visits come from the website and need confirming."
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" aria-label="Previous week" onClick={() => set({ from: addDays(from, -7) })}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => set({ from: undefined })} disabled={from === today}>
              This week
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next week" onClick={() => set({ from: addDays(from, 7) })}>
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <Card>
        <Toolbar>
          <p className="text-sm font-medium text-ink-800 sm:mr-auto">
            {dayFmt.format(new Date(`${from}T12:00:00+05:30`))} – {dayFmt.format(new Date(`${to}T12:00:00+05:30`))}
          </p>
          <FilterSelect value={values.status} onChange={(v) => set({ status: v })} placeholder="Any status" options={SITE_VISIT_STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))} />
          <FilterSelect value={values.assignee} onChange={(v) => set({ assignee: v })} placeholder="Everyone" label="Assignee" options={[{ value: 'me', label: 'My visits' }]} />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <CalendarCheck />, title: 'No site visits this week', description: 'Schedule visits from a lead, or move to another week.' }}>
          {() => (
            <div className="divide-y divide-line">
              {grouped.map(([day, visits]) => (
                <section key={day} className="px-5 py-4">
                  <h2 className="mb-3 text-[13px] font-semibold text-ink-900">
                    {day === today ? 'Today · ' : ''}
                    {dayFmt.format(new Date(`${day}T12:00:00+05:30`))}
                  </h2>
                  <ul className="grid gap-2.5">
                    {visits.map((v) => (
                      <li key={v.id} className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3 sm:flex-row sm:items-center">
                        <div className="tabular w-20 shrink-0 text-sm font-semibold text-ink-900">{timeFmt.format(new Date(v.scheduledAt))}</div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink-900">
                            {v.lead ? (
                              <Link href={`/crm/leads/${v.lead.id}`} className="hover:underline">
                                {v.customer?.fullName ?? v.lead.name}
                              </Link>
                            ) : (
                              v.customer?.fullName
                            )}
                            <span className="ml-2 text-xs font-normal text-ink-500">{v.lead?.leadNo}</span>
                          </p>
                          <p className="flex items-center gap-1 truncate text-xs text-ink-500">
                            <MapPin className="size-3.5 shrink-0" />
                            {v.property?.title ?? v.project?.name ?? 'Property'}
                            {v.unit ? ` · unit ${v.unit.code}` : ''}
                            {v.meetingPoint ? ` · meet at ${v.meetingPoint}` : ''}
                          </p>
                          {v.outcome ? <p className="mt-1 text-xs text-ink-600">{v.outcome}</p> : null}
                        </div>
                        <div className="text-xs text-ink-500 sm:w-36">{v.assignedTo?.fullName ?? 'Unassigned'}</div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={v.status} size="sm" />
                          {v.customer?.phone ? (
                            <Button asChild size="xs" variant="ghost">
                              <a href={`tel:${v.customer.phone}`} aria-label={`Call ${v.customer.fullName}`}>
                                <Phone />
                              </a>
                            </Button>
                          ) : null}
                          {can('site_visit.manage') && v.status !== 'COMPLETED' ? (
                            <Button size="xs" variant="outline" onClick={() => setVisit(v)}>
                              Update
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </QueryState>
      </Card>
      <UpdateVisitDialog visit={visit} onOpenChange={(o) => !o && setVisit(null)} onDone={() => void query.refetch()} />
    </>
  );
}
