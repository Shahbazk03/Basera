'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import type { PropertyCard as CardData } from '@estate/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@estate/ui';
import { errorMessage } from '@estate/api-client';
import { api } from '@/lib/api-browser';
import { useCurrentUser } from '@/lib/session';
import { PropertyCard } from '@/components/cards/property-card';

export default function SavedPage() {
  const { data: user } = useCurrentUser();
  const q = useQuery({
    queryKey: ['favourite-cards', user?.id],
    queryFn: () => api.get<{ ids: string[]; properties: CardData[] }>('/me/favourites'),
    enabled: Boolean(user),
  });
  if (q.isLoading)
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState description={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const items = q.data?.properties ?? [];
  if (!items.length)
    return (
      <div className="rounded-xl border border-line bg-surface">
        <EmptyState
          icon={<Heart />}
          title="No saved properties yet"
          description="Tap the heart on any listing to keep it here."
          action={
            <Button asChild>
              <Link href="/buy">Browse properties</Link>
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((p) => (
        <PropertyCard key={p.id} p={p} />
      ))}
    </div>
  );
}
