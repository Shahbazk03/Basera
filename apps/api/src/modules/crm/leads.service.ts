import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import {
  canTransitionLead,
  LEAD_IMPORT_COLUMNS,
  LEAD_STATUS_TRANSITIONS,
  normalizePhone,
  type LeadStatus,
} from '@estate/shared';
import type { z } from 'zod';
import type { activityCreateSchema, followUpCompleteSchema, followUpCreateSchema, leadCreateSchema, leadImportSchema, leadUpdateSchema } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { nextReference } from '../../common/references';
import { paginated, Pagination, skipTake } from '../../common/http';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignmentService } from './assignment.service';
import { assertLeadAccess, canEditLead, isAssignable, leadListSelect, leadScope, OPEN_LEAD_WHERE, resolveOrg } from './crm-access';

export interface LeadListQuery extends Pagination {
  status?: LeadStatus;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'HOT';
  source?: string;
  assignee?: string;
  projectId?: string;
  propertyId?: string;
  campaignId?: string;
  organizationId?: string;
  q?: string;
  from?: string;
  to?: string;
  followUp?: 'today' | 'overdue';
  intake?: 'accepted' | 'all' | 'duplicates';
  sort?: 'newest' | 'oldest' | 'followup' | 'priority' | 'updated';
}

const ACTIVE_CONTACT_TYPES = new Set(['CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'MEETING']);
const MAX_IMPORT_ROWS = 1000;

function istDayBounds(now = new Date()): { start: Date; end: Date } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = ist.toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly assignment: AssignmentService,
  ) {}

  // ───────────────────────── Lists ─────────────────────────

  buildWhere(user: AuthUser, q: Omit<LeadListQuery, 'page' | 'pageSize'>): Prisma.LeadWhereInput {
    const and: Prisma.LeadWhereInput[] = [leadScope(user), { deletedAt: null }];
    if (q.intake === 'duplicates') and.push({ OR: [{ isDuplicate: true }, { intakeStatus: 'DUPLICATE' }] });
    else if (q.intake !== 'all') and.push({ isDuplicate: false, intakeStatus: 'ACCEPTED' });
    if (q.status) and.push({ status: q.status });
    if (q.priority) and.push({ priority: q.priority });
    if (q.source) and.push({ source: { key: q.source } });
    if (q.assignee === 'unassigned') and.push({ assignedToId: null });
    else if (q.assignee === 'me') and.push({ assignedToId: user.id });
    else if (q.assignee) and.push({ assignedToId: q.assignee });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.propertyId) and.push({ propertyId: q.propertyId });
    if (q.campaignId) and.push({ campaignId: q.campaignId });
    if (q.organizationId) and.push({ organizationId: q.organizationId });
    if (q.from) and.push({ createdAt: { gte: new Date(`${q.from}T00:00:00+05:30`) } });
    if (q.to) and.push({ createdAt: { lt: new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000) } });
    if (q.followUp) {
      const { start, end } = istDayBounds();
      and.push(q.followUp === 'today' ? { nextFollowUpAt: { gte: start, lt: end } } : { nextFollowUpAt: { lt: new Date() }, ...OPEN_LEAD_WHERE });
    }
    if (q.q) {
      const term = q.q.trim();
      const phone = normalizePhone(term);
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { leadNo: { equals: term.toUpperCase() } },
          { phone: { contains: phone ?? term.replace(/\s/g, '') } },
        ],
      });
    }
    return { AND: and };
  }

  async list(user: AuthUser, q: LeadListQuery) {
    const where = this.buildWhere(user, q);
    const countsWhere = this.buildWhere(user, { ...q, status: undefined });
    const orderBy: Prisma.LeadOrderByWithRelationInput[] =
      q.sort === 'oldest'
        ? [{ createdAt: 'asc' }]
        : q.sort === 'followup'
          ? [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }]
          : q.sort === 'priority'
            ? [{ priority: 'desc' }, { createdAt: 'desc' }]
            : q.sort === 'updated'
              ? [{ updatedAt: 'desc' }]
              : [{ createdAt: 'desc' }];
    const [rows, total, counts] = await Promise.all([
      this.prisma.lead.findMany({ where, select: leadListSelect, orderBy: [...orderBy, { id: 'asc' }], ...skipTake(q) }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['status'], where: countsWhere, _count: { _all: true } }),
    ]);
    return { ...paginated(rows, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  async detail(user: AuthUser, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true, type: true } },
        customer: { select: { id: true, fullName: true, phone: true, email: true, alternatePhone: true, city: true, occupation: true } },
        source: { select: { key: true, name: true } },
        campaign: { select: { id: true, name: true, code: true } },
        leadProvider: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, slug: true } },
        property: { select: { id: true, title: true, slug: true, referenceCode: true, price: true, listingType: true } },
        unit: { select: { id: true, code: true, status: true, totalPrice: true } },
        preferredCity: { select: { id: true, name: true } },
        preferredLocality: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, fullName: true, email: true, phone: true } },
        assignedTeam: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        duplicateOf: { select: { id: true, leadNo: true, status: true } },
        _count: { select: { duplicates: true } },
        activities: { orderBy: { occurredAt: 'desc' }, take: 200, include: { performedBy: { select: { id: true, fullName: true } } } },
        assignments: { orderBy: { assignedAt: 'desc' }, include: { assignedTo: { select: { fullName: true } }, assignedBy: { select: { fullName: true } }, rule: { select: { name: true } }, team: { select: { name: true } } } },
        followUps: { orderBy: { dueAt: 'asc' }, include: { assignedTo: { select: { id: true, fullName: true } } } },
        siteVisits: {
          orderBy: { scheduledAt: 'desc' },
          include: { assignedTo: { select: { id: true, fullName: true } }, property: { select: { id: true, title: true } }, project: { select: { id: true, name: true } }, unit: { select: { id: true, code: true } } },
        },
        enquiries: { orderBy: { createdAt: 'desc' }, select: { id: true, referenceNo: true, type: true, status: true, message: true, sourcePage: true, preferredDate: true, preferredTimeSlot: true, createdAt: true } },
        deals: { orderBy: { createdAt: 'desc' }, select: { id: true, dealNo: true, status: true, dealValue: true, dealType: true, createdAt: true } },
        reservations: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, expiresAt: true, createdAt: true, unit: { select: { id: true, code: true, project: { select: { name: true } } } } } },
        tasks: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, dueAt: true, assignedTo: { select: { fullName: true } } } },
      },
    });
    assertLeadAccess(user, lead);
    const l = lead!;
    return {
      ...l,
      allowedStatuses: canEditLead(user, l) ? LEAD_STATUS_TRANSITIONS[l.status] : [],
      canEdit: canEditLead(user, l),
      canAssign: user.can('lead.assign', l.organizationId),
      canManageVisits: user.can('site_visit.manage', l.organizationId),
      canCreateDeal: user.can('deal.manage', l.organizationId),
    };
  }

  private async loadForUpdate(user: AuthUser, id: string, mode: 'view' | 'edit' = 'edit') {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, leadNo: true, name: true, status: true, organizationId: true, assignedToId: true, nextFollowUpAt: true, property: { select: { title: true } }, project: { select: { name: true } }, unit: { select: { code: true } } },
    });
    assertLeadAccess(user, lead, mode);
    return lead!;
  }

  // ───────────────────────── Create / update ─────────────────────────

  async create(user: AuthUser, input: z.output<typeof leadCreateSchema>) {
    const organizationId = resolveOrg(user, 'lead.create', input.organizationId);
    const phone = normalizePhone(input.phone)!;
    const source = await this.prisma.leadSource.findUnique({ where: { key: input.sourceKey } });
    if (!source || !source.isActive) throw new BadRequestException({ message: 'Unknown lead source', details: [{ path: 'sourceKey', message: 'Invalid source' }] });
    if (input.assignToUserId) {
      user.assert('lead.assign', organizationId, 'You cannot assign leads in this organisation');
      if (!(await isAssignable(this.prisma, organizationId, input.assignToUserId))) throw new BadRequestException({ message: 'The selected person cannot receive leads', details: [{ path: 'assignToUserId', message: 'Not assignable' }] });
    }
    await this.validateRefs(organizationId, input);

    const windowDays = await this.settings.getNumber('leads.duplicateWindowDays');
    const existing = await this.prisma.lead.findFirst({
      where: { ...OPEN_LEAD_WHERE, organizationId, phone, createdAt: { gte: new Date(Date.now() - windowDays * 86_400_000) } },
      select: { id: true, leadNo: true, name: true, status: true, assignedTo: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await this.prisma.leadActivity.create({
        data: { leadId: existing.id, type: 'SYSTEM', summary: 'Manual entry matched this open lead', details: `Attempted by ${user.fullName} via ${source.name}`, performedById: user.id },
      });
      await this.audit.log({ actorId: user.id, action: 'lead.create_duplicate_blocked', entityType: 'Lead', entityId: existing.id, organizationId });
      return { created: false, lead: existing };
    }

    const outbox: string[] = [];
    const lead = await this.prisma.$transaction(async (tx) => {
      const customer = await this.upsertCustomer(tx, organizationId, { name: input.name, phone, email: input.email || null });
      const created = await tx.lead.create({
        data: {
          leadNo: await nextReference(tx, 'LD'),
          organizationId,
          customerId: customer.id,
          name: input.name,
          phone,
          email: input.email || null,
          sourceId: source.id,
          campaignId: input.campaignId ?? null,
          propertyId: input.propertyId ?? null,
          projectId: input.projectId ?? null,
          unitId: input.unitId ?? null,
          enquiryType: input.enquiryType,
          listingType: input.listingType ?? null,
          budgetMin: input.budgetMin ?? null,
          budgetMax: input.budgetMax ?? null,
          preferredCityId: input.preferredCityId ?? null,
          preferredLocalityId: input.preferredLocalityId ?? null,
          locationPreference: input.locationPreference ?? null,
          requirement: input.requirement ?? null,
          priority: input.priority,
          tags: input.tags ?? [],
          createdById: user.id,
        },
        select: { id: true, leadNo: true, name: true, status: true, organizationId: true, assignedToId: true, property: { select: { title: true } }, project: { select: { name: true } }, unit: { select: { code: true } } },
      });
      await tx.leadActivity.create({ data: { leadId: created.id, type: 'SYSTEM', summary: `Lead created manually (${source.name})`, performedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'lead.create', entityType: 'Lead', entityId: created.id, organizationId, after: { leadNo: created.leadNo, source: source.key } }, tx);
      if (input.assignToUserId) {
        outbox.push(...(await this.assignment.assignInTx(tx, created, input.assignToUserId, { method: 'MANUAL', assignedById: user.id, reason: 'Assigned at creation' })));
      } else if (input.autoAssign && (await this.assignment.autoAssignEnabled(tx))) {
        outbox.push(...(await this.assignment.autoAssign(tx, created.id)).outbox);
      }
      return created;
    });
    this.notifications.kick(outbox);
    return { created: true, lead: await this.prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, select: leadListSelect }) };
  }

  async upsertCustomer(tx: Tx, organizationId: string, c: { name: string; phone: string; email: string | null; userId?: string | null; city?: string | null }) {
    const existing = await tx.customer.findUnique({ where: { organizationId_phone: { organizationId, phone: c.phone } } });
    if (existing) {
      const patch: Prisma.CustomerUpdateInput = {};
      if (!existing.email && c.email) patch.email = c.email;
      if (!existing.userId && c.userId) patch.user = { connect: { id: c.userId } };
      if (existing.deletedAt) patch.deletedAt = null;
      return Object.keys(patch).length ? tx.customer.update({ where: { id: existing.id }, data: patch }) : existing;
    }
    return tx.customer.create({ data: { organizationId, fullName: c.name, phone: c.phone, email: c.email, userId: c.userId ?? null, city: c.city ?? null } });
  }

  private async validateRefs(organizationId: string, input: { propertyId?: string | null; projectId?: string | null; unitId?: string | null; campaignId?: string | null }) {
    if (input.propertyId) {
      const p = await this.prisma.property.findFirst({ where: { id: input.propertyId, deletedAt: null }, select: { id: true } });
      if (!p) throw new BadRequestException({ message: 'Property not found', details: [{ path: 'propertyId', message: 'Invalid property' }] });
    }
    if (input.projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true } });
      if (!p) throw new BadRequestException({ message: 'Project not found', details: [{ path: 'projectId', message: 'Invalid project' }] });
    }
    if (input.unitId) {
      const u = await this.prisma.projectUnit.findUnique({ where: { id: input.unitId }, select: { projectId: true } });
      if (!u || (input.projectId && u.projectId !== input.projectId)) throw new BadRequestException({ message: 'Unit does not belong to the project', details: [{ path: 'unitId', message: 'Invalid unit' }] });
    }
    if (input.campaignId) {
      const c = await this.prisma.campaign.findFirst({ where: { id: input.campaignId, organizationId }, select: { id: true } });
      if (!c) throw new BadRequestException({ message: 'Campaign not found', details: [{ path: 'campaignId', message: 'Invalid campaign' }] });
    }
  }

  async update(user: AuthUser, id: string, input: z.output<typeof leadUpdateSchema>) {
    const lead = await this.loadForUpdate(user, id);
    await this.validateRefs(lead.organizationId, input);
    const before = await this.prisma.lead.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email || null } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.listingType !== undefined ? { listingType: input.listingType } : {}),
          ...(input.budgetMin !== undefined ? { budgetMin: input.budgetMin } : {}),
          ...(input.budgetMax !== undefined ? { budgetMax: input.budgetMax } : {}),
          ...(input.preferredCityId !== undefined ? { preferredCityId: input.preferredCityId } : {}),
          ...(input.preferredLocalityId !== undefined ? { preferredLocalityId: input.preferredLocalityId } : {}),
          ...(input.locationPreference !== undefined ? { locationPreference: input.locationPreference } : {}),
          ...(input.requirement !== undefined ? { requirement: input.requirement } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.propertyId !== undefined ? { propertyId: input.propertyId } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        },
      });
      if (input.priority && input.priority !== before.priority) {
        await tx.leadActivity.create({ data: { leadId: id, type: 'SYSTEM', summary: `Priority changed to ${input.priority.toLowerCase()}`, performedById: user.id } });
      }
      await this.audit.log({ actorId: user.id, action: 'lead.update', entityType: 'Lead', entityId: id, organizationId: lead.organizationId, before: pick(before, Object.keys(input)), after: input }, tx);
      return row;
    });
    return updated;
  }

  async changeStatus(user: AuthUser, id: string, to: LeadStatus, note?: string, lostReason?: string) {
    const lead = await this.loadForUpdate(user, id);
    const from = lead.status as LeadStatus;
    if (from === to) throw new ConflictException({ message: 'The lead already has this status', code: 'NO_CHANGE' });
    if (!canTransitionLead(from, to)) {
      throw new ConflictException({ message: `A ${from.replace(/_/g, ' ').toLowerCase()} lead cannot move to ${to.replace(/_/g, ' ').toLowerCase()}`, code: 'INVALID_TRANSITION' });
    }
    if (to === 'CONVERTED') throw new ConflictException({ message: 'Record a deal to convert a lead', code: 'DEAL_REQUIRED' });
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.lead.updateMany({
        where: { id, status: from },
        data: { status: to, ...(to === 'LOST' ? { lostReason: lostReason ?? note ?? null } : {}), ...(from === 'LOST' ? { lostReason: null } : {}) },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This lead was updated by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      await tx.leadActivity.create({
        data: {
          leadId: id,
          type: 'STATUS_CHANGE',
          summary: `Status changed from ${from.replace(/_/g, ' ').toLowerCase()} to ${to.replace(/_/g, ' ').toLowerCase()}`,
          details: to === 'LOST' ? `Reason: ${lostReason ?? note}` : (note ?? null),
          metadata: { from, to },
          performedById: user.id,
        },
      });
      if (to === 'LOST') await tx.leadFollowUp.updateMany({ where: { leadId: id, status: 'PENDING' }, data: { status: 'CANCELLED', outcome: 'Lead marked as lost' } });
      if (to === 'LOST') await tx.lead.update({ where: { id }, data: { nextFollowUpAt: null } });
      await this.audit.log({ actorId: user.id, action: 'lead.status', entityType: 'Lead', entityId: id, organizationId: lead.organizationId, before: { status: from }, after: { status: to }, metadata: note || lostReason ? { note, lostReason } : undefined }, tx);
    });
    return this.detail(user, id);
  }

  // ───────────────────────── Assignment ─────────────────────────

  async assign(user: AuthUser, id: string, assigneeId: string, reason?: string) {
    const lead = await this.loadForUpdate(user, id, 'view');
    user.assert('lead.assign', lead.organizationId, 'You cannot assign leads in this organisation');
    if (lead.assignedToId === assigneeId) throw new ConflictException({ message: 'The lead is already assigned to this person', code: 'NO_CHANGE' });
    if (!(await isAssignable(this.prisma, lead.organizationId, assigneeId))) throw new BadRequestException({ message: 'This person cannot receive leads in this organisation', details: [{ path: 'userId', message: 'Not assignable' }] });
    const outbox = await this.prisma.$transaction((tx) => this.assignment.assignInTx(tx, lead, assigneeId, { method: 'MANUAL', assignedById: user.id, reason: reason ?? null }));
    this.notifications.kick(outbox);
    return this.detail(user, id);
  }

  async bulkAssign(user: AuthUser, leadIds: string[], opts: { userId?: string; auto: boolean }) {
    if (!opts.auto && !opts.userId) throw new BadRequestException({ message: 'Choose a person or automatic assignment', details: [{ path: 'userId', message: 'Required' }] });
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: leadIds }, deletedAt: null, ...leadScope(user) },
      select: { id: true, leadNo: true, name: true, status: true, organizationId: true, assignedToId: true, property: { select: { title: true } }, project: { select: { name: true } }, unit: { select: { code: true } } },
    });
    const results: { leadId: string; leadNo?: string; outcome: 'ASSIGNED' | 'SKIPPED'; detail: string }[] = [];
    const found = new Set(leads.map((l) => l.id));
    for (const missing of leadIds.filter((x) => !found.has(x))) results.push({ leadId: missing, outcome: 'SKIPPED', detail: 'Not found or not in your scope' });
    const outbox: string[] = [];
    for (const lead of leads) {
      if (!user.can('lead.assign', lead.organizationId)) {
        results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: 'SKIPPED', detail: 'No permission to assign in this organisation' });
        continue;
      }
      if (['CONVERTED', 'LOST'].includes(lead.status)) {
        results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: 'SKIPPED', detail: 'Closed lead' });
        continue;
      }
      if (opts.auto) {
        if (lead.assignedToId) {
          results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: 'SKIPPED', detail: 'Already assigned' });
          continue;
        }
        const r = await this.prisma.$transaction((tx) => this.assignment.autoAssign(tx, lead.id));
        outbox.push(...r.outbox);
        results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: r.assigneeId ? 'ASSIGNED' : 'SKIPPED', detail: r.reason });
      } else {
        if (lead.assignedToId === opts.userId) {
          results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: 'SKIPPED', detail: 'Already assigned to this person' });
          continue;
        }
        if (!(await isAssignable(this.prisma, lead.organizationId, opts.userId!))) {
          results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: 'SKIPPED', detail: 'Person cannot receive leads in this organisation' });
          continue;
        }
        outbox.push(...(await this.prisma.$transaction((tx) => this.assignment.assignInTx(tx, lead, opts.userId!, { method: 'MANUAL', assignedById: user.id, reason: 'Bulk assignment' }))));
        results.push({ leadId: lead.id, leadNo: lead.leadNo, outcome: 'ASSIGNED', detail: 'Assigned' });
      }
    }
    this.notifications.kick(outbox);
    return { assigned: results.filter((r) => r.outcome === 'ASSIGNED').length, skipped: results.filter((r) => r.outcome === 'SKIPPED').length, results };
  }

  // ───────────────────────── Activities & follow-ups ─────────────────────────

  async logActivity(user: AuthUser, id: string, input: z.output<typeof activityCreateSchema>) {
    const lead = await this.loadForUpdate(user, id);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException({ message: 'Activities cannot be logged in the future', details: [{ path: 'occurredAt', message: 'Future date' }] });
    const activity = await this.prisma.$transaction(async (tx) => {
      const a = await tx.leadActivity.create({
        data: { leadId: id, type: input.type, direction: input.direction ?? null, outcome: input.outcome ?? null, summary: input.summary, details: input.details ?? null, durationSeconds: input.durationSeconds ?? null, occurredAt, performedById: user.id },
        include: { performedBy: { select: { id: true, fullName: true } } },
      });
      if (ACTIVE_CONTACT_TYPES.has(input.type)) await tx.lead.update({ where: { id }, data: { lastContactedAt: occurredAt } });
      await this.audit.log({ actorId: user.id, action: 'lead.activity', entityType: 'Lead', entityId: id, organizationId: lead.organizationId, metadata: { type: input.type } }, tx);
      return a;
    });
    return activity;
  }

  async refreshNextFollowUp(tx: Tx, leadId: string) {
    const next = await tx.leadFollowUp.findFirst({ where: { leadId, status: 'PENDING' }, orderBy: { dueAt: 'asc' }, select: { dueAt: true } });
    await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
  }

  async addFollowUp(user: AuthUser, id: string, input: z.output<typeof followUpCreateSchema>) {
    const lead = await this.loadForUpdate(user, id);
    if (['CONVERTED', 'LOST'].includes(lead.status)) throw new ConflictException({ message: 'Re-open the lead before scheduling follow-ups', code: 'LEAD_CLOSED' });
    const assigneeId = input.assignedToId ?? lead.assignedToId ?? user.id;
    if (assigneeId !== user.id && !(await isAssignable(this.prisma, lead.organizationId, assigneeId))) throw new BadRequestException({ message: 'The selected person cannot be given follow-ups for this lead', details: [{ path: 'assignedToId', message: 'Not assignable' }] });
    const dueAt = new Date(input.dueAt);
    if (dueAt.getTime() < Date.now() - 60 * 60_000) throw new BadRequestException({ message: 'Follow-up time is in the past', details: [{ path: 'dueAt', message: 'Choose a future time' }] });
    return this.prisma.$transaction(async (tx) => {
      const f = await tx.leadFollowUp.create({ data: { leadId: id, assignedToId: assigneeId, type: input.type, dueAt, notes: input.notes ?? null, createdById: user.id }, include: { assignedTo: { select: { id: true, fullName: true } } } });
      await tx.leadActivity.create({ data: { leadId: id, type: 'FOLLOW_UP', summary: `${input.type.replace(/_/g, ' ').toLowerCase()} follow-up scheduled`, details: input.notes ?? null, metadata: { followUpId: f.id, dueAt: f.dueAt.toISOString() }, performedById: user.id } });
      await this.refreshNextFollowUp(tx, id);
      await this.audit.log({ actorId: user.id, action: 'lead.followup.create', entityType: 'Lead', entityId: id, organizationId: lead.organizationId, after: { dueAt: f.dueAt, type: f.type } }, tx);
      return f;
    });
  }

  private async loadFollowUp(user: AuthUser, followUpId: string) {
    const f = await this.prisma.leadFollowUp.findUnique({ where: { id: followUpId }, include: { lead: { select: { id: true, organizationId: true, assignedToId: true } } } });
    if (!f) throw new NotFoundException('Follow-up not found');
    assertLeadAccess(user, f.lead, 'edit');
    return f;
  }

  async completeFollowUp(user: AuthUser, followUpId: string, input: z.output<typeof followUpCompleteSchema>) {
    const f = await this.loadFollowUp(user, followUpId);
    if (f.status !== 'PENDING' && f.status !== 'MISSED') throw new ConflictException({ message: 'This follow-up is already closed', code: 'ALREADY_CLOSED' });
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.leadFollowUp.updateMany({ where: { id: followUpId, status: { in: ['PENDING', 'MISSED'] } }, data: { status: input.status, outcome: input.outcome, completedAt: new Date() } });
      if (res.count !== 1) throw new ConflictException({ message: 'This follow-up was updated by someone else', code: 'CONCURRENT_UPDATE' });
      await tx.leadActivity.create({ data: { leadId: f.leadId, type: 'FOLLOW_UP', summary: input.status === 'COMPLETED' ? 'Follow-up completed' : 'Follow-up cancelled', details: input.outcome, metadata: { followUpId }, performedById: user.id } });
      if (input.status === 'COMPLETED') await tx.lead.update({ where: { id: f.leadId }, data: { lastContactedAt: new Date() } });
      await this.refreshNextFollowUp(tx, f.leadId);
      await this.audit.log({ actorId: user.id, action: 'lead.followup.close', entityType: 'LeadFollowUp', entityId: followUpId, organizationId: f.lead.organizationId, after: input }, tx);
      return tx.leadFollowUp.findUniqueOrThrow({ where: { id: followUpId } });
    });
  }

  async rescheduleFollowUp(user: AuthUser, followUpId: string, dueAtIso: string, notes?: string) {
    const f = await this.loadFollowUp(user, followUpId);
    if (f.status !== 'PENDING' && f.status !== 'MISSED') throw new ConflictException({ message: 'Only open follow-ups can be rescheduled', code: 'ALREADY_CLOSED' });
    const dueAt = new Date(dueAtIso);
    if (dueAt.getTime() < Date.now() - 60_000) throw new BadRequestException({ message: 'Choose a future time', details: [{ path: 'dueAt', message: 'In the past' }] });
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.leadFollowUp.update({ where: { id: followUpId }, data: { dueAt, status: 'PENDING', reminderSentAt: null, ...(notes ? { notes } : {}) } });
      await tx.leadActivity.create({ data: { leadId: f.leadId, type: 'FOLLOW_UP', summary: 'Follow-up rescheduled', details: notes ?? null, metadata: { followUpId, from: f.dueAt.toISOString(), to: dueAt.toISOString() }, performedById: user.id } });
      await this.refreshNextFollowUp(tx, f.leadId);
      await this.audit.log({ actorId: user.id, action: 'lead.followup.reschedule', entityType: 'LeadFollowUp', entityId: followUpId, organizationId: f.lead.organizationId, before: { dueAt: f.dueAt }, after: { dueAt } }, tx);
      return row;
    });
  }

  async followUps(user: AuthUser, q: Pagination & { view?: 'overdue' | 'today' | 'upcoming' | 'done'; assignee?: string }) {
    const { start, end } = istDayBounds();
    const now = new Date();
    const view = q.view ?? 'today';
    const where: Prisma.LeadFollowUpWhereInput = {
      lead: { deletedAt: null, ...leadScope(user) },
      ...(q.assignee === 'me' ? { assignedToId: user.id } : q.assignee ? { assignedToId: q.assignee } : {}),
      ...(view === 'overdue'
        ? { status: { in: ['PENDING', 'MISSED'] }, dueAt: { lt: now } }
        : view === 'today'
          ? { status: 'PENDING', dueAt: { gte: now < start ? start : now, lt: end } }
          : view === 'upcoming'
            ? { status: 'PENDING', dueAt: { gte: end } }
            : { status: { in: ['COMPLETED', 'CANCELLED'] } }),
    };
    const [rows, total, overdue, today, upcoming] = await Promise.all([
      this.prisma.leadFollowUp.findMany({
        where,
        orderBy: view === 'done' ? { completedAt: 'desc' } : { dueAt: 'asc' },
        include: { assignedTo: { select: { id: true, fullName: true } }, lead: { select: { id: true, leadNo: true, name: true, phone: true, status: true, priority: true, project: { select: { name: true } }, property: { select: { title: true } } } } },
        ...skipTake(q),
      }),
      this.prisma.leadFollowUp.count({ where }),
      this.prisma.leadFollowUp.count({ where: { lead: { deletedAt: null, ...leadScope(user) }, ...(q.assignee === 'me' ? { assignedToId: user.id } : q.assignee ? { assignedToId: q.assignee } : {}), status: { in: ['PENDING', 'MISSED'] }, dueAt: { lt: now } } }),
      this.prisma.leadFollowUp.count({ where: { lead: { deletedAt: null, ...leadScope(user) }, ...(q.assignee === 'me' ? { assignedToId: user.id } : q.assignee ? { assignedToId: q.assignee } : {}), status: 'PENDING', dueAt: { gte: now < start ? start : now, lt: end } } }),
      this.prisma.leadFollowUp.count({ where: { lead: { deletedAt: null, ...leadScope(user) }, ...(q.assignee === 'me' ? { assignedToId: user.id } : q.assignee ? { assignedToId: q.assignee } : {}), status: 'PENDING', dueAt: { gte: end } } }),
    ]);
    return { ...paginated(rows, total, q), counts: { overdue, today, upcoming } };
  }

  // ───────────────────────── Import / export ─────────────────────────

  parseCsv(csv: string): { rows: Record<string, string>[]; headerError: string | null } {
    let records: Record<string, string>[];
    try {
      records = parse(csv.replace(/^﻿/, ''), { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase().replace(/\s+/g, '_')), skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
    } catch (err) {
      throw new BadRequestException({ message: `The CSV could not be read: ${(err as Error).message}`, code: 'CSV_INVALID' });
    }
    if (!records.length) return { rows: [], headerError: 'The file has no data rows' };
    const headers = Object.keys(records[0]);
    if (!headers.includes('name') || !headers.includes('phone')) return { rows: [], headerError: `Required columns: name, phone. Supported: ${LEAD_IMPORT_COLUMNS.join(', ')}` };
    if (records.length > MAX_IMPORT_ROWS) throw new BadRequestException({ message: `Import at most ${MAX_IMPORT_ROWS} rows per file`, code: 'CSV_TOO_LARGE' });
    return { rows: records, headerError: null };
  }

  async importLeads(user: AuthUser, input: z.output<typeof leadImportSchema>) {
    const organizationId = resolveOrg(user, 'lead.import', input.organizationId);
    const { rows, headerError } = this.parseCsv(input.csv);
    if (headerError) throw new BadRequestException({ message: headerError, code: 'CSV_COLUMNS' });
    const sourceKey = input.sourceKey ?? 'MANUAL';
    const source = await this.prisma.leadSource.findUnique({ where: { key: sourceKey } });
    if (!source) throw new BadRequestException({ message: 'Unknown lead source', details: [{ path: 'sourceKey', message: 'Invalid' }] });
    if (input.campaignId || input.projectId) await this.validateRefs(organizationId, { campaignId: input.campaignId, projectId: input.projectId });
    const projectSlugs = [...new Set(rows.map((r) => r.project_slug).filter(Boolean))];
    const projects = projectSlugs.length ? await this.prisma.project.findMany({ where: { slug: { in: projectSlugs }, deletedAt: null }, select: { id: true, slug: true } }) : [];
    const projectBySlug = new Map(projects.map((p) => [p.slug, p.id]));
    const windowDays = await this.settings.getNumber('leads.duplicateWindowDays');
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const seen = new Map<string, number>();
    const autoAssign = input.autoAssign && (await this.assignment.autoAssignEnabled());

    type RowResult = { row: number; name: string; phone: string; outcome: 'READY' | 'CREATED' | 'DUPLICATE' | 'INVALID'; message: string; leadNo?: string };
    const results: RowResult[] = [];
    const outbox: string[] = [];
    for (const [i, r] of rows.entries()) {
      const rowNo = i + 2;
      const name = (r.name ?? '').trim();
      const phone = normalizePhone(r.phone);
      const email = (r.email ?? '').trim();
      const budgetMin = r.budget_min ? Number(String(r.budget_min).replace(/[,\s₹]/g, '')) : null;
      const budgetMax = r.budget_max ? Number(String(r.budget_max).replace(/[,\s₹]/g, '')) : null;
      const errors: string[] = [];
      if (name.length < 2) errors.push('name is missing');
      if (!phone) errors.push('phone is not a valid mobile number');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email is invalid');
      if ((budgetMin !== null && !Number.isFinite(budgetMin)) || (budgetMax !== null && !Number.isFinite(budgetMax))) errors.push('budget must be a number');
      if (r.project_slug && !projectBySlug.has(r.project_slug)) errors.push(`unknown project "${r.project_slug}"`);
      if (errors.length) {
        results.push({ row: rowNo, name, phone: r.phone ?? '', outcome: 'INVALID', message: errors.join('; ') });
        continue;
      }
      if (seen.has(phone!)) {
        results.push({ row: rowNo, name, phone: phone!, outcome: 'DUPLICATE', message: `Same phone as row ${seen.get(phone!)} in this file` });
        continue;
      }
      seen.set(phone!, rowNo);
      const existing = await this.prisma.lead.findFirst({ where: { ...OPEN_LEAD_WHERE, organizationId, phone: phone!, createdAt: { gte: since } }, select: { id: true, leadNo: true } });
      if (existing) {
        if (input.commit) {
          await this.prisma.leadActivity.create({ data: { leadId: existing.id, type: 'SYSTEM', summary: 'Re-imported from CSV — matched this open lead', details: `Import row ${rowNo} by ${user.fullName}`, performedById: user.id } });
        }
        results.push({ row: rowNo, name, phone: phone!, outcome: 'DUPLICATE', message: `Matches open lead ${existing.leadNo}${input.commit ? ' (recorded on that lead)' : ''}`, leadNo: existing.leadNo });
        continue;
      }
      if (!input.commit) {
        results.push({ row: rowNo, name, phone: phone!, outcome: 'READY', message: 'Will be created' });
        continue;
      }
      const created = await this.prisma.$transaction(async (tx) => {
        const customer = await this.upsertCustomer(tx, organizationId, { name, phone: phone!, email: email || null });
        const lead = await tx.lead.create({
          data: {
            leadNo: await nextReference(tx, 'LD'),
            organizationId,
            customerId: customer.id,
            name,
            phone: phone!,
            email: email || null,
            sourceId: source.id,
            campaignId: input.campaignId ?? null,
            projectId: (r.project_slug ? projectBySlug.get(r.project_slug) : null) ?? input.projectId ?? null,
            budgetMin,
            budgetMax,
            locationPreference: r.location || null,
            requirement: r.requirement || null,
            createdById: user.id,
          },
          select: { id: true, leadNo: true },
        });
        await tx.leadActivity.create({ data: { leadId: lead.id, type: 'SYSTEM', summary: `Imported from CSV (row ${rowNo})`, performedById: user.id } });
        if (autoAssign) outbox.push(...(await this.assignment.autoAssign(tx, lead.id)).outbox);
        return lead;
      });
      results.push({ row: rowNo, name, phone: phone!, outcome: 'CREATED', message: 'Lead created', leadNo: created.leadNo });
    }
    if (input.commit) {
      await this.audit.log({ actorId: user.id, action: 'lead.import', entityType: 'Lead', organizationId, metadata: { rows: rows.length, created: results.filter((r) => r.outcome === 'CREATED').length, duplicates: results.filter((r) => r.outcome === 'DUPLICATE').length, invalid: results.filter((r) => r.outcome === 'INVALID').length } });
      this.notifications.kick(outbox);
    }
    const summary = { total: results.length, ready: 0, created: 0, duplicate: 0, invalid: 0 };
    for (const r of results) summary[r.outcome.toLowerCase() as 'ready' | 'created' | 'duplicate' | 'invalid'] += 1;
    return { committed: input.commit, organizationId, summary, results };
  }

  async exportCsv(user: AuthUser, q: Omit<LeadListQuery, 'page' | 'pageSize'>): Promise<{ csv: string; count: number }> {
    if (!user.can('lead.export')) throw new ForbiddenException('You cannot export leads');
    const exportOrgs = user.orgsWith('lead.export');
    const where: Prisma.LeadWhereInput = { AND: [this.buildWhere(user, q), exportOrgs === 'ALL' ? {} : { organizationId: { in: exportOrgs } }] };
    const rows = await this.prisma.lead.findMany({ where, select: leadListSelect, orderBy: { createdAt: 'desc' }, take: 10_000 });
    const header = ['lead_no', 'created_at', 'name', 'phone', 'email', 'status', 'priority', 'source', 'organisation', 'project', 'property', 'unit', 'assigned_to', 'budget_min', 'budget_max', 'next_follow_up', 'last_contacted'];
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return '';
      let s = v instanceof Date ? v.toISOString() : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((l) =>
      [
        l.leadNo,
        l.createdAt,
        l.name,
        l.phone,
        l.email,
        l.status,
        l.priority,
        l.source.name,
        l.organization.name,
        l.project?.name,
        l.property ? `${l.property.referenceCode} ${l.property.title}` : null,
        l.unit?.code,
        l.assignedTo?.fullName,
        l.budgetMin,
        l.budgetMax,
        l.nextFollowUpAt,
        l.lastContactedAt,
      ]
        .map(esc)
        .join(','),
    );
    await this.audit.log({ actorId: user.id, action: 'lead.export', entityType: 'Lead', metadata: { count: rows.length, filters: q } });
    return { csv: [header.join(','), ...lines].join('\r\n'), count: rows.length };
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}
