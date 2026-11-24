'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Ban, ChevronLeft, Pencil, Printer, Send, Wallet } from 'lucide-react';
import { enumLabel, formatDate, formatINR, PAYMENT_METHODS, localDateString } from '@estate/shared';
import { Alert, Button, Card, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { InvoiceForm } from '@/components/finance/invoice-form';

interface InvoiceDetail {
  id: string;
  invoiceNo: string;
  billToName: string;
  billToAddress: string | null;
  billToGstin: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  outstanding: number;
  notes: string | null;
  createdAt: string;
  lines: { id: string; description: string; quantity: number; unitPrice: number; taxRate: number; amount: number; taxAmount: number }[];
  transactions: { id: string; txnNo: string; txnDate: string; amount: number; method: string; referenceNo: string | null }[];
  organization: { name: string; legalName: string | null; addressLine: string | null; gstin: string | null; email: string | null; phone: string | null; city: { name: string } | null; pincode: string | null };
  deal: { id: string; dealNo: string } | null;
  createdBy: { fullName: string } | null;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useApi<InvoiceDetail>(`/finance/invoices/${id}`);
  const inv = q.data;
  const manage = can('finance.manage');
  const [editing, setEditing] = React.useState(false);
  const [paying, setPaying] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [pay, setPay] = React.useState({ amount: '', txnDate: localDateString(new Date()), method: 'BANK_TRANSFER', referenceNo: '' });
  const [reason, setReason] = React.useState('');
  const issue = useApiMutation(() => api.post(`/finance/invoices/${id}/issue`), { success: 'Invoice issued', invalidate: ['/finance'] });
  const recordPayment = useApiMutation(() => api.post(`/finance/invoices/${id}/payments`, { ...pay, amount: Number(pay.amount), referenceNo: pay.referenceNo || null }), {
    success: 'Payment recorded',
    invalidate: ['/finance'],
    onSuccess: () => setPaying(false),
  });
  const cancel = useApiMutation(() => api.post(`/finance/invoices/${id}/cancel`, { reason }), { success: 'Invoice cancelled', invalidate: ['/finance'], onSuccess: () => setCancelling(false) });

  if (q.isLoading) return <Skeleton className="h-[600px] w-full" />;
  if (!inv) return <EmptyState title="Invoice not found" action={<Button asChild variant="outline"><Link href="/finance/invoices">Back to invoices</Link></Button>} />;
  const issuer = inv.organization;

  return (
    <>
      <style>{`@media print { aside, header, .no-print { display: none !important; } main { padding: 0 !important; } body { background: #fff !important; } .print-sheet { box-shadow: none !important; border: none !important; } }`}</style>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/finance/invoices" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <ChevronLeft className="size-4" /> Invoices
        </Link>
        <div className="flex flex-wrap gap-2">
          {manage && inv.status === 'DRAFT' ? (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button loading={issue.isPending} onClick={() => issue.mutate(undefined)}>
                <Send /> Issue invoice
              </Button>
            </>
          ) : null}
          {manage && ['ISSUED', 'PARTIALLY_PAID'].includes(inv.status) ? (
            <Button
              onClick={() => {
                setPay({ ...pay, amount: String(inv.outstanding) });
                setPaying(true);
              }}
            >
              <Wallet /> Record payment
            </Button>
          ) : null}
          {manage && ['DRAFT', 'ISSUED'].includes(inv.status) && inv.amountPaid === 0 ? (
            <Button variant="destructive-outline" onClick={() => setCancelling(true)}>
              <Ban /> Cancel
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => window.print()} disabled={inv.status === 'DRAFT'} title={inv.status === 'DRAFT' ? 'Issue the invoice before printing' : undefined}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      {inv.status === 'DRAFT' ? (
        <Alert tone="info" className="no-print mb-5">
          Draft — the invoice number is assigned when you issue it. Drafts can be edited.
        </Alert>
      ) : null}

      <Card className="print-sheet mx-auto max-w-4xl p-8 sm:p-12">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-display text-xl font-bold text-ink-900">{issuer.legalName ?? issuer.name}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-600">{[issuer.addressLine, [issuer.city?.name, issuer.pincode].filter(Boolean).join(' ')].filter(Boolean).join('\n')}</p>
            {issuer.gstin ? <p className="text-sm text-ink-600">GSTIN {issuer.gstin}</p> : null}
            {issuer.email || issuer.phone ? <p className="text-sm text-ink-600">{[issuer.email, issuer.phone].filter(Boolean).join(' · ')}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">{inv.status === 'DRAFT' ? 'Draft invoice' : 'Tax invoice'}</p>
            <p className="tabular mt-1 font-display text-2xl font-semibold text-ink-900">{inv.status === 'DRAFT' ? '—' : inv.invoiceNo}</p>
            <div className="mt-2 flex justify-end">
              <StatusBadge status={inv.status} />
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-500">Bill to</p>
            <p className="mt-1.5 font-medium text-ink-900">{inv.billToName}</p>
            {inv.billToAddress ? <p className="whitespace-pre-line text-sm text-ink-600">{inv.billToAddress}</p> : null}
            {inv.billToGstin ? <p className="text-sm text-ink-600">GSTIN {inv.billToGstin}</p> : null}
          </div>
          <div className="text-sm sm:text-right">
            <p>
              <span className="text-ink-500">Issue date: </span>
              {formatDate(inv.issueDate)}
            </p>
            {inv.dueDate ? (
              <p>
                <span className="text-ink-500">Due date: </span>
                {formatDate(inv.dueDate)}
              </p>
            ) : null}
            {inv.deal ? (
              <p>
                <span className="text-ink-500">Reference: </span>
                {inv.deal.dealNo}
              </p>
            ) : null}
          </div>
        </div>

        <table className="mt-10 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink-900 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              <th className="py-2 text-right font-medium">Tax</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-line align-top">
                <td className="py-3 pr-4 text-ink-900">{l.description}</td>
                <td className="tabular py-3 text-right">{Number(l.quantity)}</td>
                <td className="tabular py-3 text-right">{formatINR(l.unitPrice, { precise: true })}</td>
                <td className="tabular py-3 text-right text-ink-600">
                  {Number(l.taxRate)}%<div className="text-xs">{formatINR(l.taxAmount, { precise: true })}</div>
                </td>
                <td className="tabular py-3 text-right font-medium text-ink-900">{formatINR(l.amount, { precise: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-6 grid w-full max-w-xs gap-1.5 text-sm">
          <div className="flex justify-between text-ink-600">
            <span>Subtotal</span>
            <span className="tabular">{formatINR(inv.subtotal, { precise: true })}</span>
          </div>
          <div className="flex justify-between text-ink-600">
            <span>Tax</span>
            <span className="tabular">{formatINR(inv.taxTotal, { precise: true })}</span>
          </div>
          <div className="flex justify-between border-t border-ink-900 pt-2 text-base font-semibold text-ink-900">
            <span>Total</span>
            <span className="tabular">{formatINR(inv.total, { precise: true })}</span>
          </div>
          {inv.amountPaid > 0 ? (
            <>
              <div className="flex justify-between text-ink-600">
                <span>Received</span>
                <span className="tabular">− {formatINR(inv.amountPaid, { precise: true })}</span>
              </div>
              <div className="flex justify-between font-semibold text-ink-900">
                <span>Balance due</span>
                <span className="tabular">{formatINR(inv.outstanding, { precise: true })}</span>
              </div>
            </>
          ) : null}
        </div>

        {inv.notes ? (
          <div className="mt-10 border-t border-line pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-500">Notes</p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{inv.notes}</p>
          </div>
        ) : null}

        {inv.transactions.length ? (
          <div className="mt-8 border-t border-line pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-500">Payments received</p>
            <ul className="mt-2 space-y-1 text-sm">
              {inv.transactions.map((t) => (
                <li key={t.id} className="flex justify-between gap-4">
                  <span className="text-ink-700">
                    {formatDate(t.txnDate)} · {enumLabel(t.method)}
                    {t.referenceNo ? ` · ${t.referenceNo}` : ''} <span className="text-ink-400">({t.txnNo})</span>
                  </span>
                  <span className="tabular">{formatINR(t.amount, { precise: true })}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        {editing ? (
          <InvoiceForm
            invoice={inv}
            onDone={() => {
              setEditing(false);
              void q.refetch();
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent title="Record payment received" description={`Outstanding: ${formatINR(inv.outstanding, { precise: true })}. Overpayments are refused.`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)" htmlFor="p-amt" required>
              <Input id="p-amt" type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </Field>
            <Field label="Received on" htmlFor="p-date" required>
              <Input id="p-date" type="date" value={pay.txnDate} onChange={(e) => setPay({ ...pay, txnDate: e.target.value })} />
            </Field>
            <Field label="Method" htmlFor="p-method" required>
              <Select id="p-method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {enumLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="p-ref">
              <Input id="p-ref" value={pay.referenceNo} onChange={(e) => setPay({ ...pay, referenceNo: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(false)}>
              Cancel
            </Button>
            <Button loading={recordPayment.isPending} disabled={!(Number(pay.amount) > 0)} onClick={() => recordPayment.mutate(undefined)}>
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent title="Cancel invoice" description="Cancelled invoices keep their number for the audit trail.">
          <Field label="Reason" htmlFor="c-reason" required>
            <Textarea id="c-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Keep invoice
            </Button>
            <Button variant="destructive" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate(undefined)}>
              Cancel invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
