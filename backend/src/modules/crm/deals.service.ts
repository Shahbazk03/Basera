import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DEAL_STATUS_TRANSITIONS, findPropertyTransition, fromPaise, localDateString, toPaise, type DealStatus } from '@estate/shared';
import type { z } from 'zod';
import type { dealCreateSchema, dealPaymentSchema, dealStatusSchema } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { nextReference } from '../../common/references';
import { dateOnly, paginated, Pagination, skipTake } from '../../common/http';
import { assertLeadAccess, isAssignable, orgScope } from './crm-access';

const dealInclude = {
  organization: { select: { id: true, name: true } },
  lead: { select: { id: true, leadNo: true, name: true, status: true, organizationId: true, assignedToId: true } },
  customer: { select: { id: true, fullName: true, phone: true, email: true } },
  property: { select: { id: true, title: true, referenceCode: true, status: true, listingType: true, availability: true } },
  project: { select: { id: true, name: true, slug: true } },
  unit: { select: { id: true, code: true, status: true, totalPrice: true } },
  salesUser: { select: { id: true, fullName: true } },
  brokerOrganization: { select: { id: true, name: true } },
  leadProvider: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  payments: { orderBy: { receivedOn: 'desc' as const }, include: { recordedBy: { select: { fullName: true } } } },
  commissionRecords: { select: { id: true, recipientName: true, recipientType: true, amount: true, status: true } },
} satisfies Prisma.DealInclude;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: Pagination & { status?: DealStatus; q?: string; projectId?: string; salesUserId?: string }) {
    const where: Prisma.DealWhereInput = {
      ...orgScope(user, 'deal.view'),
      ...(q.status ? { status: q.status } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.salesUserId === 'me' ? { salesUserId: user.id } : q.salesUserId ? { salesUserId: q.salesUserId } : {}),
      ...(q.q
        ? { OR: [{ dealNo: { equals: q.q.toUpperCase() } }, { customer: { fullName: { contains: q.q, mode: 'insensitive' } } }, { lead: { leadNo: { equals: q.q.toUpperCase() } } }] }
        : {}),
    };
    const [rows, total, counts, sums] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { fullName: true } },
          project: { select: { name: true } },
          unit: { select: { code: true } },
          property: { select: { title: true, referenceCode: true } },
          salesUser: { select: { fullName: true } },
          organization: { select: { name: true } },
          _count: { select: { payments: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.deal.count({ where }),
      this.prisma.deal.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true }, _sum: { dealValue: true } }),
      this.prisma.dealPayment.groupBy({ by: ['dealId'], where: { deal: where }, _sum: { amount: true } }),
    ]);
    const received = new Map(sums.map((s) => [s.dealId, Number(s._sum.amount ?? 0)]));
    return {
      ...paginated(rows.map((r) => ({ ...r, amountReceived: received.get(r.id) ?? 0 })), total, q),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      statusValues: Object.fromEntries(counts.map((c) => [c.status, Number(c._sum.dealValue ?? 0)])),
    };
  }

  async detail(user: AuthUser, id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: dealInclude });
    if (!deal || !user.can('deal.view', deal.organizationId)) throw new NotFoundException('Deal not found');
    const received = deal.payments.reduce((s, p) => s + toPaise(Number(p.amount)), 0);
    return {
      ...deal,
      amountReceived: fromPaise(received),
      balance: fromPaise(Math.max(0, toPaise(Number(deal.dealValue)) - received)),
      allowedStatuses: user.can('deal.manage', deal.organizationId) ? DEAL_STATUS_TRANSITIONS[deal.status] : [],
      canManage: user.can('deal.manage', deal.organizationId),
    };
  }

  /** Lead status changes made by the deal workflow (system-driven, recorded on the timeline). */
  private async systemLeadStatus(tx: Tx, lead: { id: string; status: string }, to: 'BOOKING_PENDING' | 'CONVERTED' | 'FOLLOW_UP', actorId: string, summary: string) {
    if (lead.status === to || lead.status === 'CONVERTED') return;
    await tx.lead.update({ where: { id: lead.id }, data: { status: to, ...(to === 'CONVERTED' ? { convertedAt: new Date(), nextFollowUpAt: null } : {}), ...(lead.status === 'LOST' ? { lostReason: null } : {}) } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', summary, metadata: { from: lead.status, to, automatic: true }, performedById: actorId } });
    if (to === 'CONVERTED') await tx.leadFollowUp.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'CANCELLED', outcome: 'Lead converted' } });
  }

  async create(user: AuthUser, input: z.output<typeof dealCreateSchema>) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, deletedAt: null },
      select: { id: true, leadNo: true, status: true, organizationId: true, assignedToId: true, customerId: true, leadProviderId: true, projectId: true, propertyId: true, unitId: true },
    });
    assertLeadAccess(user, lead);
    user.assert('deal.manage', lead!.organizationId, 'You cannot record deals for this lead');
    if (lead!.status === 'CONVERTED') throw new ConflictException({ message: 'This lead is already converted', code: 'LEAD_CONVERTED' });
    const salesUserId = input.salesUserId ?? lead!.assignedToId ?? user.id;
    if (salesUserId !== user.id && !(await isAssignable(this.prisma, lead!.organizationId, salesUserId))) {
      throw new BadRequestException({ message: 'The sales person must be a member of the organisation', details: [{ path: 'salesUserId', message: 'Not assignable' }] });
    }
    if (input.brokerOrganizationId) {
      const b = await this.prisma.organization.findFirst({ where: { id: input.brokerOrganizationId, type: 'BROKERAGE', deletedAt: null }, select: { id: true } });
      if (!b) throw new BadRequestException({ message: 'Co-broking partner must be a brokerage', details: [{ path: 'brokerOrganizationId', message: 'Invalid broker' }] });
    }

    let projectId = input.projectId ?? null;
    let unit: Prisma.ProjectUnitGetPayload<{ include: { reservations: true; project: { select: { organizationId: true; isPublished: true; status: true } } } }> | null = null;
    if (input.unitId) {
      unit = await this.prisma.projectUnit.findUnique({ where: { id: input.unitId }, include: { reservations: { where: { status: 'ACTIVE' } }, project: { select: { organizationId: true, isPublished: true, status: true } } } });
      if (!unit) throw new BadRequestException({ message: 'Unit not found', details: [{ path: 'unitId', message: 'Invalid unit' }] });
      if (projectId && unit.projectId !== projectId) throw new BadRequestException({ message: 'The unit does not belong to the selected project', details: [{ path: 'unitId', message: 'Wrong project' }] });
      projectId = unit.projectId;
      const sameOrg = unit.project.organizationId === lead!.organizationId;
      if (!sameOrg && !unit.project.isPublished && !user.can('project.inventory.manage', unit.project.organizationId)) {
        throw new ForbiddenException('You cannot book units in this project');
      }
      if (!['AVAILABLE', 'RESERVED', 'ON_HOLD'].includes(unit.status)) throw new ConflictException({ message: `Unit ${unit.code} is ${unit.status.toLowerCase().replace('_', ' ')} and cannot be booked`, code: 'UNIT_UNAVAILABLE' });
      const active = unit.reservations[0];
      if (active && active.leadId !== lead!.id) throw new ConflictException({ message: `Unit ${unit.code} is reserved for another customer`, code: 'UNIT_RESERVED' });
    }
    let property: { id: string; status: string; availability: string } | null = null;
    if (input.propertyId) {
      property = await this.prisma.property.findFirst({ where: { id: input.propertyId, deletedAt: null }, select: { id: true, status: true, availability: true } });
      if (!property) throw new BadRequestException({ message: 'Listing not found', details: [{ path: 'propertyId', message: 'Invalid listing' }] });
      if (['SOLD', 'RENTED', 'ARCHIVED'].includes(property.status)) throw new ConflictException({ message: 'This listing is already closed', code: 'LISTING_CLOSED' });
    }
    if (!input.unitId && !input.propertyId && !projectId) {
      projectId = lead!.projectId;
    }

    const booked = Boolean(unit) || Boolean(input.bookingDate);
    const deal = await this.prisma.$transaction(async (tx) => {
      const dealNo = await nextReference(tx, 'DL');
      if (unit) {
        const res = await tx.projectUnit.updateMany({
          where: { id: unit.id, version: unit.version, status: unit.status },
          data: { status: 'BOOKED', version: { increment: 1 }, holdExpiresAt: null },
        });
        if (res.count !== 1) throw new ConflictException({ message: `Unit ${unit.code} was just changed by someone else — it is no longer available`, code: 'UNIT_CONFLICT' });
        await tx.unitStatusHistory.create({ data: { unitId: unit.id, fromStatus: unit.status, toStatus: 'BOOKED', leadId: lead!.id, reason: `Booked under deal ${dealNo}`, changedById: user.id } });
        const active = unit.reservations[0];
        if (active) await tx.unitReservation.update({ where: { id: active.id }, data: { status: 'CONVERTED' } });
      }
      if (property && property.status === 'PUBLISHED') await tx.property.update({ where: { id: property.id }, data: { availability: 'UNDER_OFFER' } });
      const d = await tx.deal.create({
        data: {
          dealNo,
          organizationId: lead!.organizationId,
          leadId: lead!.id,
          customerId: lead!.customerId,
          propertyId: input.propertyId ?? null,
          projectId,
          unitId: input.unitId ?? null,
          dealType: input.dealType,
          status: booked ? 'BOOKED' : 'OPEN',
          dealValue: input.dealValue,
          expectedRevenue: input.expectedRevenue ?? null,
          bookingDate: input.bookingDate ? dateOnly(input.bookingDate) : booked ? dateOnly(localDateString(new Date())) : null,
          salesUserId,
          brokerOrganizationId: input.brokerOrganizationId ?? null,
          leadProviderId: lead!.leadProviderId,
          notes: input.notes ?? null,
          createdById: user.id,
        },
      });
      await tx.leadActivity.create({ data: { leadId: lead!.id, type: 'SYSTEM', summary: `Deal ${dealNo} recorded`, details: unit ? `Unit ${unit.code} booked` : null, metadata: { dealId: d.id, dealValue: input.dealValue }, performedById: user.id } });
      if (booked) await this.systemLeadStatus(tx, lead!, 'BOOKING_PENDING', user.id, `Status changed to booking pending (deal ${dealNo})`);
      await this.audit.log({ actorId: user.id, action: 'deal.create', entityType: 'Deal', entityId: d.id, organizationId: lead!.organizationId, after: { dealNo, dealValue: input.dealValue, unitId: input.unitId ?? null, propertyId: input.propertyId ?? null } }, tx);
      return d;
    });
    return this.detail(user, deal.id);
  }

  async changeStatus(user: AuthUser, id: string, input: z.output<typeof dealStatusSchema>) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { lead: { select: { id: true, status: true } }, unit: true, property: true } });
    if (!deal) throw new NotFoundException('Deal not found');
    user.assert('deal.manage', deal.organizationId);
    if (!DEAL_STATUS_TRANSITIONS[deal.status].includes(input.status)) {
      throw new ConflictException({ message: `A ${deal.status.toLowerCase().replace('_', ' ')} deal cannot become ${input.status.toLowerCase().replace(/_/g, ' ')}`, code: 'INVALID_TRANSITION' });
    }
    if (input.status === 'CANCELLED' && !input.reason?.trim()) throw new BadRequestException({ message: 'Give a reason for cancelling', details: [{ path: 'reason', message: 'Required' }] });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.DealUncheckedUpdateManyInput = { status: input.status };
      if (input.status === 'BOOKED' && !deal.bookingDate) data.bookingDate = dateOnly(localDateString(now));
      if (input.status === 'AGREEMENT_SIGNED') data.agreementDate = input.agreementDate ? dateOnly(input.agreementDate) : dateOnly(localDateString(now));
      if (input.status === 'CLOSED_WON') data.closedAt = now;
      if (input.status === 'CANCELLED') {
        data.cancelledAt = now;
        data.cancellationReason = input.reason ?? null;
      }
      const res = await tx.deal.updateMany({ where: { id, status: deal.status }, data });
      if (res.count !== 1) throw new ConflictException({ message: 'This deal was updated by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });

      if (input.status === 'BOOKED' && deal.lead) await this.systemLeadStatus(tx, deal.lead, 'BOOKING_PENDING', user.id, `Status changed to booking pending (deal ${deal.dealNo})`);
      if (input.status === 'CLOSED_WON') {
        if (deal.lead) await this.systemLeadStatus(tx, deal.lead, 'CONVERTED', user.id, `Converted — deal ${deal.dealNo} closed`);
        if (deal.unit && deal.unit.status === 'BOOKED') {
          const u = await tx.projectUnit.updateMany({ where: { id: deal.unit.id, status: 'BOOKED', version: deal.unit.version }, data: { status: 'SOLD', version: { increment: 1 } } });
          if (u.count !== 1) throw new ConflictException({ message: `Unit ${deal.unit.code} changed concurrently — refresh and retry`, code: 'UNIT_CONFLICT' });
          await tx.unitStatusHistory.create({ data: { unitId: deal.unit.id, fromStatus: 'BOOKED', toStatus: 'SOLD', leadId: deal.leadId, reason: `Deal ${deal.dealNo} closed`, changedById: user.id } });
        }
        if (deal.property && deal.property.status === 'PUBLISHED') {
          const action = deal.property.listingType === 'SALE' ? 'mark_sold' : 'mark_rented';
          const t = findPropertyTransition('PUBLISHED', action, deal.property.listingType);
          if (t) {
            await tx.property.update({ where: { id: deal.property.id }, data: { status: t.to, closedAt: now, isFeatured: false, availability: 'AVAILABLE' } });
            await tx.propertyStatusHistory.create({ data: { propertyId: deal.property.id, fromStatus: 'PUBLISHED', toStatus: t.to, changedById: null, reason: `Deal ${deal.dealNo} closed` } });
          }
        }
      }
      if (input.status === 'CANCELLED') {
        if (deal.unit && ['BOOKED', 'SOLD'].includes(deal.unit.status)) {
          const u = await tx.projectUnit.updateMany({ where: { id: deal.unit.id, status: deal.unit.status, version: deal.unit.version }, data: { status: 'AVAILABLE', version: { increment: 1 } } });
          if (u.count !== 1) throw new ConflictException({ message: `Unit ${deal.unit.code} changed concurrently — refresh and retry`, code: 'UNIT_CONFLICT' });
          await tx.unitStatusHistory.create({ data: { unitId: deal.unit.id, fromStatus: deal.unit.status, toStatus: 'AVAILABLE', leadId: deal.leadId, reason: `Deal ${deal.dealNo} cancelled: ${input.reason}`, changedById: user.id } });
        }
        if (deal.property && deal.property.availability === 'UNDER_OFFER') await tx.property.update({ where: { id: deal.property.id }, data: { availability: 'AVAILABLE' } });
        if (deal.lead && deal.lead.status === 'BOOKING_PENDING') await this.systemLeadStatus(tx, deal.lead, 'FOLLOW_UP', user.id, `Deal ${deal.dealNo} cancelled — back to follow-up`);
      }
      if (deal.leadId) {
        await tx.leadActivity.create({ data: { leadId: deal.leadId, type: 'SYSTEM', summary: `Deal ${deal.dealNo} ${input.status.toLowerCase().replace(/_/g, ' ')}`, details: input.reason ?? null, metadata: { dealId: id, from: deal.status, to: input.status }, performedById: user.id } });
      }
      await this.audit.log({ actorId: user.id, action: 'deal.status', entityType: 'Deal', entityId: id, organizationId: deal.organizationId, before: { status: deal.status }, after: { status: input.status }, metadata: input.reason ? { reason: input.reason } : undefined }, tx);
    });
    return this.detail(user, id);
  }

  async addPayment(user: AuthUser, id: string, input: z.output<typeof dealPaymentSchema>) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { payments: { select: { amount: true } } } });
    if (!deal) throw new NotFoundException('Deal not found');
    user.assert('deal.manage', deal.organizationId);
    if (deal.status === 'CANCELLED') throw new ConflictException({ message: 'Payments cannot be recorded on a cancelled deal', code: 'DEAL_CANCELLED' });
    const receivedOn = dateOnly(input.receivedOn);
    if (receivedOn.getTime() > Date.now() + 86_400_000) throw new BadRequestException({ message: 'Payment date cannot be in the future', details: [{ path: 'receivedOn', message: 'Future date' }] });
    const already = deal.payments.reduce((s, p) => s + toPaise(Number(p.amount)), 0);
    if (already + toPaise(input.amount) > toPaise(Number(deal.dealValue))) {
      throw new BadRequestException({ message: `Payments would exceed the deal value (₹${fromPaise(toPaise(Number(deal.dealValue)) - already)} remaining)`, details: [{ path: 'amount', message: 'Exceeds remaining balance' }] });
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.dealPayment.create({ data: { dealId: id, amount: input.amount, receivedOn, receivedBy: input.receivedBy, method: input.method, referenceNo: input.referenceNo ?? null, notes: input.notes ?? null, recordedById: user.id } });
      // Money the company itself holds enters the ledger as a customer payment (an inflow — never revenue).
      if (input.receivedBy === 'COMPANY') {
        const customer = await tx.customer.findUnique({ where: { id: deal.customerId }, select: { fullName: true } });
        await tx.financeTransaction.create({
          data: {
            txnNo: await nextReference(tx, 'TXN'),
            organizationId: deal.organizationId,
            type: 'CUSTOMER_PAYMENT',
            direction: 'INFLOW',
            amount: input.amount,
            txnDate: receivedOn,
            method: input.method,
            referenceNo: input.referenceNo ?? null,
            counterparty: customer?.fullName ?? null,
            description: `Customer payment on ${deal.dealNo}`,
            dealId: id,
            recordedById: user.id,
          },
        });
      }
      if (deal.leadId) await tx.leadActivity.create({ data: { leadId: deal.leadId, type: 'SYSTEM', summary: `Customer payment of ₹${input.amount.toLocaleString('en-IN')} recorded on ${deal.dealNo}`, metadata: { dealId: id, paymentId: p.id }, performedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'deal.payment.add', entityType: 'Deal', entityId: id, organizationId: deal.organizationId, after: { amount: input.amount, receivedBy: input.receivedBy, method: input.method, referenceNo: input.referenceNo } }, tx);
      return p;
    });
    return payment;
  }

  async removePayment(user: AuthUser, id: string, paymentId: string) {
    const payment = await this.prisma.dealPayment.findFirst({ where: { id: paymentId, dealId: id }, include: { deal: { select: { organizationId: true, leadId: true, dealNo: true } } } });
    if (!payment) throw new NotFoundException('Payment not found');
    user.assert('deal.manage', payment.deal.organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.dealPayment.delete({ where: { id: paymentId } });
      // Ledger entries are never deleted: post a reversing entry for money the company had recorded.
      if (payment.receivedBy === 'COMPANY') {
        await tx.financeTransaction.create({
          data: {
            txnNo: await nextReference(tx, 'TXN'),
            organizationId: payment.deal.organizationId,
            type: 'OTHER',
            direction: 'OUTFLOW',
            amount: payment.amount,
            txnDate: dateOnly(localDateString(new Date())),
            method: payment.method,
            referenceNo: payment.referenceNo,
            description: `Reversal: customer payment on ${payment.deal.dealNo} removed`,
            dealId: id,
            recordedById: user.id,
          },
        });
      }
      await this.audit.log({ actorId: user.id, action: 'deal.payment.remove', entityType: 'Deal', entityId: id, organizationId: payment.deal.organizationId, before: { amount: payment.amount, receivedOn: payment.receivedOn, referenceNo: payment.referenceNo } }, tx);
    });
    return { ok: true };
  }
}
