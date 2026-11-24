'use client';

import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { calculateInvoiceTotals, formatINR, invoiceSchema, localDateString } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, DialogContent, DialogFooter, Field, Input, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/hooks';

type Values = z.input<typeof invoiceSchema>;

export interface InvoiceDraft {
  id: string;
  billToName: string;
  billToAddress: string | null;
  billToGstin: string | null;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  lines: { description: string; quantity: number; unitPrice: number; taxRate: number }[];
}

/** Create or edit a draft invoice; tax rate is entered per line (never assumed). */
export function InvoiceForm({ invoice, onDone }: { invoice?: InvoiceDraft; onDone: (id?: string) => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: invoice
      ? {
          billToName: invoice.billToName,
          billToAddress: invoice.billToAddress,
          billToGstin: invoice.billToGstin ?? '',
          issueDate: invoice.issueDate.slice(0, 10),
          dueDate: invoice.dueDate?.slice(0, 10) ?? null,
          notes: invoice.notes,
          lines: invoice.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })),
        }
      : { billToName: '', issueDate: localDateString(new Date()), lines: [{ description: '', quantity: 1, unitPrice: 0, taxRate: 0 }] },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const [error, setError] = React.useState<string | null>(null);
  const watched = form.watch('lines');
  const totals = calculateInvoiceTotals((watched ?? []).map((l) => ({ description: String(l.description ?? ''), quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, taxRate: Number(l.taxRate) || 0 })));
  const e = form.formState.errors;
  return (
    <DialogContent title={invoice ? 'Edit draft invoice' : 'New invoice'} description="Saved as a draft. The sequential invoice number is assigned when you issue it." size="xl">
      <form
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const res = invoice ? await api.patch<{ id: string }>(`/finance/invoices/${invoice.id}`, v) : await api.post<{ id: string }>('/finance/invoices', v);
            onDone(res.id);
          } catch (err) {
            if (!applyServerErrors(form, err)) setError(errorMessage(err));
          }
        })}
        className="grid gap-5"
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bill to" htmlFor="billToName" required error={e.billToName?.message}>
            <Input id="billToName" {...form.register('billToName')} />
          </Field>
          <Field label="GSTIN" htmlFor="billToGstin" error={e.billToGstin?.message}>
            <Input id="billToGstin" {...form.register('billToGstin')} />
          </Field>
          <Field label="Billing address" htmlFor="billToAddress" className="sm:col-span-2">
            <Textarea id="billToAddress" rows={2} {...form.register('billToAddress')} />
          </Field>
          <Field label="Issue date" htmlFor="issueDate" required error={e.issueDate?.message}>
            <Input id="issueDate" type="date" {...form.register('issueDate')} />
          </Field>
          <Field label="Due date" htmlFor="dueDate" error={e.dueDate?.message}>
            <Input id="dueDate" type="date" {...form.register('dueDate', { setValueAs: (v) => (v === '' ? null : v) })} />
          </Field>
        </div>
        <div>
          <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_80px_120px_80px_110px_32px] gap-2 text-xs font-medium text-ink-500 md:grid">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price (₹)</span>
            <span>Tax %</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          <div className="grid gap-2">
            {lines.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_80px_120px_80px_110px_32px] md:items-center">
                <Input aria-label={`Line ${i + 1} description`} className="col-span-2 md:col-span-1" placeholder="Service description" {...form.register(`lines.${i}.description`)} aria-invalid={Boolean(e.lines?.[i]?.description)} />
                <Input aria-label="Quantity" type="number" step="0.01" {...form.register(`lines.${i}.quantity`)} />
                <Input aria-label="Unit price" type="number" step="0.01" {...form.register(`lines.${i}.unitPrice`)} />
                <Input aria-label="Tax rate percent" type="number" step="0.01" {...form.register(`lines.${i}.taxRate`)} />
                <span className="tabular text-right text-sm text-ink-900">{formatINR(totals.lines[i]?.amount ?? 0, { precise: true })}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          {e.lines?.message ? <p className="mt-1 text-xs text-danger">{e.lines.message}</p> : null}
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => lines.append({ description: '', quantity: 1, unitPrice: 0, taxRate: 0 })}>
            <Plus /> Add line
          </Button>
        </div>
        <div className="ml-auto grid w-full max-w-xs gap-1.5 text-sm">
          <div className="flex justify-between text-ink-600">
            <span>Subtotal</span>
            <span className="tabular">{formatINR(totals.subtotal, { precise: true })}</span>
          </div>
          <div className="flex justify-between text-ink-600">
            <span>Tax</span>
            <span className="tabular">{formatINR(totals.taxTotal, { precise: true })}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5 font-semibold text-ink-900">
            <span>Total</span>
            <span className="tabular">{formatINR(totals.total, { precise: true })}</span>
          </div>
        </div>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" rows={2} {...form.register('notes')} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Save draft
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
