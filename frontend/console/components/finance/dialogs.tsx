'use client';

import * as React from 'react';
import { enumLabel, PAYMENT_METHODS, localDateString } from '@estate/shared';
import { Button, DialogContent, DialogFooter, Field, Input, Select, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';

const today = () => localDateString(new Date());

/** Approve / reject with a note; a reason is required for rejection (server enforces it too). */
export function DecisionDialog({ path, decision, title, onDone, invalidate }: { path: string; decision: 'APPROVE' | 'REJECT'; title: string; onDone: () => void; invalidate: string[] }) {
  const [note, setNote] = React.useState('');
  const run = useApiMutation(() => api.post(path, { decision, note: note.trim() || undefined }), { success: decision === 'APPROVE' ? 'Approved' : 'Rejected', invalidate, onSuccess: onDone });
  return (
    <DialogContent title={decision === 'APPROVE' ? 'Approve' : 'Reject'} description={title}>
      <Field label={decision === 'REJECT' ? 'Reason' : 'Note (optional)'} htmlFor="d-note" required={decision === 'REJECT'}>
        <Textarea id="d-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button variant={decision === 'APPROVE' ? 'primary' : 'destructive'} loading={run.isPending} disabled={decision === 'REJECT' && note.trim().length < 3} onClick={() => run.mutate(undefined)}>
          {decision === 'APPROVE' ? 'Approve' : 'Reject'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Records an actual payment (date, method, reference) — the server writes the ledger transaction. */
export function PaymentDialog({ path, title, description, onDone, invalidate, extra }: { path: string; title: string; description?: string; onDone: () => void; invalidate: string[]; extra?: Record<string, unknown> }) {
  const [v, setV] = React.useState({ paidOn: today(), method: 'BANK_TRANSFER', referenceNo: '' });
  const run = useApiMutation(() => api.post(path, { ...extra, ...v, referenceNo: v.referenceNo.trim() || null }), { success: 'Payment recorded in the ledger', invalidate, onSuccess: onDone });
  return (
    <DialogContent title={title} description={description}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on" htmlFor="pd-date" required>
          <Input id="pd-date" type="date" max={today()} value={v.paidOn} onChange={(e) => setV({ ...v, paidOn: e.target.value })} />
        </Field>
        <Field label="Method" htmlFor="pd-method" required>
          <Select id="pd-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {enumLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="pd-ref" hint="Bank UTR, cheque number or similar" className="sm:col-span-2">
          <Input id="pd-ref" value={v.referenceNo} onChange={(e) => setV({ ...v, referenceNo: e.target.value })} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={run.isPending} disabled={!v.paidOn} onClick={() => run.mutate(undefined)}>
          Record payment
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
