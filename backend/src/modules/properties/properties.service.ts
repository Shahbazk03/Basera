import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  availablePropertyActions,
  findPropertyTransition,
  PropertyActor,
  PropertyPayload,
  slugify,
  toSqft,
  validatePropertyForProfile,
} from '@estate/shared';
import type { z } from 'zod';
import type { propertyReportSchema } from '@estate/shared';
import { Prisma, PropertyStatus } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { shortCode } from '../../common/references';
import { paginated, Pagination, skipTake } from '../../common/http';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { FilesService } from '../files/files.service';

const SOURCE_BY_ORG_TYPE = { PLATFORM: 'COMPANY', BROKERAGE: 'BROKER', DEVELOPER: 'DEVELOPER', INDIVIDUAL_OWNER: 'OWNER', PARTNER: 'BROKER', LEAD_PROVIDER: null } as const;

/** Fields whose change on a live listing requires review again. */
const MATERIAL_FIELDS = ['title', 'description', 'price', 'area', 'areaUnit', 'propertyTypeId', 'listingType', 'cityId', 'localityId', 'latitude', 'longitude'] as const;

export interface ManageListQuery extends Pagination {
  status?: PropertyStatus;
  q?: string;
  organizationId?: string;
  listingType?: 'SALE' | 'RENT';
  verification?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  mine?: boolean;
}

export interface MediaItemInput {
  type?: 'IMAGE' | 'VIDEO' | 'FLOOR_PLAN' | 'MASTER_PLAN';
  fileId?: string;
  url?: string;
  caption?: string | null;
  isCover?: boolean;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  // ───────────────────────── Reads ─────────────────────────

  private scopeWhere(user: AuthUser): Prisma.PropertyWhereInput {
    const scope = user.orgsWith('property.view_all');
    const approve = user.orgsWith('property.approve');
    if (scope === 'ALL' || approve === 'ALL') return {};
    const orgs = [...new Set([...scope, ...approve])];
    return { organizationId: { in: orgs } };
  }

