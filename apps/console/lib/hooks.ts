'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { ApiError, errorMessage, type Query } from '@estate/api-client';
import { toast } from '@estate/ui';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { api } from './api';

/** GET with TanStack Query; the key is derived from path + query. */
export function useApi<T>(path: string | null, query?: Query, options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>) {
  return useQuery<T, ApiError>({
    queryKey: [path, query ?? {}],
    queryFn: ({ signal }) => api.get<T>(path!, query, { signal }),
    enabled: path !== null && (options?.enabled ?? true),
    ...options,
  });
}

/**
 * Mutation helper with consistent toasts and cache invalidation.
 * `invalidate` lists path prefixes whose queries should refetch after success.
 */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: string[]; onSuccess?: (r: TResult, vars: TVars) => void; onError?: (e: unknown) => void; silent?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async (result, vars) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(result) : opts.success);
      if (opts.invalidate?.length) {
        await qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === 'string' && opts.invalidate!.some((p) => (q.queryKey[0] as string).startsWith(p)),
        });
      }
      opts.onSuccess?.(result, vars);
    },
    onError: (err) => {
      if (!opts.silent) toast.error(errorMessage(err));
      opts.onError?.(err);
    },
  });
}

/** Maps API validation details onto react-hook-form fields; returns true if any were applied. */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const fields = err.fieldErrors();
  let applied = false;
  for (const [path, message] of Object.entries(fields)) {
    if (!path || path === 'permission') continue;
    form.setError(path as Path<T>, { type: 'server', message });
    applied = true;
  }
  return applied;
}

/** URL-synchronised list state (page, filters) so lists are shareable and survive refresh. */
export function useListParams<T extends Record<string, string | undefined>>(defaults: T = {} as T) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const values = React.useMemo(() => {
    const out: Record<string, string | undefined> = { ...defaults };
    params.forEach((v, k) => {
      out[k] = v;
    });
    return out as T & { page?: string };
  }, [params, defaults]);

  const set = React.useCallback(
    (patch: Partial<Record<keyof T | 'page', string | undefined | null>>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      if (opts.resetPage && !('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const page = Math.max(1, Number(values.page ?? 1) || 1);
  return { values, set, page, setPage: (p: number) => set({ page: String(p) } as never, { resetPage: false }) };
}

/** Debounced value (search inputs). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
