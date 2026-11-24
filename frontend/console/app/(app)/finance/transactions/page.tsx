'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, ArrowDownLeft, ArrowUpRight, Download, Plus } from 'lucide-react';
import { enumLabel, formatDate, formatINR, MANUAL_TRANSACTION_TYPES, PAYMENT_METHODS, TRANSACTION_TYPES, type Paginated, localDateString } from '@estate/shared';
import { buildQuery, errorMessage } from '@estate/api-client';
import { Alert, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, Select, Stat, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface TxnRow {
  id: string;
  txnNo: string;
  type: string;
  direction: 'INFLOW' | 'OUTFLOW';
  amount: number;
  txnDate: string;
  method: string;
  referenceNo: string | null;
  counterparty: string | null;
  description: string | null;
  recordedBy: { fullName: string } | null;
  deal: { id: string; dealNo: string } | null;
  invoice: { id: string; invoiceNo: string } | null;
  expense: { id: string; description: string } | null;
  payout: { id: string; payoutNo: string } | null;
  reimbursement: { id: string; title: string } | null;
}

export default function TransactionsPage() {
  const { can } = useSession();
  const { values, set, page, setPage } = useListParams<{ type?: string; direction?: string; from?: string; to?: string; q?: string }>();
  const q = useApi<Paginated<TxnRow> & { totals: { inflow: number; outflow: number; net: number } }>('/finance/transactions', { ...values, page, pageSize: 25 });
  const [open, setOpen] = React.useState(false);
  const exportHref = `/api/v1/finance/transactions/export${buildQuery({ type: values.type, direction: values.direction, from: values.from, to: values.to })}`;
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        title="Transactions"
        description="The company ledger: money actually received or paid. Receipts, payouts, salaries and expense payments are recorded here automatically by their workflows."
        actions={
          <>
            <Button asChild variant="outline">
              <a href={exportHref}>
                <Download /> Export CSV
              </a>
            </Button>
            {can('finance.manage') ? (
              <Button onClick={() => setOpen(true)}>
                <Plus /> Record entry
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Money in (filtered)" value={t ? formatINR(t.inflow) : '—'} icon={<ArrowDownLeft />} />
        <Stat label="Money out (filtered)" value={t ? formatINR(t.outflow) : '—'} icon={<ArrowUpRight />} />
        <Stat label="Net" value={t ? formatINR(t.net) : '—'} tone={t && t.net < 0 ? 'danger' : 'default'} />
      </div>
      <Card>
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search number, party, reference" />
          <FilterSelect value={values.type} onChange={(v) => set({ type: v })} placeholder="All types" options={TRANSACTION_TYPES.map((x) => ({ value: x, label: enumLabel(x) }))} />
          <FilterSelect value={values.direction} onChange={(v) => set({ direction: v })} placeholder="In & out" options={[{ value: 'INFLOW', label: 'Money in' }, { value: 'OUTFLOW', label: 'Money out' }]} />
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" className="w-40" value={values.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
            <span className="text-ink-400">–</span>
            <Input type="date" aria-label="To date" className="w-40" value={values.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          </div>
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Activity />, title: 'No transactions', description: 'Nothing has been recorded for these filters.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Transaction</TH>
                    <TH className="hidden md:table-cell">Party</TH>
                    <TH className="hidden lg:table-cell">Linked to</TH>
                    <TH align="right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((t) => (
                    <TR key={t.id}>
                      <TD className="whitespace-nowrap text-ink-700">{formatDate(t.txnDate)}</TD>
                      <TD>
                        <div className="font-medium text-ink-900">{enumLabel(t.type)}</div>
                        <div className="text-xs text-ink-500">
                          {t.txnNo} · {enumLabel(t.method)}
                          {t.referenceNo ? ` · ${t.referenceNo}` : ''}
                        </div>
                        {t.description ? <div className="line-clamp-1 text-xs text-ink-500">{t.description}</div> : null}
                      </TD>
                      <TD className="hidden md:table-cell">{t.counterparty ?? '—'}</TD>
                      <TD className="hidden text-xs lg:table-cell">
                        {t.invoice ? (
                          <Link href={`/finance/invoices/${t.invoice.id}`} className="text-brand hover:underline">
                            {t.invoice.invoiceNo}
                          </Link>
                        ) : t.payout ? (
                          t.payout.payoutNo
                        ) : t.deal ? (
                          t.deal.dealNo
                        ) : t.reimbursement ? (
                          t.reimbursement.title
                        ) : t.expense ? (
                          t.expense.description
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD align="right" className={`tabular whitespace-nowrap font-medium ${t.direction === 'INFLOW' ? 'text-success' : 'text-ink-900'}`}>
                        {t.direction === 'INFLOW' ? '+' : '−'}
                        {formatINR(t.amount, { precise: true })}
                      </TD>
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
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <ManualEntry onDone={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function ManualEntry({ onDone }: { onDone: () => void }) {
  const [v, setV] = React.useState({ type: 'OTHER', direction: 'INFLOW', amount: '', txnDate: localDateString(new Date()), method: 'BANK_TRANSFER', referenceNo: '', counterparty: '', description: '' });
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation(
    () => api.post('/finance/transactions', { ...v, amount: Number(v.amount), referenceNo: v.referenceNo || null, counterparty: v.counterparty || null, description: v.description || null }),
    { success: 'Entry recorded', invalidate: ['/finance'], onSuccess: onDone, onError: (e) => setError(errorMessage(e)), silent: true },
  );
  return (
    <DialogContent title="Record a ledger entry" description="For money movements that have no other workflow. Invoice receipts, payouts, salaries and expenses are recorded from their own screens.">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="t-type" required>
          <Select id="t-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value, direction: e.target.value === 'REFUND' ? 'OUTFLOW' : v.direction })}>
            {MANUAL_TRANSACTION_TYPES.map((x) => (
              <option key={x} value={x}>
                {enumLabel(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Direction" htmlFor="t-dir" required>
          <Select id="t-dir" value={v.direction} disabled={v.type === 'REFUND'} onChange={(e) => setV({ ...v, direction: e.target.value })}>
            <option value="INFLOW">Money in</option>
            <option value="OUTFLOW">Money out</option>
          </Select>
        </Field>
        <Field label="Amount (₹)" htmlFor="t-amt" required>
          <Input id="t-amt" type="number" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Date" htmlFor="t-date" required>
          <Input id="t-date" type="date" value={v.txnDate} onChange={(e) => setV({ ...v, txnDate: e.target.value })} />
        </Field>
        <Field label="Method" htmlFor="t-method" required>
          <Select id="t-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {enumLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="t-ref">
          <Input id="t-ref" value={v.referenceNo} onChange={(e) => setV({ ...v, referenceNo: e.target.value })} />
        </Field>
        <Field label="Counterparty" htmlFor="t-cp" className="sm:col-span-2">
          <Input id="t-cp" value={v.counterparty} onChange={(e) => setV({ ...v, counterparty: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="t-desc" className="sm:col-span-2">
          <Textarea id="t-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={!(Number(v.amount) > 0)} onClick={() => (toast.dismiss(), save.mutate(undefined))}>
          Record entry
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
