'use client';

import * as React from 'react';
import { Coins } from 'lucide-react';
import { enumLabel, formatDate, formatINR, type CommissionStatementTotals, type Paginated } from '@estate/shared';
import { Card, PageHeader, Pagination, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { StatusTabs } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface StatementRow {
  id: string;
  recipientType: string;
  recipientName: string;
  basisAmount: number;
  calcType: 'FIXED' | 'PERCENTAGE';
  rate: number;
  amount: number;
  amountPaid: number;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  rule: { name: string } | null;
  deal: { dealNo: string; dealType: string; bookingDate: string | null; project: { name: string } | null; property: { title: string } | null; unit: { code: string } | null };
  payoutItems: { payout: { payoutNo: string; status: string; paidOn: string | null } }[];
}

/** Commission statement for the signed-in user (own records) and their organisations. */
export function CommissionStatement({ title, description }: { title: string; description: string }) {
  const { values, set, page, setPage } = useListParams<{ status?: string }>();
  const q = useApi<Paginated<StatementRow> & { totals: CommissionStatementTotals }>('/commissions/statement', { status: values.status, page, pageSize: 20 });
  const t = q.data?.totals;
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Awaiting approval" value={t ? formatINR(t.PENDING_APPROVAL) : '—'} />
        <Stat label="Approved" value={t ? formatINR(t.APPROVED) : '—'} />
        <Stat label="Payable" value={t ? formatINR(t.PAYABLE) : '—'} tone={t && t.PAYABLE > 0 ? 'warning' : 'default'} />
        <Stat label="Paid to date" value={t ? formatINR(t.PAID) : '—'} tone="success" />
      </div>
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'PENDING_APPROVAL', label: 'Awaiting approval' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'PAYABLE', label: 'Payable' },
            { value: 'PAID', label: 'Paid' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
        />
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Coins />, title: 'No commission records', description: 'Commissions appear here once a deal you are part of is booked and the commission is calculated.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Deal</TH>
                    <TH className="hidden md:table-cell">Basis</TH>
                    <TH align="right">Commission</TH>
                    <TH>Status</TH>
                    <TH className="hidden lg:table-cell">Payout</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => {
                    const payout = r.payoutItems.find((i) => i.payout.status !== 'CANCELLED')?.payout;
                    return (
                      <TR key={r.id}>
                        <TD>
                          <div className="font-medium text-ink-900">{r.deal.project?.name ?? r.deal.property?.title ?? r.deal.dealNo}</div>
                          <div className="text-xs text-ink-500">
                            {r.deal.dealNo}
                            {r.deal.unit ? ` · Unit ${r.deal.unit.code}` : ''}
                            {r.deal.bookingDate ? ` · ${formatDate(r.deal.bookingDate)}` : ''}
                            {r.recipientType !== 'SALES_EMPLOYEE' ? ` · ${enumLabel(r.recipientType)}` : ''}
                          </div>
                        </TD>
                        <TD className="hidden text-xs text-ink-600 md:table-cell">
                          {r.calcType === 'PERCENTAGE' ? `${r.rate}% of ${formatINR(r.basisAmount)}` : 'Fixed amount'}
                          {r.rule ? <div className="text-ink-400">{r.rule.name}</div> : null}
                        </TD>
                        <TD align="right" className="tabular font-medium text-ink-900">
                          {formatINR(r.amount, { precise: true })}
                          {r.amountPaid > 0 && r.amountPaid < r.amount ? <div className="text-xs font-normal text-ink-500">Paid {formatINR(r.amountPaid)}</div> : null}
                        </TD>
                        <TD>
                          <StatusBadge status={r.status} />
                        </TD>
                        <TD className="hidden text-xs text-ink-500 lg:table-cell">{payout ? `${payout.payoutNo}${payout.paidOn ? ` · ${formatDate(payout.paidOn)}` : ''}` : '—'}</TD>
                      </TR>
                    );
                  })}
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
