'use client';

import * as React from 'react';
import { FileText, PiggyBank } from 'lucide-react';
import { enumLabel, formatDate, formatINR, PAYMENT_METHODS, type Paginated, localDateString } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, Select, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { openDocument } from '@/components/uploaders';
import { DecisionDialog } from '@/components/finance/dialogs';
import { useSession } from '@/lib/session';

interface ClaimRow {
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
  isMine?: boolean;
  employee: { id: string; employeeCode: string; userId: string; user: { fullName: string }; manager: { userId: string; user: { fullName: string } } | null };
  approver: { fullName: string } | null;
  receiptFile: { id: string; fileName: string } | null;
  transactions: { txnNo: string; txnDate: string }[];
  payroll: { periodYear: number; periodMonth: number; status: string } | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function ReimbursementsPage() {
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string }>();
  const q = useApi<Paginated<ClaimRow> & { statusCounts: Record<string, number>; canManage: boolean }>('/finance/reimbursements', { ...values, page, pageSize: 25 });
  const [deciding, setDeciding] = React.useState<{ row: ClaimRow; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [paying, setPaying] = React.useState<ClaimRow | null>(null);
  const { user, can } = useSession();
  // Private receipts open for the claimant, the claimant's manager (who decides the claim) and finance — enforced by the files API.
  const canOpenReceipt = (r: ClaimRow) => can('finance.view') || r.employee.userId === user.id || r.employee.manager?.userId === user.id;
  const canManage = q.data?.canManage ?? false;
  // UI hint only — the API enforces "not your own claim" and "manager or finance".
  const canDecide = (r: ClaimRow) => !r.isMine && (canManage || r.employee.manager?.userId === user.id);
  return (
    <>
      <PageHeader title="Reimbursements" description="Employee expense claims. Managers decide their team's claims; finance pays approved claims directly or with the next salary." />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'SUBMITTED', label: 'Awaiting decision' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'PAID', label: 'Paid' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
          counts={q.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search claim or employee" />
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <PiggyBank />, title: 'No claims', description: 'Claims submitted by employees will appear here.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Employee</TH>
                    <TH>Claim</TH>
                    <TH align="right">Amount</TH>
                    <TH>Status</TH>
                    <TH align="right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <div className="font-medium text-ink-900">{r.employee.user.fullName}</div>
                        <div className="text-xs text-ink-500">
                          {r.employee.employeeCode}
                          {r.employee.manager ? ` · reports to ${r.employee.manager.user.fullName}` : ''}
                        </div>
                      </TD>
                      <TD>
                        <div className="text-ink-900">{r.title}</div>
                        <div className="text-xs text-ink-500">
                          {r.category} · spent {formatDate(r.expenseDate)}
                          {r.receiptFile && canOpenReceipt(r) ? (
                            <button type="button" className="ml-1.5 inline-flex items-center gap-0.5 text-brand hover:underline" onClick={() => void openDocument(r.receiptFile!.id)}>
                              <FileText className="size-3" /> Receipt
                            </button>
                          ) : r.receiptFile ? (
                            <span className="ml-1.5 text-ink-400">Receipt attached (visible to finance and the manager)</span>
                          ) : (
                            <span className="ml-1.5 text-ink-400">No receipt</span>
                          )}
                        </div>
                        {r.description ? <div className="line-clamp-2 text-xs text-ink-500">{r.description}</div> : null}
                        <ClaimTrail r={r} />
                      </TD>
                      <TD align="right" className="tabular font-medium text-ink-900">
                        {formatINR(r.amount, { precise: true })}
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD align="right">
                        <div className="flex justify-end gap-1">
                          {r.status === 'SUBMITTED' && canDecide(r) ? (
                            <>
                              <Button size="xs" variant="soft" onClick={() => setDeciding({ row: r, decision: 'APPROVE' })}>
                                Approve
                              </Button>
                              <Button size="xs" variant="ghost" className="text-danger" onClick={() => setDeciding({ row: r, decision: 'REJECT' })}>
                                Reject
                              </Button>
                            </>
                          ) : null}
                          {r.status === 'APPROVED' && canManage && !r.isMine && !r.payroll ? (
                            <Button size="xs" onClick={() => setPaying(r)}>
                              Pay
                            </Button>
                          ) : null}
                        </div>
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
      <Dialog open={Boolean(deciding)} onOpenChange={(o) => !o && setDeciding(null)}>
        {deciding ? (
          <DecisionDialog
            path={`/finance/reimbursements/${deciding.row.id}/decision`}
            decision={deciding.decision}
            title={`${deciding.row.employee.user.fullName} — ${deciding.row.title} (${formatINR(deciding.row.amount, { precise: true })})`}
            onDone={() => setDeciding(null)}
            invalidate={['/finance/reimbursements']}
          />
        ) : null}
      </Dialog>
      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        {paying ? <PayClaim claim={paying} onDone={() => setPaying(null)} /> : null}
      </Dialog>
    </>
  );
}

function ClaimTrail({ r }: { r: ClaimRow }) {
  const bits: string[] = [];
  if (r.approver && r.decidedAt) bits.push(`${r.status === 'REJECTED' ? 'Rejected' : 'Approved'} by ${r.approver.fullName} on ${formatDate(r.decidedAt)}`);
  if (r.payroll && r.status !== 'PAID') bits.push(`With salary for ${MONTHS[r.payroll.periodMonth - 1]} ${r.payroll.periodYear} (${enumLabel(r.payroll.status).toLowerCase()})`);
  if (r.transactions[0]) bits.push(`Paid · ${r.transactions[0].txnNo}`);
  else if (r.status === 'PAID' && r.payroll) bits.push(`Paid with ${MONTHS[r.payroll.periodMonth - 1]} ${r.payroll.periodYear} salary`);
  if (!bits.length && !r.decisionNote) return null;
  return (
    <div className="mt-1 text-xs text-ink-500">
      {bits.join(' · ')}
      {r.decisionNote ? <div className="italic">“{r.decisionNote}”</div> : null}
    </div>
  );
}

function PayClaim({ claim, onDone }: { claim: ClaimRow; onDone: () => void }) {
  const now = new Date();
  const [via, setVia] = React.useState<'TRANSACTION' | 'PAYROLL'>('TRANSACTION');
  const [t, setT] = React.useState({ paidOn: localDateString(now), method: 'BANK_TRANSFER', referenceNo: '' });
  const [p, setP] = React.useState({ periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1 });
  const [error, setError] = React.useState<string | null>(null);
  const run = useApiMutation(
    () => api.post(`/finance/reimbursements/${claim.id}/pay`, via === 'TRANSACTION' ? { via, ...t, referenceNo: t.referenceNo.trim() || null } : { via, ...p }),
    { success: via === 'TRANSACTION' ? 'Payment recorded in the ledger' : 'Added to the selected payroll month', invalidate: ['/finance'], onSuccess: onDone, onError: (e) => setError(errorMessage(e)), silent: true },
  );
  return (
    <DialogContent title={`Pay ${formatINR(claim.amount, { precise: true })}`} description={`${claim.employee.user.fullName} — ${claim.title}`}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <fieldset className="mb-4 grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">How is it paid?</legend>
        {(
          [
            ['TRANSACTION', 'Paid directly', 'Record a bank or cash payment now.'],
            ['PAYROLL', 'With salary', 'Added to a payroll month; marked paid when that payroll is paid.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className={`cursor-pointer rounded-lg border p-3 text-sm ${via === value ? 'border-brand bg-brand-soft' : 'border-line hover:bg-ink-50'}`}>
            <input type="radio" name="via" value={value} checked={via === value} onChange={() => setVia(value)} className="sr-only" />
            <span className="font-medium text-ink-900">{label}</span>
            <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>
          </label>
        ))}
      </fieldset>
      {via === 'TRANSACTION' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid on" htmlFor="rp-date" required>
            <Input id="rp-date" type="date" value={t.paidOn} onChange={(e) => setT({ ...t, paidOn: e.target.value })} />
          </Field>
          <Field label="Method" htmlFor="rp-method" required>
            <Select id="rp-method" value={t.method} onChange={(e) => setT({ ...t, method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {enumLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" htmlFor="rp-ref" className="sm:col-span-2">
            <Input id="rp-ref" value={t.referenceNo} onChange={(e) => setT({ ...t, referenceNo: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payroll month" htmlFor="rp-month" required>
            <Select id="rp-month" value={p.periodMonth} onChange={(e) => setP({ ...p, periodMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="rp-year" required>
            <Input id="rp-year" type="number" value={p.periodYear} onChange={(e) => setP({ ...p, periodYear: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={run.isPending} onClick={() => run.mutate(undefined)}>
          {via === 'TRANSACTION' ? 'Record payment' : 'Add to payroll'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
