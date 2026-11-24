'use client';

import * as React from 'react';
import { BadgeCheck } from 'lucide-react';
import type { Paginated } from '@estate/shared';
import { Card, PageHeader, Pagination } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { SearchBox, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { ProjectsTable } from '@/components/projects/projects-table';
import type { ProjectListRow } from '@/components/projects/types';

export default function ProjectReviewsPage() {
  const { values, set, page, setPage } = useListParams<{ q?: string }>();
  const query = useApi<Paginated<ProjectListRow>>('/projects', { review: 'PENDING_REVIEW', q: values.q, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="Project approvals" description="Projects submitted by developers for review, oldest first. Open a project to check its details, inventory and documents before approving." />
      <Card>
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Search projects" />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <BadgeCheck />, title: 'No projects waiting for review', description: 'Submissions from developers will appear here.' }}>
          {(d) => (
            <>
              <ProjectsTable rows={d.data} showOrg />
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
