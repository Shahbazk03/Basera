import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  formatDate,
  normalizePhone,
  PREFERRED_TIME_SLOTS,
  whatsappLink,
  type CustomerEnquiryProgress,
  type EnquiryReceipt,
  type MyEnquiry,
} from '@estate/shared';
import type { z } from 'zod';
import type { enquirySchema } from '@estate/shared';
import { EnquiryStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuthContextService } from '../../common/auth/auth-context.service';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { hashIp } from '../../common/crypto';
import { nextReference } from '../../common/references';
import { paginated, Pagination, skipTake } from '../../common/http';
import type { RequestMeta } from '../../common/decorators';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignmentService } from '../crm/assignment.service';
import { LeadsService } from '../crm/leads.service';
import { OPEN_LEAD_WHERE, orgScope } from '../crm/crm-access';
import { publicProjectWhere } from '../projects/project-card';

type EnquiryPayload = z.output<typeof enquirySchema>;

const SLOT_HOURS: Record<string, string> = { MORNING: '10:00', AFTERNOON: '13:00', EVENING: '17:00' };
const MIN_FILL_MS = 3_000;
const MAX_FORM_AGE_MS = 24 * 3_600_000;

function progressOf(enquiryStatus: string, leadStatus: string | null | undefined): CustomerEnquiryProgress {
  if (enquiryStatus === 'SPAM' || enquiryStatus === 'CLOSED') return 'CLOSED';
  switch (leadStatus) {
    case 'SITE_VISIT_SCHEDULED':
      return 'SITE_VISIT_SCHEDULED';
    case 'SITE_VISIT_COMPLETED':
      return 'SITE_VISIT_COMPLETED';
    case 'CONVERTED':
    case 'LOST':
      return 'CLOSED';
    case 'NEW':
    case 'ASSIGNED':
    case undefined:
    case null:
      return 'RECEIVED';
    default:
      return 'IN_PROGRESS';
  }
}

/**
 * Public enquiry pipeline: spam checks → context resolution → (customer, enquiry, lead, activities)
 * in one transaction → automatic assignment → notifications (outbox) → receipt.
 */
