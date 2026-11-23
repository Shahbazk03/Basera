import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePhone } from '@estate/shared';
import type { z } from 'zod';
import type { memberInviteSchema, organizationUpdateSchema, orgDocumentSchema } from '@estate/shared';
import { AccountType, OrganizationType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuditService } from '../../common/audit.service';
import { hashPassword } from '../../common/crypto';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';

/** System org-scoped roles an organisation may grant to its own members, by organisation type. */
const ORG_ROLE_KEYS: Record<OrganizationType, string[]> = {
  BROKERAGE: ['BROKER', 'BROKER_AGENT'],
  PARTNER: ['BROKER', 'BROKER_AGENT'],
  DEVELOPER: ['DEVELOPER'],
  INDIVIDUAL_OWNER: ['OWNER'],
  LEAD_PROVIDER: ['LEAD_PROVIDER'],
  PLATFORM: [],
};

const ACCOUNT_TYPE_BY_ORG: Record<OrganizationType, AccountType> = {
  BROKERAGE: 'BROKER',
  PARTNER: 'BROKER',
  DEVELOPER: 'DEVELOPER',
  INDIVIDUAL_OWNER: 'OWNER',
  LEAD_PROVIDER: 'LEAD_PROVIDER',
  PLATFORM: 'STAFF',
};

export interface BrokerProfileInput {
  displayName?: string;
  reraAgentNumber?: string | null;
  experienceYears?: number | null;
  languages?: string[];
  specializations?: string[];
  about?: string | null;
}

export interface DeveloperProfileInput {
  establishedYear?: number | null;
  projectsDelivered?: number | null;
  about?: string | null;
}

