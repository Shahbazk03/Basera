import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatDate, normalizePhone } from '@estate/shared';
import type { z } from 'zod';
import type { leadProviderAdminUpdateSchema, leadProviderSubmitSchema } from '@estate/shared';
import { LeadIntakeStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuditService } from '../../common/audit.service';
import { nextReference } from '../../common/references';
import { paginated, Pagination, skipTake } from '../../common/http';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignmentService } from '../crm/assignment.service';
import { LeadsService } from '../crm/leads.service';
import { OPEN_LEAD_WHERE } from '../crm/crm-access';
import { publicProjectWhere } from '../projects/project-card';

type SubmitInput = z.output<typeof leadProviderSubmitSchema>;
const MAX_PROVIDER_IMPORT_ROWS = 500;

/** Customer-safe pipeline label shown to the partner (no assignee or internal detail). */
function partnerProgress(intake: LeadIntakeStatus, status: string): string {
  if (intake === 'DUPLICATE') return 'Not counted — already in our system';
  if (intake === 'REJECTED') return 'Rejected';
  if (intake === 'PENDING_REVIEW') return 'Under review';
  switch (status) {
    case 'NEW':
    case 'ASSIGNED':
      return 'Received';
    case 'CONVERTED':
      return 'Converted';
    case 'LOST':
      return 'Closed — not converted';
    case 'SITE_VISIT_SCHEDULED':
    case 'SITE_VISIT_COMPLETED':
      return 'Site visit stage';
    case 'NEGOTIATION':
    case 'BOOKING_PENDING':
      return 'Negotiation';
    default:
      return 'In progress';
  }
}

