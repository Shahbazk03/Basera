import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import {
  HR_NON_ASSIGNABLE_ROLES,
  normalizePhone,
  type employeeCreateSchema,
  type employeeDocumentSchema,
  type employeeExitSchema,
  type employeeSensitiveSchema,
  type employeeUpdateSchema,
  type PermissionKey,
} from '@estate/shared';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuditService } from '../../common/audit.service';
import { decryptField, encryptField, hashPassword, randomToken, sha256 } from '../../common/crypto';
import { paginated, Pagination, skipTake } from '../../common/http';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { assertHr, canHr, dateStr, platformOrg, toDate } from './hr.util';

export interface EmployeeListQuery extends Pagination {
  q?: string;
  departmentId?: string;
  designationId?: string;
  managerId?: string;
  status?: 'PROBATION' | 'ACTIVE' | 'ON_NOTICE' | 'EXITED' | 'SUSPENDED';
}

const JOB_FIELDS = ['employeeCode', 'departmentId', 'designationId', 'managerId', 'shiftId', 'joiningDate', 'exitDate', 'employmentType', 'employmentStatus', 'workLocation'] as const;

const listSelect = {
  id: true,
  employeeCode: true,
  joiningDate: true,
  exitDate: true,
  employmentType: true,
  employmentStatus: true,
  workLocation: true,
  isDemo: true,
  user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, status: true } },
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  manager: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } },
} satisfies Prisma.EmployeeSelect;