  async list(user: AuthUser, q: ManageListQuery) {
    const scope = this.scopeWhere(user);
    if ('organizationId' in scope && (scope.organizationId as { in: string[] }).in.length === 0) {
      return { ...paginated([], 0, q), statusCounts: {} };
    }
    const where: Prisma.PropertyWhereInput = {
      deletedAt: null,
      ...scope,
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.listingType ? { listingType: q.listingType } : {}),
      ...(q.verification ? { verificationStatus: q.verification } : {}),
      ...(q.mine ? { listedById: user.id } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { referenceCode: { equals: q.q.toUpperCase() } },
              { locality: { name: { contains: q.q, mode: 'insensitive' } } },
              { organization: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const statusWhere = { ...where };
    delete (statusWhere as Record<string, unknown>).status;
    const [rows, total, counts] = await Promise.all([
      this.prisma.property.findMany({
        where,
        orderBy: q.status === 'PENDING_REVIEW' ? { submittedAt: 'asc' } : { updatedAt: 'desc' },
        select: {
          id: true,
          referenceCode: true,
          slug: true,
          title: true,
          status: true,
          verificationStatus: true,
          availability: true,
          listingType: true,
          price: true,
          area: true,
          areaUnit: true,
          coverImageUrl: true,
          isFeatured: true,
          isDemo: true,
          viewCount: true,
          enquiryCount: true,
          submittedAt: true,
          publishedAt: true,
          expiresAt: true,
          updatedAt: true,
          rejectionReason: true,
          propertyType: { select: { name: true } },
          locality: { select: { name: true } },
          organization: { select: { id: true, name: true, type: true, status: true } },
          listedBy: { select: { id: true, fullName: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.property.count({ where }),
      this.prisma.property.groupBy({ by: ['status'], where: statusWhere, _count: { _all: true } }),
    ]);
    return { ...paginated(rows, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  async getForManage(user: AuthUser, id: string) {
    const p = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: {
        propertyType: true,
        city: { select: { id: true, name: true, slug: true } },
        locality: { select: { id: true, name: true, slug: true } },
        organization: { select: { id: true, name: true, type: true, status: true, verificationStatus: true } },
        listedBy: { select: { id: true, fullName: true, email: true } },
        project: { select: { id: true, name: true, slug: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        amenities: { select: { amenityId: true } },
        documents: { include: { file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } } } },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 50, include: { changedBy: { select: { fullName: true } } } },
        reports: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!p) throw new NotFoundException('Listing not found');
    if (!user.can('property.view_all', p.organizationId) && !user.can('property.approve', p.organizationId)) throw new NotFoundException('Listing not found');
    const actors = this.actorsFor(user, p.organizationId);
    return {
      ...p,
      amenityIds: p.amenities.map((a) => a.amenityId),
      allowedActions: availablePropertyActions(p.status, p.listingType, actors).map((t) => ({ action: t.action, to: t.to, requiresReason: Boolean(t.requiresReason) })),
      canEdit: user.can('property.edit', p.organizationId),
      canReview: user.can('property.approve', p.organizationId),
    };
  }

  private actorsFor(user: AuthUser, organizationId: string): PropertyActor[] {
    const actors: PropertyActor[] = [];
    if (user.can('property.edit', organizationId)) actors.push('LISTER');
    if (user.can('property.approve', organizationId)) actors.push('REVIEWER');
    return actors;
  }

  // ───────────────────────── Create / update ─────────────────────────

  private async resolveOrganization(user: AuthUser, requested?: string) {
    let orgId = requested;
    if (!orgId) {
      const candidates = user.memberships.filter((m) => user.can('property.create', m.organizationId));
      const nonPlatform = candidates.filter((m) => m.organizationType !== 'PLATFORM');
      if (nonPlatform.length === 1) orgId = nonPlatform[0].organizationId;
      else if (candidates.length === 1) orgId = candidates[0].organizationId;
      else if (user.hasGlobal('property.create') && user.platformOrganizationId) orgId = user.platformOrganizationId;
      else throw new BadRequestException({ message: 'Choose which organisation this listing belongs to', details: [{ path: 'organizationId', message: 'Required' }] });
    }
    user.assert('property.create', orgId, 'You cannot create listings for this organisation');
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
    if (!org) throw new BadRequestException('Organisation not found');
    const source = SOURCE_BY_ORG_TYPE[org.type];
    if (!source) throw new BadRequestException('This organisation type cannot publish listings');
    return { org, source };
  }

  private async validateRefs(input: Partial<PropertyPayload>, listingType: 'SALE' | 'RENT', typeId: string) {
    const type = await this.prisma.propertyType.findUnique({ where: { id: typeId } });
    if (!type || !type.isActive) throw new BadRequestException({ message: 'Choose a valid property type', details: [{ path: 'propertyTypeId', message: 'Invalid type' }] });
    if (listingType === 'RENT' && !type.allowRent) throw new BadRequestException({ message: `${type.name} cannot be listed for rent`, details: [{ path: 'listingType', message: 'Not allowed for this type' }] });
    if (listingType === 'SALE' && !type.allowSale) throw new BadRequestException({ message: `${type.name} cannot be listed for sale`, details: [{ path: 'listingType', message: 'Not allowed for this type' }] });
    if (input.localityId || input.cityId) {
      const locality = await this.prisma.locality.findUnique({ where: { id: input.localityId! }, include: { city: true } });
      if (!locality || locality.cityId !== input.cityId || !locality.isActive) {
        throw new BadRequestException({ message: 'The locality does not belong to the selected city', details: [{ path: 'localityId', message: 'Invalid locality' }] });
      }
      if (!locality.city.isActive) throw new BadRequestException({ message: 'Listings are not yet accepted in this city', details: [{ path: 'cityId', message: 'City not active' }] });
    }
    if (input.amenityIds?.length) {
      const count = await this.prisma.amenity.count({ where: { id: { in: input.amenityIds }, isActive: true, forProperties: true } });
      if (count !== new Set(input.amenityIds).size) throw new BadRequestException({ message: 'One or more amenities are invalid', details: [{ path: 'amenityIds', message: 'Invalid amenity' }] });
    }
    if (input.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
      if (!project) throw new BadRequestException({ message: 'Linked project not found', details: [{ path: 'projectId', message: 'Invalid project' }] });
    }
    const issues = validatePropertyForProfile(type.formProfile, input, listingType);
    if (issues.length) throw new BadRequestException({ message: 'Please correct the highlighted fields', code: 'VALIDATION_FAILED', details: issues });
    return type;
  }

  private derived(input: Partial<PropertyPayload> & { area: number; areaUnit: PropertyPayload['areaUnit']; price: number; listingType: 'SALE' | 'RENT' }) {
    const areaSqft = toSqft(input.area, input.areaUnit);
    return { areaSqft, pricePerSqft: input.listingType === 'SALE' && areaSqft > 0 ? Math.round(input.price / areaSqft) : null };
  }

  private columns(input: Partial<PropertyPayload>): Prisma.PropertyUncheckedUpdateInput {
    const { amenityIds: _a, media: _m, organizationId: _o, sourceType: _s, availableFrom, ownerEmail, pincode, ...rest } = input;
    const out: Record<string, unknown> = { ...rest };
    if (availableFrom !== undefined) out.availableFrom = availableFrom ? new Date(`${availableFrom}T00:00:00Z`) : null;
    if (ownerEmail !== undefined) out.ownerEmail = ownerEmail || null;
    if (pincode !== undefined) out.pincode = pincode || null;
    return out as Prisma.PropertyUncheckedUpdateInput;
  }

  async create(user: AuthUser, input: PropertyPayload) {
    const { org, source } = await this.resolveOrganization(user, input.organizationId);
    const type = await this.validateRefs(input, input.listingType, input.propertyTypeId);
    const city = await this.prisma.city.findUniqueOrThrow({ where: { id: input.cityId } });
    const code = shortCode('PR');
    const media = await this.resolveMedia(user, input.media ?? []);
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.property.create({
        data: {
          ...(this.columns(input) as Prisma.PropertyUncheckedCreateInput),
          referenceCode: code,
          slug: `${slugify(input.title, 70)}-${code.toLowerCase()}`,
          segment: type.segment,
          sourceType: source,
          organizationId: org.id,
          listedById: user.id,
          stateId: city.stateId,
          ...this.derived(input),
          attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
          highlights: input.highlights ?? [],
          status: 'DRAFT',
          coverImageUrl: media.find((m) => m.isCover)?.url ?? media.find((m) => m.type === 'IMAGE')?.url ?? null,
          amenities: { create: (input.amenityIds ?? []).map((amenityId) => ({ amenityId })) },
          media: { create: media },
          statusHistory: { create: { fromStatus: null, toStatus: 'DRAFT', changedById: user.id, reason: 'Created' } },
        },
      });
      await this.audit.log({ actorId: user.id, action: 'property.create', entityType: 'Property', entityId: p.id, organizationId: org.id, after: { title: p.title, referenceCode: p.referenceCode } }, tx);
      return p;
    });
    return this.getForManage(user, created.id);
  }

  async update(user: AuthUser, id: string, input: Partial<PropertyPayload>) {
    const existing = await this.prisma.property.findFirst({ where: { id, deletedAt: null }, include: { amenities: true } });
    if (!existing) throw new NotFoundException('Listing not found');
    user.assert('property.edit', existing.organizationId, 'You cannot edit this listing');
    if (['SOLD', 'RENTED', 'ARCHIVED'].includes(existing.status)) throw new ConflictException({ message: `A ${existing.status.toLowerCase()} listing cannot be edited`, code: 'LISTING_CLOSED' });

    const merged = {
      ...(this.toPayload(existing) as Partial<PropertyPayload>),
      ...input,
      amenityIds: input.amenityIds ?? existing.amenities.map((a) => a.amenityId),
    } as PropertyPayload;
    const type = await this.validateRefs(merged, merged.listingType, merged.propertyTypeId);
    const city = await this.prisma.city.findUniqueOrThrow({ where: { id: merged.cityId } });

    const materialChange = MATERIAL_FIELDS.some((f) => f in input && String((input as Record<string, unknown>)[f] ?? '') !== String((existing as Record<string, unknown>)[f] ?? ''));
    const requireReview = (await this.settings.getBoolean('listing.requireReviewOnEdit')) && !user.can('property.approve', existing.organizationId);
    const backToReview = materialChange && requireReview && ['PUBLISHED', 'APPROVED'].includes(existing.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id },
        data: {
          ...this.columns(input),
          segment: type.segment,
          stateId: city.stateId,
          ...this.derived(merged),
          ...(input.attributes ? { attributes: input.attributes as Prisma.InputJsonValue } : {}),
          ...(backToReview ? { status: 'PENDING_REVIEW', submittedAt: new Date() } : {}),
        },
      });
      if (input.amenityIds) {
        await tx.propertyAmenity.deleteMany({ where: { propertyId: id } });
        await tx.propertyAmenity.createMany({ data: input.amenityIds.map((amenityId) => ({ propertyId: id, amenityId })) });
      }
      if (backToReview) {
        await tx.propertyStatusHistory.create({ data: { propertyId: id, fromStatus: existing.status, toStatus: 'PENDING_REVIEW', changedById: user.id, reason: 'Material details edited — review required' } });
      }
      await this.audit.log({ actorId: user.id, action: 'property.update', entityType: 'Property', entityId: id, organizationId: existing.organizationId, before: pick(existing, Object.keys(input)), after: input }, tx);
    });
    if (backToReview) await this.notifyReviewers(id);
    return this.getForManage(user, id);
  }

  private toPayload(p: Prisma.PropertyGetPayload<object>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (v instanceof Prisma.Decimal) out[k] = v.toNumber();
      else if (v instanceof Date) out[k] = k === 'availableFrom' ? v.toISOString().slice(0, 10) : v;
      else out[k] = v;
    }
    return out;
  }

  // ───────────────────────── Lifecycle ─────────────────────────

  async transition(user: AuthUser, id: string, action: string, reason?: string) {
    const p = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: { organization: { select: { id: true, status: true, name: true } }, propertyType: true, _count: { select: { media: { where: { type: 'IMAGE' } } } } },
    });
    if (!p) throw new NotFoundException('Listing not found');
    const actors = this.actorsFor(user, p.organizationId);
    if (!actors.length) throw new ForbiddenException('You cannot change this listing');
    const t = findPropertyTransition(p.status, action, p.listingType);
    if (!t) throw new ConflictException({ message: `Cannot "${action.replace(/_/g, ' ')}" a listing that is ${p.status.replace(/_/g, ' ').toLowerCase()}`, code: 'INVALID_TRANSITION' });
    if (!t.actors.some((a) => actors.includes(a))) throw new ForbiddenException('Only a reviewer can perform this action');
    if (t.requiresReason && !reason?.trim()) throw new BadRequestException({ message: 'A reason is required', details: [{ path: 'reason', message: 'Required' }] });

    if (t.to === 'PENDING_REVIEW') {
      if (p._count.media === 0) throw new ConflictException({ message: 'Add at least one photo before submitting for review', code: 'PHOTOS_REQUIRED' });
      const issues = validatePropertyForProfile(p.propertyType.formProfile, this.toPayload(p) as Partial<PropertyPayload>, p.listingType);
      if (issues.length) throw new BadRequestException({ message: 'Complete the listing before submitting', code: 'INCOMPLETE_LISTING', details: issues });
    }
    if ((t.to === 'APPROVED' || t.to === 'PUBLISHED') && p.organization.status !== 'ACTIVE') {
      throw new ConflictException({ message: `${p.organization.name} is not verified yet — the organisation must be approved before its listings can go live`, code: 'ORGANIZATION_NOT_ACTIVE' });
    }

    const now = new Date();
    const steps: { to: PropertyStatus; data: Prisma.PropertyUncheckedUpdateInput }[] = [];
    const validityDays = await this.settings.getNumber('listing.validityDays');
    const publishData = async (): Promise<Prisma.PropertyUncheckedUpdateInput> => {
      await this.assertQuota(p.organizationId, p.id);
      return { publishedAt: now, expiresAt: new Date(now.getTime() + validityDays * 86_400_000) };
    };
    switch (t.to) {
      case 'PENDING_REVIEW':
        steps.push({ to: t.to, data: { submittedAt: now, rejectionReason: null } });
        break;
      case 'APPROVED':
        steps.push({ to: 'APPROVED', data: { approvedAt: now, rejectionReason: null } });
        if (await this.settings.getBoolean('listing.autoPublishOnApproval')) steps.push({ to: 'PUBLISHED', data: await publishData() });
        break;
      case 'PUBLISHED':
        steps.push({ to: 'PUBLISHED', data: await publishData() });
        break;
      case 'REJECTED':
        steps.push({ to: 'REJECTED', data: { rejectionReason: reason } });
        break;
      case 'SOLD':
      case 'RENTED':
        steps.push({ to: t.to, data: { closedAt: now, isFeatured: false } });
        break;
      case 'ARCHIVED':
        steps.push({ to: t.to, data: { isFeatured: false } });
        break;
      default:
        steps.push({ to: t.to, data: {} });
    }

    const final = steps[steps.length - 1].to;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.property.updateMany({
        where: { id, status: p.status },
        data: Object.assign({}, ...steps.map((s) => s.data), { status: final }) as Prisma.PropertyUncheckedUpdateManyInput,
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This listing was changed by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      let from: PropertyStatus = p.status;
      for (const s of steps) {
        await tx.propertyStatusHistory.create({ data: { propertyId: id, fromStatus: from, toStatus: s.to, changedById: user.id, reason: reason ?? null } });
        from = s.to;
      }
      await this.audit.log({ actorId: user.id, action: `property.${action}`, entityType: 'Property', entityId: id, organizationId: p.organizationId, before: { status: p.status }, after: { status: final }, metadata: reason ? { reason } : undefined }, tx);
    });

    if (final === 'PENDING_REVIEW') await this.notifyReviewers(id);
    if (['APPROVED', 'PUBLISHED', 'REJECTED'].includes(final) && actors.includes('REVIEWER') && ['approve', 'reject'].includes(action)) {
      await this.notifyLister(id, final === 'REJECTED' ? 'rejected' : final === 'PUBLISHED' ? 'approved and published' : 'approved', reason);
    }
    return this.getForManage(user, id);
  }

