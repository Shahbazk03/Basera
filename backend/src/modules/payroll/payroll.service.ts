import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import {
  calculatePayslip,
  eachDate,
  isWorkingDay,
  workingDaysBetween,
  type PayrollComponentInput,
  type payrollAdjustmentSchema,
  type payrollPaymentSchema,
  type payrollRunCreateSchema,
  type salaryComponentSchema,
  type salaryStructureSchema,
} from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { nextReference } from '../../common/references';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { assertHr, canHr, dateStr, defaultShift, monthBounds, periodLabel, platformOrg, toDate, todayIst } from '../hr/hr.util';

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const FALLBACK_WEEKLY_OFF = [0];

export interface AdjustmentListQuery extends Pagination {
  year?: number;
  month?: number;
  employeeId?: string;
  status?: 'PENDING' | 'APPLIED' | 'CANCELLED';
}

interface EmployeeCalc {
  employeeId: string;
  employeeCode: string;
  name: string;
  structureId: string;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  lines: { componentCode: string; componentName: string; type: 'EARNING' | 'DEDUCTION'; amount: number; calculation: string; sortOrder: number }[];
  adjustmentIds: string[];
  breakdown: { employedWorkingDays: number; unpaidLeave: number; halfDayShortfall: number; absent: number; unmarked: number };
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ───────────── Components ─────────────

