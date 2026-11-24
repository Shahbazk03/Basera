'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Handshake } from 'lucide-react';
import { formatDate, formatINR, formatPriceCompact, type Paginated } from '@estate/shared';
import { Card, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import type { DealRow } from '@/components/crm/types';

export default function DealsPage() {
  const router = useRouter();
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string }>();
  const query = useApi<Paginated<DealRow> & { statusCounts: Record<string, number>; statusValues: Record<string, number> }>('/crm/deals', { ...values, page, pageSize: 25 });
  const sv = query.data?.statusValues ?? {};
  const pipeline = (sv.OPEN ?? 0) + (sv.BOOKED ?? 0) + (sv.AGREEMENT_SIGNED ?? 0);

  return (
    <>
      <PageHeader
        title="Deals & bookings"
        description="Bookings recorded by the sales team. Deal value is the agreed price; payments are customer money received, tracked separately from company revenue."
        actions={
          query.data ? (
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-[12px] text-ink-500">Open pipeline</p>
                <p className="tabular font-display text-lg font-semibold text-ink-900">{formatPriceCompact(pipeline)}</p>
              </div>
              <div>
                <p className="text-[12px] text-ink-500">Closed won</p>
                <p className="tabular font-display text-lg font-semibold text-success">{formatPriceCompact(sv.CLOSED_WON ?? 0)}</p>
              </div>
            </div>
          ) : null
        }
      />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'OPEN', label: 'Open' },
            { value: 'BOOKED', label: 'Booked' },
            { value: 'AGREEMENT_SIGNED', label: 'Agreement signed' },
            { value: 'CLOSED_WON', label: 'Closed won' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
          counts={query.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Deal no., lead no. or customer" />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Handshake />, title: 'No deals yet', description: 'Record a deal from a lead once the customer books.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Deal</TH>
                    <TH>Customer</TH>
                    <TH className="hidden md:table-cell">Property</TH>
                    <TH align="right">Deal value</TH>
                    <TH align="right" className="hidden lg:table-cell">
                      Received
                    </TH>
                    <TH>Status</TH>
                    <TH className="hidden xl:table-cell">Sales</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => (
                    <TR key={r.id} onClick={() => router.push(`/crm/deals/${r.id}`)}>
                      <TD>
                        <Link href={`/crm/deals/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                          {r.dealNo}
                        </Link>
                        <div className="text-xs text-ink-500">{r.bookingDate ? `Booked ${formatDate(r.bookingDate)}` : 'Not booked yet'}</div>
                      </TD>
                      <TD>{r.customer.fullName}</TD>
                      <TD className="hidden max-w-64 truncate md:table-cell">{r.property ? r.property.title : r.project ? `${r.project.name}${r.unit ? ` · ${r.unit.code}` : ''}` : '—'}</TD>
                      <TD align="right" className="tabular font-medium text-ink-900">
                        {formatINR(r.dealValue)}
                      </TD>
                      <TD align="right" className="tabular hidden text-ink-600 lg:table-cell">
                        {formatINR(r.amountReceived)}
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="hidden xl:table-cell">{r.salesUser?.fullName ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="border-t border-line px-4 py-3">
                <Pagination page={page} totalPages={d.meta.totalPages} total={d.meta.total} pageSize={d.meta.pageSize} onPageChange={setPage} />
              </div>
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
