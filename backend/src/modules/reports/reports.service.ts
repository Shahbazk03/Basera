import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  enumLabel,
  fromPaise,
  OPEN_LEAD_STATUSES,
  SALES_PROJECT_STATUSES,
  type DashboardBreakdown,
  type DashboardList,
  type DashboardMetric,
  type DashboardResponse,
  type DashboardSection,
  type PermissionKey,
  type WorkspaceKey,
  toPaise,
} from '@estate/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';

const IST_OFFSET_MS = 330 * 60_000;
const DAY = 86_400_000;

/** IST calendar boundaries expressed as UTC instants. */
export function istBoundaries(now: Date = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const dayStart = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
  const monthStart = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dayStart,
    dayEnd: new Date(dayStart.getTime() + DAY),
    monthStart,
    /** date-only value (for @db.Date columns) of today in IST */
    todayDate: new Date(`${y}-${pad(m + 1)}-${pad(d)}T00:00:00.000Z`),
    monthStartDate: new Date(`${y}-${pad(m + 1)}-01T00:00:00.000Z`),
  };
}

type Scope = 'ALL' | string[];

const OPEN_STATUSES = OPEN_LEAD_STATUSES as unknown as Prisma.EnumLeadStatusFilter['in'];

function orgIn(scope: Scope, field = 'organizationId'): Record<string, unknown> {
  return scope === 'ALL' ? {} : { [field]: { in: scope } };
}

