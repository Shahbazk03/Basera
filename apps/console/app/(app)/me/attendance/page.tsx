'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Clock, LogIn, LogOut, PencilLine } from 'lucide-react';
import { formatDate, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, PageHeader, Skeleton, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { AttendanceCalendar, AttendanceSummary } from '@/components/hr/attendance-calendar';
import { MonthInput } from '@/components/hr/pickers';
import { currentMonth, hoursOf, istInstant, timeOf, todayIso, type AttendanceMonth, type AttendanceRecordOut } from '@/components/hr/types';

interface Today {
  date: string;
  serverTime: string;
  shift: { name: string; startTime: string; endTime: string; graceMinutes: number; timezone: string };
  isWorkingDay: boolean;
  holiday: string | null;
  onLeave: string | null;
  record: AttendanceRecordOut | null;
}
interface CorrectionRow {
  id: string;
  date: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
  status: string;
  reviewNote: string | null;
  reviewedBy: { fullName: string } | null;
}

export default function MyAttendancePage() {
  const { user } = useSession();
  const [month, setMonth] = React.useState(currentMonth());
  const today = useApi<Today>(user.employeeId ? '/hr/attendance/me/today' : null);
  const cal = useApi<AttendanceMonth>(user.employeeId ? '/hr/attendance/me' : null, { month });
  const corrections = useApi<Paginated<CorrectionRow>>(user.employeeId ? '/hr/attendance/corrections' : null, { scope: 'mine', pageSize: 10 });
  const [correcting, setCorrecting] = React.useState(false);
  const checkIn = useApiMutation(() => api.post<AttendanceRecordOut>('/hr/attendance/check-in'), { success: (r) => `Checked in at ${timeOf(r.checkInAt)}${r.isLate ? ' (late)' : ''}`, invalidate: ['/hr/attendance'] });
  const checkOut = useApiMutation(() => api.post<AttendanceRecordOut>('/hr/attendance/check-out'), { success: (r) => `Checked out — ${hoursOf(r.workMinutes)} worked`, invalidate: ['/hr/attendance'] });
  const cancel = useApiMutation((id: string) => api.post(`/hr/attendance/corrections/${id}/cancel`), { success: 'Request withdrawn', invalidate: ['/hr/attendance'] });

  if (!user.employeeId) return <EmptyState title="Attendance is for employees" description="Your account is not linked to an employee record." />;
  const t = today.data;
  const rec = t?.record;

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Check in when you start work and check out when you finish. Times are recorded by the server in IST."
        actions={
          <Button variant="outline" size="sm" onClick={() => setCorrecting(true)}>
            <PencilLine /> Request correction
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t ? formatDate(t.date) : 'Today'} description={t ? `${t.shift.name} · ${t.shift.startTime}–${t.shift.endTime} (grace ${t.shift.graceMinutes} min)` : undefined} />
          <CardBody className="grid gap-4">
            {today.isLoading ? (
              <Skeleton className="h-40" />
            ) : t ? (
              <>
                {t.holiday ? <Alert tone="info">Holiday: {t.holiday}</Alert> : !t.isWorkingDay ? <Alert tone="info">Weekly off</Alert> : null}
                {t.onLeave ? <Alert tone="info">You are on approved leave today ({t.onLeave}).</Alert> : null}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-[12px] text-ink-500">Check-in</p>
                    <p className="tabular mt-0.5 text-xl font-semibold text-ink-900">{timeOf(rec?.checkInAt)}</p>
                    {rec?.isLate ? <Badge tone="warning" size="sm" className="mt-1">Late</Badge> : null}
                  </div>
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-[12px] text-ink-500">Check-out</p>
                    <p className="tabular mt-0.5 text-xl font-semibold text-ink-900">{timeOf(rec?.checkOutAt)}</p>
                    {rec?.checkOutAt ? <p className="mt-1 text-xs text-ink-500">{hoursOf(rec.workMinutes)} worked</p> : null}
                  </div>
                </div>
                {rec ? (
                  <div className="flex items-center gap-2 text-sm text-ink-600">
                    <Clock className="size-4 text-ink-400" /> Status: <StatusBadge status={rec.status} />
                    {rec.checkInAt && !rec.checkOutAt ? <span className="text-xs text-ink-500">(final status set at check-out)</span> : null}
                  </div>
                ) : null}
                {!rec?.checkInAt ? (
                  <Button size="lg" loading={checkIn.isPending} onClick={() => checkIn.mutate(undefined)}>
                    <LogIn /> Check in
                  </Button>
                ) : !rec.checkOutAt ? (
                  <Button size="lg" variant="dark" loading={checkOut.isPending} onClick={() => checkOut.mutate(undefined)}>
                    <LogOut /> Check out
                  </Button>
                ) : (
                  <p className="rounded-lg bg-success-soft px-3 py-2.5 text-sm text-success">You have completed today’s attendance.</p>
                )}
              </>
            ) : (
              <Alert tone="danger">{errorMessage(today.error)}</Alert>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Monthly attendance" actions={<MonthInput value={month} onChange={setMonth} max={currentMonth()} />} />
          <CardBody className="grid gap-5">
            {cal.data ? (
              <>
                <AttendanceSummary data={cal.data} />
                <AttendanceCalendar data={cal.data} />
              </>
            ) : cal.isError ? (
              <Alert tone="danger">{errorMessage(cal.error)}</Alert>
            ) : (
              <Skeleton className="h-80" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="My correction requests" description="Reviewed by your reporting manager or HR." />
        {corrections.data?.data.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Requested times</TH>
                <TH className="hidden md:table-cell">Reason</TH>
                <TH>Status</TH>
                <TH align="right"> </TH>
              </tr>
            </THead>
            <TBody>
              {corrections.data.data.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap">{formatDate(c.date)}</TD>
                  <TD className="whitespace-nowrap">
                    {timeOf(c.requestedCheckIn)} – {timeOf(c.requestedCheckOut)}
                  </TD>
                  <TD className="hidden max-w-sm md:table-cell">
                    <span className="line-clamp-1">{c.reason}</span>
                    {c.reviewNote ? <span className="block text-xs text-ink-500">Reviewer: {c.reviewNote}</span> : null}
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} />
                  </TD>
                  <TD align="right">
                    {c.status === 'PENDING' ? (
                      <Button size="xs" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(c.id)}>
                        Withdraw
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-500">{corrections.isLoading ? 'Loading…' : 'No correction requests.'}</p>
          </CardBody>
        )}
      </Card>
      {correcting ? <CorrectionDialog onClose={() => setCorrecting(false)} onDone={() => void corrections.refetch()} /> : null}
    </>
  );
}

const correctionForm = z
  .object({ date: z.iso.date(), checkIn: z.string().optional(), checkOut: z.string().optional(), reason: z.string().trim().min(5, 'Explain what happened').max(500) })
  .refine((v) => v.checkIn || v.checkOut, { message: 'Enter a check-in or check-out time', path: ['checkIn'] });

function CorrectionDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const form = useForm<z.input<typeof correctionForm>>({ resolver: zodResolver(correctionForm), defaultValues: { date: todayIso(), checkIn: '', checkOut: '', reason: '' } });
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Request attendance correction" description="For a missed check-in/out or a wrong time. Your manager or HR reviews the request.">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api.post('/hr/attendance/corrections', {
                date: v.date,
                requestedCheckIn: v.checkIn ? istInstant(v.date, v.checkIn) : null,
                requestedCheckOut: v.checkOut ? istInstant(v.date, v.checkOut) : null,
                reason: v.reason,
              });
              toast.success('Correction requested');
              onDone();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Date" htmlFor="crDate" required error={errors.date?.message}>
            <Input id="crDate" type="date" max={todayIso()} {...form.register('date')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check-in (IST)" htmlFor="crIn" error={errors.checkIn?.message}>
              <Input id="crIn" type="time" {...form.register('checkIn')} />
            </Field>
            <Field label="Check-out (IST)" htmlFor="crOut" error={errors.checkOut?.message}>
              <Input id="crOut" type="time" {...form.register('checkOut')} />
            </Field>
          </div>
          <Field label="Reason" htmlFor="crReason" required error={errors.reason?.message}>
            <Textarea id="crReason" rows={3} {...form.register('reason')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

