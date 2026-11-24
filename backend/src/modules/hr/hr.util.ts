import { BadRequestException, ForbiddenException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_TIMEZONE, localDateString, type PermissionKey, type WorkCalendar } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { zodIssues } from '../../common/zod.pipe';
import type { Db } from '../../prisma/prisma.service';

/** All HR / payroll data belongs to the platform organisation. */
export function platformOrg(user: AuthUser): string {
  const id = user.platformOrganizationId;
  if (!id) throw new ForbiddenException('The platform organisation is not configured');
  return id;
}

/** True when the user holds ANY of the permissions for the platform organisation. */
export function canHr(user: AuthUser, ...perms: PermissionKey[]): boolean {
  const org = user.platformOrganizationId;
  return perms.some((p) => user.can(p, org));
}

export function assertHr(user: AuthUser, ...perms: PermissionKey[]): void {
  if (!canHr(user, ...perms)) throw new ForbiddenException('You do not have permission to perform this action');
}

export function requireEmployee(user: AuthUser): string {
  if (!user.employeeId) throw new ForbiddenException({ message: 'This action is only available to employees', code: 'NOT_AN_EMPLOYEE' });
  return user.employeeId;
}

/** PATCH validation (keeps only the keys sent) — shared implementation, re-exported for the HR modules. */
export { PatchPipe } from '../../common/zod.pipe';

export const dateStr = (d: Date): string => d.toISOString().slice(0, 10);
export const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

export function todayIst(timeZone = DEFAULT_TIMEZONE): string {
  return localDateString(new Date(), timeZone);
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

export const monthQuery = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
  .optional();

export function parseMonth(value: string | undefined): { year: number; month: number } {
  const v = value ?? todayIst().slice(0, 7);
  return { year: Number(v.slice(0, 4)), month: Number(v.slice(5, 7)) };
}

/** Weekly offs of a shift + organisation holidays between two dates. */
export async function workCalendar(db: Db, organizationId: string, weeklyOffDays: number[], from: string, to: string): Promise<WorkCalendar> {
  const holidays = await db.holiday.findMany({ where: { organizationId, date: { gte: toDate(from), lte: toDate(to) } }, select: { date: true } });
  return { weeklyOffDays, holidays: holidays.map((h) => dateStr(h.date)) };
}

export async function defaultShift(db: Db, organizationId: string) {
  return (
    (await db.shift.findFirst({ where: { organizationId, isDefault: true } })) ??
    (await db.shift.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' } }))
  );
}

export function fmtDate(s: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(toDate(s));
}

export function periodLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}
