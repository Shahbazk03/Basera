import { z } from 'zod';

/**
 * Boolean query-string parameter. `z.coerce.boolean()` treats every non-empty string — including
 * "false" and "0" — as true; this accepts only explicit values and leaves anything else unset.
 */
export const queryBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return undefined;
}, z.boolean().optional());
