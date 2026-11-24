import { z } from 'zod';
import {
  ACTIVITY_DIRECTIONS,
  AssignmentStrategy,
  DEAL_STATUSES,
  DEAL_TYPES,
  ENQUIRY_TYPES,
  FOLLOW_UP_TYPES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LeadStatus,
  LISTING_TYPES,
  MANUAL_ACTIVITY_TYPES,
  PAYMENT_METHODS,
  PAYMENT_RECEIVERS,
  SITE_VISIT_STATUSES,
} from './enums';

// ───────────────────────── Phone numbers ─────────────────────────

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX). Accepts "+91 98765 43210",
 * "09876543210", "9876543210". Returns null when the input is not a valid Indian mobile number.
 * International numbers already in E.164 form are accepted as-is.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  let national = digits;
  if (national.startsWith('+91')) national = national.slice(3);
  else if (national.startsWith('0091')) national = national.slice(4);
  else if (national.startsWith('91') && national.length === 12) national = national.slice(2);
  else if (national.startsWith('0') && national.length === 11) national = national.slice(1);
  if (/^[6-9]\d{9}$/.test(national)) return `+91${national}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits) && !digits.startsWith('+91')) return digits;
  return null;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.length > 6 ? `${phone.slice(0, phone.length - 7)}*****${phone.slice(-2)}` : '******';
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(8, 'Enter a valid mobile number')
  .max(20)
  .refine((v) => normalizePhone(v) !== null, 'Enter a valid 10-digit mobile number');

// ───────────────────────── Public enquiry ─────────────────────────

export const enquirySchema = z
  .object({
    type: z.enum(ENQUIRY_TYPES).default('GENERAL'),
    name: z.string().trim().min(2, 'Enter your name').max(100),
    phone: phoneSchema,
    email: z.email('Enter a valid email').max(160).optional().or(z.literal('')),
    message: z.string().trim().max(2000).optional(),
    propertyId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    unitId: z.uuid().optional(),
    preferredDate: z.iso.date().optional().or(z.literal('')),
    preferredTimeSlot: z.enum(['MORNING', 'AFTERNOON', 'EVENING']).optional(),
    consent: z.literal(true, { error: 'Please accept to be contacted about this enquiry' }),
    // Attribution (captured automatically by the client)
    sourcePage: z.string().max(500).optional(),
    utmSource: z.string().max(100).optional(),
    utmMedium: z.string().max(100).optional(),
    utmCampaign: z.string().max(100).optional(),
    referrer: z.string().max(500).optional(),
    // Spam protection
    website: z.string().max(0, 'Invalid submission').optional(), // honeypot – must stay empty
    formStartedAt: z.coerce.number().int().optional(),
    captchaToken: z.string().max(4096).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'UNIT_ENQUIRY' && !v.unitId) ctx.addIssue({ code: 'custom', path: ['unitId'], message: 'Select a unit' });
    if (v.type === 'SITE_VISIT' && !v.preferredDate)
      ctx.addIssue({ code: 'custom', path: ['preferredDate'], message: 'Choose a preferred visit date' });
  });
export type EnquiryInput = z.input<typeof enquirySchema>;

export const PREFERRED_TIME_SLOTS = {
  MORNING: '9 AM – 12 PM',
  AFTERNOON: '12 PM – 4 PM',
  EVENING: '4 PM – 7 PM',
} as const;

// ───────────────────────── Leads ─────────────────────────

/** Statuses after which a lead is considered closed. */
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ['CONVERTED', 'LOST'];
export const OPEN_LEAD_STATUSES: LeadStatus[] = LEAD_STATUSES.filter((s) => !CLOSED_LEAD_STATUSES.includes(s));

/**
 * Allowed manual status changes. ASSIGNED is set by the assignment engine; CONVERTED is set when a
 * deal is recorded; SITE_VISIT_* are also set by site-visit workflows.
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'NOT_REACHABLE', 'INTERESTED', 'FOLLOW_UP', 'LOST'],
  ASSIGNED: ['CONTACTED', 'NOT_REACHABLE', 'INTERESTED', 'FOLLOW_UP', 'LOST'],
  CONTACTED: ['INTERESTED', 'NOT_REACHABLE', 'FOLLOW_UP', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'LOST'],
  NOT_REACHABLE: ['CONTACTED', 'FOLLOW_UP', 'LOST'],
  INTERESTED: ['SITE_VISIT_SCHEDULED', 'FOLLOW_UP', 'NEGOTIATION', 'LOST'],
  FOLLOW_UP: ['CONTACTED', 'NOT_REACHABLE', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'LOST'],
  SITE_VISIT_SCHEDULED: ['SITE_VISIT_COMPLETED', 'FOLLOW_UP', 'INTERESTED', 'LOST'],
  SITE_VISIT_COMPLETED: ['NEGOTIATION', 'FOLLOW_UP', 'SITE_VISIT_SCHEDULED', 'BOOKING_PENDING', 'LOST'],
  NEGOTIATION: ['BOOKING_PENDING', 'FOLLOW_UP', 'SITE_VISIT_SCHEDULED', 'LOST'],
  BOOKING_PENDING: ['CONVERTED', 'NEGOTIATION', 'LOST'],
  CONVERTED: [],
  LOST: ['FOLLOW_UP', 'CONTACTED'],
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

const optionalMoney = z.coerce.number().min(0).max(999_999_999_999).optional().nullable();

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneSchema,
  email: z.email().max(160).optional().or(z.literal('')),
  sourceKey: z.string().trim().min(2).max(40).default('MANUAL'),
  campaignId: z.uuid().optional().nullable(),
  propertyId: z.uuid().optional().nullable(),
  projectId: z.uuid().optional().nullable(),
  unitId: z.uuid().optional().nullable(),
  enquiryType: z.enum(ENQUIRY_TYPES).default('GENERAL'),
  listingType: z.enum(LISTING_TYPES).optional().nullable(),
  budgetMin: optionalMoney,
  budgetMax: optionalMoney,
  preferredCityId: z.uuid().optional().nullable(),
  preferredLocalityId: z.uuid().optional().nullable(),
  locationPreference: z.string().trim().max(300).optional().nullable(),
  requirement: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(LEAD_PRIORITIES).default('MEDIUM'),
  assignToUserId: z.uuid().optional().nullable(),
  autoAssign: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  organizationId: z.uuid().optional(),
});
export type LeadCreateInput = z.input<typeof leadCreateSchema>;

export const leadUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.email().max(160).optional().or(z.literal('')).nullable(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  listingType: z.enum(LISTING_TYPES).optional().nullable(),
  budgetMin: optionalMoney,
  budgetMax: optionalMoney,
  preferredCityId: z.uuid().optional().nullable(),
  preferredLocalityId: z.uuid().optional().nullable(),
  locationPreference: z.string().trim().max(300).optional().nullable(),
  requirement: z.string().trim().max(2000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  propertyId: z.uuid().optional().nullable(),
  projectId: z.uuid().optional().nullable(),
});

export const leadStatusChangeSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
    note: z.string().trim().max(2000).optional(),
    lostReason: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'LOST' && !v.lostReason) ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'Give a reason for losing the lead' });
  });

export const leadAssignSchema = z.object({
  userId: z.uuid(),
  reason: z.string().trim().max(300).optional(),
});

export const leadBulkAssignSchema = z.object({
  leadIds: z.array(z.uuid()).min(1).max(200),
  userId: z.uuid().optional(),
  auto: z.boolean().default(false),
});

export const activityCreateSchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  direction: z.enum(ACTIVITY_DIRECTIONS).optional(),
  outcome: z.string().trim().max(80).optional(),
  summary: z.string().trim().min(2).max(300),
  details: z.string().trim().max(4000).optional(),
  durationSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const followUpCreateSchema = z.object({
  type: z.enum(FOLLOW_UP_TYPES).default('CALL'),
  dueAt: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(1000).optional(),
  assignedToId: z.uuid().optional(),
});

export const followUpCompleteSchema = z.object({
  outcome: z.string().trim().min(2).max(500),
  status: z.enum(['COMPLETED', 'CANCELLED']).default('COMPLETED'),
});

export const siteVisitCreateSchema = z.object({
  leadId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
  propertyId: z.uuid().optional().nullable(),
  projectId: z.uuid().optional().nullable(),
  unitId: z.uuid().optional().nullable(),
  assignedToId: z.uuid().optional().nullable(),
  meetingPoint: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const siteVisitUpdateSchema = z.object({
  status: z.enum(SITE_VISIT_STATUSES).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  assignedToId: z.uuid().optional().nullable(),
  meetingPoint: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  outcome: z.string().trim().max(1000).optional().nullable(),
  customerFeedback: z.string().trim().max(2000).optional().nullable(),
});

export const dealCreateSchema = z.object({
  leadId: z.uuid(),
  dealType: z.enum(DEAL_TYPES).default('SALE'),
  dealValue: z.coerce.number().positive().max(999_999_999_999),
  expectedRevenue: optionalMoney,
  propertyId: z.uuid().optional().nullable(),
  projectId: z.uuid().optional().nullable(),
  unitId: z.uuid().optional().nullable(),
  bookingDate: z.iso.date().optional().nullable(),
  salesUserId: z.uuid().optional().nullable(),
  brokerOrganizationId: z.uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const dealStatusSchema = z.object({
  status: z.enum(DEAL_STATUSES),
  agreementDate: z.iso.date().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const DEAL_STATUS_TRANSITIONS: Record<(typeof DEAL_STATUSES)[number], (typeof DEAL_STATUSES)[number][]> = {
  OPEN: ['BOOKED', 'CANCELLED'],
  BOOKED: ['AGREEMENT_SIGNED', 'CLOSED_WON', 'CANCELLED'],
  AGREEMENT_SIGNED: ['CLOSED_WON', 'CANCELLED'],
  CLOSED_WON: [],
  CANCELLED: [],
};

export const dealPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(999_999_999_999),
  receivedOn: z.iso.date(),
  receivedBy: z.enum(PAYMENT_RECEIVERS).default('DEVELOPER'),
  method: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const leadProviderSubmitSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneSchema,
  email: z.email().max(160).optional().or(z.literal('')),
  projectId: z.uuid().optional().nullable(),
  propertyId: z.uuid().optional().nullable(),
  listingType: z.enum(LISTING_TYPES).optional().nullable(),
  budgetMin: optionalMoney,
  budgetMax: optionalMoney,
  locationPreference: z.string().trim().max(300).optional().nullable(),
  requirement: z.string().trim().max(2000).optional().nullable(),
  externalRef: z.string().trim().max(80).optional().nullable(),
});

/** CSV columns accepted by lead import (header names are case-insensitive). */
export const LEAD_IMPORT_COLUMNS = ['name', 'phone', 'email', 'budget_min', 'budget_max', 'location', 'requirement', 'project_slug'] as const;

// ───────────────────────── Assignment engine (pure) ─────────────────────────

export interface AssignmentCandidate {
  userId: string;
  openLeads: number;
}

/**
 * Picks the next assignee. ROUND_ROBIN rotates through candidates (sorted deterministically) after
 * `lastAssignedUserId`; WORKLOAD picks the fewest open leads (ties → round-robin order).
 * Candidates at/over `maxOpenLeads` are skipped. Returns null when nobody is eligible.
 */
export function pickAssignee(
  candidates: AssignmentCandidate[],
  strategy: AssignmentStrategy,
  lastAssignedUserId: string | null,
  maxOpenLeads?: number | null,
): string | null {
  const eligible = candidates
    .filter((c) => maxOpenLeads == null || c.openLeads < maxOpenLeads)
    .sort((a, b) => a.userId.localeCompare(b.userId));
  if (eligible.length === 0) return null;

  const rotation = (() => {
    if (!lastAssignedUserId) return eligible;
    const idx = eligible.findIndex((c) => c.userId.localeCompare(lastAssignedUserId) > 0);
    return idx === -1 ? eligible : [...eligible.slice(idx), ...eligible.slice(0, idx)];
  })();

  if (strategy === 'ROUND_ROBIN') return rotation[0].userId;
  const min = Math.min(...rotation.map((c) => c.openLeads));
  return rotation.find((c) => c.openLeads === min)!.userId;
}

export interface AssignmentRuleLike {
  id: string;
  priority: number;
  matchProjectId: string | null;
  matchCityIds: string[];
  matchLocalityIds: string[];
  matchSourceKeys: string[];
  matchListingType: string | null;
}

export interface LeadRoutingFacts {
  projectId: string | null;
  cityId: string | null;
  localityId: string | null;
  sourceKey: string;
  listingType: string | null;
}

/** First active rule (ascending priority) whose every specified condition matches. */
export function matchAssignmentRule<T extends AssignmentRuleLike>(rules: T[], facts: LeadRoutingFacts): T | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (r.matchProjectId && r.matchProjectId !== facts.projectId) continue;
    if (r.matchCityIds.length && (!facts.cityId || !r.matchCityIds.includes(facts.cityId))) continue;
    if (r.matchLocalityIds.length && (!facts.localityId || !r.matchLocalityIds.includes(facts.localityId))) continue;
    if (r.matchSourceKeys.length && !r.matchSourceKeys.includes(facts.sourceKey)) continue;
    if (r.matchListingType && r.matchListingType !== facts.listingType) continue;
    return r;
  }
  return null;
}

/** Describes why a rule matched (used for the assignment history reason). */
export function assignmentMethodForRule(rule: AssignmentRuleLike, strategy: AssignmentStrategy): 'PROJECT' | 'LOCATION' | 'ROUND_ROBIN' | 'WORKLOAD' {
  if (rule.matchProjectId) return 'PROJECT';
  if (rule.matchLocalityIds.length || rule.matchCityIds.length) return 'LOCATION';
  return strategy === 'WORKLOAD' ? 'WORKLOAD' : 'ROUND_ROBIN';
}