@Injectable()
export class EnquiriesService {
  private readonly logger = new Logger('Enquiries');

  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: AuthContextService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly assignment: AssignmentService,
    private readonly leads: LeadsService,
  ) {}

  private async verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
    const secret = env().TURNSTILE_SECRET_KEY;
    if (!secret) return;
    if (!token) throw new BadRequestException({ message: 'Please complete the verification challenge', code: 'CAPTCHA_REQUIRED' });
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(8_000),
      });
      const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (!json.success) throw new BadRequestException({ message: 'Verification failed — please try again', code: 'CAPTCHA_FAILED' });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Turnstile verification unavailable: ${(err as Error).message}`);
      throw new BadRequestException({ message: 'Verification could not be completed — please try again', code: 'CAPTCHA_UNAVAILABLE' });
    }
  }

  private spamChecks(input: EnquiryPayload) {
    if (input.website) throw new BadRequestException({ message: 'Invalid submission', code: 'SPAM_DETECTED' });
    if (!input.formStartedAt) throw new BadRequestException({ message: 'Please reload the page and submit the form again', code: 'SPAM_CHECK_FAILED' });
    const elapsed = Date.now() - input.formStartedAt;
    if (elapsed < MIN_FILL_MS) throw new BadRequestException({ message: 'That was quick — please check your details and submit again', code: 'SUBMITTED_TOO_FAST' });
    if (elapsed > MAX_FORM_AGE_MS || elapsed < -60_000) throw new BadRequestException({ message: 'This form has expired. Reload the page and try again', code: 'FORM_EXPIRED' });
  }

  async submit(input: EnquiryPayload, meta: RequestMeta, user?: AuthUser): Promise<EnquiryReceipt> {
    this.spamChecks(input);
    await this.verifyTurnstile(input.captchaToken, meta.ip);
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException({ message: 'Enter a valid mobile number', details: [{ path: 'phone', message: 'Invalid mobile number' }] });
    const email = input.email ? input.email.toLowerCase() : null;

    // ── Resolve what the enquiry is about ──
    let unit: { id: string; code: string; projectId: string; status: string } | null = null;
    if (input.unitId) {
      unit = await this.prisma.projectUnit.findUnique({ where: { id: input.unitId }, select: { id: true, code: true, projectId: true, status: true } });
      if (!unit || (input.projectId && unit.projectId !== input.projectId)) throw new BadRequestException({ message: 'The selected unit does not belong to this project', details: [{ path: 'unitId', message: 'Invalid unit' }] });
      if (['SOLD', 'BOOKED', 'BLOCKED', 'NOT_RELEASED'].includes(unit.status)) {
        throw new BadRequestException({ message: `Unit ${unit.code} is no longer available. Please choose another unit or send a general enquiry.`, code: 'UNIT_UNAVAILABLE' });
      }
    }
    const property = input.propertyId
      ? await this.prisma.property.findFirst({
          where: { id: input.propertyId, status: 'PUBLISHED', deletedAt: null, organization: { status: 'ACTIVE', deletedAt: null } },
          select: { id: true, title: true, referenceCode: true, organizationId: true, listingType: true, cityId: true, localityId: true, projectId: true, organization: { select: { whatsappNumber: true, showContactPublicly: true } }, project: { select: { whatsappNumber: true } } },
        })
      : null;
    if (input.propertyId && !property) throw new NotFoundException('This listing is no longer accepting enquiries');
    const projectId = property ? null : (input.projectId ?? unit?.projectId ?? null);
    const project = projectId
      ? await this.prisma.project.findFirst({
          where: { id: projectId, ...publicProjectWhere() },
          select: { id: true, name: true, organizationId: true, cityId: true, localityId: true, whatsappNumber: true, organization: { select: { whatsappNumber: true, showContactPublicly: true } } },
        })
      : null;
    if (projectId && !project) throw new NotFoundException('This project is not accepting enquiries');

    const organizationId = property?.organizationId ?? project?.organizationId ?? (await this.authContext.platformOrganizationId());
    if (!organizationId) throw new BadRequestException('Enquiries are not available yet — the platform organisation is not configured');
    const sourceKey = input.type === 'WHATSAPP' ? 'WHATSAPP' : property ? 'PROPERTY_ENQUIRY' : project ? 'PROJECT_ENQUIRY' : 'WEBSITE';
    const source = await this.prisma.leadSource.findUnique({ where: { key: sourceKey } });
    if (!source) throw new Error(`Lead source ${sourceKey} missing — run the reference seed`);
    const subject = property ? property.title : project ? (unit ? `${project.name} — unit ${unit.code}` : project.name) : 'your property requirement';
    const campaign = input.utmCampaign
      ? await this.prisma.campaign.findFirst({ where: { organizationId, code: { equals: input.utmCampaign, mode: 'insensitive' }, status: 'ACTIVE' }, select: { id: true } })
      : null;
    const windowDays = await this.settings.getNumber('leads.duplicateWindowDays');
    const autoAssign = await this.assignment.autoAssignEnabled();
    const preferredDate = input.preferredDate ? new Date(`${input.preferredDate}T00:00:00Z`) : null;

    const outbox: string[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await this.leads.upsertCustomer(tx, organizationId, { name: input.name, phone, email, userId: user?.id ?? null });
      const referenceNo = await nextReference(tx, 'ENQ');
      const enquiry = await tx.enquiry.create({
        data: {
          referenceNo,
          organizationId,
          type: input.type,
          status: 'NEW',
          customerId: customer.id,
          name: input.name,
          phone,
          email,
          message: input.message ?? null,
          propertyId: property?.id ?? null,
          projectId: project?.id ?? property?.projectId ?? null,
          unitId: unit?.id ?? null,
          preferredDate,
          preferredTimeSlot: input.preferredTimeSlot ?? null,
          sourceKey,
          sourcePage: input.sourcePage ?? null,
          sourceHost: meta.host,
          utmSource: input.utmSource ?? null,
          utmMedium: input.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? null,
          referrer: input.referrer ?? null,
          ipHash: hashIp(meta.ip),
          userAgent: meta.userAgent,
          consent: input.consent === true,
        },
      });

      const open = await tx.lead.findFirst({
        where: { ...OPEN_LEAD_WHERE, organizationId, phone, createdAt: { gte: new Date(Date.now() - windowDays * 86_400_000) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, leadNo: true, name: true, status: true, organizationId: true, assignedToId: true, priority: true, propertyId: true, projectId: true, unitId: true, property: { select: { title: true } }, project: { select: { name: true } }, unit: { select: { code: true } } },
      });
      let lead = open;
      let repeat = false;
      if (open) {
        repeat = true;
        const promote = (input.type === 'SITE_VISIT' || input.type === 'UNIT_ENQUIRY') && (open.priority === 'LOW' || open.priority === 'MEDIUM');
        await tx.lead.update({
          where: { id: open.id },
          data: {
            ...(!open.propertyId && property ? { propertyId: property.id } : {}),
            ...(!open.projectId && project ? { projectId: project.id } : {}),
            ...(!open.unitId && unit ? { unitId: unit.id } : {}),
            ...(promote ? { priority: 'HIGH' } : {}),
          },
        });
        await tx.leadActivity.create({
          data: { leadId: open.id, type: 'ENQUIRY', direction: 'INBOUND', summary: `Repeat enquiry ${referenceNo} (${input.type.replace(/_/g, ' ').toLowerCase()})`, details: [`Regarding ${subject}`, input.message].filter(Boolean).join('\n'), metadata: { enquiryId: enquiry.id, sourceKey } },
        });
      } else {
        const created = await tx.lead.create({
          data: {
            leadNo: await nextReference(tx, 'LD'),
            organizationId,
            customerId: customer.id,
            name: input.name,
            phone,
            email,
            sourceId: source.id,
            campaignId: campaign?.id ?? null,
            propertyId: property?.id ?? null,
            projectId: project?.id ?? property?.projectId ?? null,
            unitId: unit?.id ?? null,
            enquiryType: input.type,
            listingType: property?.listingType ?? (project ? 'SALE' : null),
            preferredCityId: property?.cityId ?? project?.cityId ?? null,
            preferredLocalityId: property?.localityId ?? project?.localityId ?? null,
            requirement: input.message ?? null,
            priority: input.type === 'SITE_VISIT' || input.type === 'UNIT_ENQUIRY' ? 'HIGH' : 'MEDIUM',
          },
          select: { id: true, leadNo: true, name: true, status: true, organizationId: true, assignedToId: true, priority: true, propertyId: true, projectId: true, unitId: true, property: { select: { title: true } }, project: { select: { name: true } }, unit: { select: { code: true } } },
        });
        lead = created;
        await tx.leadActivity.create({
          data: { leadId: created.id, type: 'ENQUIRY', direction: 'INBOUND', summary: `Enquiry ${referenceNo} received via ${source.name.toLowerCase()}`, details: [`Regarding ${subject}`, input.message].filter(Boolean).join('\n'), metadata: { enquiryId: enquiry.id, sourceKey } },
        });
      }
      await tx.enquiry.update({ where: { id: enquiry.id }, data: { leadId: lead!.id, status: 'PROCESSED' } });
      if (property) await tx.property.update({ where: { id: property.id }, data: { enquiryCount: { increment: 1 } } });

      if (input.type === 'SITE_VISIT' && preferredDate) {
        const time = SLOT_HOURS[input.preferredTimeSlot ?? ''] ?? '11:00';
        const visit = await tx.siteVisit.create({
          data: {
            leadId: lead!.id,
            customerId: customer.id,
            propertyId: property?.id ?? null,
            projectId: project?.id ?? null,
            unitId: unit?.id ?? null,
            scheduledAt: new Date(`${input.preferredDate}T${time}:00+05:30`),
            status: 'REQUESTED',
            assignedToId: lead!.assignedToId,
            notes: `Requested online${input.preferredTimeSlot ? ` — ${PREFERRED_TIME_SLOTS[input.preferredTimeSlot]}` : ''}`,
          },
        });
        await tx.leadActivity.create({ data: { leadId: lead!.id, type: 'SITE_VISIT', direction: 'INBOUND', summary: `Site visit requested for ${formatDate(input.preferredDate)}`, metadata: { siteVisitId: visit.id } } });
      }

      let assigneeId = lead!.assignedToId;
      if (!assigneeId && autoAssign) {
        const r = await this.assignment.autoAssign(tx, lead!.id);
        outbox.push(...r.outbox);
        assigneeId = r.assigneeId;
        if (assigneeId) await tx.siteVisit.updateMany({ where: { leadId: lead!.id, status: 'REQUESTED', assignedToId: null }, data: { assignedToId: assigneeId } });
      }

      // Staff notification: the assignee, otherwise everyone who handles enquiries for the organisation.
      const staff = assigneeId ? [{ userId: assigneeId }] : await this.notifications.recipientsWithPermission('enquiry.view', organizationId);
      const staffWithEmail = assigneeId ? [(await this.notifications.userRecipient(assigneeId))!].filter(Boolean) : staff;
      const data = { reference: referenceNo, customerName: input.name, subject, enquiryType: input.type.replace(/_/g, ' ').toLowerCase() };
      outbox.push(...(await this.notifications.notify({ eventKey: 'enquiry.received', recipients: staff, channels: ['IN_APP'], data, link: `/crm/leads/${lead!.id}`, relatedType: 'Enquiry', relatedId: enquiry.id }, tx)));
      outbox.push(...(await this.notifications.notify({ eventKey: 'enquiry.received', recipients: staffWithEmail, channels: ['EMAIL'], data, link: `${env().CONSOLE_PUBLIC_URL}/crm/leads/${lead!.id}`, relatedType: 'Enquiry', relatedId: enquiry.id }, tx)));
      // Customer acknowledgement (each channel recorded honestly; unconfigured channels are NOT_CONFIGURED).
      outbox.push(
        ...(await this.notifications.notify(
          { eventKey: 'enquiry.acknowledgement', recipients: [{ email, phone, name: input.name }], channels: ['EMAIL', 'SMS', 'WHATSAPP'], data: { reference: referenceNo, subject }, relatedType: 'Enquiry', relatedId: enquiry.id },
          tx,
        )),
      );
      await this.audit.log(
        { actorId: user?.id ?? null, actorIp: meta.ip, action: 'enquiry.create', entityType: 'Enquiry', entityId: enquiry.id, organizationId, after: { referenceNo, type: input.type, leadId: lead!.id, repeat, sourceKey } },
        tx,
      );
      return { referenceNo, leadId: lead!.id };
    });
    this.notifications.kick(outbox);

    let whatsappUrl: string | null = null;
    if (input.type === 'WHATSAPP') {
      const raw =
        (property?.organization.showContactPublicly ? property.organization.whatsappNumber : null) ??
        (project?.organization.showContactPublicly ? project.organization.whatsappNumber : null) ??
        property?.project?.whatsappNumber ??
        project?.whatsappNumber ??
        ((await this.settings.getString('contact.whatsapp')) || null);
      const number = raw ? normalizePhone(raw) : null;
      whatsappUrl = number ? whatsappLink(number, `Hello, I am interested in ${subject}. My enquiry reference is ${result.referenceNo}.`) : null;
    }
    const first = input.name.split(/\s+/)[0];
    const message =
      input.type === 'SITE_VISIT' && input.preferredDate
        ? `Thank you, ${first}. We have received your site visit request for ${formatDate(input.preferredDate)}${input.preferredTimeSlot ? ` (${PREFERRED_TIME_SLOTS[input.preferredTimeSlot]})` : ''}. Our team will call you to confirm. Your reference number is ${result.referenceNo}.`
        : input.type === 'CALLBACK'
          ? `Thank you, ${first}. We will call you back shortly. Your reference number is ${result.referenceNo}.`
          : input.type === 'WHATSAPP'
            ? whatsappUrl
              ? `Thank you, ${first}. Continue the conversation on WhatsApp. Your reference number is ${result.referenceNo}.`
              : `Thank you, ${first}. WhatsApp chat is not available right now — our team will contact you shortly. Your reference number is ${result.referenceNo}.`
            : `Thank you, ${first}. Our team will contact you shortly. Your reference number is ${result.referenceNo}.`;
    return { referenceNo: result.referenceNo, message, whatsappUrl };
  }

  /** The logged-in customer's own enquiries (reference, subject and progress only). */
  async mine(user: AuthUser): Promise<MyEnquiry[]> {
    const rows = await this.prisma.enquiry.findMany({
      where: { customer: { userId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        referenceNo: true,
        type: true,
        status: true,
        createdAt: true,
        property: { select: { title: true, slug: true } },
        project: { select: { name: true, slug: true } },
        unit: { select: { code: true } },
        lead: { select: { status: true } },
      },
    });
    return rows.map((r) => ({
      referenceNo: r.referenceNo,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
      progress: progressOf(r.status, r.lead?.status),
      subject: r.property
        ? { kind: 'property' as const, title: r.property.title, slug: r.property.slug, unitCode: null }
        : r.project
          ? { kind: 'project' as const, title: r.project.name, slug: r.project.slug, unitCode: r.unit?.code ?? null }
          : { kind: 'general' as const, title: 'General enquiry', slug: null, unitCode: null },
    }));
  }

  // ───────────── Console ─────────────

  async list(user: AuthUser, q: Pagination & { status?: EnquiryStatus; type?: string; q?: string; organizationId?: string }) {
    const term = q.q?.trim();
    const phone = term ? normalizePhone(term) : null;
    const where: Prisma.EnquiryWhereInput = {
      ...orgScope(user, 'enquiry.view'),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.type ? { type: q.type as never } : {}),
      ...(term
        ? { OR: [{ referenceNo: { equals: term.toUpperCase() } }, { name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }, { phone: { contains: phone ?? term.replace(/\s/g, '') } }] }
        : {}),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.enquiry.findMany({
        where: { ...where, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true } },
          property: { select: { id: true, title: true, referenceCode: true } },
          project: { select: { id: true, name: true } },
          unit: { select: { code: true } },
          lead: { select: { id: true, leadNo: true, status: true, assignedTo: { select: { fullName: true } } } },
        },
        ...skipTake(q),
      }),
      this.prisma.enquiry.count({ where: { ...where, ...(q.status ? { status: q.status } : {}) } }),
      this.prisma.enquiry.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    return { ...paginated(rows.map(({ ipHash: _ip, userAgent: _ua, ...r }) => r), total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  async setStatus(user: AuthUser, id: string, status: 'PROCESSED' | 'SPAM' | 'CLOSED', note?: string) {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id }, include: { lead: { select: { id: true, status: true, _count: { select: { enquiries: true } } } } } });
    if (!enquiry || !user.can('enquiry.view', enquiry.organizationId)) throw new NotFoundException('Enquiry not found');
    user.assert('enquiry.manage', enquiry.organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.enquiry.update({ where: { id }, data: { status, ...(status === 'SPAM' ? { spamReason: note ?? 'Marked as spam' } : {}) } });
      const lead = enquiry.lead;
      if (status === 'SPAM' && lead && lead._count.enquiries <= 1 && ['NEW', 'ASSIGNED'].includes(lead.status)) {
        await tx.lead.update({ where: { id: lead.id }, data: { status: 'LOST', lostReason: 'Spam enquiry', nextFollowUpAt: null } });
        await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', summary: 'Closed — enquiry marked as spam', details: note ?? null, metadata: { from: lead.status, to: 'LOST' }, performedById: user.id } });
      } else if (lead) {
        await tx.leadActivity.create({ data: { leadId: lead.id, type: 'SYSTEM', summary: `Enquiry ${enquiry.referenceNo} marked ${status.toLowerCase()}`, details: note ?? null, performedById: user.id } });
      }
      await this.audit.log({ actorId: user.id, action: 'enquiry.status', entityType: 'Enquiry', entityId: id, organizationId: enquiry.organizationId, before: { status: enquiry.status }, after: { status }, metadata: note ? { note } : undefined }, tx);
    });
    return { ok: true };
  }
}
