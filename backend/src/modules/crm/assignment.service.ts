import { Injectable } from '@nestjs/common';
import { assignmentMethodForRule, matchAssignmentRule, pickAssignee, type LeadRoutingFacts } from '@estate/shared';
import { AssignmentMethod, Prisma } from '../../generated/prisma/client';
import { Db, PrismaService, Tx } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { OPEN_LEAD_WHERE } from './crm-access';

export interface AssignOptions {
  method: AssignmentMethod;
  assignedById: string | null;
  ruleId?: string | null;
  teamId?: string | null;
  reason?: string | null;
}

export interface RoutingDecision {
  rule: { id: string; name: string; priority: number } | null;
  team: { id: string; name: string } | null;
  strategy: string | null;
  method: AssignmentMethod | null;
  assignee: { id: string; fullName: string; openLeads: number } | null;
  candidates: { id: string; fullName: string; openLeads: number; eligible: boolean }[];
  reason: string;
}

const leadForRouting = {
  id: true,
  leadNo: true,
  name: true,
  organizationId: true,
  projectId: true,
  listingType: true,
  preferredCityId: true,
  preferredLocalityId: true,
  assignedToId: true,
  status: true,
  source: { select: { key: true } },
  property: { select: { cityId: true, localityId: true, title: true } },
  project: { select: { cityId: true, localityId: true, name: true } },
  unit: { select: { code: true } },
} satisfies Prisma.LeadSelect;

type RoutingLead = Prisma.LeadGetPayload<{ select: typeof leadForRouting }>;

