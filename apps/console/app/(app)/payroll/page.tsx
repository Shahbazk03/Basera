'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Wallet } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { formatINR, type Paginated } from '@estate/shared';
import { Button, Card, Dialog, DialogContent, DialogFooter, Field, Input, PageHeader, Pagination, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { QueryState } from '@/components/query-state';
import { PayrollNav } from '@/components/payroll/payroll-nav';

interface RunRow {
  id: string;
  period: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  workingDays: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  createdAt: string;
  createdBy: { fullName: string } | null;
  approvedBy: { fullName: string } | null;
  _count: { payslips: number };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function PayrollRunsPage() {
  const router = useRouter();
  const { can, user } = useSession();
  const manage = can('payroll.manage', user.platformOrganizationId);
  const { page, setPage } = useListParams();
  const q = useApi<Paginated<RunRow>>('/payroll/runs', { page, pageSize: 12 });
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly payroll runs: calculate from salary structures and attendance, approve (maker-checker), then record payments."
        actions={
          manage ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New payroll run
            </Button>
          ) : null
        }
      />
      <PayrollNav />
      <Card>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Wallet />, title: 'No payroll runs yet', description: manage ? 'Create a run for a completed month to calculate payslips.' : undefined }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Period</TH>
                    <TH>Status</TH>
                    <TH align="right">Employees</TH>
                    <TH align="right" className="hidden md:table-cell">
                      Gross
                    </TH>
                    <TH align="right" className="hidden md:table-cell">
                      Deductions
                    </TH>
                    <TH align="right">Net pay</TH>
                    <TH className="hidden lg:table-cell">Prepared / approved</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => (
                    <TR key={r.id} onClick={() => router.push(`/payroll/${r.id}`)}>
                      <TD>
                        <div className="font-medium text-ink-900">{r.period}</div>
                        <div className="text-xs text-ink-500">{r.workingDays} working days</div>
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD align="right" className="tabular">{r._count.payslips}</TD>
                      <TD align="right" className="tabular hidden md:table-cell">{formatINR(r.totalGross)}</TD>
                      <TD align="right" className="tabular hidden md:table-cell">{formatINR(r.totalDeductions)}</TD>
                      <TD align="right" className="tabular font-semibold text-ink-900">{formatINR(r.totalNet)}</TD>
                      <TD className="hidden text-xs text-ink-500 lg:table-cell">
                        {r.createdBy?.fullName ?? '—'}
                        {r.approvedBy ? ` / ${r.approvedBy.fullName}` : ''}
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
      </Card>
      {open ? <NewRunDialog onClose={() => setOpen(false)} onCreated={(id) => router.push(`/payroll/${id}`)} /> : null}
    </>
  );
}

function NewRunDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [year, setYear] = React.useState(prev.getUTCFullYear());
  const [month, setMonth] = React.useState(prev.getUTCMonth() + 1);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New payroll run" description="One run per month. You can recalculate until the run is approved." size="sm">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Month" htmlFor="runMonth">
              <Select id="runMonth" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Year" htmlFor="runYear">
              <Input id="runYear" type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="runNotes">
            <Textarea id="runNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const run = await api.post<{ id: string }>('/payroll/runs', { periodYear: year, periodMonth: month, notes: notes || undefined });
                toast.success('Payroll run created');
                onCreated(run.id);
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
