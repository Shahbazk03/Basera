import { Skeleton } from '@estate/ui';

export default function Loading() {
  return (
    <div className="container-page pb-16 pt-6" aria-busy aria-label="Loading property">
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="mt-5 h-[300px] w-full rounded-xl md:h-[440px]" />
      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-[460px] w-full rounded-xl" />
      </div>
    </div>
  );
}
