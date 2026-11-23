'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { errorMessage } from '@estate/api-client';
import { Button, EmptyState, PageHeader, Skeleton } from '@estate/ui';
import { useApi } from '@/lib/hooks';
import { PayslipView, type PayslipDetail } from '@/components/payroll/payslip-view';

export default function MyPayslipPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<PayslipDetail>(`/payroll/payslips/${id}`);
  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/me/payslips" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Payslips
          </Link>
        }
        title={q.data ? `Payslip · ${q.data.period}` : 'Payslip'}
      />
      {q.isLoading ? (
        <Skeleton className="h-[640px]" />
      ) : q.data ? (
        <PayslipView data={q.data} />
      ) : (
        <EmptyState
          title="Payslip not available"
          description={q.error ? errorMessage(q.error) : undefined}
          action={
            <Button asChild variant="outline">
              <Link href="/me/payslips">All payslips</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