/** Self-service management of the caller's own organisation (organization.manage, scoped to that organisation). */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authContext: AuthContextService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
  ) {}

  private async own(user: AuthUser, orgId: string) {
    user.assert('organization.manage', orgId, 'You cannot manage this organisation');
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.type === 'PLATFORM') throw new ForbiddenException('The company profile is managed from Settings');
    return org;
  }

  async profile(user: AuthUser, orgId: string) {
    await this.own(user, orgId);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        status: true,
        verificationStatus: true,
        rejectionReason: true,
        verifiedAt: true,
        legalName: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        website: true,
        logoUrl: true,
        description: true,
        addressLine: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        pincode: true,
        gstin: true,
        panNumber: true,
        reraRegistrationNo: true,
        showContactPublicly: true,
        projectPublishMode: true,
        createdAt: true,
        developerProfile: { select: { establishedYear: true, projectsDelivered: true, about: true } },
        _count: { select: { members: { where: { status: 'ACTIVE' } }, documents: true } },
      },
    });
    const brokerProfile = await this.prisma.brokerProfile.findFirst({
      where: { userId: user.id, organizationId: orgId },
      select: { id: true, displayName: true, reraAgentNumber: true, experienceYears: true, languages: true, specializations: true, about: true, verificationStatus: true },
    });
    const listings = await this.prisma.property.groupBy({ by: ['status'], where: { organizationId: orgId, deletedAt: null }, _count: { _all: true } });
    return { ...org, myBrokerProfile: brokerProfile, listingCounts: Object.fromEntries(listings.map((l) => [l.status, l._count._all])) };
  }

  private validLogoUrl(url: string | null | undefined): string | null | undefined {
    if (url === undefined) return undefined;
    if (url === null || url === '') return null;
    const s3 = env().S3_PUBLIC_BASE_URL;
    if (url.startsWith('/uploads/') || (s3 && url.startsWith(s3))) return url;
    throw new BadRequestException({ message: 'Upload the logo with the uploader', details: [{ path: 'logoUrl', message: 'Invalid logo source' }] });
  }

  async updateProfile(user: AuthUser, orgId: string, input: z.output<typeof organizationUpdateSchema>) {
    const before = await this.own(user, orgId);
    if (input.cityId && !(await this.prisma.city.findUnique({ where: { id: input.cityId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Choose a valid city', details: [{ path: 'cityId', message: 'Invalid city' }] });
    }
    const phone = (v: string | null | undefined, path: string) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const n = normalizePhone(v);
      if (!n) throw new BadRequestException({ message: 'Enter a valid mobile number', details: [{ path, message: 'Invalid number' }] });
      return n;
    };
    const data: Prisma.OrganizationUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName || null } : {}),
      ...(input.email !== undefined ? { email: input.email ? input.email.toLowerCase() : null } : {}),
      ...(input.phone !== undefined ? { phone: phone(input.phone, 'phone') } : {}),
      ...(input.whatsappNumber !== undefined ? { whatsappNumber: phone(input.whatsappNumber, 'whatsappNumber') } : {}),
      ...(input.website !== undefined ? { website: input.website || null } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: this.validLogoUrl(input.logoUrl) } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.addressLine !== undefined ? { addressLine: input.addressLine || null } : {}),
      ...(input.cityId !== undefined ? { cityId: input.cityId || null } : {}),
      ...(input.pincode !== undefined ? { pincode: input.pincode || null } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin || null } : {}),
      ...(input.panNumber !== undefined ? { panNumber: input.panNumber || null } : {}),
      ...(input.reraRegistrationNo !== undefined ? { reraRegistrationNo: input.reraRegistrationNo || null } : {}),
      ...(input.showContactPublicly !== undefined ? { showContactPublicly: input.showContactPublicly } : {}),
    };
    const after = await this.prisma.organization.update({ where: { id: orgId }, data });
    await this.audit.log({
      actorId: user.id,
      action: 'organization.update',
      entityType: 'Organization',
      entityId: orgId,
      organizationId: orgId,
      before: Object.fromEntries(Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]])),
      after: data,
    });
    await this.invalidateMembers(orgId);
    return this.profile(user, orgId);
  }

  async updateBrokerProfile(user: AuthUser, orgId: string, input: BrokerProfileInput) {
    const org = await this.own(user, orgId);
    if (org.type !== 'BROKERAGE' && org.type !== 'PARTNER') throw new BadRequestException('Broker profiles apply to brokerages only');
    const existing = await this.prisma.brokerProfile.findFirst({ where: { userId: user.id } });
    if (existing && existing.organizationId !== orgId) throw new ConflictException('Your broker profile belongs to another organisation');
    const data = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.reraAgentNumber !== undefined ? { reraAgentNumber: input.reraAgentNumber || null } : {}),
      ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
      ...(input.languages !== undefined ? { languages: input.languages } : {}),
      ...(input.specializations !== undefined ? { specializations: input.specializations } : {}),
      ...(input.about !== undefined ? { about: input.about || null } : {}),
    };
    const profile = existing
      ? await this.prisma.brokerProfile.update({ where: { id: existing.id }, data })
      : await this.prisma.brokerProfile.create({ data: { userId: user.id, organizationId: orgId, displayName: input.displayName ?? user.fullName, ...data, verificationStatus: org.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING' } });
    await this.audit.log({ actorId: user.id, action: 'organization.broker_profile.update', entityType: 'BrokerProfile', entityId: profile.id, organizationId: orgId, after: data });
    return profile;
  }

  async updateDeveloperProfile(user: AuthUser, orgId: string, input: DeveloperProfileInput) {
    const org = await this.own(user, orgId);
    if (org.type !== 'DEVELOPER') throw new BadRequestException('Developer profiles apply to developer organisations only');
    const data = {
      ...(input.establishedYear !== undefined ? { establishedYear: input.establishedYear } : {}),
      ...(input.projectsDelivered !== undefined ? { projectsDelivered: input.projectsDelivered } : {}),
      ...(input.about !== undefined ? { about: input.about || null } : {}),
    };
    const profile = await this.prisma.developerProfile.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
    await this.audit.log({ actorId: user.id, action: 'organization.developer_profile.update', entityType: 'DeveloperProfile', entityId: profile.id, organizationId: orgId, after: data });
    return profile;
  }

  /** A rejected organisation can correct its details and documents, then ask for verification again. */
  async resubmit(user: AuthUser, orgId: string) {
    const org = await this.own(user, orgId);
    if (org.status !== 'REJECTED') throw new ConflictException('Only rejected organisations can be resubmitted for verification');
    const outbox = await this.prisma.$transaction(async (tx) => {
      const res = await tx.organization.updateMany({ where: { id: orgId, status: 'REJECTED' }, data: { status: 'PENDING', verificationStatus: 'PENDING' } });
      if (res.count !== 1) throw new ConflictException('The organisation was changed by someone else');
      await tx.brokerProfile.updateMany({ where: { organizationId: orgId }, data: { verificationStatus: 'PENDING' } });
      await this.audit.log({ actorId: user.id, action: 'partner.resubmit', entityType: 'Organization', entityId: orgId, organizationId: orgId, before: { status: 'REJECTED' }, after: { status: 'PENDING' } }, tx);
      const reviewers = await this.notifications.recipientsWithPermission(org.type === 'DEVELOPER' ? 'developer.verify' : 'broker.verify', null);
      return this.notifications.notify(
        {
          eventKey: 'partner.registered',
          recipients: reviewers,
          channels: ['IN_APP'],
          data: { organizationName: org.name, partnerType: org.type.replace('_', ' ').toLowerCase() },
          link: `/partners/${orgId}`,
          relatedType: 'Organization',
          relatedId: orgId,
        },
        tx,
      );
    });
    this.notifications.kick(outbox);
    await this.invalidateMembers(orgId);
    return this.profile(user, orgId);
  }

  // ───────────────────────── Documents ─────────────────────────

  async documents(user: AuthUser, orgId: string) {
    await this.own(user, orgId);
    return this.prisma.organizationDocument.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, docType: true, title: true, status: true, reviewNote: true, reviewedAt: true, createdAt: true, file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } } },
    });
  }

  async addDocument(user: AuthUser, orgId: string, input: z.output<typeof orgDocumentSchema>) {
    await this.own(user, orgId);
    const file = await this.prisma.storedFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.deletedAt || file.visibility !== 'PRIVATE') throw new BadRequestException('Upload the document with purpose "org-document" first');
    if (file.uploadedById !== user.id && file.organizationId !== orgId) throw new ForbiddenException('You cannot attach this file');
    if (await this.prisma.organizationDocument.findFirst({ where: { fileId: file.id } })) throw new ConflictException('This file is already attached');
    const doc = await this.prisma.organizationDocument.create({ data: { organizationId: orgId, docType: input.docType, title: input.title, fileId: file.id } });
    await this.audit.log({ actorId: user.id, action: 'organization.document.add', entityType: 'OrganizationDocument', entityId: doc.id, organizationId: orgId, after: { docType: doc.docType, title: doc.title } });
    return doc;
  }

  async removeDocument(user: AuthUser, orgId: string, docId: string) {
    await this.own(user, orgId);
    const doc = await this.prisma.organizationDocument.findFirst({ where: { id: docId, organizationId: orgId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status === 'APPROVED' && !user.hasGlobal('broker.verify') && !user.hasGlobal('developer.verify')) {
      throw new ConflictException('Approved documents can only be removed by the verification team');
    }
    await this.prisma.organizationDocument.delete({ where: { id: docId } });
    await this.audit.log({ actorId: user.id, action: 'organization.document.remove', entityType: 'OrganizationDocument', entityId: docId, organizationId: orgId, before: { title: doc.title, status: doc.status } });
    return { ok: true };
  }

  // ───────────────────────── Team ─────────────────────────

  async members(user: AuthUser, orgId: string) {
    const org = await this.own(user, orgId);
    const [members, grants, roles] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where: { organizationId: orgId, status: { not: 'REMOVED' } },
        orderBy: [{ isOwner: 'desc' }, { joinedAt: 'asc' }],
        include: { user: { select: { id: true, fullName: true, email: true, phone: true, status: true, lastLoginAt: true } } },
      }),
      this.prisma.userRole.findMany({ where: { organizationId: orgId }, select: { id: true, userId: true, role: { select: { key: true, name: true } } } }),
      this.assignableRoles(org.type),
    ]);
    return {
      members: members.map((m) => ({ ...m, roles: grants.filter((g) => g.userId === m.userId).map((g) => g.role), isSelf: m.userId === user.id })),
      assignableRoles: roles,
    };
  }

  private async assignableRoles(type: OrganizationType) {
    const roles = await this.prisma.role.findMany({ where: { scope: 'ORGANIZATION' }, select: { id: true, key: true, name: true, description: true, isSystem: true }, orderBy: { name: 'asc' } });
    return roles.filter((r) => (r.isSystem ? ORG_ROLE_KEYS[type].includes(r.key) : true));
  }

  private async resolveAssignableRole(type: OrganizationType, roleKey: string) {
    const role = (await this.assignableRoles(type)).find((r) => r.key === roleKey);
    if (!role) throw new BadRequestException({ message: 'This role cannot be assigned in your organisation', details: [{ path: 'roleKey', message: 'Not allowed' }] });
    return role;
  }

  async invite(user: AuthUser, orgId: string, input: z.output<typeof memberInviteSchema>) {
    const org = await this.own(user, orgId);
    const role = await this.resolveAssignableRole(org.type, input.roleKey);
    const email = input.email.toLowerCase();
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] } });
    if (existing) {
      if (existing.deletedAt || existing.status !== 'ACTIVE') throw new ConflictException('This account is not active and cannot be added');
      if (existing.email !== email) throw new ConflictException('This mobile number belongs to a different account');
      const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: existing.id } } });
      if (membership && membership.status !== 'REMOVED') throw new ConflictException('This person is already a member of your organisation');
    }
    const passwordHash = existing ? null : await hashPassword(input.password);
    const result = await this.prisma.$transaction(async (tx) => {
      const member =
        existing ??
        (await tx.user.create({
          data: { email, phone, fullName: input.fullName, passwordHash, accountType: ACCOUNT_TYPE_BY_ORG[org.type] },
        }));
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: orgId, userId: member.id } },
        create: { organizationId: orgId, userId: member.id, title: input.title ?? null, status: 'ACTIVE' },
        update: { status: 'ACTIVE', title: input.title ?? null },
      });
      const already = await tx.userRole.findFirst({ where: { userId: member.id, roleId: role.id, organizationId: orgId } });
      if (!already) await tx.userRole.create({ data: { userId: member.id, roleId: role.id, organizationId: orgId, grantedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'organization.member.add', entityType: 'Organization', entityId: orgId, organizationId: orgId, after: { userId: member.id, email, role: role.key, existingAccount: Boolean(existing) } }, tx);
      return { userId: member.id, created: !existing };
    });
    this.authContext.invalidateUser(result.userId);
    if (result.created) await this.auth.sendEmailVerification(result.userId, env().CONSOLE_PUBLIC_URL);
    return { ...result, message: result.created ? 'Account created. Share the sign-in details securely; a verification email was queued.' : 'Existing account added to your organisation.' };
  }

  async updateMember(user: AuthUser, orgId: string, memberUserId: string, input: { roleKey?: string; title?: string | null }) {
    const org = await this.own(user, orgId);
    if (memberUserId === user.id && input.roleKey) throw new ForbiddenException('You cannot change your own role');
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: memberUserId } } });
    if (!membership || membership.status === 'REMOVED') throw new NotFoundException('Member not found');
    if (membership.isOwner && input.roleKey) throw new ForbiddenException('The owner’s role cannot be changed');
    await this.prisma.$transaction(async (tx) => {
      if (input.title !== undefined) await tx.organizationMember.update({ where: { id: membership.id }, data: { title: input.title || null } });
      if (input.roleKey) {
        const role = await this.resolveAssignableRole(org.type, input.roleKey);
        const orgRoleIds = (await this.assignableRoles(org.type)).map((r) => r.id);
        await tx.userRole.deleteMany({ where: { userId: memberUserId, organizationId: orgId, roleId: { in: orgRoleIds } } });
        await tx.userRole.create({ data: { userId: memberUserId, roleId: role.id, organizationId: orgId, grantedById: user.id } });
      }
      await this.audit.log({ actorId: user.id, action: 'organization.member.update', entityType: 'Organization', entityId: orgId, organizationId: orgId, after: { userId: memberUserId, ...input } }, tx);
    });
    this.authContext.invalidateUser(memberUserId);
    return { ok: true };
  }

  async removeMember(user: AuthUser, orgId: string, memberUserId: string) {
    await this.own(user, orgId);
    if (memberUserId === user.id) throw new ForbiddenException('You cannot remove yourself — ask another administrator of your organisation');
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: memberUserId } } });
    if (!membership || membership.status === 'REMOVED') throw new NotFoundException('Member not found');
    if (membership.isOwner) throw new ForbiddenException('The organisation owner cannot be removed');
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: memberUserId, organizationId: orgId } });
      await tx.organizationMember.update({ where: { id: membership.id }, data: { status: 'REMOVED' } });
      await this.audit.log({ actorId: user.id, action: 'organization.member.remove', entityType: 'Organization', entityId: orgId, organizationId: orgId, before: { userId: memberUserId } }, tx);
    });
    this.authContext.invalidateUser(memberUserId);
    return { ok: true };
  }

  // ───────────────────────── Subscription ─────────────────────────

  async subscription(user: AuthUser, orgId: string) {
    await this.own(user, orgId);
    const now = new Date();
    const [history, live, featured, plans] = await Promise.all([
      this.prisma.organizationSubscription.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, include: { plan: true } }),
      this.prisma.property.count({ where: { organizationId: orgId, status: 'PUBLISHED', deletedAt: null } }),
      this.prisma.property.count({ where: { organizationId: orgId, status: 'PUBLISHED', isFeatured: true, deletedAt: null } }),
      this.prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }] }),
    ]);
    const current = history.find((s) => s.status === 'ACTIVE' && s.startsAt <= now && s.endsAt >= now) ?? null;
    return { current, history, usage: { liveListings: live, featuredListings: featured }, plans };
  }

  private async invalidateMembers(orgId: string) {
    const members = await this.prisma.organizationMember.findMany({ where: { organizationId: orgId }, select: { userId: true } });
    members.forEach((m) => this.authContext.invalidateUser(m.userId));
  }
}
