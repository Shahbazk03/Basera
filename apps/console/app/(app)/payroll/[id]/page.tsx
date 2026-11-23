'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Banknote, Calculator, CheckCircle2, ChevronLeft, Users, XCircle } from 'lucide-react';
import { enumLabel, formatDate, formatDateTime, formatINR, localDateString, PAYMENT_METHODS } from '@estate/shared';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  Tooltip,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { PayrollNav } from '@/components/payroll/payroll-nav';

interface RunDetail {
  id: string;
  period: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  workingDays: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  notes: string | null;
  createdAt: string;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdBy: { fullName: string } | null;
  calculatedBy: { fullName: string } | null;
  approvedBy: { fullName: string } | null;
  warnings: string[];
  payslips: {
    id: string;
    status: string;
    employee: { id: string; employeeCode: string; name: string; department: string | null; designation: string | null };
    workingDays: number;
    payableDays: number;
    lopDays: number;
    grossEarnings: number;
    totalDeductions: number;
    netPay: number;
    paid: number;
  }[];
  approval: { approved: number; pending: number; approvableNow: number; ownPayslipPending: boolean };
  permissions: { canCalculate: boolean; canApprove: boolean; approveBlockedReason: string | null; canPay: boolean; canCancel: boolean };
}

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApi<RunDetail>(`/payroll/runs/${id}`);
  const run = q.data;
  const [confirmApprove, setConfirmApprove] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [lastWarnings, setLastWarnings] = React.useState<string[] | null>(null);

  const calculate = useApiMutation(() => api.post<{ payslips: number; warnings: string[] }>(`/payroll/runs/${id}/calculate`), {
    success: (r) => `Calculated ${r.payslips} payslip(s)`,
    invalidate: ['/payroll'],
    onSuccess: (r) => setLastWarnings(r.warnings),
  });
  const approve = useApiMutation(() => api.post<{ status: string; approvedPayslips: number; awaitingOtherApprover: number }>(`/payroll/runs/${id}/approve`), {
    success: (r) =>
      r.status === 'APPROVED'
        ? 'Payroll approved — employees can now see their payslips'
        : `${r.approvedPayslips} payslip(s) approved — ${r.awaitingOtherApprover} still need another approver`,
    invalidate: ['/payroll'],
    onSuccess: () => setConfirmApprove(false),
  });
  const cancel = useApiMutation(() => api.post(`/payroll/runs/${id}/cancel`, { reason: cancelReason }), { success: 'Payroll run cancelled', invalidate: ['/payroll'], onSuccess: () => setCancelOpen(false) });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!run) return <EmptyState title="Payroll run not found" action={<Button variant="outline" asChild><Link href="/payroll">Back to payroll</Link></Button>} />;

  const warnings = lastWarnings ?? run.warnings;
  const paidTotal = run.payslips.reduce((a, p) => a + p.paid, 0);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/payroll" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Payroll runs
          </Link>
        }
        title={`Payroll · ${run.period}`}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge status={run.status} />
            <span>
              {formatDate(run.periodStart)} – {formatDate(run.periodEnd)} · {run.workingDays} working days
            </span>
          </span>
        }
        actions={
          <>
            {run.permissions.canCalculate ? (
              <Button variant={run.status === 'DRAFT' ? 'primary' : 'outline'} size="sm" loading={calculate.isPending} onClick={() => calculate.mutate(undefined)}>
                <Calculator /> {run.status === 'DRAFT' ? 'Calculate' : 'Recalculate'}
              </Button>
            ) : null}
            {run.status === 'CALCULATED' ? (
              run.permissions.canApprove ? (
                <Button size="sm" onClick={() => setConfirmApprove(true)}>
                  <CheckCircle2 /> Approve
                </Button>
              ) : (
                <Tooltip content={run.permissions.approveBlockedReason ?? ''}>
                  <span tabIndex={0}>
                    <Button size="sm" disabled>
                      <CheckCircle2 /> Approve
                    </Button>
                  </span>
                </Tooltip>
              )
            ) : null}
            {run.permissions.canPay ? (
              <Button size="sm" onClick={() => setPayOpen(true)}>
                <Banknote /> Record payment
              </Button>
            ) : null}
            {run.permissions.canCancel ? (
              <Button size="sm" variant="destructive-outline" onClick={() => setCancelOpen(true)}>
                <XCircle /> Cancel run
              </Button>
            ) : null}
          </>
        }
      />
      <PayrollNav />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Employees" value={run.payslips.length} icon={<Users />} />
        <Stat label="Gross earnings" value={formatINR(run.totalGross)} />
        <Stat label="Deductions" value={formatINR(run.totalDeductions)} />
        <Stat label="Net pay" value={formatINR(run.totalNet)} hint={run.status === 'PAID' || paidTotal > 0 ? `${formatINR(paidTotal)} paid` : undefined} tone={run.status === 'PAID' ? 'success' : 'default'} />
      </div>

      <div className="mb-5 grid gap-3">
        {run.status === 'CALCULATED' && run.permissions.approveBlockedReason && run.permissions.approveBlockedReason !== 'You do not have permission to approve payroll' ? (
          <Alert tone="info" title="Approval">
            {run.permissions.approveBlockedReason}
          </Alert>
        ) : run.status === 'CALCULATED' && run.approval.approved > 0 ? (
          <Alert tone="info" title="Approval in progress">
            {run.approval.approved} of {run.payslips.length} payslips approved. {run.approval.pending} awaiting approval
            {run.permissions.canApprove ? '' : ' by another approver'}.
          </Alert>
        ) : null}
        {warnings.length ? (
          <Alert tone="warning" title={`${warnings.length} calculation warning(s)`}>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <p className="text-xs text-ink-500">
          Created by {run.createdBy?.fullName ?? '—'} on {formatDateTime(run.createdAt)}
          {run.calculatedAt ? ` · calculated by ${run.calculatedBy?.fullName} on ${formatDateTime(run.calculatedAt)}` : ''}
          {run.approvedAt ? ` · approved by ${run.approvedBy?.fullName} on ${formatDateTime(run.approvedAt)}` : ''}
          {run.paidAt ? ` · paid ${formatDateTime(run.paidAt)}` : ''}
        </p>
      </div>

      <Card>
        <CardHeader title="Payslips" description="LOP = loss-of-pay days (unpaid leave, absences and half-day shortfalls not covered by leave)." />
        {run.payslips.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH align="right">Pay days</TH>
                <TH align="right">LOP</TH>
                <TH align="right" className="hidden md:table-cell">
                  Gross
                </TH>
                <TH align="right" className="hidden md:table-cell">
                  Deductions
                </TH>
                <TH align="right">Net pay</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {run.payslips.map((p) => (
                <TR key={p.id} onClick={() => router.push(`/payroll/payslips/${p.id}`)}>
                  <TD>
                    <div className="font-medium text-ink-900">{p.employee.name}</div>
                    <div className="text-xs text-ink-500">
                      {p.employee.employeeCode}
                      {p.employee.designation ? ` · ${p.employee.designation}` : ''}
                    </div>
                  </TD>
                  <TD align="right" className="tabular">
                    {p.payableDays} / {p.workingDays}
                  </TD>
                  <TD align="right" className={p.lopDays ? 'tabular font-medium text-danger' : 'tabular'}>
                    {p.lopDays || '—'}
                  </TD>
                  <TD align="right" className="tabular hidden md:table-cell">{formatINR(p.grossEarnings, { precise: true })}</TD>
                  <TD align="right" className="tabular hidden md:table-cell">{formatINR(p.totalDeductions, { precise: true })}</TD>
                  <TD align="right" className="tabular font-semibold text-ink-900">{formatINR(p.netPay, { precise: true })}</TD>
                  <TD>
                    <StatusBadge status={p.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={<Calculator />} title="Not calculated yet" description={run.permissions.canCalculate ? 'Calculate the run to generate payslips from salary structures, attendance and leave.' : undefined} />
        )}
      </Card>

      <ConfirmDialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title={`Approve payroll for ${run.period}?`}
        description={
          run.approval.approvableNow < run.approval.pending
            ? `You will approve ${run.approval.approvableNow} of ${run.approval.pending} pending payslips. Your own payslip stays pending until another approver approves it; the run is finalised and released to employees after that.`
            : `${run.approval.approvableNow} pending payslip(s) will be approved. The run (${run.payslips.length} payslips, ${formatINR(run.totalNet)} net) is then finalised, released to employees and can no longer be recalculated.`
        }
        confirmLabel="Approve payroll"
        loading={approve.isPending}
        onConfirm={() => approve.mutate(undefined)}
      />
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title="Cancel payroll run" description="Adjustments applied to this run are released back to pending. A new run can then be created for the month.">
          <Field label="Reason" htmlFor="cancelReason" required>
            <Textarea id="cancelReason" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep run
            </Button>
            <Button variant="destructive" loading={cancel.isPending} disabled={cancelReason.trim().length < 3} onClick={() => cancel.mutate(undefined)}>
              Cancel run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {payOpen ? <PaymentDialog run={run} onClose={() => setPayOpen(false)} onDone={() => void q.refetch()} /> : null}
    </>
  );
}

function PaymentDialog({ run, onClose, onDone }: { run: RunDetail; onClose: () => void; onDone: () => void }) {
  const unpaid = run.payslips.filter((p) => p.status === 'APPROVED');
  const [selected, setSelected] = React.useState<Set<string>>(new Set(unpaid.map((p) => p.id)));
  const [paidOn, setPaidOn] = React.useState(localDateString(new Date()));
  const [method, setMethod] = React.useState<string>('BANK_TRANSFER');
  const [referenceNo, setReferenceNo] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const pay = useApiMutation(
    () => api.post<{ paid: number; amount: number; runStatus: string }>(`/payroll/runs/${run.id}/payments`, { paidOn, method, referenceNo: referenceNo || null, notes: notes || null, payslipIds: selected.size === unpaid.length ? undefined : [...selected] }),
    {
      success: (r) => `Recorded ${r.paid} payment(s) totalling ${formatINR(r.amount, { precise: true })}`,
      invalidate: ['/payroll'],
      onSuccess: () => {
        onDone();
        onClose();
      },
    },
  );
  const total = unpaid.filter((p) => selected.has(p.id)).reduce((a, p) => a + p.netPay, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record salary payment" description="Records payments made outside the system (bank transfer, cheque…) and posts them to the finance ledger." size="lg">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Paid on" htmlFor="paidOn">
              <Input id="paidOn" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Method" htmlFor="payMethod">
              <Select id="payMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {enumLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="payRef" hint="UTR / cheque no.">
              <Input id="payRef" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="payNotes">
            <Input id="payNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
            {unpaid.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center justify-between gap-3 border-b border-line px-3 py-2 text-sm last:border-0 hover:bg-ink-50">
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-brand)]"
                    checked={selected.has(p.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setSelected(next);
                    }}
                  />
                  {p.employee.name} <span className="text-xs text-ink-500">{p.employee.employeeCode}</span>
                </span>
                <span className="tabular font-medium">{formatINR(p.netPay, { precise: true })}</span>
              </label>
            ))}
          </div>
          <p className="text-right text-sm text-ink-600">
            {selected.size} payslip(s) · <span className="tabular font-semibold text-ink-900">{formatINR(total, { precise: true })}</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pay.isPending} disabled={selected.size === 0} onClick={() => pay.mutate(undefined)}>
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
