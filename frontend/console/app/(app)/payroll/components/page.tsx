'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Layers, Pencil, Plus } from 'lucide-react';
import { enumLabel, formatINR, SALARY_CALC_TYPES, SALARY_COMPONENT_TYPES, salaryComponentSchema } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CheckboxField, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { applyServerErrors, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { QueryState } from '@/components/query-state';
import { PayrollNav } from '@/components/payroll/payroll-nav';

interface Component {
  id: string;
  code: string;
  name: string;
  type: string;
  calcType: string;
  defaultValue: number | null;
  maxAmount: number | null;
  isStatutory: boolean;
  isTaxable: boolean;
  prorateByAttendance: boolean;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  _count: { structureLines: number };
}

function valueLabel(c: { calcType: string; defaultValue: number | null }) {
  if (c.defaultValue == null) return '—';
  return c.calcType === 'FIXED' ? formatINR(c.defaultValue) : `${c.defaultValue}%`;
}

export default function SalaryComponentsPage() {
  const { can, user } = useSession();
  const manage = can('payroll.manage', user.platformOrganizationId);
  const q = useApi<Component[]>('/payroll/components');
  const [editing, setEditing] = React.useState<Component | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Salary components"
        description="Earnings and deductions used in salary structures. Values and statutory percentages are configured here — no rate is assumed by the system."
        actions={
          manage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Add component
            </Button>
          ) : null
        }
      />
      <PayrollNav />
      <Alert tone="info" className="mb-5" title="How amounts are calculated">
        Fixed = monthly amount × payable days ÷ working days (when prorated). % of Basic uses the Basic component. % of Gross (deductions only) uses earned gross from salary components. A maximum caps the monthly amount.
      </Alert>
      <Card>
        <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Layers />, title: 'No salary components yet', description: 'Start with a fixed BASIC earning.' }}>
          {(rows) => (
            <Table>
              <THead>
                <tr>
                  <TH>Component</TH>
                  <TH>Type</TH>
                  <TH>Calculation</TH>
                  <TH align="right">Default</TH>
                  <TH align="right" className="hidden md:table-cell">
                    Cap
                  </TH>
                  <TH className="hidden lg:table-cell">Flags</TH>
                  <TH align="right">Used by</TH>
                  {manage ? <TH align="right">Edit</TH> : null}
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <div className="font-medium text-ink-900">
                        {c.name} {!c.isActive ? <Badge size="sm">Inactive</Badge> : null}
                      </div>
                      <div className="text-xs text-ink-500">{c.code}</div>
                      {c.description ? <div className="mt-0.5 line-clamp-2 max-w-md text-[11.5px] text-ink-400">{c.description}</div> : null}
                    </TD>
                    <TD>
                      <Badge tone={c.type === 'EARNING' ? 'success' : 'warning'}>{enumLabel(c.type)}</Badge>
                    </TD>
                    <TD>{enumLabel(c.calcType)}</TD>
                    <TD align="right" className="tabular">{valueLabel(c)}</TD>
                    <TD align="right" className="tabular hidden md:table-cell">{c.maxAmount != null ? formatINR(c.maxAmount) : '—'}</TD>
                    <TD className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {c.isStatutory ? <Badge size="sm" tone="info">Statutory</Badge> : null}
                        {c.prorateByAttendance ? <Badge size="sm">Prorated</Badge> : <Badge size="sm" tone="outline">Not prorated</Badge>}
                        {c.type === 'EARNING' ? c.isTaxable ? <Badge size="sm">Taxable</Badge> : <Badge size="sm" tone="outline">Non-taxable</Badge> : null}
                      </div>
                    </TD>
                    <TD align="right" className="tabular">{c._count.structureLines}</TD>
                    {manage ? (
                      <TD align="right">
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
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
      {editing ? <ComponentDialog component={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </>
  );
}

function ComponentDialog({ component, onClose, onSaved }: { component: Component | null; onClose: () => void; onSaved: () => void }) {
  const inUse = Boolean(component && component._count.structureLines > 0);
  const form = useForm<z.input<typeof salaryComponentSchema>>({
    resolver: zodResolver(salaryComponentSchema),
    defaultValues: component
      ? { code: component.code, name: component.name, type: component.type as never, calcType: component.calcType as never, defaultValue: component.defaultValue, maxAmount: component.maxAmount, isStatutory: component.isStatutory, isTaxable: component.isTaxable, prorateByAttendance: component.prorateByAttendance, description: component.description, sortOrder: component.sortOrder, isActive: component.isActive }
      : { code: '', name: '', type: 'EARNING', calcType: 'FIXED', isStatutory: false, isTaxable: true, prorateByAttendance: true, sortOrder: 0, isActive: true },
  });
  const errors = form.formState.errors;
  const nul = { setValueAs: (v: unknown) => (v === '' || v == null ? null : Number(v)) };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={component ? `Edit ${component.name}` : 'Add salary component'} size="lg">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              if (component) await api.patch(`/payroll/components/${component.id}`, v);
              else await api.post('/payroll/components', v);
              toast.success('Component saved');
              onSaved();
              onClose();
            } catch (err) {
              if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
            }
          })}
        >
          {inUse ? <Alert tone="info">Used by {component!._count.structureLines} salary structure(s) — type and calculation method are locked.</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Code" htmlFor="cCode" required error={errors.code?.message}>
              <Input id="cCode" className="uppercase" disabled={inUse} {...form.register('code')} />
            </Field>
            <Field label="Name" htmlFor="cName" required error={errors.name?.message}>
              <Input id="cName" {...form.register('name')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Type" htmlFor="cType">
              <Select id="cType" disabled={inUse} {...form.register('type')}>
                {SALARY_COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Calculation" htmlFor="cCalc">
              <Select id="cCalc" disabled={inUse} {...form.register('calcType')}>
                {SALARY_CALC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default value" htmlFor="cDefault" hint={form.watch('calcType') === 'FIXED' ? '₹ per month' : 'Percentage'} error={errors.defaultValue?.message}>
              <Input id="cDefault" type="number" step="any" min={0} {...form.register('defaultValue', nul)} />
            </Field>
            <Field label="Monthly cap (₹)" htmlFor="cMax" error={errors.maxAmount?.message}>
              <Input id="cMax" type="number" step="any" min={0} {...form.register('maxAmount', nul)} />
            </Field>
          </div>
          <Field label="Description / formula notes" htmlFor="cDesc">
            <Textarea id="cDesc" rows={2} {...form.register('description', { setValueAs: (v) => v || null })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckboxField label="Prorate by attendance" description="Reduce for loss-of-pay days" checked={form.watch('prorateByAttendance') !== false} onCheckedChange={(v) => form.setValue('prorateByAttendance', Boolean(v), { shouldDirty: true })} />
            <CheckboxField label="Statutory" description="Shown as statutory on payslips" checked={Boolean(form.watch('isStatutory'))} onCheckedChange={(v) => form.setValue('isStatutory', Boolean(v), { shouldDirty: true })} />
            <CheckboxField label="Taxable" checked={form.watch('isTaxable') !== false} onCheckedChange={(v) => form.setValue('isTaxable', Boolean(v), { shouldDirty: true })} />
            <CheckboxField label="Active" checked={form.watch('isActive') !== false} onCheckedChange={(v) => form.setValue('isActive', Boolean(v), { shouldDirty: true })} />
          </div>
          <Field label="Display order" htmlFor="cSort">
            <Input id="cSort" type="number" min={0} className="w-28" {...form.register('sortOrder')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save component
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
