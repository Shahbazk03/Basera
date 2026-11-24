'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import type { Paginated } from '@estate/shared';
import { Button, Card, PageHeader, Pagination } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { ProjectsTable } from '@/components/projects/projects-table';
import type { ProjectListRow } from '@/components/projects/types';

const TABS = [
  { value: undefined, label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'PRE_LAUNCH', label: 'Pre-launch' },
  { value: 'BOOKING_OPEN', label: 'Booking open' },
  { value: 'CLOSING_SOON', label: 'Closing soon' },
  { value: 'SOLD_OUT', label: 'Sold out' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export default function ProjectsPage() {
  const { can, isPlatformUser } = useSession();
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string; review?: string; published?: string }>();
  const query = useApi<Paginated<ProjectListRow> & { statusCounts: Record<string, number> }>('/projects', { ...values, page, pageSize: 20 });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Developments with live inventory, microsites and their review and publication status."
        actions={
          can('project.create') ? (
            <Button asChild>
              <Link href="/projects/new">
                <Plus /> New project
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <StatusTabs tabs={TABS} value={values.status} onChange={(v) => set({ status: v })} counts={query.data?.statusCounts} />
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Search name, locality, RERA no." />
          <FilterSelect
            value={values.review}
            onChange={(v) => set({ review: v })}
            placeholder="Any review state"
            options={[
              { value: 'PENDING_REVIEW', label: 'Awaiting review' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Changes requested' },
              { value: 'NOT_SUBMITTED', label: 'Not submitted' },
            ]}
          />
          <FilterSelect
            value={values.published}
            onChange={(v) => set({ published: v })}
            placeholder="Published & unpublished"
            options={[
              { value: 'true', label: 'Published' },
              { value: 'false', label: 'Not published' },
            ]}
          />
        </Toolbar>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: <Building2 />,
            title: values.q || values.status || values.review ? 'No projects match these filters' : 'No projects yet',
            description: values.q || values.status ? 'Try another status or search term.' : 'Create a project to publish its microsite and manage inventory.',
            action:
              can('project.create') && !values.q ? (
                <Button asChild size="sm">
                  <Link href="/projects/new">
                    <Plus /> New project
                  </Link>
                </Button>
              ) : undefined,
          }}
        >
          {(d) => (
            <>
              <ProjectsTable rows={d.data} showOrg={isPlatformUser} />
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