@Injectable()
export class LeadProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: AuthContextService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly assignment: AssignmentService,
    private readonly leads: LeadsService,
  ) {}

  // ───────────────────────── Portal ─────────────────────────

  private async providerFor(user: AuthUser) {
    const orgIds = user.memberships.filter((m) => m.organizationType === 'LEAD_PROVIDER' && user.can('lead_provider.portal', m.organizationId)).map((m) => m.organizationId);
    if (!orgIds.length) throw new ForbiddenException('Your account is not linked to a lead partner organisation');
    const provider = await this.prisma.leadProvider.findFirst({ where: { organizationId: { in: orgIds } }, include: { organization: { select: { id: true, name: true, status: true } } } });
    if (!provider) throw new ForbiddenException('Your lead partner profile is not set up — contact our partner team');
    return provider;
  }

  private assertActive(provider: { status: string; organization: { status: string } }) {
    if (provider.organization.status === 'PENDING') throw new ForbiddenException({ message: 'Your partner account is awaiting activation by our team', code: 'PROVIDER_NOT_ACTIVE' });
    if (provider.organization.status !== 'ACTIVE' || provider.status !== 'ACTIVE') throw new ForbiddenException({ message: 'Your partner account is suspended. Contact our partner team.', code: 'PROVIDER_SUSPENDED' });
  }

  async portalProfile(user: AuthUser) {
    const p = await this.providerFor(user);
    return { id: p.id, name: p.name, status: p.status, organizationStatus: p.organization.status, duplicateWindowDays: p.duplicateWindowDays, canSubmit: p.status === 'ACTIVE' && p.organization.status === 'ACTIVE' };
  }

  async submit(user: AuthUser, input: SubmitInput, opts: { importRow?: number } = {}) {
    const provider = await this.providerFor(user);
    this.assertActive(provider);
    const platformOrgId = await this.authContext.platformOrganizationId();
    if (!platformOrgId) throw new BadRequestException('Lead intake is not available — platform organisation missing');
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException({ message: 'Enter a valid mobile number', details: [{ path: 'phone', message: 'Invalid' }] });
    if (input.projectId && !(await this.prisma.project.findFirst({ where: { id: input.projectId, ...publicProjectWhere() }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Choose a live project', details: [{ path: 'projectId', message: 'Unknown or unpublished project' }] });
    }
    if (input.propertyId && !(await this.prisma.property.findFirst({ where: { id: input.propertyId, status: 'PUBLISHED', deletedAt: null }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Choose a live listing', details: [{ path: 'propertyId', message: 'Unknown or unpublished listing' }] });
    }
    if (input.budgetMin != null && input.budgetMax != null && input.budgetMax < input.budgetMin) {
      throw new BadRequestException({ message: 'Maximum budget must be at least the minimum', details: [{ path: 'budgetMax', message: 'Invalid range' }] });
    }
    const source = await this.prisma.leadSource.findUniqueOrThrow({ where: { key: 'LEAD_PROVIDER' } });
    const extTag = input.externalRef ? `ext:${input.externalRef}`.slice(0, 80) : null;
    const since = new Date(Date.now() - provider.duplicateWindowDays * 86_400_000);
    const existing = await this.prisma.lead.findFirst({ where: { ...OPEN_LEAD_WHERE, organizationId: platformOrgId, phone, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { id: true, leadNo: true, createdAt: true } });
    const sameRef = extTag ? await this.prisma.lead.findFirst({ where: { leadProviderId: provider.id, tags: { has: extTag }, deletedAt: null }, select: { id: true, leadNo: true, createdAt: true } }) : null;
    const original = existing ?? sameRef;
    const intake: LeadIntakeStatus = original ? 'DUPLICATE' : input.projectId || input.propertyId || input.requirement || input.locationPreference ? 'ACCEPTED' : 'PENDING_REVIEW';
    const autoAssign = intake === 'ACCEPTED' && (await this.assignment.autoAssignEnabled());

    const outbox: string[] = [];
    const lead = await this.prisma.$transaction(async (tx) => {
      const customer = await this.leads.upsertCustomer(tx, platformOrgId, { name: input.name, phone, email: input.email || null });
      const intakeNote =
        intake === 'DUPLICATE'
          ? sameRef && !existing
            ? `Same external reference already submitted on ${formatDate(sameRef.createdAt)}`
            : `Customer already in our pipeline since ${formatDate(original!.createdAt)}`
          : intake === 'PENDING_REVIEW'
            ? 'Awaiting qualification — no project, listing or requirement was provided'
            : null;
      const created = await tx.lead.create({
        data: {
          leadNo: await nextReference(tx, 'LD'),
          organizationId: platformOrgId,
          customerId: customer.id,
          name: input.name,
          phone,
          email: input.email || null,
          sourceId: source.id,
          leadProviderId: provider.id,
          projectId: input.projectId ?? null,
          propertyId: input.propertyId ?? null,
          listingType: input.listingType ?? (input.projectId ? 'SALE' : null),
          budgetMin: input.budgetMin ?? null,
          budgetMax: input.budgetMax ?? null,
          locationPreference: input.locationPreference ?? null,
          requirement: input.requirement ?? null,
          intakeStatus: intake,
          intakeNote,
          isDuplicate: intake === 'DUPLICATE',
          duplicateOfId: intake === 'DUPLICATE' ? original!.id : null,
          status: intake === 'DUPLICATE' ? 'LOST' : 'NEW',
          lostReason: intake === 'DUPLICATE' ? 'Duplicate submission' : null,
          tags: extTag ? [extTag] : [],
          createdById: user.id,
        },
        select: { id: true, leadNo: true, intakeStatus: true, intakeNote: true },
      });
      await tx.leadActivity.create({
        data: {
          leadId: created.id,
          type: 'SYSTEM',
          summary: intake === 'DUPLICATE' ? `Submitted by lead partner ${provider.name} — recorded as duplicate` : `Submitted by lead partner ${provider.name}${opts.importRow ? ` (CSV row ${opts.importRow})` : ''}`,
          details: intakeNote,
          performedById: user.id,
        },
      });
      if (intake === 'DUPLICATE') {
        await tx.leadActivity.create({ data: { leadId: original!.id, type: 'SYSTEM', summary: `Duplicate submission received from lead partner ${provider.name}`, details: `Recorded as ${created.leadNo}`, metadata: { duplicateLeadId: created.id } } });
      }
      if (autoAssign) outbox.push(...(await this.assignment.autoAssign(tx, created.id)).outbox);
      await this.audit.log({ actorId: user.id, action: 'lead_provider.submit', entityType: 'Lead', entityId: created.id, organizationId: platformOrgId, after: { leadNo: created.leadNo, intakeStatus: intake, providerId: provider.id } }, tx);
      return created;
    });
    this.notifications.kick(outbox);
    return {
      leadNo: lead.leadNo,
      intakeStatus: lead.intakeStatus,
      message:
        intake === 'ACCEPTED'
          ? `Lead ${lead.leadNo} accepted.`
          : intake === 'PENDING_REVIEW'
            ? `Lead ${lead.leadNo} received and is awaiting review by our team.`
            : `Lead ${lead.leadNo} recorded as a duplicate — this customer is already in our pipeline.`,
    };
  }

  async importCsv(user: AuthUser, csv: string, commit: boolean) {
    const provider = await this.providerFor(user);
    this.assertActive(provider);
    const { rows, headerError } = this.leads.parseCsv(csv);
    if (headerError) throw new BadRequestException({ message: headerError, code: 'CSV_COLUMNS' });
    if (rows.length > MAX_PROVIDER_IMPORT_ROWS) throw new BadRequestException({ message: `Upload at most ${MAX_PROVIDER_IMPORT_ROWS} rows per file`, code: 'CSV_TOO_LARGE' });
    const platformOrgId = await this.authContext.platformOrganizationId();
    const slugs = [...new Set(rows.map((r) => r.project_slug).filter(Boolean))];
    const projects = slugs.length ? await this.prisma.project.findMany({ where: { slug: { in: slugs }, ...publicProjectWhere() }, select: { id: true, slug: true } }) : [];
    const projectBySlug = new Map(projects.map((p) => [p.slug, p.id]));
    const since = new Date(Date.now() - provider.duplicateWindowDays * 86_400_000);
    const seen = new Map<string, number>();
    const results: { row: number; name: string; phone: string; outcome: string; message: string; leadNo?: string }[] = [];
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
        results.push({ row: rowNo, name, phone: phone!, outcome: 'INVALID', message: `Same phone as row ${seen.get(phone!)} in this file` });
        continue;
      }
      seen.set(phone!, rowNo);
      if (!commit) {
        const dup = await this.prisma.lead.findFirst({ where: { ...OPEN_LEAD_WHERE, organizationId: platformOrgId!, phone: phone!, createdAt: { gte: since } }, select: { id: true } });
        const hasContext = Boolean(r.project_slug || r.requirement || r.location);
        results.push({ row: rowNo, name, phone: phone!, outcome: dup ? 'DUPLICATE' : hasContext ? 'READY' : 'PENDING_REVIEW', message: dup ? 'Customer already in our pipeline — will be recorded as a duplicate' : hasContext ? 'Will be submitted' : 'Will be submitted for review (no project or requirement)' });
        continue;
      }
      try {
        const res = await this.submit(
          user,
          {
            name,
            phone: phone!,
            email: email || '',
            projectId: r.project_slug ? projectBySlug.get(r.project_slug)! : null,
            propertyId: null,
            listingType: null,
            budgetMin,
            budgetMax,
            locationPreference: r.location || null,
            requirement: r.requirement || null,
            externalRef: r.external_ref || null,
          },
          { importRow: rowNo },
        );
        results.push({ row: rowNo, name, phone: phone!, outcome: res.intakeStatus, message: res.message, leadNo: res.leadNo });
      } catch (err) {
        results.push({ row: rowNo, name, phone: phone!, outcome: 'INVALID', message: (err as Error).message });
      }
    }
    const summary: Record<string, number> = { total: results.length };
    for (const r of results) summary[r.outcome] = (summary[r.outcome] ?? 0) + 1;
    return { committed: commit, summary, results };
  }

  async myLeads(user: AuthUser, q: Pagination & { intake?: LeadIntakeStatus; q?: string }) {
    const provider = await this.providerFor(user);
    const term = q.q?.trim();
    const where: Prisma.LeadWhereInput = {
      leadProviderId: provider.id,
      deletedAt: null,
      ...(q.intake ? { intakeStatus: q.intake } : {}),
      ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { leadNo: { equals: term.toUpperCase() } }, { phone: { contains: normalizePhone(term) ?? term.replace(/\s/g, '') } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: { id: true, leadNo: true, name: true, phone: true, createdAt: true, intakeStatus: true, intakeNote: true, status: true, convertedAt: true, project: { select: { name: true } }, property: { select: { title: true } } },
        ...skipTake(q),
      }),
      this.prisma.lead.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({
        id: r.id,
        leadNo: r.leadNo,
        name: r.name,
        phone: r.phone,
        createdAt: r.createdAt,
        intakeStatus: r.intakeStatus,
        intakeNote: r.intakeNote,
        progress: partnerProgress(r.intakeStatus, r.status),
        converted: r.status === 'CONVERTED' && r.intakeStatus === 'ACCEPTED',
        interest: r.project?.name ?? r.property?.title ?? null,
      })),
      total,
      q,
    );
  }

  private async statsFor(providerIds: string[]) {
    const [byIntake, converted] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['leadProviderId', 'intakeStatus'], where: { leadProviderId: { in: providerIds }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['leadProviderId'], where: { leadProviderId: { in: providerIds }, deletedAt: null, status: 'CONVERTED', intakeStatus: 'ACCEPTED' }, _count: { _all: true } }),
    ]);
    const out = new Map<string, { submitted: number; accepted: number; duplicate: number; rejected: number; pending: number; converted: number }>();
    for (const id of providerIds) out.set(id, { submitted: 0, accepted: 0, duplicate: 0, rejected: 0, pending: 0, converted: 0 });
    for (const r of byIntake) {
      const s = out.get(r.leadProviderId!)!;
      s.submitted += r._count._all;
      if (r.intakeStatus === 'ACCEPTED') s.accepted += r._count._all;
      if (r.intakeStatus === 'DUPLICATE') s.duplicate += r._count._all;
      if (r.intakeStatus === 'REJECTED') s.rejected += r._count._all;
      if (r.intakeStatus === 'PENDING_REVIEW') s.pending += r._count._all;
    }
    for (const r of converted) out.get(r.leadProviderId!)!.converted = r._count._all;
    return out;
  }

  async myStats(user: AuthUser) {
    const provider = await this.providerFor(user);
    const stats = (await this.statsFor([provider.id])).get(provider.id)!;
    return { provider: { name: provider.name, status: provider.status, organizationStatus: provider.organization.status, duplicateWindowDays: provider.duplicateWindowDays }, ...stats };
  }

  // ───────────────────────── Administration ─────────────────────────

  async list(q: { q?: string; status?: 'ACTIVE' | 'SUSPENDED' }) {
    const rows = await this.prisma.leadProvider.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { organization: { select: { id: true, name: true, status: true, verificationStatus: true, createdAt: true } } },
    });
    const stats = await this.statsFor(rows.map((r) => r.id));
    return rows.map(({ apiKeyHash: _h, ...r }) => ({ ...r, stats: stats.get(r.id)! }));
  }

  async detail(id: string) {
    const p = await this.prisma.leadProvider.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, status: true, verificationStatus: true, createdAt: true, email: true, phone: true, members: { where: { status: 'ACTIVE' }, select: { title: true, isOwner: true, user: { select: { id: true, fullName: true, email: true, phone: true, lastLoginAt: true } } } } } },
      },
    });
    if (!p) throw new NotFoundException('Lead provider not found');
    const [stats, recent] = await Promise.all([
      this.statsFor([id]),
      this.prisma.lead.findMany({
        where: { leadProviderId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, leadNo: true, name: true, phone: true, createdAt: true, intakeStatus: true, intakeNote: true, status: true, assignedTo: { select: { fullName: true } }, project: { select: { name: true } }, duplicateOf: { select: { id: true, leadNo: true } } },
      }),
    ]);
    const { apiKeyHash: _h, ...rest } = p;
    return { ...rest, stats: stats.get(id)!, recentLeads: recent };
  }

  async update(user: AuthUser, id: string, input: z.output<typeof leadProviderAdminUpdateSchema>) {
    const p = await this.prisma.leadProvider.findUnique({ where: { id }, include: { organization: true } });
    if (!p) throw new NotFoundException('Lead provider not found');
    const now = new Date();
    const outbox: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.leadProvider.update({
        where: { id },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.duplicateWindowDays !== undefined ? { duplicateWindowDays: input.duplicateWindowDays } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.email !== undefined ? { email: input.email || null } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      if (input.status && (input.status === 'ACTIVE') !== (p.organization.status === 'ACTIVE')) {
        await tx.organization.update({
          where: { id: p.organizationId },
          data:
            input.status === 'ACTIVE'
              ? { status: 'ACTIVE', verificationStatus: 'VERIFIED', verifiedAt: now, verifiedById: user.id, rejectionReason: null }
              : { status: 'SUSPENDED' },
        });
        const owners = await tx.organizationMember.findMany({ where: { organizationId: p.organizationId, isOwner: true, status: 'ACTIVE' }, select: { user: { select: { id: true, email: true, phone: true, fullName: true } } } });
        const recipients = owners.map((o) => ({ userId: o.user.id, email: o.user.email, phone: o.user.phone, name: o.user.fullName }));
        const data = { organizationName: p.organization.name, decision: input.status === 'ACTIVE' ? 'activated' : 'suspended', reason: '' };
        outbox.push(...(await this.notifications.notify({ eventKey: 'partner.decided', recipients, channels: ['IN_APP'], data, link: '/provider/submit', relatedType: 'Organization', relatedId: p.organizationId }, tx)));
        outbox.push(...(await this.notifications.notify({ eventKey: 'partner.decided', recipients, channels: ['EMAIL'], data, link: `${env().CONSOLE_PUBLIC_URL}/login`, relatedType: 'Organization', relatedId: p.organizationId }, tx)));
      }
      await this.audit.log({ actorId: user.id, action: 'lead_provider.update', entityType: 'LeadProvider', entityId: id, organizationId: p.organizationId, before: { status: p.status, orgStatus: p.organization.status, duplicateWindowDays: p.duplicateWindowDays }, after: input }, tx);
    });
    this.notifications.kick(outbox);
    return this.detail(id);
  }

  async reviewQueue(q: Pagination) {
    const where: Prisma.LeadWhereInput = { intakeStatus: 'PENDING_REVIEW', deletedAt: null, leadProviderId: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        select: { id: true, leadNo: true, name: true, phone: true, email: true, createdAt: true, intakeNote: true, budgetMin: true, budgetMax: true, locationPreference: true, requirement: true, leadProvider: { select: { id: true, name: true } }, project: { select: { name: true } } },
        ...skipTake(q),
      }),
      this.prisma.lead.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async review(user: AuthUser, leadId: string, decision: 'ACCEPT' | 'REJECT', reason?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, leadNo: true, intakeStatus: true, organizationId: true, leadProviderId: true } });
    if (!lead || !lead.leadProviderId) throw new NotFoundException('Lead not found');
    if (lead.intakeStatus !== 'PENDING_REVIEW') throw new ConflictException({ message: 'This lead has already been reviewed', code: 'ALREADY_REVIEWED' });
    const outbox: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.lead.updateMany({
        where: { id: leadId, intakeStatus: 'PENDING_REVIEW' },
        data:
          decision === 'ACCEPT'
            ? { intakeStatus: 'ACCEPTED', intakeNote: reason ? `Accepted after review: ${reason}` : 'Accepted after review' }
            : { intakeStatus: 'REJECTED', intakeNote: reason ?? 'Rejected', status: 'LOST', lostReason: `Rejected at intake: ${reason ?? ''}`.trim() },
      });
      if (res.count !== 1) throw new ConflictException({ message: 'This lead was reviewed by someone else', code: 'CONCURRENT_UPDATE' });
      await tx.leadActivity.create({ data: { leadId, type: 'SYSTEM', summary: decision === 'ACCEPT' ? 'Accepted at intake review' : 'Rejected at intake review', details: reason ?? null, performedById: user.id } });
      if (decision === 'ACCEPT' && (await this.assignment.autoAssignEnabled(tx))) outbox.push(...(await this.assignment.autoAssign(tx, leadId)).outbox);
      await this.audit.log({ actorId: user.id, action: 'lead_provider.review', entityType: 'Lead', entityId: leadId, organizationId: lead.organizationId, after: { decision, reason } }, tx);
    });
    this.notifications.kick(outbox);
    return { ok: true, leadNo: lead.leadNo, decision };
  }
}
