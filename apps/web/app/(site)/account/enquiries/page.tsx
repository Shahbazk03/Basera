'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { enumLabel, formatDateTime } from '@estate/shared';
import { ApiError, errorMessage } from '@estate/api-client';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { useCurrentUser } from '@/lib/session';

interface MyEnquiry {
  id: string;
  referenceNo: string;
  type: string;
  status: string;
  subject?: string | null;
  createdAt: string;
  property?: { title: string; slug: string } | null;
  project?: { name: string; slug: string } | null;
}

export default function MyEnquiriesPage() {
  const { data: user } = useCurrentUser();
  const q = useQuery({
    queryKey: ['my-enquiries', user?.id],
    queryFn: async () => {
      const res = await api.get<MyEnquiry[] | { data: MyEnquiry[] }>('/me/enquiries');
      return Array.isArray(res) ? res : res.data;
    },
    enabled: Boolean(user),
  });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return <ErrorState title="Enquiry history is not available yet" description="Please check back shortly." />;
    }
    return <ErrorState description={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  }
  const rows = q.data ?? [];
  if (!rows.length)
    return (
      <div className="rounded-xl border border-line bg-surface">
        <EmptyState
          icon={<Inbox />}
          title="No enquiries yet"
          description="When you enquire about a property or project while logged in, it appears here with its reference number."
          action={
            <Button asChild variant="outline">
              <Link href="/buy">Browse properties</Link>
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <Table>
        <THead>
          <tr>
            <TH>Reference</TH>
            <TH>Regarding</TH>
            <TH>Type</TH>
            <TH>Status</TH>
            <TH>Submitted</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((e) => (
            <TR key={e.id}>
              <TD className="tabular font-medium text-ink-900">{e.referenceNo}</TD>
              <TD>
                {e.property ? (
                  <Link href={`/property/${e.property.slug}`} className="text-brand-strong hover:underline">
                    {e.property.title}
                  </Link>
                ) : e.project ? (
                  <Link href={`/projects/${e.project.slug}`} className="text-brand-strong hover:underline">
                    {e.project.name}
                  </Link>
                ) : (
                  (e.subject ?? 'General enquiry')
                )}
              </TD>
              <TD>{enumLabel(e.type)}</TD>
              <TD>
                <StatusBadge status={e.status} />
              </TD>
              <TD className="whitespace-nowrap text-ink-500">{formatDateTime(e.createdAt)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
