'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserCircle } from 'lucide-react';
import { ACCOUNT_TYPES, enumLabel, formatRelative, type Paginated } from '@estate/shared';
import { Avatar, Badge, Card, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

interface UserRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  accountType: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  isDemo: boolean;
  emailVerified: boolean;
  employeeCode: string | null;
  memberships: number;
  roles: { id: string; key: string; name: string; organizationId: string | null; organizationName: string | null }[];
}

export default function UsersPage() {
  const router = useRouter();
  const { values, set, page, setPage } = useListParams<{ q?: string; accountType?: string; status?: string; roleKey?: string }>();
  const q = useApi<Paginated<UserRow> & { typeCounts: Record<string, number> }>('/admin/users', { ...values, page, pageSize: 25 });
  const roles = useApi<{ key: string; name: string }[]>('/admin/roles');
  return (
    <>
      <PageHeader title="Users" description="Every account on the platform — staff, partners and customers. Open a user to manage their roles or suspend access." />
      <Card>
        <StatusTabs
          tabs={[{ value: undefined, label: 'All' }, ...ACCOUNT_TYPES.map((t) => ({ value: t, label: enumLabel(t) }))]}
          value={values.accountType}
          onChange={(v) => set({ accountType: v })}
          counts={q.data?.typeCounts}
        />
        <Toolbar>
          <SearchBox value={values.q} onChange={(v) => set({ q: v })} placeholder="Search name, email or mobile" />
          <FilterSelect
            value={values.status}
            onChange={(v) => set({ status: v })}
            placeholder="Any status"
            options={['ACTIVE', 'SUSPENDED', 'DISABLED', 'INVITED'].map((s) => ({ value: s, label: enumLabel(s) }))}
          />
          <FilterSelect value={values.roleKey} onChange={(v) => set({ roleKey: v })} placeholder="Any role" options={(roles.data ?? []).map((r) => ({ value: r.key, label: r.name }))} />
        </Toolbar>
        <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={{ icon: <UserCircle />, title: 'No users match these filters' }}>
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>User</TH>
                    <TH className="hidden md:table-cell">Account</TH>
                    <TH>Roles</TH>
                    <TH>Status</TH>
                    <TH className="hidden lg:table-cell">Last sign-in</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((u) => (
                    <TR key={u.id} onClick={() => router.push(`/admin/users/${u.id}`)}>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.fullName} size={30} />
                          <div className="min-w-0">
                            <Link href={`/admin/users/${u.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink-900 hover:underline">
                              {u.fullName}
                            </Link>
                            <div className="truncate text-xs text-ink-500">
                              {u.email ?? u.phone ?? '—'} {u.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        {enumLabel(u.accountType)}
                        {u.employeeCode ? <div className="text-xs text-ink-500">{u.employeeCode}</div> : null}
                      </TD>
                      <TD>
                        <div className="flex max-w-80 flex-wrap gap-1">
                          {u.roles.length ? (
                            u.roles.map((r) => (
                              <Badge key={r.id} tone={r.key === 'SUPER_ADMIN' || r.key === 'ADMIN' ? 'dark' : 'neutral'} size="sm" title={r.organizationName ?? 'Platform-wide'}>
                                {r.name}
                                {r.organizationName ? <span className="text-ink-400"> · {r.organizationName.replace(/ \(Demo\)$/, '')}</span> : null}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-ink-400">No roles</span>
                          )}
                        </div>
                      </TD>
                      <TD>
                        <StatusBadge status={u.status} />
                      </TD>
                      <TD className="hidden whitespace-nowrap text-xs text-ink-500 lg:table-cell">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</TD>
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
