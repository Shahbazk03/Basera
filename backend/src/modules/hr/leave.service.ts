import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import {
  countLeaveDays,
  type leaveApplySchema,
  type leaveBalanceSetSchema,
  type leaveDecisionSchema,
  type leaveTypeSchema,
  type leaveYearAllocateSchema,
} from '@estate/shared';
import { Prisma, ApprovalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { env } from '../../config/env';
import { NotificationsService, type Recipient } from '../notifications/notifications.service';
import { assertHr, canHr, dateStr, defaultShift, fmtDate, monthBounds, platformOrg, requireEmployee, toDate, todayIst, workCalendar } from './hr.util';
import { segmentedPage, type Segment } from '../../common/ordering';

export interface LeaveListQuery extends Pagination {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  scope: 'mine' | 'team' | 'all';
  employeeId?: string;
}

const n = (v: number | null | undefined) => Number(v ?? 0);

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Types ─────────────

  async types(user: AuthUser) {
    const org = platformOrg(user);
    if (!user.employeeId) assertHr(user, 'leave.manage', 'leave.approve', 'employee.manage');
    return this.prisma.leaveType.findMany({ where: { organizationId: org }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  async saveType(user: AuthUser, id: string | null, input: Partial<z.output<typeof leaveTypeSchema>>) {
    const org = platformOrg(user);
    assertHr(user, 'leave.manage');
    const before = id ? await this.prisma.leaveType.findFirst({ where: { id, organizationId: org } }) : null;
    if (id && !before) throw new NotFoundException('Leave type not found');
    const code = input.code ?? before?.code;
    if (code && (await this.prisma.leaveType.findFirst({ where: { organizationId: org, code, ...(id ? { id: { not: id } } : {}) } }))) {
      throw new ConflictException({ message: `Leave code ${code} already exists`, details: [{ path: 'code', message: 'Already exists' }] });
    }
    if (id && input.isPaid !== undefined && input.isPaid !== before!.isPaid && (await this.prisma.leaveRequest.count({ where: { leaveTypeId: id, status: { in: ['PENDING', 'APPROVED'] } } })) > 0) {
      throw new ConflictException('Paid/unpaid cannot change while requests of this type are pending or approved');
    }
    const row = id
      ? await this.prisma.leaveType.update({ where: { id }, data: input })
      : await this.prisma.leaveType.create({ data: { ...(input as z.output<typeof leaveTypeSchema>), organizationId: org } });
    await this.audit.log({ actorId: user.id, action: id ? 'hr.leave_type.update' : 'hr.leave_type.create', entityType: 'LeaveType', entityId: row.id, organizationId: org, before, after: row });
    return row;
  }

  // ───────────── Balances ─────────────

  private async pendingDays(employeeId: string, leaveTypeId: string, year: number, excludeId?: string) {
    const agg = await this.prisma.leaveRequest.aggregate({
      where: { employeeId, leaveTypeId, status: 'PENDING', startDate: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      _sum: { days: true },
    });
    return n(agg._sum.days);
  }

  async balances(user: AuthUser, year: number, employeeId?: string) {
    const org = platformOrg(user);
    let where: Prisma.LeaveBalanceWhereInput = { year, employee: { organizationId: org, deletedAt: null } };
    if (employeeId) {
      const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: org }, select: { userId: true, managerId: true } });
      if (!emp) throw new NotFoundException('Employee not found');
      const allowed = emp.userId === user.id || emp.managerId === user.employeeId || canHr(user, 'leave.manage', 'employee.manage');
      if (!allowed) throw new NotFoundException('Employee not found');
      where = { ...where, employeeId };
    } else if (!canHr(user, 'leave.manage', 'employee.manage')) {
      if (!user.employeeId) throw new ForbiddenException();
      where = { ...where, employee: { organizationId: org, managerId: user.employeeId } };
    }
    const rows = await this.prisma.leaveBalance.findMany({
      where,
      include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true } }, employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } } },
      orderBy: [{ employee: { employeeCode: 'asc' } }, { leaveType: { name: 'asc' } }],
    });
    const pending = await this.prisma.leaveRequest.groupBy({
      by: ['employeeId', 'leaveTypeId'],
      where: { status: 'PENDING', employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] }, startDate: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } },
      _sum: { days: true },
    });
    const pendingBy = new Map(pending.map((p) => [`${p.employeeId}:${p.leaveTypeId}`, n(p._sum.days)]));
    return rows.map((b) => {
      const p = pendingBy.get(`${b.employeeId}:${b.leaveTypeId}`) ?? 0;
      return {
        id: b.id,
        year: b.year,
        employee: { id: b.employee.id, employeeCode: b.employee.employeeCode, name: b.employee.user.fullName },
        leaveType: b.leaveType,
        allocated: n(b.allocated),
        carriedForward: n(b.carriedForward),
        used: n(b.used),
        pending: p,
        available: n(b.allocated) + n(b.carriedForward) - n(b.used),
      };
    });
  }

  async setBalance(user: AuthUser, input: z.output<typeof leaveBalanceSetSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'leave.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id: input.employeeId, organizationId: org, deletedAt: null }, select: { userId: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.userId === user.id) throw new ForbiddenException('You cannot change your own leave balance');
    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, organizationId: org } });
    if (!type) throw new NotFoundException('Leave type not found');
    const key = { employeeId_leaveTypeId_year: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year } };
    const before = await this.prisma.leaveBalance.findUnique({ where: key });
    if (before && input.allocated + (input.carriedForward ?? n(before.carriedForward)) < n(before.used)) {
      throw new BadRequestException({ message: `Allocation cannot be below the ${n(before.used)} day(s) already used`, details: [{ path: 'allocated', message: 'Below used days' }] });
    }
    const row = await this.prisma.leaveBalance.upsert({
      where: key,
      create: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year, allocated: input.allocated, carriedForward: input.carriedForward ?? 0 },
      update: { allocated: input.allocated, ...(input.carriedForward !== undefined ? { carriedForward: input.carriedForward } : {}) },
    });
    await this.audit.log({ actorId: user.id, action: 'hr.leave_balance.set', entityType: 'LeaveBalance', entityId: row.id, organizationId: org, before, after: row });
    return row;
  }

  /** Creates the year's balances for every active employee and type (carrying forward where configured). */
  async allocateYear(user: AuthUser, input: z.output<typeof leaveYearAllocateSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'leave.manage');
    const [employees, types] = await Promise.all([
      this.prisma.employee.findMany({ where: { organizationId: org, deletedAt: null, employmentStatus: { not: 'EXITED' } }, select: { id: true } }),
      this.prisma.leaveType.findMany({ where: { organizationId: org, isActive: true } }),
    ]);
    const prev = input.carryForward
      ? await this.prisma.leaveBalance.findMany({ where: { year: input.year - 1, employeeId: { in: employees.map((e) => e.id) }, leaveType: { carryForward: true } } })
      : [];
    const prevBy = new Map(prev.map((p) => [`${p.employeeId}:${p.leaveTypeId}`, p]));
    let created = 0;
    for (const e of employees) {
      for (const t of types) {
        const p = prevBy.get(`${e.id}:${t.id}`);
        const leftover = p ? Math.max(0, n(p.allocated) + n(p.carriedForward) - n(p.used)) : 0;
        const carried = t.carryForward ? Math.min(leftover, t.maxCarryForward != null ? n(t.maxCarryForward) : leftover) : 0;
        const key = { employeeId: e.id, leaveTypeId: t.id, year: input.year };
        if (await this.prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: key }, select: { id: true } })) continue;
        try {
          await this.prisma.leaveBalance.create({ data: { ...key, allocated: t.annualQuota, carriedForward: carried } });
          created += 1;
        } catch (err) {
          // Allocated concurrently by another run — same outcome as the former skipDuplicates.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        }
      }
    }
    await this.audit.log({ actorId: user.id, action: 'hr.leave_balance.allocate_year', entityType: 'LeaveBalance', organizationId: org, metadata: { year: input.year, created, carryForward: input.carryForward } });
    return { created, employees: employees.length, types: types.length };
  }

  // ───────────── Calendar info for the applicant ─────────────

  async myCalendar(user: AuthUser, year: number) {
    const org = platformOrg(user);
    const emp = await this.prisma.employee.findFirst({ where: { id: requireEmployee(user), organizationId: org }, include: { shift: true } });
    const shift = emp?.shift ?? (await defaultShift(this.prisma, org));
    const cal = await workCalendar(this.prisma, org, shift?.weeklyOffDays ?? [0], `${year}-01-01`, `${year + 1}-12-31`);
    return { weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays };
  }

  // ───────────── Requests ─────────────

  private async approverRecipients(org: string, employeeId: string): Promise<Recipient[]> {
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { manager: { select: { userId: true, employmentStatus: true } } } });
    if (e?.manager && e.manager.employmentStatus !== 'EXITED') {
      const r = await this.notifications.userRecipient(e.manager.userId);
      if (r) return [r];
    }
    return this.notifications.recipientsWithPermission('leave.manage', org);
  }

  async apply(user: AuthUser, input: z.output<typeof leaveApplySchema>) {
    const org = platformOrg(user);
    const emp = await this.prisma.employee.findFirst({ where: { id: requireEmployee(user), organizationId: org }, include: { shift: true, user: { select: { fullName: true } } } });
    if (!emp || ['EXITED', 'SUSPENDED'].includes(emp.employmentStatus)) throw new ForbiddenException('Your employment is not active');
    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, organizationId: org, isActive: true } });
    if (!type) throw new BadRequestException({ message: 'Choose a valid leave type', details: [{ path: 'leaveTypeId', message: 'Invalid' }] });
    if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) {
      throw new BadRequestException({ message: 'A request cannot span two calendar years — submit one request per year', details: [{ path: 'endDate', message: 'Different year' }] });
    }
    if ((input.halfDayStart || input.halfDayEnd) && !type.allowHalfDay) {
      throw new BadRequestException({ message: `${type.name} cannot be taken as half days`, details: [{ path: 'halfDayStart', message: 'Half days not allowed' }] });
    }
    if (input.startDate < dateStr(emp.joiningDate)) throw new BadRequestException({ message: 'Leave cannot start before your joining date', details: [{ path: 'startDate', message: 'Before joining' }] });
    const shift = emp.shift ?? (await defaultShift(this.prisma, org));
    const cal = await workCalendar(this.prisma, org, shift?.weeklyOffDays ?? [0], input.startDate, input.endDate);
    const days = countLeaveDays(input.startDate, input.endDate, cal, { halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd });
    if (days <= 0) throw new BadRequestException({ message: 'The selected dates fall on weekly offs or holidays', details: [{ path: 'startDate', message: 'No working days selected' }] });

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { employeeId: emp.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: toDate(input.endDate) }, endDate: { gte: toDate(input.startDate) } },
      select: { startDate: true, endDate: true, status: true },
    });
    if (overlap) throw new ConflictException({ message: `You already have a ${overlap.status.toLowerCase()} request from ${fmtDate(dateStr(overlap.startDate))} to ${fmtDate(dateStr(overlap.endDate))}`, code: 'OVERLAPPING_LEAVE' });

    const year = Number(input.startDate.slice(0, 4));
    if (type.isPaid) {
      const bal = await this.prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: type.id, year } } });
      const available = bal ? n(bal.allocated) + n(bal.carriedForward) - n(bal.used) - (await this.pendingDays(emp.id, type.id, year)) : 0;
      if (available < days) {
        throw new BadRequestException({ message: `Insufficient ${type.name} balance: ${available} day(s) available after pending requests, ${days} requested`, code: 'INSUFFICIENT_BALANCE', details: [{ path: 'leaveTypeId', message: 'Insufficient balance' }] });
      }
    }

    const approvers = await this.approverRecipients(org, emp.id);
    const result = await this.prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.create({
        data: { employeeId: emp.id, leaveTypeId: type.id, startDate: toDate(input.startDate), endDate: toDate(input.endDate), halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd, days, reason: input.reason },
      });
      await this.audit.log({ actorId: user.id, action: 'leave.apply', entityType: 'LeaveRequest', entityId: req.id, organizationId: org, after: { leaveType: type.code, startDate: input.startDate, endDate: input.endDate, days } }, tx);
      const outbox = await this.notifications.notify(
        {
          eventKey: 'leave.requested',
          recipients: approvers.filter((r) => r.userId !== user.id),
          channels: ['IN_APP'],
          data: { employeeName: emp.user.fullName, days, leaveType: type.name, from: fmtDate(input.startDate), to: fmtDate(input.endDate) },
          link: '/hr/leave',
          relatedType: 'LeaveRequest',
          relatedId: req.id,
        },
        tx,
      );
      return { req, outbox };
    });
    this.notifications.kick(result.outbox);
    return { ...result.req, startDate: input.startDate, endDate: input.endDate };
  }

  async list(user: AuthUser, q: LeaveListQuery) {
    const org = platformOrg(user);
    let where: Prisma.LeaveRequestWhereInput;
    if (q.scope === 'mine') where = { employeeId: requireEmployee(user) };
    else if (q.scope === 'all') {
      assertHr(user, 'leave.manage');
      where = { employee: { organizationId: org } };
    } else {
      // Direct reports of the caller
      if (!user.employeeId) throw new ForbiddenException();
      where = { employee: { organizationId: org, managerId: user.employeeId } };
    }
    if (q.status) where = { ...where, status: q.status };
    if (q.employeeId) where = { ...where, employeeId: q.employeeId };
    // Pending requests first (declaration order of ApprovalStatus), latest start date first within each.
    const segments = Object.values(ApprovalStatus).map((status): Segment<Prisma.LeaveRequestWhereInput, Prisma.LeaveRequestOrderByWithRelationInput[]> => ({
      where: { AND: [where, { status }] },
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    }));
    const [{ rows, total }, counts] = await Promise.all([
      segmentedPage(
        segments,
        {
          count: (w) => this.prisma.leaveRequest.count({ where: w }),
          find: (a) =>
            this.prisma.leaveRequest.findMany({
              ...a,
              include: {
                leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
                employee: { select: { id: true, employeeCode: true, userId: true, managerId: true, user: { select: { fullName: true } }, department: { select: { name: true } } } },
                approver: { select: { fullName: true } },
              },
            }),
        },
        skipTake(q),
      ),
      this.prisma.leaveRequest.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    return {
      ...paginated(
        rows.map((r) => ({
          ...r,
          startDate: dateStr(r.startDate),
          endDate: dateStr(r.endDate),
          days: n(r.days),
          canDecide: r.status === 'PENDING' && r.employee.userId !== user.id && (canHr(user, 'leave.manage') || (canHr(user, 'leave.approve') && r.employee.managerId === user.employeeId)),
          canCancel: r.employee.userId === user.id && (r.status === 'PENDING' || (r.status === 'APPROVED' && dateStr(r.startDate) > todayIst())),
        })),
        total,
        q,
      ),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  async decide(user: AuthUser, id: string, input: z.output<typeof leaveDecisionSchema>) {
    const org = platformOrg(user);
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, employee: { organizationId: org } },
      include: { leaveType: true, employee: { select: { id: true, userId: true, managerId: true, user: { select: { fullName: true, email: true } } } } },
    });
    if (!req) throw new NotFoundException('Leave request not found');
    if (req.employee.userId === user.id) throw new ForbiddenException('You cannot approve or reject your own leave request');
    const isManager = Boolean(user.employeeId && req.employee.managerId === user.employeeId);
    if (!canHr(user, 'leave.manage') && !(isManager && canHr(user, 'leave.approve'))) throw new ForbiddenException('Only the reporting manager or HR can decide this request');
    if (input.decision === 'REJECT' && !input.note?.trim()) throw new BadRequestException({ message: 'Give a reason for rejecting', details: [{ path: 'note', message: 'Required' }] });
    const approve = input.decision === 'APPROVE';
    const year = req.startDate.getUTCFullYear();
    const days = n(req.days);

    const outbox = await this.prisma.$transaction(async (tx) => {
      const res = await tx.leaveRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', approverId: user.id, decidedAt: new Date(), decisionNote: input.note ?? null },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This request has already been decided', code: 'ALREADY_DECIDED' });
      if (approve && req.leaveType.isPaid) {
        const key = { employeeId_leaveTypeId_year: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year } };
        const bal = await tx.leaveBalance.findUnique({ where: key });
        const available = bal ? n(bal.allocated) + n(bal.carriedForward) - n(bal.used) : 0;
        if (available < days) throw new ConflictException({ message: `Insufficient balance: ${available} day(s) available, ${days} requested`, code: 'INSUFFICIENT_BALANCE' });
        await tx.leaveBalance.update({ where: key, data: { used: { increment: days } } });
      }
      await this.audit.log({ actorId: user.id, action: `leave.${approve ? 'approve' : 'reject'}`, entityType: 'LeaveRequest', entityId: id, organizationId: org, before: { status: 'PENDING' }, after: { status: approve ? 'APPROVED' : 'REJECTED' }, metadata: { note: input.note ?? null, days } }, tx);
      return this.notifications.notify(
        {
          eventKey: 'leave.decided',
          recipients: [{ userId: req.employee.userId, email: req.employee.user.email, name: req.employee.user.fullName }],
          channels: ['IN_APP', 'EMAIL'],
          data: { leaveType: req.leaveType.name, from: fmtDate(dateStr(req.startDate)), to: fmtDate(dateStr(req.endDate)), decision: approve ? 'approved' : 'rejected', note: input.note ? `Note: ${input.note}` : '' },
          link: `${env().CONSOLE_PUBLIC_URL}/me/leave`,
          relatedType: 'LeaveRequest',
          relatedId: id,
        },
        tx,
      );
    });
    this.notifications.kick(outbox);
    return { ok: true, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  async cancel(user: AuthUser, id: string) {
    const org = platformOrg(user);
    const req = await this.prisma.leaveRequest.findFirst({ where: { id, employee: { organizationId: org } }, include: { leaveType: true, employee: { select: { userId: true } } } });
    if (!req || req.employee.userId !== user.id) throw new NotFoundException('Leave request not found');
    const futureApproved = req.status === 'APPROVED' && dateStr(req.startDate) > todayIst();
    if (req.status !== 'PENDING' && !futureApproved) throw new ConflictException('Only pending requests, or approved leave that has not started, can be cancelled');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.leaveRequest.updateMany({ where: { id, status: req.status }, data: { status: 'CANCELLED' } });
      if (res.count !== 1) throw new ConflictException('This request changed — refresh and try again');
      if (futureApproved && req.leaveType.isPaid) {
        await tx.leaveBalance.update({
          where: { employeeId_leaveTypeId_year: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year: req.startDate.getUTCFullYear() } },
          data: { used: { decrement: n(req.days) } },
        });
      }
      await this.audit.log({ actorId: user.id, action: 'leave.cancel', entityType: 'LeaveRequest', entityId: id, organizationId: org, before: { status: req.status }, after: { status: 'CANCELLED' } }, tx);
    });
    return { ok: true };
  }

  /** Approved and pending leave overlapping a month, for the caller's scope. */
  async calendar(user: AuthUser, year: number, month: number) {
    const org = platformOrg(user);
    const { start, end } = monthBounds(year, month);
    const scope: Prisma.EmployeeWhereInput = canHr(user, 'leave.manage', 'employee.manage')
      ? { organizationId: org }
      : user.employeeId
        ? { organizationId: org, OR: [{ managerId: user.employeeId }, { id: user.employeeId }] }
        : { id: '00000000-0000-0000-0000-000000000000' };
    const rows = await this.prisma.leaveRequest.findMany({
      where: { status: { in: ['APPROVED', 'PENDING'] }, startDate: { lte: toDate(end) }, endDate: { gte: toDate(start) }, employee: scope },
      include: { leaveType: { select: { name: true, code: true } }, employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } } },
      orderBy: { startDate: 'asc' },
    });
    const holidays = await this.prisma.holiday.findMany({ where: { organizationId: org, date: { gte: toDate(start), lte: toDate(end) } }, orderBy: { date: 'asc' } });
    return {
      month: `${year}-${String(month).padStart(2, '0')}`,
      leaves: rows.map((r) => ({ id: r.id, status: r.status, startDate: dateStr(r.startDate), endDate: dateStr(r.endDate), days: n(r.days), halfDayStart: r.halfDayStart, halfDayEnd: r.halfDayEnd, leaveType: r.leaveType, employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, name: r.employee.user.fullName } })),
      holidays: holidays.map((h) => ({ date: dateStr(h.date), name: h.name })),
    };
  }
}
