'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { formatDate, formatINR } from '@estate/shared';
import { Badge, Card, PageHeader, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import { PayrollNav } from '@/components/payroll/payroll-nav';

interface Row {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  designation: string | null;
  structure: { id: string; effectiveFrom: string; monthlyGross: number; monthlyDeductions: number; monthlyNet: number } | null;
}

export default function SalaryStructuresPage() {
  const router = useRouter();
  const q = useApi<Row[]>('/payroll/structures');
  const missing = (q.data ?? []).filter((r) => !r.structure).length;
  return (
    <>
      <PageHeader title="Salary structures" description="Current structure per employee. Estimates assume a full month with no loss of pay." />
      <PayrollNav />
      <Card>
        {missing ? (
          <div className="border-b border-line bg-warning-soft px-5 py-2.5 text-sm text-warning">
            {missing} employee(s) have no salary structure and will be skipped in payroll.
          </div>
        ) : null}
        <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <Wallet />, title: 'No active employees' }}>
          {(rows) => (
            <Table>
              <THead>
                <tr>
                  <TH>Employee</TH>
                  <TH className="hidden md:table-cell">Designation</TH>
                  <TH className="hidden sm:table-cell">Effective from</TH>
                  <TH align="right">Monthly gross</TH>
                  <TH align="right" className="hidden md:table-cell">
                    Deductions
                  </TH>
                  <TH align="right">Monthly net</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.employeeId} onClick={() => router.push(`/payroll/structures/${r.employeeId}`)}>
                    <TD>
                      <Link href={`/payroll/structures/${r.employeeId}`} className="font-medium text-ink-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.name}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {r.employeeCode}
                        {r.department ? ` · ${r.department}` : ''}
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">{r.designation ?? '—'}</TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{r.structure ? formatDate(r.structure.effectiveFrom) : <Badge tone="warning">Not set</Badge>}</TD>
                    <TD align="right" className="tabular">{r.structure ? formatINR(r.structure.monthlyGross) : '—'}</TD>
                    <TD align="right" className="tabular hidden md:table-cell">{r.structure ? formatINR(r.structure.monthlyDeductions) : '—'}</TD>
                    <TD align="right" className="tabular font-semibold text-ink-900">{r.structure ? formatINR(r.structure.monthlyNet) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
    </>
  );
}
