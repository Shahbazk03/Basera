'use client';

import * as React from 'react';
import { FileText, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { enumLabel, formatDate, formatINR, reimbursementSchema, localDateString } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import { DocumentUpload, openDocument } from '@/components/uploaders';

interface MyClaim {
  id: string;
  title: string;
  category: string;
  amount: number;
  expenseDate: string;
  description: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  approver: { fullName: string } | null;
  receiptFile: { id: string; fileName: string } | null;
  transactions: { txnNo: string; txnDate: string }[];
  payroll: { periodYear: number; periodMonth: number; status: string } | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MyReimbursementsPage() {
  const q = useApi<MyClaim[]>('/me/reimbursements');
  const [open, setOpen] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState<MyClaim | null>(null);
  const withdraw = useApiMutation((id: string) => api.delete(`/me/reimbursements/${id}`), { success: 'Claim withdrawn', invalidate: ['/me/reimbursements'], onSuccess: () => setWithdrawing(null) });
  const sum = (st: string[]) => (q.data ?? []).filter((c) => st.includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);
  const categories = Array.from(new Set((q.data ?? []).map((c) => c.category)));
  return (
    <>
      <PageHeader
        title="My reimbursements"
        description="Claim money you spent on company work. Your manager or the finance team approves it, then it is paid directly or with your salary."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New claim
          </Button>
        }
      />
      {q.data && q.data.length ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Stat label="Awaiting decision" value={formatINR(sum(['SUBMITTED']), { precise: true })} />
          <Stat label="Approved, not yet paid" value={formatINR(sum(['APPROVED']), { precise: true })} />
          <Stat label="Paid to you" value={formatINR(sum(['PAID']), { precise: true })} />
        </div>
      ) : null}
      <Card>
        <QueryState
          query={q}
          isEmpty={(d) => d.length === 0}
          empty={{
            icon: <PiggyBank />,
            title: 'No claims yet',
            description: 'Submit a claim with a photo or PDF of the receipt.',
            action: (
              <Button onClick={() => setOpen(true)}>
                <Plus /> New claim
              </Button>
            ),
          }}
        >
          {(d) => (
            <Table>
              <THead>
                <tr>
                  <TH>Claim</TH>
                  <TH className="hidden sm:table-cell">Spent on</TH>
                  <TH align="right">Amount</TH>
                  <TH>Status</TH>
                  <TH align="right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {d.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{c.title}</div>
                      <div className="text-xs text-ink-500">
                        {c.category} · submitted {formatDate(c.createdAt)}
                        {c.receiptFile ? (
                          <button type="button" className="ml-1.5 inline-flex items-center gap-0.5 text-brand hover:underline" onClick={() => void openDocument(c.receiptFile!.id)}>
                            <FileText className="size-3" /> Receipt
                          </button>
                        ) : null}
                      </div>
                      <Outcome c={c} />
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{formatDate(c.expenseDate)}</TD>
                    <TD align="right" className="tabular font-medium text-ink-900">
                      {formatINR(c.amount, { precise: true })}
                    </TD>
                    <TD>
                      <StatusBadge status={c.status} />
                    </TD>
                    <TD align="right">
                      {c.status === 'SUBMITTED' ? (
                        <Button size="icon-sm" variant="ghost" aria-label={`Withdraw ${c.title}`} onClick={() => setWithdrawing(c)}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <ClaimForm categories={categories} onDone={() => setOpen(false)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={Boolean(withdrawing)}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title="Withdraw this claim?"
        description={withdrawing ? `“${withdrawing.title}” for ${formatINR(withdrawing.amount, { precise: true })} will be removed.` : undefined}
        confirmLabel="Withdraw"
        tone="danger"
        loading={withdraw.isPending}
        onConfirm={() => {
          if (withdrawing) withdraw.mutate(withdrawing.id);
        }}
      />
    </>
  );
}

function Outcome({ c }: { c: MyClaim }) {
  let text: string | null = null;
  if (c.status === 'REJECTED') text = `Rejected${c.approver ? ` by ${c.approver.fullName}` : ''}${c.decidedAt ? ` on ${formatDate(c.decidedAt)}` : ''}`;
  else if (c.status === 'PAID') text = c.transactions[0] ? `Paid on ${formatDate(c.transactions[0].txnDate)}` : c.payroll ? `Paid with ${MONTHS[c.payroll.periodMonth - 1]} ${c.payroll.periodYear} salary` : 'Paid';
  else if (c.status === 'APPROVED') text = c.payroll ? `Approved — will be paid with ${MONTHS[c.payroll.periodMonth - 1]} ${c.payroll.periodYear} salary (${enumLabel(c.payroll.status).toLowerCase()})` : `Approved${c.approver ? ` by ${c.approver.fullName}` : ''} — awaiting payment`;
  if (!text && !c.decisionNote) return null;
  return (
    <div className="mt-1 text-xs text-ink-500">
      {text}
      {c.decisionNote ? <div className="italic">“{c.decisionNote}”</div> : null}
    </div>
  );
}

function ClaimForm({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const today = localDateString(new Date());
  const [v, setV] = React.useState({ title: '', category: '', amount: '', expenseDate: today, description: '' });
  const [receipt, setReceipt] = React.useState<{ id: string; fileName: string } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation((body: unknown) => api.post('/me/reimbursements', body), {
    success: 'Claim submitted for approval',
    invalidate: ['/me/reimbursements'],
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
    silent: true,
  });
  const submit = () => {
    setError(null);
    const parsed = reimbursementSchema.safeParse({ ...v, description: v.description.trim() || null, receiptFileId: receipt?.id ?? null });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };
  return (
    <DialogContent title="New reimbursement claim">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What was it for?" htmlFor="c-title" required error={errors.title} className="sm:col-span-2">
          <Input id="c-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Cab to site visit at Gomti Nagar" />
        </Field>
        <Field label="Category" htmlFor="c-cat" required error={errors.category} hint={categories.length ? 'Pick one you used before or type a new one' : undefined}>
          <Input id="c-cat" list="claim-categories" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          <datalist id="claim-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Amount (₹)" htmlFor="c-amt" required error={errors.amount}>
          <Input id="c-amt" type="number" step="0.01" min="0" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Date spent" htmlFor="c-date" required error={errors.expenseDate}>
          <Input id="c-date" type="date" max={today} value={v.expenseDate} onChange={(e) => setV({ ...v, expenseDate: e.target.value })} />
        </Field>
        <Field label="Details" htmlFor="c-desc" error={errors.description} className="sm:col-span-2">
          <Textarea id="c-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          {receipt ? (
            <p className="flex items-center gap-2 text-sm text-ink-700">
              <FileText className="size-4 text-ink-400" /> {receipt.fileName}
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => setReceipt(null)}>
                Remove
              </button>
            </p>
          ) : (
            <DocumentUpload purpose="receipt" label="Attach receipt" onUploaded={(f) => setReceipt(f)} />
          )}
          <p className="mt-1 text-xs text-ink-500">Receipts are private — only you and the finance team can open them.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          Submit claim
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
