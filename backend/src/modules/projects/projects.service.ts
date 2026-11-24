import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BOOKABLE_PROJECT_STATUSES,
  canTransitionProject,
  computeProjectStatus,
  defaultProjectPage,
  MANUAL_ONLY_PROJECT_STATUSES,
  PROJECT_STATUS_TRANSITIONS,
  SALES_PROJECT_STATUSES,
  slugify,
  type ProjectStatus,
} from '@estate/shared';
import type { z } from 'zod';
import type {
  constructionUpdateSchema,
  projectBaseSchema,
  projectDocumentSchema,
  projectFaqSchema,
  projectNearbySchema,
  projectTeamMemberSchema,
} from '@estate/shared';
import { Prisma, MediaType } from '@prisma/client';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { env } from '../../config/env';
import { dateOnly, paginated, Pagination, skipTake } from '../../common/http';
import { uniqueSlug } from '../../common/references';
import { NotificationsService } from '../notifications/notifications.service';
import { FilesService } from '../files/files.service';
import { unitStatsFor, type UnitStats } from './project-card';
import { sortByEnum } from '../../common/ordering';

type ProjectInput = z.output<typeof projectBaseSchema>;

export interface ProjectListQuery extends Pagination {
  status?: ProjectStatus;
  review?: 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  q?: string;
  organizationId?: string;
  published?: boolean;
}

export interface ProjectMediaItem {
  type?: 'IMAGE' | 'VIDEO' | 'FLOOR_PLAN' | 'MASTER_PLAN';
  fileId?: string;
  url?: string;
  caption?: string | null;
}

const PROJECT_ORG_TYPES = new Set(['PLATFORM', 'DEVELOPER']);
/** Statuses that are derived from the booking window when automatic status is on. */
const DERIVED_STATUSES: ProjectStatus[] = ['BOOKING_OPEN', 'CLOSING_SOON', 'SOLD_OUT', 'CLOSED'];

