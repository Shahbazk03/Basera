'use client';

import { createApiClient } from '@estate/api-client';

/** Browser client: same-origin /api/v1 (rewritten to the API) with silent session refresh. */
export const api = createApiClient({ baseUrl: '', refreshOn401: true });
