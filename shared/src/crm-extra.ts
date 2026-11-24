import { z } from 'zod';
import {
  ASSIGNMENT_STRATEGIES,
  CAMPAIGN_STATUSES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LISTING_TYPES,
  PROPERTY_SEGMENTS,
  SITE_VISIT_STATUSES,
} from './enums';
import { phoneSchema } from './crm';

/**
 * Additional CRM contracts: sales teams, routing rules, campaigns, customers, imports and
 * lead-provider administration. Shared by the API (validation) and the console (forms).
 */

const optionalUuid = z.uuid().optional().nullable();
const optionalMoney = z.coerce.number().min(0).max(999_999_999_999).optional().nullable();

export const salesTeamSchema = z.object({
  organizationId: z.uuid().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  managerId: optionalUuid,
  isActive: z.boolean().optional(),
  memberIds: z.array(z.uuid()).max(100).optional(),
});
export type SalesTeamInput = z.input<typeof salesTeamSchema>;

export const salesTeamMemberSchema = z.object({
  userId: z.uuid(),
  isActive: z.boolean().default(true),
});

export const assignmentRuleSchema = z.object({
  organizationId: z.uuid().optional(),
  name: z.string().trim().min(2).max(100),
  priority: z.coerce.number().int().min(0).max(100000).default(100),
  isActive: z.boolean().default(true),
  matchProjectId: optionalUuid,
  matchCityIds: z.array(z.uuid()).max(50).default([]),
  matchLocalityIds: z.array(z.uuid()).max(200).default([]),
  matchSourceKeys: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  matchListingType: z.enum(LISTING_TYPES).optional().nullable(),
  salesTeamId: z.uuid(),
  strategy: z.enum(ASSIGNMENT_STRATEGIES).default('ROUND_ROBIN'),
  maxOpenLeadsPerUser: z.coerce.number().int().min(1).max(10000).optional().nullable(),
});
export type AssignmentRuleInput = z.input<typeof assignmentRuleSchema>;

export const rulesReorderSchema = z.object({
  organizationId: z.uuid().optional(),
  ruleIds: z.array(z.uuid()).min(1).max(200),
});

export const routingTestSchema = z.object({
  organizationId: z.uuid().optional(),
  projectId: optionalUuid,
  propertyId: optionalUuid,
  cityId: optionalUuid,
  localityId: optionalUuid,
  sourceKey: z.string().trim().min(2).max(40).default('WEBSITE'),
  listingType: z.enum(LISTING_TYPES).optional().nullable(),
});
export type RoutingTestInput = z.input<typeof routingTestSchema>;

export const campaignBaseSchema = z.object({
  organizationId: z.uuid().optional(),
  name: z.string().trim().min(3).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, hyphens or underscores'),
  channel: z.string().trim().min(2).max(60),
  status: z.enum(CAMPAIGN_STATUSES).default('DRAFT'),
  startDate: z.iso.date().optional().nullable().or(z.literal('')),
  endDate: z.iso.date().optional().nullable().or(z.literal('')),
  budget: optionalMoney,
  notes: z.string().trim().max(1000).optional().nullable(),
});
const campaignDatesValid = (v: { startDate?: string | null; endDate?: string | null }) => !v.startDate || !v.endDate || v.endDate >= v.startDate;
export const campaignSchema = campaignBaseSchema.refine(campaignDatesValid, { message: 'End date must be on or after the start date', path: ['endDate'] });
/** Partial update (Zod 4 does not allow .partial() on refined objects, so it derives from the base). */
export const campaignUpdateSchema = campaignBaseSchema.partial().refine(campaignDatesValid, { message: 'End date must be on or after the start date', path: ['endDate'] });
export type CampaignInput = z.input<typeof campaignSchema>;

export const leadSourceSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use capital letters, numbers and underscores'),
  name: z.string().trim().min(2).max(60),
  isActive: z.boolean().default(true),
});

export const customerUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  email: z.email().max(160).optional().nullable().or(z.literal('')),
  alternatePhone: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  occupation: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const customerPreferenceSchema = z.object({
  listingType: z.enum(LISTING_TYPES).optional().nullable(),
  segment: z.enum(PROPERTY_SEGMENTS).optional().nullable(),
  cityId: optionalUuid,
  localityNames: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  budgetMin: optionalMoney,
  budgetMax: optionalMoney,
  bedroomsMin: z.coerce.number().int().min(0).max(20).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const enquiryStatusSchema = z.object({
  status: z.enum(['PROCESSED', 'SPAM', 'CLOSED']),
  note: z.string().trim().max(500).optional(),
});

/** CSV text sent from the browser (the file is read client-side). */
export const leadImportSchema = z.object({
  csv: z.string().min(10, 'The file is empty').max(600_000, 'The file is too large (max ~600 KB)'),
  commit: z.boolean().default(false),
  sourceKey: z.string().trim().min(2).max(40).optional(),
  projectId: optionalUuid,
  campaignId: optionalUuid,
  autoAssign: z.boolean().default(true),
  organizationId: z.uuid().optional(),
});
export type LeadImportInput = z.input<typeof leadImportSchema>;

export const providerImportSchema = z.object({
  csv: z.string().min(10, 'The file is empty').max(600_000, 'The file is too large (max ~600 KB)'),
  commit: z.boolean().default(false),
});

export const leadProviderAdminUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  duplicateWindowDays: z.coerce.number().int().min(1).max(365).optional(),
  contactName: z.string().trim().max(100).optional().nullable(),
  email: z.email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const providerLeadReviewSchema = z
  .object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === 'ACCEPT' || (v.reason && v.reason.length >= 3), { message: 'Give a reason for rejecting', path: ['reason'] });

export const followUpRescheduleSchema = z.object({
  dueAt: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(1000).optional(),
});

export const leadFilterSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
});

export const siteVisitStatusFilter = z.enum(SITE_VISIT_STATUSES);

/** Customer-facing progress shown on "My enquiries" (never exposes internal pipeline detail). */
export const CUSTOMER_ENQUIRY_PROGRESS = ['RECEIVED', 'IN_PROGRESS', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'CLOSED'] as const;
export type CustomerEnquiryProgress = (typeof CUSTOMER_ENQUIRY_PROGRESS)[number];

export interface MyEnquiry {
  referenceNo: string;
  type: string;
  createdAt: string;
  progress: CustomerEnquiryProgress;
  subject: { kind: 'property' | 'project' | 'general'; title: string; slug: string | null; unitCode: string | null };
}

/** Manual-lead phone validation reused by the console's quick-add forms. */
export const quickLeadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneSchema,
});
