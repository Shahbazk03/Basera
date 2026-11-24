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

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt < new Date()) {
      this.cache.delete(sessionId);
      return null;
    }
    const user = await this.buildUser(userId, sessionId);
    if (user) this.cache.set(sessionId, { user, expires: Date.now() + TTL_MS });
    return user;
  }

  async buildUser(userId: string, sessionId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } },
        memberships: {
          where: { status: 'ACTIVE' },
          include: { organization: { select: { id: true, name: true, slug: true, type: true, status: true, verificationStatus: true, deletedAt: true } } },
        },
        employee: { select: { id: true, employmentStatus: true, deletedAt: true } },
      },
    });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;

    const roles: RoleGrant[] = user.userRoles.map((ur) => ({
      key: ur.role.key,
      name: ur.role.name,
      organizationId: ur.organizationId,
      permissions: ur.role.permissions.map((rp) => rp.permission.key as PermissionKey),
    }));
    const memberships: SessionMembership[] = user.memberships
      .filter((m) => !m.organization.deletedAt)
      .map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        organizationType: m.organization.type,
        organizationStatus: m.organization.status,
        verificationStatus: m.organization.verificationStatus,
        isOwner: m.isOwner,
        title: m.title,
      }));
    const employeeActive = user.employee && !user.employee.deletedAt && user.employee.employmentStatus !== 'EXITED';

    return new AuthUser(
      user.id,
      sessionId,
      user.fullName,
      user.email,
      user.phone,
      user.accountType,
      roles,
      memberships,
      employeeActive ? user.employee!.id : null,
      await this.platformOrganizationId(),
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
