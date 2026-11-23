'use client';

import { createApiClient } from '@estate/api-client';

/** Browser API client: same-origin (/api/v1 is rewritten to the API), silent session refresh on 401. */
export const api = createApiClient({
  baseUrl: '',
  refreshOn401: true,
  onAuthFailure: () => {
    if (typeof window === 'undefined') return;
    const here = window.location.pathname + window.location.search;
    if (!window.location.pathname.startsWith('/login')) window.location.assign(`/login?next=${encodeURIComponent(here)}`);
  },
});
