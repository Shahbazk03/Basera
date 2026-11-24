'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, UserCog } from 'lucide-react';
import { enumLabel, formatDate, type Paginated } from '@estate/shared';
import { Avatar, Badge, Button, Card, PageHeader, Pagination, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { DepartmentFilter } from '@/components/hr/pickers';
import type { Designation, EmployeeRow } from '@/components/hr/types';

const TABS = [
  { value: undefined, label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'ON_NOTICE', label: 'On notice' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'EXITED', label: 'Exited' },
];

export default function EmployeesPage() {
  const router = useRouter();
  const { can, user } = useSession();
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string; departmentId?: string; designationId?: string }>();
  const query = useApi<Paginated<EmployeeRow> & { statusCounts: Record<string, number> }>('/hr/employees', { ...values, page, pageSize: 25 });
  const designations = useApi<Designation[]>('/hr/designations');
  const canManage = can('employee.manage', user.platformOrganizationId);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Directory of everyone on the company payroll, with reporting lines and employment status."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/hr/employees/new">
                <Plus /> Add employee
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <StatusTabs tabs={TABS} value={values.status} onChange={(v) => set({ status: v })} counts={query.data?.statusCounts} />
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Search name, email or code" />
          <DepartmentFilter value={values.departmentId} onChange={(v) => set({ departmentId: v })} />
          <FilterSelect value={values.designationId} onChange={(v) => set({ designationId: v })} placeholder="All designations" options={(designations.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        </Toolbar>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={{ icon: <UserCog />, title: values.q || values.status ? 'No employees match these filters' : 'No employees yet', description: canManage ? 'Add your first employee to start tracking attendance, leave and payroll.' : undefined }}
        >
          {(d) => (
            <>
              <Table>
                <THead>
                  <tr>
                    <TH>Employee</TH>
                    <TH className="hidden md:table-cell">Department & designation</TH>
                    <TH className="hidden lg:table-cell">Reports to</TH>
                    <TH className="hidden sm:table-cell">Joined</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.data.map((e) => (
                    <TR key={e.id} onClick={() => router.push(`/hr/employees/${e.id}`)}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar name={e.user.fullName} src={e.user.avatarUrl} size={34} />
                          <div className="min-w-0">
                            <Link href={`/hr/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="block truncate font-medium text-ink-900 hover:underline">
                              {e.user.fullName}
                            </Link>
                            <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-500">
                              <span className="tabular">{e.employeeCode}</span>
                              <span>·</span>
                              <span className="truncate">{e.user.email}</span>
                              {e.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <div className="text-ink-800">{e.designation?.name ?? '—'}</div>
                        <div className="text-xs text-ink-500">{e.department?.name ?? 'No department'}</div>
                      </TD>
                      <TD className="hidden lg:table-cell">{e.manager ? e.manager.user.fullName : <span className="text-ink-400">—</span>}</TD>
                      <TD className="hidden whitespace-nowrap sm:table-cell">
                        {formatDate(e.joiningDate)}
                        <div className="text-xs text-ink-500">{enumLabel(e.employmentType)}</div>
                      </TD>
                      <TD>
                        <StatusBadge status={e.employmentStatus} />
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
    </>
  );
}
