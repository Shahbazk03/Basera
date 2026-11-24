'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building, Network, Pencil, Plus, Users } from 'lucide-react';
import { departmentSchema, designationSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckboxField,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
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
import { applyServerErrors, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { QueryState } from '@/components/query-state';
import { EmployeeSelect } from '@/components/hr/pickers';
import type { Department, Designation } from '@/components/hr/types';

interface ChartNode {
  id: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  avatarUrl: string | null;
  reports: ChartNode[];
}

const nullable = { setValueAs: (v: unknown) => (v === '' || v === undefined ? null : v) };

export default function StructurePage() {
  const { can, user } = useSession();
  const manage = can('employee.manage', user.platformOrganizationId);
  const departments = useApi<Department[]>('/hr/departments');
  const designations = useApi<Designation[]>('/hr/designations');
  const chart = useApi<ChartNode[]>('/hr/org-chart');
  const [editDept, setEditDept] = React.useState<Department | 'new' | null>(null);
  const [editDesig, setEditDesig] = React.useState<Designation | 'new' | null>(null);

  return (
    <>
      <PageHeader title="Organisation structure" description="Departments, designations and reporting lines." />
      <Tabs defaultValue="departments">
        <TabsList>
          <TabsTrigger value="departments">
            <Building /> Departments
          </TabsTrigger>
          <TabsTrigger value="designations">
            <Users /> Designations
          </TabsTrigger>
          <TabsTrigger value="chart">
            <Network /> Org chart
          </TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <Card>
            <CardHeader
              title="Departments"
              actions={
                manage ? (
                  <Button size="sm" onClick={() => setEditDept('new')}>
                    <Plus /> Add department
                  </Button>
                ) : null
              }
            />
            <QueryState query={departments} isEmpty={(d) => d.length === 0} empty={{ icon: <Building />, title: 'No departments yet' }}>
              {(rows) => (
                <Table>
                  <THead>
                    <tr>
                      <TH>Department</TH>
                      <TH className="hidden md:table-cell">Parent</TH>
                      <TH className="hidden md:table-cell">Head</TH>
                      <TH align="right">Employees</TH>
                      <TH>Status</TH>
                      {manage ? <TH align="right">Edit</TH> : null}
                    </tr>
                  </THead>
                  <TBody>
                    {rows.map((d) => (
                      <TR key={d.id}>
                        <TD>
                          <div className="font-medium text-ink-900">{d.name}</div>
                          <div className="text-xs text-ink-500">
                            {d.code}
                            {d.description ? ` · ${d.description}` : ''}
                          </div>
                        </TD>
                        <TD className="hidden md:table-cell">{d.parent?.name ?? '—'}</TD>
                        <TD className="hidden md:table-cell">{d.headName ?? '—'}</TD>
                        <TD align="right" className="tabular">
                          <Link href={`/hr/employees?departmentId=${d.id}`} className="hover:underline">
                            {d._count.employees}
                          </Link>
                        </TD>
                        <TD>{d.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                        {manage ? (
                          <TD align="right">
                            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => setEditDept(d)}>
                              <Pencil />
                            </Button>
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </QueryState>
          </Card>
        </TabsContent>

        <TabsContent value="designations">
          <Card>
            <CardHeader
              title="Designations"
              description="Higher level = more senior."
              actions={
                manage ? (
                  <Button size="sm" onClick={() => setEditDesig('new')}>
                    <Plus /> Add designation
                  </Button>
                ) : null
              }
            />
            <QueryState query={designations} isEmpty={(d) => d.length === 0} empty={{ icon: <Users />, title: 'No designations yet' }}>
              {(rows) => (
                <Table>
                  <THead>
                    <tr>
                      <TH>Designation</TH>
                      <TH>Department</TH>
                      <TH align="right">Level</TH>
                      <TH align="right">Employees</TH>
                      <TH>Status</TH>
                      {manage ? <TH align="right">Edit</TH> : null}
                    </tr>
                  </THead>
                  <TBody>
                    {rows.map((d) => (
                      <TR key={d.id}>
                        <TD className="font-medium text-ink-900">{d.name}</TD>
                        <TD>{d.department?.name ?? '—'}</TD>
                        <TD align="right" className="tabular">{d.level}</TD>
                        <TD align="right" className="tabular">{d._count.employees}</TD>
                        <TD>{d.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                        {manage ? (
                          <TD align="right">
                            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => setEditDesig(d)}>
                              <Pencil />
                            </Button>
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </QueryState>
          </Card>
        </TabsContent>

        <TabsContent value="chart">
          <Card>
            <CardHeader title="Reporting lines" description="Active employees grouped under their managers." />
            <QueryState query={chart} isEmpty={(d) => d.length === 0} empty={{ icon: <Network />, title: 'No employees yet' }}>
              {(roots) => (
                <div className="overflow-x-auto p-5">
                  <ul className="space-y-1">
                    {roots.map((n) => (
                      <ChartBranch key={n.id} node={n} depth={0} />
                    ))}
                  </ul>
                </div>
              )}
            </QueryState>
          </Card>
        </TabsContent>
      </Tabs>

      {editDept ? <DepartmentDialog dept={editDept === 'new' ? null : editDept} all={departments.data ?? []} onClose={() => setEditDept(null)} onSaved={() => void departments.refetch()} /> : null}
      {editDesig ? <DesignationDialog desig={editDesig === 'new' ? null : editDesig} departments={departments.data ?? []} onClose={() => setEditDesig(null)} onSaved={() => void designations.refetch()} /> : null}
    </>
  );
}

function ChartBranch({ node, depth }: { node: ChartNode; depth: number }) {
  return (
    <li>
      <div className="relative flex items-center gap-3 rounded-lg py-1.5 pr-3" style={{ paddingLeft: depth * 28 }}>
        {depth > 0 ? <span aria-hidden className="absolute top-1/2 h-px w-4 bg-line-strong" style={{ left: depth * 28 - 18 }} /> : null}
        <Avatar name={node.name} src={node.avatarUrl} size={30} />
        <div className="min-w-0">
          <Link href={`/hr/employees/${node.id}`} className="text-sm font-medium text-ink-900 hover:underline">
            {node.name}
          </Link>
          <p className="text-xs text-ink-500">
            {node.designation ?? node.employeeCode}
            {node.department ? ` · ${node.department}` : ''}
            {node.reports.length ? ` · ${node.reports.length} report${node.reports.length > 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>
      {node.reports.length ? (
        <ul className="ml-[15px] border-l border-line-strong" style={{ marginLeft: depth * 28 + 15 }}>
          {node.reports.map((r) => (
            <ChartBranch key={r.id} node={r} depth={1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DepartmentDialog(props: { dept: Department | null; all: Department[]; onClose: () => void; onSaved: () => void }) {
  // The head select must not mount before its options exist, or an existing head would be cleared on save.
  const employees = useApi<unknown[]>('/hr/employees/options');
  if (!employees.data) return null;
  return <DepartmentDialogForm {...props} />;
}

function DepartmentDialogForm({ dept, all, onClose, onSaved }: { dept: Department | null; all: Department[]; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof departmentSchema>>({
    resolver: zodResolver(departmentSchema),
    defaultValues: dept ? { name: dept.name, code: dept.code, description: dept.description, parentId: dept.parentId, headEmployeeId: dept.headEmployeeId, isActive: dept.isActive } : { isActive: true },
  });
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={dept ? `Edit ${dept.name}` : 'Add department'}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              if (dept) await api.patch(`/hr/departments/${dept.id}`, v);
              else await api.post('/hr/departments', v);
              toast.success('Department saved');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Name" htmlFor="dName" required error={errors.name?.message}>
              <Input id="dName" {...form.register('name')} />
            </Field>
            <Field label="Code" htmlFor="dCode" required error={errors.code?.message}>
              <Input id="dCode" className="uppercase" {...form.register('code')} />
            </Field>
          </div>
          <Field label="Description" htmlFor="dDesc">
            <Textarea id="dDesc" rows={2} {...form.register('description', nullable)} />
          </Field>
          <Field label="Parent department" htmlFor="dParent" error={errors.parentId?.message}>
            <Select id="dParent" {...form.register('parentId', nullable)}>
              <option value="">None (top level)</option>
              {all
                .filter((d) => d.id !== dept?.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Head of department" htmlFor="dHead" error={errors.headEmployeeId?.message}>
            <EmployeeSelect id="dHead" placeholder="Not set" {...form.register('headEmployeeId', nullable)} />
          </Field>
          <CheckboxField label="Active" checked={form.watch('isActive') !== false} onCheckedChange={(v) => form.setValue('isActive', Boolean(v), { shouldDirty: true })} />
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

function DesignationDialog({ desig, departments, onClose, onSaved }: { desig: Designation | null; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const form = useForm<z.input<typeof designationSchema>>({
    resolver: zodResolver(designationSchema),
    defaultValues: desig ? { name: desig.name, level: desig.level, departmentId: desig.departmentId, isActive: desig.isActive } : { level: 1, isActive: true },
  });
  const errors = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={desig ? `Edit ${desig.name}` : 'Add designation'}>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              if (desig) await api.patch(`/hr/designations/${desig.id}`, v);
              else await api.post('/hr/designations', v);
              toast.success('Designation saved');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          <Field label="Name" htmlFor="gName" required error={errors.name?.message}>
            <Input id="gName" {...form.register('name')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="gDept">
              <Select id="gDept" {...form.register('departmentId', nullable)}>
                <option value="">Any department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Level" htmlFor="gLevel" hint="1 = entry level" error={errors.level?.message}>
              <Input id="gLevel" type="number" min={1} max={20} {...form.register('level')} />
            </Field>
          </div>
          <CheckboxField label="Active" checked={form.watch('isActive') !== false} onCheckedChange={(v) => form.setValue('isActive', Boolean(v), { shouldDirty: true })} />
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
