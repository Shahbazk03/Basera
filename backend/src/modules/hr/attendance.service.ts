import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import {
  attendanceStatusForMinutes,
  DEFAULT_TIMEZONE,
  eachDate,
  isLateCheckIn,
  isWorkingDay,
  localDateString,
  localMinutesOfDay,
  type hrApprovalDecisionSchema,
  type attendanceCorrectionSchema,
  type attendanceManualSchema,
  type holidaySchema,
  type shiftSchema,
} from '@estate/shared';
import { AttendanceStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { assertHr, canHr, dateStr, defaultShift, monthBounds, platformOrg, requireEmployee, toDate, todayIst, workCalendar } from './hr.util';

type ShiftRow = { id: string; name: string; startTime: string; endTime: string; graceMinutes: number; fullDayMinutes: number; halfDayMinutes: number; weeklyOffDays: number[]; timezone: string };

const FALLBACK_SHIFT: ShiftRow = { id: '', name: 'Default', startTime: '09:30', endTime: '18:30', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffDays: [0], timezone: DEFAULT_TIMEZONE };

export interface CorrectionListQuery extends Pagination {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  scope: 'mine' | 'review';
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async employeeWithShift(org: string, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: org, deletedAt: null },
      include: { shift: true, user: { select: { id: true, fullName: true } } },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    const shift: ShiftRow = emp.shift ?? (await defaultShift(this.prisma, org)) ?? FALLBACK_SHIFT;
    return { emp, shift };
  }

  private async approvedLeaveOn(employeeIds: string[], from: string, to: string) {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { lte: toDate(to) }, endDate: { gte: toDate(from) } },
      select: { employeeId: true, startDate: true, endDate: true, halfDayStart: true, halfDayEnd: true, leaveType: { select: { name: true, code: true, isPaid: true } } },
    });
  }

  // ───────────── Self service ─────────────

  async today(user: AuthUser) {
    const org = platformOrg(user);
    const { emp, shift } = await this.employeeWithShift(org, requireEmployee(user));
    const date = localDateString(new Date(), shift.timezone);
    const [record, cal, leave] = await Promise.all([
      this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: toDate(date) } } }),
      workCalendar(this.prisma, org, shift.weeklyOffDays, date, date),
      this.approvedLeaveOn([emp.id], date, date),
    ]);
    return {
      date,
      serverTime: new Date().toISOString(),
      shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, graceMinutes: shift.graceMinutes, timezone: shift.timezone },
      isWorkingDay: isWorkingDay(date, cal),
      holiday: cal.holidays.includes(date) ? (await this.prisma.holiday.findFirst({ where: { organizationId: org, date: toDate(date) }, select: { name: true } }))?.name ?? 'Holiday' : null,
      onLeave: leave[0] ? leave[0].leaveType.name : null,
      record: record ? this.recordOut(record) : null,
    };
  }

  private recordOut(r: { id: string; date: Date; checkInAt: Date | null; checkOutAt: Date | null; status: AttendanceStatus; isLate: boolean; workMinutes: number; source: string; notes: string | null }) {
    return { id: r.id, date: dateStr(r.date), checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, status: r.status, isLate: r.isLate, workMinutes: r.workMinutes, source: r.source, notes: r.notes };
  }

  async checkIn(user: AuthUser, ip: string) {
    const org = platformOrg(user);
    const { emp, shift } = await this.employeeWithShift(org, requireEmployee(user));
    if (['EXITED', 'SUSPENDED'].includes(emp.employmentStatus)) throw new ForbiddenException('Your employment is not active');
    const now = new Date();
    const date = localDateString(now, shift.timezone);
    const existing = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: toDate(date) } } });
    if (existing?.checkInAt) throw new ConflictException({ message: 'You have already checked in today', code: 'ALREADY_CHECKED_IN' });
    const isLate = isLateCheckIn(localMinutesOfDay(now, shift.timezone), shift);
    const data = { checkInAt: now, checkOutAt: null, status: 'PRESENT' as const, isLate, workMinutes: 0, source: 'WEB' as const, checkInIp: ip };
    const rec = existing
      ? await this.prisma.attendanceRecord.update({ where: { id: existing.id }, data })
      : await this.prisma.attendanceRecord.create({ data: { ...data, employeeId: emp.id, date: toDate(date) } });
    await this.audit.log({ actorId: user.id, actorIp: ip, action: 'attendance.check_in', entityType: 'AttendanceRecord', entityId: rec.id, organizationId: org, after: { date, isLate } });
    return this.recordOut(rec);
  }

  async checkOut(user: AuthUser, ip: string) {
    const org = platformOrg(user);
    const { emp, shift } = await this.employeeWithShift(org, requireEmployee(user));
    const now = new Date();
    const date = localDateString(now, shift.timezone);
    const yesterday = dateStr(new Date(toDate(date).getTime() - 86_400_000));
    const open = await this.prisma.attendanceRecord.findFirst({
      where: { employeeId: emp.id, date: { in: [toDate(date), toDate(yesterday)] }, checkInAt: { not: null }, checkOutAt: null },
      orderBy: { date: 'desc' },
    });
    if (!open || !open.checkInAt || now.getTime() - open.checkInAt.getTime() > 20 * 3_600_000) {
      const today = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: toDate(date) } } });
      if (today?.checkOutAt) throw new ConflictException({ message: 'You have already checked out today', code: 'ALREADY_CHECKED_OUT' });
      throw new ConflictException({ message: 'You have not checked in today', code: 'NOT_CHECKED_IN' });
    }
    const workMinutes = Math.max(0, Math.floor((now.getTime() - open.checkInAt.getTime()) / 60_000));
    const status = attendanceStatusForMinutes(workMinutes, shift);
    const res = await this.prisma.attendanceRecord.updateMany({ where: { id: open.id, checkOutAt: null }, data: { checkOutAt: now, workMinutes, status } });
    if (res.count !== 1) throw new ConflictException({ message: 'You have already checked out', code: 'ALREADY_CHECKED_OUT' });
    await this.audit.log({ actorId: user.id, actorIp: ip, action: 'attendance.check_out', entityType: 'AttendanceRecord', entityId: open.id, organizationId: org, after: { workMinutes, status } });
    return this.recordOut(await this.prisma.attendanceRecord.findUniqueOrThrow({ where: { id: open.id } }));
  }

  /** Calendar month for one employee (self, manager or attendance.manage). */
  async month(user: AuthUser, employeeId: string, year: number, month: number) {
    const org = platformOrg(user);
    const { emp, shift } = await this.employeeWithShift(org, employeeId);
    const self = emp.userId === user.id;
    const manager = Boolean(user.employeeId && emp.managerId === user.employeeId);
    if (!self && !manager && !canHr(user, 'attendance.manage')) throw new NotFoundException('Employee not found');
    const { start, end } = monthBounds(year, month);
    const [records, cal, leaves, holidays] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { employeeId, date: { gte: toDate(start), lte: toDate(end) } }, orderBy: { date: 'asc' } }),
      workCalendar(this.prisma, org, shift.weeklyOffDays, start, end),
      this.approvedLeaveOn([employeeId], start, end),
      this.prisma.holiday.findMany({ where: { organizationId: org, date: { gte: toDate(start), lte: toDate(end) } }, select: { date: true, name: true } }),
    ]);
    const today = localDateString(new Date(), shift.timezone);
    const byDate = new Map(records.map((r) => [dateStr(r.date), r]));
    const holidayName = new Map(holidays.map((h) => [dateStr(h.date), h.name]));
    const joining = dateStr(emp.joiningDate);
    const exit = emp.exitDate ? dateStr(emp.exitDate) : null;
    const days = eachDate(start, end).map((d) => {
      const rec = byDate.get(d);
      const leave = leaves.find((l) => dateStr(l.startDate) <= d && dateStr(l.endDate) >= d);
      const working = isWorkingDay(d, cal);
      let state: string;
      if (d < joining || (exit && d > exit)) state = 'NOT_EMPLOYED';
      else if (rec) state = rec.status;
      else if (holidayName.has(d)) state = 'HOLIDAY';
      else if (!working) state = 'WEEKLY_OFF';
      else if (leave) state = 'ON_LEAVE';
      else if (d >= today) state = 'UPCOMING';
      else state = 'NOT_MARKED';
      return { date: d, state, working, holiday: holidayName.get(d) ?? null, leave: leave ? leave.leaveType.name : null, record: rec ? this.recordOut(rec) : null };
    });
    const count = (s: string) => days.filter((x) => x.state === s).length;
    return {
      employee: { id: emp.id, name: emp.user.fullName, employeeCode: emp.employeeCode },
      shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, weeklyOffDays: shift.weeklyOffDays },
      month: `${year}-${String(month).padStart(2, '0')}`,
      days,
      summary: {
        present: count('PRESENT'),
        halfDay: count('HALF_DAY'),
        absent: count('ABSENT'),
        onLeave: count('ON_LEAVE'),
        notMarked: count('NOT_MARKED'),
        late: records.filter((r) => r.isLate).length,
        workHours: Math.round((records.reduce((a, r) => a + r.workMinutes, 0) / 60) * 10) / 10,
      },
    };
  }

  // ───────────── Team / organisation views ─────────────

  private async scopedEmployees(user: AuthUser, org: string, departmentId?: string) {
    const manage = canHr(user, 'attendance.manage');
    if (!manage && !user.employeeId) throw new ForbiddenException();
    return this.prisma.employee.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        ...(manage ? {} : { managerId: user.employeeId! }),
        ...(departmentId ? { departmentId } : {}),
      },
      include: { shift: true, user: { select: { fullName: true, avatarUrl: true } }, department: { select: { name: true } }, designation: { select: { name: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
  }

  /** Daily board: everyone in scope with their state for the date. */
  async board(user: AuthUser, date: string, departmentId?: string) {
    const org = platformOrg(user);
    const fallback = (await defaultShift(this.prisma, org)) ?? FALLBACK_SHIFT;
    const employees = (await this.scopedEmployees(user, org, departmentId)).filter((e) => dateStr(e.joiningDate) <= date && (!e.exitDate || dateStr(e.exitDate) >= date));
    const ids = employees.map((e) => e.id);
    const [records, leaves, holiday] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { employeeId: { in: ids }, date: toDate(date) } }),
      this.approvedLeaveOn(ids, date, date),
      this.prisma.holiday.findFirst({ where: { organizationId: org, date: toDate(date) }, select: { name: true } }),
    ]);
    const recBy = new Map(records.map((r) => [r.employeeId, r]));
    const rows = employees.map((e) => {
      const shift = e.shift ?? fallback;
      const rec = recBy.get(e.id);
      const leave = leaves.find((l) => l.employeeId === e.id);
      const weeklyOff = shift.weeklyOffDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const state = rec ? rec.status : holiday ? 'HOLIDAY' : weeklyOff ? 'WEEKLY_OFF' : leave ? 'ON_LEAVE' : 'NOT_MARKED';
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: e.user.fullName,
        avatarUrl: e.user.avatarUrl,
        department: e.department?.name ?? null,
        designation: e.designation?.name ?? null,
        shift: `${shift.startTime}–${shift.endTime}`,
        state,
        leave: leave?.leaveType.name ?? null,
        record: rec ? this.recordOut(rec) : null,
      };
    });
    const summary: Record<string, number> = {};
    for (const r of rows) summary[r.state] = (summary[r.state] ?? 0) + 1;
    return { date, holiday: holiday?.name ?? null, rows, summary, late: rows.filter((r) => r.record?.isLate).length };
  }

  /** Monthly summary per employee. Counts only up to yesterday for the current month. */
  async report(user: AuthUser, year: number, month: number, departmentId?: string) {
    const org = platformOrg(user);
    const fallback = (await defaultShift(this.prisma, org)) ?? FALLBACK_SHIFT;
    const { start, end } = monthBounds(year, month);
    const today = todayIst();
    const employees = (await this.scopedEmployees(user, org, departmentId)).filter((e) => dateStr(e.joiningDate) <= end && (!e.exitDate || dateStr(e.exitDate) >= start));
    const ids = employees.map((e) => e.id);
    const [records, leaves, holidays] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { employeeId: { in: ids }, date: { gte: toDate(start), lte: toDate(end) } } }),
      this.approvedLeaveOn(ids, start, end),
      this.prisma.holiday.findMany({ where: { organizationId: org, date: { gte: toDate(start), lte: toDate(end) } }, select: { date: true } }),
    ]);
    const holidayDates = holidays.map((h) => dateStr(h.date));
    const rows = employees.map((e) => {
      const shift = e.shift ?? fallback;
      const cal = { weeklyOffDays: shift.weeklyOffDays, holidays: holidayDates };
      const from = dateStr(e.joiningDate) > start ? dateStr(e.joiningDate) : start;
      const to = e.exitDate && dateStr(e.exitDate) < end ? dateStr(e.exitDate) : end;
      const workingDates = eachDate(from, to).filter((d) => isWorkingDay(d, cal));
      const recs = records.filter((r) => r.employeeId === e.id);
      const recDates = new Set(recs.map((r) => dateStr(r.date)));
      const myLeaves = leaves.filter((l) => l.employeeId === e.id);
      const onLeave = (d: string) => myLeaves.some((l) => dateStr(l.startDate) <= d && dateStr(l.endDate) >= d);
      const leaveDays = workingDates.filter(onLeave).length;
      const notMarked = workingDates.filter((d) => d < today && !recDates.has(d) && !onLeave(d)).length;
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: e.user.fullName,
        department: e.department?.name ?? null,
        workingDays: workingDates.length,
        present: recs.filter((r) => r.status === 'PRESENT').length,
        halfDay: recs.filter((r) => r.status === 'HALF_DAY').length,
        absent: recs.filter((r) => r.status === 'ABSENT').length,
        late: recs.filter((r) => r.isLate).length,
        leaveDays,
        notMarked,
        workHours: Math.round((recs.reduce((a, r) => a + r.workMinutes, 0) / 60) * 10) / 10,
      };
    });
    return { month: `${year}-${String(month).padStart(2, '0')}`, rows };
  }

  async manual(user: AuthUser, input: z.output<typeof attendanceManualSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'attendance.manage');
    const { emp, shift } = await this.employeeWithShift(org, input.employeeId);
    if (emp.userId === user.id) throw new ForbiddenException('You cannot edit your own attendance — submit a correction request instead');
    if (input.date > todayIst(shift.timezone)) throw new BadRequestException({ message: 'Attendance cannot be recorded for a future date', details: [{ path: 'date', message: 'Future date' }] });
    const checkInAt = input.checkInAt ? new Date(input.checkInAt) : null;
    const checkOutAt = input.checkOutAt ? new Date(input.checkOutAt) : null;
    if (checkInAt && checkOutAt && checkOutAt <= checkInAt) throw new BadRequestException({ message: 'Check-out must be after check-in', details: [{ path: 'checkOutAt', message: 'Before check-in' }] });
    const workMinutes = checkInAt && checkOutAt ? Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60_000) : 0;
    const isLate = checkInAt ? isLateCheckIn(localMinutesOfDay(checkInAt, shift.timezone), shift) : false;
    const before = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: toDate(input.date) } } });
    const data = { status: input.status, checkInAt, checkOutAt, workMinutes, isLate, source: 'MANUAL' as const, notes: input.notes ?? null };
    const rec = await this.prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: emp.id, date: toDate(input.date) } },
      create: { ...data, employeeId: emp.id, date: toDate(input.date) },
      update: data,
    });
    await this.audit.log({ actorId: user.id, action: 'attendance.manual', entityType: 'AttendanceRecord', entityId: rec.id, organizationId: org, before: before ? this.recordOut(before) : null, after: this.recordOut(rec) });
    return this.recordOut(rec);
  }

  // ───────────── Corrections ─────────────

  async requestCorrection(user: AuthUser, input: z.output<typeof attendanceCorrectionSchema>) {
    const org = platformOrg(user);
    const { emp, shift } = await this.employeeWithShift(org, requireEmployee(user));
    if (input.date > todayIst(shift.timezone)) throw new BadRequestException({ message: 'You cannot request a correction for a future date', details: [{ path: 'date', message: 'Future date' }] });
    for (const [field, v] of [['requestedCheckIn', input.requestedCheckIn], ['requestedCheckOut', input.requestedCheckOut]] as const) {
      if (v && localDateString(new Date(v), shift.timezone) !== input.date) throw new BadRequestException({ message: 'Times must fall on the selected date', details: [{ path: field, message: 'Different date' }] });
    }
    if (input.requestedCheckIn && input.requestedCheckOut && new Date(input.requestedCheckOut) <= new Date(input.requestedCheckIn)) {
      throw new BadRequestException({ message: 'Check-out must be after check-in', details: [{ path: 'requestedCheckOut', message: 'Before check-in' }] });
    }
    if (await this.prisma.attendanceCorrection.findFirst({ where: { employeeId: emp.id, date: toDate(input.date), status: 'PENDING' } })) {
      throw new ConflictException({ message: 'You already have a pending correction for this date', code: 'DUPLICATE_REQUEST' });
    }
    const record = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: toDate(input.date) } }, select: { id: true } });
    const row = await this.prisma.attendanceCorrection.create({
      data: {
        employeeId: emp.id,
        attendanceId: record?.id ?? null,
        date: toDate(input.date),
        requestedCheckIn: input.requestedCheckIn ? new Date(input.requestedCheckIn) : null,
        requestedCheckOut: input.requestedCheckOut ? new Date(input.requestedCheckOut) : null,
        reason: input.reason,
      },
    });
    await this.audit.log({ actorId: user.id, action: 'attendance.correction.request', entityType: 'AttendanceCorrection', entityId: row.id, organizationId: org, after: { date: input.date } });
    return row;
  }

  async listCorrections(user: AuthUser, q: CorrectionListQuery) {
    const org = platformOrg(user);
    let where: Prisma.AttendanceCorrectionWhereInput;
    if (q.scope === 'mine') where = { employeeId: requireEmployee(user) };
    else if (canHr(user, 'attendance.manage')) where = { employee: { organizationId: org } };
    else if (user.employeeId) where = { employee: { managerId: user.employeeId } };
    else throw new ForbiddenException();
    if (q.status) where = { ...where, status: q.status };
    const [rows, total] = await Promise.all([
      this.prisma.attendanceCorrection.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: { employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } }, attendance: true, reviewedBy: { select: { fullName: true } } },
        ...skipTake(q),
      }),
      this.prisma.attendanceCorrection.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...r, date: dateStr(r.date), attendance: r.attendance ? this.recordOut(r.attendance) : null })),
      total,
      q,
    );
  }

  async decideCorrection(user: AuthUser, id: string, input: z.output<typeof hrApprovalDecisionSchema>) {
    const org = platformOrg(user);
    const c = await this.prisma.attendanceCorrection.findFirst({ where: { id, employee: { organizationId: org } }, include: { employee: { include: { shift: true } } } });
    if (!c) throw new NotFoundException('Correction request not found');
    if (c.employee.userId === user.id) throw new ForbiddenException('You cannot approve your own correction request');
    const isManager = Boolean(user.employeeId && c.employee.managerId === user.employeeId);
    if (!isManager && !canHr(user, 'attendance.manage')) throw new ForbiddenException('Only the reporting manager or HR can review this request');
    const shift: ShiftRow = c.employee.shift ?? (await defaultShift(this.prisma, org)) ?? FALLBACK_SHIFT;
    const approved = input.decision === 'APPROVE';
    await this.prisma.$transaction(async (tx: Tx) => {
      const res = await tx.attendanceCorrection.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approved ? 'APPROVED' : 'REJECTED', reviewedById: user.id, reviewedAt: new Date(), reviewNote: input.note ?? null },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This request has already been reviewed', code: 'ALREADY_DECIDED' });
      if (approved) {
        const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: c.employeeId, date: c.date } } });
        const checkInAt = c.requestedCheckIn ?? existing?.checkInAt ?? null;
        const checkOutAt = c.requestedCheckOut ?? existing?.checkOutAt ?? null;
        const workMinutes = checkInAt && checkOutAt ? Math.max(0, Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 60_000)) : 0;
        const status = checkInAt && checkOutAt ? attendanceStatusForMinutes(workMinutes, shift) : checkInAt ? 'PRESENT' : (existing?.status ?? 'ABSENT');
        const isLate = checkInAt ? isLateCheckIn(localMinutesOfDay(checkInAt, shift.timezone), shift) : false;
        const data = { checkInAt, checkOutAt, workMinutes, status, isLate, source: 'CORRECTION' as const, notes: `Correction approved: ${c.reason}`.slice(0, 500) };
        const rec = await tx.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: c.employeeId, date: c.date } },
          create: { ...data, employeeId: c.employeeId, date: c.date },
          update: data,
        });
        await tx.attendanceCorrection.update({ where: { id }, data: { attendanceId: rec.id } });
      }
      await this.audit.log({ actorId: user.id, action: `attendance.correction.${approved ? 'approve' : 'reject'}`, entityType: 'AttendanceCorrection', entityId: id, organizationId: org, metadata: { note: input.note ?? null } }, tx);
    });
    return { ok: true, status: approved ? 'APPROVED' : 'REJECTED' };
  }

  async cancelCorrection(user: AuthUser, id: string) {
    const res = await this.prisma.attendanceCorrection.updateMany({ where: { id, status: 'PENDING', employee: { userId: user.id } }, data: { status: 'CANCELLED' } });
    if (res.count !== 1) throw new ConflictException('Only your own pending requests can be cancelled');
    return { ok: true };
  }

  // ───────────── Shifts & holidays ─────────────

  async shifts(user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'attendance.manage', 'employee.manage', 'employee.view');
    return this.prisma.shift.findMany({ where: { organizationId: org }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], include: { _count: { select: { employees: { where: { deletedAt: null, employmentStatus: { not: 'EXITED' } } } } } } });
  }

  async saveShift(user: AuthUser, id: string | null, input: Partial<z.output<typeof shiftSchema>>) {
    const org = platformOrg(user);
    assertHr(user, 'attendance.manage');
    if (input.halfDayMinutes !== undefined && input.fullDayMinutes !== undefined && input.halfDayMinutes >= input.fullDayMinutes) {
      throw new BadRequestException({ message: 'Half-day minutes must be less than full-day minutes', details: [{ path: 'halfDayMinutes', message: 'Too high' }] });
    }
    const before = id ? await this.prisma.shift.findFirst({ where: { id, organizationId: org } }) : null;
    if (id && !before) throw new NotFoundException('Shift not found');
    const name = input.name ?? before?.name;
    if (name && (await this.prisma.shift.findFirst({ where: { organizationId: org, name, ...(id ? { id: { not: id } } : {}) } }))) {
      throw new ConflictException({ message: 'A shift with this name already exists', details: [{ path: 'name', message: 'Already exists' }] });
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.shift.updateMany({ where: { organizationId: org }, data: { isDefault: false } });
      const r = id
        ? await tx.shift.update({ where: { id }, data: input })
        : await tx.shift.create({ data: { ...(input as z.output<typeof shiftSchema>), organizationId: org } });
      await this.audit.log({ actorId: user.id, action: id ? 'hr.shift.update' : 'hr.shift.create', entityType: 'Shift', entityId: r.id, organizationId: org, before, after: r }, tx);
      return r;
    });
    return row;
  }

  async holidays(user: AuthUser, year: number) {
    const org = platformOrg(user);
    if (!user.employeeId) assertHr(user, 'attendance.manage', 'leave.manage');
    const rows = await this.prisma.holiday.findMany({ where: { organizationId: org, date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } }, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ ...h, date: dateStr(h.date) }));
  }

  async addHoliday(user: AuthUser, input: z.output<typeof holidaySchema>) {
    const org = platformOrg(user);
    assertHr(user, 'attendance.manage');
    if (await this.prisma.holiday.findUnique({ where: { organizationId_date: { organizationId: org, date: toDate(input.date) } } })) {
      throw new ConflictException({ message: 'A holiday already exists on this date', details: [{ path: 'date', message: 'Already a holiday' }] });
    }
    const row = await this.prisma.holiday.create({ data: { organizationId: org, date: toDate(input.date), name: input.name, isOptional: input.isOptional ?? false } });
    await this.audit.log({ actorId: user.id, action: 'hr.holiday.create', entityType: 'Holiday', entityId: row.id, organizationId: org, after: { date: input.date, name: input.name } });
    return { ...row, date: input.date };
  }

  async removeHoliday(user: AuthUser, id: string) {
    const org = platformOrg(user);
    assertHr(user, 'attendance.manage');
    const row = await this.prisma.holiday.findFirst({ where: { id, organizationId: org } });
    if (!row) throw new NotFoundException('Holiday not found');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'hr.holiday.delete', entityType: 'Holiday', entityId: id, organizationId: org, before: { date: dateStr(row.date), name: row.name } });
    return { ok: true };
  }
}
