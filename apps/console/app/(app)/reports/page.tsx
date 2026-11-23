'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatINR, formatPriceCompact } from '@estate/shared';
import { Alert, Button, Card, CardBody, CardHeader, Input, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { StatusTabs } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { BarList, Legend, ORDINAL_4, SegmentedBar } from '@/components/reports/charts';

interface LeadSourceRow {
  source: string;
  key: string;
  total: number;
  engaged: number;
  siteVisited: number;
  converted: number;
  lost: number;
  conversionRate: number;
}
interface ListingsReport {
  topListings: { id: string; title: string; referenceCode: string; status: string; viewCount: number; price: number; listingType: string; enquiries: number; locality: { name: string } | null; organization: { name: string } }[];
  liveByLocality: { locality: string; count: number }[];
  liveByType: { type: string; count: number }[];
}
interface ProjectRow {
  id: string;
  name: string;
  status: string;
  locality: string;
  units: number;
  available: number;
  held: number;
  booked: number;
  sold: number;
  bookings: number;
  bookingValue: number;
  customerMoneyReceived: number;
  enquiries: number;
}
interface TeamRow {
  userId: string;
  name: string;
  leadsAssigned: number;
  leadsContacted: number;
  siteVisitsCompleted: number;
  bookings: number;
  bookingValue: number;
  followUpsMissed: number;
}

const istToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const daysBefore = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);
const INVENTORY = [
  { key: 'available', label: 'Available', color: ORDINAL_4[0] },
  { key: 'held', label: 'Reserved / on hold', color: ORDINAL_4[1] },
  { key: 'booked', label: 'Booked', color: ORDINAL_4[2] },
  { key: 'sold', label: 'Sold', color: ORDINAL_4[3] },
] as const;

export default function ReportsPage() {
  const { values, set } = useListParams<{ tab?: string; from?: string; to?: string }>();
  const today = istToday();
  const to = values.to ?? today;
  const from = values.from ?? daysBefore(to, 89);
  const tab = values.tab ?? 'sources';
  const invalid = from > to;
  return (
    <>
      <PageHeader title="Reports" description="Figures come straight from your records for the period you choose — nothing is estimated." />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'Lead sources' },
            { value: 'listings', label: 'Listings' },
            { value: 'projects', label: 'Projects' },
            { value: 'team', label: 'Sales team' },
          ]}
          value={tab === 'sources' ? undefined : tab}
          onChange={(v) => set({ tab: v })}
        />
        {tab !== 'projects' ? (
          <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
            <label className="grid gap-1 text-xs font-medium text-ink-600">
              From
              <Input type="date" className="w-40" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-ink-600">
              To
              <Input type="date" className="w-40" value={to} min={from} max={today} onChange={(e) => e.target.value && set({ to: e.target.value })} />
            </label>
            {[30, 90, 365].map((n) => (
              <Button key={n} size="sm" variant="ghost" onClick={() => set({ from: daysBefore(today, n - 1), to: today })}>
                Last {n} days
              </Button>
            ))}
          </div>
        ) : null}
        {invalid ? (
          <Alert tone="warning" className="m-4">
            The start date must be before the end date.
          </Alert>
        ) : tab === 'listings' ? (
          <ListingsTab from={from} to={to} />
        ) : tab === 'projects' ? (
          <ProjectsTab />
        ) : tab === 'team' ? (
          <TeamTab from={from} to={to} />
        ) : (
          <SourcesTab from={from} to={to} />
        )}
      </Card>
    </>
  );
}

