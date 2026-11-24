import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatDateTime, type SiteVisitStatus } from '@estate/shared';
import type { z } from 'zod';
import type { siteVisitCreateSchema, siteVisitUpdateSchema } from '@estate/shared';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { NotificationsService } from '../notifications/notifications.service';
import { assertLeadAccess, isAssignable, leadScope } from './crm-access';

const VISIT_TRANSITIONS: Record<SiteVisitStatus, SiteVisitStatus[]> = {
  REQUESTED: ['SCHEDULED', 'CONFIRMED', 'CANCELLED'],
  SCHEDULED: ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'SCHEDULED'],
  COMPLETED: [],
  CANCELLED: ['SCHEDULED'],
  NO_SHOW: ['SCHEDULED'],
};

const visitInclude = {
  lead: { select: { id: true, leadNo: true, name: true, phone: true, status: true, organizationId: true, assignedToId: true } },
  customer: { select: { id: true, fullName: true, phone: true, email: true } },
  assignedTo: { select: { id: true, fullName: true } },
  property: { select: { id: true, title: true, referenceCode: true } },
  project: { select: { id: true, name: true } },
  unit: { select: { id: true, code: true } },
} satisfies Prisma.SiteVisitInclude;

@Injectable()
export class SiteVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser, q: Pagination & { from?: string; to?: string; status?: SiteVisitStatus; assignee?: string; leadId?: string }) {
    const where: Prisma.SiteVisitWhereInput = {
      lead: { deletedAt: null, ...leadScope(user) },
      ...(q.status ? { status: q.status } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.assignee === 'me' ? { assignedToId: user.id } : q.assignee ? { assignedToId: q.assignee } : {}),
      ...(q.from || q.to
        ? { scheduledAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000) } : {}) } }
        : {}),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.siteVisit.findMany({ where, include: visitInclude, orderBy: { scheduledAt: 'asc' }, ...skipTake(q) }),
      this.prisma.siteVisit.count({ where }),
      this.prisma.siteVisit.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    return { ...paginated(rows, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  private subject(v: { property?: { title: string } | null; project?: { name: string } | null; unit?: { code: string } | null }) {
    if (v.property) return v.property.title;
    if (v.project) return v.unit ? `${v.project.name} (unit ${v.unit.code})` : v.project.name;
    return 'the property';
  }

  private async notifyScheduled(tx: Tx, visitId: string): Promise<string[]> {
    const v = await tx.siteVisit.findUniqueOrThrow({ where: { id: visitId }, include: visitInclude });
    const when = formatDateTime(v.scheduledAt);
    const data = { customerName: v.customer.fullName, subject: this.subject(v), when, leadNo: v.lead.leadNo };
    const ids: string[] = [];
    ids.push(...(await this.notifications.notify({ eventKey: 'sitevisit.scheduled', recipients: [{ email: v.customer.email, phone: v.customer.phone, name: v.customer.fullName }], channels: ['EMAIL', 'SMS'], data, relatedType: 'SiteVisit', relatedId: v.id }, tx)));
    if (v.assignedToId) {
      ids.push(...(await this.notifications.notify({ eventKey: 'sitevisit.scheduled', recipients: [{ userId: v.assignedToId }], channels: ['IN_APP'], data, link: `/crm/leads/${v.leadId}`, relatedType: 'SiteVisit', relatedId: v.id }, tx)));
    }
    return ids;
  }

  /** System-driven lead status update for visit milestones (never reopens converted leads). */
  private async moveLead(tx: Tx, lead: { id: string; status: string }, to: 'SITE_VISIT_SCHEDULED' | 'SITE_VISIT_COMPLETED', actorId: string) {
    if (lead.status === 'CONVERTED' || lead.status === to) return;
    if (to === 'SITE_VISIT_SCHEDULED' && ['NEGOTIATION', 'BOOKING_PENDING'].includes(lead.status)) return;
    if (to === 'SITE_VISIT_COMPLETED' && ['NEGOTIATION', 'BOOKING_PENDING'].includes(lead.status)) return;
    await tx.lead.update({ where: { id: lead.id }, data: { status: to, ...(lead.status === 'LOST' ? { lostReason: null } : {}) } });
    await tx.leadActivity.create({
      data: { leadId: lead.id, type: 'STATUS_CHANGE', summary: `Status changed to ${to.replace(/_/g, ' ').toLowerCase()}`, details: lead.status === 'LOST' ? 'Lead re-opened by a site visit' : null, metadata: { from: lead.status, to, automatic: true }, performedById: actorId },
    });
  }

  async create(user: AuthUser, input: z.output<typeof siteVisitCreateSchema>) {
    const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, deletedAt: null }, select: { id: true, leadNo: true, status: true, organizationId: true, assignedToId: true, customerId: true, propertyId: true, projectId: true, unitId: true } });
    assertLeadAccess(user, lead, 'edit');
    user.assert('site_visit.manage', lead!.organizationId, 'You cannot schedule site visits for this lead');
    const scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() < Date.now() - 60 * 60_000) throw new BadRequestException({ message: 'Choose a future date and time', details: [{ path: 'scheduledAt', message: 'In the past' }] });
    const assigneeId = input.assignedToId ?? lead!.assignedToId ?? user.id;
    if (assigneeId !== user.id && !(await isAssignable(this.prisma, lead!.organizationId, assigneeId))) throw new BadRequestException({ message: 'This person cannot attend visits for this lead', details: [{ path: 'assignedToId', message: 'Not assignable' }] });
    const unitId = input.unitId ?? null;
    let projectId = input.projectId ?? (input.propertyId ? null : lead!.projectId);
    if (unitId) {
      const unit = await this.prisma.projectUnit.findUnique({ where: { id: unitId }, select: { projectId: true } });
      if (!unit) throw new BadRequestException({ message: 'Unit not found', details: [{ path: 'unitId', message: 'Invalid unit' }] });
      projectId = unit.projectId;
    }
    const propertyId = input.propertyId ?? (projectId ? null : lead!.propertyId);
    const outbox: string[] = [];
    const visit = await this.prisma.$transaction(async (tx) => {
      const v = await tx.siteVisit.create({
        data: { leadId: lead!.id, customerId: lead!.customerId, propertyId, projectId, unitId, scheduledAt, status: 'SCHEDULED', assignedToId: assigneeId, meetingPoint: input.meetingPoint ?? null, notes: input.notes ?? null, createdById: user.id },
      });
      await tx.leadActivity.create({ data: { leadId: lead!.id, type: 'SITE_VISIT', summary: `Site visit scheduled for ${formatDateTime(scheduledAt)}`, details: input.notes ?? null, metadata: { siteVisitId: v.id }, performedById: user.id } });
      await this.moveLead(tx, lead!, 'SITE_VISIT_SCHEDULED', user.id);
      await this.audit.log({ actorId: user.id, action: 'site_visit.create', entityType: 'SiteVisit', entityId: v.id, organizationId: lead!.organizationId, after: { scheduledAt, assigneeId } }, tx);
      outbox.push(...(await this.notifyScheduled(tx, v.id)));
      return v;
    });
    this.notifications.kick(outbox);
    return this.prisma.siteVisit.findUniqueOrThrow({ where: { id: visit.id }, include: visitInclude });
  }

  async update(user: AuthUser, id: string, input: z.output<typeof siteVisitUpdateSchema>) {
    const visit = await this.prisma.siteVisit.findUnique({ where: { id }, include: visitInclude });
    if (!visit) throw new NotFoundException('Site visit not found');
    assertLeadAccess(user, visit.lead, 'edit');
    user.assert('site_visit.manage', visit.lead.organizationId, 'You cannot update site visits for this lead');
    const nextStatus = input.status ?? visit.status;
    const rescheduled = input.scheduledAt && new Date(input.scheduledAt).getTime() !== visit.scheduledAt.getTime();
    if (input.status && input.status !== visit.status && !VISIT_TRANSITIONS[visit.status].includes(input.status)) {
      throw new ConflictException({ message: `A ${visit.status.toLowerCase().replace('_', ' ')} visit cannot become ${input.status.toLowerCase().replace('_', ' ')}`, code: 'INVALID_TRANSITION' });
    }
    if (rescheduled && ['COMPLETED'].includes(visit.status)) throw new ConflictException({ message: 'A completed visit cannot be rescheduled', code: 'INVALID_TRANSITION' });
    if (nextStatus === 'COMPLETED' && !input.outcome && !visit.outcome) throw new BadRequestException({ message: 'Record the outcome of the visit', details: [{ path: 'outcome', message: 'Required' }] });
    if (input.assignedToId && input.assignedToId !== visit.assignedToId && !(await isAssignable(this.prisma, visit.lead.organizationId, input.assignedToId))) {
      throw new BadRequestException({ message: 'This person cannot attend visits for this lead', details: [{ path: 'assignedToId', message: 'Not assignable' }] });
    }
    const outbox: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.siteVisit.updateMany({
        where: { id, status: visit.status },
        data: {
          ...(input.status ? { status: rescheduled && ['CANCELLED', 'NO_SHOW'].includes(visit.status) && input.status === visit.status ? 'SCHEDULED' : input.status } : rescheduled && ['CANCELLED', 'NO_SHOW', 'REQUESTED'].includes(visit.status) ? { status: 'SCHEDULED' } : {}),
          ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
          ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
          ...(input.meetingPoint !== undefined ? { meetingPoint: input.meetingPoint } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
          ...(input.customerFeedback !== undefined ? { customerFeedback: input.customerFeedback } : {}),
          ...(nextStatus === 'COMPLETED' && visit.status !== 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This visit was updated by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      const after = await tx.siteVisit.findUniqueOrThrow({ where: { id } });
      const summary =
        after.status !== visit.status
          ? `Site visit ${after.status === 'NO_SHOW' ? 'marked as no-show' : after.status.toLowerCase()}`
          : rescheduled
            ? `Site visit rescheduled to ${formatDateTime(after.scheduledAt)}`
            : 'Site visit updated';
      await tx.leadActivity.create({ data: { leadId: visit.leadId, type: 'SITE_VISIT', summary, details: input.outcome ?? input.notes ?? null, metadata: { siteVisitId: id, from: visit.status, to: after.status }, performedById: user.id } });
      if (after.status === 'COMPLETED' && visit.status !== 'COMPLETED') await this.moveLead(tx, visit.lead, 'SITE_VISIT_COMPLETED', user.id);
      if ((after.status === 'SCHEDULED' || after.status === 'CONFIRMED') && (visit.status === 'REQUESTED' || visit.status === 'CANCELLED' || visit.status === 'NO_SHOW')) await this.moveLead(tx, visit.lead, 'SITE_VISIT_SCHEDULED', user.id);
      await this.audit.log({ actorId: user.id, action: 'site_visit.update', entityType: 'SiteVisit', entityId: id, organizationId: visit.lead.organizationId, before: { status: visit.status, scheduledAt: visit.scheduledAt }, after: { status: after.status, scheduledAt: after.scheduledAt } }, tx);
      if (rescheduled || ((after.status === 'SCHEDULED' || after.status === 'CONFIRMED') && visit.status === 'REQUESTED')) outbox.push(...(await this.notifyScheduled(tx, id)));
    });
    this.notifications.kick(outbox);
    return this.prisma.siteVisit.findUniqueOrThrow({ where: { id }, include: visitInclude });
  }
}
