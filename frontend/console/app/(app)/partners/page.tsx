'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { enumLabel, formatRelative, type Paginated } from '@estate/shared';
import { Avatar, Badge, Button, Card, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface PartnerRow {
  id: string;
  name: string;
  type: string;
  status: string;
  verificationStatus: string;
  email: string | null;
  phone: string | null;
  logoUrl: string | null;
  reraRegistrationNo: string | null;
  createdAt: string;
  isDemo: boolean;
  city: { name: string } | null;
  members: number;
  listings: number;
  liveListings: number;
  projects: number;
  pendingDocuments: number;
  activePlan: { name: string; endsAt: string } | null;
}

const TYPE_LABELS: Record<string, string> = { BROKERAGE: 'Brokerages', DEVELOPER: 'Developers', INDIVIDUAL_OWNER: 'Owners', PARTNER: 'Partners' };

export default function PartnersPage() {
  const router = useRouter();
  const { can } = useSession();
  const { values, set, page, setPage } = useListParams<{ status?: string; type?: string; q?: string; verification?: string }>();
  const q = useApi<Paginated<PartnerRow> & { statusCounts: Record<string, number>; typeCounts: Record<string, number>; visibleTypes: string[] }>('/partners', { ...values, page, pageSize: 20 });
  const types = q.data?.visibleTypes ?? [];

  return (
    <>
      <PageHeader
        title="Brokers & developers"
        description="Verify partner organisations, review their documents and manage subscriptions. Listings from unverified or suspended organisations never appear on the website."
        actions={
          can('subscription.manage') ? (
            <Button asChild variant="outline">
              <Link href="/partners/plans">
                <CreditCard /> Subscription plans
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <StatusTabs
          tabs={[
            { value: undefined, label: 'All' },
            { value: 'PENDING', label: 'Awaiting verification' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'SUSPENDED', label: 'Suspended' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
          value={values.status}
          onChange={(v) => set({ status: v })}
          counts={q.data?.statusCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search name, email, RERA, member" />
          {types.length > 1 ? (
            <FilterSelect value={values.type} onChange={(v) => set({ type: v })} placeholder="All types" options={types.map((t) => ({ value: t, label: `${TYPE_LABELS[t] ?? enumLabel(t)} (${q.data?.typeCounts[t] ?? 0})` }))} />
          ) : null}
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ShieldCheck />, title: 'No organisations match', description: 'Partner organisations appear here when brokers, developers or owners register.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Organisation</TH>
                    <TH className="hidden md:table-cell">Type</TH>
                    <TH className="hidden lg:table-cell" align="right">
                      Listings
                    </TH>
                    <TH className="hidden xl:table-cell">Plan</TH>
                    <TH>Status</TH>
                    <TH className="hidden sm:table-cell">Registered</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((r) => (
                    <TR key={r.id} onClick={() => router.push(`/partners/${r.id}`)}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar name={r.name} src={r.logoUrl} size={34} />
                          <div className="min-w-0">
                            <Link href={`/partners/${r.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-1 font-medium text-ink-900 hover:underline">
                              {r.name}
                            </Link>
                            <div className="flex items-center gap-1.5 text-xs text-ink-500">
                              <span className="truncate">{r.email ?? r.phone ?? '—'}</span>
                              {r.pendingDocuments > 0 ? <Badge tone="warning" size="sm">{r.pendingDocuments} doc{r.pendingDocuments > 1 ? 's' : ''} to review</Badge> : null}
                              {r.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <div className="text-ink-800">{enumLabel(r.type)}</div>
                        <div className="text-xs text-ink-500">{r.city?.name ?? '—'}</div>
                      </TD>
                      <TD align="right" className="tabular hidden lg:table-cell">
                        <span className="font-medium text-ink-900">{r.liveListings}</span>
                        <span className="text-ink-500"> / {r.listings}</span>
                        {r.projects ? <div className="text-xs text-ink-500">{r.projects} project{r.projects > 1 ? 's' : ''}</div> : null}
                      </TD>
                      <TD className="hidden text-xs text-ink-600 xl:table-cell">{r.activePlan?.name ?? '—'}</TD>
                      <TD>
                        <StatusBadge status={r.status === 'PENDING' ? 'PENDING_VERIFICATION' : r.status} label={r.status === 'PENDING' ? 'Awaiting verification' : undefined} />
                      </TD>
                      <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatRelative(r.createdAt)}</TD>
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
    </>
  );
}
