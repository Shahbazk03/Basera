'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarPlus, CalendarX } from 'lucide-react';
import { countLeaveDays, formatDate, leaveApplySchema, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { LeaveBalance, LeaveRequestRow, LeaveType } from '@/components/hr/types';

export default function MyLeavePage() {
  const { user } = useSession();
  const year = new Date().getUTCFullYear();
  const { page, setPage } = useListParams();
  const balances = useApi<LeaveBalance[]>(user.employeeId ? '/hr/leave/balances/me' : null, { year });
  const requests = useApi<Paginated<LeaveRequestRow>>(user.employeeId ? '/hr/leave/requests' : null, { scope: 'mine', page, pageSize: 15 });
  const [applying, setApplying] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<LeaveRequestRow | null>(null);
  const cancel = useApiMutation((id: string) => api.post(`/hr/leave/requests/${id}/cancel`), { success: 'Leave request cancelled', invalidate: ['/hr/leave'], onSuccess: () => setCancelling(null) });

  if (!user.employeeId) return <EmptyState title="Leave is for employees" description="Your account is not linked to an employee record." />;

  return (
    <>
      <PageHeader
        title="My leave"
        description={`Balances for ${year}. Weekly offs and holidays inside a request are not counted.`}
        actions={
          <Button onClick={() => setApplying(true)}>
            <CalendarPlus /> Apply for leave
          </Button>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {balances.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          : (balances.data ?? []).map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-ink-700">{b.leaveType.name}</p>
                  {b.leaveType.isPaid ? null : <Badge size="sm" tone="warning">Unpaid</Badge>}
                </div>
                {b.leaveType.isPaid ? (
                  <>
                    <p className="tabular mt-1.5 font-display text-[26px] font-semibold leading-none text-ink-900">
                      {b.available}
                      <span className="ml-1 text-sm font-normal text-ink-500">/ {b.allocated + b.carriedForward} days</span>
                    </p>
                    <p className="mt-2 text-xs text-ink-500">
                      Used {b.used}
                      {b.pending ? ` · ${b.pending} pending` : ''}
                      {b.carriedForward ? ` · ${b.carriedForward} carried forward` : ''}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-ink-500">No balance needed — unpaid days are deducted in payroll.</p>
                )}
              </div>
            ))}
      </div>
      <Card>
        <CardHeader title="My requests" />
        {requests.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-32" />
          </div>
        ) : requests.data?.data.length ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Leave</TH>
                  <TH>Dates</TH>
                  <TH align="right">Days</TH>
                  <TH className="hidden md:table-cell">Reason</TH>
                  <TH>Status</TH>
                  <TH align="right"> </TH>
                </tr>
              </THead>
              <TBody>
                {requests.data.data.map((r) => (
                  <TR key={r.id}>
                    <TD>{r.leaveType.name}</TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(r.startDate)}
                      {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : ''}
                    </TD>
                    <TD align="right" className="tabular">{r.days}</TD>
                    <TD className="hidden max-w-sm md:table-cell">
                      <span className="line-clamp-1">{r.reason}</span>
                      {r.decisionNote ? <span className="block text-xs text-ink-500">Note: {r.decisionNote}</span> : null}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                      {r.approver ? <div className="mt-0.5 text-[11px] text-ink-500">by {r.approver.fullName}</div> : null}
                    </TD>
                    <TD align="right">
                      {r.canCancel ? (
                        <Button size="xs" variant="ghost" className="text-danger" onClick={() => setCancelling(r)}>
                          Cancel
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="border-t border-line px-4 py-3">
              <Pagination page={page} totalPages={requests.data.meta.totalPages} total={requests.data.meta.total} pageSize={requests.data.meta.pageSize} onPageChange={setPage} />
            </div>
          </>
        ) : (
          <EmptyState icon={<CalendarX />} title="No leave requests yet" />
        )}
      </Card>
      {applying ? (
        <ApplyDialog
          balances={balances.data ?? []}
          onClose={() => setApplying(false)}
          onDone={() => {
            void balances.refetch();
            void requests.refetch();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this leave request?"
        description={cancelling ? `${cancelling.leaveType.name}, ${formatDate(cancelling.startDate)}${cancelling.endDate !== cancelling.startDate ? ` – ${formatDate(cancelling.endDate)}` : ''}. ${cancelling.status === 'APPROVED' ? 'The days will be returned to your balance.' : ''}` : undefined}
        tone="danger"
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </>
  );
}

function ApplyDialog({ balances, onClose, onDone }: { balances: LeaveBalance[]; onClose: () => void; onDone: () => void }) {
  const types = useApi<LeaveType[]>('/hr/leave/types');
  const year = new Date().getUTCFullYear();
  const calendar = useApi<{ weeklyOffDays: number[]; holidays: string[] }>('/hr/leave/my-calendar', { year });
  const form = useForm<z.input<typeof leaveApplySchema>>({ resolver: zodResolver(leaveApplySchema), defaultValues: { leaveTypeId: '', startDate: '', endDate: '', halfDayStart: false, halfDayEnd: false, reason: '' } });
  const v = form.watch();
  const type = types.data?.find((t) => t.id === v.leaveTypeId);
  const balance = balances.find((b) => b.leaveType.id === v.leaveTypeId);
  const days = v.startDate && v.endDate && v.endDate >= v.startDate && calendar.data ? countLeaveDays(v.startDate, v.endDate, calendar.data, { halfDayStart: Boolean(v.halfDayStart), halfDayEnd: Boolean(v.halfDayEnd) }) : null;
  const available = balance ? balance.available - balance.pending : null;
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Apply for leave">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (vals) => {
            try {
              await api.post('/hr/leave/requests', vals);
              toast.success('Leave request submitted for approval');
              onDone();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Leave type" htmlFor="lvType" required error={errors.leaveTypeId?.message}>
            <Select id="lvType" {...form.register('leaveTypeId')}>
              <option value="">Select leave type</option>
              {(types.data ?? [])
                .filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isPaid ? '' : ' (unpaid)'}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="lvStart" required error={errors.startDate?.message}>
              <Input id="lvStart" type="date" {...form.register('startDate')} />
            </Field>
            <Field label="To" htmlFor="lvEnd" required error={errors.endDate?.message}>
              <Input id="lvEnd" type="date" min={v.startDate || undefined} {...form.register('endDate')} />
            </Field>
          </div>
          {type?.allowHalfDay ? (
            <div className="flex flex-wrap gap-5">
              <CheckboxField label="First day is a half day" checked={Boolean(v.halfDayStart)} onCheckedChange={(c) => form.setValue('halfDayStart', Boolean(c))} />
              {v.startDate !== v.endDate ? <CheckboxField label="Last day is a half day" checked={Boolean(v.halfDayEnd)} onCheckedChange={(c) => form.setValue('halfDayEnd', Boolean(c))} /> : null}
            </div>
          ) : null}
          {days !== null ? (
            <Alert tone={days === 0 || (type?.isPaid && available !== null && days > available) ? 'warning' : 'info'}>
              {days === 0
                ? 'These dates are weekly offs or holidays — no leave is needed.'
                : `${days} working day(s)${type?.isPaid && available !== null ? ` · ${available} available after pending requests` : type && !type.isPaid ? ' · unpaid (loss of pay)' : ''}`}
            </Alert>
          ) : null}
          <Field label="Reason" htmlFor="lvReason" required error={errors.reason?.message}>
            <Textarea id="lvReason" rows={3} {...form.register('reason')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} disabled={days === 0}>
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
