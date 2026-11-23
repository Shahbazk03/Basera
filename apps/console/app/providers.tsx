'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@estate/api-client';
import { Toaster, TooltipProvider } from '@estate/ui';
import { BrandProvider } from '@/lib/brand';

export function Providers({ brandName, children }: { brandName: string; children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <BrandProvider name={brandName}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 4500 }} />
        </TooltipProvider>
      </QueryClientProvider>
    </BrandProvider>
  );
}
