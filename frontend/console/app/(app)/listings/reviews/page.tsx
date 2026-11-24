'use client';

import * as React from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Paginated } from '@estate/shared';
import { Card, PageHeader, Pagination } from '@estate/ui';
import { useApi, useListParams } from '@/lib/hooks';
import { SearchBox, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';
import { ListingsTable, type ListingRow } from '@/components/listings/listings-table';

export default function ListingReviewsPage() {
  const { values, set, page, setPage } = useListParams<{ q?: string }>();
  const query = useApi<Paginated<ListingRow>>('/properties', { status: 'PENDING_REVIEW', q: values.q, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="Listing approvals" description="Listings submitted for review, oldest first. Open a listing to check its details, photos and documents before approving." />
      <Card>
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Search title, reference, lister" />
        </Toolbar>
        <QueryState query={query} isEmpty={(d) => d.data.length === 0} empty={{ icon: <ClipboardCheck />, title: 'Nothing waiting for review', description: 'New submissions will appear here.' }}>
          {(d) => (
            <>
              <ListingsTable rows={d.data} showOrg />
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
