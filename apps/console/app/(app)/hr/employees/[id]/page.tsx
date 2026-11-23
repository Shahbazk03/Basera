'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, ChevronLeft, ChevronRight, Eye, FileText, Landmark, LogOut, ShieldCheck, Wallet } from 'lucide-react';
import { EMPLOYEE_DOCUMENT_TYPES, employeeCreateSchema, employeeExitSchema, employeeSensitiveSchema, enumLabel, formatDate, formatDateTime, formatINR, localDateString, type Paginated } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
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
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { DocumentUpload, openDocument } from '@/components/uploaders';
import { JobFields, PersonalFields, useJobOptionsReady } from '@/components/hr/employee-form-fields';
import { AttendanceCalendar, AttendanceSummary } from '@/components/hr/attendance-calendar';
import { MonthInput } from '@/components/hr/pickers';
import { currentMonth, type AttendanceMonth, type LeaveRequestRow } from '@/components/hr/types';

interface EmployeeDetail {
  id: string;
  employeeCode: string;
  user: { id: string; fullName: string; email: string | null; phone: string | null; avatarUrl: string | null; status: string; lastLoginAt: string | null };
  roles: { key: string; name: string; scope: string }[];
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  shift: { id: string; name: string; startTime: string; endTime: string; weeklyOffDays: number[] } | null;
  manager: { id: string; name: string; employeeCode: string } | null;
  managerChain: { id: string; name: string; designation: string | null }[];
  reports: { id: string; employeeCode: string; name: string; designation: string | null }[];
  joiningDate: string;
  exitDate: string | null;
  employmentType: string;
  employmentStatus: string;
  workLocation: string | null;
  personal: { dateOfBirth: string | null; gender: string | null; personalEmail: string | null; emergencyContact: string | null; bankAccountLast4: string | null; hasBankDetails: boolean; panMasked: string | null } | null;
  documents: { id: string; docType: string; title: string; createdAt: string; uploadedBy: string | null; file: { id: string; fileName: string } }[];
  leaveBalances: { leaveTypeId: string; name: string; code: string; isPaid: boolean; allocated: number; carriedForward: number; used: number; available: number }[];
  salary: { id: string; effectiveFrom: string; lines: { code: string; name: string; type: string; calcType: string; value: number }[] } | null;
  isDemo: boolean;
  access: { self: boolean; manager: boolean; manage: boolean; salary: boolean; payrollManage: boolean };
}

