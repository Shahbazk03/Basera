'use client';

import * as React from 'react';
import Link from 'next/link';
import { Flag } from 'lucide-react';
import { enumLabel, formatDateTime, type Paginated } from '@estate/shared';
import { Button, Card, Dialog, DialogContent, DialogFooter, Field, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { StatusTabs } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface ReportRow {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  reporterEmail: string | null;
  property: { id: string; title: string; referenceCode: string; status: string; organization: { name: string } };
  reporter: { fullName: string; email: string | null } | null;
  resolvedBy: { fullName: string } | null;
}

export default function ListingReportsPage() {
  const { values, set, page, setPage } = useListParams<{ status?: string }>({ status: 'OPEN' });
  const query = useApi<Paginated<ReportRow>>('/admin/property-reports', { status: values.status, page, pageSize: 20 });
  const [active, setActive] = React.useState<ReportRow | null>(null);
  const [resolution, setResolution] = React.useState('');
  const resolve = useApiMutation((v: { status: 'RESOLVED' | 'DISMISSED' }) => api.post(`/admin/property-reports/${active!.id}/resolve`, { status: v.status, resolution }), {
    success: 'Report closed',
    invalidate: ['/admin/property-reports'],
    onSuccess: () => {
      setActive(null);
      setResolution('');
    },
  });
  return (
    <>
      <PageHeader title="Listing reports" description="Problems reported by visitors — fake listings, wrong prices, sold properties and more." />
      <Card>
        <StatusTabs
          tabs={[
            { value: 'OPEN', label: 'Open' },
            { value: 'RESOLVED', label: 'Resolved' },
            { value: 'DISMISSED', label: 'Dismissed' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
        />
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Flag />, title: 'No reports here', description: 'Reports submitted from listing pages appear in this queue.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Listing</TH>
                    <TH>Reason</TH>
                    <TH className="hidden md:table-cell">Reported by</TH>
                    <TH>Status</TH>
                    <TH align="right">Action</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`/listings/${r.property.id}`} className="font-medium text-ink-900 hover:underline">
                          {r.property.title}
                        </Link>
                        <div className="text-xs text-ink-500">
                          {r.property.referenceCode} · {r.property.organization.name}
                        </div>
                      </TD>
                      <TD>
                        <div className="font-medium text-ink-800">{enumLabel(r.reason)}</div>
                        {r.details ? <div className="line-clamp-2 max-w-md text-xs text-ink-500">{r.details}</div> : null}
                      </TD>
                      <TD className="hidden text-xs text-ink-500 md:table-cell">
                        {r.reporter?.fullName ?? r.reporterEmail ?? 'Anonymous visitor'}
                        <div>{formatDateTime(r.createdAt)}</div>
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD align="right">
                        {r.status === 'OPEN' ? (
                          <Button size="xs" variant="outline" onClick={() => setActive(r)}>
                            Review
                          </Button>
                        ) : (
                          <span className="text-xs text-ink-500">{r.resolvedBy?.fullName}</span>
                        )}
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
      <Dialog open={Boolean(active)} onOpenChange={(o) => !o && setActive(null)}>
        {active ? (
          <DialogContent title="Close report" description={`${enumLabel(active.reason)} — ${active.property.title}`}>
            <Field label="Resolution note" htmlFor="resolution" required hint="Record what you checked and any action taken on the listing.">
              <Textarea id="resolution" rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" loading={resolve.isPending} disabled={resolution.trim().length < 3} onClick={() => resolve.mutate({ status: 'DISMISSED' })}>
                Dismiss
              </Button>
              <Button loading={resolve.isPending} disabled={resolution.trim().length < 3} onClick={() => resolve.mutate({ status: 'RESOLVED' })}>
                Mark resolved
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
