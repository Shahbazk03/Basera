import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { enumLabel, PARTNER_LIST_TYPES, type PermissionKey, localDateString } from '@estate/shared';
import type { z } from 'zod';
import type { orgVerificationDecisionSchema, subscriptionAssignSchema, subscriptionPlanSchema } from '@estate/shared';
import { BillingPeriod, OrganizationType, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake, dateOnly } from '../../common/http';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';

const BILLING_MONTHS: Record<BillingPeriod, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

export interface PartnerListQuery extends Pagination {
  type?: (typeof PARTNER_LIST_TYPES)[number];
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
  verification?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  q?: string;
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCMonth(out.getUTCMonth() + months);
  if (out.getUTCDate() < day) out.setUTCDate(0); // clamp to month end (e.g. 31 Jan + 1 month)
  return out;
}

/** Platform-side management of partner organisations: verification, documents, subscriptions. */
@Injectable()
export class PartnersService {
  private readonly logger = new Logger('Partners');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly authContext: AuthContextService,
  ) {}

  permFor(type: OrganizationType, action: 'view' | 'verify'): PermissionKey {
    return (type === 'DEVELOPER' ? `developer.${action}` : `broker.${action}`) as PermissionKey;
  }

  /** Partner organisations are other tenants: only platform-wide grants may see them. */
  visibleTypes(user: AuthUser): OrganizationType[] {
    const types: OrganizationType[] = [];
    if (user.hasGlobal('broker.view') || user.hasGlobal('broker.verify')) types.push('BROKERAGE', 'INDIVIDUAL_OWNER', 'PARTNER');
    if (user.hasGlobal('developer.view') || user.hasGlobal('developer.verify')) types.push('DEVELOPER');
    return types;
  }

  private async loadVisible(user: AuthUser, id: string) {
    const org = await this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
    if (!org || !this.visibleTypes(user).includes(org.type)) throw new NotFoundException('Organisation not found');
    return org;
  }

  async list(user: AuthUser, q: PartnerListQuery) {
    const types = this.visibleTypes(user);
    if (!types.length) throw new ForbiddenException('You cannot view partner organisations');
    const typeFilter = q.type ? (types.includes(q.type) ? [q.type] : []) : types;
    const base: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      type: { in: typeFilter },
      ...(q.verification ? { verificationStatus: q.verification } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q } },
              { reraRegistrationNo: { contains: q.q, mode: 'insensitive' } },
              { members: { some: { user: { fullName: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const where: Prisma.OrganizationWhereInput = { ...base, ...(q.status ? { status: q.status } : {}) };
    const [rows, total, statusCounts, typeCounts] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          status: true,
          verificationStatus: true,
          email: true,
          phone: true,
          logoUrl: true,
          reraRegistrationNo: true,
          createdAt: true,
          verifiedAt: true,
          isDemo: true,
          city: { select: { name: true } },
          _count: {
            select: {
              members: { where: { status: 'ACTIVE' } },
              properties: { where: { deletedAt: null } },
              managedProjects: { where: { deletedAt: null } },
              documents: { where: { status: 'PENDING' } },
            },
          },
          subscriptions: { where: { status: 'ACTIVE' }, orderBy: { endsAt: 'desc' }, take: 1, select: { endsAt: true, plan: { select: { name: true } } } },
        },
        ...skipTake(q),
      }),
      this.prisma.organization.count({ where }),
      this.prisma.organization.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.organization.groupBy({ by: ['type'], where: { deletedAt: null, type: { in: types } }, _count: { _all: true } }),
    ]);
    const live = rows.length
      ? await this.prisma.property.groupBy({ by: ['organizationId'], where: { organizationId: { in: rows.map((r) => r.id) }, status: 'PUBLISHED', deletedAt: null }, _count: { _all: true } })
      : [];
    const liveBy = new Map(live.map((l) => [l.organizationId, l._count._all]));
    return {
      ...paginated(
        rows.map(({ _count, subscriptions, ...r }) => ({
          ...r,
          members: _count.members,
          listings: _count.properties,
          liveListings: liveBy.get(r.id) ?? 0,
          projects: _count.managedProjects,
          pendingDocuments: _count.documents,
          activePlan: subscriptions[0] ? { name: subscriptions[0].plan.name, endsAt: subscriptions[0].endsAt } : null,
        })),
        total,
        q,
      ),
      statusCounts: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
      typeCounts: Object.fromEntries(typeCounts.map((c) => [c.type, c._count._all])),
      visibleTypes: types,
    };
  }

  async detail(user: AuthUser, id: string) {
    await this.loadVisible(user, id);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id },
      include: {
        city: { select: { id: true, name: true } },
        verifiedBy: { select: { fullName: true } },
        members: {
          where: { status: { not: 'REMOVED' } },
          orderBy: [{ isOwner: 'desc' }, { joinedAt: 'asc' }],
          include: { user: { select: { id: true, fullName: true, email: true, phone: true, status: true, lastLoginAt: true } } },
        },
        userRoles: { select: { userId: true, role: { select: { key: true, name: true } } } },
        documents: {
          orderBy: { createdAt: 'desc' },
          include: { file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } }, reviewedBy: { select: { fullName: true } } },
        },
        brokerProfiles: { select: { id: true, userId: true, displayName: true, reraAgentNumber: true, experienceYears: true, verificationStatus: true } },
        developerProfile: { select: { establishedYear: true, projectsDelivered: true, about: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { plan: { select: { id: true, name: true, code: true, listingQuota: true, featuredQuota: true } }, createdBy: { select: { fullName: true } } } },
      },
    });
    const [listingCounts, projectCount, leadCount, history] = await Promise.all([
      this.prisma.property.groupBy({ by: ['status'], where: { organizationId: id, deletedAt: null }, _count: { _all: true } }),
      this.prisma.project.count({ where: { deletedAt: null, OR: [{ organizationId: id }, { developerOrgId: id }] } }),
      this.prisma.lead.count({ where: { organizationId: id, deletedAt: null } }),
      this.prisma.auditLog.findMany({
        where: { OR: [{ entityType: 'Organization', entityId: id }, { organizationId: id, action: { startsWith: 'partner.' } }] },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, action: true, createdAt: true, metadata: true, after: true, actor: { select: { fullName: true } } },
      }),
    ]);
    const { userRoles, ...rest } = org;
    return {
      ...rest,
      members: org.members.map((m) => ({
        ...m,
        roles: userRoles.filter((r) => r.userId === m.userId).map((r) => r.role),
      })),
      listingCounts: Object.fromEntries(listingCounts.map((c) => [c.status, c._count._all])),
      projectCount,
      leadCount,
      history,
      canVerify: user.hasGlobal(this.permFor(org.type, 'verify')),
      canManageSubscriptions: user.hasGlobal('subscription.manage'),
    };
  }

  async decide(user: AuthUser, id: string, input: z.output<typeof orgVerificationDecisionSchema>) {
    const org = await this.loadVisible(user, id);
    if (!user.hasGlobal(this.permFor(org.type, 'verify'))) throw new ForbiddenException('You cannot verify this type of organisation');
    const reason = input.reason?.trim();
    type Next = { status: 'ACTIVE' | 'REJECTED' | 'SUSPENDED'; verification?: 'VERIFIED' | 'REJECTED'; label: string };
    let next: Next;
    switch (input.decision) {
      case 'APPROVE':
        if (!['PENDING', 'REJECTED'].includes(org.status)) throw new ConflictException({ message: `An organisation that is ${enumLabel(org.status).toLowerCase()} cannot be approved`, code: 'INVALID_TRANSITION' });
        next = { status: 'ACTIVE', verification: 'VERIFIED', label: 'approved' };
        break;
      case 'REJECT':
        if (org.status !== 'PENDING') throw new ConflictException({ message: 'Only organisations awaiting verification can be rejected — suspend an active organisation instead', code: 'INVALID_TRANSITION' });
        if (!reason || reason.length < 3) throw new BadRequestException({ message: 'Give a reason for rejecting', details: [{ path: 'reason', message: 'Required' }] });
        next = { status: 'REJECTED', verification: 'REJECTED', label: 'rejected' };
        break;
      case 'SUSPEND':
        if (org.status !== 'ACTIVE') throw new ConflictException({ message: 'Only active organisations can be suspended', code: 'INVALID_TRANSITION' });
        if (!reason || reason.length < 3) throw new BadRequestException({ message: 'Give a reason for suspending', details: [{ path: 'reason', message: 'Required' }] });
        next = { status: 'SUSPENDED', label: 'suspended' };
        break;
      case 'REACTIVATE':
        if (org.status !== 'SUSPENDED') throw new ConflictException({ message: 'Only suspended organisations can be reactivated', code: 'INVALID_TRANSITION' });
        next = { status: 'ACTIVE', label: 'reactivated' };
        break;
    }
    if (input.projectPublishMode && org.type !== 'DEVELOPER') throw new BadRequestException('Project publishing mode applies to developer organisations only');
    const now = new Date();

    const outbox = await this.prisma.$transaction(async (tx) => {
      const res = await tx.organization.updateMany({
        where: { id, status: org.status },
        data: {
          status: next.status,
          ...(next.verification ? { verificationStatus: next.verification } : {}),
          ...(next.verification === 'VERIFIED' ? { verifiedAt: now, verifiedById: user.id, rejectionReason: null } : {}),
          ...(input.decision === 'REJECT' || input.decision === 'SUSPEND' ? { rejectionReason: reason } : {}),
          ...(input.decision === 'REACTIVATE' ? { rejectionReason: null } : {}),
          ...(input.projectPublishMode ? { projectPublishMode: input.projectPublishMode } : {}),
        },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'The organisation was changed by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      if (next.verification) await tx.brokerProfile.updateMany({ where: { organizationId: id }, data: { verificationStatus: next.verification } });
      await this.audit.log(
        {
          actorId: user.id,
          action: `partner.${input.decision.toLowerCase()}`,
          entityType: 'Organization',
          entityId: id,
          organizationId: id,
          before: { status: org.status, verificationStatus: org.verificationStatus, projectPublishMode: org.projectPublishMode },
          after: { status: next.status, verificationStatus: next.verification ?? org.verificationStatus, projectPublishMode: input.projectPublishMode ?? org.projectPublishMode },
          metadata: reason ? { reason } : undefined,
        },
        tx,
      );
      const owners = await tx.organizationMember.findMany({ where: { organizationId: id, isOwner: true, status: 'ACTIVE' }, select: { user: { select: { id: true, email: true, phone: true, fullName: true, status: true } } } });
      return this.notifications.notify(
        {
          eventKey: 'partner.decided',
          recipients: owners.filter((o) => o.user.status === 'ACTIVE').map((o) => ({ userId: o.user.id, email: o.user.email, phone: o.user.phone, name: o.user.fullName })),
          channels: ['IN_APP', 'EMAIL'],
          data: { organizationName: org.name, decision: next.label, reason: reason ? `Reason: ${reason}` : '' },
          link: `${env().CONSOLE_PUBLIC_URL}/organization`,
          relatedType: 'Organization',
          relatedId: id,
        },
        tx,
      );
    });
    this.notifications.kick(outbox);
    await this.invalidateMembers(id);
    return this.detail(user, id);
  }

  async setPublishMode(user: AuthUser, id: string, mode: 'REQUIRES_APPROVAL' | 'DIRECT') {
    const org = await this.loadVisible(user, id);
    if (org.type !== 'DEVELOPER') throw new BadRequestException('Project publishing mode applies to developer organisations only');
    if (!user.hasGlobal('developer.verify')) throw new ForbiddenException('You cannot change developer settings');
    await this.prisma.organization.update({ where: { id }, data: { projectPublishMode: mode } });
    await this.audit.log({ actorId: user.id, action: 'partner.publish_mode', entityType: 'Organization', entityId: id, organizationId: id, before: { projectPublishMode: org.projectPublishMode }, after: { projectPublishMode: mode } });
    return { id, projectPublishMode: mode };
  }

  async reviewDocument(user: AuthUser, orgId: string, docId: string, status: 'APPROVED' | 'REJECTED', note?: string) {
    const org = await this.loadVisible(user, orgId);
    if (!user.hasGlobal(this.permFor(org.type, 'verify'))) throw new ForbiddenException('You cannot review documents for this organisation');
    const doc = await this.prisma.organizationDocument.findFirst({ where: { id: docId, organizationId: orgId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (status === 'REJECTED' && !note?.trim()) throw new BadRequestException({ message: 'Explain why the document was rejected', details: [{ path: 'note', message: 'Required' }] });
    const updated = await this.prisma.organizationDocument.update({ where: { id: docId }, data: { status, reviewNote: note?.trim() || null, reviewedById: user.id, reviewedAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: 'partner.document_review', entityType: 'OrganizationDocument', entityId: docId, organizationId: orgId, before: { status: doc.status }, after: { status, note } });
    return updated;
  }

  private async invalidateMembers(orgId: string) {
    const members = await this.prisma.organizationMember.findMany({ where: { organizationId: orgId }, select: { userId: true } });
    members.forEach((m) => this.authContext.invalidateUser(m.userId));
  }

  // ───────────────────────── Subscription plans ─────────────────────────

  listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } },
    });
  }

  async createPlan(user: AuthUser, input: z.output<typeof subscriptionPlanSchema>) {
    if (await this.prisma.subscriptionPlan.findUnique({ where: { code: input.code } })) throw new ConflictException({ message: `A plan with code ${input.code} already exists`, code: 'DUPLICATE' });
    const plan = await this.prisma.subscriptionPlan.create({ data: input });
    await this.audit.log({ actorId: user.id, action: 'subscription.plan.create', entityType: 'SubscriptionPlan', entityId: plan.id, after: plan });
    return plan;
  }

  async updatePlan(user: AuthUser, id: string, input: Partial<z.output<typeof subscriptionPlanSchema>>) {
    const before = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found');
    if (input.code && input.code !== before.code && (await this.prisma.subscriptionPlan.findUnique({ where: { code: input.code } }))) {
      throw new ConflictException({ message: `A plan with code ${input.code} already exists`, code: 'DUPLICATE' });
    }
    const plan = await this.prisma.subscriptionPlan.update({ where: { id }, data: input });
    await this.audit.log({ actorId: user.id, action: 'subscription.plan.update', entityType: 'SubscriptionPlan', entityId: id, before, after: plan });
    return plan;
  }

  // ───────────────────────── Organisation subscriptions ─────────────────────────

  private async supersedeActive(tx: Tx, organizationId: string, exceptId: string | null, planName: string) {
    const active = await tx.organizationSubscription.findMany({ where: { organizationId, status: 'ACTIVE', ...(exceptId ? { id: { not: exceptId } } : {}) } });
    for (const s of active) {
      await tx.organizationSubscription.update({ where: { id: s.id }, data: { status: 'CANCELLED', notes: [s.notes, `Superseded by ${planName} on ${localDateString(new Date())}`].filter(Boolean).join('\n') } });
    }
    return active.length;
  }

  async assignSubscription(user: AuthUser, orgId: string, input: z.output<typeof subscriptionAssignSchema>) {
    const org = await this.loadVisible(user, orgId);
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException({ message: 'Choose an active plan', details: [{ path: 'planId', message: 'Invalid plan' }] });
    const startsAt = dateOnly(input.startsAt);
    const endsAt = addMonths(startsAt, BILLING_MONTHS[plan.billingPeriod]);
    const sub = await this.prisma.$transaction(async (tx) => {
      const superseded = input.activate ? await this.supersedeActive(tx, orgId, null, plan.name) : 0;
      const created = await tx.organizationSubscription.create({
        data: {
          organizationId: orgId,
          planId: plan.id,
          status: input.activate ? 'ACTIVE' : 'PENDING',
          startsAt,
          endsAt,
          amount: plan.price,
          paymentReference: input.paymentReference || null,
          notes: input.notes || null,
          createdById: user.id,
        },
      });
      await this.audit.log({ actorId: user.id, action: 'subscription.assign', entityType: 'OrganizationSubscription', entityId: created.id, organizationId: orgId, after: { plan: plan.code, status: created.status, startsAt, endsAt, amount: plan.price }, metadata: { organization: org.name, superseded } }, tx);
      return created;
    });
    return sub;
  }

  async activateSubscription(user: AuthUser, subId: string, paymentReference?: string) {
    const sub = await this.prisma.organizationSubscription.findUnique({ where: { id: subId }, include: { plan: true } });
    if (!sub) throw new NotFoundException('Subscription not found');
    await this.loadVisible(user, sub.organizationId);
    if (sub.status !== 'PENDING') throw new ConflictException('Only pending subscriptions can be activated');
    if (sub.endsAt < new Date()) throw new ConflictException('This subscription period has already ended — assign a new one');
    await this.prisma.$transaction(async (tx) => {
      await this.supersedeActive(tx, sub.organizationId, sub.id, sub.plan.name);
      await tx.organizationSubscription.update({ where: { id: subId }, data: { status: 'ACTIVE', ...(paymentReference ? { paymentReference } : {}) } });
      await this.audit.log({ actorId: user.id, action: 'subscription.activate', entityType: 'OrganizationSubscription', entityId: subId, organizationId: sub.organizationId, before: { status: sub.status }, after: { status: 'ACTIVE', paymentReference } }, tx);
    });
    return { ok: true };
  }

  async cancelSubscription(user: AuthUser, subId: string, reason?: string) {
    const sub = await this.prisma.organizationSubscription.findUnique({ where: { id: subId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    await this.loadVisible(user, sub.organizationId);
    if (!['PENDING', 'ACTIVE'].includes(sub.status)) throw new ConflictException('This subscription is no longer active');
    await this.prisma.organizationSubscription.update({ where: { id: subId }, data: { status: 'CANCELLED', notes: [sub.notes, reason ? `Cancelled: ${reason}` : 'Cancelled'].filter(Boolean).join('\n') } });
    await this.audit.log({ actorId: user.id, action: 'subscription.cancel', entityType: 'OrganizationSubscription', entityId: subId, organizationId: sub.organizationId, before: { status: sub.status }, after: { status: 'CANCELLED' }, metadata: reason ? { reason } : undefined });
    return { ok: true };
  }

  /** Marks lapsed subscriptions as expired (scheduled). */
  async expireSubscriptions(tx: Tx): Promise<number> {
    const res = await tx.organizationSubscription.updateMany({ where: { status: 'ACTIVE', endsAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
    return res.count;
  }
}
