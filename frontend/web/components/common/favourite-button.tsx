'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { cn, toast } from '@estate/ui';
import { errorMessage } from '@estate/api-client';
import { api } from '@/lib/api-browser';
import { useCurrentUser } from '@/lib/session';

/** Saved-property ids for the signed-in visitor (one shared query for every card on the page). */
export function useFavouriteIds() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ['favourites', user?.id ?? null],
    queryFn: async () => (user ? (await api.get<{ ids: string[] }>('/me/favourites')).ids : []),
    enabled: user !== undefined,
    staleTime: 60_000,
  });
}

export function FavouriteButton({ propertyId, variant = 'overlay' }: { propertyId: string; variant?: 'overlay' | 'outline' }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: ids } = useFavouriteIds();
  const saved = Boolean(ids?.includes(propertyId));
  // The action is fixed when clicked: `saved` flips as soon as the heart updates, before the server answers.
  const toggle = useMutation({
    mutationFn: (action: 'add' | 'remove') => (action === 'remove' ? api.delete(`/me/favourites/${propertyId}`) : api.post(`/me/favourites/${propertyId}`)),
    onMutate: async (action) => {
      const key = ['favourites', user?.id ?? null];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<string[]>(key) ?? [];
      qc.setQueryData(key, action === 'remove' ? prev.filter((x) => x !== propertyId) : prev.includes(propertyId) ? prev : [...prev, propertyId]);
      return { prev, key };
    },
    onError: (err, _action, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSuccess: (_data, action) => toast.success(action === 'remove' ? 'Removed from saved properties' : 'Saved to your account'),
  });

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save property'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) {
          router.push(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        toggle.mutate(saved ? 'remove' : 'add');
      }}
      className={cn(
        'grid place-items-center rounded-full transition-colors',
        variant === 'overlay' ? 'size-9 bg-white/92 text-ink-700 shadow-sm backdrop-blur hover:bg-white' : 'h-9 gap-2 border border-line-strong px-3 text-sm font-medium text-ink-800 hover:bg-ink-50',
      )}
    >
      <span className="inline-flex items-center gap-2">
        <Heart className={cn('size-[18px]', saved ? 'fill-danger text-danger' : '')} />
        {variant === 'outline' ? (saved ? 'Saved' : 'Save') : null}
      </span>
    </button>
  );
}
