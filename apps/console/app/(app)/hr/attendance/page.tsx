'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, ClipboardCheck, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { ATTENDANCE_STATUSES, enumLabel, formatDate, formatDateTime, shiftSchema, holidaySchema, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  cn,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { DateInput, DepartmentFilter, MonthInput } from '@/components/hr/pickers';
import { currentMonth, hoursOf, istInstant, timeOf, todayIso, WEEKDAYS, type AttendanceRecordOut, type Shift } from '@/components/hr/types';

interface BoardRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  avatarUrl: string | null;
  department: string | null;
  designation: string | null;
  shift: string;
  state: string;
  leave: string | null;
  record: AttendanceRecordOut | null;
}
interface Board {
  date: string;
  holiday: string | null;
  rows: BoardRow[];
  summary: Record<string, number>;
  late: number;
}
interface ReportRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  workingDays: number;
  present: number;
  halfDay: number;
  absent: number;
  late: number;
  leaveDays: number;
  notMarked: number;
  workHours: number;
}
interface Correction {
  id: string;
  date: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  employee: { id: string; employeeCode: string; user: { fullName: string } };
  attendance: AttendanceRecordOut | null;
  reviewedBy: { fullName: string } | null;
}

export default function AttendanceAdminPage() {
  const { can, user } = useSession();
  const manage = can('attendance.manage', user.platformOrganizationId);
  return (
    <>
      <PageHeader title="Attendance" description={manage ? 'Daily attendance, monthly summaries, correction requests and shift settings.' : 'Attendance of your direct reports.'} />
      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">
            <CalendarDays /> Daily board
          </TabsTrigger>
          <TabsTrigger value="report">Monthly report</TabsTrigger>
          <TabsTrigger value="corrections">
            <ClipboardCheck /> Corrections
          </TabsTrigger>
          {manage ? (
            <TabsTrigger value="settings">
              <Settings2 /> Shifts & holidays
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="today">
          <DailyBoard manage={manage} />
        </TabsContent>
        <TabsContent value="report">
          <MonthlyReport />
        </TabsContent>
        <TabsContent value="corrections">
          <CorrectionsQueue />
        </TabsContent>
        {manage ? (
          <TabsContent value="settings">
            <ShiftsAndHolidays />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

function DailyBoard({ manage }: { manage: boolean }) {
  const { user } = useSession();
  const [date, setDate] = React.useState(todayIso());
  const [dept, setDept] = React.useState<string | undefined>();
  const q = useApi<Board>('/hr/attendance/board', { date, departmentId: dept });
  const [editing, setEditing] = React.useState<BoardRow | null>(null);
  const summary = q.data?.summary ?? {};
  return (
    <Card>
      <Toolbar>
        <DateInput value={date} onChange={setDate} max={todayIso()} />
        <DepartmentFilter value={dept} onChange={setDept} />
        {q.data ? (
          <div className="flex flex-wrap gap-1.5 sm:ml-auto">
            {q.data.holiday ? <Badge tone="brand">Holiday: {q.data.holiday}</Badge> : null}
            {['PRESENT', 'HALF_DAY', 'ON_LEAVE', 'ABSENT', 'NOT_MARKED'].map((s) => (summary[s] ? <StatusBadge key={s} status={s === 'NOT_MARKED' ? 'MISSED' : s} label={`${enumLabel(s)} ${summary[s]}`} /> : null))}
            {q.data.late ? <Badge tone="warning">Late {q.data.late}</Badge> : null}
          </div>
        ) : null}
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.rows.length === 0} empty={{ icon: <CalendarDays />, title: 'No employees in scope', description: 'Employees reporting to you appear here.' }}>
        {(d) => (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH className="hidden md:table-cell">Shift</TH>
                <TH>Status</TH>
                <TH>Check-in</TH>
                <TH className="hidden sm:table-cell">Check-out</TH>
                <TH className="hidden sm:table-cell" align="right">
                  Worked
                </TH>
                {manage ? <TH align="right">Edit</TH> : null}
              </tr>
            </THead>
            <TBody>
              {d.rows.map((r) => (
                <TR key={r.employeeId}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.name} src={r.avatarUrl} size={30} />
                      <div className="min-w-0">
                        <Link href={`/hr/employees/${r.employeeId}`} className="block truncate font-medium text-ink-900 hover:underline">
                          {r.name}
                        </Link>
                        <div className="truncate text-xs text-ink-500">{r.designation ?? r.employeeCode}</div>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-600 md:table-cell">{r.shift}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      {r.state === 'NOT_MARKED' ? <Badge tone="outline">Not marked</Badge> : <StatusBadge status={r.state} />}
                      {r.leave ? <span className="text-[11px] text-info">{r.leave}</span> : null}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {timeOf(r.record?.checkInAt)}
                    {r.record?.isLate ? <Badge tone="warning" size="sm" className="ml-1.5">Late</Badge> : null}
                  </TD>
                  <TD className="hidden whitespace-nowrap sm:table-cell">{timeOf(r.record?.checkOutAt)}</TD>
                  <TD className="tabular hidden sm:table-cell" align="right">
                    {hoursOf(r.record?.workMinutes ?? 0)}
                  </TD>
                  {manage ? (
                    <TD align="right">
                      {r.employeeId !== user.employeeId ? (
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit attendance for ${r.name}`} onClick={() => setEditing(r)}>
                          <Pencil />
                        </Button>
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      {editing ? <ManualEntryDialog row={editing} date={date} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </Card>
  );
}

const manualForm = z.object({ status: z.enum(ATTENDANCE_STATUSES), checkIn: z.string().optional(), checkOut: z.string().optional(), notes: z.string().trim().max(500).optional() });

function ManualEntryDialog({ row, date, onClose, onSaved }: { row: BoardRow; date: string; onClose: () => void; onSaved: () => void }) {
  const hhmm = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '');
  const form = useForm<z.input<typeof manualForm>>({
    resolver: zodResolver(manualForm),
    defaultValues: { status: (row.record?.status as never) ?? 'PRESENT', checkIn: hhmm(row.record?.checkInAt), checkOut: hhmm(row.record?.checkOutAt), notes: row.record?.notes ?? '' },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Attendance — ${row.name}`} description={`${formatDate(date)} · times are in IST. Saved as a manual entry with an audit record.`}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api.put('/hr/attendance/manual', {
                employeeId: row.employeeId,
                date,
                status: v.status,
                checkInAt: v.checkIn ? istInstant(date, v.checkIn) : null,
                checkOutAt: v.checkOut ? istInstant(date, v.checkOut) : null,
                notes: v.notes || null,
              });
              toast.success('Attendance saved');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Status" htmlFor="mStatus">
            <Select id="mStatus" {...form.register('status')}>
              {ATTENDANCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {enumLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check-in" htmlFor="mIn">
              <Input id="mIn" type="time" {...form.register('checkIn')} />
            </Field>
            <Field label="Check-out" htmlFor="mOut">
              <Input id="mOut" type="time" {...form.register('checkOut')} />
            </Field>
          </div>
          <Field label="Note" htmlFor="mNotes" hint="Why the record was changed">
            <Textarea id="mNotes" rows={2} {...form.register('notes')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MonthlyReport() {
  const [month, setMonth] = React.useState(currentMonth());
  const [dept, setDept] = React.useState<string | undefined>();
  const q = useApi<{ month: string; rows: ReportRow[] }>('/hr/attendance/report', { month, departmentId: dept });
  return (
    <Card>
      <Toolbar>
        <MonthInput value={month} onChange={setMonth} max={currentMonth()} />
        <DepartmentFilter value={dept} onChange={setDept} />
        <p className="text-xs text-ink-500 sm:ml-auto">“Not marked” counts working days up to yesterday with no record and no approved leave.</p>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.rows.length === 0} empty={{ icon: <CalendarDays />, title: 'No employees in scope' }}>
        {(d) => (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH align="right">Working days</TH>
                <TH align="right">Present</TH>
                <TH align="right">Half days</TH>
                <TH align="right">Absent</TH>
                <TH align="right">Leave</TH>
                <TH align="right">Not marked</TH>
                <TH align="right">Late</TH>
                <TH align="right">Hours</TH>
              </tr>
            </THead>
            <TBody>
              {d.rows.map((r) => (
                <TR key={r.employeeId}>
                  <TD>
                    <Link href={`/hr/employees/${r.employeeId}`} className="font-medium text-ink-900 hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-ink-500">
                      {r.employeeCode}
                      {r.department ? ` · ${r.department}` : ''}
                    </div>
                  </TD>
                  {[r.workingDays, r.present, r.halfDay, r.absent, r.leaveDays, r.notMarked, r.late, r.workHours].map((v, i) => (
                    <TD key={i} align="right" className={cn('tabular', (i === 3 || i === 5) && v > 0 && 'font-semibold text-danger', i === 6 && v > 0 && 'text-warning')}>
                      {v}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
    </Card>
  );
}

function CorrectionsQueue() {
  const { values, set, page, setPage } = useListParams<{ cstatus?: string }>({ cstatus: 'PENDING' });
  const q = useApi<Paginated<Correction>>('/hr/attendance/corrections', { scope: 'review', status: values.cstatus, page, pageSize: 20 });
  const [deciding, setDeciding] = React.useState<{ c: Correction; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [note, setNote] = React.useState('');
  const decide = useApiMutation((v: { id: string; decision: string; note?: string }) => api.post(`/hr/attendance/corrections/${v.id}/decision`, { decision: v.decision, note: v.note }), {
    success: 'Decision recorded',
    invalidate: ['/hr/attendance'],
    onSuccess: () => {
      setDeciding(null);
      setNote('');
    },
  });
  return (
    <Card>
      <StatusTabs
        tabs={[
          { value: 'PENDING', label: 'Pending' },
          { value: 'APPROVED', label: 'Approved' },
          { value: 'REJECTED', label: 'Rejected' },
          { value: undefined, label: 'All' },
        ]}
        value={values.cstatus}
        onChange={(v) => set({ cstatus: v })}
      />
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ClipboardCheck />, title: 'No correction requests', description: 'Requests submitted by employees appear here for review.' }}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Date</TH>
                  <TH>Requested</TH>
                  <TH className="hidden md:table-cell">Recorded</TH>
                  <TH className="hidden lg:table-cell">Reason</TH>
                  <TH>Status</TH>
                  <TH align="right">Action</TH>
                </tr>
              </THead>
              <TBody>
                {d.data.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <div className="font-medium text-ink-900">{c.employee.user.fullName}</div>
                      <div className="text-xs text-ink-500">{c.employee.employeeCode}</div>
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(c.date)}</TD>
                    <TD className="whitespace-nowrap">
                      {timeOf(c.requestedCheckIn)} – {timeOf(c.requestedCheckOut)}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-500 md:table-cell">{c.attendance ? `${timeOf(c.attendance.checkInAt)} – ${timeOf(c.attendance.checkOutAt)}` : 'No record'}</TD>
                    <TD className="hidden max-w-xs lg:table-cell">
                      <span className="line-clamp-2">{c.reason}</span>
                    </TD>
                    <TD>
                      <StatusBadge status={c.status} />
                      {c.reviewedBy ? <div className="mt-0.5 text-[11px] text-ink-500">{c.reviewedBy.fullName}</div> : null}
                    </TD>
                    <TD align="right">
                      {c.status === 'PENDING' ? (
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="outline" onClick={() => setDeciding({ c, decision: 'REJECT' })}>
                            Reject
                          </Button>
                          <Button size="xs" onClick={() => setDeciding({ c, decision: 'APPROVE' })}>
                            Approve
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-500">{c.reviewedAt ? formatDateTime(c.reviewedAt) : ''}</span>
                      )}
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
      <Dialog open={Boolean(deciding)} onOpenChange={(o) => !o && setDeciding(null)}>
        {deciding ? (
          <DialogContent title={deciding.decision === 'APPROVE' ? 'Approve correction' : 'Reject correction'} description={`${deciding.c.employee.user.fullName} · ${formatDate(deciding.c.date)} · ${timeOf(deciding.c.requestedCheckIn)} – ${timeOf(deciding.c.requestedCheckOut)}`}>
            <p className="mb-3 rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">{deciding.c.reason}</p>
            <Field label={deciding.decision === 'REJECT' ? 'Reason for rejecting' : 'Note (optional)'} htmlFor="cNote" required={deciding.decision === 'REJECT'}>
              <Textarea id="cNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button
                variant={deciding.decision === 'REJECT' ? 'destructive' : 'primary'}
                loading={decide.isPending}
                disabled={deciding.decision === 'REJECT' && note.trim().length < 3}
                onClick={() => decide.mutate({ id: deciding.c.id, decision: deciding.decision, note: note.trim() || undefined })}
              >
                {deciding.decision === 'APPROVE' ? 'Approve & update attendance' : 'Reject'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function ShiftsAndHolidays() {
  const shifts = useApi<Shift[]>('/hr/shifts');
  const [year, setYear] = React.useState(new Date().getUTCFullYear());
  const holidays = useApi<{ id: string; date: string; name: string; isOptional: boolean }[]>('/hr/holidays', { year });
  const [editShift, setEditShift] = React.useState<Shift | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<{ id: string; name: string } | null>(null);
  const hForm = useForm<z.input<typeof holidaySchema>>({ resolver: zodResolver(holidaySchema), defaultValues: { date: '', name: '', isOptional: false } });
  const remove = useApiMutation((id: string) => api.delete(`/hr/holidays/${id}`), { success: 'Holiday removed', invalidate: ['/hr/holidays'], onSuccess: () => setRemoving(null) });
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title="Shifts"
          description="Weekly offs and timings drive late marks, working days and leave counts."
          actions={
            <Button size="sm" onClick={() => setEditShift('new')}>
              <Plus /> Add shift
            </Button>
          }
        />
        <QueryState query={shifts} isEmpty={(d) => d.length === 0} empty={{ title: 'No shifts configured' }}>
          {(rows) => (
            <Table>
              <THead>
                <tr>
                  <TH>Shift</TH>
                  <TH>Timing</TH>
                  <TH className="hidden md:table-cell">Weekly off</TH>
                  <TH align="right">Employees</TH>
                  <TH align="right">Edit</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <span className="font-medium text-ink-900">{s.name}</span> {s.isDefault ? <Badge tone="brand" size="sm">Default</Badge> : null}
                      <div className="text-xs text-ink-500">
                        Grace {s.graceMinutes} min · full day {s.fullDayMinutes / 60}h · half day {s.halfDayMinutes / 60}h
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {s.startTime} – {s.endTime}
                    </TD>
                    <TD className="hidden md:table-cell">{s.weeklyOffDays.map((d) => WEEKDAYS[d]).join(', ') || 'None'}</TD>
                    <TD align="right" className="tabular">{s._count?.employees ?? 0}</TD>
                    <TD align="right">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditShift(s)}>
                        <Pencil />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <Card>
        <CardHeader
          title="Holidays"
          actions={
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="w-28">
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          }
        />
        <form
          noValidate
          className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-start"
          onSubmit={hForm.handleSubmit(async (v) => {
            try {
              await api.post('/hr/holidays', v);
              toast.success('Holiday added');
              hForm.reset({ date: '', name: '', isOptional: false });
              void holidays.refetch();
            } catch (err) {
              if (!applyServerErrors(hForm, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field error={hForm.formState.errors.date?.message} className="sm:w-40">
            <Input type="date" aria-label="Holiday date" {...hForm.register('date')} />
          </Field>
          <Field error={hForm.formState.errors.name?.message} className="flex-1">
            <Input placeholder="Holiday name" aria-label="Holiday name" {...hForm.register('name')} />
          </Field>
          <Button type="submit" variant="outline" loading={hForm.formState.isSubmitting}>
            <Plus /> Add
          </Button>
        </form>
        <QueryState query={holidays} isEmpty={(d) => d.length === 0} empty={{ title: `No holidays in ${year}` }}>
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span>
                    <span className="tabular font-medium text-ink-900">{formatDate(h.date)}</span> <span className="text-ink-600">· {h.name}</span>
                    {h.isOptional ? <Badge size="sm" className="ml-1.5">Optional</Badge> : null}
                  </span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => setRemoving(h)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
      {editShift ? <ShiftDialog shift={editShift === 'new' ? null : editShift} onClose={() => setEditShift(null)} onSaved={() => void shifts.refetch()} /> : null}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove holiday?"
        description={removing ? `${removing.name} will count as a working day for leave and payroll.` : undefined}
        tone="danger"
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

function ShiftDialog({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema),
    defaultValues: shift
      ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, graceMinutes: shift.graceMinutes, fullDayMinutes: shift.fullDayMinutes, halfDayMinutes: shift.halfDayMinutes, weeklyOffDays: shift.weeklyOffDays, timezone: shift.timezone, isDefault: shift.isDefault }
      : { name: '', startTime: '09:30', endTime: '18:30', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffDays: [0], timezone: 'Asia/Kolkata', isDefault: false },
  });
  const offs = (form.watch('weeklyOffDays') ?? []) as number[];
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={shift ? `Edit ${shift.name}` : 'Add shift'} size="lg">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              if (shift) await api.patch(`/hr/shifts/${shift.id}`, v);
              else await api.post('/hr/shifts', v);
              toast.success('Shift saved');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Name" htmlFor="sName" required error={errors.name?.message}>
            <Input id="sName" {...form.register('name')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Starts" htmlFor="sStart" error={errors.startTime?.message}>
              <Input id="sStart" type="time" {...form.register('startTime')} />
            </Field>
            <Field label="Ends" htmlFor="sEnd" error={errors.endTime?.message}>
              <Input id="sEnd" type="time" {...form.register('endTime')} />
            </Field>
            <Field label="Grace (minutes)" htmlFor="sGrace" error={errors.graceMinutes?.message}>
              <Input id="sGrace" type="number" min={0} {...form.register('graceMinutes')} />
            </Field>
            <Field label="Full day (minutes)" htmlFor="sFull" error={errors.fullDayMinutes?.message}>
              <Input id="sFull" type="number" min={60} {...form.register('fullDayMinutes')} />
            </Field>
            <Field label="Half day (minutes)" htmlFor="sHalf" hint="Below this counts as absent" error={errors.halfDayMinutes?.message}>
              <Input id="sHalf" type="number" min={30} {...form.register('halfDayMinutes')} />
            </Field>
          </div>
          <Field label="Weekly off days">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={offs.includes(i)}
                  onClick={() => form.setValue('weeklyOffDays', offs.includes(i) ? offs.filter((x) => x !== i) : [...offs, i].sort(), { shouldDirty: true })}
                  className={cn('rounded-md border px-3 py-1.5 text-sm font-medium transition-colors', offs.includes(i) ? 'border-brand bg-brand-soft text-ink-900' : 'border-line text-ink-600 hover:border-ink-300')}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
          <CheckboxField label="Default shift for employees without one" checked={Boolean(form.watch('isDefault'))} onCheckedChange={(v) => form.setValue('isDefault', Boolean(v), { shouldDirty: true })} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save shift
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
