'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@estate/shared';
import { api } from './api-browser';

/** Non-secret hint cookie set by the API alongside the httpOnly auth cookies. */
export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('estate_session='));
}

/** Current visitor (null when signed out). Avoids calling the API at all for anonymous visitors. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      if (!hasSessionHint()) return null;
      try {
        return await api.get<SessionUser>('/auth/me');
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    // Another tab may have switched or signed out this account.
    refetchOnWindowFocus: 'always',
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      qc.setQueryData(['me'], null);
      await qc.invalidateQueries({ queryKey: ['favourites'] });
    }
  };
}

export { consoleUrl } from './urls';
