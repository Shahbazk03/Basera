'use client';

import * as React from 'react';
import { errorMessage } from '@estate/api-client';
import { EmptyState, ErrorState, Skeleton } from '@estate/ui';

/** Loading / error / empty handling for a query, so pages never render blank cards. */
export function QueryState<T>({
  query,
  empty,
  isEmpty,
  rows = 6,
  children,
}: {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty?: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode };
  isEmpty?: (data: T) => boolean;
  rows?: number;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-3 p-4" aria-busy>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty && isEmpty?.(query.data)) return <EmptyState {...empty} />;
  return <>{children(query.data)}</>;
}