/** Every number is computed from records the caller may see — nothing is estimated or invented. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser, ...perms: PermissionKey[]): Scope | null {
    let ids = new Set<string>();
    for (const p of perms) {
      const s = user.orgsWith(p);
      if (s === 'ALL') return 'ALL';
      s.forEach((id) => ids.add(id));
    }
    return ids.size ? [...ids] : null;
  }

  async dashboard(user: AuthUser, workspace: WorkspaceKey, organizationId?: string): Promise<DashboardResponse> {
    if (!user.workspaces.includes(workspace)) throw new ForbiddenException('This workspace is not available to you');
    const base = { workspace, generatedAt: new Date().toISOString() };
    if (workspace === 'admin') return { ...base, organizationId: null, ...(await this.adminDashboard(user)) };
    if (workspace === 'staff') return { ...base, organizationId: user.platformOrganizationId, ...(await this.staffDashboard(user)) };
    const typeByWs: Record<string, string> = { broker: 'BROKERAGE', developer: 'DEVELOPER', owner: 'INDIVIDUAL_OWNER', 'lead-provider': 'LEAD_PROVIDER' };
    const membership = user.memberships.find((m) => (organizationId ? m.organizationId === organizationId : m.organizationType === typeByWs[workspace]));
    if (!membership || membership.organizationType !== typeByWs[workspace]) throw new BadRequestException('Choose an organisation you belong to for this workspace');
    if (workspace === 'lead-provider') return { ...base, organizationId: membership.organizationId, ...(await this.providerDashboard(user, membership.organizationId)) };
    return { ...base, organizationId: membership.organizationId, ...(await this.partnerDashboard(user, membership.organizationId, workspace)) };
  }

  // ───────────────────────── Admin (platform back office) ─────────────────────────

  private async adminDashboard(user: AuthUser) {
    const { dayStart, dayEnd, monthStart, todayDate, monthStartDate } = istBoundaries();
    const now = new Date();
    const sections: DashboardSection[] = [];
    const breakdowns: DashboardBreakdown[] = [];
    const lists: DashboardList[] = [];

    // Marketplace
    const propScope = this.scope(user, 'property.view_all', 'property.approve');
    if (propScope) {
      const approveScope = this.scope(user, 'property.approve');
      const reportScope = this.scope(user, 'property.report.manage');
      const where = { deletedAt: null, ...orgIn(propScope) };
      const [live, pending, drafts, openReports] = await Promise.all([
        this.prisma.property.count({ where: { ...where, status: 'PUBLISHED' } }),
        approveScope ? this.prisma.property.count({ where: { deletedAt: null, ...orgIn(approveScope), status: 'PENDING_REVIEW' } }) : Promise.resolve(null),
        this.prisma.property.count({ where: { ...where, status: 'DRAFT' } }),
        reportScope ? this.prisma.propertyReport.count({ where: { status: 'OPEN', ...(reportScope === 'ALL' ? {} : { property: { organizationId: { in: reportScope } } }) } }) : Promise.resolve(null),
      ]);
      const metrics: DashboardMetric[] = [{ key: 'liveListings', label: 'Live listings', value: live, href: '/listings?status=PUBLISHED' }];
      if (pending !== null) metrics.push({ key: 'pendingApprovals', label: 'Listings awaiting approval', value: pending, href: '/listings/reviews', tone: pending > 0 ? 'warning' : 'default' });
      metrics.push({ key: 'draftListings', label: 'Draft listings', value: drafts, href: '/listings?status=DRAFT' });
      if (openReports !== null) metrics.push({ key: 'openReports', label: 'Open listing reports', value: openReports, href: '/listings/reports', tone: openReports > 0 ? 'danger' : 'default' });
      sections.push({ key: 'marketplace', title: 'Marketplace', metrics });
      if (approveScope) {
        const rows = await this.prisma.property.findMany({
          where: { deletedAt: null, ...orgIn(approveScope), status: 'PENDING_REVIEW' },
          orderBy: { submittedAt: 'asc' },
          take: 5,
          select: { id: true, title: true, referenceCode: true, submittedAt: true, organization: { select: { name: true } } },
        });
        lists.push({
          key: 'pendingListings',
          title: 'Oldest listings awaiting approval',
          href: '/listings/reviews',
          emptyText: 'No listings are waiting for review.',
          items: rows.map((r) => ({ id: r.id, title: r.title, subtitle: `${r.referenceCode} · ${r.organization.name}`, meta: r.submittedAt?.toISOString() ?? null, href: `/listings/${r.id}` })),
        });
      }
    }

    // Projects & inventory
    const projScope = this.scope(user, 'project.view_all');
    if (projScope) {
      const projWhere: Prisma.ProjectWhereInput = { deletedAt: null, status: { not: 'ARCHIVED' }, ...(projScope === 'ALL' ? {} : { OR: [{ organizationId: { in: projScope } }, { developerOrgId: { in: projScope } }] }) };
      const reviewScope = this.scope(user, 'project.approve');
      const [total, active, inReview, units] = await Promise.all([
        this.prisma.project.count({ where: projWhere }),
        this.prisma.project.count({ where: { ...projWhere, isPublished: true, reviewStatus: 'APPROVED', status: { in: SALES_PROJECT_STATUSES } } }),
        reviewScope ? this.prisma.project.count({ where: { deletedAt: null, reviewStatus: 'PENDING_REVIEW', ...(reviewScope === 'ALL' ? {} : { organizationId: { in: reviewScope } }) } }) : Promise.resolve(null),
        this.prisma.projectUnit.groupBy({ by: ['status'], where: { project: projWhere }, _count: { _all: true } }),
      ]);
      const u = Object.fromEntries(units.map((x) => [x.status, x._count._all])) as Record<string, number>;
      const metrics: DashboardMetric[] = [
        { key: 'projects', label: 'Projects', value: total, href: '/projects' },
        { key: 'activeProjects', label: 'Projects live for sale', value: active, href: '/projects' },
      ];
      if (inReview !== null) metrics.push({ key: 'projectReviews', label: 'Projects awaiting approval', value: inReview, href: '/projects/reviews', tone: inReview > 0 ? 'warning' : 'default' });
      sections.push({ key: 'projects', title: 'Projects', metrics });
      sections.push({
        key: 'inventory',
        title: 'Project inventory',
        metrics: [
          { key: 'unitsAvailable', label: 'Units available', value: u.AVAILABLE ?? 0, tone: 'success' },
          { key: 'unitsHeld', label: 'Reserved / on hold', value: (u.RESERVED ?? 0) + (u.ON_HOLD ?? 0), tone: 'warning' },
          { key: 'unitsBooked', label: 'Units booked', value: u.BOOKED ?? 0 },
          { key: 'unitsSold', label: 'Units sold', value: u.SOLD ?? 0 },
        ],
      });
    }

    // CRM
    const enquiryScope = this.scope(user, 'enquiry.view');
    const leadScope = this.scope(user, 'lead.view_all');
    if (enquiryScope || leadScope) {
      const metrics: DashboardMetric[] = [];
      if (enquiryScope) {
        const [today, week] = await Promise.all([
          this.prisma.enquiry.count({ where: { ...orgIn(enquiryScope), status: { not: 'SPAM' }, createdAt: { gte: dayStart, lt: dayEnd } } }),
          this.prisma.enquiry.count({ where: { ...orgIn(enquiryScope), status: { not: 'SPAM' }, createdAt: { gte: new Date(dayStart.getTime() - 6 * DAY) } } }),
        ]);
        metrics.push({ key: 'enquiriesToday', label: 'New enquiries today', value: today, href: '/crm/enquiries' }, { key: 'enquiries7d', label: 'Enquiries (last 7 days)', value: week, href: '/crm/enquiries' });
      }
      if (leadScope) {
        const leadWhere: Prisma.LeadWhereInput = { deletedAt: null, isDuplicate: false, ...orgIn(leadScope) };
        const [unassigned, dueToday, overdue, visits, pipeline] = await Promise.all([
          this.prisma.lead.count({ where: { ...leadWhere, assignedToId: null, status: { in: OPEN_STATUSES }, intakeStatus: 'ACCEPTED' } }),
          this.prisma.leadFollowUp.count({ where: { status: 'PENDING', dueAt: { gte: dayStart, lt: dayEnd }, lead: leadWhere } }),
          this.prisma.leadFollowUp.count({ where: { status: 'PENDING', dueAt: { lt: dayStart }, lead: leadWhere } }),
          this.prisma.siteVisit.count({ where: { status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) }, lead: leadWhere } }),
          this.prisma.lead.groupBy({ by: ['status'], where: { ...leadWhere, status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
        ]);
        metrics.push(
          { key: 'unassignedLeads', label: 'Unassigned leads', value: unassigned, href: '/crm/leads?unassigned=true', tone: unassigned > 0 ? 'warning' : 'default' },
          { key: 'followUpsToday', label: 'Follow-ups due today', value: dueToday, href: '/crm/follow-ups' },
          { key: 'followUpsOverdue', label: 'Overdue follow-ups', value: overdue, href: '/crm/follow-ups', tone: overdue > 0 ? 'danger' : 'default' },
          { key: 'siteVisits7d', label: 'Site visits (next 7 days)', value: visits, href: '/crm/site-visits' },
        );
        breakdowns.push({
          key: 'pipeline',
          title: 'Open pipeline by stage',
          href: '/crm/leads',
          items: OPEN_LEAD_STATUSES.map((s) => ({ key: s, label: enumLabel(s), value: pipeline.find((p) => p.status === s)?._count._all ?? 0 })),
        });
        const upcoming = await this.prisma.siteVisit.findMany({
          where: { status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gte: now }, lead: leadWhere },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
          select: { id: true, leadId: true, scheduledAt: true, status: true, customer: { select: { fullName: true } }, project: { select: { name: true } }, property: { select: { title: true } }, assignedTo: { select: { fullName: true } } },
        });
        lists.push({
          key: 'upcomingVisits',
          title: 'Upcoming site visits',
          href: '/crm/site-visits',
          emptyText: 'No site visits scheduled.',
          items: upcoming.map((v) => ({ id: v.id, title: `${v.customer.fullName} — ${v.project?.name ?? v.property?.title ?? 'Site visit'}`, subtitle: v.assignedTo ? `With ${v.assignedTo.fullName}` : 'Not assigned', meta: v.scheduledAt.toISOString(), status: v.status, href: `/crm/leads/${v.leadId}` })),
        });
      }
      if (enquiryScope) {
        const recent = await this.prisma.enquiry.findMany({
          where: { ...orgIn(enquiryScope), status: { not: 'SPAM' } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, referenceNo: true, name: true, type: true, createdAt: true, leadId: true, status: true, property: { select: { title: true } }, project: { select: { name: true } } },
        });
        lists.push({
          key: 'recentEnquiries',
          title: 'Latest enquiries',
          href: '/crm/enquiries',
          emptyText: 'No enquiries yet.',
          items: recent.map((e) => ({ id: e.id, title: `${e.name} — ${e.property?.title ?? e.project?.name ?? 'General enquiry'}`, subtitle: `${e.referenceNo} · ${enumLabel(e.type)}`, meta: e.createdAt.toISOString(), status: e.status, href: e.leadId ? `/crm/leads/${e.leadId}` : '/crm/enquiries' })),
        });
      }
      const dealScope = this.scope(user, 'deal.view');
      if (dealScope) {
        const booked = await this.prisma.deal.aggregate({ where: { ...orgIn(dealScope), status: { in: ['BOOKED', 'AGREEMENT_SIGNED', 'CLOSED_WON'] }, OR: [{ bookingDate: { gte: monthStartDate } }, { bookingDate: null, createdAt: { gte: monthStart } }] }, _count: { _all: true }, _sum: { dealValue: true } });
        metrics.push({ key: 'dealsThisMonth', label: 'Bookings this month', value: booked._count._all, href: '/crm/deals' }, { key: 'dealValueThisMonth', label: 'Booked value this month', value: Number(booked._sum.dealValue ?? 0), format: 'currency', href: '/crm/deals' });
      }
      sections.push({ key: 'crm', title: 'Sales & CRM', metrics });
    }

    // Partners
    const brokerVisible = user.hasGlobal('broker.view') || user.hasGlobal('broker.verify');
    const devVisible = user.hasGlobal('developer.view') || user.hasGlobal('developer.verify');
    if (brokerVisible || devVisible) {
      const groups = await this.prisma.organization.groupBy({ by: ['type', 'status'], where: { deletedAt: null, type: { in: ['BROKERAGE', 'DEVELOPER', 'INDIVIDUAL_OWNER'] } }, _count: { _all: true } });
      const c = (type: string, status: string) => groups.find((g) => g.type === type && g.status === status)?._count._all ?? 0;
      const metrics: DashboardMetric[] = [];
      if (brokerVisible) metrics.push({ key: 'brokers', label: 'Verified brokerages', value: c('BROKERAGE', 'ACTIVE'), href: '/partners?type=BROKERAGE' }, { key: 'brokersPending', label: 'Brokerages awaiting verification', value: c('BROKERAGE', 'PENDING') + c('INDIVIDUAL_OWNER', 'PENDING'), href: '/partners?status=PENDING', tone: c('BROKERAGE', 'PENDING') + c('INDIVIDUAL_OWNER', 'PENDING') > 0 ? 'warning' : 'default' });
      if (devVisible) metrics.push({ key: 'developers', label: 'Verified developers', value: c('DEVELOPER', 'ACTIVE'), href: '/partners?type=DEVELOPER' }, { key: 'developersPending', label: 'Developers awaiting verification', value: c('DEVELOPER', 'PENDING'), href: '/partners?type=DEVELOPER&status=PENDING', tone: c('DEVELOPER', 'PENDING') > 0 ? 'warning' : 'default' });
      sections.push({ key: 'partners', title: 'Partners', metrics });
      const types = [...(brokerVisible ? (['BROKERAGE', 'INDIVIDUAL_OWNER', 'PARTNER'] as const) : []), ...(devVisible ? (['DEVELOPER'] as const) : [])];
      const pending = await this.prisma.organization.findMany({ where: { deletedAt: null, status: 'PENDING', type: { in: [...types] } }, orderBy: { createdAt: 'asc' }, take: 5, select: { id: true, name: true, type: true, createdAt: true } });
      lists.push({ key: 'pendingPartners', title: 'Partners awaiting verification', href: '/partners?status=PENDING', emptyText: 'No partner is waiting for verification.', items: pending.map((p) => ({ id: p.id, title: p.name, subtitle: enumLabel(p.type), meta: p.createdAt.toISOString(), href: `/partners/${p.id}` })) });
    }

    // People
    const platformOrg = user.platformOrganizationId;
    if (platformOrg && user.can('employee.view', platformOrg)) {
      const [active, present, onLeave] = await Promise.all([
        this.prisma.employee.count({ where: { organizationId: platformOrg, deletedAt: null, employmentStatus: { in: ['ACTIVE', 'PROBATION', 'ON_NOTICE'] } } }),
        this.prisma.attendanceRecord.count({ where: { date: todayDate, status: { in: ['PRESENT', 'HALF_DAY'] }, employee: { organizationId: platformOrg } } }),
        this.prisma.leaveRequest.count({ where: { status: 'APPROVED', startDate: { lte: todayDate }, endDate: { gte: todayDate }, employee: { organizationId: platformOrg } } }),
      ]);
      sections.push({
        key: 'people',
        title: 'People',
        metrics: [
          { key: 'employees', label: 'Employees', value: active, href: '/hr/employees' },
          { key: 'presentToday', label: 'Checked in today', value: present, href: '/hr/attendance' },
          { key: 'onLeaveToday', label: 'On leave today', value: onLeave, href: '/hr/leave' },
        ],
      });
    }

    // Finance
    if (platformOrg && (user.can('finance.view', platformOrg) || user.can('commission.view', platformOrg))) {
      const metrics: DashboardMetric[] = [];
      if (user.can('finance.view', platformOrg)) {
        const [receipts, outstanding, pendingExpenses] = await Promise.all([
          this.prisma.financeTransaction.aggregate({ where: { organizationId: platformOrg, type: 'INVOICE_RECEIPT', txnDate: { gte: monthStartDate } }, _sum: { amount: true } }),
          this.prisma.invoice.aggregate({ where: { organizationId: platformOrg, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { total: true, amountPaid: true } }),
          this.prisma.expense.count({ where: { organizationId: platformOrg, status: 'PENDING' } }),
        ]);
        metrics.push(
          { key: 'revenueMonth', label: 'Revenue received this month', value: Number(receipts._sum.amount ?? 0), format: 'currency', href: '/finance/reports', hint: 'Invoice receipts' },
          { key: 'invoicesOutstanding', label: 'Invoices outstanding', value: Number(outstanding._sum.total ?? 0) - Number(outstanding._sum.amountPaid ?? 0), format: 'currency', href: '/finance/invoices' },
          { key: 'expensesPending', label: 'Expenses awaiting approval', value: pendingExpenses, href: '/finance/expenses?status=PENDING', tone: pendingExpenses > 0 ? 'warning' : 'default' },
        );
      }
      if (user.can('commission.view', platformOrg)) {
        const [payable, toApprove] = await Promise.all([
          this.prisma.commissionRecord.aggregate({ where: { organizationId: platformOrg, status: { in: ['APPROVED', 'PAYABLE'] } }, _sum: { amount: true, amountPaid: true } }),
          this.prisma.commissionRecord.count({ where: { organizationId: platformOrg, status: 'PENDING_APPROVAL' } }),
        ]);
        metrics.push(
          { key: 'commissionsPayable', label: 'Commissions approved, unpaid', value: Number(payable._sum.amount ?? 0) - Number(payable._sum.amountPaid ?? 0), format: 'currency', href: '/commissions' },
          { key: 'commissionsToApprove', label: 'Commissions awaiting approval', value: toApprove, href: '/commissions?status=PENDING_APPROVAL', tone: toApprove > 0 ? 'warning' : 'default' },
        );
      }
      sections.push({ key: 'finance', title: 'Finance', metrics });
    }
    return { sections, breakdowns, lists };
  }

  // ───────────────────────── Staff (self) ─────────────────────────

  private async staffDashboard(user: AuthUser) {
    const { dayStart, dayEnd, todayDate } = istBoundaries();
    const now = new Date();
    const sections: DashboardSection[] = [];
    const breakdowns: DashboardBreakdown[] = [];
    const lists: DashboardList[] = [];
    const mine: Prisma.LeadWhereInput = { assignedToId: user.id, deletedAt: null };

    const [openLeads, byStatus, dueToday, overdue, visits, tasksOpen, tasksDue, attendance] = await Promise.all([
      this.prisma.lead.count({ where: { ...mine, status: { in: OPEN_STATUSES } } }),
      this.prisma.lead.groupBy({ by: ['status'], where: { ...mine, status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
      this.prisma.leadFollowUp.count({ where: { assignedToId: user.id, status: 'PENDING', dueAt: { gte: dayStart, lt: dayEnd } } }),
      this.prisma.leadFollowUp.count({ where: { assignedToId: user.id, status: 'PENDING', dueAt: { lt: dayStart } } }),
      this.prisma.siteVisit.count({ where: { assignedToId: user.id, status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } } }),
      this.prisma.employeeTask.count({ where: { assignedToId: user.id, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
      this.prisma.employeeTask.count({ where: { assignedToId: user.id, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: dayEnd } } }),
      user.employeeId ? this.prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: user.employeeId, date: todayDate } }, select: { checkInAt: true, checkOutAt: true, status: true } }) : Promise.resolve(null),
    ]);
    sections.push({
      key: 'work',
      title: 'My work today',
      metrics: [
        { key: 'myOpenLeads', label: 'My open leads', value: openLeads, href: '/crm/leads' },
        { key: 'myFollowUpsToday', label: 'Follow-ups due today', value: dueToday, href: '/crm/follow-ups' },
        { key: 'myFollowUpsOverdue', label: 'Overdue follow-ups', value: overdue, href: '/crm/follow-ups', tone: overdue > 0 ? 'danger' : 'default' },
        { key: 'myVisits', label: 'My site visits (7 days)', value: visits, href: '/crm/site-visits' },
        { key: 'myTasks', label: 'Open tasks', value: tasksOpen, href: '/me/tasks', hint: tasksDue ? `${tasksDue} due today or overdue` : undefined, tone: tasksDue > 0 ? 'warning' : 'default' },
      ],
    });
    if (byStatus.length) breakdowns.push({ key: 'myPipeline', title: 'My leads by stage', href: '/crm/leads', items: OPEN_LEAD_STATUSES.map((s) => ({ key: s, label: enumLabel(s), value: byStatus.find((b) => b.status === s)?._count._all ?? 0 })) });

    // Managers decide their direct reports' expense claims (the finance menu may be hidden from them).
    if (user.employeeId) {
      const [reports, teamClaims] = await Promise.all([
        this.prisma.employee.count({ where: { managerId: user.employeeId, deletedAt: null } }),
        this.prisma.reimbursement.count({ where: { status: 'SUBMITTED', employee: { managerId: user.employeeId } } }),
      ]);
      if (reports > 0) {
        sections.push({
          key: 'team',
          title: 'My team',
          metrics: [
            { key: 'directReports', label: 'Direct reports', value: reports },
            { key: 'teamClaims', label: 'Expense claims to decide', value: teamClaims, href: '/finance/reimbursements?status=SUBMITTED', tone: teamClaims > 0 ? 'warning' : 'default' },
          ],
        });
      }
    }

    if (user.can('commission.self') || user.employeeId) {
      const sums = await this.prisma.commissionRecord.groupBy({ by: ['status'], where: { recipientUserId: user.id }, _sum: { amount: true } });
      const s = (st: string) => Number(sums.find((x) => x.status === st)?._sum.amount ?? 0);
      if (sums.length) {
        sections.push({
          key: 'incentives',
          title: 'My incentives',
          metrics: [
            { key: 'incentivePending', label: 'Awaiting approval', value: s('PENDING_APPROVAL'), format: 'currency', href: '/me/commissions' },
            { key: 'incentiveApproved', label: 'Approved / payable', value: s('APPROVED') + s('PAYABLE'), format: 'currency', href: '/me/commissions' },
            { key: 'incentivePaid', label: 'Paid', value: s('PAID'), format: 'currency', href: '/me/commissions' },
          ],
        });
      }
    }

    const [followUps, upcomingVisits, tasks] = await Promise.all([
      this.prisma.leadFollowUp.findMany({ where: { assignedToId: user.id, status: 'PENDING' }, orderBy: { dueAt: 'asc' }, take: 6, select: { id: true, leadId: true, type: true, dueAt: true, lead: { select: { name: true, leadNo: true } } } }),
      this.prisma.siteVisit.findMany({ where: { assignedToId: user.id, status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gte: now } }, orderBy: { scheduledAt: 'asc' }, take: 5, select: { id: true, leadId: true, scheduledAt: true, status: true, customer: { select: { fullName: true } }, project: { select: { name: true } }, property: { select: { title: true } } } }),
      this.prisma.employeeTask.findMany({ where: { assignedToId: user.id, status: { in: ['TODO', 'IN_PROGRESS'] } }, orderBy: [{ dueAt: 'asc' }], take: 5, select: { id: true, title: true, dueAt: true, priority: true, status: true } }),
    ]);
    lists.push({
      key: 'attendance',
      title: 'Attendance today',
      href: '/me/attendance',
      emptyText: user.employeeId ? 'You have not checked in yet today.' : 'Attendance applies to employees only.',
      items: attendance?.checkInAt
        ? [{ id: 'att', title: attendance.checkOutAt ? 'Checked in and out' : 'Checked in', subtitle: attendance.checkOutAt ? `Out at ${attendance.checkOutAt.toISOString()}` : null, meta: attendance.checkInAt.toISOString(), status: attendance.status, href: '/me/attendance' }]
        : [],
    });
    lists.push({ key: 'myFollowUps', title: 'Next follow-ups', href: '/crm/follow-ups', emptyText: 'No pending follow-ups.', items: followUps.map((f) => ({ id: f.id, title: f.lead.name, subtitle: `${enumLabel(f.type)} · ${f.lead.leadNo}`, meta: f.dueAt.toISOString(), status: f.dueAt < dayStart ? 'MISSED' : 'PENDING', href: `/crm/leads/${f.leadId}` })) });
    lists.push({ key: 'myVisits', title: 'Upcoming site visits', href: '/crm/site-visits', emptyText: 'No site visits scheduled.', items: upcomingVisits.map((v) => ({ id: v.id, title: v.customer.fullName, subtitle: v.project?.name ?? v.property?.title ?? null, meta: v.scheduledAt.toISOString(), status: v.status, href: `/crm/leads/${v.leadId}` })) });
    lists.push({ key: 'myTasks', title: 'My tasks', href: '/me/tasks', emptyText: 'No open tasks.', items: tasks.map((t) => ({ id: t.id, title: t.title, subtitle: enumLabel(t.priority), meta: t.dueAt?.toISOString() ?? null, status: t.status, href: '/me/tasks' })) });
    return { sections, breakdowns, lists };
  }

  // ───────────────────────── Partner organisations ─────────────────────────

  private async partnerDashboard(user: AuthUser, orgId: string, workspace: WorkspaceKey) {
    const { dayStart, dayEnd } = istBoundaries();
    const now = new Date();
    const sections: DashboardSection[] = [];
    const breakdowns: DashboardBreakdown[] = [];
    const lists: DashboardList[] = [];

    if (user.can('property.view_all', orgId)) {
      const [counts, views] = await Promise.all([
        this.prisma.property.groupBy({ by: ['status'], where: { organizationId: orgId, deletedAt: null }, _count: { _all: true } }),
        this.prisma.property.aggregate({ where: { organizationId: orgId, deletedAt: null, status: 'PUBLISHED' }, _sum: { viewCount: true, enquiryCount: true } }),
      ]);
      const c = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
      sections.push({
        key: 'listings',
        title: 'Listings',
        metrics: [
          { key: 'live', label: 'Live listings', value: c('PUBLISHED'), href: '/listings?status=PUBLISHED' },
          { key: 'review', label: 'In review', value: c('PENDING_REVIEW'), href: '/listings?status=PENDING_REVIEW' },
          { key: 'attention', label: 'Rejected or expired', value: c('REJECTED') + c('EXPIRED'), href: '/listings?status=REJECTED', tone: c('REJECTED') + c('EXPIRED') > 0 ? 'warning' : 'default' },
          { key: 'views', label: 'Views on live listings', value: views._sum.viewCount ?? 0, hint: 'All-time page views' },
        ],
      });
      const attention = await this.prisma.property.findMany({ where: { organizationId: orgId, deletedAt: null, status: { in: ['REJECTED', 'EXPIRED', 'DRAFT'] } }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, title: true, status: true, referenceCode: true, updatedAt: true, rejectionReason: true } });
      lists.push({ key: 'attentionListings', title: 'Listings needing attention', href: '/listings', emptyText: 'Nothing needs attention.', items: attention.map((p) => ({ id: p.id, title: p.title, subtitle: p.rejectionReason ?? p.referenceCode, meta: p.updatedAt.toISOString(), status: p.status, href: `/listings/${p.id}` })) });
    }

    if (workspace === 'developer' && user.can('project.view_all', orgId)) {
      const projWhere: Prisma.ProjectWhereInput = { deletedAt: null, status: { not: 'ARCHIVED' }, OR: [{ organizationId: orgId }, { developerOrgId: orgId }] };
      const [total, live, units] = await Promise.all([
        this.prisma.project.count({ where: projWhere }),
        this.prisma.project.count({ where: { ...projWhere, isPublished: true, reviewStatus: 'APPROVED' } }),
        this.prisma.projectUnit.groupBy({ by: ['status'], where: { project: projWhere }, _count: { _all: true } }),
      ]);
      const u = (s: string) => units.find((x) => x.status === s)?._count._all ?? 0;
      sections.push({
        key: 'projects',
        title: 'Projects & inventory',
        metrics: [
          { key: 'projects', label: 'Projects', value: total, href: '/projects' },
          { key: 'liveProjects', label: 'Published projects', value: live, href: '/projects' },
          { key: 'available', label: 'Units available', value: u('AVAILABLE'), tone: 'success' },
          { key: 'booked', label: 'Units booked / sold', value: u('BOOKED') + u('SOLD') },
        ],
      });
    }

    const metrics: DashboardMetric[] = [];
    if (user.can('enquiry.view', orgId)) {
      const [week, newCount] = await Promise.all([
        this.prisma.enquiry.count({ where: { organizationId: orgId, status: { not: 'SPAM' }, createdAt: { gte: new Date(dayStart.getTime() - 6 * DAY) } } }),
        this.prisma.enquiry.count({ where: { organizationId: orgId, status: 'NEW' } }),
      ]);
      metrics.push({ key: 'enquiries7d', label: 'Enquiries (last 7 days)', value: week, href: '/crm/enquiries' }, { key: 'enquiriesNew', label: 'Unprocessed enquiries', value: newCount, href: '/crm/enquiries', tone: newCount > 0 ? 'warning' : 'default' });
      const recent = await this.prisma.enquiry.findMany({ where: { organizationId: orgId, status: { not: 'SPAM' } }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, referenceNo: true, name: true, type: true, createdAt: true, leadId: true, status: true, property: { select: { title: true } }, project: { select: { name: true } } } });
      lists.push({ key: 'recentEnquiries', title: 'Latest enquiries', href: '/crm/enquiries', emptyText: 'No enquiries yet.', items: recent.map((e) => ({ id: e.id, title: `${e.name} — ${e.property?.title ?? e.project?.name ?? 'General enquiry'}`, subtitle: `${e.referenceNo} · ${enumLabel(e.type)}`, meta: e.createdAt.toISOString(), status: e.status, href: e.leadId ? `/crm/leads/${e.leadId}` : '/crm/enquiries' })) });
    }
    const leadAll = user.can('lead.view_all', orgId);
    if (leadAll || user.can('lead.view_assigned', orgId)) {
      const leadWhere: Prisma.LeadWhereInput = { organizationId: orgId, deletedAt: null, isDuplicate: false, ...(leadAll ? {} : { assignedToId: user.id }) };
      const [open, unassigned, converted, dueToday, visits] = await Promise.all([
        this.prisma.lead.count({ where: { ...leadWhere, status: { in: OPEN_STATUSES } } }),
        leadAll ? this.prisma.lead.count({ where: { ...leadWhere, assignedToId: null, status: { in: OPEN_STATUSES } } }) : Promise.resolve(null),
        this.prisma.lead.count({ where: { ...leadWhere, status: 'CONVERTED' } }),
        this.prisma.leadFollowUp.count({ where: { status: 'PENDING', dueAt: { gte: dayStart, lt: dayEnd }, lead: leadWhere } }),
        this.prisma.siteVisit.count({ where: { status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] }, scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) }, lead: leadWhere } }),
      ]);
      metrics.push({ key: 'openLeads', label: leadAll ? 'Open leads' : 'My open leads', value: open, href: '/crm/leads' });
      if (unassigned !== null) metrics.push({ key: 'unassigned', label: 'Unassigned leads', value: unassigned, href: '/crm/leads', tone: unassigned > 0 ? 'warning' : 'default' });
      metrics.push({ key: 'converted', label: 'Converted leads', value: converted, href: '/crm/leads?status=CONVERTED' }, { key: 'followUpsToday', label: 'Follow-ups due today', value: dueToday, href: '/crm/follow-ups' }, { key: 'visits', label: 'Site visits (7 days)', value: visits, href: '/crm/site-visits' });
    }
    if (metrics.length) sections.push({ key: 'crm', title: 'Enquiries & leads', metrics });

    if (workspace === 'broker' && user.can('commission.self', orgId)) {
      const sums = await this.prisma.commissionRecord.groupBy({ by: ['status'], where: { recipientOrganizationId: orgId }, _sum: { amount: true } });
      if (sums.length) {
        const s = (st: string) => Number(sums.find((x) => x.status === st)?._sum.amount ?? 0);
        sections.push({ key: 'commission', title: 'Commission', metrics: [{ key: 'commissionPending', label: 'Pending / approved', value: s('PENDING_APPROVAL') + s('APPROVED') + s('PAYABLE'), format: 'currency', href: '/statement' }, { key: 'commissionPaid', label: 'Paid', value: s('PAID'), format: 'currency', href: '/statement' }] });
      }
    }

    const sub = await this.prisma.organizationSubscription.findFirst({ where: { organizationId: orgId, status: 'ACTIVE', endsAt: { gte: now } }, orderBy: { endsAt: 'desc' }, select: { id: true, endsAt: true, plan: { select: { name: true, listingQuota: true } } } });
    if (sub) lists.push({ key: 'subscription', title: 'Subscription', href: '/organization', emptyText: '', items: [{ id: sub.id, title: sub.plan.name, subtitle: sub.plan.listingQuota !== null ? `Up to ${sub.plan.listingQuota} live listings` : 'Unlimited live listings', meta: sub.endsAt.toISOString(), status: 'ACTIVE', href: '/organization' }] });
    void breakdowns;
    return { sections, breakdowns, lists };
  }

  // ───────────────────────── Lead providers ─────────────────────────

  private async providerDashboard(user: AuthUser, orgId: string) {
    user.assert('lead_provider.portal', orgId);
    const provider = await this.prisma.leadProvider.findUnique({ where: { organizationId: orgId }, select: { id: true } });
    const sections: DashboardSection[] = [];
    const lists: DashboardList[] = [];
    if (!provider) return { sections, breakdowns: [], lists };
    const [intake, converted, sums, recent] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['intakeStatus'], where: { leadProviderId: provider.id, deletedAt: null }, _count: { _all: true } }),
      this.prisma.lead.count({ where: { leadProviderId: provider.id, status: 'CONVERTED', deletedAt: null } }),
      this.prisma.commissionRecord.groupBy({ by: ['status'], where: { leadProviderId: provider.id }, _sum: { amount: true } }),
      this.prisma.lead.findMany({ where: { leadProviderId: provider.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, leadNo: true, name: true, intakeStatus: true, status: true, createdAt: true, project: { select: { name: true } } } }),
    ]);
    const i = (s: string) => intake.find((x) => x.intakeStatus === s)?._count._all ?? 0;
    const total = intake.reduce((a, b) => a + b._count._all, 0);
    const c = (st: string) => Number(sums.find((x) => x.status === st)?._sum.amount ?? 0);
    sections.push({
      key: 'submissions',
      title: 'Your submissions',
      metrics: [
        { key: 'submitted', label: 'Leads submitted', value: total, href: '/provider/leads' },
        { key: 'accepted', label: 'Accepted', value: i('ACCEPTED'), tone: 'success', href: '/provider/leads' },
        { key: 'duplicates', label: 'Duplicates', value: i('DUPLICATE'), href: '/provider/leads' },
        { key: 'rejected', label: 'Rejected', value: i('REJECTED'), href: '/provider/leads' },
        { key: 'pending', label: 'Awaiting review', value: i('PENDING_REVIEW'), href: '/provider/leads' },
        { key: 'converted', label: 'Converted to bookings', value: converted, href: '/provider/leads' },
      ],
    });
    sections.push({
      key: 'commission',
      title: 'Commission',
      metrics: [
        { key: 'commissionPending', label: 'Pending / approved', value: c('PENDING_APPROVAL') + c('APPROVED') + c('PAYABLE'), format: 'currency', href: '/provider/statement' },
        { key: 'commissionPaid', label: 'Paid', value: c('PAID'), format: 'currency', href: '/provider/statement' },
      ],
    });
    lists.push({ key: 'recentLeads', title: 'Latest submissions', href: '/provider/leads', emptyText: 'You have not submitted any leads yet.', items: recent.map((l) => ({ id: l.id, title: l.name, subtitle: `${l.leadNo}${l.project ? ` · ${l.project.name}` : ''}`, meta: l.createdAt.toISOString(), status: l.intakeStatus === 'ACCEPTED' ? l.status : l.intakeStatus, href: '/provider/leads' })) });
    return { sections, breakdowns: [], lists };
  }

  // ───────────────────────── Reports page ─────────────────────────

  private reportScope(user: AuthUser): Scope {
    const s = this.scope(user, 'report.view');
    if (!s) throw new ForbiddenException('You cannot view reports');
    return s;
  }

  private range(from?: string, to?: string) {
    const end = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY - IST_OFFSET_MS) : new Date();
    const start = from ? new Date(new Date(`${from}T00:00:00Z`).getTime() - IST_OFFSET_MS) : new Date(end.getTime() - 90 * DAY);
    if (start >= end) throw new BadRequestException('The start date must be before the end date');
    return { start, end };
  }

  async leadSources(user: AuthUser, from?: string, to?: string) {
    const scope = this.reportScope(user);
    const { start, end } = this.range(from, to);
    const rows = await this.prisma.lead.groupBy({
      by: ['sourceId', 'status'],
      where: { deletedAt: null, isDuplicate: false, createdAt: { gte: start, lt: end }, ...orgIn(scope) },
      _count: { _all: true },
    });
    const sources = await this.prisma.leadSource.findMany({ select: { id: true, key: true, name: true } });
    const engaged = new Set(['CONTACTED', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKING_PENDING', 'CONVERTED', 'FOLLOW_UP']);
    const visited = new Set(['SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKING_PENDING', 'CONVERTED']);
    const out = sources
      .map((s) => {
        const r = rows.filter((x) => x.sourceId === s.id);
        const count = (pred: (st: string) => boolean) => r.filter((x) => pred(x.status)).reduce((a, b) => a + b._count._all, 0);
        const total = count(() => true);
        const converted = count((st) => st === 'CONVERTED');
        return { source: s.name, key: s.key, total, engaged: count((st) => engaged.has(st)), siteVisited: count((st) => visited.has(st)), converted, lost: count((st) => st === 'LOST'), conversionRate: total ? Math.round((converted / total) * 1000) / 10 : 0 };
      })
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);
    return { from: start.toISOString(), to: end.toISOString(), rows: out };
  }

  async listingPerformance(user: AuthUser, from?: string, to?: string) {
    const scope = this.reportScope(user);
    const { start, end } = this.range(from, to);
    const enquiries = await this.prisma.enquiry.groupBy({
      by: ['propertyId'],
      where: { propertyId: { not: null }, status: { not: 'SPAM' }, createdAt: { gte: start, lt: end }, ...orgIn(scope) },
      _count: { _all: true },
      orderBy: { _count: { propertyId: 'desc' } },
      take: 10,
    });
    const props = await this.prisma.property.findMany({
      where: { id: { in: enquiries.map((e) => e.propertyId!).filter(Boolean) } },
      select: { id: true, title: true, referenceCode: true, status: true, viewCount: true, price: true, listingType: true, locality: { select: { name: true } }, organization: { select: { name: true } } },
    });
    const byId = new Map(props.map((p) => [p.id, p]));
    const liveWhere: Prisma.PropertyWhereInput = { status: 'PUBLISHED', deletedAt: null, ...orgIn(scope) };
    const [byLocality, byType] = await Promise.all([
      this.prisma.property.groupBy({ by: ['localityId'], where: liveWhere, _count: { _all: true }, orderBy: { _count: { localityId: 'desc' } }, take: 12 }),
      this.prisma.property.groupBy({ by: ['propertyTypeId'], where: liveWhere, _count: { _all: true } }),
    ]);
    const [locs, types] = await Promise.all([
      this.prisma.locality.findMany({ where: { id: { in: byLocality.map((l) => l.localityId) } }, select: { id: true, name: true } }),
      this.prisma.propertyType.findMany({ where: { id: { in: byType.map((t) => t.propertyTypeId) } }, select: { id: true, name: true } }),
    ]);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      topListings: enquiries.filter((e) => e.propertyId && byId.has(e.propertyId)).map((e) => ({ ...byId.get(e.propertyId!)!, price: Number(byId.get(e.propertyId!)!.price), enquiries: e._count._all })),
      liveByLocality: byLocality.map((l) => ({ locality: locs.find((x) => x.id === l.localityId)?.name ?? '—', count: l._count._all })),
      liveByType: byType.map((t) => ({ type: types.find((x) => x.id === t.propertyTypeId)?.name ?? '—', count: t._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  async salesByProject(user: AuthUser) {
    const scope = this.reportScope(user);
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null, status: { not: 'DRAFT' }, ...(scope === 'ALL' ? {} : { OR: [{ organizationId: { in: scope } }, { developerOrgId: { in: scope } }] }) },
      select: { id: true, name: true, status: true, locality: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const ids = projects.map((p) => p.id);
    if (!ids.length) return { rows: [] };
    const [units, deals, payments, enquiries] = await Promise.all([
      this.prisma.projectUnit.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: ids } }, _count: { _all: true } }),
      this.prisma.deal.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { in: ['BOOKED', 'AGREEMENT_SIGNED', 'CLOSED_WON'] } }, _count: { _all: true }, _sum: { dealValue: true } }),
      this.prisma.dealPayment.findMany({ where: { deal: { projectId: { in: ids }, status: { not: 'CANCELLED' } } }, select: { amount: true, deal: { select: { projectId: true } } } }),
      this.prisma.enquiry.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { not: 'SPAM' } }, _count: { _all: true } }),
    ]);
    // Customer money per project, summed in paise (amounts are stored as rupees).
    const receivedPaise = new Map<string, number>();
    for (const pay of payments) {
      const pid = pay.deal.projectId;
      if (pid) receivedPaise.set(pid, (receivedPaise.get(pid) ?? 0) + toPaise(pay.amount));
    }
    return {
      rows: projects.map((p) => {
        const u = (s: string) => units.find((x) => x.projectId === p.id && x.status === s)?._count._all ?? 0;
        const totalUnits = units.filter((x) => x.projectId === p.id).reduce((a, b) => a + b._count._all, 0);
        const d = deals.find((x) => x.projectId === p.id);
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          locality: p.locality.name,
          units: totalUnits,
          available: u('AVAILABLE'),
          held: u('RESERVED') + u('ON_HOLD'),
          booked: u('BOOKED'),
          sold: u('SOLD'),
          bookings: d?._count._all ?? 0,
          bookingValue: Number(d?._sum.dealValue ?? 0),
          customerMoneyReceived: fromPaise(receivedPaise.get(p.id) ?? 0),
          enquiries: enquiries.find((x) => x.projectId === p.id)?._count._all ?? 0,
        };
      }),
    };
  }

  async teamPerformance(user: AuthUser, from?: string, to?: string) {
    const scope = this.reportScope(user);
    const { start, end } = this.range(from, to);
    const leadWhere: Prisma.LeadWhereInput = { deletedAt: null, isDuplicate: false, ...orgIn(scope) };
    const [assigned, contacted, visits, won, missed] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['assignedToId'], where: { ...leadWhere, assignedToId: { not: null }, assignedAt: { gte: start, lt: end } }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['assignedToId'], where: { ...leadWhere, assignedToId: { not: null }, lastContactedAt: { gte: start, lt: end } }, _count: { _all: true } }),
      this.prisma.siteVisit.groupBy({ by: ['assignedToId'], where: { status: 'COMPLETED', completedAt: { gte: start, lt: end }, assignedToId: { not: null }, lead: leadWhere }, _count: { _all: true } }),
      this.prisma.deal.groupBy({ by: ['salesUserId'], where: { salesUserId: { not: null }, status: { in: ['BOOKED', 'AGREEMENT_SIGNED', 'CLOSED_WON'] }, createdAt: { gte: start, lt: end }, ...orgIn(scope) }, _count: { _all: true }, _sum: { dealValue: true } }),
      this.prisma.leadFollowUp.groupBy({ by: ['assignedToId'], where: { status: 'MISSED', dueAt: { gte: start, lt: end }, lead: leadWhere }, _count: { _all: true } }),
    ]);
    const ids = new Set<string>();
    [assigned, contacted, missed].forEach((g) => g.forEach((x) => x.assignedToId && ids.add(x.assignedToId)));
    visits.forEach((x) => x.assignedToId && ids.add(x.assignedToId));
    won.forEach((x) => x.salesUserId && ids.add(x.salesUserId));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true } });
    const pick = <T extends { _count: { _all: number } }>(arr: T[], key: (x: T) => string | null, id: string) => arr.find((x) => key(x) === id)?._count._all ?? 0;
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      rows: users
        .map((u) => {
          const w = won.find((x) => x.salesUserId === u.id);
          return {
            userId: u.id,
            name: u.fullName,
            leadsAssigned: pick(assigned, (x) => x.assignedToId, u.id),
            leadsContacted: pick(contacted, (x) => x.assignedToId, u.id),
            siteVisitsCompleted: pick(visits, (x) => x.assignedToId, u.id),
            bookings: w?._count._all ?? 0,
            bookingValue: Number(w?._sum.dealValue ?? 0),
            followUpsMissed: pick(missed, (x) => x.assignedToId, u.id),
          };
        })
        .sort((a, b) => b.bookingValue - a.bookingValue || b.leadsAssigned - a.leadsAssigned),
    };
  }
}