const jobSchema = employeeCreateSchema.pick({ employeeCode: true, departmentId: true, designationId: true, managerId: true, shiftId: true, joiningDate: true, employmentType: true, employmentStatus: true, workLocation: true });
const personalSchema = employeeCreateSchema.pick({ fullName: true, phone: true, dateOfBirth: true, gender: true, personalEmail: true, emergencyContact: true });

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<EmployeeDetail>(`/hr/employees/${id}`);
  const [exitOpen, setExitOpen] = React.useState(false);
  const e = q.data;

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!e)
    return (
      <EmptyState
        title="Employee not found"
        description={q.error ? errorMessage(q.error) : 'The employee may not exist or you do not have access.'}
        action={
          <Button asChild variant="outline">
            <Link href="/hr/employees">Back to employees</Link>
          </Button>
        }
      />
    );

  const canEdit = e.access.manage && !e.access.self;
  const exited = e.employmentStatus === 'EXITED';

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/hr/employees" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Employees
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={e.user.fullName} src={e.user.avatarUrl} size={44} />
            <span>{e.user.fullName}</span>
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusBadge status={e.employmentStatus} />
            {e.isDemo ? <Badge tone="outline">Demo data</Badge> : null}
            <span className="tabular">{e.employeeCode}</span>
            <span aria-hidden>·</span>
            <span>{e.designation?.name ?? 'No designation'}</span>
            {e.department ? (
              <>
                <span aria-hidden>·</span>
                <span>{e.department.name}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          canEdit && !exited ? (
            <Button variant="destructive-outline" size="sm" onClick={() => setExitOpen(true)}>
              <LogOut /> Record exit
            </Button>
          ) : null
        }
      />
      {exited ? (
        <Alert tone="warning" className="mb-5" title={`Exited on ${formatDate(e.exitDate)}`}>
          Login access is disabled. Records are kept for payroll, audit and reporting.
        </Alert>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {e.personal ? <TabsTrigger value="personal">Personal</TabsTrigger> : null}
          <TabsTrigger value="documents">
            <FileText /> Documents
          </TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="attendance">
            <CalendarDays /> Attendance
          </TabsTrigger>
          {e.access.salary ? (
            <TabsTrigger value="salary">
              <Wallet /> Salary
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid gap-5">
              <Card>
                <CardHeader title="Employment" />
                <CardBody>
                  <DescriptionList
                    columns={3}
                    items={[
                      { label: 'Work email', value: e.user.email },
                      { label: 'Mobile', value: e.user.phone ?? '—' },
                      { label: 'Joined', value: formatDate(e.joiningDate) },
                      { label: 'Employment type', value: enumLabel(e.employmentType) },
                      { label: 'Work location', value: e.workLocation ?? '—' },
                      { label: 'Shift', value: e.shift ? `${e.shift.name} (${e.shift.startTime}–${e.shift.endTime})` : 'Default shift' },
                      { label: 'Login', value: e.user.status === 'ACTIVE' ? `Active${e.user.lastLoginAt ? ` · last sign-in ${formatDateTime(e.user.lastLoginAt)}` : ''}` : enumLabel(e.user.status) },
                      { label: 'Roles', value: e.roles.length ? e.roles.map((r) => r.name).join(', ') : 'Self-service only' },
                    ]}
                  />
                </CardBody>
              </Card>
              {canEdit && !exited ? <JobEditor employee={e} onSaved={() => void q.refetch()} /> : null}
            </div>
            <div className="grid content-start gap-5">
              <Card>
                <CardHeader title="Reporting line" />
                <CardBody>
                  {e.managerChain.length ? (
                    <ol className="space-y-2">
                      {e.managerChain.map((m, i) => (
                        <li key={m.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: i * 12 }}>
                          <ChevronRight className="size-3.5 text-ink-400" />
                          <Link href={`/hr/employees/${m.id}`} className="font-medium text-ink-900 hover:underline">
                            {m.name}
                          </Link>
                          <span className="text-xs text-ink-500">{m.designation}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-ink-500">Does not report to anyone.</p>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title={`Direct reports (${e.reports.length})`} />
                {e.reports.length ? (
                  <ul className="divide-y divide-line">
                    {e.reports.map((r) => (
                      <li key={r.id}>
                        <Link href={`/hr/employees/${r.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-ink-50">
                          <span className="font-medium text-ink-900">{r.name}</span>
                          <span className="text-xs text-ink-500">{r.designation ?? r.employeeCode}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <CardBody>
                    <p className="text-sm text-ink-500">No direct reports.</p>
                  </CardBody>
                )}
              </Card>
            </div>
          </div>
        </TabsContent>

        {e.personal ? (
          <TabsContent value="personal">
            <div className="grid gap-5 lg:grid-cols-2">
              <PersonalEditor employee={e} canEdit={canEdit && !exited} onSaved={() => void q.refetch()} />
              <BankCard employee={e} canEdit={canEdit} onSaved={() => void q.refetch()} />
            </div>
          </TabsContent>
        ) : null}

        <TabsContent value="documents">
          <DocumentsTab employee={e} onChanged={() => void q.refetch()} />
        </TabsContent>

        <TabsContent value="leave">
          <LeaveTab employee={e} />
        </TabsContent>

        <TabsContent value="attendance">
          <AttendanceTab employeeId={e.id} />
        </TabsContent>

        {e.access.salary ? (
          <TabsContent value="salary">
            <Card>
              <CardHeader
                title="Current salary structure"
                description={e.salary ? `Effective from ${formatDate(e.salary.effectiveFrom)}` : undefined}
                actions={
                  e.access.payrollManage && !e.access.self ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/payroll/structures/${e.id}`}>Manage structure</Link>
                    </Button>
                  ) : null
                }
              />
              {e.salary ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Component</TH>
                      <TH>Type</TH>
                      <TH align="right">Configured value</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {e.salary.lines.map((l) => (
                      <TR key={l.code}>
                        <TD>
                          <span className="font-medium text-ink-900">{l.name}</span> <span className="text-xs text-ink-500">{l.code}</span>
                        </TD>
                        <TD>
                          <Badge tone={l.type === 'EARNING' ? 'success' : 'warning'}>{enumLabel(l.type)}</Badge>
                        </TD>
                        <TD align="right" className="tabular">
                          {l.calcType === 'FIXED' ? `${formatINR(l.value, { precise: true })} / month` : `${l.value}% ${enumLabel(l.calcType).replace('% of ', 'of ')}`}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState icon={<Wallet />} title="No salary structure" description="A salary structure is needed before this employee can be included in payroll." />
              )}
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <ExitDialog open={exitOpen} onOpenChange={setExitOpen} employee={e} onDone={() => void q.refetch()} />
    </>
  );
}

function JobEditor({ employee, onSaved }: { employee: EmployeeDetail; onSaved: () => void }) {
  const ready = useJobOptionsReady();
  if (!ready) return <Skeleton className="h-72" />;
  return <JobEditorForm employee={employee} onSaved={onSaved} />;
}

function JobEditorForm({ employee, onSaved }: { employee: EmployeeDetail; onSaved: () => void }) {
  const form = useForm<z.input<typeof jobSchema>>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      employeeCode: employee.employeeCode,
      departmentId: employee.department?.id ?? null,
      designationId: employee.designation?.id ?? null,
      managerId: employee.manager?.id ?? null,
      shiftId: employee.shift?.id ?? null,
      joiningDate: employee.joiningDate,
      employmentType: employee.employmentType as never,
      employmentStatus: employee.employmentStatus as never,
      workLocation: employee.workLocation,
    },
  });
  return (
    <Card>
      <CardHeader title="Edit job details" />
      <CardBody>
        <form
          noValidate
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api.patch(`/hr/employees/${employee.id}`, v);
              toast.success('Job details saved');
              onSaved();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <JobFields register={form.register} errors={form.formState.errors as never} selfId={employee.id} />
          <div className="flex items-end justify-end sm:col-span-2 lg:col-span-3">
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
              Save job details
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PersonalEditor({ employee, canEdit, onSaved }: { employee: EmployeeDetail; canEdit: boolean; onSaved: () => void }) {
  const p = employee.personal!;
  const form = useForm<z.input<typeof personalSchema>>({
    resolver: zodResolver(personalSchema),
    defaultValues: { fullName: employee.user.fullName, phone: employee.user.phone, dateOfBirth: p.dateOfBirth, gender: p.gender, personalEmail: p.personalEmail, emergencyContact: p.emergencyContact },
  });
  return (
    <Card>
      <CardHeader title="Personal details" description={canEdit ? undefined : 'Contact HR to update these details.'} />
      <CardBody>
        <form
          noValidate
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api.patch(`/hr/employees/${employee.id}`, v);
              toast.success('Personal details saved');
              onSaved();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <PersonalFields register={form.register} errors={form.formState.errors as never} disabled={!canEdit} />
          {canEdit ? (
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
                Save personal details
              </Button>
            </div>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

function BankCard({ employee, canEdit, onSaved }: { employee: EmployeeDetail; canEdit: boolean; onSaved: () => void }) {
  const p = employee.personal!;
  const [open, setOpen] = React.useState(false);
  const [revealed, setRevealed] = React.useState<{ bank: { accountName: string | null; accountNumber: string; ifsc: string } | null; pan: string | null } | null>(null);
  const reveal = useApiMutation(() => api.post<typeof revealed>(`/hr/employees/${employee.id}/sensitive/reveal`), { onSuccess: (r) => setRevealed(r) });
  const form = useForm<z.input<typeof employeeSensitiveSchema>>({ resolver: zodResolver(employeeSensitiveSchema), defaultValues: {} });
  return (
    <Card>
      <CardHeader
        title="Bank & PAN"
        description="Encrypted at rest. Only masked values are shown by default."
        actions={
          canEdit ? (
            <>
              <Button size="sm" variant="ghost" loading={reveal.isPending} onClick={() => reveal.mutate(undefined)}>
                <Eye /> Reveal
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                Update
              </Button>
            </>
          ) : null
        }
      />
      <CardBody className="grid gap-4">
        <DescriptionList
          items={[
            { label: 'Bank account', value: p.hasBankDetails ? `XXXX ${p.bankAccountLast4 ?? ''}` : 'Not provided' },
            { label: 'PAN', value: p.panMasked ?? 'Not provided' },
          ]}
        />
        {revealed ? (
          <Alert tone="warning" title="Sensitive details (this view was recorded in the audit log)" action={<Button size="xs" variant="ghost" onClick={() => setRevealed(null)}>Hide</Button>}>
            <div className="tabular mt-1 grid gap-0.5 text-ink-800">
              <span>Account: {revealed.bank ? `${revealed.bank.accountNumber} · IFSC ${revealed.bank.ifsc}${revealed.bank.accountName ? ` · ${revealed.bank.accountName}` : ''}` : '—'}</span>
              <span>PAN: {revealed.pan ?? '—'}</span>
            </div>
          </Alert>
        ) : null}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Update bank & PAN" description="Leave a section blank to keep the current value.">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(async (v) => {
              const payload = Object.fromEntries(Object.entries(v).filter(([, x]) => x));
              try {
                await api.put(`/hr/employees/${employee.id}/sensitive`, payload);
                toast.success('Details saved securely');
                setOpen(false);
                form.reset({});
                onSaved();
              } catch (err) {
                if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
              }
            })}
          >
            <Field label="Account holder name" htmlFor="bankAccountName">
              <Input id="bankAccountName" {...form.register('bankAccountName')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account number" htmlFor="bankAccountNumber" error={form.formState.errors.bankAccountNumber?.message}>
                <Input id="bankAccountNumber" inputMode="numeric" autoComplete="off" {...form.register('bankAccountNumber', { setValueAs: (x) => x || undefined })} />
              </Field>
              <Field label="IFSC" htmlFor="ifsc" error={form.formState.errors.ifsc?.message}>
                <Input id="ifsc" autoComplete="off" {...form.register('ifsc', { setValueAs: (x) => x || undefined })} />
              </Field>
            </div>
            <Field label="PAN" htmlFor="pan" error={form.formState.errors.pan?.message}>
              <Input id="pan" autoComplete="off" className="uppercase" {...form.register('pan', { setValueAs: (x) => x || undefined })} />
            </Field>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                <ShieldCheck /> Save securely
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DocumentsTab({ employee, onChanged }: { employee: EmployeeDetail; onChanged: () => void }) {
  const [file, setFile] = React.useState<{ id: string; fileName: string } | null>(null);
  const [docType, setDocType] = React.useState<string>('ID_PROOF');
  const [title, setTitle] = React.useState('');
  const canUpload = employee.access.manage || employee.access.self;
  const add = useApiMutation(() => api.post(`/hr/employees/${employee.id}/documents`, { docType, title: title || file!.fileName, fileId: file!.id }), {
    success: 'Document added',
    onSuccess: () => {
      setFile(null);
      setTitle('');
      onChanged();
    },
  });
  const remove = useApiMutation((docId: string) => api.delete(`/hr/employees/${employee.id}/documents/${docId}`), { success: 'Document removed', onSuccess: onChanged });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Documents" description="Private — visible to the employee and HR only." />
        {employee.documents.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Type</TH>
                <TH className="hidden sm:table-cell">Added</TH>
                <TH align="right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {employee.documents.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <div className="font-medium text-ink-900">{d.title}</div>
                    <div className="text-xs text-ink-500">{d.file.fileName}</div>
                  </TD>
                  <TD>{enumLabel(d.docType)}</TD>
                  <TD className="hidden text-xs text-ink-500 sm:table-cell">
                    {formatDate(d.createdAt)}
                    {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => void openDocument(d.file.id)}>
                        Open
                      </Button>
                      {employee.access.manage ? (
                        <Button size="xs" variant="ghost" className="text-danger" onClick={() => remove.mutate(d.id)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={<FileText />} title="No documents" description="ID proof, offer letter and other records appear here." />
        )}
      </Card>
      {canUpload ? (
        <Card>
          <CardHeader title="Add a document" />
          <CardBody className="grid gap-4">
            <DocumentUpload purpose="employee-document" onUploaded={setFile} />
            <Field label="Type" htmlFor="empDocType">
              <Select id="empDocType" value={docType} onChange={(ev) => setDocType(ev.target.value)}>
                {EMPLOYEE_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" htmlFor="empDocTitle">
              <Input id="empDocTitle" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder={file?.fileName ?? 'e.g. Aadhaar card'} />
            </Field>
            <Button disabled={!file} loading={add.isPending} onClick={() => add.mutate(undefined)}>
              Save document
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function LeaveTab({ employee }: { employee: EmployeeDetail }) {
  const { can, user } = useSession();
  const scope = employee.access.self ? 'mine' : can('leave.manage', user.platformOrganizationId) ? 'all' : 'team';
  const requests = useApi<Paginated<LeaveRequestRow>>('/hr/leave/requests', { scope, employeeId: employee.access.self ? undefined : employee.id, pageSize: 20 });
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader title={`Leave balances ${new Date().getUTCFullYear()}`} />
        {employee.leaveBalances.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Leave type</TH>
                <TH align="right">Allocated</TH>
                <TH align="right">Carried forward</TH>
                <TH align="right">Used</TH>
                <TH align="right">Available</TH>
              </tr>
            </THead>
            <TBody>
              {employee.leaveBalances.map((b) => (
                <TR key={b.leaveTypeId}>
                  <TD>
                    <span className="font-medium text-ink-900">{b.name}</span> <span className="text-xs text-ink-500">{b.isPaid ? 'Paid' : 'Unpaid'}</span>
                  </TD>
                  <TD align="right" className="tabular">{b.allocated}</TD>
                  <TD align="right" className="tabular">{b.carriedForward}</TD>
                  <TD align="right" className="tabular">{b.used}</TD>
                  <TD align="right" className="tabular font-semibold text-ink-900">{b.isPaid ? b.available : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No balances for this year" description="HR can allocate balances from the Leave page." />
        )}
      </Card>
      <Card>
        <CardHeader title="Leave requests" />
        {requests.data?.data.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Type</TH>
                <TH>Dates</TH>
                <TH align="right">Days</TH>
                <TH className="hidden md:table-cell">Reason</TH>
                <TH>Status</TH>
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
                  <TD className="hidden max-w-xs truncate md:table-cell">{r.reason}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-500">{requests.isLoading ? 'Loading…' : 'No leave requests.'}</p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

function AttendanceTab({ employeeId }: { employeeId: string }) {
  const [month, setMonth] = React.useState(currentMonth());
  const q = useApi<AttendanceMonth>(`/hr/attendance/employees/${employeeId}`, { month });
  return (
    <Card>
      <CardHeader title="Attendance" description={q.data ? `${q.data.shift.name} · ${q.data.shift.startTime}–${q.data.shift.endTime}` : undefined} actions={<MonthInput value={month} onChange={setMonth} max={currentMonth()} />} />
      <CardBody className="grid gap-5">
        {q.data ? (
          <>
            <AttendanceSummary data={q.data} />
            <AttendanceCalendar data={q.data} />
          </>
        ) : q.isError ? (
          <Alert tone="danger">{errorMessage(q.error)}</Alert>
        ) : (
          <Skeleton className="h-80" />
        )}
      </CardBody>
    </Card>
  );
}

function ExitDialog({ open, onOpenChange, employee, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; employee: EmployeeDetail; onDone: () => void }) {
  const form = useForm<z.input<typeof employeeExitSchema>>({ resolver: zodResolver(employeeExitSchema), defaultValues: { exitDate: localDateString(new Date()), reason: '' } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Record exit — ${employee.user.fullName}`} description="Login access is disabled immediately and active sessions are signed out. Pending payroll for the exit month still includes days worked.">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              const res = await api.post<{ directReportsToReassign: number }>(`/hr/employees/${employee.id}/exit`, v);
              toast.success(res.directReportsToReassign ? `Exit recorded. Reassign ${res.directReportsToReassign} direct report(s).` : 'Exit recorded');
              onOpenChange(false);
              onDone();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Last working day" htmlFor="exitDate" required error={form.formState.errors.exitDate?.message}>
            <Input id="exitDate" type="date" {...form.register('exitDate')} />
          </Field>
          <Field label="Reason" htmlFor="exitReason" required error={form.formState.errors.reason?.message}>
            <Textarea id="exitReason" rows={3} {...form.register('reason')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={form.formState.isSubmitting}>
              <Landmark /> Record exit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