function maskPan(pan: string): string {
  return pan.length === 10 ? `${pan.slice(0, 2)}XXXXX${pan.slice(7)}` : 'XXXXXXXXXX';
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly authContext: AuthContextService,
  ) {}

  // ───────────── Directory ─────────────

  async list(user: AuthUser, q: EmployeeListQuery) {
    const org = platformOrg(user);
    assertHr(user, 'employee.view', 'employee.manage');
    const base: Prisma.EmployeeWhereInput = {
      organizationId: org,
      deletedAt: null,
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.designationId ? { designationId: q.designationId } : {}),
      ...(q.managerId ? { managerId: q.managerId } : {}),
      ...(q.q
        ? {
            OR: [
              { user: { fullName: { contains: q.q, mode: 'insensitive' } } },
              { user: { email: { contains: q.q, mode: 'insensitive' } } },
              { employeeCode: { contains: q.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const where = { ...base, ...(q.status ? { employmentStatus: q.status } : {}) };
    const [rows, total, counts] = await Promise.all([
      this.prisma.employee.findMany({ where, select: listSelect, orderBy: [{ employeeCode: 'asc' }], ...skipTake(q) }),
      this.prisma.employee.count({ where }),
      this.prisma.employee.groupBy({ by: ['employmentStatus'], where: base, _count: { _all: true } }),
    ]);
    return { ...paginated(rows, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.employmentStatus, c._count._all])) };
  }

  /** Minimal active-employee options for pickers (managers, assignees). */
  async options(user: AuthUser) {
    const org = platformOrg(user);
    if (!canHr(user, 'employee.view', 'employee.manage', 'task.manage', 'payroll.view', 'attendance.manage', 'leave.manage') && !user.employeeId) throw new ForbiddenException();
    return this.prisma.employee.findMany({
      where: { organizationId: org, deletedAt: null, employmentStatus: { not: 'EXITED' } },
      select: { id: true, employeeCode: true, userId: true, user: { select: { fullName: true } }, designation: { select: { name: true } }, department: { select: { name: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
  }

  private async loadOrThrow(org: string, id: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true, status: true, lastLoginAt: true, userRoles: { include: { role: { select: { key: true, name: true } } } } } },
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, weeklyOffDays: true } },
        manager: { select: { id: true, employeeCode: true, managerId: true, user: { select: { id: true, fullName: true } }, designation: { select: { name: true } } } },
        reports: { where: { deletedAt: null, employmentStatus: { not: 'EXITED' } }, select: { id: true, employeeCode: true, user: { select: { fullName: true } }, designation: { select: { name: true } } } },
        documents: { orderBy: { createdAt: 'desc' }, include: { file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } }, uploadedBy: { select: { fullName: true } } } },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  /** What the caller may see about an employee. */
  private access(user: AuthUser, emp: { id: string; managerId: string | null; userId: string }) {
    const self = user.employeeId === emp.id || user.id === emp.userId;
    const manager = Boolean(user.employeeId && emp.managerId === user.employeeId);
    const manage = canHr(user, 'employee.manage');
    const view = manage || canHr(user, 'employee.view') || self || manager;
    return { self, manager, manage, view, personal: manage || self, salary: self || canHr(user, 'payroll.view', 'payroll.manage') };
  }

  async detail(user: AuthUser, id: string) {
    const org = platformOrg(user);
    const emp = await this.loadOrThrow(org, id);
    const acc = this.access(user, emp);
    if (!acc.view) throw new NotFoundException('Employee not found');

    const chain: { id: string; name: string; designation: string | null }[] = [];
    let cursor = emp.manager;
    for (let i = 0; cursor && i < 12; i += 1) {
      chain.push({ id: cursor.id, name: cursor.user.fullName, designation: cursor.designation?.name ?? null });
      cursor = cursor.managerId
        ? await this.prisma.employee.findUnique({ where: { id: cursor.managerId }, select: { id: true, employeeCode: true, managerId: true, user: { select: { id: true, fullName: true } }, designation: { select: { name: true } } } })
        : null;
    }

    const year = new Date().getUTCFullYear();
    const balances = await this.prisma.leaveBalance.findMany({ where: { employeeId: id, year }, include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true } } }, orderBy: { leaveType: { name: 'asc' } } });

    let salary: unknown = null;
    if (acc.salary) {
      const structure = await this.prisma.salaryStructure.findFirst({
        where: { employeeId: id, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
        include: { lines: { include: { component: { select: { code: true, name: true, type: true, calcType: true, sortOrder: true } } } } },
      });
      salary = structure
        ? {
            id: structure.id,
            effectiveFrom: dateStr(structure.effectiveFrom),
            lines: structure.lines.sort((a, b) => a.component.sortOrder - b.component.sortOrder).map((l) => ({ code: l.component.code, name: l.component.name, type: l.component.type, calcType: l.component.calcType, value: Number(l.value) })),
          }
        : null;
    }

    let pan: string | null = null;
    if (acc.personal && emp.panEncrypted) {
      try {
        pan = maskPan(decryptField(emp.panEncrypted));
      } catch {
        pan = 'Unreadable';
      }
    }

    return {
      id: emp.id,
      employeeCode: emp.employeeCode,
      user: { id: emp.user.id, fullName: emp.user.fullName, email: emp.user.email, phone: emp.user.phone, avatarUrl: emp.user.avatarUrl, status: emp.user.status, lastLoginAt: emp.user.lastLoginAt },
      roles: emp.user.userRoles.filter((r) => r.organizationId === null || r.organizationId === org).map((r) => ({ key: r.role.key, name: r.role.name, scope: r.organizationId ? 'ORGANIZATION' : 'PLATFORM_WIDE' })),
      department: emp.department,
      designation: emp.designation,
      shift: emp.shift,
      manager: emp.manager ? { id: emp.manager.id, name: emp.manager.user.fullName, employeeCode: emp.manager.employeeCode } : null,
      managerChain: chain,
      reports: emp.reports.map((r) => ({ id: r.id, employeeCode: r.employeeCode, name: r.user.fullName, designation: r.designation?.name ?? null })),
      joiningDate: dateStr(emp.joiningDate),
      exitDate: emp.exitDate ? dateStr(emp.exitDate) : null,
      employmentType: emp.employmentType,
      employmentStatus: emp.employmentStatus,
      workLocation: emp.workLocation,
      personal: acc.personal
        ? {
            dateOfBirth: emp.dateOfBirth ? dateStr(emp.dateOfBirth) : null,
            gender: emp.gender,
            personalEmail: emp.personalEmail,
            emergencyContact: emp.emergencyContact,
            bankAccountLast4: emp.bankAccountLast4,
            hasBankDetails: Boolean(emp.bankDetailsEncrypted),
            panMasked: pan,
          }
        : null,
      documents: acc.personal || acc.manage ? emp.documents.map((d) => ({ id: d.id, docType: d.docType, title: d.title, createdAt: d.createdAt, uploadedBy: d.uploadedBy?.fullName ?? null, file: d.file })) : [],
      leaveBalances: balances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        name: b.leaveType.name,
        code: b.leaveType.code,
        isPaid: b.leaveType.isPaid,
        allocated: Number(b.allocated),
        carriedForward: Number(b.carriedForward),
        used: Number(b.used),
        available: Number(b.allocated) + Number(b.carriedForward) - Number(b.used),
      })),
      salary,
      isDemo: emp.isDemo,
      access: { self: acc.self, manager: acc.manager, manage: acc.manage, salary: acc.salary, payrollManage: canHr(user, 'payroll.manage') },
    };
  }

  // ───────────── Roles that may be granted from HR ─────────────

  /** Platform-scope roles the caller may grant: never SUPER_ADMIN/ADMIN; without user.manage only roles within the caller's own permissions. */
  async assignableRoles(user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const roles = await this.prisma.role.findMany({
      where: { scope: 'PLATFORM', key: { notIn: [...HR_NON_ASSIGNABLE_ROLES] } },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { name: 'asc' },
    });
    const unrestricted = user.can('user.manage', org);
    return roles
      .filter((r) => unrestricted || r.permissions.every((rp) => user.can(rp.permission.key as PermissionKey, org)))
      .map((r) => ({ key: r.key, name: r.name, description: r.description }));
  }

  // ───────────── Create / update / exit ─────────────

  private async validateJobRefs(org: string, input: { departmentId?: string | null; designationId?: string | null; managerId?: string | null; shiftId?: string | null }, selfId?: string) {
    const issues: { path: string; message: string }[] = [];
    if (input.departmentId && !(await this.prisma.department.findFirst({ where: { id: input.departmentId, organizationId: org } }))) issues.push({ path: 'departmentId', message: 'Unknown department' });
    if (input.designationId && !(await this.prisma.designation.findFirst({ where: { id: input.designationId, organizationId: org } }))) issues.push({ path: 'designationId', message: 'Unknown designation' });
    if (input.shiftId && !(await this.prisma.shift.findFirst({ where: { id: input.shiftId, organizationId: org } }))) issues.push({ path: 'shiftId', message: 'Unknown shift' });
    if (input.managerId) {
      if (selfId && input.managerId === selfId) issues.push({ path: 'managerId', message: 'An employee cannot report to themselves' });
      const mgr = await this.prisma.employee.findFirst({ where: { id: input.managerId, organizationId: org, deletedAt: null }, select: { id: true, employmentStatus: true } });
      if (!mgr) issues.push({ path: 'managerId', message: 'Unknown manager' });
      else if (mgr.employmentStatus === 'EXITED') issues.push({ path: 'managerId', message: 'The selected manager has exited' });
      else if (selfId) {
        // Prevent reporting cycles
        let cursor: string | null = input.managerId;
        for (let i = 0; cursor && i < 50; i += 1) {
          if (cursor === selfId) {
            issues.push({ path: 'managerId', message: 'This would create a reporting loop' });
            break;
          }
          cursor = (await this.prisma.employee.findUnique({ where: { id: cursor }, select: { managerId: true } }))?.managerId ?? null;
        }
      }
    }
    if (issues.length) throw new BadRequestException({ message: 'Please correct the highlighted fields', code: 'VALIDATION_FAILED', details: issues });
  }

  async create(user: AuthUser, input: z.output<typeof employeeCreateSchema>, actorIp: string) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const email = input.email.toLowerCase();
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw new BadRequestException({ message: 'Enter a valid mobile number', details: [{ path: 'phone', message: 'Invalid mobile number' }] });
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] }, select: { email: true } });
    if (existing) throw new ConflictException({ message: existing.email === email ? 'A user with this email already exists' : 'A user with this mobile number already exists', details: [{ path: existing.email === email ? 'email' : 'phone', message: 'Already in use' }] });
    if (await this.prisma.employee.findFirst({ where: { organizationId: org, employeeCode: input.employeeCode } })) {
      throw new ConflictException({ message: `Employee code ${input.employeeCode} is already used`, details: [{ path: 'employeeCode', message: 'Already in use' }] });
    }
    await this.validateJobRefs(org, input);

    const allowed = new Set((await this.assignableRoles(user)).map((r) => r.key));
    const roleKeys = [...new Set(input.roleKeys)];
    const denied = roleKeys.filter((k) => !allowed.has(k));
    if (denied.length) throw new ForbiddenException({ message: `You cannot grant: ${denied.join(', ')}`, details: [{ path: 'roleKeys', message: 'Role not assignable' }] });
    const roles = await this.prisma.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });

    const passwordHash = await hashPassword(input.password ?? randomToken(24));
    const year = new Date().getUTCFullYear();
    const leaveTypes = await this.prisma.leaveType.findMany({ where: { organizationId: org, isActive: true } });
    const shiftId = input.shiftId ?? (await this.prisma.shift.findFirst({ where: { organizationId: org, isDefault: true }, select: { id: true } }))?.id ?? null;
    const inviteToken = input.password ? null : randomToken(32);

    const created = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, phone, fullName: input.fullName, passwordHash, accountType: 'STAFF' } });
      await tx.organizationMember.create({ data: { organizationId: org, userId: u.id, title: 'Staff' } });
      const e = await tx.employee.create({
        data: {
          organizationId: org,
          userId: u.id,
          employeeCode: input.employeeCode,
          departmentId: input.departmentId ?? null,
          designationId: input.designationId ?? null,
          managerId: input.managerId ?? null,
          shiftId,
          joiningDate: toDate(input.joiningDate),
          employmentType: input.employmentType,
          employmentStatus: input.employmentStatus,
          workLocation: input.workLocation ?? null,
          dateOfBirth: input.dateOfBirth ? toDate(input.dateOfBirth) : null,
          gender: input.gender ?? null,
          personalEmail: input.personalEmail || null,
          emergencyContact: input.emergencyContact ?? null,
        },
      });
      for (const r of roles) await tx.userRole.create({ data: { userId: u.id, roleId: r.id, organizationId: org, grantedById: user.id } });
      if (leaveTypes.length) await tx.leaveBalance.createMany({ data: leaveTypes.map((lt) => ({ employeeId: e.id, leaveTypeId: lt.id, year, allocated: lt.annualQuota })) });
      if (inviteToken) {
        await tx.verificationToken.create({ data: { userId: u.id, type: 'PASSWORD_RESET', target: email, tokenHash: sha256(inviteToken), expiresAt: new Date(Date.now() + 72 * 3_600_000) } });
      }
      await this.audit.log(
        { actorId: user.id, actorIp, action: 'employee.create', entityType: 'Employee', entityId: e.id, organizationId: org, after: { employeeCode: e.employeeCode, userId: u.id, roles: roleKeys } },
        tx,
      );
      return e;
    });
    if (inviteToken) {
      await this.notifications.send({
        eventKey: 'auth.password_reset',
        recipients: [{ userId: created.userId, email, name: input.fullName }],
        channels: ['EMAIL'],
        data: {},
        link: `${env().CONSOLE_PUBLIC_URL}/reset-password?token=${inviteToken}`,
        relatedType: 'User',
        relatedId: created.userId,
      });
    }
    return this.detail(user, created.id);
  }

  async update(user: AuthUser, id: string, patch: Partial<z.output<typeof employeeUpdateSchema>>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id, organizationId: org, deletedAt: null }, include: { user: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    const isSelf = emp.userId === user.id;
    if (isSelf && JOB_FIELDS.some((f) => f in patch)) throw new ForbiddenException('You cannot change your own employment details — ask another HR administrator');
    if (patch.employmentStatus === 'EXITED') throw new BadRequestException('Use the exit action to record an exit');
    await this.validateJobRefs(org, patch as never, id);
    if (patch.employeeCode && patch.employeeCode !== emp.employeeCode && (await this.prisma.employee.findFirst({ where: { organizationId: org, employeeCode: patch.employeeCode } }))) {
      throw new ConflictException({ message: 'Employee code already used', details: [{ path: 'employeeCode', message: 'Already in use' }] });
    }
    let phone: string | null | undefined;
    if ('phone' in patch) {
      phone = patch.phone ? normalizePhone(patch.phone) : null;
      if (patch.phone && !phone) throw new BadRequestException({ message: 'Enter a valid mobile number', details: [{ path: 'phone', message: 'Invalid mobile number' }] });
      if (phone && (await this.prisma.user.findFirst({ where: { phone, id: { not: emp.userId } } }))) throw new ConflictException({ message: 'Mobile number already in use', details: [{ path: 'phone', message: 'Already in use' }] });
    }
    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    const d = (v: string | null | undefined) => (v ? toDate(v) : null);
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'fullName' || k === 'phone') continue;
      if (k === 'joiningDate' || k === 'exitDate' || k === 'dateOfBirth') (data as Record<string, unknown>)[k] = d(v as string | null);
      else if (k === 'personalEmail') data.personalEmail = (v as string) || null;
      else (data as Record<string, unknown>)[k] = v ?? null;
    }
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.employee.update({ where: { id }, data });
      if (patch.fullName || phone !== undefined) await tx.user.update({ where: { id: emp.userId }, data: { ...(patch.fullName ? { fullName: patch.fullName } : {}), ...(phone !== undefined ? { phone } : {}) } });
      await this.audit.log({ actorId: user.id, action: 'employee.update', entityType: 'Employee', entityId: id, organizationId: org, before: Object.fromEntries(Object.keys(patch).map((k) => [k, (emp as Record<string, unknown>)[k] ?? (emp.user as Record<string, unknown>)[k]])), after: patch }, tx);
    });
    this.authContext.invalidateUser(emp.userId);
    return this.detail(user, id);
  }

  async exit(user: AuthUser, id: string, input: z.output<typeof employeeExitSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id, organizationId: org, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.userId === user.id) throw new ForbiddenException('You cannot record your own exit');
    if (emp.employmentStatus === 'EXITED') throw new ConflictException('This employee has already exited');
    if (input.exitDate < dateStr(emp.joiningDate)) throw new BadRequestException({ message: 'Exit date cannot be before the joining date', details: [{ path: 'exitDate', message: 'Before joining date' }] });
    const reports = await this.prisma.employee.count({ where: { managerId: id, deletedAt: null, employmentStatus: { not: 'EXITED' } } });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { employmentStatus: 'EXITED', exitDate: toDate(input.exitDate) } });
      await tx.user.update({ where: { id: emp.userId }, data: { status: 'DISABLED' } });
      await tx.session.updateMany({ where: { userId: emp.userId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'EMPLOYEE_EXITED' } });
      await tx.salesTeamMember.updateMany({ where: { userId: emp.userId }, data: { isActive: false } });
      await this.audit.log({ actorId: user.id, action: 'employee.exit', entityType: 'Employee', entityId: id, organizationId: org, before: { employmentStatus: emp.employmentStatus }, after: { employmentStatus: 'EXITED', exitDate: input.exitDate }, metadata: { reason: input.reason, directReports: reports } }, tx);
    });
    this.authContext.invalidateUser(emp.userId);
    return { ok: true, directReportsToReassign: reports };
  }

  // ───────────── Sensitive data (encrypted at rest) ─────────────

  async setSensitive(user: AuthUser, id: string, input: z.output<typeof employeeSensitiveSchema>) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id, organizationId: org, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.userId === user.id) throw new ForbiddenException('Ask another HR administrator to update your bank or PAN details');
    const data: Prisma.EmployeeUpdateInput = {};
    if (input.bankAccountNumber || input.ifsc || input.bankAccountName) {
      if (!input.bankAccountNumber || !input.ifsc) throw new BadRequestException({ message: 'Account number and IFSC are both required', details: [{ path: 'bankAccountNumber', message: 'Required' }] });
      data.bankDetailsEncrypted = encryptField(JSON.stringify({ accountName: input.bankAccountName ?? null, accountNumber: input.bankAccountNumber, ifsc: input.ifsc }));
      data.bankAccountLast4 = input.bankAccountNumber.slice(-4);
    }
    if (input.pan) data.panEncrypted = encryptField(input.pan);
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    await this.prisma.employee.update({ where: { id }, data });
    await this.audit.log({ actorId: user.id, action: 'employee.sensitive.update', entityType: 'Employee', entityId: id, organizationId: org, metadata: { bank: Boolean(data.bankDetailsEncrypted), pan: Boolean(data.panEncrypted) } });
    return { ok: true, bankAccountLast4: data.bankAccountLast4 ?? emp.bankAccountLast4 };
  }

  /** Full values for authorised HR only — every reveal is audited. */
  async revealSensitive(user: AuthUser, id: string, actorIp: string) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const emp = await this.prisma.employee.findFirst({ where: { id, organizationId: org, deletedAt: null }, select: { bankDetailsEncrypted: true, panEncrypted: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    const bank = emp.bankDetailsEncrypted ? (JSON.parse(decryptField(emp.bankDetailsEncrypted)) as { accountName: string | null; accountNumber: string; ifsc: string }) : null;
    const pan = emp.panEncrypted ? decryptField(emp.panEncrypted) : null;
    await this.audit.log({ actorId: user.id, actorIp, action: 'employee.sensitive.view', entityType: 'Employee', entityId: id, organizationId: org });
    return { bank, pan };
  }

  // ───────────── Documents ─────────────

  async addDocument(user: AuthUser, id: string, input: z.output<typeof employeeDocumentSchema>) {
    const org = platformOrg(user);
    const emp = await this.prisma.employee.findFirst({ where: { id, organizationId: org, deletedAt: null } });
    if (!emp) throw new NotFoundException('Employee not found');
    const self = emp.userId === user.id;
    if (!self && !canHr(user, 'employee.manage')) throw new ForbiddenException();
    const file = await this.prisma.storedFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.deletedAt || file.visibility !== 'PRIVATE') throw new BadRequestException('Upload the document with purpose "employee-document" first');
    if (file.uploadedById !== user.id) throw new ForbiddenException('You can only attach files you uploaded');
    const doc = await this.prisma.employeeDocument.create({ data: { employeeId: id, docType: input.docType, title: input.title, fileId: file.id, uploadedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'employee.document.add', entityType: 'Employee', entityId: id, organizationId: org, after: { docId: doc.id, title: doc.title, docType: doc.docType } });
    return doc;
  }

  async removeDocument(user: AuthUser, id: string, docId: string) {
    const org = platformOrg(user);
    assertHr(user, 'employee.manage');
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: docId, employeeId: id, employee: { organizationId: org } } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.employeeDocument.delete({ where: { id: docId } });
    await this.audit.log({ actorId: user.id, action: 'employee.document.remove', entityType: 'Employee', entityId: id, organizationId: org, before: { title: doc.title } });
    return { ok: true };
  }

  // ───────────── Org chart ─────────────

  async orgChart(user: AuthUser) {
    const org = platformOrg(user);
    assertHr(user, 'employee.view', 'employee.manage');
    const rows = await this.prisma.employee.findMany({
      where: { organizationId: org, deletedAt: null, employmentStatus: { not: 'EXITED' } },
      select: { id: true, managerId: true, employeeCode: true, user: { select: { fullName: true, avatarUrl: true } }, designation: { select: { name: true } }, department: { select: { name: true } } },
    });
    type Node = { id: string; name: string; employeeCode: string; designation: string | null; department: string | null; avatarUrl: string | null; reports: Node[] };
    const nodes = new Map<string, Node>(rows.map((r) => [r.id, { id: r.id, name: r.user.fullName, employeeCode: r.employeeCode, designation: r.designation?.name ?? null, department: r.department?.name ?? null, avatarUrl: r.user.avatarUrl, reports: [] }]));
    const roots: Node[] = [];
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      if (r.managerId && nodes.has(r.managerId)) nodes.get(r.managerId)!.reports.push(node);
      else roots.push(node);
    }
    const sort = (list: Node[]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((n) => sort(n.reports));
    };
    sort(roots);
    return roots;
  }

  /** Used by other HR services. */
  static async managerUserId(db: Tx | PrismaService, employeeId: string): Promise<string | null> {
    const e = await db.employee.findUnique({ where: { id: employeeId }, select: { manager: { select: { userId: true, employmentStatus: true } } } });
    return e?.manager && e.manager.employmentStatus !== 'EXITED' ? e.manager.userId : null;
  }
}
