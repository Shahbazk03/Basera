'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { PageHeader, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PropertyForm } from '@/components/listings/property-form';

export default function NewListingPage() {
  const router = useRouter();
  const { user, can } = useSession();
  const [submitting, setSubmitting] = React.useState(false);
  const orgOptions = user.memberships.filter((m) => can('property.create', m.organizationId)).map((m) => ({ id: m.organizationId, name: m.organizationName }));

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/listings" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Listings
          </Link>
        }
        title="New listing"
        description="Listings start as drafts. Add photos, then submit for review — our team checks every listing before it goes live."
      />
      <PropertyForm
        mode="create"
        organizationOptions={orgOptions}
        submitting={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            const created = await api.post<{ id: string }>('/properties', values);
            toast.success('Draft saved. Add photos next.');
            router.push(`/listings/${created.id}?tab=photos`);
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </>
  );
}
