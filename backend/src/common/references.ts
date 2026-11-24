import { slugify } from '@estate/shared';
import type { Db } from '../prisma/prisma.service';
import { randomBytes } from 'node:crypto';

/**
 * Atomic sequence per prefix and year: ENQ-2026-000123.
 * One findAndModify (upsert + $inc) — atomic under concurrency; inside a transaction it commits or
 * rolls back with it, and two transactions taking the same number conflict (and are retried).
 */
export async function nextReference(db: Db, prefix: string, now: Date = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const key = `${prefix}-${year}`;
  const res = (await db.$runCommandRaw({ findAndModify: 'reference_counters', query: { _id: key }, update: { $inc: { value: 1 } }, upsert: true, new: true })) as { value?: { value?: unknown } };
  const raw = res.value?.value;
  const value = Number(typeof raw === 'object' && raw !== null ? Object.values(raw)[0] : raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Reference counter ${key} returned an invalid value`);
  return `${key}-${String(value).padStart(6, '0')}`;
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Short, unambiguous public code (no 0/O/1/I), e.g. "PR-7K2M9X". */
export function shortCode(prefix: string, length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${out}`;
}

/** Ensures a slug is unique by appending -2, -3 … using the provided existence check. */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>, maxLength = 80): Promise<string> {
  const root = slugify(base, maxLength - 6) || 'item';
  if (!(await exists(root))) return root;
  for (let i = 2; i < 200; i += 1) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}