function SourcesTab({ from, to }: { from: string; to: string }) {
  const q = useApi<{ rows: LeadSourceRow[] }>('/reports/lead-sources', { from, to });
  return (
    <QueryState query={q} isEmpty={(d) => d.rows.length === 0} empty={{ title: 'No leads in this period', description: 'Leads created between these dates will be counted by source.' }}>
      {(d) => (
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink-900">New leads by source</h3>
            <BarList ariaLabel="New leads by source" items={d.rows.map((r) => ({ key: r.key, label: r.source, value: r.total }))} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Source</TH>
                  <TH align="right">Leads</TH>
                  <TH align="right">Engaged</TH>
                  <TH align="right">Site visit</TH>
                  <TH align="right">Converted</TH>
                  <TH align="right">Lost</TH>
                  <TH align="right">Conversion</TH>
                </tr>
              </THead>
              <TBody>
                {d.rows.map((r) => (
                  <TR key={r.key}>
                    <TD className="font-medium text-ink-900">{r.source}</TD>
                    <TD align="right" className="tabular">{r.total}</TD>
                    <TD align="right" className="tabular">{r.engaged}</TD>
                    <TD align="right" className="tabular">{r.siteVisited}</TD>
                    <TD align="right" className="tabular">{r.converted}</TD>
                    <TD align="right" className="tabular">{r.lost}</TD>
                    <TD align="right" className="tabular font-medium text-ink-900">{r.conversionRate}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-2 text-xs text-ink-500">Counts use each lead&apos;s current stage. Duplicates are excluded.</p>
          </div>
        </div>
      )}
    </QueryState>
  );
}

function ListingsTab({ from, to }: { from: string; to: string }) {
  const q = useApi<ListingsReport>('/reports/listings', { from, to });
  return (
    <QueryState query={q}>
      {(d) => (
        <div className="grid gap-6 p-5">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink-900">Live listings by locality (top 12)</h3>
              <BarList ariaLabel="Live listings by locality" items={d.liveByLocality.map((l) => ({ key: l.locality, label: l.locality, value: l.count }))} emptyText="No live listings." />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink-900">Live listings by type</h3>
              <BarList ariaLabel="Live listings by property type" items={d.liveByType.map((t) => ({ key: t.type, label: t.type, value: t.count }))} emptyText="No live listings." />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900">Most enquired listings in this period</h3>
            {d.topListings.length === 0 ? (
              <p className="text-sm text-ink-500">No listing enquiries between these dates.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Listing</TH>
                    <TH className="hidden md:table-cell">Listed by</TH>
                    <TH align="right">Enquiries</TH>
                    <TH align="right" className="hidden sm:table-cell">
                      Views (all time)
                    </TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.topListings.map((l) => (
                    <TR key={l.id}>
                      <TD>
                        <Link href={`/listings/${l.id}`} className="font-medium text-ink-900 hover:underline">
                          {l.title}
                        </Link>
                        <div className="text-xs text-ink-500">
                          {l.referenceCode}
                          {l.locality ? ` · ${l.locality.name}` : ''} · {formatPriceCompact(l.price)}
                        </div>
                      </TD>
                      <TD className="hidden text-sm text-ink-600 md:table-cell">{l.organization.name}</TD>
                      <TD align="right" className="tabular font-medium text-ink-900">{l.enquiries}</TD>
                      <TD align="right" className="tabular hidden sm:table-cell">{l.viewCount}</TD>
                      <TD>
                        <StatusBadge status={l.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </QueryState>
  );
}

function ProjectsTab() {
  const q = useApi<{ rows: ProjectRow[] }>('/reports/projects');
  return (
    <QueryState query={q} isEmpty={(d) => d.rows.length === 0} empty={{ title: 'No projects', description: 'Projects that have left draft appear here.' }}>
      {(d) => (
        <>
          <CardHeader title="Inventory and sales by project" description="Current position (not limited to a date range). Customer money is paid to the developer, not company revenue." actions={<Legend items={INVENTORY.map((i) => ({ label: i.label, color: i.color }))} />} />
          <Table>
            <THead>
              <tr>
                <TH>Project</TH>
                <TH className="w-[32%]">Units</TH>
                <TH align="right" className="hidden md:table-cell">
                  Bookings
                </TH>
                <TH align="right" className="hidden lg:table-cell">
                  Booking value
                </TH>
                <TH align="right" className="hidden lg:table-cell">
                  Customer money received
                </TH>
                <TH align="right" className="hidden sm:table-cell">
                  Enquiries
                </TH>
              </tr>
            </THead>
            <TBody>
              {d.rows.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/projects/${p.id}`} className="font-medium text-ink-900 hover:underline">
                      {p.name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-ink-500">
                      {p.locality} <StatusBadge status={p.status} size="sm" />
                    </div>
                  </TD>
                  <TD>
                    <SegmentedBar ariaLabel={`${p.name} units`} parts={INVENTORY.map((i) => ({ label: i.label, value: p[i.key], color: i.color }))} />
                    <div className="mt-1 text-xs text-ink-500">
                      {p.units} total · {p.available} available
                    </div>
                  </TD>
                  <TD align="right" className="tabular hidden md:table-cell">{p.bookings}</TD>
                  <TD align="right" className="tabular hidden lg:table-cell">{formatINR(p.bookingValue)}</TD>
                  <TD align="right" className="tabular hidden lg:table-cell">{formatINR(p.customerMoneyReceived)}</TD>
                  <TD align="right" className="tabular hidden sm:table-cell">{p.enquiries}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </QueryState>
  );
}

function TeamTab({ from, to }: { from: string; to: string }) {
  const q = useApi<{ rows: TeamRow[] }>('/reports/team', { from, to });
  return (
    <QueryState query={q} isEmpty={(d) => d.rows.length === 0} empty={{ title: 'No sales activity in this period' }}>
      {(d) => (
        <CardBody className="p-0">
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH align="right">Leads assigned</TH>
                <TH align="right" className="hidden sm:table-cell">
                  Contacted
                </TH>
                <TH align="right" className="hidden md:table-cell">
                  Site visits done
                </TH>
                <TH align="right">Bookings</TH>
                <TH align="right" className="hidden lg:table-cell">
                  Booking value
                </TH>
                <TH align="right" className="hidden md:table-cell">
                  Missed follow-ups
                </TH>
              </tr>
            </THead>
            <TBody>
              {d.rows.map((r) => (
                <TR key={r.userId}>
                  <TD className="font-medium text-ink-900">{r.name}</TD>
                  <TD align="right" className="tabular">{r.leadsAssigned}</TD>
                  <TD align="right" className="tabular hidden sm:table-cell">{r.leadsContacted}</TD>
                  <TD align="right" className="tabular hidden md:table-cell">{r.siteVisitsCompleted}</TD>
                  <TD align="right" className="tabular">{r.bookings}</TD>
                  <TD align="right" className="tabular hidden lg:table-cell">{formatINR(r.bookingValue)}</TD>
                  <TD align="right" className={`tabular hidden md:table-cell ${r.followUpsMissed ? 'font-medium text-danger' : ''}`}>
                    {r.followUpsMissed}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="border-t border-line px-4 py-3 text-xs text-ink-500">“Leads assigned” counts assignments made in the period; “Contacted” counts leads whose latest contact falls in the period.</p>
        </CardBody>
      )}
    </QueryState>
  );
}
