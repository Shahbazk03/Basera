import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSION_KEYS, type PermissionKey } from '@estate/shared';
import type { z } from 'zod';
import type { adminSetPasswordSchema, adminUserUpdateSchema, roleSchema, roleUpdateSchema, userRoleGrantSchema, userStatusChangeSchema } from '@estate/shared';
import { AccountType, Prisma, UserStatus, RoleScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { hashPassword } from '../../common/crypto';
import type { RequestMeta } from '../../common/decorators';
import { AuthService } from '../auth/auth.service';
import { enumRank } from '../../common/ordering';

const PRIVILEGED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

export interface UserListQuery extends Pagination {
  q?: string;
  accountType?: AccountType;
  status?: UserStatus;
  roleKey?: string;
  organizationId?: string;
}

/** User administration and role design. Every change is audited and takes effect immediately. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authContext: AuthContextService,
    private readonly auth: AuthService,
  ) {}

  // ───────────────────────── Users ─────────────────────────

  async listUsers(q: UserListQuery) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.accountType ? { accountType: q.accountType } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.roleKey ? { userRoles: { some: { role: { key: q.roleKey } } } } : {}),
      ...(q.organizationId ? { memberships: { some: { organizationId: q.organizationId, status: { not: 'REMOVED' } } } } : {}),
      ...(q.q
        ? {
            OR: [
              { fullName: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q.replace(/\s/g, '') } },
            ],
          }
        : {}),
    };
    const [rows, total, typeCounts] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          accountType: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          isDemo: true,
          emailVerifiedAt: true,
          employee: { select: { employeeCode: true } },
          userRoles: { select: { id: true, organizationId: true, role: { select: { key: true, name: true } }, organization: { select: { name: true } } } },
          _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
        },
        ...skipTake(q),
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ['accountType'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    return {
      ...paginated(
        rows.map(({ userRoles, _count, employee, emailVerifiedAt, ...u }) => ({
          ...u,
          emailVerified: Boolean(emailVerifiedAt),
          employeeCode: employee?.employeeCode ?? null,
          memberships: _count.memberships,
          roles: userRoles.map((r) => ({ id: r.id, key: r.role.key, name: r.role.name, organizationId: r.organizationId, organizationName: r.organization?.name ?? null })),
        })),
        total,
        q,
      ),
      typeCounts: Object.fromEntries(typeCounts.map((c) => [c.accountType, c._count._all])),
    };
  }

  async userDetail(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        accountType: true,
        status: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        lastLoginAt: true,
        failedLoginCount: true,
        lockedUntil: true,
        createdAt: true,
        isDemo: true,
        employee: { select: { id: true, employeeCode: true, employmentStatus: true, department: { select: { name: true } }, designation: { select: { name: true } } } },
        memberships: {
          where: { status: { not: 'REMOVED' } },
          select: { id: true, title: true, isOwner: true, status: true, joinedAt: true, organization: { select: { id: true, name: true, type: true, status: true } } },
        },
        userRoles: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, createdAt: true, organizationId: true, role: { select: { id: true, key: true, name: true, scope: true } }, organization: { select: { name: true } }, grantedBy: { select: { fullName: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const [activeSessions, history] = await Promise.all([
      this.prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.prisma.auditLog.findMany({
        where: { OR: [{ entityType: 'User', entityId: id }, { actorId: id }] },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actorIp: true, actor: { select: { fullName: true } } },
      }),
    ]);
    return { ...user, activeSessions, history };
  }

  private async targetHasPrivilegedRole(userId: string): Promise<boolean> {
    return (await this.prisma.userRole.count({ where: { userId, role: { key: { in: [...PRIVILEGED_ROLES] } } } })) > 0;
  }

  async setStatus(actor: AuthUser, id: string, input: z.output<typeof userStatusChangeSchema>) {
    if (id === actor.id) throw new ForbiddenException('You cannot change the status of your own account');
    const target = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('User not found');
    if ((await this.targetHasPrivilegedRole(id)) && !actor.hasGlobal('role.manage')) throw new ForbiddenException('Only a super admin can change the status of an administrator');
    if (target.status === input.status) return { ok: true, status: target.status };
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: input.status, ...(input.status === 'ACTIVE' ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
      let revoked = 0;
      if (input.status !== 'ACTIVE') {
        revoked = (await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokedReason: `ACCOUNT_${input.status}` } })).count;
      }
      await this.audit.log({ actorId: actor.id, action: 'user.status', entityType: 'User', entityId: id, before: { status: target.status }, after: { status: input.status }, metadata: { reason: input.reason ?? null, sessionsRevoked: revoked } }, tx);
    });
    this.authContext.invalidateUser(id);
    return { ok: true, status: input.status };
  }

  /** Correct a user's display name. Administrators' accounts can only be changed by a super admin. */
  async updateUser(actor: AuthUser, id: string, input: z.output<typeof adminUserUpdateSchema>) {
    const target = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, fullName: true } });
    if (!target) throw new NotFoundException('User not found');
    if (id !== actor.id && (await this.targetHasPrivilegedRole(id)) && !actor.hasGlobal('role.manage')) throw new ForbiddenException('Only a super admin can change an administrator’s details');
    if (target.fullName === input.fullName) return { ok: true, fullName: target.fullName };
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { fullName: input.fullName } });
      await this.audit.log({ actorId: actor.id, action: 'user.profile.update', entityType: 'User', entityId: id, before: { fullName: target.fullName }, after: { fullName: input.fullName } }, tx);
    });
    this.authContext.invalidateUser(id);
    return { ok: true, fullName: input.fullName };
  }

  /**
   * Sets a user's password directly (administrator help desk). Every device of that user is signed out.
   * The password can be emailed to the user; an emailed password is temporary and must be replaced at the
   * next sign-in. Administrators' accounts can only be changed by a super admin; never your own account.
   */
  async setPassword(actor: AuthUser, id: string, input: z.output<typeof adminSetPasswordSchema>, meta: RequestMeta) {
    if (id === actor.id) throw new BadRequestException({ message: 'Change your own password on your Account & security page', code: 'OWN_ACCOUNT' });
    const target = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, email: true, fullName: true, accountType: true } });
    if (!target) throw new NotFoundException('User not found');
    if ((await this.targetHasPrivilegedRole(id)) && !actor.hasGlobal('role.manage')) throw new ForbiddenException('Only a super admin can set an administrator’s password');
    if (input.sendEmail && !target.email) {
      throw new ConflictException({ message: 'This user has no email address — untick “Email the password” and share it with them securely', code: 'NO_EMAIL' });
    }
    const now = new Date();
    const passwordHash = await hashPassword(input.password);
    const sessionsRevoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: now, mustChangePassword: input.mustChange, failedLoginCount: 0, lockedUntil: null } });
      const revoked = await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'PASSWORD_SET_BY_ADMIN' } });
      await this.audit.log(
        { actorId: actor.id, actorIp: meta.ip, action: 'user.password.set_by_admin', entityType: 'User', entityId: id, metadata: { mustChange: input.mustChange, emailed: input.sendEmail, sessionsRevoked: revoked.count } },
        tx,
      );
      return revoked.count;
    });
    this.authContext.invalidateUser(id);
    const emailStatus = input.sendEmail && target.email ? await this.auth.emailTemporaryPassword({ ...target, email: target.email }, input.password, actor) : null;
    return { ok: true, sessionsRevoked, mustChange: input.mustChange, emailStatus, sentTo: emailStatus ? target.email : null };
  }

  /**
   * Emails the user a single-use password-reset link (to their own address). The administrator never sees
   * the link or sets the password. Administrators' accounts can only be reset by a super admin.
   */
  async sendPasswordReset(actor: AuthUser, id: string, meta: RequestMeta) {
    const target = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, email: true } });
    if (!target) throw new NotFoundException('User not found');
    if (id !== actor.id && (await this.targetHasPrivilegedRole(id)) && !actor.hasGlobal('role.manage')) throw new ForbiddenException('Only a super admin can reset an administrator’s password');
    const result = await this.auth.issuePasswordReset(id, { meta, requestedById: actor.id });
    if (result === 'NO_EMAIL') throw new ConflictException({ message: 'This user has no email address to send a reset link to', code: 'NO_EMAIL' });
    if (result === 'NOT_ACTIVE') throw new ConflictException({ message: 'Reactivate the account before resetting its password', code: 'NOT_ACTIVE' });
    if (result === 'RATE_LIMITED') throw new HttpException({ message: 'Several reset links were sent recently — wait 15 minutes before sending another', code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    return { ok: true, sentTo: target.email };
  }

  private async assertCanGrant(actor: AuthUser, role: { key: string; permissions: { permission: { key: string } }[] }) {
    if (actor.hasGlobal('role.manage')) return;
    if (PRIVILEGED_ROLES.has(role.key)) throw new ForbiddenException('Only a super admin can grant or revoke administrator roles');
    // Prevent privilege escalation: you may only hand out permissions you hold platform-wide yourself.
    const missing = role.permissions.map((p) => p.permission.key as PermissionKey).filter((p) => !actor.hasGlobal(p));
    if (missing.length) throw new ForbiddenException({ message: 'This role includes permissions you do not hold yourself', code: 'ESCALATION_BLOCKED', details: missing.map((m) => ({ path: 'permission', message: m })) });
  }

  async grantRole(actor: AuthUser, userId: string, input: z.output<typeof userRoleGrantSchema>) {
    if (userId === actor.id) throw new ForbiddenException('You cannot change your own roles');
    const target = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status !== 'ACTIVE') throw new ConflictException('Activate the account before granting roles');
    const role = await this.prisma.role.findUnique({ where: { key: input.roleKey }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
    if (!role) throw new BadRequestException({ message: 'Unknown role', details: [{ path: 'roleKey', message: 'Unknown role' }] });
    await this.assertCanGrant(actor, role);
    if ((await this.targetHasPrivilegedRole(userId)) && !actor.hasGlobal('role.manage')) throw new ForbiddenException('Only a super admin can change an administrator’s roles');

    let organizationId = input.organizationId ?? null;
    if (role.scope === 'ORGANIZATION') {
      if (!organizationId) throw new BadRequestException({ message: 'Choose the organisation this role applies to', details: [{ path: 'organizationId', message: 'Required for organisation roles' }] });
      const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
      if (!membership || membership.status !== 'ACTIVE') throw new ConflictException('The user must be an active member of that organisation');
    } else if (organizationId) {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
      if (!org || org.type !== 'PLATFORM') throw new BadRequestException({ message: 'Platform roles apply platform-wide or to the company organisation only', details: [{ path: 'organizationId', message: 'Invalid scope' }] });
    }
    if (PRIVILEGED_ROLES.has(role.key)) organizationId = null; // administrator roles are always platform-wide
    const dup = await this.prisma.userRole.findFirst({ where: { userId, roleId: role.id, organizationId } });
    if (dup) throw new ConflictException({ message: 'The user already has this role in that scope', code: 'DUPLICATE' });

    const grant = await this.prisma.$transaction(async (tx) => {
      const g = await tx.userRole.create({ data: { userId, roleId: role.id, organizationId, grantedById: actor.id } });
      await this.audit.log({ actorId: actor.id, action: 'user.role.grant', entityType: 'User', entityId: userId, organizationId, after: { role: role.key, organizationId } }, tx);
      return g;
    });
    this.authContext.invalidateUser(userId);
    return grant;
  }

  async revokeRole(actor: AuthUser, userId: string, userRoleId: string) {
    if (userId === actor.id) throw new ForbiddenException('You cannot change your own roles');
    const grant = await this.prisma.userRole.findFirst({ where: { id: userRoleId, userId }, include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } });
    if (!grant) throw new NotFoundException('Role assignment not found');
    await this.assertCanGrant(actor, grant.role);
    if (grant.role.key === 'SUPER_ADMIN') {
      const others = await this.prisma.userRole.count({ where: { role: { key: 'SUPER_ADMIN' }, id: { not: grant.id }, user: { status: 'ACTIVE', deletedAt: null } } });
      if (others === 0) throw new ConflictException('The last super admin cannot be removed');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { id: userRoleId } });
      await this.audit.log({ actorId: actor.id, action: 'user.role.revoke', entityType: 'User', entityId: userId, organizationId: grant.organizationId, before: { role: grant.role.key, organizationId: grant.organizationId } }, tx);
    });
    this.authContext.invalidateUser(userId);
    return { ok: true };
  }

  // ───────────────────────── Roles & permissions ─────────────────────────

  async permissionCatalog() {
    const rows = await this.prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    const groups = new Map<string, { key: string; description: string }[]>();
    for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), { key: r.key, description: r.description }]);
    return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }));
  }

  async roles() {
    const fetched = await this.prisma.role.findMany({
      orderBy: [{ name: 'asc' }],
      include: { permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { userRoles: true } } },
    });
    // System roles first, platform scope before organisation scope, then name.
    const scopeRank = enumRank(RoleScope);
    const rows = [...fetched].sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || scopeRank(a.scope) - scopeRank(b.scope));
    return rows.map(({ permissions, _count, ...r }) => ({ ...r, permissions: permissions.map((p) => p.permission.key), users: _count.userRoles }));
  }

  async role(id: string) {
    const r = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        userRoles: { take: 100, orderBy: { createdAt: 'desc' }, select: { id: true, organizationId: true, organization: { select: { name: true } }, user: { select: { id: true, fullName: true, email: true, status: true } } } },
      },
    });
    if (!r) throw new NotFoundException('Role not found');
    const { permissions, userRoles, ...rest } = r;
    return { ...rest, permissions: permissions.map((p) => p.permission.key), assignments: userRoles };
  }

  private validPermissions(keys: string[]): string[] {
    const unknown = keys.filter((k) => !(PERMISSION_KEYS as string[]).includes(k));
    if (unknown.length) throw new BadRequestException({ message: 'Unknown permissions', details: unknown.map((u) => ({ path: 'permissions', message: u })) });
    return [...new Set(keys)];
  }

  async createRole(actor: AuthUser, input: z.output<typeof roleSchema>) {
    if (await this.prisma.role.findUnique({ where: { key: input.key } })) throw new ConflictException({ message: `A role with key ${input.key} already exists`, code: 'DUPLICATE' });
    const keys = this.validPermissions(input.permissions);
    const perms = await this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.create({ data: { key: input.key, name: input.name, description: input.description ?? null, scope: input.scope, isSystem: false } });
      if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })) });
      await this.audit.log({ actorId: actor.id, action: 'role.create', entityType: 'Role', entityId: r.id, after: { key: r.key, scope: r.scope, permissions: keys } }, tx);
      return r;
    });
    return this.role(role.id);
  }

  async updateRole(actor: AuthUser, id: string, input: z.output<typeof roleUpdateSchema>) {
    const before = await this.role(id);
    if (before.isSystem) throw new ConflictException({ message: 'System roles are read-only — create a custom role instead', code: 'SYSTEM_ROLE' });
    const keys = input.permissions ? this.validPermissions(input.permissions) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
      if (keys) {
        const perms = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
      }
      await this.audit.log({ actorId: actor.id, action: 'role.update', entityType: 'Role', entityId: id, before: { name: before.name, permissions: before.permissions }, after: { name: input.name ?? before.name, permissions: keys ?? before.permissions } }, tx);
    });
    this.authContext.clear(); // permission sets of every holder changed
    return this.role(id);
  }

  async deleteRole(actor: AuthUser, id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { userRoles: true } } } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ConflictException({ message: 'System roles cannot be deleted', code: 'SYSTEM_ROLE' });
    if (role._count.userRoles > 0) throw new ConflictException({ message: `Remove this role from ${role._count.userRoles} user(s) first`, code: 'ROLE_IN_USE' });
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.log({ actorId: actor.id, action: 'role.delete', entityType: 'Role', entityId: id, before: { key: role.key, name: role.name } }, tx);
    });
    return { ok: true };
  }
}
