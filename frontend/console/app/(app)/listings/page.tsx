'use client';

import * as React from 'react';
import Link from 'next/link';
import { Home, Plus } from 'lucide-react';
import type { Paginated } from '@estate/shared';
import { Button, Card, PageHeader, Pagination } from '@estate/ui';
import { ListingsTable, type ListingRow } from '@/components/listings/listings-table';
import { useApi, useListParams } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { FilterSelect, SearchBox, StatusTabs, Toolbar } from '@/components/list-toolbar';
import { QueryState } from '@/components/query-state';

const TABS = [
  { value: undefined, label: 'All' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'PENDING_REVIEW', label: 'In review' },
  { value: 'PUBLISHED', label: 'Live' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'RENTED', label: 'Rented' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export default function ListingsPage() {
  const { can, isPlatformUser } = useSession();
  const { values, set, page, setPage } = useListParams<{ status?: string; q?: string; listingType?: string; verification?: string }>();
  const query = useApi<Paginated<ListingRow> & { statusCounts: Record<string, number> }>('/properties', { ...values, page, pageSize: 20 });

  return (
    <>
      <PageHeader
        title="Listings"
        description="Every listing you can manage, with its review and publication status."
        actions={
          can('property.create') ? (
            <Button asChild>
              <Link href="/listings/new">
                <Plus /> New listing
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <StatusTabs tabs={TABS} value={values.status} onChange={(v) => set({ status: v })} counts={query.data?.statusCounts} />
        <Toolbar>
          <SearchBox value={values.q} onChange={(q) => set({ q })} placeholder="Search title, reference, locality" />
          <FilterSelect value={values.listingType} onChange={(v) => set({ listingType: v })} placeholder="Sale & rent" options={[{ value: 'SALE', label: 'For sale' }, { value: 'RENT', label: 'For rent' }]} />
          <FilterSelect
            value={values.verification}
            onChange={(v) => set({ verification: v })}
            placeholder="Any verification"
            options={[
              { value: 'VERIFIED', label: 'Verified' },
              { value: 'PENDING', label: 'Verification pending' },
              { value: 'UNVERIFIED', label: 'Unverified' },
            ]}
          />
        </Toolbar>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: <Home />,
            title: values.q || values.status ? 'No listings match these filters' : 'No listings yet',
            description: values.q || values.status ? 'Try a different status or search term.' : 'Create your first listing to start receiving enquiries.',
            action: can('property.create') && !values.q ? (
              <Button asChild size="sm">
                <Link href="/listings/new">
                  <Plus /> New listing
                </Link>
              </Button>
            ) : undefined,
          }}
        >
          {(d) => (
            <>
              <ListingsTable rows={d.data} showOrg={isPlatformUser} />
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
