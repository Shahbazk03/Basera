'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Network } from 'lucide-react';
import { formatDateTime, formatPriceRange, type Paginated } from '@estate/shared';
import { Button, Card, Dialog, DialogContent, DialogFooter, Field, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import { StatusTabs } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface ProviderRow {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  status: string;
  duplicateWindowDays: number;
  createdAt: string;
  organization: { id: string; name: string; status: string; verificationStatus: string };
  stats: { submitted: number; accepted: number; duplicate: number; rejected: number; pending: number; converted: number };
}

interface PendingLead {
  id: string;
  leadNo: string;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
  intakeNote: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  locationPreference: string | null;
  requirement: string | null;
  leadProvider: { id: string; name: string };
  project: { name: string } | null;
}

export default function LeadProvidersPage() {
  const router = useRouter();
  const { values, set, page, setPage } = useListParams<{ tab?: string }>();
  const tab = values.tab ?? 'partners';
  const providers = useApi<ProviderRow[]>(tab === 'partners' ? '/crm/lead-providers' : null);
  const queue = useApi<Paginated<PendingLead>>('/crm/lead-providers/review', { page: tab === 'review' ? page : 1, pageSize: 25 });
  const [reviewing, setReviewing] = React.useState<{ lead: PendingLead; decision: 'ACCEPT' | 'REJECT' } | null>(null);
  const [reason, setReason] = React.useState('');
  const review = useApiMutation(() => api.post(`/crm/lead-providers/review/${reviewing!.lead.id}`, { decision: reviewing!.decision, reason: reason || undefined }), {
    success: (r) => ((r as { decision: string }).decision === 'ACCEPT' ? 'Lead accepted and routed' : 'Lead rejected'),
    invalidate: ['/crm/lead-providers', '/crm/leads'],
    onSuccess: () => {
      setReviewing(null);
      setReason('');
    },
  });

  return (
    <>
      <PageHeader title="Lead providers" description="External partners who submit leads. Duplicates are recorded (never deleted) so partner statements stay accurate." />
      <Card>
        <StatusTabs
          tabs={[
            { value: 'partners', label: 'Partners' },
            { value: 'review', label: `Review queue${queue.data ? ` (${queue.data.meta.total})` : ''}` },
          ]}
          value={tab}
          onChange={(v) => set({ tab: v })}
        />
        {tab === 'partners' ? (
          <QueryState query={providers} isEmpty={(d) => d.length === 0} empty={{ icon: <Network />, title: 'No lead providers yet', description: 'Partners register from the website and appear here for activation.' }}>
            {(d) => (
              <Table>
                <THead>
                  <tr>
                    <TH>Partner</TH>
                    <TH>Status</TH>
                    <TH align="right">Submitted</TH>
                    <TH align="right" className="hidden md:table-cell">
                      Accepted
                    </TH>
                    <TH align="right" className="hidden md:table-cell">
                      Duplicates
                    </TH>
                    <TH align="right" className="hidden lg:table-cell">
                      Pending
                    </TH>
                    <TH align="right">Converted</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.map((p) => (
                    <TR key={p.id} onClick={() => router.push(`/crm/lead-providers/${p.id}`)}>
                      <TD>
                        <Link href={`/crm/lead-providers/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                          {p.name}
                        </Link>
                        <div className="text-xs text-ink-500">
                          {p.contactName ?? '—'} · duplicate window {p.duplicateWindowDays} days
                        </div>
                      </TD>
                      <TD>
                        <StatusBadge status={p.organization.status === 'PENDING' ? 'PENDING' : p.status} label={p.organization.status === 'PENDING' ? 'Awaiting activation' : undefined} />
                      </TD>
                      <TD align="right" className="tabular">
                        {p.stats.submitted}
                      </TD>
                      <TD align="right" className="tabular hidden md:table-cell">
                        {p.stats.accepted}
                      </TD>
                      <TD align="right" className="tabular hidden md:table-cell">
                        {p.stats.duplicate}
                      </TD>
                      <TD align="right" className="tabular hidden lg:table-cell">
                        {p.stats.pending}
                      </TD>
                      <TD align="right" className="tabular">
                        {p.stats.converted}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </QueryState>
        ) : (
          <QueryState query={queue} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ClipboardCheck />, title: 'Nothing to review', description: 'Partner leads without a project or requirement wait here for qualification.' }}>
            {(d) => (
              <>
                <Table>
                  <THead>
                    <tr>
                      <TH>Lead</TH>
                      <TH className="hidden md:table-cell">Partner</TH>
                      <TH className="hidden lg:table-cell">Details</TH>
                      <TH className="hidden sm:table-cell">Submitted</TH>
                      <TH align="right">Decision</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {d.data.map((l) => (
                      <TR key={l.id}>
                        <TD>
                          <div className="font-medium text-ink-900">{l.name}</div>
                          <div className="tabular text-xs text-ink-500">
                            {l.leadNo} · {l.phone}
                          </div>
                        </TD>
                        <TD className="hidden md:table-cell">{l.leadProvider.name}</TD>
                        <TD className="hidden max-w-72 text-xs text-ink-600 lg:table-cell">
                          {[l.project?.name, l.budgetMin || l.budgetMax ? formatPriceRange(l.budgetMin, l.budgetMax) : null, l.locationPreference, l.requirement].filter(Boolean).join(' · ') || l.intakeNote}
                        </TD>
                        <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatDateTime(l.createdAt)}</TD>
                        <TD align="right">
                          <div className="flex justify-end gap-1.5">
                            <Button size="xs" variant="outline" onClick={() => setReviewing({ lead: l, decision: 'REJECT' })}>
                              Reject
                            </Button>
                            <Button size="xs" onClick={() => setReviewing({ lead: l, decision: 'ACCEPT' })}>
                              Accept
                            </Button>
                          </div>
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
        )}
      </Card>
      <Dialog open={Boolean(reviewing)} onOpenChange={(o) => !o && setReviewing(null)}>
        {reviewing ? (
          <DialogContent title={reviewing.decision === 'ACCEPT' ? `Accept ${reviewing.lead.leadNo}` : `Reject ${reviewing.lead.leadNo}`} description={reviewing.decision === 'ACCEPT' ? 'The lead is accepted into the pipeline and routed by the assignment rules.' : 'The partner sees the rejection reason on their statement.'}>
            <Field label={reviewing.decision === 'ACCEPT' ? 'Note (optional)' : 'Reason'} htmlFor="rv-reason" required={reviewing.decision === 'REJECT'}>
              <Textarea id="rv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewing(null)}>
                Cancel
              </Button>
              <Button variant={reviewing.decision === 'REJECT' ? 'destructive' : 'primary'} loading={review.isPending} disabled={reviewing.decision === 'REJECT' && reason.trim().length < 3} onClick={() => review.mutate(undefined)}>
                {reviewing.decision === 'ACCEPT' ? 'Accept lead' : 'Reject lead'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
