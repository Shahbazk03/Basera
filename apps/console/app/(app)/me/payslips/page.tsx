'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { formatINR } from '@estate/shared';
import { Card, EmptyState, PageHeader, StatusBadge } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { QueryState } from '@/components/query-state';

interface MyPayslip {
  id: string;
  period: string;
  status: string;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  payableDays: number;
  lopDays: number;
}

export default function MyPayslipsPage() {
  const { user } = useSession();
  const q = useApi<MyPayslip[]>(user.employeeId ? '/payroll/me/payslips' : null);
  if (!user.employeeId) return <EmptyState title="Payslips are for employees" description="Your account is not linked to an employee record." />;
  return (
    <>
      <PageHeader title="Payslips" description="Payslips appear here once payroll for the month has been approved." />
      <Card>
        <QueryState query={q} isEmpty={(d) => d.length === 0} empty={{ icon: <FileText />, title: 'No payslips yet', description: 'Your first payslip will be available after the month’s payroll is approved.' }}>
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((p) => (
                <li key={p.id}>
                  <Link href={`/me/payslips/${p.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-ink-50/70">
                    <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                      <FileText className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">{p.period}</span>
                      <span className="block text-xs text-ink-500">
                        Gross {formatINR(p.grossEarnings, { precise: true })} · deductions {formatINR(p.totalDeductions, { precise: true })}
                        {p.lopDays ? ` · ${p.lopDays} LOP day(s)` : ''}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="tabular block font-semibold text-ink-900">{formatINR(p.netPay, { precise: true })}</span>
                      <StatusBadge status={p.status} size="sm" />
                    </span>
                    <ChevronRight className="size-4 text-ink-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
    </>
  );
}