const manageListSelect = {
  id: true,
  slug: true,
  name: true,
  projectType: true,
  status: true,
  autoStatus: true,
  bookingOpensAt: true,
  bookingClosesAt: true,
  closingSoonHours: true,
  reviewStatus: true,
  isPublished: true,
  publishedAt: true,
  isFeatured: true,
  isDemo: true,
  heroImageUrl: true,
  updatedAt: true,
  city: { select: { name: true } },
  locality: { select: { name: true } },
  organization: { select: { id: true, name: true, type: true, status: true } },
  developerOrg: { select: { id: true, name: true } },
} satisfies Prisma.ProjectSelect;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  // ───────────────────────── Access helpers ─────────────────────────

  canView(user: AuthUser, p: { organizationId: string; developerOrgId: string | null }): boolean {
    return (
      user.can('project.view_all', p.organizationId) ||
      user.can('project.approve', p.organizationId) ||
      Boolean(p.developerOrgId && user.can('project.view_all', p.developerOrgId))
    );
  }

  /** Publishing is allowed for project.publish holders, or for editors of organisations configured for direct publishing. */
  canPublish(user: AuthUser, p: { organizationId: string; organization: { projectPublishMode: string } }): boolean {
    return user.can('project.publish', p.organizationId) || (p.organization.projectPublishMode === 'DIRECT' && user.can('project.edit', p.organizationId));
  }

  async loadForAccess(user: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: { organization: { select: { id: true, name: true, type: true, status: true, projectPublishMode: true } } },
    });
    if (!p || !this.canView(user, p)) throw new NotFoundException('Project not found');
    return p;
  }

  scopeWhere(user: AuthUser): Prisma.ProjectWhereInput | null {
    const view = user.orgsWith('project.view_all');
    const approve = user.orgsWith('project.approve');
    if (view === 'ALL' || approve === 'ALL') return {};
    const orgs = [...new Set([...view, ...approve])];
    if (!orgs.length) return null;
    return { OR: [{ organizationId: { in: orgs } }, { developerOrgId: { in: view as string[] } }] };
  }

  // ───────────────────────── Status ─────────────────────────

  async stats(db: Db, projectId: string): Promise<UnitStats> {
    return (await unitStatsFor(db, [projectId])).get(projectId) ?? { available: 0, released: 0, total: 0, priceMin: null, priceMax: null, types: [] };
  }

  async effectiveStatus(db: Db, p: { id: string; status: ProjectStatus; autoStatus: boolean; bookingOpensAt: Date | null; bookingClosesAt: Date | null; closingSoonHours: number }, now = new Date()): Promise<ProjectStatus> {
    const s = await this.stats(db, p.id);
    return computeProjectStatus({ ...p, availableUnits: s.available, releasedUnits: s.released }, now);
  }

  /**
   * Persists the server-derived status (booking window + inventory). Safe to call repeatedly; returns the
   * new status when it changed. The database is the source of truth for project availability.
   */
  async syncStatus(projectId: string, db: Db = this.prisma, actorId: string | null = null, now = new Date()): Promise<{ from: ProjectStatus; to: ProjectStatus } | null> {
    const p = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, autoStatus: true, bookingOpensAt: true, bookingClosesAt: true, closingSoonHours: true, deletedAt: true },
    });
    if (!p || p.deletedAt || !p.autoStatus || MANUAL_ONLY_PROJECT_STATUSES.includes(p.status)) return null;
    const next = await this.effectiveStatus(db, p, now);
    if (next === p.status) return null;
    const res = await db.project.updateMany({ where: { id: projectId, status: p.status }, data: { status: next } });
    if (!res.count) return null;
    await db.projectStatusHistory.create({
      data: { projectId, fromStatus: p.status, toStatus: next, changedById: actorId, reason: actorId ? 'Derived after an inventory or schedule change' : 'Automatic: booking window / inventory' },
    });
    return { from: p.status, to: next };
  }

  async notifyStatusChange(projectId: string, to: ProjectStatus) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, createdById: true, team: { select: { userId: true } } } });
    if (!p) return;
    const ids = [...new Set([...p.team.map((t) => t.userId), ...(p.createdById ? [p.createdById] : [])])];
    const recipients = (await Promise.all(ids.map((id) => this.notifications.userRecipient(id)))).filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (!recipients.length) return;
    await this.notifications.send({
      eventKey: 'project.status_changed',
      recipients,
      channels: ['IN_APP'],
      data: { projectName: p.name, status: to.replace(/_/g, ' ').toLowerCase() },
      link: `/projects/${p.id}`,
      relatedType: 'Project',
      relatedId: p.id,
    });
  }

  // ───────────────────────── List / get ─────────────────────────

  async list(user: AuthUser, q: ProjectListQuery) {
    const scope = this.scopeWhere(user);
    if (!scope) return { ...paginated([], 0, q), statusCounts: {}, reviewCounts: {} };
    const base: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...scope,
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.published !== undefined ? { isPublished: q.published } : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' } },
                  { slug: { contains: q.q.toLowerCase() } },
                  { locality: { name: { contains: q.q, mode: 'insensitive' } } },
                  { reraNumber: { contains: q.q, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    };
    const where: Prisma.ProjectWhereInput = { ...base, ...(q.status ? { status: q.status } : {}), ...(q.review ? { reviewStatus: q.review } : {}) };
    const [rows, total, statusCounts, reviewCounts] = await Promise.all([
      this.prisma.project.findMany({ where, select: manageListSelect, orderBy: q.review === 'PENDING_REVIEW' ? { updatedAt: 'asc' } : { updatedAt: 'desc' }, ...skipTake(q) }),
      this.prisma.project.count({ where }),
      this.prisma.project.groupBy({ by: ['status'], where: { ...base, ...(q.review ? { reviewStatus: q.review } : {}) }, _count: { _all: true } }),
      this.prisma.project.groupBy({ by: ['reviewStatus'], where: base, _count: { _all: true } }),
    ]);
    const stats = await unitStatsFor(this.prisma, rows.map((r) => r.id));
    const now = new Date();
    const data = rows.map((r) => {
      const s = stats.get(r.id);
      return {
        ...r,
        computedStatus: computeProjectStatus({ ...r, availableUnits: s?.available ?? 0, releasedUnits: s?.released ?? 0 }, now),
        units: { available: s?.available ?? 0, total: s?.total ?? 0 },
      };
    });
    return {
      ...paginated(data, total, q),
      statusCounts: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
      reviewCounts: Object.fromEntries(reviewCounts.map((c) => [c.reviewStatus, c._count._all])),
    };
  }

  async getForManage(user: AuthUser, id: string) {
    const base = await this.loadForAccess(user, id);
    const p = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        city: { select: { id: true, name: true, slug: true } },
        locality: { select: { id: true, name: true, slug: true } },
        organization: { select: { id: true, name: true, type: true, status: true, projectPublishMode: true } },
        developerOrg: { select: { id: true, name: true, slug: true } },
        createdBy: { select: { id: true, fullName: true } },
        media: { orderBy: [{ sortOrder: 'asc' }] }, // grouped by type below
        documents: { orderBy: { sortOrder: 'asc' }, include: { file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } } } },
        amenities: { select: { amenityId: true } },
        nearbyPlaces: { orderBy: { sortOrder: 'asc' } },
        faqs: { orderBy: { sortOrder: 'asc' } },
        constructionUpdates: { orderBy: { updateDate: 'desc' } },
        team: { include: { user: { select: { id: true, fullName: true, email: true, phone: true } } }, orderBy: { createdAt: 'asc' } },
        blocks: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { units: true } } } },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 50, include: { changedBy: { select: { fullName: true } } } },
        page: { select: { revision: true, publishedAt: true, draftUpdatedAt: true } },
        _count: { select: { domains: true, units: true, enquiries: true, leads: true } },
      },
    });
    const stats = await this.stats(this.prisma, id);
    const byStatus = await this.prisma.projectUnit.groupBy({ by: ['status'], where: { projectId: id }, _count: { _all: true } });
    const computedStatus = computeProjectStatus({ ...p, availableUnits: stats.available, releasedUnits: stats.released });
    const canEdit = user.can('project.edit', p.organizationId);
    const autoLocked = p.autoStatus && Boolean(p.bookingOpensAt);
    const statusTargets = canEdit
      ? PROJECT_STATUS_TRANSITIONS[p.status].filter((s) => !(autoLocked && DERIVED_STATUSES.includes(s)))
      : [];
    return {
      ...p,
      media: sortByEnum(p.media, (m) => m.type, MediaType),
      amenityIds: p.amenities.map((a) => a.amenityId),
      computedStatus,
      inventory: { ...stats, byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) },
      isBookable: BOOKABLE_PROJECT_STATUSES.includes(computedStatus),
      publicUrl: `${env().WEB_PUBLIC_URL.replace(/\/$/, '')}/projects/${p.slug}`,
      permissions: {
        canEdit,
        canDelete: user.can('project.delete', p.organizationId),
        canApprove: user.can('project.approve', p.organizationId),
        canPublish: this.canPublish(user, base),
        canManageInventory: user.can('project.inventory.manage', p.organizationId),
        canManagePage: user.can('project.page.manage', p.organizationId),
        canManageDomains: user.can('project.domain.manage', p.organizationId),
        canFeature: user.can('project.publish', p.organizationId),
      },
      statusTargets,
      autoStatusLocksDerived: autoLocked,
    };
  }

  // ───────────────────────── Create / update ─────────────────────────

  private async resolveOrganization(user: AuthUser, requested?: string) {
    let orgId = requested;
    if (!orgId) {
      const candidates = user.memberships.filter((m) => PROJECT_ORG_TYPES.has(m.organizationType) && user.can('project.create', m.organizationId));
      const developer = candidates.filter((m) => m.organizationType === 'DEVELOPER');
      if (developer.length === 1) orgId = developer[0].organizationId;
      else if (candidates.length === 1) orgId = candidates[0].organizationId;
      else if (user.hasGlobal('project.create') && user.platformOrganizationId) orgId = user.platformOrganizationId;
      else throw new BadRequestException({ message: 'Choose which organisation manages this project', details: [{ path: 'organizationId', message: 'Required' }] });
    }
    user.assert('project.create', orgId, 'You cannot create projects for this organisation');
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
    if (!org) throw new BadRequestException('Organisation not found');
    if (!PROJECT_ORG_TYPES.has(org.type)) throw new BadRequestException('Only the company or a developer organisation can manage projects');
    return org;
  }

  private async resolveDeveloper(user: AuthUser, org: { id: string; type: string }, requested: string | null | undefined): Promise<string | null> {
    if (org.type === 'DEVELOPER') {
      if (requested && requested !== org.id) throw new ForbiddenException('Developers can only create projects for their own organisation');
      return org.id;
    }
    if (!requested) return null;
    const dev = await this.prisma.organization.findFirst({ where: { id: requested, type: 'DEVELOPER', deletedAt: null }, select: { id: true } });
    if (!dev) throw new BadRequestException({ message: 'Select a valid developer', details: [{ path: 'developerOrgId', message: 'Invalid developer' }] });
    return dev.id;
  }

  private assertImageUrl(user: AuthUser, field: string, url: string | null | undefined) {
    if (!url) return;
    const s3 = env().S3_PUBLIC_BASE_URL;
    const ours = url.startsWith('/uploads/') || (s3 && url.startsWith(s3));
    if (!ours && !user.hasGlobal('project.edit')) {
      throw new BadRequestException({ message: 'Upload images through the uploader (external links are not accepted)', details: [{ path: field, message: 'Use an uploaded image' }] });
    }
  }

  private async validateRefs(user: AuthUser, input: Partial<ProjectInput>) {
    for (const f of ['heroImageUrl', 'logoUrl', 'masterPlanUrl', 'ogImageUrl'] as const) this.assertImageUrl(user, f, input[f] || null);
    if (input.cityId || input.localityId) {
      const locality = await this.prisma.locality.findUnique({ where: { id: input.localityId ?? '' }, include: { city: true } });
      if (!locality || locality.cityId !== input.cityId || !locality.isActive) {
        throw new BadRequestException({ message: 'The locality does not belong to the selected city', details: [{ path: 'localityId', message: 'Invalid locality' }] });
      }
      if (!locality.city.isActive) throw new BadRequestException({ message: 'Projects are not yet accepted in this city', details: [{ path: 'cityId', message: 'City not active' }] });
    }
    if (input.amenityIds?.length) {
      const count = await this.prisma.amenity.count({ where: { id: { in: input.amenityIds }, isActive: true, forProjects: true } });
      if (count !== new Set(input.amenityIds).size) throw new BadRequestException({ message: 'One or more amenities are invalid', details: [{ path: 'amenityIds', message: 'Invalid amenity' }] });
    }
    const opens = input.bookingOpensAt ? new Date(input.bookingOpensAt) : null;
    const closes = input.bookingClosesAt ? new Date(input.bookingClosesAt) : null;
    if (opens && closes && closes <= opens) throw new BadRequestException({ message: 'Booking must close after it opens', details: [{ path: 'bookingClosesAt', message: 'Must be after the opening time' }] });
    if (input.priceMinOverride != null && input.priceMaxOverride != null && input.priceMaxOverride < input.priceMinOverride) {
      throw new BadRequestException({ message: 'Maximum price must be at least the minimum price', details: [{ path: 'priceMaxOverride', message: 'Invalid range' }] });
    }
  }

  private columns(input: Partial<ProjectInput>): Prisma.ProjectUncheckedUpdateInput {
    const { amenityIds: _a, organizationId: _o, developerOrgId: _d, slug: _s, launchDate, possessionDate, reraValidUntil, bookingOpensAt, bookingClosesAt, ...rest } = input;
    const out: Record<string, unknown> = { ...rest };
    for (const k of ['heroImageUrl', 'logoUrl', 'masterPlanUrl', 'ogImageUrl', 'pincode'] as const) if (k in rest) out[k] = (rest as Record<string, unknown>)[k] || null;
    if (launchDate !== undefined) out.launchDate = launchDate ? dateOnly(launchDate) : null;
    if (possessionDate !== undefined) out.possessionDate = possessionDate ? dateOnly(possessionDate) : null;
    if (reraValidUntil !== undefined) out.reraValidUntil = reraValidUntil ? dateOnly(reraValidUntil) : null;
    if (bookingOpensAt !== undefined) out.bookingOpensAt = bookingOpensAt ? new Date(bookingOpensAt) : null;
    if (bookingClosesAt !== undefined) out.bookingClosesAt = bookingClosesAt ? new Date(bookingClosesAt) : null;
    return out as Prisma.ProjectUncheckedUpdateInput;
  }

  async create(user: AuthUser, input: ProjectInput) {
    const org = await this.resolveOrganization(user, input.organizationId);
    const developerOrgId = await this.resolveDeveloper(user, org, input.developerOrgId);
    await this.validateRefs(user, input);
    const city = await this.prisma.city.findUniqueOrThrow({ where: { id: input.cityId } });
    const slug = input.slug
      ? input.slug
      : await uniqueSlug(input.name, async (s) => (await this.prisma.project.count({ where: { slug: s } })) > 0);
    if (input.slug && (await this.prisma.project.count({ where: { slug: input.slug } }))) {
      throw new ConflictException({ message: `The address /projects/${input.slug} is already taken`, details: [{ path: 'slug', message: 'Already in use' }] });
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          ...(this.columns(input) as Prisma.ProjectUncheckedCreateInput),
          slug,
          organizationId: org.id,
          developerOrgId,
          stateId: city.stateId,
          status: 'DRAFT',
          reviewStatus: 'NOT_SUBMITTED',
          createdById: user.id,
          amenities: { create: (input.amenityIds ?? []).map((amenityId) => ({ amenityId })) },
          statusHistory: { create: { fromStatus: null, toStatus: 'DRAFT', changedById: user.id, reason: 'Created' } },
          page: { create: { draftSections: defaultProjectPage() as unknown as Prisma.InputJsonValue } },
        },
      });
      await this.audit.log({ actorId: user.id, action: 'project.create', entityType: 'Project', entityId: p.id, organizationId: org.id, after: { name: p.name, slug: p.slug } }, tx);
      return p;
    });
    return this.getForManage(user, created.id);
  }

  async update(user: AuthUser, id: string, input: Partial<ProjectInput>) {
    const existing = await this.loadForAccess(user, id);
    user.assert('project.edit', existing.organizationId, 'You cannot edit this project');
    if (existing.status === 'ARCHIVED') throw new ConflictException({ message: 'Restore the project before editing it', code: 'PROJECT_ARCHIVED' });
    const merged = {
      cityId: existing.cityId,
      localityId: existing.localityId,
      bookingOpensAt: existing.bookingOpensAt?.toISOString() ?? null,
      bookingClosesAt: existing.bookingClosesAt?.toISOString() ?? null,
      priceMinOverride: existing.priceMinOverride ?? null,
      priceMaxOverride: existing.priceMaxOverride ?? null,
      ...input,
    };
    await this.validateRefs(user, { ...input, cityId: merged.cityId, localityId: merged.localityId, bookingOpensAt: merged.bookingOpensAt, bookingClosesAt: merged.bookingClosesAt, priceMinOverride: merged.priceMinOverride, priceMaxOverride: merged.priceMaxOverride });
    let developerOrgId: string | null | undefined;
    if (input.developerOrgId !== undefined) developerOrgId = await this.resolveDeveloper(user, existing.organization, input.developerOrgId);
    if (input.slug && input.slug !== existing.slug) {
      if (existing.isPublished) throw new ConflictException({ message: 'The web address cannot change while the project is published', details: [{ path: 'slug', message: 'Unpublish first' }] });
      if (await this.prisma.project.count({ where: { slug: input.slug, id: { not: id } } })) throw new ConflictException({ message: 'This web address is already taken', details: [{ path: 'slug', message: 'Already in use' }] });
    }
    const city = input.cityId ? await this.prisma.city.findUniqueOrThrow({ where: { id: input.cityId } }) : null;
    let change: { from: ProjectStatus; to: ProjectStatus } | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: {
          ...this.columns(input),
          ...(input.slug ? { slug: input.slug } : {}),
          ...(developerOrgId !== undefined ? { developerOrgId } : {}),
          ...(city ? { stateId: city.stateId } : {}),
        },
      });
      if (input.amenityIds) {
        await tx.projectAmenity.deleteMany({ where: { projectId: id } });
        await tx.projectAmenity.createMany({ data: input.amenityIds.map((amenityId) => ({ projectId: id, amenityId })) });
      }
      await this.audit.log({ actorId: user.id, action: 'project.update', entityType: 'Project', entityId: id, organizationId: existing.organizationId, after: input }, tx);
      // Booking window or automatic-status changes take effect immediately.
      change = await this.syncStatus(id, tx, user.id);
    });
    if (change) await this.notifyStatusChange(id, (change as { to: ProjectStatus }).to);
    return this.getForManage(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.delete', p.organizationId);
    if (p.isPublished) throw new ConflictException('Unpublish the project before deleting it');
    const deals = await this.prisma.deal.count({ where: { projectId: id, status: { not: 'CANCELLED' } } });
    if (deals) throw new ConflictException('This project has bookings — archive it instead of deleting it');
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { deletedAt: new Date(), isFeatured: false } });
      // Release the project's hostnames so they can be mapped again.
      const domains = await tx.projectDomain.findMany({ where: { projectId: id }, select: { hostname: true } });
      await tx.projectDomain.deleteMany({ where: { projectId: id } });
      await this.audit.log({ actorId: user.id, action: 'project.delete', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: { name: p.name, domains: domains.map((d) => d.hostname) } }, tx);
    });
    return { ok: true };
  }

  // ───────────────────────── Review & publication ─────────────────────────

  async submitForReview(user: AuthUser, id: string) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId);
    if (!['NOT_SUBMITTED', 'REJECTED'].includes(p.reviewStatus)) throw new ConflictException({ message: `The project is already ${p.reviewStatus.replace('_', ' ').toLowerCase()}`, code: 'INVALID_REVIEW_STATE' });
    const images = await this.prisma.projectMedia.count({ where: { projectId: id, type: 'IMAGE' } });
    if (!p.heroImageUrl && images === 0) throw new ConflictException({ message: 'Add a hero image or at least one photo before submitting for review', code: 'PHOTOS_REQUIRED' });
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { reviewStatus: 'PENDING_REVIEW', reviewNote: null } });
      await this.audit.log({ actorId: user.id, action: 'project.review.submit', entityType: 'Project', entityId: id, organizationId: p.organizationId }, tx);
    });
    const reviewers = await this.notifications.recipientsWithPermission('project.approve', p.organizationId);
    await this.notifications.send({ eventKey: 'project.review', recipients: reviewers, channels: ['IN_APP'], data: { projectName: p.name }, link: `/projects/${id}`, relatedType: 'Project', relatedId: id });
    return this.getForManage(user, id);
  }

  async decide(user: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', note?: string, publish?: boolean) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.approve', p.organizationId, 'Only a reviewer can approve or reject projects');
    if (p.reviewStatus !== 'PENDING_REVIEW') throw new ConflictException({ message: 'Only projects awaiting review can be approved or rejected', code: 'INVALID_REVIEW_STATE' });
    if (decision === 'REJECT' && !note?.trim()) throw new BadRequestException({ message: 'Explain what needs to change', details: [{ path: 'note', message: 'Required' }] });
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { reviewStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewNote: note?.trim() || null } });
      await this.audit.log({ actorId: user.id, action: `project.review.${decision.toLowerCase()}`, entityType: 'Project', entityId: id, organizationId: p.organizationId, metadata: note ? { note } : undefined }, tx);
    });
    if (p.createdById) {
      const r = await this.notifications.userRecipient(p.createdById);
      if (r) {
        await this.notifications.send({
          eventKey: 'project.status_changed',
          recipients: [r],
          channels: ['IN_APP'],
          data: { projectName: p.name, status: decision === 'APPROVE' ? 'approved for publishing' : `returned with changes requested — ${note}` },
          link: `/projects/${id}`,
          relatedType: 'Project',
          relatedId: id,
        });
      }
    }
    if (decision === 'APPROVE' && publish) return this.setPublished(user, id, true);
    return this.getForManage(user, id);
  }

  async setPublished(user: AuthUser, id: string, publish: boolean) {
    const p = await this.loadForAccess(user, id);
    if (!this.canPublish(user, p)) throw new ForbiddenException('You cannot change the publication of this project');
    if (publish) {
      if (p.organization.status !== 'ACTIVE') throw new ConflictException({ message: `${p.organization.name} is not verified yet — its projects cannot be published`, code: 'ORGANIZATION_NOT_ACTIVE' });
      if (p.status === 'ARCHIVED') throw new ConflictException('Archived projects cannot be published');
      if (p.organization.projectPublishMode !== 'DIRECT' && p.reviewStatus !== 'APPROVED') {
        throw new ConflictException({ message: 'The project must be approved by the review team before it can be published', code: 'REVIEW_REQUIRED' });
      }
      const images = await this.prisma.projectMedia.count({ where: { projectId: id, type: 'IMAGE' } });
      if (!p.heroImageUrl && images === 0) throw new ConflictException({ message: 'Add a hero image or at least one photo before publishing', code: 'PHOTOS_REQUIRED' });
    }
    let change: { from: ProjectStatus; to: ProjectStatus } | null = null;
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ProjectUncheckedUpdateInput = publish
        ? { isPublished: true, publishedAt: p.publishedAt ?? new Date(), ...(p.organization.projectPublishMode === 'DIRECT' && p.reviewStatus !== 'APPROVED' ? { reviewStatus: 'APPROVED', reviewNote: 'Published directly (organisation allowed to publish without review)' } : {}) }
        : { isPublished: false, isFeatured: false };
      await tx.project.update({ where: { id }, data });
      if (publish && p.status === 'DRAFT') {
        await tx.project.update({ where: { id }, data: { status: 'UPCOMING' } });
        await tx.projectStatusHistory.create({ data: { projectId: id, fromStatus: 'DRAFT', toStatus: 'UPCOMING', changedById: user.id, reason: 'Published' } });
        change = { from: 'DRAFT', to: 'UPCOMING' };
      }
      if (publish) {
        const page = await tx.projectPage.findUnique({ where: { projectId: id } });
        if (page && page.publishedSections === null) {
          // First publication: the current draft becomes the live page.
          await tx.projectPage.update({ where: { projectId: id }, data: { publishedSections: page.draftSections as Prisma.InputJsonValue, publishedAt: new Date(), publishedById: user.id, revision: { increment: 1 } } });
          await tx.projectPageRevision.create({ data: { projectId: id, revision: page.revision + 1, sections: page.draftSections as Prisma.InputJsonValue, publishedById: user.id } });
        }
        const derived = await this.syncStatus(id, tx, user.id);
        if (derived) change = derived;
      }
      await this.audit.log({ actorId: user.id, action: publish ? 'project.publish' : 'project.unpublish', entityType: 'Project', entityId: id, organizationId: p.organizationId }, tx);
    });
    if (change) await this.notifyStatusChange(id, (change as { to: ProjectStatus }).to);
    return this.getForManage(user, id);
  }

  async setFeatured(user: AuthUser, id: string, featured: boolean) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.publish', p.organizationId);
    if (featured && !p.isPublished) throw new ConflictException('Only published projects can be featured');
    await this.prisma.project.update({ where: { id }, data: { isFeatured: featured } });
    await this.audit.log({ actorId: user.id, action: 'project.feature', entityType: 'Project', entityId: id, organizationId: p.organizationId, after: { isFeatured: featured } });
    return this.getForManage(user, id);
  }

  async changeStatus(user: AuthUser, id: string, to: ProjectStatus, reason?: string) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId, 'You cannot change the status of this project');
    if (p.status === to) throw new ConflictException(`The project is already ${to.replace(/_/g, ' ').toLowerCase()}`);
    if (!canTransitionProject(p.status, to)) {
      throw new ConflictException({ message: `A ${p.status.replace(/_/g, ' ').toLowerCase()} project cannot move to ${to.replace(/_/g, ' ').toLowerCase()}`, code: 'INVALID_TRANSITION' });
    }
    if (p.autoStatus && p.bookingOpensAt && DERIVED_STATUSES.includes(to)) {
      throw new ConflictException({
        message: 'Automatic status is on — this status is derived from the booking window and inventory. Adjust the booking dates or turn off automatic status to set it manually.',
        code: 'AUTO_STATUS',
      });
    }
    if (to === 'BOOKING_OPEN' || to === 'CLOSING_SOON') {
      if (p.bookingClosesAt && p.bookingClosesAt <= new Date()) throw new ConflictException({ message: 'The booking window has already closed — extend the closing date first', code: 'BOOKING_CLOSED' });
    }
    if (SALES_PROJECT_STATUSES.includes(to) && p.organization.status !== 'ACTIVE') {
      throw new ConflictException({ message: `${p.organization.name} must be verified before the project can open`, code: 'ORGANIZATION_NOT_ACTIVE' });
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.project.updateMany({ where: { id, status: p.status }, data: { status: to, ...(to === 'ARCHIVED' ? { isPublished: false, isFeatured: false } : {}) } });
      if (!res.count) throw new ConflictException({ message: 'The project was changed by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      await tx.projectStatusHistory.create({ data: { projectId: id, fromStatus: p.status, toStatus: to, changedById: user.id, reason: reason?.trim() || null } });
      await this.audit.log({ actorId: user.id, action: 'project.status', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: { status: p.status }, after: { status: to }, metadata: reason ? { reason } : undefined }, tx);
    });
    await this.notifyStatusChange(id, to);
    return this.getForManage(user, id);
  }

  async history(user: AuthUser, id: string) {
    await this.loadForAccess(user, id);
    return this.prisma.projectStatusHistory.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, include: { changedBy: { select: { fullName: true } } } });
  }

  // ───────────────────────── Media & documents ─────────────────────────

  async replaceMedia(user: AuthUser, id: string, items: ProjectMediaItem[]) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId, 'You cannot edit this project');
    const existing = await this.prisma.projectMedia.findMany({ where: { projectId: id } });
    const known = new Set(existing.map((m) => m.url));
    const rows: Prisma.ProjectMediaCreateManyInput[] = [];
    for (const [i, m] of items.entries()) {
      const type = m.type ?? 'IMAGE';
      let url: string;
      let storageKey: string | null = null;
      if (m.fileId) ({ url, storageKey } = await this.files.publicUrlFor(m.fileId, user));
      else if (m.url && (known.has(m.url) || (type === 'VIDEO' && /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(m.url)))) url = m.url;
      else if (m.url && user.hasGlobal('project.edit')) url = m.url;
      else throw new BadRequestException({ message: 'Upload images through the uploader (external image links are not accepted)', details: [{ path: `items.${i}`, message: 'Invalid media source' }] });
      rows.push({ projectId: id, type, url, storageKey, caption: m.caption ?? null, sortOrder: i });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.projectMedia.deleteMany({ where: { projectId: id } });
      if (rows.length) await tx.projectMedia.createMany({ data: rows });
      if (!p.heroImageUrl) {
        const firstImage = rows.find((r) => r.type === 'IMAGE');
        if (firstImage) await tx.project.update({ where: { id }, data: { heroImageUrl: firstImage.url } });
      }
      await this.audit.log({ actorId: user.id, action: 'project.media.update', entityType: 'Project', entityId: id, organizationId: p.organizationId, metadata: { count: rows.length } }, tx);
    });
    return sortByEnum(await this.prisma.projectMedia.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: 'asc' }] }), (m) => m.type, MediaType);
  }

  async addDocument(user: AuthUser, id: string, input: z.output<typeof projectDocumentSchema>) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId, 'You cannot edit this project');
    const file = await this.prisma.storedFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.deletedAt || file.visibility !== 'PRIVATE') throw new BadRequestException('Upload the document with purpose "project-document" first');
    if (file.uploadedById !== user.id && file.organizationId !== p.organizationId) throw new ForbiddenException('You cannot attach this file');
    const count = await this.prisma.projectDocument.count({ where: { projectId: id } });
    const doc = await this.prisma.projectDocument.create({ data: { projectId: id, docType: input.docType, title: input.title, fileId: file.id, visibility: input.visibility, sortOrder: count } });
    await this.audit.log({ actorId: user.id, action: 'project.document.add', entityType: 'Project', entityId: id, organizationId: p.organizationId, after: { docId: doc.id, title: doc.title, visibility: doc.visibility } });
    return doc;
  }

  async updateDocument(user: AuthUser, id: string, docId: string, input: { title?: string; visibility?: 'PRIVATE' | 'PUBLIC' | 'ON_REQUEST' }) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId);
    const doc = await this.prisma.projectDocument.findFirst({ where: { id: docId, projectId: id } });
    if (!doc) throw new NotFoundException('Document not found');
    const updated = await this.prisma.projectDocument.update({ where: { id: docId }, data: input });
    await this.audit.log({ actorId: user.id, action: 'project.document.update', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: { title: doc.title, visibility: doc.visibility }, after: input });
    return updated;
  }

  async removeDocument(user: AuthUser, id: string, docId: string) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId);
    const doc = await this.prisma.projectDocument.findFirst({ where: { id: docId, projectId: id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.projectDocument.delete({ where: { id: docId } });
    await this.audit.log({ actorId: user.id, action: 'project.document.remove', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: { title: doc.title } });
    return { ok: true };
  }

  // ───────────────────────── Nearby / FAQs / construction updates ─────────────────────────

  private async editable(user: AuthUser, id: string) {
    const p = await this.loadForAccess(user, id);
    user.assert('project.edit', p.organizationId, 'You cannot edit this project');
    return p;
  }

  async addNearby(user: AuthUser, id: string, input: z.output<typeof projectNearbySchema>) {
    const p = await this.editable(user, id);
    const sortOrder = input.sortOrder ?? (await this.prisma.projectNearbyPlace.count({ where: { projectId: id } }));
    const row = await this.prisma.projectNearbyPlace.create({ data: { projectId: id, category: input.category, name: input.name, distanceKm: input.distanceKm, travelMinutes: input.travelMinutes ?? null, sortOrder } });
    await this.audit.log({ actorId: user.id, action: 'project.nearby.add', entityType: 'Project', entityId: id, organizationId: p.organizationId, after: row });
    return row;
  }

  async updateNearby(user: AuthUser, id: string, itemId: string, input: Partial<z.output<typeof projectNearbySchema>>) {
    const p = await this.editable(user, id);
    const row = await this.prisma.projectNearbyPlace.findFirst({ where: { id: itemId, projectId: id } });
    if (!row) throw new NotFoundException('Nearby place not found');
    const updated = await this.prisma.projectNearbyPlace.update({ where: { id: itemId }, data: input });
    await this.audit.log({ actorId: user.id, action: 'project.nearby.update', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: row, after: updated });
    return updated;
  }

  async removeNearby(user: AuthUser, id: string, itemId: string) {
    const p = await this.editable(user, id);
    const res = await this.prisma.projectNearbyPlace.deleteMany({ where: { id: itemId, projectId: id } });
    if (!res.count) throw new NotFoundException('Nearby place not found');
    await this.audit.log({ actorId: user.id, action: 'project.nearby.remove', entityType: 'Project', entityId: id, organizationId: p.organizationId, metadata: { itemId } });
    return { ok: true };
  }

  async addFaq(user: AuthUser, id: string, input: z.output<typeof projectFaqSchema>) {
    const p = await this.editable(user, id);
    const sortOrder = input.sortOrder ?? (await this.prisma.projectFaq.count({ where: { projectId: id } }));
    const row = await this.prisma.projectFaq.create({ data: { projectId: id, question: input.question, answer: input.answer, sortOrder } });
    await this.audit.log({ actorId: user.id, action: 'project.faq.add', entityType: 'Project', entityId: id, organizationId: p.organizationId, after: row });
    return row;
  }

  async updateFaq(user: AuthUser, id: string, itemId: string, input: Partial<z.output<typeof projectFaqSchema>>) {
    const p = await this.editable(user, id);
    const row = await this.prisma.projectFaq.findFirst({ where: { id: itemId, projectId: id } });
    if (!row) throw new NotFoundException('FAQ not found');
    const updated = await this.prisma.projectFaq.update({ where: { id: itemId }, data: input });
    await this.audit.log({ actorId: user.id, action: 'project.faq.update', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: row, after: updated });
    return updated;
  }

  async removeFaq(user: AuthUser, id: string, itemId: string) {
    const p = await this.editable(user, id);
    const res = await this.prisma.projectFaq.deleteMany({ where: { id: itemId, projectId: id } });
    if (!res.count) throw new NotFoundException('FAQ not found');
    await this.audit.log({ actorId: user.id, action: 'project.faq.remove', entityType: 'Project', entityId: id, organizationId: p.organizationId, metadata: { itemId } });
    return { ok: true };
  }

  async addUpdate(user: AuthUser, id: string, input: z.output<typeof constructionUpdateSchema>) {
    const p = await this.editable(user, id);
    for (const [i, u] of (input.imageUrls ?? []).entries()) this.assertImageUrl(user, `imageUrls.${i}`, u);
    const row = await this.prisma.projectConstructionUpdate.create({
      data: { projectId: id, title: input.title, description: input.description ?? null, progressPercent: input.progressPercent ?? null, updateDate: dateOnly(input.updateDate), imageUrls: input.imageUrls ?? [] },
    });
    await this.audit.log({ actorId: user.id, action: 'project.update.add', entityType: 'Project', entityId: id, organizationId: p.organizationId, after: row });
    return row;
  }

  async updateUpdate(user: AuthUser, id: string, itemId: string, input: Partial<z.output<typeof constructionUpdateSchema>>) {
    const p = await this.editable(user, id);
    const row = await this.prisma.projectConstructionUpdate.findFirst({ where: { id: itemId, projectId: id } });
    if (!row) throw new NotFoundException('Construction update not found');
    for (const [i, u] of (input.imageUrls ?? []).entries()) this.assertImageUrl(user, `imageUrls.${i}`, u);
    const { updateDate, ...rest } = input;
    const updated = await this.prisma.projectConstructionUpdate.update({ where: { id: itemId }, data: { ...rest, ...(updateDate ? { updateDate: dateOnly(updateDate) } : {}) } });
    await this.audit.log({ actorId: user.id, action: 'project.update.edit', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: row, after: updated });
    return updated;
  }

  async removeUpdate(user: AuthUser, id: string, itemId: string) {
    const p = await this.editable(user, id);
    const res = await this.prisma.projectConstructionUpdate.deleteMany({ where: { id: itemId, projectId: id } });
    if (!res.count) throw new NotFoundException('Construction update not found');
    await this.audit.log({ actorId: user.id, action: 'project.update.remove', entityType: 'Project', entityId: id, organizationId: p.organizationId, metadata: { itemId } });
    return { ok: true };
  }

  // ───────────────────────── Team ─────────────────────────

  async teamCandidates(user: AuthUser, id: string) {
    const p = await this.editable(user, id);
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: p.organizationId, status: 'ACTIVE', user: { status: 'ACTIVE', deletedAt: null } },
      select: { title: true, user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return members.map((m) => ({ ...m.user, title: m.title }));
  }

  async addTeamMember(user: AuthUser, id: string, input: z.output<typeof projectTeamMemberSchema>) {
    const p = await this.editable(user, id);
    const member = await this.prisma.organizationMember.findFirst({ where: { organizationId: p.organizationId, userId: input.userId, status: 'ACTIVE' } });
    if (!member) throw new BadRequestException({ message: 'Only active members of the managing organisation can join the project team', details: [{ path: 'userId', message: 'Not a member' }] });
    if (await this.prisma.projectTeamMember.count({ where: { projectId: id, userId: input.userId } })) throw new ConflictException('This person is already on the project team');
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimaryContact) await tx.projectTeamMember.updateMany({ where: { projectId: id }, data: { isPrimaryContact: false } });
      const created = await tx.projectTeamMember.create({ data: { projectId: id, userId: input.userId, role: input.role, isPrimaryContact: Boolean(input.isPrimaryContact) } });
      await this.audit.log({ actorId: user.id, action: 'project.team.add', entityType: 'Project', entityId: id, organizationId: p.organizationId, after: { userId: input.userId, role: input.role } }, tx);
      return created;
    });
    return row;
  }

  async updateTeamMember(user: AuthUser, id: string, memberId: string, input: { role?: z.output<typeof projectTeamMemberSchema>['role']; isPrimaryContact?: boolean }) {
    const p = await this.editable(user, id);
    const row = await this.prisma.projectTeamMember.findFirst({ where: { id: memberId, projectId: id } });
    if (!row) throw new NotFoundException('Team member not found');
    return this.prisma.$transaction(async (tx) => {
      if (input.isPrimaryContact) await tx.projectTeamMember.updateMany({ where: { projectId: id, id: { not: memberId } }, data: { isPrimaryContact: false } });
      const updated = await tx.projectTeamMember.update({ where: { id: memberId }, data: input });
      await this.audit.log({ actorId: user.id, action: 'project.team.update', entityType: 'Project', entityId: id, organizationId: p.organizationId, before: row, after: updated }, tx);
      return updated;
    });
  }

  async removeTeamMember(user: AuthUser, id: string, memberId: string) {
    const p = await this.editable(user, id);
    const res = await this.prisma.projectTeamMember.deleteMany({ where: { id: memberId, projectId: id } });
    if (!res.count) throw new NotFoundException('Team member not found');
    await this.audit.log({ actorId: user.id, action: 'project.team.remove', entityType: 'Project', entityId: id, organizationId: p.organizationId, metadata: { memberId } });
    return { ok: true };
  }

  /** Developer organisations a user may attach to a project (platform staff) — for the form's picker. */
  async developerOptions(user: AuthUser) {
    if (!user.hasGlobal('project.create') && !user.hasGlobal('project.edit')) {
      return user.memberships.filter((m) => m.organizationType === 'DEVELOPER').map((m) => ({ id: m.organizationId, name: m.organizationName }));
    }
    return this.prisma.organization.findMany({ where: { type: 'DEVELOPER', deletedAt: null, status: { in: ['ACTIVE', 'PENDING'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  slugFor(name: string): string {
    return slugify(name);
  }
}
