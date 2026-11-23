'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { formatRelative, type Paginated } from '@estate/shared';
import { Avatar, Badge, Card, PageHeader, Pagination, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { SearchBox, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface CustomerRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  isDemo: boolean;
  updatedAt: string;
  organization: { id: string; name: string };
  _count: { leads: number; deals: number; siteVisits: number; enquiries: number };
}

export default function CustomersPage() {
  const router = useRouter();
  const { isPlatformUser, workspace, activeOrgId } = useSession();
  const partnerOrg = ['broker', 'developer', 'owner'].includes(workspace) ? activeOrgId : null;
  const { values, set, page, setPage } = useListParams<{ q?: string }>();
  const query = useApi<Paginated<CustomerRow>>('/crm/customers', { q: values.q, ...(partnerOrg ? { organizationId: partnerOrg } : {}), page, pageSize: 25 });
  return (
    <>
      <PageHeader title="Customers" description="One record per person per organisation, built automatically from enquiries and leads." />
      <Card>
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Name, phone or email" />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <Users />, title: values.q ? 'No customers match' : 'No customers yet', description: 'Customers are created when someone enquires or a lead is added.' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Customer</TH>
                    <TH className="hidden md:table-cell">Contact</TH>
                    {isPlatformUser ? <TH className="hidden lg:table-cell">Organisation</TH> : null}
                    <TH align="right">Leads</TH>
                    <TH align="right" className="hidden sm:table-cell">
                      Visits
                    </TH>
                    <TH align="right">Deals</TH>
                    <TH className="hidden sm:table-cell">Updated</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((c) => (
                    <TR key={c.id} onClick={() => router.push(`/crm/customers/${c.id}`)}>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.fullName} size={30} />
                          <div>
                            <Link href={`/crm/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                              {c.fullName}
                            </Link>
                            {c.isDemo ? <Badge tone="outline" size="sm" className="ml-1.5">Demo</Badge> : null}
                            <div className="text-xs text-ink-500 md:hidden">{c.phone}</div>
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <div className="tabular text-ink-800">{c.phone ?? '—'}</div>
                        <div className="text-xs text-ink-500">{c.email ?? ''}</div>
                      </TD>
                      {isPlatformUser ? <TD className="hidden text-ink-700 lg:table-cell">{c.organization.name}</TD> : null}
                      <TD align="right" className="tabular">
                        {c._count.leads}
                      </TD>
                      <TD align="right" className="tabular hidden sm:table-cell">
                        {c._count.siteVisits}
                      </TD>
                      <TD align="right" className="tabular">
                        {c._count.deals}
                      </TD>
                      <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatRelative(c.updatedAt)}</TD>
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
