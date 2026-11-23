import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type {
  assignmentRuleSchema,
  campaignSchema,
  customerPreferenceSchema,
  customerUpdateSchema,
  leadSourceSchema,
  routingTestSchema,
  salesTeamSchema,
} from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { paginated, Pagination, skipTake } from '../../common/http';
import { normalizePhone } from '@estate/shared';
import { AssignmentService } from './assignment.service';
import { assignableUsers, OPEN_LEAD_WHERE, orgScope, resolveOrg } from './crm-access';

/** Sales teams, assignment rules, campaigns, lead sources and customers. */
@Injectable()
export class CrmConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignment: AssignmentService,
  ) {}

  // ───────────── Assignable people ─────────────

  async assignees(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? resolveOrg(user, 'lead.view_all', null);
    if (!user.can('lead.assign', orgId) && !user.can('lead.view_all', orgId) && !user.can('assignment.manage', orgId) && !user.can('site_visit.manage', orgId)) {
      return [];
    }
    const users = await assignableUsers(this.prisma, orgId);
    const counts = await this.assignment.openLeadCounts(this.prisma, users.map((u) => u.id));
    return users.map((u) => ({ ...u, openLeads: counts.get(u.id) ?? 0 }));
  }

  // ───────────── Teams ─────────────

  async teams(user: AuthUser, organizationId?: string) {
    const scope = organizationId ? (user.assert('assignment.manage', organizationId), { organizationId }) : orgScope(user, 'assignment.manage');
    const teams = await this.prisma.salesTeam.findMany({
      where: scope,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        organization: { select: { id: true, name: true } },
        manager: { select: { id: true, fullName: true } },
        members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: { id: true, fullName: true, email: true, status: true } } } },
        _count: { select: { rules: true } },
      },
    });
    const counts = await this.assignment.openLeadCounts(this.prisma, [...new Set(teams.flatMap((t) => t.members.map((m) => m.userId)))]);
    return teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m, openLeads: counts.get(m.userId) ?? 0 })) }));
  }

  private async assertMembers(organizationId: string, userIds: string[]) {
    if (!userIds.length) return;
    const allowed = new Set((await assignableUsers(this.prisma, organizationId)).map((u) => u.id));
    const bad = userIds.filter((id) => !allowed.has(id));
    if (bad.length) throw new BadRequestException({ message: 'Team members must be active members of the organisation who can work leads', details: bad.map(() => ({ path: 'memberIds', message: 'Not eligible' })) });
  }

  async createTeam(user: AuthUser, input: z.output<typeof salesTeamSchema>) {
    const organizationId = resolveOrg(user, 'assignment.manage', input.organizationId);
    await this.assertMembers(organizationId, input.memberIds ?? []);
    if (input.managerId) await this.assertManager(organizationId, input.managerId);
    if (await this.prisma.salesTeam.findFirst({ where: { organizationId, name: input.name } })) throw new ConflictException({ message: 'A team with this name already exists', code: 'DUPLICATE' });
    const team = await this.prisma.$transaction(async (tx) => {
      const t = await tx.salesTeam.create({
        data: { organizationId, name: input.name, description: input.description ?? null, managerId: input.managerId ?? null, isActive: input.isActive ?? true, members: { create: (input.memberIds ?? []).map((userId) => ({ userId })) } },
      });
      await this.audit.log({ actorId: user.id, action: 'crm.team.create', entityType: 'SalesTeam', entityId: t.id, organizationId, after: { name: t.name, members: input.memberIds ?? [] } }, tx);
      return t;
    });
    return team;
  }

  private async assertManager(organizationId: string, userId: string) {
    const m = await this.prisma.organizationMember.findFirst({ where: { organizationId, userId, status: 'ACTIVE' } });
    if (!m) throw new BadRequestException({ message: 'The manager must be a member of the organisation', details: [{ path: 'managerId', message: 'Not a member' }] });
  }

  private async loadTeam(user: AuthUser, id: string) {
    const team = await this.prisma.salesTeam.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    user.assert('assignment.manage', team.organizationId);
    return team;
  }

  async updateTeam(user: AuthUser, id: string, input: Partial<z.output<typeof salesTeamSchema>>) {
    const team = await this.loadTeam(user, id);
    if (input.managerId) await this.assertManager(team.organizationId, input.managerId);
    if (input.name && input.name !== team.name && (await this.prisma.salesTeam.findFirst({ where: { organizationId: team.organizationId, name: input.name } }))) {
      throw new ConflictException({ message: 'A team with this name already exists', code: 'DUPLICATE' });
    }
    if (input.memberIds) await this.assertMembers(team.organizationId, input.memberIds);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.salesTeam.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      if (input.memberIds) {
        const wanted = new Set(input.memberIds);
        const current = await tx.salesTeamMember.findMany({ where: { teamId: id } });
        for (const m of current) if (!wanted.has(m.userId)) await tx.salesTeamMember.delete({ where: { id: m.id } });
        for (const userId of wanted) {
          if (!current.some((m) => m.userId === userId)) await tx.salesTeamMember.create({ data: { teamId: id, userId } });
        }
      }
      await this.audit.log({ actorId: user.id, action: 'crm.team.update', entityType: 'SalesTeam', entityId: id, organizationId: team.organizationId, before: { name: team.name, isActive: team.isActive }, after: input }, tx);
      return row;
    });
  }

  async setMember(user: AuthUser, teamId: string, userId: string, isActive: boolean) {
    const team = await this.loadTeam(user, teamId);
    await this.assertMembers(team.organizationId, [userId]);
    const row = await this.prisma.salesTeamMember.upsert({ where: { teamId_userId: { teamId, userId } }, create: { teamId, userId, isActive }, update: { isActive } });
    await this.audit.log({ actorId: user.id, action: 'crm.team.member', entityType: 'SalesTeam', entityId: teamId, organizationId: team.organizationId, after: { userId, isActive } });
    return row;
  }

  async removeMember(user: AuthUser, teamId: string, userId: string) {
    const team = await this.loadTeam(user, teamId);
    await this.prisma.salesTeamMember.deleteMany({ where: { teamId, userId } });
    await this.audit.log({ actorId: user.id, action: 'crm.team.member.remove', entityType: 'SalesTeam', entityId: teamId, organizationId: team.organizationId, before: { userId } });
    return { ok: true };
  }

  // ───────────── Rules ─────────────

  async rules(user: AuthUser, organizationId?: string) {
    const scope = organizationId ? (user.assert('assignment.manage', organizationId), { organizationId }) : orgScope(user, 'assignment.manage');
    return this.prisma.assignmentRule.findMany({
      where: scope,
      orderBy: [{ organizationId: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      include: { salesTeam: { select: { id: true, name: true, isActive: true } }, matchProject: { select: { id: true, name: true } }, organization: { select: { id: true, name: true } }, _count: { select: { assignments: true } } },
    });
  }

  private async validateRule(organizationId: string, input: Partial<z.output<typeof assignmentRuleSchema>>) {
    if (input.salesTeamId) {
      const team = await this.prisma.salesTeam.findFirst({ where: { id: input.salesTeamId, organizationId } });
      if (!team) throw new BadRequestException({ message: 'Choose a team from this organisation', details: [{ path: 'salesTeamId', message: 'Invalid team' }] });
    }
    if (input.matchProjectId) {
      const p = await this.prisma.project.findFirst({ where: { id: input.matchProjectId, deletedAt: null }, select: { id: true } });
      if (!p) throw new BadRequestException({ message: 'Project not found', details: [{ path: 'matchProjectId', message: 'Invalid project' }] });
    }
    if (input.matchSourceKeys?.length) {
      const count = await this.prisma.leadSource.count({ where: { key: { in: input.matchSourceKeys } } });
      if (count !== new Set(input.matchSourceKeys).size) throw new BadRequestException({ message: 'Unknown lead source in the rule', details: [{ path: 'matchSourceKeys', message: 'Invalid source' }] });
    }
    if (input.matchLocalityIds?.length) {
      const count = await this.prisma.locality.count({ where: { id: { in: input.matchLocalityIds } } });
      if (count !== new Set(input.matchLocalityIds).size) throw new BadRequestException({ message: 'Unknown locality in the rule', details: [{ path: 'matchLocalityIds', message: 'Invalid locality' }] });
    }
    if (input.matchCityIds?.length) {
      const count = await this.prisma.city.count({ where: { id: { in: input.matchCityIds } } });
      if (count !== new Set(input.matchCityIds).size) throw new BadRequestException({ message: 'Unknown city in the rule', details: [{ path: 'matchCityIds', message: 'Invalid city' }] });
    }
  }

  async createRule(user: AuthUser, input: z.output<typeof assignmentRuleSchema>) {
    const organizationId = resolveOrg(user, 'assignment.manage', input.organizationId);
    await this.validateRule(organizationId, input);
    const { organizationId: _o, ...data } = input;
    const rule = await this.prisma.assignmentRule.create({ data: { ...data, organizationId } });
    await this.audit.log({ actorId: user.id, action: 'crm.rule.create', entityType: 'AssignmentRule', entityId: rule.id, organizationId, after: rule });
    return rule;
  }

  private async loadRule(user: AuthUser, id: string) {
    const rule = await this.prisma.assignmentRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    user.assert('assignment.manage', rule.organizationId);
    return rule;
  }

  async updateRule(user: AuthUser, id: string, input: Partial<z.output<typeof assignmentRuleSchema>>) {
    const rule = await this.loadRule(user, id);
    await this.validateRule(rule.organizationId, input);
    const { organizationId: _o, ...data } = input;
    const row = await this.prisma.assignmentRule.update({ where: { id }, data });
    await this.audit.log({ actorId: user.id, action: 'crm.rule.update', entityType: 'AssignmentRule', entityId: id, organizationId: rule.organizationId, before: rule, after: row });
    return row;
  }

  async deleteRule(user: AuthUser, id: string) {
    const rule = await this.loadRule(user, id);
    await this.prisma.assignmentRule.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'crm.rule.delete', entityType: 'AssignmentRule', entityId: id, organizationId: rule.organizationId, before: rule });
    return { ok: true };
  }

  async reorderRules(user: AuthUser, ruleIds: string[]) {
    const rules = await this.prisma.assignmentRule.findMany({ where: { id: { in: ruleIds } } });
    if (rules.length !== ruleIds.length) throw new BadRequestException('Unknown rule in the list');
    const orgs = new Set(rules.map((r) => r.organizationId));
    if (orgs.size !== 1) throw new BadRequestException('Rules must belong to one organisation');
    const orgId = [...orgs][0];
    user.assert('assignment.manage', orgId);
    await this.prisma.$transaction(async (tx) => {
      for (const [i, id] of ruleIds.entries()) await tx.assignmentRule.update({ where: { id }, data: { priority: (i + 1) * 10 } });
      await this.audit.log({ actorId: user.id, action: 'crm.rule.reorder', entityType: 'AssignmentRule', organizationId: orgId, after: { order: ruleIds } }, tx);
    });
    return this.rules(user, orgId);
  }

  /** Dry-run routing for a hypothetical lead (no writes, no cursor movement). */
  async testRouting(user: AuthUser, input: z.output<typeof routingTestSchema>) {
    const organizationId = resolveOrg(user, 'assignment.manage', input.organizationId);
    let cityId = input.cityId ?? null;
    let localityId = input.localityId ?? null;
    let projectId = input.projectId ?? null;
    let listingType = input.listingType ?? null;
    if (input.propertyId) {
      const p = await this.prisma.property.findUnique({ where: { id: input.propertyId }, select: { cityId: true, localityId: true, projectId: true, listingType: true } });
      if (p) {
        cityId = p.cityId;
        localityId = p.localityId;
        projectId = projectId ?? p.projectId;
        listingType = listingType ?? p.listingType;
      }
    } else if (projectId) {
      const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { cityId: true, localityId: true } });
      if (p) {
        cityId = cityId ?? p.cityId;
        localityId = localityId ?? p.localityId;
      }
    }
    const decision = await this.assignment.decide(this.prisma, organizationId, { projectId, cityId, localityId, sourceKey: input.sourceKey, listingType });
    return { organizationId, facts: { projectId, cityId, localityId, sourceKey: input.sourceKey, listingType }, ...decision };
  }

  // ───────────── Campaigns & sources ─────────────

  async campaigns(user: AuthUser) {
    const scope = orgScope(user, 'marketing.manage');
    const rows = await this.prisma.campaign.findMany({ where: scope, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], include: { organization: { select: { id: true, name: true } } } });
    const counts = await this.prisma.lead.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: rows.map((r) => r.id) }, deletedAt: null }, _count: { _all: true } });
    return rows.map((c) => {
      const mine = counts.filter((x) => x.campaignId === c.id);
      return { ...c, leads: mine.reduce((s, x) => s + x._count._all, 0), converted: mine.filter((x) => x.status === 'CONVERTED').reduce((s, x) => s + x._count._all, 0) };
    });
  }

  /** Active campaigns a user can attach to leads they create. */
  async campaignOptions(user: AuthUser) {
    const scope = orgScope(user, 'lead.create');
    return this.prisma.campaign.findMany({
      where: { ...scope, status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true, name: true, code: true, organizationId: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCampaign(user: AuthUser, input: z.output<typeof campaignSchema>) {
    const organizationId = resolveOrg(user, 'marketing.manage', input.organizationId);
    if (await this.prisma.campaign.findFirst({ where: { organizationId, code: input.code } })) throw new ConflictException({ message: 'A campaign with this code already exists', code: 'DUPLICATE' });
    const row = await this.prisma.campaign.create({ data: this.campaignData(input, organizationId) as Prisma.CampaignUncheckedCreateInput });
    await this.audit.log({ actorId: user.id, action: 'crm.campaign.create', entityType: 'Campaign', entityId: row.id, organizationId, after: row });
    return row;
  }

  private campaignData(input: Partial<z.output<typeof campaignSchema>>, organizationId?: string) {
    const { organizationId: _o, startDate, endDate, ...rest } = input;
    return {
      ...rest,
      ...(organizationId ? { organizationId } : {}),
      ...(startDate !== undefined ? { startDate: startDate ? new Date(`${startDate}T00:00:00Z`) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(`${endDate}T00:00:00Z`) : null } : {}),
    };
  }

  async updateCampaign(user: AuthUser, id: string, input: Partial<z.output<typeof campaignSchema>>) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    user.assert('marketing.manage', c.organizationId);
    if (input.code && input.code !== c.code && (await this.prisma.campaign.findFirst({ where: { organizationId: c.organizationId, code: input.code } }))) {
      throw new ConflictException({ message: 'A campaign with this code already exists', code: 'DUPLICATE' });
    }
    const row = await this.prisma.campaign.update({ where: { id }, data: this.campaignData(input) as Prisma.CampaignUncheckedUpdateInput });
    await this.audit.log({ actorId: user.id, action: 'crm.campaign.update', entityType: 'Campaign', entityId: id, organizationId: c.organizationId, before: c, after: row });
    return row;
  }

  async sources() {
    return this.prisma.leadSource.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { _count: { select: { leads: true } } } });
  }

  async createSource(user: AuthUser, input: z.output<typeof leadSourceSchema>) {
    if (await this.prisma.leadSource.findUnique({ where: { key: input.key } })) throw new ConflictException({ message: 'A source with this key already exists', code: 'DUPLICATE' });
    const row = await this.prisma.leadSource.create({ data: { key: input.key, name: input.name, isActive: input.isActive, isSystem: false } });
    await this.audit.log({ actorId: user.id, action: 'crm.source.create', entityType: 'LeadSource', entityId: row.id, after: row });
    return row;
  }

  async updateSource(user: AuthUser, id: string, input: { name?: string; isActive?: boolean }) {
    const s = await this.prisma.leadSource.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Source not found');
    if (s.isSystem && input.isActive === false) throw new ConflictException({ message: 'System sources cannot be deactivated', code: 'SYSTEM_SOURCE' });
    const row = await this.prisma.leadSource.update({ where: { id }, data: input });
    await this.audit.log({ actorId: user.id, action: 'crm.source.update', entityType: 'LeadSource', entityId: id, before: s, after: row });
    return row;
  }

  // ───────────── Customers ─────────────

  async customers(user: AuthUser, q: Pagination & { q?: string; organizationId?: string }) {
    const term = q.q?.trim();
    const phone = term ? normalizePhone(term) : null;
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...orgScope(user, 'customer.view'),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(term ? { OR: [{ fullName: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }, { phone: { contains: phone ?? term.replace(/\s/g, '') } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: { organization: { select: { id: true, name: true } }, _count: { select: { leads: true, deals: true, siteVisits: true, enquiries: true } } },
        ...skipTake(q),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async customer(user: AuthUser, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
        preferences: { orderBy: { createdAt: 'desc' }, include: { city: { select: { id: true, name: true } } } },
        leads: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, leadNo: true, status: true, priority: true, createdAt: true, assignedTo: { select: { fullName: true } }, project: { select: { name: true } }, property: { select: { title: true } } } },
        enquiries: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, referenceNo: true, type: true, status: true, createdAt: true, property: { select: { title: true } }, project: { select: { name: true } } } },
        siteVisits: { orderBy: { scheduledAt: 'desc' }, take: 50, select: { id: true, status: true, scheduledAt: true, property: { select: { title: true } }, project: { select: { name: true } } } },
        deals: { orderBy: { createdAt: 'desc' }, select: { id: true, dealNo: true, status: true, dealValue: true, createdAt: true } },
      },
    });
    if (!c || !user.can('customer.view', c.organizationId)) throw new NotFoundException('Customer not found');
    return { ...c, canEdit: user.can('customer.manage', c.organizationId) };
  }

  async updateCustomer(user: AuthUser, id: string, input: z.output<typeof customerUpdateSchema>) {
    const c = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('Customer not found');
    user.assert('customer.manage', c.organizationId);
    const row = await this.prisma.customer.update({ where: { id }, data: { ...input, ...(input.email !== undefined ? { email: input.email || null } : {}) } });
    await this.audit.log({ actorId: user.id, action: 'crm.customer.update', entityType: 'Customer', entityId: id, organizationId: c.organizationId, before: c, after: row });
    return row;
  }

  async addPreference(user: AuthUser, id: string, input: z.output<typeof customerPreferenceSchema>) {
    const c = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('Customer not found');
    user.assert('customer.manage', c.organizationId);
    if (input.budgetMin != null && input.budgetMax != null && input.budgetMax < input.budgetMin) throw new BadRequestException({ message: 'Maximum budget must be at least the minimum', details: [{ path: 'budgetMax', message: 'Invalid range' }] });
    const row = await this.prisma.customerPreference.create({ data: { ...input, customerId: id } });
    await this.audit.log({ actorId: user.id, action: 'crm.customer.preference', entityType: 'Customer', entityId: id, organizationId: c.organizationId, after: row });
    return row;
  }

  async removePreference(user: AuthUser, id: string, prefId: string) {
    const pref = await this.prisma.customerPreference.findFirst({ where: { id: prefId, customerId: id }, include: { customer: { select: { organizationId: true } } } });
    if (!pref) throw new NotFoundException('Preference not found');
    user.assert('customer.manage', pref.customer.organizationId);
    await this.prisma.customerPreference.delete({ where: { id: prefId } });
    await this.audit.log({ actorId: user.id, action: 'crm.customer.preference.remove', entityType: 'Customer', entityId: id, organizationId: pref.customer.organizationId, before: pref });
    return { ok: true };
  }

  openLeadWhere() {
    return OPEN_LEAD_WHERE;
  }
}