  private async assertQuota(organizationId: string, propertyId: string) {
    if (!(await this.settings.getBoolean('subscriptions.enforceQuota'))) return;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
    if (org?.type !== 'BROKERAGE') return;
    const sub = await this.prisma.organizationSubscription.findFirst({
      where: { organizationId, status: 'ACTIVE', startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
      include: { plan: true },
      orderBy: { endsAt: 'desc' },
    });
    if (!sub) throw new ConflictException({ message: 'An active subscription is required to publish listings', code: 'SUBSCRIPTION_REQUIRED' });
    if (sub.plan.listingQuota != null) {
      const live = await this.prisma.property.count({ where: { organizationId, status: 'PUBLISHED', deletedAt: null, id: { not: propertyId } } });
      if (live >= sub.plan.listingQuota) throw new ConflictException({ message: `Your ${sub.plan.name} plan allows ${sub.plan.listingQuota} live listings`, code: 'LISTING_QUOTA_REACHED' });
    }
  }

  private async notifyReviewers(propertyId: string) {
    const p = await this.prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { id: true, title: true, referenceCode: true, organizationId: true } });
    const recipients = (await this.notifications.recipientsWithPermission('property.approve', p.organizationId)).filter(Boolean);
    await this.notifications.send({
      eventKey: 'listing.submitted',
      recipients,
      channels: ['IN_APP'],
      data: { title: p.title, reference: p.referenceCode },
      link: `/admin/properties/${p.id}`,
      relatedType: 'Property',
      relatedId: p.id,
    });
  }

  private async notifyLister(propertyId: string, decision: string, reason?: string) {
    const p = await this.prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { id: true, title: true, referenceCode: true, listedById: true } });
    const r = await this.notifications.userRecipient(p.listedById);
    if (!r) return;
    await this.notifications.send({
      eventKey: 'listing.decided',
      recipients: [r],
      channels: ['IN_APP', 'EMAIL'],
      data: { title: p.title, reference: p.referenceCode, decision, reason: reason ? `Reason: ${reason}` : '' },
      link: `${env().CONSOLE_PUBLIC_URL}/listings/${p.id}`,
      relatedType: 'Property',
      relatedId: p.id,
    });
  }

  // ───────────────────────── Media & documents ─────────────────────────

  private async resolveMedia(user: AuthUser, items: MediaItemInput[], existingUrls: Set<string> = new Set()) {
    const out: { type: 'IMAGE' | 'VIDEO' | 'FLOOR_PLAN' | 'MASTER_PLAN'; url: string; storageKey: string | null; caption: string | null; sortOrder: number; isCover: boolean }[] = [];
    for (const [i, m] of items.entries()) {
      const type = m.type ?? 'IMAGE';
      let url: string;
      let storageKey: string | null = null;
      if (m.fileId) {
        ({ url, storageKey } = await this.files.publicUrlFor(m.fileId, user));
      } else if (m.url && (existingUrls.has(m.url) || (type === 'VIDEO' && /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(m.url)))) {
        url = m.url;
      } else if (m.url && user.hasGlobal('property.edit')) {
        url = m.url; // platform staff may reference external media (e.g. imports)
      } else {
        throw new BadRequestException({ message: 'Upload photos through the uploader (external image links are not accepted)', details: [{ path: `media.${i}`, message: 'Invalid media source' }] });
      }
      out.push({ type, url, storageKey, caption: m.caption ?? null, sortOrder: i, isCover: Boolean(m.isCover) });
    }
    if (!out.some((m) => m.isCover)) {
      const first = out.find((m) => m.type === 'IMAGE');
      if (first) first.isCover = true;
    }
    return out;
  }

  async replaceMedia(user: AuthUser, id: string, items: MediaItemInput[]) {
    const p = await this.prisma.property.findFirst({ where: { id, deletedAt: null }, include: { media: true } });
    if (!p) throw new NotFoundException('Listing not found');
    user.assert('property.edit', p.organizationId, 'You cannot edit this listing');
    if (items.filter((m) => (m.type ?? 'IMAGE') === 'IMAGE').length > 30) throw new BadRequestException('A listing can have at most 30 photos');
    const media = await this.resolveMedia(user, items, new Set(p.media.map((m) => m.url)));
    const changed = JSON.stringify(media.map((m) => m.url)) !== JSON.stringify(p.media.map((m) => m.url));
    const requireReview = changed && p.status === 'PUBLISHED' && (await this.settings.getBoolean('listing.requireReviewOnEdit')) && !user.can('property.approve', p.organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.propertyMedia.deleteMany({ where: { propertyId: id } });
      if (media.length) await tx.propertyMedia.createMany({ data: media.map((m) => ({ ...m, propertyId: id })) });
      await tx.property.update({
        where: { id },
        data: {
          coverImageUrl: media.find((m) => m.isCover)?.url ?? null,
          ...(requireReview ? { status: 'PENDING_REVIEW', submittedAt: new Date() } : {}),
        },
      });
      if (requireReview) await tx.propertyStatusHistory.create({ data: { propertyId: id, fromStatus: 'PUBLISHED', toStatus: 'PENDING_REVIEW', changedById: user.id, reason: 'Photos changed — review required' } });
      await this.audit.log({ actorId: user.id, action: 'property.media.update', entityType: 'Property', entityId: id, organizationId: p.organizationId, metadata: { count: media.length } }, tx);
    });
    if (requireReview) await this.notifyReviewers(id);
    return this.getForManage(user, id);
  }

  async addDocument(user: AuthUser, id: string, input: { docType: string; title: string; fileId: string; visibility: 'PRIVATE' | 'PUBLIC' | 'ON_REQUEST' }) {
    const p = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Listing not found');
    user.assert('property.edit', p.organizationId, 'You cannot edit this listing');
    const file = await this.prisma.storedFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.deletedAt || file.visibility !== 'PRIVATE') throw new BadRequestException('Upload the document with purpose "property-document" first');
    if (file.uploadedById !== user.id && file.organizationId !== p.organizationId) throw new ForbiddenException('You cannot attach this file');
    const doc = await this.prisma.propertyDocument.create({ data: { propertyId: id, docType: input.docType as never, title: input.title, fileId: file.id, visibility: input.visibility } });
    await this.audit.log({ actorId: user.id, action: 'property.document.add', entityType: 'Property', entityId: id, organizationId: p.organizationId, after: { docId: doc.id, title: doc.title } });
    return doc;
  }

  async removeDocument(user: AuthUser, id: string, docId: string) {
    const doc = await this.prisma.propertyDocument.findFirst({ where: { id: docId, propertyId: id }, include: { property: true } });
    if (!doc) throw new NotFoundException('Document not found');
    user.assert('property.edit', doc.property.organizationId, 'You cannot edit this listing');
    await this.prisma.propertyDocument.delete({ where: { id: docId } });
    await this.audit.log({ actorId: user.id, action: 'property.document.remove', entityType: 'Property', entityId: id, organizationId: doc.property.organizationId, before: { title: doc.title } });
    return { ok: true };
  }

  // ───────────────────────── Admin controls ─────────────────────────

  async setVerification(user: AuthUser, id: string, status: 'VERIFIED' | 'REJECTED' | 'PENDING', note?: string) {
    const p = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Listing not found');
    user.assert('property.approve', p.organizationId);
    const updated = await this.prisma.property.update({ where: { id }, data: { verificationStatus: status } });
    if (status === 'VERIFIED') await this.prisma.propertyDocument.updateMany({ where: { propertyId: id, verifiedAt: null }, data: { verifiedAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: 'property.verification', entityType: 'Property', entityId: id, organizationId: p.organizationId, before: { verificationStatus: p.verificationStatus }, after: { verificationStatus: status }, metadata: note ? { note } : undefined });
    return updated;
  }

  async setFeatured(user: AuthUser, id: string, featured: boolean, days?: number) {
    const p = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Listing not found');
    user.assert('property.feature', p.organizationId);
    if (featured && p.status !== 'PUBLISHED') throw new ConflictException('Only published listings can be featured');
    const updated = await this.prisma.property.update({ where: { id }, data: { isFeatured: featured, featuredUntil: featured && days ? new Date(Date.now() + days * 86_400_000) : null } });
    await this.audit.log({ actorId: user.id, action: 'property.feature', entityType: 'Property', entityId: id, organizationId: p.organizationId, after: { isFeatured: featured, days } });
    return updated;
  }

  async setAvailability(user: AuthUser, id: string, availability: 'AVAILABLE' | 'ON_HOLD' | 'UNDER_OFFER') {
    const p = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Listing not found');
    user.assert('property.edit', p.organizationId);
    const updated = await this.prisma.property.update({ where: { id }, data: { availability } });
    await this.audit.log({ actorId: user.id, action: 'property.availability', entityType: 'Property', entityId: id, organizationId: p.organizationId, before: { availability: p.availability }, after: { availability } });
    return updated;
  }

  async softDelete(user: AuthUser, id: string) {
    const p = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Listing not found');
    user.assert('property.delete', p.organizationId);
    if (p.status === 'PUBLISHED') throw new ConflictException('Archive the listing before deleting it');
    await this.prisma.property.update({ where: { id }, data: { deletedAt: new Date(), isFeatured: false } });
    await this.audit.log({ actorId: user.id, action: 'property.delete', entityType: 'Property', entityId: id, organizationId: p.organizationId, before: { title: p.title, status: p.status } });
    return { ok: true };
  }

  // ───────────────────────── Public interactions ─────────────────────────

  async report(propertyId: string, input: z.output<typeof propertyReportSchema>, user?: AuthUser) {
    const p = await this.prisma.property.findFirst({ where: { id: propertyId, deletedAt: null }, select: { id: true } });
    if (!p) throw new NotFoundException('Listing not found');
    const recent = await this.prisma.propertyReport.count({ where: { propertyId, ...(user ? { reporterId: user.id } : { reporterEmail: input.email || '__anon__' }), createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (recent > 0) return { ok: true, message: 'Thanks — we have already received your report for this listing.' };
    await this.prisma.propertyReport.create({ data: { propertyId, reason: input.reason, details: input.details ?? null, reporterId: user?.id ?? null, reporterEmail: input.email || null } });
    return { ok: true, message: 'Thank you. Our team will review this listing.' };
  }

  async listReports(user: AuthUser, q: Pagination & { status?: 'OPEN' | 'RESOLVED' | 'DISMISSED' }) {
    const scope = user.orgsWith('property.report.manage');
    const where: Prisma.PropertyReportWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(scope === 'ALL' ? {} : { property: { organizationId: { in: scope } } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.propertyReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { property: { select: { id: true, title: true, referenceCode: true, slug: true, status: true, organization: { select: { name: true } } } }, reporter: { select: { fullName: true, email: true } }, resolvedBy: { select: { fullName: true } } },
        ...skipTake(q),
      }),
      this.prisma.propertyReport.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async resolveReport(user: AuthUser, reportId: string, status: 'RESOLVED' | 'DISMISSED', resolution: string) {
    const r = await this.prisma.propertyReport.findUnique({ where: { id: reportId }, include: { property: { select: { organizationId: true } } } });
    if (!r) throw new NotFoundException('Report not found');
    user.assert('property.report.manage', r.property.organizationId);
    const updated = await this.prisma.propertyReport.update({ where: { id: reportId }, data: { status, resolution, resolvedById: user.id, resolvedAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: 'property.report.resolve', entityType: 'PropertyReport', entityId: reportId, after: { status, resolution } });
    return updated;
  }

  async favourites(user: AuthUser) {
    return this.prisma.propertyFavourite.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { propertyId: true, createdAt: true } });
  }

  async addFavourite(user: AuthUser, propertyId: string) {
    const p = await this.prisma.property.findFirst({ where: { id: propertyId, deletedAt: null }, select: { id: true } });
    if (!p) throw new NotFoundException('Listing not found');
    await this.prisma.propertyFavourite.upsert({ where: { userId_propertyId: { userId: user.id, propertyId } }, create: { userId: user.id, propertyId }, update: {} });
    return { ok: true };
  }

  async removeFavourite(user: AuthUser, propertyId: string) {
    await this.prisma.propertyFavourite.deleteMany({ where: { userId: user.id, propertyId } });
    return { ok: true };
  }

  // ───────────────────────── Scheduled maintenance ─────────────────────────

  /** Expires listings past their validity and clears lapsed featured flags. Returns the number expired. */
  async expireListings(tx: Tx): Promise<number> {
    const now = new Date();
    const due = await tx.property.findMany({ where: { status: 'PUBLISHED', expiresAt: { lt: now }, deletedAt: null }, select: { id: true, organizationId: true } });
    for (const p of due) {
      const res = await tx.property.updateMany({ where: { id: p.id, status: 'PUBLISHED' }, data: { status: 'EXPIRED', isFeatured: false } });
      if (res.count) await tx.propertyStatusHistory.create({ data: { propertyId: p.id, fromStatus: 'PUBLISHED', toStatus: 'EXPIRED', changedById: null, reason: 'Listing validity period ended' } });
    }
    await tx.property.updateMany({ where: { isFeatured: true, featuredUntil: { lt: now } }, data: { isFeatured: false, featuredUntil: null } });
    return due.length;
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}
