import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { calculateCommission, COMMISSION_STATUS_TRANSITIONS, fromPaise, toPaise, type CommissionStatementTotals } from '@estate/shared';
import type { z } from 'zod';
import type { commissionManualSchema, commissionPayViaPayrollSchema, commissionRuleSchema, payoutCreateSchema, payoutPaySchema } from '@estate/shared';
import { CommissionRecipientType, CommissionStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { nextReference } from '../../common/references';
import { dateOnly, paginated, Pagination, skipTake } from '../../common/http';

const ELIGIBLE_DEAL_STATUSES = ['BOOKED', 'AGREEMENT_SIGNED', 'CLOSED_WON'] as const;

export interface GenerationResult {
  dealId: string;
  dealNo: string;
  created: { id: string; rule: string; recipientName: string; amount: number }[];
  skipped: { rule: string; reason: string }[];
}

export interface RecordListQuery extends Pagination {
  status?: CommissionStatus;
  recipientType?: CommissionRecipientType;
  q?: string;
  dealId?: string;
}

const recordSelect = {
  id: true,
  dealId: true,
  ruleId: true,
  recipientType: true,
  recipientUserId: true,
  recipientOrganizationId: true,
  leadProviderId: true,
  recipientName: true,
  basisAmount: true,
  calcType: true,
  rate: true,
  amount: true,
  amountPaid: true,
  status: true,
  approvedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  rule: { select: { id: true, name: true } },
  approvedBy: { select: { fullName: true } },
  deal: {
    select: {
      id: true,
      dealNo: true,
      dealType: true,
      status: true,
      dealValue: true,
      bookingDate: true,
      project: { select: { name: true } },
      property: { select: { title: true, referenceCode: true } },
      unit: { select: { code: true } },
      customer: { select: { fullName: true } },
    },
  },
  payoutItems: { select: { payout: { select: { id: true, payoutNo: true, status: true } } } },
} satisfies Prisma.CommissionRecordSelect;

/**
 * Commission rules → records → approval → payable → payout (or payroll). Records are always
 * derived from recorded deals; no rate is hard-coded.
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private platformScope(user: AuthUser, perm: 'commission.view' | 'commission.manage' | 'commission.approve'): string[] | 'ALL' {
    const scope = user.orgsWith(perm);
    if (scope !== 'ALL' && scope.length === 0) throw new ForbiddenException('You do not have access to commissions');
    return scope;
  }

  private scopeWhere(scope: string[] | 'ALL'): Prisma.CommissionRecordWhereInput {
    return scope === 'ALL' ? {} : { organizationId: { in: scope } };
  }

  // ───────────────────────── Rules ─────────────────────────

  async rules(user: AuthUser) {
    const scope = this.platformScope(user, 'commission.view');
    const rows = await this.prisma.commissionRule.findMany({
      where: scope === 'ALL' ? {} : { organizationId: { in: scope } },
      orderBy: [{ isActive: 'desc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        project: { select: { id: true, name: true } },
        propertyType: { select: { id: true, name: true } },
        city: { select: { id: true, name: true } },
        leadProvider: { select: { id: true, name: true } },
        brokerOrganization: { select: { id: true, name: true } },
        _count: { select: { records: true } },
      },
    });
    return rows;
  }

  private async validateRuleRefs(input: Partial<z.output<typeof commissionRuleSchema>>) {
    const checks: [string, Promise<unknown> | null][] = [
      ['projectId', input.projectId ? this.prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } }) : null],
      ['propertyTypeId', input.propertyTypeId ? this.prisma.propertyType.findUnique({ where: { id: input.propertyTypeId }, select: { id: true } }) : null],
      ['cityId', input.cityId ? this.prisma.city.findUnique({ where: { id: input.cityId }, select: { id: true } }) : null],
      ['leadProviderId', input.leadProviderId ? this.prisma.leadProvider.findUnique({ where: { id: input.leadProviderId }, select: { id: true } }) : null],
      ['brokerOrganizationId', input.brokerOrganizationId ? this.prisma.organization.findFirst({ where: { id: input.brokerOrganizationId, type: { in: ['BROKERAGE', 'PARTNER'] } }, select: { id: true } }) : null],
    ];
    for (const [path, p] of checks) {
      if (p && !(await p)) throw new BadRequestException({ message: 'A referenced record does not exist', details: [{ path, message: 'Not found' }] });
    }
    if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new BadRequestException({ message: 'The end date must be after the start date', details: [{ path: 'effectiveTo', message: 'Invalid range' }] });
    }
  }

  private ruleData(input: Partial<z.output<typeof commissionRuleSchema>>): Prisma.CommissionRuleUncheckedUpdateInput {
    const { effectiveFrom, effectiveTo, ...rest } = input;
    return {
      ...rest,
      ...(effectiveFrom !== undefined ? { effectiveFrom: effectiveFrom ? dateOnly(effectiveFrom) : null } : {}),
      ...(effectiveTo !== undefined ? { effectiveTo: effectiveTo ? dateOnly(effectiveTo) : null } : {}),
    };
  }

  async createRule(user: AuthUser, input: z.output<typeof commissionRuleSchema>) {
    const orgId = user.platformOrganizationId;
    if (!orgId) throw new ConflictException('The company organisation is not configured');
    user.assert('commission.manage', orgId);
    await this.validateRuleRefs(input);
    const rule = await this.prisma.commissionRule.create({ data: { ...(this.ruleData(input) as Prisma.CommissionRuleUncheckedCreateInput), organizationId: orgId } });
    await this.audit.log({ actorId: user.id, action: 'commission.rule.create', entityType: 'CommissionRule', entityId: rule.id, organizationId: orgId, after: rule });
    return rule;
  }

  async updateRule(user: AuthUser, id: string, input: Partial<z.output<typeof commissionRuleSchema>>) {
    const before = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rule not found');
    user.assert('commission.manage', before.organizationId);
    if (input.calcType === 'PERCENTAGE' || (!input.calcType && before.calcType === 'PERCENTAGE')) {
      const value = input.value ?? Number(before.value);
      if (value > 100) throw new BadRequestException({ message: 'Percentage cannot exceed 100', details: [{ path: 'value', message: 'Max 100' }] });
    }
    await this.validateRuleRefs({ ...input, effectiveFrom: input.effectiveFrom ?? before.effectiveFrom?.toISOString().slice(0, 10), effectiveTo: input.effectiveTo ?? before.effectiveTo?.toISOString().slice(0, 10) });
    const rule = await this.prisma.commissionRule.update({ where: { id }, data: this.ruleData(input) });
    await this.audit.log({ actorId: user.id, action: 'commission.rule.update', entityType: 'CommissionRule', entityId: id, organizationId: before.organizationId, before, after: rule });
    return rule;
  }

  // ───────────────────────── Generation ─────────────────────────

  /** Idempotent: evaluates the deal's organisation rules and creates any missing (deal, rule, recipient) records. */
  async generateForDeal(dealId: string, actor?: AuthUser): Promise<GenerationResult> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commission:${dealId}`}))`;
        const deal = await tx.deal.findUnique({
          where: { id: dealId },
          include: {
            lead: { select: { leadProviderId: true } },
            salesUser: { select: { id: true, fullName: true, employee: { select: { manager: { select: { user: { select: { id: true, fullName: true } } } } } } } },
            brokerOrganization: { select: { id: true, name: true } },
            leadProvider: { select: { id: true, name: true, organizationId: true } },
            organization: { select: { id: true, name: true } },
            project: { select: { cityId: true } },
            property: { select: { propertyTypeId: true, cityId: true } },
          },
        });
        if (!deal) throw new NotFoundException('Deal not found');
        if (actor) actor.assert('commission.manage', deal.organizationId);
        const out: GenerationResult = { dealId, dealNo: deal.dealNo, created: [], skipped: [] };
        if (!(ELIGIBLE_DEAL_STATUSES as readonly string[]).includes(deal.status)) {
          out.skipped.push({ rule: '—', reason: `Deal is ${deal.status.toLowerCase().replace(/_/g, ' ')}; commissions are generated once it is booked` });
          return out;
        }
        const refDate = deal.bookingDate ?? deal.createdAt;
        const rules = await tx.commissionRule.findMany({ where: { organizationId: deal.organizationId, isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
        const providerId = deal.leadProviderId ?? deal.lead?.leadProviderId ?? null;
        const provider = providerId ? (deal.leadProvider ?? (await tx.leadProvider.findUnique({ where: { id: providerId }, select: { id: true, name: true, organizationId: true } }))) : null;
        const cityId = deal.project?.cityId ?? deal.property?.cityId ?? null;
        const propertyTypeId = deal.property?.propertyTypeId ?? null;

        for (const rule of rules) {
          if (rule.effectiveFrom && refDate < rule.effectiveFrom) continue;
          if (rule.effectiveTo && refDate > new Date(rule.effectiveTo.getTime() + 86_400_000 - 1)) continue;
          if (rule.dealType && rule.dealType !== deal.dealType) continue;
          if (rule.projectId && rule.projectId !== deal.projectId) continue;
          if (rule.propertyTypeId && rule.propertyTypeId !== propertyTypeId) continue;
          if (rule.cityId && rule.cityId !== cityId) continue;
          if (rule.leadProviderId && rule.leadProviderId !== providerId) continue;
          if (rule.brokerOrganizationId && rule.brokerOrganizationId !== deal.brokerOrganizationId) continue;

          let recipient: { userId?: string; orgId?: string; leadProviderId?: string; name: string } | null = null;
          let missing = '';
          switch (rule.recipientType) {
            case 'SALES_EMPLOYEE':
              if (deal.salesUser) recipient = { userId: deal.salesUser.id, name: deal.salesUser.fullName };
              else missing = 'The deal has no sales person';
              break;
            case 'SALES_MANAGER': {
              const mgr = deal.salesUser?.employee?.manager?.user;
              if (mgr) recipient = { userId: mgr.id, name: mgr.fullName };
              else missing = 'The sales person has no reporting manager';
              break;
            }
            case 'BROKER':
              if (deal.brokerOrganization) recipient = { orgId: deal.brokerOrganization.id, name: deal.brokerOrganization.name };
              else missing = 'No co-broking organisation on the deal';
              break;
            case 'LEAD_PROVIDER':
              if (provider) recipient = { leadProviderId: provider.id, orgId: provider.organizationId, name: provider.name };
              else missing = 'The deal did not come from a lead provider';
              break;
            case 'COMPANY':
              recipient = { orgId: deal.organization.id, name: deal.organization.name };
              break;
            case 'PARTNER':
              missing = 'Partner commissions name a specific partner — add them as manual records';
              break;
          }
          if (!recipient) {
            out.skipped.push({ rule: rule.name, reason: missing });
            continue;
          }
          const basis = rule.basis === 'COMPANY_REVENUE' ? (deal.expectedRevenue === null ? null : Number(deal.expectedRevenue)) : Number(deal.dealValue);
          if (basis === null) {
            out.skipped.push({ rule: rule.name, reason: 'The deal has no expected company revenue recorded' });
            continue;
          }
          const existing = await tx.commissionRecord.findFirst({
            where: {
              dealId,
              ruleId: rule.id,
              recipientType: rule.recipientType,
              recipientUserId: recipient.userId ?? null,
              recipientOrganizationId: recipient.orgId ?? null,
              leadProviderId: recipient.leadProviderId ?? null,
            },
            select: { id: true },
          });
          if (existing) {
            out.skipped.push({ rule: rule.name, reason: 'Already generated' });
            continue;
          }
          const calc = calculateCommission({ calcType: rule.calcType, value: Number(rule.value), minDealValue: rule.minDealValue === null ? null : Number(rule.minDealValue), maxPayout: rule.maxPayout === null ? null : Number(rule.maxPayout) }, basis);
          if (!calc.applicable) {
            out.skipped.push({ rule: rule.name, reason: calc.explanation });
            continue;
          }
          const rec = await tx.commissionRecord.create({
            data: {
              organizationId: deal.organizationId,
              dealId,
              ruleId: rule.id,
              recipientType: rule.recipientType,
              recipientUserId: recipient.userId ?? null,
              recipientOrganizationId: recipient.orgId ?? null,
              leadProviderId: recipient.leadProviderId ?? null,
              recipientName: recipient.name,
              basisAmount: basis,
              calcType: rule.calcType,
              rate: rule.value,
              amount: calc.amount,
              status: 'PENDING_APPROVAL',
              notes: `${calc.explanation} — rule "${rule.name}"`,
            },
          });
          out.created.push({ id: rec.id, rule: rule.name, recipientName: recipient.name, amount: calc.amount });
        }
        if (out.created.length) {
          await this.audit.log({ actorId: actor?.id ?? null, action: 'commission.generate', entityType: 'Deal', entityId: dealId, organizationId: deal.organizationId, after: { created: out.created } }, tx);
        }
        return out;
      },
      { timeout: 30_000 },
    );
    return result;
  }

  /** Scheduled: generate for every eligible deal (idempotent). */
  async generateForEligibleDeals(tx: Tx): Promise<number> {
    const deals = await tx.deal.findMany({
      where: { status: { in: [...ELIGIBLE_DEAL_STATUSES] }, updatedAt: { gte: new Date(Date.now() - 180 * 86_400_000) } },
      select: { id: true },
      take: 500,
    });
    let created = 0;
    for (const d of deals) created += (await this.generateForDeal(d.id)).created.length;
    return created;
  }

  async eligibleDeals(user: AuthUser, q: { q?: string }) {
    const scope = this.platformScope(user, 'commission.manage');
    return this.prisma.deal.findMany({
      where: {
        status: { in: [...ELIGIBLE_DEAL_STATUSES] },
        ...(scope === 'ALL' ? {} : { organizationId: { in: scope } }),
        ...(q.q ? { OR: [{ dealNo: { contains: q.q, mode: 'insensitive' } }, { customer: { fullName: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        dealNo: true,
        status: true,
        dealType: true,
        dealValue: true,
        expectedRevenue: true,
        bookingDate: true,
        customer: { select: { fullName: true } },
        project: { select: { name: true } },
        property: { select: { title: true } },
        unit: { select: { code: true } },
        salesUser: { select: { id: true, fullName: true } },
        brokerOrganization: { select: { id: true, name: true } },
        leadProvider: { select: { id: true, name: true } },
        lead: { select: { leadProvider: { select: { id: true, name: true } } } },
        _count: { select: { commissionRecords: true } },
      },
    });
  }

  // ───────────────────────── Records ─────────────────────────

  async records(user: AuthUser, q: RecordListQuery) {
    const scope = this.platformScope(user, 'commission.view');
    const base: Prisma.CommissionRecordWhereInput = {
      ...this.scopeWhere(scope),
      ...(q.recipientType ? { recipientType: q.recipientType } : {}),
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.q ? { OR: [{ recipientName: { contains: q.q, mode: 'insensitive' } }, { deal: { dealNo: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const where = { ...base, ...(q.status ? { status: q.status } : {}) };
    const [rows, total, counts, sums] = await Promise.all([
      this.prisma.commissionRecord.findMany({ where, orderBy: { createdAt: 'desc' }, select: recordSelect, ...skipTake(q) }),
      this.prisma.commissionRecord.count({ where }),
      this.prisma.commissionRecord.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.commissionRecord.groupBy({ by: ['status'], where: base, _sum: { amount: true, amountPaid: true } }),
    ]);
    return {
      ...paginated(rows, total, q),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      statusAmounts: Object.fromEntries(sums.map((s) => [s.status, Number(s._sum.amount ?? 0) - (s.status === 'PAID' ? 0 : Number(s._sum.amountPaid ?? 0))])),
    };
  }

  async createManual(user: AuthUser, input: z.output<typeof commissionManualSchema>) {
    const deal = await this.prisma.deal.findUnique({ where: { id: input.dealId }, select: { id: true, organizationId: true, dealNo: true } });
    if (!deal) throw new BadRequestException({ message: 'Deal not found', details: [{ path: 'dealId', message: 'Not found' }] });
    user.assert('commission.manage', deal.organizationId);
    const needUser = input.recipientType === 'SALES_EMPLOYEE' || input.recipientType === 'SALES_MANAGER';
    if (needUser && !input.recipientUserId) throw new BadRequestException({ message: 'Choose the employee who earns this commission', details: [{ path: 'recipientUserId', message: 'Required' }] });
    if (input.recipientType === 'BROKER' && !input.recipientOrganizationId) throw new BadRequestException({ message: 'Choose the broker organisation', details: [{ path: 'recipientOrganizationId', message: 'Required' }] });
    if (input.recipientType === 'LEAD_PROVIDER' && !input.leadProviderId) throw new BadRequestException({ message: 'Choose the lead provider', details: [{ path: 'leadProviderId', message: 'Required' }] });
    if (input.recipientUserId && !(await this.prisma.user.findUnique({ where: { id: input.recipientUserId }, select: { id: true } }))) throw new BadRequestException({ message: 'Recipient not found', details: [{ path: 'recipientUserId', message: 'Not found' }] });
    let leadProviderOrg: string | null = null;
    if (input.leadProviderId) {
      const lp = await this.prisma.leadProvider.findUnique({ where: { id: input.leadProviderId }, select: { organizationId: true } });
      if (!lp) throw new BadRequestException({ message: 'Lead provider not found', details: [{ path: 'leadProviderId', message: 'Not found' }] });
      leadProviderOrg = lp.organizationId;
    }
    if (input.calcType === 'PERCENTAGE' && input.value > 100) throw new BadRequestException({ message: 'Percentage cannot exceed 100', details: [{ path: 'value', message: 'Max 100' }] });
    const calc = calculateCommission({ calcType: input.calcType, value: input.value }, input.basisAmount);
    const rec = await this.prisma.$transaction(async (tx) => {
      const r = await tx.commissionRecord.create({
        data: {
          organizationId: deal.organizationId,
          dealId: deal.id,
          recipientType: input.recipientType,
          recipientUserId: input.recipientUserId ?? null,
          recipientOrganizationId: input.recipientOrganizationId ?? leadProviderOrg,
          leadProviderId: input.leadProviderId ?? null,
          recipientName: input.recipientName,
          basisAmount: input.basisAmount,
          calcType: input.calcType,
          rate: input.value,
          amount: calc.amount,
          notes: [`Manual: ${calc.explanation}`, input.notes].filter(Boolean).join('\n'),
        },
      });
      await this.audit.log({ actorId: user.id, action: 'commission.create_manual', entityType: 'CommissionRecord', entityId: r.id, organizationId: deal.organizationId, after: { dealNo: deal.dealNo, recipient: input.recipientName, amount: calc.amount } }, tx);
      return r;
    });
    return rec;
  }

  async transition(user: AuthUser, id: string, status: 'APPROVED' | 'PAYABLE' | 'CANCELLED', notes?: string) {
    const rec = await this.prisma.commissionRecord.findUnique({ where: { id }, include: { payoutItems: { include: { payout: { select: { status: true } } } } } });
    if (!rec) throw new NotFoundException('Commission record not found');
    if (!COMMISSION_STATUS_TRANSITIONS[rec.status].includes(status)) {
      throw new ConflictException({ message: `A ${rec.status.toLowerCase().replace(/_/g, ' ')} commission cannot be moved to ${status.toLowerCase()}`, code: 'INVALID_TRANSITION' });
    }
    if (status === 'APPROVED') {
      user.assert('commission.approve', rec.organizationId, 'You cannot approve commissions');
      if (rec.recipientUserId === user.id) throw new ForbiddenException('You cannot approve a commission paid to yourself');
      if (rec.recipientOrganizationId && user.isMemberOf(rec.recipientOrganizationId) && rec.recipientOrganizationId !== user.platformOrganizationId) {
        throw new ForbiddenException('You cannot approve a commission paid to your own organisation');
      }
    } else {
      user.assert('commission.manage', rec.organizationId, 'You cannot change commissions');
    }
    if (status === 'CANCELLED') {
      if (Number(rec.amountPaid) > 0) throw new ConflictException('Part of this commission has been paid — it cannot be cancelled');
      if (rec.payoutItems.some((i) => i.payout.status === 'PENDING')) throw new ConflictException('This commission is in a pending payout — cancel the payout first');
      const scheduled = await this.prisma.payrollAdjustment.count({ where: { sourceRef: `COMMISSION:${id}`, status: { in: ['PENDING', 'APPLIED'] } } });
      if (scheduled) throw new ConflictException('This commission is scheduled in payroll — cancel the payroll adjustment first');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.commissionRecord.updateMany({
        where: { id, status: rec.status },
        data: {
          status,
          ...(status === 'APPROVED' ? { approvedById: user.id, approvedAt: new Date() } : {}),
          ...(notes ? { notes: [rec.notes, notes].filter(Boolean).join('\n') } : {}),
        },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This commission was changed by someone else. Refresh and try again.', code: 'CONCURRENT_UPDATE' });
      await this.audit.log({ actorId: user.id, action: `commission.${status.toLowerCase()}`, entityType: 'CommissionRecord', entityId: id, organizationId: rec.organizationId, before: { status: rec.status }, after: { status }, metadata: notes ? { notes } : undefined }, tx);
      return tx.commissionRecord.findUniqueOrThrow({ where: { id }, select: recordSelect });
    });
    return updated;
  }

  // ───────────────────────── Payouts ─────────────────────────

  async payouts(user: AuthUser, q: Pagination & { status?: 'PENDING' | 'PAID' | 'CANCELLED' }) {
    const scope = this.platformScope(user, 'commission.view');
    const where: Prisma.CommissionPayoutWhereInput = { ...(scope === 'ALL' ? {} : { organizationId: { in: scope } }), ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.commissionPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { select: { amount: true, commissionRecord: { select: { id: true, deal: { select: { dealNo: true } }, rule: { select: { name: true } } } } } },
          recordedBy: { select: { fullName: true } },
          transactions: { select: { txnNo: true, txnDate: true } },
        },
        ...skipTake(q),
      }),
      this.prisma.commissionPayout.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async createPayout(user: AuthUser, input: z.output<typeof payoutCreateSchema>) {
    const records = await this.prisma.commissionRecord.findMany({
      where: { id: { in: input.commissionRecordIds } },
      include: { payoutItems: { include: { payout: { select: { status: true } } } } },
    });
    if (records.length !== new Set(input.commissionRecordIds).size) throw new BadRequestException('Some commission records were not found');
    const first = records[0];
    for (const r of records) {
      user.assert('commission.manage', r.organizationId);
      if (r.status !== 'PAYABLE') throw new ConflictException({ message: `${r.recipientName}: only payable commissions can be paid out`, code: 'NOT_PAYABLE' });
      if (r.payoutItems.some((i) => i.payout.status === 'PENDING')) throw new ConflictException(`${r.recipientName}: already in a pending payout`);
      const same = r.organizationId === first.organizationId && r.recipientType === first.recipientType && r.recipientUserId === first.recipientUserId && r.recipientOrganizationId === first.recipientOrganizationId && r.leadProviderId === first.leadProviderId;
      if (!same) throw new BadRequestException('A payout must contain commissions for a single recipient');
    }
    const scheduled = await this.prisma.payrollAdjustment.count({ where: { sourceRef: { in: records.map((r) => `COMMISSION:${r.id}`) }, status: { in: ['PENDING', 'APPLIED'] } } });
    if (scheduled) throw new ConflictException('Some of these commissions are already scheduled through payroll');
    const totalPaise = records.reduce((s, r) => s + toPaise(Number(r.amount)) - toPaise(Number(r.amountPaid)), 0);
    const payout = await this.prisma.$transaction(async (tx) => {
      const p = await tx.commissionPayout.create({
        data: {
          payoutNo: await nextReference(tx, 'PO'),
          organizationId: first.organizationId,
          recipientType: first.recipientType,
          recipientUserId: first.recipientUserId,
          recipientOrganizationId: first.recipientOrganizationId,
          leadProviderId: first.leadProviderId,
          recipientName: first.recipientName,
          totalAmount: fromPaise(totalPaise),
          notes: input.notes ?? null,
          recordedById: user.id,
          items: { create: records.map((r) => ({ commissionRecordId: r.id, amount: fromPaise(toPaise(Number(r.amount)) - toPaise(Number(r.amountPaid))) })) },
        },
      });
      await this.audit.log({ actorId: user.id, action: 'commission.payout.create', entityType: 'CommissionPayout', entityId: p.id, organizationId: first.organizationId, after: { payoutNo: p.payoutNo, total: fromPaise(totalPaise), records: records.length } }, tx);
      return p;
    });
    return payout;
  }

  async payPayout(user: AuthUser, id: string, input: z.output<typeof payoutPaySchema>) {
    const payout = await this.prisma.commissionPayout.findUnique({ where: { id }, include: { items: true } });
    if (!payout) throw new NotFoundException('Payout not found');
    user.assert('commission.manage', payout.organizationId);
    if (payout.status !== 'PENDING') throw new ConflictException(`This payout is already ${payout.status.toLowerCase()}`);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.commissionPayout.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PAID', paidOn: dateOnly(input.paidOn), method: input.method, referenceNo: input.referenceNo ?? null } });
      if (res.count !== 1) throw new ConflictException('This payout was changed by someone else');
      for (const item of payout.items) {
        const rec = await tx.commissionRecord.findUniqueOrThrow({ where: { id: item.commissionRecordId } });
        const paid = fromPaise(toPaise(Number(rec.amountPaid)) + toPaise(Number(item.amount)));
        await tx.commissionRecord.update({ where: { id: rec.id }, data: { amountPaid: paid, status: paid >= Number(rec.amount) ? 'PAID' : rec.status } });
      }
      await tx.financeTransaction.create({
        data: {
          txnNo: await nextReference(tx, 'TXN'),
          organizationId: payout.organizationId,
          type: 'COMMISSION_PAYOUT',
          direction: 'OUTFLOW',
          amount: payout.totalAmount,
          txnDate: dateOnly(input.paidOn),
          method: input.method,
          referenceNo: input.referenceNo ?? null,
          counterparty: payout.recipientName,
          description: `Commission payout ${payout.payoutNo}`,
          payoutId: payout.id,
          recordedById: user.id,
        },
      });
      await this.audit.log({ actorId: user.id, action: 'commission.payout.pay', entityType: 'CommissionPayout', entityId: id, organizationId: payout.organizationId, after: { status: 'PAID', paidOn: input.paidOn, method: input.method, amount: Number(payout.totalAmount) } }, tx);
    });
    return { ok: true };
  }

  async cancelPayout(user: AuthUser, id: string) {
    const payout = await this.prisma.commissionPayout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    user.assert('commission.manage', payout.organizationId);
    if (payout.status !== 'PENDING') throw new ConflictException('Only pending payouts can be cancelled');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.commissionPayout.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (res.count !== 1) throw new ConflictException('This payout was changed by someone else');
      await this.audit.log({ actorId: user.id, action: 'commission.payout.cancel', entityType: 'CommissionPayout', entityId: id, organizationId: payout.organizationId }, tx);
    });
    return { ok: true };
  }

  /**
   * Employee commissions can be paid with salary: creates PENDING payroll adjustments (INCENTIVE,
   * sourceRef COMMISSION:<id>). The payroll run applies them; once that run is PAID the scheduled
   * sync (syncPayrollPaidCommissions) marks the commissions PAID. No separate ledger entry is made —
   * the salary payment transaction already records the cash.
   */
  async payViaPayroll(user: AuthUser, input: z.output<typeof commissionPayViaPayrollSchema>) {
    const records = await this.prisma.commissionRecord.findMany({ where: { id: { in: input.commissionRecordIds } }, include: { deal: { select: { dealNo: true } }, rule: { select: { name: true } } } });
    if (records.length !== new Set(input.commissionRecordIds).size) throw new BadRequestException('Some commission records were not found');
    const created: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const r of records) {
        user.assert('commission.manage', r.organizationId);
        if (r.status !== 'PAYABLE') throw new ConflictException(`${r.recipientName}: only payable commissions can be scheduled`);
        if (!r.recipientUserId || !['SALES_EMPLOYEE', 'SALES_MANAGER'].includes(r.recipientType)) throw new ConflictException(`${r.recipientName}: only employee commissions can be paid through payroll`);
        if (r.recipientUserId === user.id) throw new ForbiddenException('You cannot schedule your own commission through payroll');
        const employee = await tx.employee.findUnique({ where: { userId: r.recipientUserId }, select: { id: true, organizationId: true, employmentStatus: true, deletedAt: true } });
        if (!employee || employee.deletedAt || employee.employmentStatus === 'EXITED') throw new ConflictException(`${r.recipientName} is not an active employee`);
        const locked = await tx.payrollRun.findFirst({ where: { organizationId: employee.organizationId, periodYear: input.periodYear, periodMonth: input.periodMonth, status: { in: ['APPROVED', 'PAID'] } }, select: { status: true } });
        if (locked) throw new ConflictException(`Payroll for ${input.periodYear}-${String(input.periodMonth).padStart(2, '0')} is already ${locked.status.toLowerCase()} — choose a later month`);
        const existing = await tx.payrollAdjustment.count({ where: { sourceRef: `COMMISSION:${r.id}`, status: { in: ['PENDING', 'APPLIED'] } } });
        if (existing) throw new ConflictException(`${r.recipientName}: already scheduled in payroll`);
        const outstanding = fromPaise(toPaise(Number(r.amount)) - toPaise(Number(r.amountPaid)));
        const adj = await tx.payrollAdjustment.create({
          data: {
            employeeId: employee.id,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            type: 'INCENTIVE',
            amount: outstanding,
            description: `Commission ${r.deal.dealNo}${r.rule ? ` — ${r.rule.name}` : ''}`.slice(0, 200),
            sourceRef: `COMMISSION:${r.id}`,
            createdById: user.id,
          },
        });
        await tx.commissionRecord.update({ where: { id: r.id }, data: { notes: [r.notes, `Scheduled through payroll ${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}`].filter(Boolean).join('\n') } });
        await this.audit.log({ actorId: user.id, action: 'commission.pay_via_payroll', entityType: 'CommissionRecord', entityId: r.id, organizationId: r.organizationId, after: { adjustmentId: adj.id, period: `${input.periodYear}-${input.periodMonth}`, amount: outstanding } }, tx);
        created.push(adj.id);
      }
    });
    return { scheduled: created.length, adjustmentIds: created };
  }

  /** Scheduled: commissions/reimbursements paid through a PAID payroll run are marked PAID. */
  async syncPayrollPaidCommissions(tx: Tx): Promise<number> {
    const adjustments = await tx.payrollAdjustment.findMany({
      where: { sourceRef: { startsWith: 'COMMISSION:' }, status: 'APPLIED', payrollRun: { status: 'PAID' } },
      select: { sourceRef: true, amount: true, payrollRun: { select: { periodYear: true, periodMonth: true } } },
    });
    let updated = 0;
    for (const a of adjustments) {
      const id = a.sourceRef!.slice('COMMISSION:'.length);
      const rec = await tx.commissionRecord.findUnique({ where: { id } });
      if (!rec || rec.status !== 'PAYABLE') continue;
      await tx.commissionRecord.update({
        where: { id },
        data: { status: 'PAID', amountPaid: rec.amount, notes: [rec.notes, `Paid through payroll ${a.payrollRun!.periodYear}-${String(a.payrollRun!.periodMonth).padStart(2, '0')}`].filter(Boolean).join('\n') },
      });
      await this.audit.log({ actorId: null, action: 'commission.paid_via_payroll', entityType: 'CommissionRecord', entityId: id, organizationId: rec.organizationId, after: { status: 'PAID' } }, tx);
      updated += 1;
    }
    return updated;
  }

  // ───────────────────────── Statements ─────────────────────────

  async statement(user: AuthUser, q: Pagination & { status?: CommissionStatus }) {
    const orgIds = user.memberships.filter((m) => m.organizationType !== 'PLATFORM' && user.can('commission.self', m.organizationId)).map((m) => m.organizationId);
    const ownAllowed = user.can('commission.self') || Boolean(user.employeeId);
    if (!ownAllowed && !orgIds.length) throw new ForbiddenException('You do not have a commission statement');
    const providers = orgIds.length ? await this.prisma.leadProvider.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } }) : [];
    const base: Prisma.CommissionRecordWhereInput = {
      OR: [
        { recipientUserId: user.id },
        ...(orgIds.length ? [{ recipientOrganizationId: { in: orgIds } }] : []),
        ...(providers.length ? [{ leadProviderId: { in: providers.map((p) => p.id) } }] : []),
      ],
    };
    const where = { ...base, ...(q.status ? { status: q.status } : {}) };
    const [rows, total, sums] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          recipientType: true,
          recipientName: true,
          basisAmount: true,
          calcType: true,
          rate: true,
          amount: true,
          amountPaid: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          rule: { select: { name: true } },
          deal: { select: { dealNo: true, dealType: true, bookingDate: true, project: { select: { name: true } }, property: { select: { title: true } }, unit: { select: { code: true } } } },
          payoutItems: { select: { payout: { select: { payoutNo: true, status: true, paidOn: true } } } },
        },
        ...skipTake(q),
      }),
      this.prisma.commissionRecord.count({ where }),
      this.prisma.commissionRecord.groupBy({ by: ['status'], where: base, _sum: { amount: true } }),
    ]);
    const totals: CommissionStatementTotals = { PENDING_APPROVAL: 0, APPROVED: 0, PAYABLE: 0, PAID: 0, CANCELLED: 0 };
    for (const s of sums) totals[s.status] = Number(s._sum.amount ?? 0);
    return { ...paginated(rows, total, q), totals };
  }
}
