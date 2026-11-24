import { ForbiddenException } from '@nestjs/common';
import type { PermissionKey, SessionMembership, WorkspaceKey } from '@estate/shared';
import type { AccountType } from '@prisma/client';

export interface RoleGrant {
  key: string;
  name: string;
  organizationId: string | null;
  permissions: PermissionKey[];
}

/**
 * The authenticated principal for one request. Permission checks are scope-aware:
 *  • a grant with organizationId = null applies to every organisation (platform-wide);
 *  • otherwise it applies only to resources owned by that organisation.
 */
export class AuthUser {
  readonly global: Set<PermissionKey>;
  readonly byOrg: Map<string, Set<PermissionKey>>;

  constructor(
    readonly id: string,
    readonly sessionId: string,
    readonly fullName: string,
    readonly email: string | null,
    readonly phone: string | null,
    readonly accountType: AccountType,
    readonly roles: RoleGrant[],
    readonly memberships: SessionMembership[],
    readonly employeeId: string | null,
    readonly platformOrganizationId: string | null,
    readonly mustChangePassword: boolean = false,
  ) {
    this.global = new Set();
    this.byOrg = new Map();
    for (const r of roles) {
      if (r.organizationId === null) r.permissions.forEach((p) => this.global.add(p));
      else {
        const set = this.byOrg.get(r.organizationId) ?? new Set<PermissionKey>();
        r.permissions.forEach((p) => set.add(p));
        this.byOrg.set(r.organizationId, set);
      }
    }
  }

  /** True when the user holds `permission` for the given organisation (or anywhere when omitted). */
  can(permission: PermissionKey, organizationId?: string | null): boolean {
    if (this.global.has(permission)) return true;
    if (organizationId) return this.byOrg.get(organizationId)?.has(permission) ?? false;
    for (const perms of this.byOrg.values()) if (perms.has(permission)) return true;
    return false;
  }

  /** Throws 403 unless `can()` holds. */
  assert(permission: PermissionKey, organizationId?: string | null, message?: string): void {
    if (!this.can(permission, organizationId)) {
      throw new ForbiddenException(message ?? 'You do not have permission to perform this action');
    }
  }

  /** 'ALL' for platform-wide grants, otherwise the organisation ids where the permission is held. */
  orgsWith(permission: PermissionKey): 'ALL' | string[] {
    if (this.global.has(permission)) return 'ALL';
    const ids: string[] = [];
    for (const [orgId, perms] of this.byOrg) if (perms.has(permission)) ids.push(orgId);
    return ids;
  }

  hasGlobal(permission: PermissionKey): boolean {
    return this.global.has(permission);
  }

  isMemberOf(organizationId: string): boolean {
    return this.memberships.some((m) => m.organizationId === organizationId);
  }

  get permissionGrants(): { global: PermissionKey[]; byOrganization: Record<string, PermissionKey[]> } {
    const byOrganization: Record<string, PermissionKey[]> = {};
    for (const [orgId, perms] of this.byOrg) byOrganization[orgId] = [...perms];
    return { global: [...this.global], byOrganization };
  }

  /** Which console workspaces this user can open. */
  get workspaces(): WorkspaceKey[] {
    const ws = new Set<WorkspaceKey>();
    // Only genuinely administrative powers open the "Administration" workspace; selling or viewing
    // permissions (all leads, all projects) belong to the staff portal.
    const adminPerms: PermissionKey[] = [
      'property.approve',
      'broker.verify',
      'developer.verify',
      'project.approve',
      'user.manage',
      'settings.manage',
      'finance.view',
      'employee.manage',
      'payroll.view',
      'cms.manage',
    ];
    const platformPerms = this.platformOrganizationId ? this.byOrg.get(this.platformOrganizationId) : undefined;
    if (adminPerms.some((p) => this.global.has(p) || platformPerms?.has(p))) ws.add('admin');
    // Staff portal: employees, and platform-organisation members without an employee record.
    if (this.employeeId || (!ws.has('admin') && (this.global.size > 0 || (platformPerms?.size ?? 0) > 0))) ws.add('staff');
    for (const m of this.memberships) {
      if (m.organizationType === 'BROKERAGE') ws.add('broker');
      if (m.organizationType === 'DEVELOPER') ws.add('developer');
      if (m.organizationType === 'LEAD_PROVIDER') ws.add('lead-provider');
      if (m.organizationType === 'INDIVIDUAL_OWNER') ws.add('owner');
    }
    return [...ws];
  }
}
