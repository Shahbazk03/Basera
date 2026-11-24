import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { Paginated } from '@estate/shared';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.output<typeof paginationSchema>;

export function skipTake(p: Pagination): { skip: number; take: number } {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paginated<T>(data: T[], total: number, p: Pagination): Paginated<T> {
  return { data, meta: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) } };
}

export function notFound(entity: string): never {
  throw new NotFoundException(`${entity} not found`);
}

export function conflict(message: string, code = 'CONFLICT'): never {
  throw new ConflictException({ message, code });
}

/** Builds a Prisma `orderBy` from "field" / "-field" with an allow-list. */
export function sortParam<K extends string>(value: string | undefined, allowed: readonly K[], fallback: Record<string, 'asc' | 'desc'>) {
  if (!value) return fallback;
  const desc = value.startsWith('-');
  const field = (desc ? value.slice(1) : value) as K;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? 'desc' : 'asc' } as Record<string, 'asc' | 'desc'>;
}

/** Decimal-ish → number (null-safe). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

export function isoDate(v: Date | null | undefined): string | null {
  return v ? v.toISOString().slice(0, 10) : null;
}

export function iso(v: Date | null | undefined): string | null {
  return v ? v.toISOString() : null;
}

/** Parses YYYY-MM-DD into a UTC-midnight Date for @db.Date columns. */
export function dateOnly(v: string): Date {
  return new Date(`${v}T00:00:00.000Z`);
}
