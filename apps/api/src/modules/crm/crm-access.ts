import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PermissionKey } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { AuthUser } from '../../common/auth/auth-user';
import type { Db } from '../../prisma/prisma.service';

export const OPEN_LEAD_WHERE: Prisma.LeadWhereInput = {
  status: { notIn: ['CONVERTED', 'LOST'] },
  deletedAt: null,
  isDuplicate: false,
  intakeStatus: { notIn: ['REJECTED', 'DUPLICATE'] },
};

const NO_ROWS = { id: { in: [] as string[] } };

/** Leads the user may see: whole organisations (lead.view_all) plus leads assigned to them (lead.view_assigned). */
export function leadScope(user: AuthUser): Prisma.LeadWhereInput {
  const all = user.orgsWith('lead.view_all');
  if (all === 'ALL') return {};
  const or: Prisma.LeadWhereInput[] = [];
  if (all.length) or.push({ organizationId: { in: all } });
  if (user.can('lead.view_assigned')) or.push({ assignedToId: user.id });
  return or.length ? { OR: or } : NO_ROWS;
}

export function canViewLead(user: AuthUser, lead: { organizationId: string; assignedToId: string | null }): boolean {
  return user.can('lead.view_all', lead.organizationId) || (lead.assignedToId === user.id && user.can('lead.view_assigned'));
}

export function canEditLead(user: AuthUser, lead: { organizationId: string; assignedToId: string | null }): boolean {
  return user.can('lead.edit', lead.organizationId) && canViewLead(user, lead);
}

export function assertLeadAccess(user: AuthUser, lead: { organizationId: string; assignedToId: string | null } | null, mode: 'view' | 'edit' = 'view') {
  if (!lead || !canViewLead(user, lead)) throw new NotFoundException('Lead not found');
  if (mode === 'edit' && !canEditLead(user, lead)) throw new ForbiddenException('You cannot update this lead');
}

/** Organisation scope for a permission as a Prisma filter on `organizationId`. */
export function orgScope(user: AuthUser, permission: PermissionKey): { organizationId?: { in: string[] } } {
  const orgs = user.orgsWith(permission);
  return orgs === 'ALL' ? {} : { organizationId: { in: orgs } };
}

/**
 * Picks the organisation a CRM record is created in: an explicit (authorised) id, the platform org
 * for platform staff, or the user's single partner organisation.
 */
export function resolveOrg(user: AuthUser, permission: PermissionKey, requested?: string | null): string {
  if (requested) {
    user.assert(permission, requested, 'You cannot work in this organisation');
    return requested;
  }
  if (user.platformOrganizationId && user.can(permission, user.platformOrganizationId) && (user.hasGlobal(permission) || user.isMemberOf(user.platformOrganizationId))) {
    return user.platformOrganizationId;
  }
  const candidates = user.memberships.filter((m) => user.can(permission, m.organizationId));
  if (candidates.length === 1) return candidates[0].organizationId;
  if (!candidates.length) throw new ForbiddenException('You do not have permission to perform this action');
  throw new BadRequestException({ message: 'Choose the organisation', details: [{ path: 'organizationId', message: 'Required' }] });
}

/** Active members of an organisation who can work leads (assignable). */
export async function assignableUsers(db: Db, organizationId: string): Promise<{ id: string; fullName: string; email: string | null }[]> {
  return db.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      memberships: { some: { organizationId, status: 'ACTIVE' } },
      userRoles: {
        some: {
          OR: [{ organizationId: null }, { organizationId }],
          role: { permissions: { some: { permission: { key: { in: ['lead.edit', 'lead.view_assigned'] } } } } },
        },
      },
    },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: 'asc' },
  });
}

export async function isAssignable(db: Db, organizationId: string, userId: string): Promise<boolean> {
  const rows = await assignableUsers(db, organizationId);
  return rows.some((u) => u.id === userId);
}

export const leadListSelect = {
  id: true,
  leadNo: true,
  name: true,
  phone: true,
  email: true,
  status: true,
  priority: true,
  intakeStatus: true,
  isDuplicate: true,
  enquiryType: true,
  listingType: true,
  budgetMin: true,
  budgetMax: true,
  nextFollowUpAt: true,
  lastContactedAt: true,
  createdAt: true,
  updatedAt: true,
  isDemo: true,
  organization: { select: { id: true, name: true, type: true } },
  source: { select: { key: true, name: true } },
  assignedTo: { select: { id: true, fullName: true } },
  project: { select: { id: true, name: true, slug: true } },
  property: { select: { id: true, title: true, referenceCode: true, slug: true } },
  unit: { select: { id: true, code: true } },
  leadProvider: { select: { id: true, name: true } },
} satisfies Prisma.LeadSelect;

/** Customer-facing subject line for a lead/enquiry. */
export function subjectOf(x: { property?: { title: string } | null; project?: { name: string } | null; unit?: { code: string } | null }): string {
  if (x.property) return x.property.title;
  if (x.project) return x.unit ? `${x.project.name} — unit ${x.unit.code}` : x.project.name;
  return 'your property requirement';
}
