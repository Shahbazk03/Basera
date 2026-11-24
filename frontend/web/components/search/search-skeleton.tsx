import { Skeleton } from '@estate/ui';

export function SearchSkeleton() {
  return (
    <div className="bg-canvas" aria-busy aria-label="Loading results">
      <div className="border-b border-line bg-surface">
        <div className="container-page py-6">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-4 h-8 w-80 max-w-full" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
      </div>
      <div className="container-page grid grid-cols-1 gap-8 py-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className="hidden h-[520px] lg:block" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
