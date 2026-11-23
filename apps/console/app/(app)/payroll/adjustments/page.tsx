'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { enumLabel, formatINR, PAYROLL_ADJUSTMENT_TYPES, payrollAdjustmentSchema, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Badge, Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { PayrollNav } from '@/components/payroll/payroll-nav';
import { EmployeeSelect, MonthInput } from '@/components/hr/pickers';

interface Adjustment {
  id: string;
  periodYear: number;
  periodMonth: number;
  type: string;
  amount: number;
  description: string;
  sourceRef: string | null;
  status: string;
  createdAt: string;
  employee: { id: string; employeeCode: string; user: { fullName: string } };
  createdBy: { fullName: string } | null;
  payrollRun: { id: string; status: string } | null;
}

export default function AdjustmentsPage() {
  const { can, user } = useSession();
  const manage = can('payroll.manage', user.platformOrganizationId);
  const { values, set, page, setPage } = useListParams<{ month?: string; astatus?: string }>();
  const [y, m] = (values.month ?? '').split('-').map(Number);
  const q = useApi<Paginated<Adjustment>>('/payroll/adjustments', { year: values.month ? y : undefined, month: values.month ? m : undefined, status: values.astatus, page, pageSize: 25 });
  const [open, setOpen] = React.useState(false);
  const cancel = useApiMutation((id: string) => api.post(`/payroll/adjustments/${id}/cancel`), { success: 'Adjustment cancelled', invalidate: ['/payroll/adjustments'] });
  return (
    <>
      <PageHeader
        title="Payroll adjustments"
        description="One-off incentives, bonuses, arrears, reimbursements and recoveries applied to a month's payroll. Commission incentives and reimbursements paid via payroll also appear here."
        actions={
          manage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add adjustment
            </Button>
          ) : null
        }
      />
      <PayrollNav />
      <Card>
        <Toolbar>
          <MonthInput value={values.month ?? ''} onChange={(v) => set({ month: v })} />
          {values.month ? (
            <Button size="sm" variant="ghost" onClick={() => set({ month: undefined })}>
              All months
            </Button>
          ) : null}
          <FilterSelect value={values.astatus} onChange={(v) => set({ astatus: v })} placeholder="Any status" options={['PENDING', 'APPLIED', 'CANCELLED'].map((s) => ({ value: s, label: enumLabel(s) }))} />
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <SlidersHorizontal />, title: 'No adjustments', description: 'Pending adjustments are picked up when the month is calculated.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Employee</TH>
                    <TH>Month</TH>
                    <TH>Type</TH>
                    <TH className="hidden md:table-cell">Description</TH>
                    <TH align="right">Amount</TH>
                    <TH>Status</TH>
                    {manage ? <TH align="right">Action</TH> : null}
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <div className="font-medium text-ink-900">{a.employee.user.fullName}</div>
                        <div className="text-xs text-ink-500">{a.employee.employeeCode}</div>
                      </TD>
                      <TD className="whitespace-nowrap">{new Date(Date.UTC(a.periodYear, a.periodMonth - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</TD>
                      <TD>
                        <Badge tone={a.type === 'DEDUCTION' ? 'warning' : 'success'}>{enumLabel(a.type)}</Badge>
                      </TD>
                      <TD className="hidden max-w-sm md:table-cell">
                        <span className="line-clamp-2">{a.description}</span>
                        {a.sourceRef ? <span className="text-xs text-ink-500">{a.sourceRef.split(':')[0].toLowerCase()} payout</span> : null}
                      </TD>
                      <TD align="right" className="tabular font-medium text-ink-900">
                        {a.type === 'DEDUCTION' ? '−' : ''}
                        {formatINR(a.amount, { precise: true })}
                      </TD>
                      <TD>
                        <StatusBadge status={a.status} />
                      </TD>
                      {manage ? (
                        <TD align="right">
                          {a.status === 'PENDING' ? (
                            <Button size="xs" variant="ghost" className="text-danger" loading={cancel.isPending} onClick={() => cancel.mutate(a.id)}>
                              Cancel
                            </Button>
                          ) : null}
                        </TD>
                      ) : null}
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
      {open ? <AdjustmentDialog onClose={() => setOpen(false)} onSaved={() => void q.refetch()} /> : null}
    </>
  );
}

function AdjustmentDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const now = new Date();
  const form = useForm<z.input<typeof payrollAdjustmentSchema>>({
    resolver: zodResolver(payrollAdjustmentSchema),
    defaultValues: { periodYear: now.getUTCFullYear(), periodMonth: now.getUTCMonth() + 1, type: 'INCENTIVE', description: '' },
  });
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add payroll adjustment">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api.post('/payroll/adjustments', v);
              toast.success('Adjustment added');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Employee" htmlFor="aEmp" required error={errors.employeeId?.message}>
            <EmployeeSelect id="aEmp" {...form.register('employeeId')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Month" htmlFor="aMonth" error={errors.periodMonth?.message}>
              <Select id="aMonth" {...form.register('periodMonth')}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(Date.UTC(2026, i, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Year" htmlFor="aYear" error={errors.periodYear?.message}>
              <Input id="aYear" type="number" {...form.register('periodYear')} />
            </Field>
            <Field label="Type" htmlFor="aType">
              <Select id="aType" {...form.register('type')}>
                {PAYROLL_ADJUSTMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Amount (₹)" htmlFor="aAmount" required error={errors.amount?.message}>
            <Input id="aAmount" type="number" step="any" min={0} {...form.register('amount')} />
          </Field>
          <Field label="Description" htmlFor="aDesc" required hint="Shown on the payslip" error={errors.description?.message}>
            <Input id="aDesc" {...form.register('description')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Add adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
