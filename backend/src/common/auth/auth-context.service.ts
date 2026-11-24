import { Injectable } from '@nestjs/common';
import type { PermissionKey, SessionMembership } from '@estate/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser, RoleGrant } from './auth-user';

const TTL_MS = 15_000;

/**
 * Loads the principal (user + scoped permission grants) for a session. Results are cached for a
 * few seconds; any role/membership change calls invalidateUser() so updates apply immediately on
 * this instance (and within TTL_MS on others).
 */
@Injectable()
export class AuthContextService {
  private readonly cache = new Map<string, { user: AuthUser; expires: number }>();
  private platformOrgId: { value: string | null; expires: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async platformOrganizationId(): Promise<string | null> {
    if (this.platformOrgId && this.platformOrgId.expires > Date.now()) return this.platformOrgId.value;
    const org = await this.prisma.organization.findFirst({ where: { type: 'PLATFORM', deletedAt: null }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    this.platformOrgId = { value: org?.id ?? null, expires: Date.now() + 300_000 };
    return org?.id ?? null;
  }

  async load(userId: string, sessionId: string): Promise<AuthUser | null> {
    const hit = this.cache.get(sessionId);
    if (hit && hit.expires > Date.now() && hit.user.id === userId) return hit.user;

    // The session check and the principal's queries run at the same time; the principal is used only
    // when the session is valid.
    const [session, user] = await Promise.all([
      this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { userId: true, revokedAt: true, expiresAt: true },
      }),
      this.buildUser(userId, sessionId),
    ]);
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt < new Date()) {
      this.cache.delete(sessionId);
      return null;
    }
    if (user) this.cache.set(sessionId, { user, expires: Date.now() + TTL_MS });
    return user;
  }

  /**
   * Builds the principal in three rounds of parallel queries. (Including the relations instead makes
   * Prisma's MongoDB connector load them one after another — about nine database round trips, which
   * every request paid whenever the cache had expired.) Records that a link points to but that no
   * longer exist grant nothing.
   */
  async buildUser(userId: string, sessionId: string): Promise<AuthUser | null> {
    const [user, userRoles, memberRows, employee, platformOrganizationId] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, email: true, phone: true, accountType: true, status: true, deletedAt: true, mustChangePassword: true },
      }),
      this.prisma.userRole.findMany({ where: { userId }, select: { roleId: true, organizationId: true } }),
      this.prisma.organizationMember.findMany({ where: { userId, status: 'ACTIVE' }, select: { organizationId: true, isOwner: true, title: true } }),
      this.prisma.employee.findUnique({ where: { userId }, select: { id: true, employmentStatus: true, deletedAt: true } }),
      this.platformOrganizationId(),
    ]);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;

    const roleIds = [...new Set(userRoles.map((ur) => ur.roleId))];
    const orgIds = [...new Set(memberRows.map((m) => m.organizationId))];
    const [roleRows, rolePermissions, organizations] = await Promise.all([
      roleIds.length ? this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, key: true, name: true } }) : [],
      roleIds.length ? this.prisma.rolePermission.findMany({ where: { roleId: { in: roleIds } }, select: { roleId: true, permissionId: true } }) : [],
      orgIds.length
        ? this.prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true, slug: true, type: true, status: true, verificationStatus: true, deletedAt: true },
          })
        : [],
    ]);
    const permissionIds = [...new Set(rolePermissions.map((rp) => rp.permissionId))];
    const permissionRows = permissionIds.length ? await this.prisma.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, key: true } }) : [];

    const roleById = new Map(roleRows.map((r) => [r.id, r]));
    const keyById = new Map(permissionRows.map((p) => [p.id, p.key as PermissionKey]));
    const roles: RoleGrant[] = userRoles.flatMap((ur) => {
      const role = roleById.get(ur.roleId);
      if (!role) return [];
      const permissions = rolePermissions.filter((rp) => rp.roleId === ur.roleId).flatMap((rp) => keyById.get(rp.permissionId) ?? []);
      return [{ key: role.key, name: role.name, organizationId: ur.organizationId, permissions }];
    });
    const orgById = new Map(organizations.map((o) => [o.id, o]));
    const memberships: SessionMembership[] = memberRows.flatMap((m) => {
      const org = orgById.get(m.organizationId);
      if (!org || org.deletedAt) return [];
      return [
        {
          organizationId: org.id,
          organizationName: org.name,
          organizationSlug: org.slug,
          organizationType: org.type,
          organizationStatus: org.status,
          verificationStatus: org.verificationStatus,
          isOwner: m.isOwner,
          title: m.title,
        },
      ];
    });
    const employeeActive = employee && !employee.deletedAt && employee.employmentStatus !== 'EXITED';

    return new AuthUser(
      user.id,
      sessionId,
      user.fullName,
      user.email,
      user.phone,
      user.accountType,
      roles,
      memberships,
      employeeActive ? employee.id : null,
      platformOrganizationId,
      user.mustChangePassword,
    );
  }

  invalidateUser(userId: string): void {
    for (const [key, entry] of this.cache) if (entry.user.id === userId) this.cache.delete(key);
  }

  invalidateSession(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  clear(): void {
    this.cache.clear();
    this.platformOrgId = null;
  }
}