/** Lead assignment engine: ordered rules → team pool → round-robin / workload pick. */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async autoAssignEnabled(db: Db = this.prisma): Promise<boolean> {
    const flag = await db.featureFlag.findUnique({ where: { key: 'auto_assign_leads' } });
    return flag?.enabled ?? true;
  }

  private facts(lead: RoutingLead): LeadRoutingFacts {
    return {
      projectId: lead.projectId,
      cityId: lead.property?.cityId ?? lead.project?.cityId ?? lead.preferredCityId,
      localityId: lead.property?.localityId ?? lead.project?.localityId ?? lead.preferredLocalityId,
      sourceKey: lead.source.key,
      listingType: lead.listingType,
    };
  }

  /** Open-lead counts per user (workload). */
  async openLeadCounts(db: Db, userIds: string[]): Promise<Map<string, number>> {
    if (!userIds.length) return new Map();
    const rows = await db.lead.groupBy({ by: ['assignedToId'], where: { ...OPEN_LEAD_WHERE, assignedToId: { in: userIds } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.assignedToId as string, r._count._all]));
  }

  /** Eligible pool for a team: active members whose login is active and who still belong to the organisation. */
  private async teamPool(db: Db, teamId: string, organizationId: string) {
    const members = await db.salesTeamMember.findMany({
      where: {
        teamId,
        isActive: true,
        user: { status: 'ACTIVE', deletedAt: null, memberships: { some: { organizationId, status: 'ACTIVE' } } },
      },
      select: { userId: true, user: { select: { fullName: true } } },
    });
    const counts = await this.openLeadCounts(db, members.map((m) => m.userId));
    return members.map((m) => ({ userId: m.userId, fullName: m.user.fullName, openLeads: counts.get(m.userId) ?? 0 }));
  }

  /** Evaluates routing without writing anything (also used by the "test routing" tool). */
  async decide(db: Db, organizationId: string, facts: LeadRoutingFacts): Promise<RoutingDecision> {
    const rules = await db.assignmentRule.findMany({
      where: { organizationId, isActive: true, salesTeam: { isActive: true } },
      include: { salesTeam: { select: { id: true, name: true, lastAssignedUserId: true } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    if (!rules.length) return { rule: null, team: null, strategy: null, method: null, assignee: null, candidates: [], reason: 'No active assignment rules are configured for this organisation.' };
    let lastReason = 'No assignment rule matches this lead.';
    for (const rule of rules) {
      if (!matchAssignmentRule([rule], facts)) continue;
      const pool = await this.teamPool(db, rule.salesTeamId, organizationId);
      const pickedId = pickAssignee(pool, rule.strategy, rule.salesTeam.lastAssignedUserId, rule.maxOpenLeadsPerUser);
      const candidates = pool.map((c) => ({ id: c.userId, fullName: c.fullName, openLeads: c.openLeads, eligible: rule.maxOpenLeadsPerUser == null || c.openLeads < rule.maxOpenLeadsPerUser }));
      if (!pickedId) {
        lastReason = pool.length ? `Rule "${rule.name}" matched but every team member is at the open-lead limit.` : `Rule "${rule.name}" matched but its team has no active members.`;
        continue;
      }
      const picked = pool.find((c) => c.userId === pickedId)!;
      return {
        rule: { id: rule.id, name: rule.name, priority: rule.priority },
        team: { id: rule.salesTeam.id, name: rule.salesTeam.name },
        strategy: rule.strategy,
        method: assignmentMethodForRule(rule, rule.strategy),
        assignee: { id: picked.userId, fullName: picked.fullName, openLeads: picked.openLeads },
        candidates,
        reason: `Matched rule "${rule.name}" (priority ${rule.priority}); ${rule.strategy === 'WORKLOAD' ? 'fewest open leads' : 'next in round-robin order'}.`,
      };
    }
    return { rule: null, team: null, strategy: null, method: null, assignee: null, candidates: [], reason: lastReason };
  }

  /**
   * Automatically assigns an unassigned lead inside the caller's transaction. Locks the chosen team
   * row so concurrent enquiries keep a fair round-robin order. Returns outbox ids to kick after commit.
   */
  async autoAssign(tx: Tx, leadId: string): Promise<{ assigneeId: string | null; outbox: string[]; reason: string }> {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: leadForRouting });
    if (lead.assignedToId) return { assigneeId: lead.assignedToId, outbox: [], reason: 'Already assigned' };
    const facts = this.facts(lead);
    const preview = await this.decide(tx, lead.organizationId, facts);
    if (!preview.rule || !preview.team) return { assigneeId: null, outbox: [], reason: preview.reason };
    // Lock the team, then re-decide with the locked cursor to stay correct under concurrency.
    await tx.$queryRaw`SELECT id FROM sales_teams WHERE id = ${preview.team.id}::uuid FOR UPDATE`;
    const decision = await this.decide(tx, lead.organizationId, facts);
    if (!decision.assignee || !decision.team || !decision.rule) return { assigneeId: null, outbox: [], reason: decision.reason };
    await tx.salesTeam.update({ where: { id: decision.team.id }, data: { lastAssignedUserId: decision.assignee.id } });
    const outbox = await this.assignInTx(tx, lead, decision.assignee.id, {
      method: decision.method ?? 'ROUND_ROBIN',
      assignedById: null,
      ruleId: decision.rule.id,
      teamId: decision.team.id,
      reason: decision.reason,
    });
    return { assigneeId: decision.assignee.id, outbox, reason: decision.reason };
  }

  /** Records an assignment (history, lead fields, activity, notification). Returns outbox ids. */
  async assignInTx(tx: Tx, lead: { id: string; leadNo: string; name: string; status: string; organizationId: string; assignedToId: string | null; property?: { title: string } | null; project?: { name: string } | null; unit?: { code: string } | null }, assigneeId: string, opts: AssignOptions): Promise<string[]> {
    const now = new Date();
    await tx.leadAssignment.updateMany({ where: { leadId: lead.id, isCurrent: true }, data: { isCurrent: false, endedAt: now } });
    await tx.leadAssignment.create({
      data: { leadId: lead.id, assignedToId: assigneeId, assignedById: opts.assignedById, ruleId: opts.ruleId ?? null, teamId: opts.teamId ?? null, method: opts.method, reason: opts.reason ?? null, assignedAt: now },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: { assignedToId: assigneeId, assignedTeamId: opts.teamId ?? null, assignedAt: now, ...(lead.status === 'NEW' ? { status: 'ASSIGNED' } : {}) },
    });
    const assignee = await tx.user.findUniqueOrThrow({ where: { id: assigneeId }, select: { id: true, fullName: true, email: true, phone: true } });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'ASSIGNMENT',
        summary: lead.assignedToId ? `Reassigned to ${assignee.fullName}` : `Assigned to ${assignee.fullName}`,
        details: opts.reason ?? null,
        metadata: { method: opts.method, ruleId: opts.ruleId ?? null, teamId: opts.teamId ?? null, previousAssigneeId: lead.assignedToId },
        performedById: opts.assignedById,
      },
    });
    await this.audit.log(
      { actorId: opts.assignedById, action: 'lead.assign', entityType: 'Lead', entityId: lead.id, organizationId: lead.organizationId, before: { assignedToId: lead.assignedToId }, after: { assignedToId: assigneeId, method: opts.method } },
      tx,
    );
    const subject = lead.property?.title ?? (lead.project ? `${lead.project.name}${lead.unit ? ` — ${lead.unit.code}` : ''}` : 'General requirement');
    const data = { leadNo: lead.leadNo, leadName: lead.name, subject };
    const recipient = { userId: assignee.id, email: assignee.email, phone: assignee.phone, name: assignee.fullName };
    const inApp = await this.notifications.notify({ eventKey: 'lead.assigned', recipients: [recipient], channels: ['IN_APP'], data, link: `/crm/leads/${lead.id}`, relatedType: 'Lead', relatedId: lead.id }, tx);
    const email = await this.notifications.notify({ eventKey: 'lead.assigned', recipients: [recipient], channels: ['EMAIL'], data, link: `${env().CONSOLE_PUBLIC_URL}/crm/leads/${lead.id}`, relatedType: 'Lead', relatedId: lead.id }, tx);
    return [...inApp, ...email];
  }
}
