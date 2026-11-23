'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, History, Plus } from 'lucide-react';
import { calculatePayslip, enumLabel, formatDate, formatINR } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { PayrollNav } from '@/components/payroll/payroll-nav';

interface Component {
  id: string;
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_GROSS';
  defaultValue: number | null;
  maxAmount: number | null;
  prorateByAttendance: boolean;
  sortOrder: number;
  isActive: boolean;
}
interface StructureData {
  employee: { id: string; employeeCode: string; name: string; designation: string | null; isSelf: boolean };
  structures: {
    id: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    isCurrent: boolean;
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    lines: { componentId: string; code: string; name: string; type: string; calcType: string; value: number }[];
    estimate: { gross: number; deductions: number; net: number };
  }[];
}

export default function EmployeeStructurePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { can, user } = useSession();
  const manage = can('payroll.manage', user.platformOrganizationId);
  const q = useApi<StructureData>(`/payroll/structures/${employeeId}`);
  const comps = useApi<Component[]>('/payroll/components');
  const current = q.data?.structures.find((s) => s.isCurrent) ?? q.data?.structures[0];
  const active = React.useMemo(() => (comps.data ?? []).filter((c) => c.isActive).sort((a, b) => (a.type === b.type ? a.sortOrder - b.sortOrder : a.type === 'EARNING' ? -1 : 1)), [comps.data]);

  const [values, setValues] = React.useState<Record<string, string>>({});
  const [effectiveFrom, setEffectiveFrom] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!comps.data) return;
    const init: Record<string, string> = {};
    for (const c of comps.data.filter((x) => x.isActive)) {
      const line = current?.lines.find((l) => l.componentId === c.id);
      init[c.id] = line ? String(line.value) : '';
    }
    setValues(init);
  }, [comps.data, current]);

  const estimate = React.useMemo(() => {
    const components = active
      .filter((c) => values[c.id] !== '' && values[c.id] !== undefined)
      .map((c) => ({ code: c.code, name: c.name, type: c.type, calcType: c.calcType, value: Number(values[c.id]), maxAmount: c.maxAmount, prorate: c.prorateByAttendance, sortOrder: c.sortOrder }));
    return calculatePayslip({ components, workingDays: 26, payableDays: 26, adjustments: [] });
  }, [active, values]);

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (!q.data) return <EmptyState title="Employee not found" description={q.error ? errorMessage(q.error) : undefined} />;
  const { employee, structures } = q.data;
  const latest = structures[0];

  async function save() {
    const lines = active.filter((c) => values[c.id] !== '' && values[c.id] !== undefined).map((c) => ({ componentId: c.id, value: Number(values[c.id]) }));
    if (!effectiveFrom) return toast.error('Choose the date this structure takes effect');
    setSaving(true);
    try {
      await api.post(`/payroll/structures/${employeeId}`, { effectiveFrom, notes: notes || null, lines });
      toast.success('Salary structure saved');
      setNotes('');
      setEffectiveFrom('');
      void q.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/payroll/structures" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Salary structures
          </Link>
        }
        title={employee.name}
        description={`${employee.employeeCode}${employee.designation ? ` · ${employee.designation}` : ''}`}
      />
      <PayrollNav />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {manage && !employee.isSelf ? (
          <Card>
            <CardHeader title="New salary revision" description={latest ? `Must start after ${formatDate(latest.effectiveFrom)}. The current structure ends the day before.` : 'First salary structure for this employee.'} />
            <CardBody className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                <Field label="Effective from" htmlFor="effFrom" required>
                  <Input id="effFrom" type="date" value={effectiveFrom} min={latest ? latest.effectiveFrom : undefined} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </Field>
                <Field label="Notes" htmlFor="sNotes">
                  <Input id="sNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Annual increment" />
                </Field>
              </div>
              <Table>
                <THead>
                  <tr>
                    <TH>Component</TH>
                    <TH>Calculation</TH>
                    <TH align="right">Value</TH>
                  </tr>
                </THead>
                <TBody>
                  {active.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <span className="font-medium text-ink-900">{c.name}</span>{' '}
                        <Badge size="sm" tone={c.type === 'EARNING' ? 'success' : 'warning'}>
                          {enumLabel(c.type)}
                        </Badge>
                      </TD>
                      <TD className="text-ink-600">{enumLabel(c.calcType)}</TD>
                      <TD align="right">
                        <div className="ml-auto w-36">
                          <Input
                            type="number"
                            step="any"
                            min={0}
                            aria-label={`${c.name} value`}
                            value={values[c.id] ?? ''}
                            placeholder={c.defaultValue != null ? String(c.defaultValue) : 'Not included'}
                            onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                            trailing={<span className="text-xs">{c.calcType === 'FIXED' ? '₹' : '%'}</span>}
                            className="text-right"
                          />
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="text-xs text-ink-500">Leave a value empty to exclude that component. Percentages are 0–100.</p>
              <div className="flex justify-end">
                <Button loading={saving} onClick={() => void save()}>
                  <Plus /> Save revision
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Alert tone="info">{employee.isSelf ? 'You cannot change your own salary structure.' : 'You can view salary structures but not change them.'}</Alert>
        )}
        <div className="grid content-start gap-5">
          {manage && !employee.isSelf ? (
            <Card>
              <CardHeader title="Monthly estimate" description="Full month, no loss of pay" />
              <CardBody className="grid gap-2 text-sm">
                {estimate.lines.map((l) => (
                  <div key={l.componentCode} className="flex justify-between gap-3">
                    <span className="text-ink-600">{l.componentName}</span>
                    <span className={`tabular ${l.type === 'DEDUCTION' ? 'text-warning' : 'text-ink-900'}`}>
                      {l.type === 'DEDUCTION' ? '−' : ''}
                      {formatINR(l.amount, { precise: true })}
                    </span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold text-ink-900">
                  <span>Net pay</span>
                  <span className="tabular">{formatINR(estimate.netPay, { precise: true })}</span>
                </div>
                {estimate.warnings.map((w) => (
                  <p key={w} className="text-xs text-warning">
                    {w}
                  </p>
                ))}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="History" />
            {structures.length ? (
              <ul className="divide-y divide-line">
                {structures.map((s) => (
                  <li key={s.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink-900">
                        {formatDate(s.effectiveFrom)} – {s.effectiveTo ? formatDate(s.effectiveTo) : 'present'}
                      </span>
                      {s.isCurrent ? <Badge tone="success">Current</Badge> : null}
                    </div>
                    <div className="tabular mt-0.5 text-xs text-ink-500">
                      Gross {formatINR(s.estimate.gross)} · net {formatINR(s.estimate.net)}
                      {s.createdBy ? ` · by ${s.createdBy}` : ''}
                    </div>
                    {s.notes ? <div className="mt-0.5 text-xs text-ink-500">{s.notes}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<History />} title="No structures yet" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
