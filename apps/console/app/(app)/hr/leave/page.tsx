'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarCheck, CalendarRange, Pencil, Plus, Scale } from 'lucide-react';
import { formatDate, leaveTypeSchema, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  PageHeader,
  Pagination,
  Segmented,
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
import { MonthInput } from '@/components/hr/pickers';
import { currentMonth, WEEKDAYS, type LeaveBalance, type LeaveRequestRow, type LeaveType } from '@/components/hr/types';

export default function LeaveAdminPage() {
  const { can, user } = useSession();
  const manage = can('leave.manage', user.platformOrganizationId);
  return (
    <>
      <PageHeader title="Leave" description={manage ? 'Approve requests, track who is away and manage leave policies.' : 'Leave requests from your direct reports.'} />
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">
            <CalendarCheck /> Requests
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarRange /> Calendar
          </TabsTrigger>
          {manage ? (
            <TabsTrigger value="balances">
              <Scale /> Balances
            </TabsTrigger>
          ) : null}
          {manage ? <TabsTrigger value="types">Leave types</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="requests">
          <Requests manage={manage} />
        </TabsContent>
        <TabsContent value="calendar">
          <LeaveCalendar />
        </TabsContent>
        {manage ? (
          <TabsContent value="balances">
            <Balances />
          </TabsContent>
        ) : null}
        {manage ? (
          <TabsContent value="types">
            <LeaveTypes />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

function Requests({ manage }: { manage: boolean }) {
  const { values, set, page, setPage } = useListParams<{ lstatus?: string; lscope?: string }>({ lstatus: 'PENDING', lscope: manage ? 'all' : 'team' });
  const scope = (values.lscope ?? (manage ? 'all' : 'team')) as 'all' | 'team';
  const q = useApi<Paginated<LeaveRequestRow> & { statusCounts: Record<string, number> }>('/hr/leave/requests', { scope, status: values.lstatus, page, pageSize: 20 });
  const [deciding, setDeciding] = React.useState<{ r: LeaveRequestRow; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [note, setNote] = React.useState('');
  const decide = useApiMutation((v: { id: string; decision: string; note?: string }) => api.post(`/hr/leave/requests/${v.id}/decision`, { decision: v.decision, note: v.note }), {
    success: (r: unknown) => ((r as { status: string }).status === 'APPROVED' ? 'Leave approved' : 'Leave rejected'),
    invalidate: ['/hr/leave'],
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
          { value: 'CANCELLED', label: 'Cancelled' },
          { value: undefined, label: 'All' },
        ]}
        value={values.lstatus}
        onChange={(v) => set({ lstatus: v })}
        counts={q.data?.statusCounts}
      />
      {manage ? (
        <Toolbar>
          <Segmented
            size="sm"
            value={scope}
            onChange={(v) => set({ lscope: v })}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'team', label: 'My direct reports' },
            ]}
          />
        </Toolbar>
      ) : null}
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <CalendarCheck />, title: values.lstatus === 'PENDING' ? 'No requests waiting for a decision' : 'No leave requests' }}>
        {(d) => (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Leave</TH>
                  <TH>Dates</TH>
                  <TH align="right">Days</TH>
                  <TH className="hidden lg:table-cell">Reason</TH>
                  <TH>Status</TH>
                  <TH align="right">Action</TH>
                </tr>
              </THead>
              <TBody>
                {d.data.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/hr/employees/${r.employee.id}`} className="font-medium text-ink-900 hover:underline">
                        {r.employee.user.fullName}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {r.employee.employeeCode}
                        {r.employee.department ? ` · ${r.employee.department.name}` : ''}
                      </div>
                    </TD>
                    <TD>
                      {r.leaveType.name}
                      {!r.leaveType.isPaid ? <Badge size="sm" tone="warning" className="ml-1.5">Unpaid</Badge> : null}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(r.startDate)}
                      {r.endDate !== r.startDate ? ` – ${formatDate(r.endDate)}` : ''}
                      {r.halfDayStart || r.halfDayEnd ? <span className="block text-[11px] text-ink-500">Includes half day</span> : null}
                    </TD>
                    <TD align="right" className="tabular">{r.days}</TD>
                    <TD className="hidden max-w-xs lg:table-cell">
                      <span className="line-clamp-2">{r.reason}</span>
                      {r.decisionNote ? <span className="mt-0.5 block text-xs text-ink-500">Note: {r.decisionNote}</span> : null}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                      {r.approver ? <div className="mt-0.5 text-[11px] text-ink-500">{r.approver.fullName}</div> : null}
                    </TD>
                    <TD align="right">
                      {r.canDecide ? (
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="outline" onClick={() => setDeciding({ r, decision: 'REJECT' })}>
                            Reject
                          </Button>
                          <Button size="xs" onClick={() => setDeciding({ r, decision: 'APPROVE' })}>
                            Approve
                          </Button>
                        </div>
                      ) : null}
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
          <DialogContent
            title={`${deciding.decision === 'APPROVE' ? 'Approve' : 'Reject'} ${deciding.r.leaveType.name.toLowerCase()}`}
            description={`${deciding.r.employee.user.fullName} · ${formatDate(deciding.r.startDate)}${deciding.r.endDate !== deciding.r.startDate ? ` – ${formatDate(deciding.r.endDate)}` : ''} · ${deciding.r.days} day(s)`}
          >
            <p className="mb-3 rounded-md bg-ink-50 px-3 py-2 text-sm text-ink-700">{deciding.r.reason}</p>
            <Field label={deciding.decision === 'REJECT' ? 'Reason for rejecting' : 'Note (optional)'} htmlFor="lNote" required={deciding.decision === 'REJECT'}>
              <Textarea id="lNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button
                variant={deciding.decision === 'REJECT' ? 'destructive' : 'primary'}
                loading={decide.isPending}
                disabled={deciding.decision === 'REJECT' && note.trim().length < 3}
                onClick={() => decide.mutate({ id: deciding.r.id, decision: deciding.decision, note: note.trim() || undefined })}
              >
                {deciding.decision === 'APPROVE' ? 'Approve' : 'Reject'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

interface CalendarData {
  month: string;
  leaves: { id: string; status: string; startDate: string; endDate: string; days: number; leaveType: { name: string; code: string }; employee: { id: string; employeeCode: string; name: string } }[];
  holidays: { date: string; name: string }[];
}

function LeaveCalendar() {
  const [month, setMonth] = React.useState(currentMonth());
  const q = useApi<CalendarData>('/hr/leave/calendar', { month });
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return (
    <Card>
      <Toolbar>
        <MonthInput value={month} onChange={setMonth} />
        <div className="flex gap-3 text-xs text-ink-500 sm:ml-auto">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-info" /> Approved
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-dashed border-warning" /> Pending
          </span>
        </div>
      </Toolbar>
      <QueryState query={q}>
        {(d) => (
          <div className="overflow-x-auto p-4">
            <div className="grid min-w-[720px] grid-cols-7 gap-1.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-400">
                  {w}
                </div>
              ))}
              {Array.from({ length: firstDow }).map((_, i) => (
                <div key={`p${i}`} />
              ))}
              {dates.map((date) => {
                const holiday = d.holidays.find((h) => h.date === date);
                const away = d.leaves.filter((l) => l.startDate <= date && l.endDate >= date);
                return (
                  <div key={date} className={cn('min-h-24 rounded-md border border-line p-1.5', holiday && 'bg-brand-soft/60')}>
                    <div className="flex items-center justify-between text-[12px] font-semibold text-ink-700">
                      {Number(date.slice(8))}
                      {holiday ? <span className="truncate pl-1 text-[10.5px] font-medium text-brand-strong">{holiday.name}</span> : null}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {away.slice(0, 3).map((l) => (
                        <li key={l.id} title={`${l.employee.name} · ${l.leaveType.name} (${l.status.toLowerCase()})`} className={cn('truncate rounded px-1.5 py-0.5 text-[11px]', l.status === 'APPROVED' ? 'bg-info text-white' : 'border border-dashed border-warning text-warning')}>
                          {l.employee.name.split(' ')[0]} · {l.leaveType.code}
                        </li>
                      ))}
                      {away.length > 3 ? <li className="text-[11px] text-ink-500">+{away.length - 3} more</li> : null}
                    </ul>
                  </div>
                );
              })}
            </div>
            {d.leaves.length === 0 ? <p className="mt-4 text-center text-sm text-ink-500">Nobody is on leave this month.</p> : null}
          </div>
        )}
      </QueryState>
    </Card>
  );
}

function Balances() {
  const [year, setYear] = React.useState(new Date().getUTCFullYear());
  const q = useApi<LeaveBalance[]>('/hr/leave/balances', { year });
  const types = useApi<LeaveType[]>('/hr/leave/types');
  const [editing, setEditing] = React.useState<LeaveBalance | null>(null);
  const allocate = useApiMutation(() => api.post<{ created: number }>('/hr/leave/balances/allocate-year', { year, carryForward: true }), {
    success: (r) => (r.created ? `Created ${r.created} balance(s) for ${year}` : `All balances for ${year} already exist`),
    invalidate: ['/hr/leave/balances'],
  });
  const activeTypes = (types.data ?? []).filter((t) => t.isActive);
  const byEmployee = React.useMemo(() => {
    const map = new Map<string, { employee: LeaveBalance['employee']; balances: Map<string, LeaveBalance> }>();
    for (const b of q.data ?? []) {
      const e = map.get(b.employee.id) ?? { employee: b.employee, balances: new Map() };
      e.balances.set(b.leaveType.id, b);
      map.set(b.employee.id, e);
    }
    return [...map.values()];
  }, [q.data]);
  return (
    <Card>
      <Toolbar>
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="w-28">
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <p className="text-xs text-ink-500">Available = allocated + carried forward − used. Click a cell to adjust an allocation.</p>
        <Button size="sm" variant="outline" className="sm:ml-auto" loading={allocate.isPending} onClick={() => allocate.mutate(undefined)}>
          Allocate {year} balances
        </Button>
      </Toolbar>
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Scale />, title: `No balances for ${year}`, description: 'Use “Allocate” to create balances for every active employee (carrying forward where the leave type allows).' }}>
        {() => (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                {activeTypes.map((t) => (
                  <TH key={t.id} align="right">
                    {t.code}
                  </TH>
                ))}
              </tr>
            </THead>
            <TBody>
              {byEmployee.map((row) => (
                <TR key={row.employee.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{row.employee.name}</div>
                    <div className="text-xs text-ink-500">{row.employee.employeeCode}</div>
                  </TD>
                  {activeTypes.map((t) => {
                    const b = row.balances.get(t.id);
                    return (
                      <TD key={t.id} align="right">
                        {b ? (
                          <button type="button" onClick={() => setEditing(b)} className="tabular rounded px-1.5 py-0.5 text-right hover:bg-ink-100" title={`Allocated ${b.allocated} + carried ${b.carriedForward} − used ${b.used}${b.pending ? ` (pending ${b.pending})` : ''}`}>
                            <span className="font-semibold text-ink-900">{t.isPaid ? b.available : '—'}</span>
                            <span className="text-xs text-ink-500"> / {b.allocated + b.carriedForward}</span>
                          </button>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      {editing ? <BalanceDialog balance={editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </Card>
  );
}

function BalanceDialog({ balance, onClose, onSaved }: { balance: LeaveBalance; onClose: () => void; onSaved: () => void }) {
  const [allocated, setAllocated] = React.useState(String(balance.allocated));
  const [carried, setCarried] = React.useState(String(balance.carriedForward));
  const save = useApiMutation(
    () => api.put('/hr/leave/balances', { employeeId: balance.employee.id, leaveTypeId: balance.leaveType.id, year: balance.year, allocated: Number(allocated), carriedForward: Number(carried) }),
    {
      success: 'Balance updated',
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${balance.leaveType.name} — ${balance.employee.name}`} description={`${balance.year} · ${balance.used} day(s) already used`} size="sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Allocated" htmlFor="bAlloc">
            <Input id="bAlloc" type="number" step="0.5" min={0} value={allocated} onChange={(e) => setAllocated(e.target.value)} />
          </Field>
          <Field label="Carried forward" htmlFor="bCarry">
            <Input id="bCarry" type="number" step="0.5" min={0} value={carried} onChange={(e) => setCarried(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTypes() {
  const q = useApi<LeaveType[]>('/hr/leave/types');
  const [editing, setEditing] = React.useState<LeaveType | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="Leave types"
        description="Annual quotas and rules are configured here — nothing is hard-coded."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add leave type
          </Button>
        }
      />
      <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ title: 'No leave types yet' }}>
        {(rows) => (
          <Table>
            <THead>
              <tr>
                <TH>Leave type</TH>
                <TH>Pay</TH>
                <TH align="right">Annual quota</TH>
                <TH className="hidden md:table-cell">Carry forward</TH>
                <TH className="hidden md:table-cell">Half days</TH>
                <TH>Status</TH>
                <TH align="right">Edit</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <span className="font-medium text-ink-900">{t.name}</span> <span className="text-xs text-ink-500">{t.code}</span>
                  </TD>
                  <TD>{t.isPaid ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Unpaid</Badge>}</TD>
                  <TD align="right" className="tabular">{t.isPaid ? Number(t.annualQuota) : '—'}</TD>
                  <TD className="hidden md:table-cell">{t.carryForward ? `Yes${t.maxCarryForward != null ? ` (max ${Number(t.maxCarryForward)})` : ''}` : 'No'}</TD>
                  <TD className="hidden md:table-cell">{t.allowHalfDay ? 'Allowed' : 'Not allowed'}</TD>
                  <TD>{t.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                  <TD align="right">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                      <Pencil />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      {editing ? <LeaveTypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </Card>
  );
}

function LeaveTypeDialog({ type, onClose, onSaved }: { type: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof leaveTypeSchema>>({
    resolver: zodResolver(leaveTypeSchema),
    defaultValues: type
      ? { name: type.name, code: type.code, isPaid: type.isPaid, annualQuota: Number(type.annualQuota), carryForward: type.carryForward, maxCarryForward: type.maxCarryForward === null ? null : Number(type.maxCarryForward), allowHalfDay: type.allowHalfDay, isActive: type.isActive }
      : { name: '', code: '', isPaid: true, annualQuota: 0, carryForward: false, allowHalfDay: true, isActive: true },
  });
  const errors = form.formState.errors;
  const carry = form.watch('carryForward');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={type ? `Edit ${type.name}` : 'Add leave type'}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              if (type) await api.patch(`/hr/leave/types/${type.id}`, v);
              else await api.post('/hr/leave/types', v);
              toast.success('Leave type saved');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Name" htmlFor="ltName" required error={errors.name?.message}>
              <Input id="ltName" {...form.register('name')} />
            </Field>
            <Field label="Code" htmlFor="ltCode" required error={errors.code?.message}>
              <Input id="ltCode" className="uppercase" {...form.register('code')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Annual quota (days)" htmlFor="ltQuota" error={errors.annualQuota?.message}>
              <Input id="ltQuota" type="number" step="0.5" min={0} {...form.register('annualQuota')} />
            </Field>
            {carry ? (
              <Field label="Max carry forward (days)" htmlFor="ltMaxCf" hint="Blank = no limit">
                <Input id="ltMaxCf" type="number" step="0.5" min={0} {...form.register('maxCarryForward', { setValueAs: (v) => (v === '' ? null : Number(v)) })} />
              </Field>
            ) : null}
          </div>
          <div className="grid gap-3">
            <CheckboxField label="Paid leave" description="Unpaid leave days are deducted as loss of pay in payroll." checked={form.watch('isPaid') !== false} onCheckedChange={(v) => form.setValue('isPaid', Boolean(v), { shouldDirty: true })} />
            <CheckboxField label="Carry unused days to next year" checked={Boolean(carry)} onCheckedChange={(v) => form.setValue('carryForward', Boolean(v), { shouldDirty: true })} />
            <CheckboxField label="Allow half days" checked={form.watch('allowHalfDay') !== false} onCheckedChange={(v) => form.setValue('allowHalfDay', Boolean(v), { shouldDirty: true })} />
            <CheckboxField label="Active" checked={form.watch('isActive') !== false} onCheckedChange={(v) => form.setValue('isActive', Boolean(v), { shouldDirty: true })} />
          </div>
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

