'use client';

import * as React from 'react';
import { Download, Info } from 'lucide-react';
import { formatINR, formatPriceCompact } from '@estate/shared';
import { buildQuery } from '@estate/api-client';
import { Alert, Button, Card, CardBody, CardHeader, Input, PageHeader, Stat, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import { BarList, GroupedColumns, SERIES_1, SERIES_2 } from '@/components/reports/charts';

interface MonthRow {
  month: string;
  revenueReceived: number;
  otherInflows: number;
  customerMoneyOnDeals: number;
  commissionsAccrued: number;
  commissionsPaid: number;
  expensesPaid: number;
  payrollCost: number;
  reimbursementsPaid: number;
  inflow: number;
  outflow: number;
  net: number;
}
interface Report {
  from: string;
  to: string;
  months: MonthRow[];
  totals: Omit<MonthRow, 'month'>;
  expensesByCategory: { category: string; total: number }[];
  snapshot: { invoicesOutstanding: number; commissionsOutstanding: number };
}

/** Current month in India time, plus the month `back` months earlier, as YYYY-MM. */
function defaultRange(back = 5) {
  const ist = new Date(Date.now() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const fmt = (d: Date) => d.toISOString().slice(0, 7);
  return { from: fmt(new Date(Date.UTC(y, m - back, 1))), to: fmt(new Date(Date.UTC(y, m, 1))) };
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

export default function FinanceReportsPage() {
  const def = React.useMemo(() => defaultRange(), []);
  const { values, set } = useListParams<{ from?: string; to?: string }>();
  const from = values.from ?? def.from;
  const to = values.to ?? def.to;
  const invalid = from > to;
  const q = useApi<Report>('/finance/reports/monthly', { from, to }, { enabled: !invalid });
  const exportHref = `/api/v1/finance/reports/monthly/export${buildQuery({ from, to })}`;
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        title="Finance reports"
        description="Month-by-month cash movement from the ledger. Revenue is money received against invoices — customer payments on deals go to the builder or owner and are shown separately."
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} aria-disabled={invalid}>
              <Download /> Export CSV
            </a>
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-ink-600">
          From
          <Input type="month" className="w-44" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-600">
          To
          <Input type="month" className="w-44" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>
        {[3, 6, 12].map((n) => (
          <Button key={n} size="sm" variant="ghost" onClick={() => set(defaultRange(n - 1))}>
            Last {n} months
          </Button>
        ))}
      </div>
      {invalid ? <Alert tone="warning">The start month must be before the end month.</Alert> : null}

      <QueryState query={q}>
        {(r) => (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Revenue received" value={formatINR(t!.revenueReceived)} hint="Invoice receipts" />
              <Stat label="Money in" value={formatINR(t!.inflow)} hint={t!.otherInflows ? `incl. ${formatINR(t!.otherInflows)} other inflows` : 'All ledger inflows'} />
              <Stat label="Money out" value={formatINR(t!.outflow)} hint="Payouts, salaries, expenses, claims" />
              <Stat label="Net cash" value={formatINR(t!.net)} tone={t!.net < 0 ? 'danger' : 'default'} />
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Money in and out by month" description="From recorded ledger transactions" />
                <CardBody>
                  <GroupedColumns
                    ariaLabel="Money in and money out by month"
                    series={[
                      { name: 'Money in', color: SERIES_1 },
                      { name: 'Money out', color: SERIES_2 },
                    ]}
                    data={r.months.map((m) => ({ key: m.month, label: monthLabel(m.month), values: [m.inflow, m.outflow] }))}
                    format={(n) => formatPriceCompact(n)}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Expenses by category" description="Approved and paid, by expense date" />
                <CardBody>
                  <BarList ariaLabel="Expenses by category" items={r.expensesByCategory.map((e) => ({ key: e.category, label: e.category, value: e.total }))} format={(n) => formatINR(n)} emptyText="No approved expenses in this period." />
                </CardBody>
              </Card>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Unpaid on issued invoices (today)" value={formatINR(r.snapshot.invoicesOutstanding)} tone={r.snapshot.invoicesOutstanding > 0 ? 'warning' : 'default'} />
              <Stat label="Commissions approved, not yet paid (today)" value={formatINR(r.snapshot.commissionsOutstanding)} />
              <Stat label="Customer money on deals" value={formatINR(t!.customerMoneyOnDeals)} hint="Not company revenue" />
            </div>
            <Card>
              <CardHeader title="Monthly breakdown" />
              <Table>
                <THead>
                  <tr>
                    <TH>Month</TH>
                    <TH align="right">Revenue</TH>
                    <TH align="right" className="hidden md:table-cell">
                      Other in
                    </TH>
                    <TH align="right" className="hidden lg:table-cell">
                      Commissions accrued
                    </TH>
                    <TH align="right" className="hidden md:table-cell">
                      Commissions paid
                    </TH>
                    <TH align="right" className="hidden md:table-cell">
                      Payroll
                    </TH>
                    <TH align="right" className="hidden lg:table-cell">
                      Expenses
                    </TH>
                    <TH align="right" className="hidden lg:table-cell">
                      Claims
                    </TH>
                    <TH align="right">Net cash</TH>
                  </tr>
                </THead>
                <TBody>
                  {[...r.months].reverse().map((m) => (
                    <TR key={m.month}>
                      <TD className="whitespace-nowrap font-medium text-ink-900">{monthLabel(m.month)}</TD>
                      <TD align="right" className="tabular">{formatINR(m.revenueReceived)}</TD>
                      <TD align="right" className="tabular hidden md:table-cell">{formatINR(m.otherInflows)}</TD>
                      <TD align="right" className="tabular hidden lg:table-cell">{formatINR(m.commissionsAccrued)}</TD>
                      <TD align="right" className="tabular hidden md:table-cell">{formatINR(m.commissionsPaid)}</TD>
                      <TD align="right" className="tabular hidden md:table-cell">{formatINR(m.payrollCost)}</TD>
                      <TD align="right" className="tabular hidden lg:table-cell">{formatINR(m.expensesPaid)}</TD>
                      <TD align="right" className="tabular hidden lg:table-cell">{formatINR(m.reimbursementsPaid)}</TD>
                      <TD align="right" className={`tabular font-medium ${m.net < 0 ? 'text-danger' : 'text-ink-900'}`}>
                        {formatINR(m.net)}
                      </TD>
                    </TR>
                  ))}
                  <TR className="bg-ink-50/60 font-semibold">
                    <TD>Total</TD>
                    <TD align="right" className="tabular">{formatINR(t!.revenueReceived)}</TD>
                    <TD align="right" className="tabular hidden md:table-cell">{formatINR(t!.otherInflows)}</TD>
                    <TD align="right" className="tabular hidden lg:table-cell">{formatINR(t!.commissionsAccrued)}</TD>
                    <TD align="right" className="tabular hidden md:table-cell">{formatINR(t!.commissionsPaid)}</TD>
                    <TD align="right" className="tabular hidden md:table-cell">{formatINR(t!.payrollCost)}</TD>
                    <TD align="right" className="tabular hidden lg:table-cell">{formatINR(t!.expensesPaid)}</TD>
                    <TD align="right" className="tabular hidden lg:table-cell">{formatINR(t!.reimbursementsPaid)}</TD>
                    <TD align="right" className={`tabular ${t!.net < 0 ? 'text-danger' : 'text-ink-900'}`}>
                      {formatINR(t!.net)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
              <p className="flex items-start gap-1.5 border-t border-line px-4 py-3 text-xs text-ink-500">
                <Info className="mt-px size-3.5 shrink-0" />
                Commissions accrued are recorded when a commission is created (by its month in India time); everything else is by the date money moved. Tax is not computed here — use your accountant’s books for statutory returns.
              </p>
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}