  async components(user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.view', 'payroll.manage');
    return this.prisma.salaryComponent.findMany({ where: { organizationId: org }, orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }], include: { _count: { select: { structureLines: true } } } });
  }

  async saveComponent(user: AuthUser, id: string | null, input: Partial<z.output<typeof salaryComponentSchema>>) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const before = id ? await this.prisma.salaryComponent.findFirst({ where: { id, organizationId: org }, include: { _count: { select: { structureLines: true } } } }) : null;
    if (id && !before) throw new NotFoundException('Salary component not found');
    const code = input.code ?? before?.code;
    if (code && (await this.prisma.salaryComponent.findFirst({ where: { organizationId: org, code, ...(id ? { id: { not: id } } : {}) } }))) {
      throw new ConflictException({ message: `Component code ${code} already exists`, details: [{ path: 'code', message: 'Already exists' }] });
    }
    if (before && before._count.structureLines > 0 && ((input.type && input.type !== before.type) || (input.calcType && input.calcType !== before.calcType))) {
      throw new ConflictException({ message: 'Type and calculation method cannot change while salary structures use this component — create a new component instead', code: 'COMPONENT_IN_USE' });
    }
    if (code === 'BASIC' && ((input.calcType ?? before?.calcType) !== 'FIXED' || (input.type ?? before?.type) !== 'EARNING')) {
      throw new BadRequestException({ message: 'BASIC must be a FIXED earning — percentage components are calculated from it', details: [{ path: 'calcType', message: 'Must be FIXED' }] });
    }
    const row = id
      ? await this.prisma.salaryComponent.update({ where: { id }, data: input })
      : await this.prisma.salaryComponent.create({ data: { ...(input as z.output<typeof salaryComponentSchema>), organizationId: org } });
    await this.audit.log({ actorId: user.id, action: id ? 'payroll.component.update' : 'payroll.component.create', entityType: 'SalaryComponent', entityId: row.id, organizationId: org, before, after: row });
    return row;
  }

  // ───────────── Structures ─────────────

  private toCalcComponents(lines: { value: Prisma.Decimal; component: { code: string; name: string; type: 'EARNING' | 'DEDUCTION'; calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_GROSS'; maxAmount: Prisma.Decimal | null; prorateByAttendance: boolean; sortOrder: number; isActive: boolean } }[]): { components: PayrollComponentInput[]; skipped: string[] } {
    const skipped: string[] = [];
    const components = lines
      .filter((l) => {
        if (!l.component.isActive) skipped.push(l.component.code);
        return l.component.isActive;
      })
      .map((l) => ({
        code: l.component.code,
        name: l.component.name,
        type: l.component.type,
        calcType: l.component.calcType,
        value: n(l.value),
        maxAmount: l.component.maxAmount === null ? null : n(l.component.maxAmount),
        prorate: l.component.prorateByAttendance,
        sortOrder: l.component.sortOrder,
      }));
    return { components, skipped };
  }

  /** Current structure per active employee with a full-month estimate. */
  async structuresOverview(user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.view', 'payroll.manage');
    const employees = await this.prisma.employee.findMany({
      where: { organizationId: org, deletedAt: null, employmentStatus: { not: 'EXITED' } },
      select: {
        id: true,
        employeeCode: true,
        user: { select: { fullName: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        salaryStructures: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1, include: { lines: { include: { component: true } } } },
      },
      orderBy: { employeeCode: 'asc' },
    });
    return employees.map((e) => {
      const s = e.salaryStructures[0];
      const est = s ? calculatePayslip({ ...this.toCalcComponents(s.lines), workingDays: 26, payableDays: 26, adjustments: [] }) : null;
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: e.user.fullName,
        department: e.department?.name ?? null,
        designation: e.designation?.name ?? null,
        structure: s ? { id: s.id, effectiveFrom: dateStr(s.effectiveFrom), monthlyGross: est!.grossEarnings, monthlyDeductions: est!.totalDeductions, monthlyNet: est!.netPay } : null,
      };
    });
  }

  async employeeStructures(user: AuthUser, employeeId: string) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.view', 'payroll.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: org }, select: { id: true, employeeCode: true, userId: true, user: { select: { fullName: true } }, designation: { select: { name: true } } } });
    if (!emp) throw new NotFoundException('Employee not found');
    const rows = await this.prisma.salaryStructure.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
      include: { createdBy: { select: { fullName: true } }, lines: { include: { component: true } } },
    });
    return {
      employee: { id: emp.id, employeeCode: emp.employeeCode, name: emp.user.fullName, designation: emp.designation?.name ?? null, isSelf: emp.userId === user.id },
      structures: rows.map((s) => {
        const { components } = this.toCalcComponents(s.lines);
        const est = calculatePayslip({ components, workingDays: 26, payableDays: 26, adjustments: [] });
        return {
          id: s.id,
          effectiveFrom: dateStr(s.effectiveFrom),
          effectiveTo: s.effectiveTo ? dateStr(s.effectiveTo) : null,
          isCurrent: s.effectiveTo === null,
          notes: s.notes,
          createdBy: s.createdBy?.fullName ?? null,
          createdAt: s.createdAt,
          lines: s.lines
            .sort((a, b) => a.component.sortOrder - b.component.sortOrder)
            .map((l) => ({ componentId: l.componentId, code: l.component.code, name: l.component.name, type: l.component.type, calcType: l.component.calcType, value: n(l.value), maxAmount: l.component.maxAmount === null ? null : n(l.component.maxAmount) })),
          estimate: { gross: est.grossEarnings, deductions: est.totalDeductions, net: est.netPay, lines: est.lines },
        };
      }),
    };
  }

  async createStructure(user: AuthUser, employeeId: string, input: z.output<typeof salaryStructureSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: org, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.userId === user.id) throw new ForbiddenException('You cannot change your own salary structure');
    if (emp.employmentStatus === 'EXITED') throw new ConflictException('This employee has exited');
    const ids = input.lines.map((l) => l.componentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException({ message: 'Each component can appear only once', details: [{ path: 'lines', message: 'Duplicate component' }] });
    const comps = await this.prisma.salaryComponent.findMany({ where: { id: { in: ids }, organizationId: org } });
    if (comps.length !== ids.length) throw new BadRequestException({ message: 'Unknown salary component', details: [{ path: 'lines', message: 'Unknown component' }] });
    const byId = new Map(comps.map((c) => [c.id, c]));
    const issues: { path: string; message: string }[] = [];
    input.lines.forEach((l, i) => {
      const c = byId.get(l.componentId)!;
      if (!c.isActive) issues.push({ path: `lines.${i}.componentId`, message: `${c.name} is inactive` });
      if (c.calcType !== 'FIXED' && l.value > 100) issues.push({ path: `lines.${i}.value`, message: `${c.name} is a percentage — use 0–100` });
      if (c.calcType === 'PERCENT_OF_GROSS' && c.type === 'EARNING') issues.push({ path: `lines.${i}.componentId`, message: `${c.name}: % of gross is only supported for deductions` });
    });
    const hasBasic = comps.some((c) => c.code === 'BASIC' && c.type === 'EARNING' && c.calcType === 'FIXED');
    if (comps.some((c) => c.calcType === 'PERCENT_OF_BASIC') && !hasBasic) issues.push({ path: 'lines', message: 'Add the BASIC component — percentage-of-basic components need it' });
    if (issues.length) throw new BadRequestException({ message: 'Please correct the salary structure', code: 'VALIDATION_FAILED', details: issues });
    const latest = await this.prisma.salaryStructure.findFirst({ where: { employeeId }, orderBy: { effectiveFrom: 'desc' } });
    if (latest && input.effectiveFrom <= dateStr(latest.effectiveFrom)) {
      throw new ConflictException({ message: `The new structure must start after ${dateStr(latest.effectiveFrom)} (the current structure's start date)`, details: [{ path: 'effectiveFrom', message: 'Too early' }] });
    }
    const dayBefore = dateStr(new Date(toDate(input.effectiveFrom).getTime() - 86_400_000));
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.salaryStructure.updateMany({ where: { employeeId, effectiveTo: null }, data: { effectiveTo: toDate(dayBefore), isActive: false } });
      const s = await tx.salaryStructure.create({
        data: { employeeId, effectiveFrom: toDate(input.effectiveFrom), notes: input.notes ?? null, createdById: user.id, isActive: true, lines: { create: input.lines.map((l) => ({ componentId: l.componentId, value: l.value })) } },
      });
      // Amounts are deliberately not written to the audit trail
      await this.audit.log({ actorId: user.id, action: 'payroll.structure.create', entityType: 'SalaryStructure', entityId: s.id, organizationId: org, metadata: { employeeId, effectiveFrom: input.effectiveFrom, components: input.lines.length } }, tx);
      return s;
    });
    return { id: row.id };
  }

  // ───────────── Adjustments ─────────────

  async adjustments(user: AuthUser, q: AdjustmentListQuery) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.view', 'payroll.manage');
    const where: Prisma.PayrollAdjustmentWhereInput = {
      employee: { organizationId: org },
      ...(q.year ? { periodYear: q.year } : {}),
      ...(q.month ? { periodMonth: q.month } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payrollAdjustment.findMany({
        where,
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
        include: { employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } }, createdBy: { select: { fullName: true } }, payrollRun: { select: { id: true, status: true } } },
        ...skipTake(q),
      }),
      this.prisma.payrollAdjustment.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async createAdjustment(user: AuthUser, input: z.output<typeof payrollAdjustmentSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id: input.employeeId, organizationId: org, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.userId === user.id) throw new ForbiddenException('You cannot add adjustments to your own pay');
    const locked = await this.prisma.payrollRun.findFirst({ where: { organizationId: org, periodYear: input.periodYear, periodMonth: input.periodMonth, status: { in: ['APPROVED', 'PAID'] } } });
    if (locked) throw new ConflictException(`Payroll for ${periodLabel(input.periodYear, input.periodMonth)} is already ${locked.status.toLowerCase()} — choose a later month`);
    const row = await this.prisma.payrollAdjustment.create({ data: { ...input, createdById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'payroll.adjustment.create', entityType: 'PayrollAdjustment', entityId: row.id, organizationId: org, after: { employeeId: input.employeeId, type: input.type, period: `${input.periodYear}-${input.periodMonth}` } });
    return row;
  }

  async cancelAdjustment(user: AuthUser, id: string) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const res = await this.prisma.payrollAdjustment.updateMany({ where: { id, status: 'PENDING', employee: { organizationId: org } }, data: { status: 'CANCELLED' } });
    if (res.count !== 1) throw new ConflictException('Only pending adjustments can be cancelled (applied ones are released by recalculating or cancelling the run)');
    await this.audit.log({ actorId: user.id, action: 'payroll.adjustment.cancel', entityType: 'PayrollAdjustment', entityId: id, organizationId: org });
    return { ok: true };
  }

  // ───────────── Runs ─────────────

  async runs(user: AuthUser, q: Pagination) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.view', 'payroll.manage');
    const where = { organizationId: org };
    const [rows, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
        include: { createdBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } }, _count: { select: { payslips: true } } },
        ...skipTake(q),
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...r, periodStart: dateStr(r.periodStart), periodEnd: dateStr(r.periodEnd), period: periodLabel(r.periodYear, r.periodMonth) })),
      total,
      q,
    );
  }

  async createRun(user: AuthUser, input: z.output<typeof payrollRunCreateSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const existing = await this.prisma.payrollRun.findFirst({ where: { organizationId: org, periodYear: input.periodYear, periodMonth: input.periodMonth, status: { not: 'CANCELLED' } } });
    if (existing) throw new ConflictException({ message: `A payroll run for ${periodLabel(input.periodYear, input.periodMonth)} already exists`, code: 'RUN_EXISTS', details: [{ path: 'periodMonth', message: existing.id }] });
    const { start, end } = monthBounds(input.periodYear, input.periodMonth);
    if (start > todayIst()) throw new BadRequestException({ message: 'Payroll cannot be created for a future month', details: [{ path: 'periodMonth', message: 'Future month' }] });
    const shift = await defaultShift(this.prisma, org);
    const holidays = (await this.prisma.holiday.findMany({ where: { organizationId: org, date: { gte: toDate(start), lte: toDate(end) } }, select: { date: true } })).map((h) => dateStr(h.date));
    const workingDays = workingDaysBetween(start, end, { weeklyOffDays: shift?.weeklyOffDays ?? FALLBACK_WEEKLY_OFF, holidays });
    const row = await this.prisma.payrollRun.create({
      data: { organizationId: org, periodYear: input.periodYear, periodMonth: input.periodMonth, periodStart: toDate(start), periodEnd: toDate(end), workingDays, notes: input.notes ?? null, createdById: user.id },
    });
    await this.audit.log({ actorId: user.id, action: 'payroll.run.create', entityType: 'PayrollRun', entityId: row.id, organizationId: org, after: { period: `${input.periodYear}-${input.periodMonth}` } });
    return row;
  }

  async getRun(user: AuthUser, id: string) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.view', 'payroll.manage');
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, organizationId: org },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        calculatedBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        payslips: {
          orderBy: { employee: { employeeCode: 'asc' } },
          include: {
            employee: { select: { id: true, employeeCode: true, userId: true, user: { select: { fullName: true } }, department: { select: { name: true } }, designation: { select: { name: true } } } },
            payments: { select: { amount: true, paidOn: true, method: true, referenceNo: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const lastCalc = await this.prisma.auditLog.findFirst({ where: { entityType: 'PayrollRun', entityId: id, action: 'payroll.run.calculate' }, orderBy: { createdAt: 'desc' }, select: { metadata: true, createdAt: true } });
    const meta = (lastCalc?.metadata ?? {}) as { warnings?: string[]; breakdown?: Record<string, unknown> };
    const pending = run.payslips.filter((p) => p.status === 'DRAFT');
    const ownPending = pending.some((p) => p.employee.userId === user.id);
    const makerChecker = await this.settings.getBoolean('payroll.requireMakerChecker');
    let approveBlock: string | null = null;
    if (!canHr(user, 'payroll.approve')) approveBlock = 'You do not have permission to approve payroll';
    else if (run.status !== 'CALCULATED') approveBlock = 'Only calculated runs can be approved';
    else if (makerChecker && run.calculatedById === user.id) approveBlock = 'You prepared this payroll — a different person must approve it';
    else if (pending.length > 0 && pending.every((p) => p.employee.userId === user.id)) approveBlock = 'Only your own payslip is awaiting approval — another approver must approve it';
    const approval = {
      approved: run.payslips.length - pending.length,
      pending: pending.length,
      /** Approving now covers this many payslips (the viewer's own payslip is never included). */
      approvableNow: approveBlock === null ? pending.filter((p) => p.employee.userId !== user.id).length : 0,
      ownPayslipPending: ownPending,
    };
    return {
      ...run,
      period: periodLabel(run.periodYear, run.periodMonth),
      periodStart: dateStr(run.periodStart),
      periodEnd: dateStr(run.periodEnd),
      warnings: run.status === 'DRAFT' ? [] : (meta.warnings ?? []),
      breakdown: meta.breakdown ?? {},
      payslips: run.payslips.map((p) => ({
        id: p.id,
        status: p.status,
        employee: { id: p.employee.id, employeeCode: p.employee.employeeCode, name: p.employee.user.fullName, department: p.employee.department?.name ?? null, designation: p.employee.designation?.name ?? null },
        workingDays: n(p.workingDays),
        payableDays: n(p.payableDays),
        lopDays: n(p.lopDays),
        grossEarnings: n(p.grossEarnings),
        totalDeductions: n(p.totalDeductions),
        netPay: n(p.netPay),
        paid: p.payments.reduce((a, x) => a + n(x.amount), 0),
      })),
      approval,
      permissions: {
        canCalculate: canHr(user, 'payroll.manage') && ['DRAFT', 'CALCULATED'].includes(run.status),
        canApprove: approveBlock === null,
        approveBlockedReason: approveBlock,
        canPay: canHr(user, 'payroll.manage', 'finance.manage') && run.status === 'APPROVED',
        canCancel: canHr(user, 'payroll.manage') && ['DRAFT', 'CALCULATED', 'APPROVED'].includes(run.status) && !run.payslips.some((p) => p.status === 'PAID'),
      },
    };
  }

  /** Computes every payslip of the run. Idempotent: recalculation replaces previous payslips. */
  async calculate(user: AuthUser, id: string) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const run = await this.prisma.payrollRun.findFirst({ where: { id, organizationId: org } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new ConflictException({ message: `A ${run.status.toLowerCase()} payroll cannot be recalculated`, code: 'RUN_LOCKED' });

    const start = dateStr(run.periodStart);
    const end = dateStr(run.periodEnd);
    const today = todayIst();
    const lopUnmarked = await this.settings.getBoolean('payroll.lopForUnmarkedDays');
    const defShift = await defaultShift(this.prisma, org);
    const holidays = (await this.prisma.holiday.findMany({ where: { organizationId: org, date: { gte: toDate(start), lte: toDate(end) } }, select: { date: true } })).map((h) => dateStr(h.date));

    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        joiningDate: { lte: toDate(end) },
        OR: [{ exitDate: null }, { exitDate: { gte: toDate(start) } }],
        employmentStatus: { in: ['ACTIVE', 'PROBATION', 'ON_NOTICE', 'EXITED', 'SUSPENDED'] },
      },
      include: { shift: true, user: { select: { fullName: true } } },
      orderBy: { employeeCode: 'asc' },
    });
    const ids = employees.map((e) => e.id);
    const [structures, leaves, attendance, adjustments] = await Promise.all([
      this.prisma.salaryStructure.findMany({
        where: { employeeId: { in: ids }, effectiveFrom: { lte: toDate(end) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(start) } }] },
        include: { lines: { include: { component: true } } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: toDate(end) }, endDate: { gte: toDate(start) } },
        include: { leaveType: { select: { isPaid: true } } },
      }),
      this.prisma.attendanceRecord.findMany({ where: { employeeId: { in: ids }, date: { gte: toDate(start), lte: toDate(end) } }, select: { employeeId: true, date: true, status: true } }),
      this.prisma.payrollAdjustment.findMany({
        where: { employeeId: { in: ids }, periodYear: run.periodYear, periodMonth: run.periodMonth, OR: [{ status: 'PENDING' }, { status: 'APPLIED', payrollRunId: run.id }] },
      }),
    ]);

    const warnings: string[] = [];
    const results: EmployeeCalc[] = [];
    for (const e of employees) {
      const tag = `${e.employeeCode} (${e.user.fullName})`;
      if (e.employmentStatus === 'SUSPENDED') {
        warnings.push(`${tag}: suspended — excluded from this run`);
        continue;
      }
      if (e.employmentStatus === 'EXITED' && !e.exitDate) {
        warnings.push(`${tag}: exited without an exit date — excluded`);
        continue;
      }
      const shift = e.shift ?? defShift;
      if (!shift) warnings.push(`${tag}: no shift assigned and no default shift — Sunday treated as the weekly off`);
      const cal = { weeklyOffDays: shift?.weeklyOffDays ?? FALLBACK_WEEKLY_OFF, holidays };
      const joined = dateStr(e.joiningDate);
      const from = joined > start ? joined : start;
      const exit = e.exitDate ? dateStr(e.exitDate) : null;
      const to = exit && exit < end ? exit : end;
      if (from > to) continue;

      const structure = structures.find((s) => s.employeeId === e.id);
      if (!structure) {
        warnings.push(`${tag}: no salary structure effective in this period — skipped`);
        continue;
      }
      if (structures.filter((s) => s.employeeId === e.id).length > 1) warnings.push(`${tag}: salary structure changed during the period — the latest structure was applied`);

      const monthWorkingDays = workingDaysBetween(start, end, cal);
      const employedDates = eachDate(from, to).filter((d) => isWorkingDay(d, cal));

      // Approved leave coverage (paid and unpaid) by date
      const covered = new Map<string, number>();
      let unpaidLeave = 0;
      for (const l of leaves.filter((x) => x.employeeId === e.id)) {
        const ls = dateStr(l.startDate);
        const le = dateStr(l.endDate);
        for (const d of eachDate(ls > from ? ls : from, le < to ? le : to)) {
          if (!isWorkingDay(d, cal)) continue;
          let w = 1;
          if (d === ls && l.halfDayStart) w = 0.5;
          if (d === le && l.halfDayEnd && !(ls === le && l.halfDayStart)) w = 0.5;
          covered.set(d, Math.min(1, (covered.get(d) ?? 0) + w));
          if (!l.leaveType.isPaid) unpaidLeave += w;
        }
      }
      const statusByDate = new Map(attendance.filter((a) => a.employeeId === e.id).map((a) => [dateStr(a.date), a.status]));
      let halfDayShortfall = 0;
      let absent = 0;
      let unmarked = 0;
      for (const d of employedDates) {
        const st = statusByDate.get(d);
        const cov = covered.get(d) ?? 0;
        if (st === 'HALF_DAY') {
          if (cov < 0.5) halfDayShortfall += 0.5;
        } else if (st === 'ABSENT') {
          absent += Math.max(0, 1 - cov);
        } else if (!st && lopUnmarked && d < today && cov < 1) {
          unmarked += 1 - cov;
        }
      }
      const lopDays = Math.min(employedDates.length, unpaidLeave + halfDayShortfall + absent + unmarked);
      const payableDays = Math.max(0, employedDates.length - lopDays);

      const { components, skipped } = this.toCalcComponents(structure.lines);
      if (skipped.length) warnings.push(`${tag}: inactive components ignored (${skipped.join(', ')})`);
      const myAdjustments = adjustments.filter((a) => a.employeeId === e.id);
      const calc = calculatePayslip({
        components,
        workingDays: monthWorkingDays,
        payableDays,
        adjustments: myAdjustments.map((a) => ({ type: a.type, amount: n(a.amount), description: a.description })),
      });
      calc.warnings.forEach((w) => warnings.push(`${tag}: ${w}`));
      results.push({
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: e.user.fullName,
        structureId: structure.id,
        workingDays: monthWorkingDays,
        payableDays,
        lopDays,
        grossEarnings: calc.grossEarnings,
        totalDeductions: calc.totalDeductions,
        netPay: calc.netPay,
        lines: calc.lines.map((l) => ({ ...l, type: l.type as 'EARNING' | 'DEDUCTION' })),
        adjustmentIds: myAdjustments.map((a) => a.id),
        breakdown: { employedWorkingDays: employedDates.length, unpaidLeave, halfDayShortfall, absent, unmarked },
      });
    }

    const totals = results.reduce(
      (acc, r) => ({ gross: acc.gross + Math.round(r.grossEarnings * 100), deductions: acc.deductions + Math.round(r.totalDeductions * 100), net: acc.net + Math.round(r.netPay * 100) }),
      { gross: 0, deductions: 0, net: 0 },
    );

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${id}::uuid FOR UPDATE`;
        const fresh = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
        if (!['DRAFT', 'CALCULATED'].includes(fresh.status)) throw new ConflictException('The run changed while calculating — refresh and try again');
        await tx.payslip.deleteMany({ where: { payrollRunId: id } });
        await tx.payrollAdjustment.updateMany({ where: { payrollRunId: id }, data: { status: 'PENDING', payrollRunId: null } });
        for (const r of results) {
          await tx.payslip.create({
            data: {
              payrollRunId: id,
              employeeId: r.employeeId,
              structureId: r.structureId,
              workingDays: r.workingDays,
              payableDays: r.payableDays,
              lopDays: r.lopDays,
              grossEarnings: r.grossEarnings,
              totalDeductions: r.totalDeductions,
              netPay: r.netPay,
              status: 'DRAFT',
              lines: { create: r.lines },
            },
          });
        }
        const adjIds = results.flatMap((r) => r.adjustmentIds);
        if (adjIds.length) await tx.payrollAdjustment.updateMany({ where: { id: { in: adjIds }, status: 'PENDING' }, data: { status: 'APPLIED', payrollRunId: id } });
        const workingDays = workingDaysBetween(start, end, { weeklyOffDays: defShift?.weeklyOffDays ?? FALLBACK_WEEKLY_OFF, holidays });
        await tx.payrollRun.update({
          where: { id },
          data: { status: 'CALCULATED', workingDays, totalGross: totals.gross / 100, totalDeductions: totals.deductions / 100, totalNet: totals.net / 100, calculatedById: user.id, calculatedAt: new Date() },
        });
        await this.audit.log(
          {
            actorId: user.id,
            action: 'payroll.run.calculate',
            entityType: 'PayrollRun',
            entityId: id,
            organizationId: org,
            metadata: {
              warnings,
              employees: results.length,
              lopForUnmarkedDays: lopUnmarked,
              breakdown: Object.fromEntries(results.map((r) => [r.employeeCode, { ...r.breakdown, lopDays: r.lopDays, payableDays: r.payableDays }])),
            },
          },
          tx,
        );
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return { ok: true, payslips: results.length, warnings, totals: { gross: totals.gross / 100, deductions: totals.deductions / 100, net: totals.net / 100 } };
  }

  async approve(user: AuthUser, id: string) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.approve');
    const run = await this.prisma.payrollRun.findFirst({ where: { id, organizationId: org }, include: { _count: { select: { payslips: true } } } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'CALCULATED') throw new ConflictException({ message: 'Only calculated payroll runs can be approved', code: 'INVALID_STATUS' });
    if (run._count.payslips === 0) throw new ConflictException('There are no payslips in this run');
    if ((await this.settings.getBoolean('payroll.requireMakerChecker')) && run.calculatedById === user.id) {
      throw new ForbiddenException({ message: 'You prepared this payroll — a different person must approve it (maker-checker)', code: 'MAKER_CHECKER' });
    }
    // Nobody approves their own pay: an approver approves every pending payslip except their own, which stays
    // pending for another approver. The run is approved once no payslip is pending.
    const pending = await this.prisma.payslip.findMany({ where: { payrollRunId: id, status: 'DRAFT' }, select: { id: true, employee: { select: { userId: true } } } });
    const approvable = pending.filter((p) => p.employee.userId !== user.id).map((p) => p.id);
    if (approvable.length === 0) {
      throw new ForbiddenException({ message: 'Only your own payslip is awaiting approval — another approver must approve it', code: 'OWN_PAYSLIP_IN_RUN' });
    }
    const period = periodLabel(run.periodYear, run.periodMonth);
    const managers = await this.notifications.recipientsWithPermission('payroll.manage', org);
    const result = await this.prisma.$transaction(async (tx) => {
      const res = await tx.payslip.updateMany({ where: { id: { in: approvable }, payrollRunId: id, status: 'DRAFT' }, data: { status: 'APPROVED' } });
      if (res.count !== approvable.length) throw new ConflictException('This run changed — refresh and try again');
      const remaining = await tx.payslip.count({ where: { payrollRunId: id, status: 'DRAFT' } });
      if (remaining > 0) {
        await this.audit.log({ actorId: user.id, action: 'payroll.payslips.approve', entityType: 'PayrollRun', entityId: id, organizationId: org, metadata: { payslipIds: approvable, awaitingOtherApprover: remaining } }, tx);
        return { outbox: [] as string[], remaining };
      }
      const done = await tx.payrollRun.updateMany({ where: { id, status: 'CALCULATED' }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
      if (done.count !== 1) throw new ConflictException('This run changed — refresh and try again');
      await this.audit.log({ actorId: user.id, action: 'payroll.run.approve', entityType: 'PayrollRun', entityId: id, organizationId: org, before: { status: 'CALCULATED' }, after: { status: 'APPROVED' }, metadata: { payslipIds: approvable } }, tx);
      const payslips = await tx.payslip.findMany({ where: { payrollRunId: id }, select: { employee: { select: { user: { select: { id: true, email: true, fullName: true } } } } } });
      const a = await this.notifications.notify({ eventKey: 'payroll.approved', recipients: managers, channels: ['IN_APP'], data: { period, approver: user.fullName }, link: `/payroll/${id}`, relatedType: 'PayrollRun', relatedId: id }, tx);
      const b = await this.notifications.notify(
        {
          eventKey: 'payslip.available',
          recipients: payslips.map((p) => ({ userId: p.employee.user.id, email: p.employee.user.email, name: p.employee.user.fullName })),
          channels: ['IN_APP', 'EMAIL'],
          data: { period },
          link: `${env().CONSOLE_PUBLIC_URL}/me/payslips`,
          relatedType: 'PayrollRun',
          relatedId: id,
        },
        tx,
      );
      return { outbox: [...a, ...b], remaining: 0 };
    });
    this.notifications.kick(result.outbox);
    return result.remaining > 0
      ? { ok: true, status: 'CALCULATED', approvedPayslips: approvable.length, awaitingOtherApprover: result.remaining }
      : { ok: true, status: 'APPROVED', approvedPayslips: approvable.length, awaitingOtherApprover: 0 };
  }

  async pay(user: AuthUser, id: string, input: z.output<typeof payrollPaymentSchema>) {
    const org = platformOrg(user);
    if (!canHr(user, 'payroll.manage', 'finance.manage')) throw new ForbiddenException();
    const run = await this.prisma.payrollRun.findFirst({ where: { id, organizationId: org } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'APPROVED') throw new ConflictException({ message: run.status === 'PAID' ? 'This payroll has already been paid' : 'Approve the payroll before recording payments', code: 'INVALID_STATUS' });
    const payslips = await this.prisma.payslip.findMany({
      where: { payrollRunId: id, status: 'APPROVED', ...(input.payslipIds?.length ? { id: { in: input.payslipIds } } : {}) },
      include: { employee: { select: { employeeCode: true, user: { select: { fullName: true } } } } },
    });
    if (input.payslipIds?.length && payslips.length !== new Set(input.payslipIds).size) throw new BadRequestException('Some selected payslips are not approved and unpaid');
    if (!payslips.length) throw new ConflictException('There are no unpaid approved payslips');
    const period = periodLabel(run.periodYear, run.periodMonth);
    const result = await this.prisma.$transaction(
      async (tx) => {
        let paid = 0;
        let amount = 0;
        for (const ps of payslips) {
          const claim = await tx.payslip.updateMany({ where: { id: ps.id, status: 'APPROVED' }, data: { status: 'PAID' } });
          if (claim.count !== 1) throw new ConflictException('A payslip changed while recording payments — refresh and try again');
          const net = n(ps.netPay);
          if (net > 0) {
            const sp = await tx.salaryPayment.create({ data: { payslipId: ps.id, amount: net, paidOn: toDate(input.paidOn), method: input.method, referenceNo: input.referenceNo ?? null, notes: input.notes ?? null, recordedById: user.id } });
            await tx.financeTransaction.create({
              data: {
                txnNo: await nextReference(tx, 'TXN'),
                organizationId: org,
                type: 'SALARY_PAYMENT',
                direction: 'OUTFLOW',
                amount: net,
                txnDate: toDate(input.paidOn),
                method: input.method,
                referenceNo: input.referenceNo ?? null,
                counterparty: ps.employee.user.fullName,
                description: `Salary ${period} — ${ps.employee.employeeCode}`,
                salaryPaymentId: sp.id,
                recordedById: user.id,
              },
            });
          }
          paid += 1;
          amount += net;
        }
        const remaining = await tx.payslip.count({ where: { payrollRunId: id, status: { not: 'PAID' } } });
        if (remaining === 0) await tx.payrollRun.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
        await this.audit.log({ actorId: user.id, action: 'payroll.run.pay', entityType: 'PayrollRun', entityId: id, organizationId: org, metadata: { payslips: paid, amount: Math.round(amount * 100) / 100, method: input.method, referenceNo: input.referenceNo ?? null, remaining } }, tx);
        return { paid, amount: Math.round(amount * 100) / 100, remaining };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return { ...result, runStatus: result.remaining === 0 ? 'PAID' : 'APPROVED' };
  }

  async cancel(user: AuthUser, id: string, reason: string) {
    const org = platformOrg(user);
    assertHr(user, 'payroll.manage');
    const run = await this.prisma.payrollRun.findFirst({ where: { id, organizationId: org } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!['DRAFT', 'CALCULATED', 'APPROVED'].includes(run.status)) throw new ConflictException(`A ${run.status.toLowerCase()} payroll cannot be cancelled`);
    if (await this.prisma.payslip.count({ where: { payrollRunId: id, status: 'PAID' } })) throw new ConflictException('Payments have been recorded for this run — it cannot be cancelled');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payrollRun.updateMany({ where: { id, status: run.status }, data: { status: 'CANCELLED', notes: [run.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n') } });
      if (res.count !== 1) throw new ConflictException('This run changed — refresh and try again');
      await tx.payrollAdjustment.updateMany({ where: { payrollRunId: id }, data: { status: 'PENDING', payrollRunId: null } });
      await this.audit.log({ actorId: user.id, action: 'payroll.run.cancel', entityType: 'PayrollRun', entityId: id, organizationId: org, before: { status: run.status }, after: { status: 'CANCELLED' }, metadata: { reason } }, tx);
    });
    return { ok: true };
  }

  // ───────────── Payslips ─────────────

  async payslip(user: AuthUser, id: string) {
    const org = platformOrg(user);
    const ps = await this.prisma.payslip.findFirst({
      where: { id, payrollRun: { organizationId: org } },
      include: {
        payrollRun: true,
        lines: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidOn: 'asc' }, select: { amount: true, paidOn: true, method: true, referenceNo: true } },
        employee: {
          select: {
            id: true,
            userId: true,
            employeeCode: true,
            joiningDate: true,
            bankAccountLast4: true,
            workLocation: true,
            user: { select: { fullName: true, email: true } },
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });
    if (!ps) throw new NotFoundException('Payslip not found');
    const self = ps.employee.userId === user.id;
    const admin = canHr(user, 'payroll.view', 'payroll.manage');
    if (!admin) {
      if (!self || !canHr(user, 'payslip.self') || !['APPROVED', 'PAID'].includes(ps.status) || ps.payrollRun.status === 'CANCELLED') throw new NotFoundException('Payslip not found');
    }
    const org_ = await this.prisma.organization.findUnique({ where: { id: org }, select: { name: true, addressLine: true } });
    const legalName = await this.settings.getString('company.legalName');
    return {
      id: ps.id,
      status: ps.status,
      runStatus: ps.payrollRun.status,
      period: periodLabel(ps.payrollRun.periodYear, ps.payrollRun.periodMonth),
      periodStart: dateStr(ps.payrollRun.periodStart),
      periodEnd: dateStr(ps.payrollRun.periodEnd),
      company: { name: legalName || org_?.name || '', address: org_?.addressLine ?? null },
      employee: {
        id: ps.employee.id,
        employeeCode: ps.employee.employeeCode,
        name: ps.employee.user.fullName,
        email: ps.employee.user.email,
        department: ps.employee.department?.name ?? null,
        designation: ps.employee.designation?.name ?? null,
        joiningDate: dateStr(ps.employee.joiningDate),
        bankAccountLast4: ps.employee.bankAccountLast4,
        workLocation: ps.employee.workLocation,
      },
      workingDays: n(ps.workingDays),
      payableDays: n(ps.payableDays),
      lopDays: n(ps.lopDays),
      earnings: ps.lines.filter((l) => l.type === 'EARNING').map((l) => ({ code: l.componentCode, name: l.componentName, amount: n(l.amount), calculation: l.calculation })),
      deductions: ps.lines.filter((l) => l.type === 'DEDUCTION').map((l) => ({ code: l.componentCode, name: l.componentName, amount: n(l.amount), calculation: l.calculation })),
      grossEarnings: n(ps.grossEarnings),
      totalDeductions: n(ps.totalDeductions),
      netPay: n(ps.netPay),
      payments: ps.payments.map((p) => ({ amount: n(p.amount), paidOn: dateStr(p.paidOn), method: p.method, referenceNo: p.referenceNo })),
      isSelf: self,
    };
  }

  async myPayslips(user: AuthUser) {
    platformOrg(user);
    if (!user.employeeId) return [];
    const rows = await this.prisma.payslip.findMany({
      where: { employeeId: user.employeeId, status: { in: ['APPROVED', 'PAID'] }, payrollRun: { status: { not: 'CANCELLED' } } },
      include: { payrollRun: { select: { periodYear: true, periodMonth: true } } },
      orderBy: [{ payrollRun: { periodYear: 'desc' } }, { payrollRun: { periodMonth: 'desc' } }],
    });
    return rows.map((p) => ({ id: p.id, period: periodLabel(p.payrollRun.periodYear, p.payrollRun.periodMonth), periodYear: p.payrollRun.periodYear, periodMonth: p.payrollRun.periodMonth, status: p.status, grossEarnings: n(p.grossEarnings), totalDeductions: n(p.totalDeductions), netPay: n(p.netPay), payableDays: n(p.payableDays), lopDays: n(p.lopDays) }));
  }
}
