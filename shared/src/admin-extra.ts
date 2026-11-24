import { z } from 'zod';
import { PAYMENT_METHODS, ORGANIZATION_TYPES } from './enums';
import { homeSectionSchema } from './cms';
import { passwordSchema } from './auth';

/**
 * Contracts for administration, partner management, finance workflows, CMS editing and dashboards.
 * (Complements finance.ts / cms.ts / auth.ts — those definitions are reused, never redefined here.)
 */

const date = z.iso.date();
const period = {
  periodYear: z.coerce.number().int().min(2020).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
};

// ───────────── Users & roles ─────────────

export const userStatusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Administrator setting a user's password directly. When the password is emailed it is a temporary password:
 * the user must replace it at their next sign-in.
 */
export const adminSetPasswordSchema = z
  .object({
    password: passwordSchema,
    sendEmail: z.boolean().default(true),
    mustChange: z.boolean().default(true),
  })
  .refine((v) => !v.sendEmail || v.mustChange, { message: 'An emailed password must be changed at the next sign-in', path: ['mustChange'] });

/** Administrator correcting a user's display name. */
export const adminUserUpdateSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter a name').max(100),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.string().max(60)).max(200).optional(),
});

// ───────────── Partners & organisations ─────────────

export const PARTNER_LIST_TYPES = ['BROKERAGE', 'DEVELOPER', 'INDIVIDUAL_OWNER', 'PARTNER'] as const satisfies readonly (typeof ORGANIZATION_TYPES)[number][];

export const orgDocumentDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional(),
});

export const publishModeSchema = z.object({
  projectPublishMode: z.enum(['REQUIRES_APPROVAL', 'DIRECT']),
});

export const memberUpdateSchema = z.object({
  roleKey: z.string().trim().min(2).max(40).optional(),
  title: z.string().trim().max(80).optional().nullable(),
});

export const subscriptionCancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

// ───────────── Commissions ─────────────

export const commissionPayViaPayrollSchema = z.object({
  commissionRecordIds: z.array(z.uuid()).min(1).max(100),
  ...period,
});

// ───────────── Finance ─────────────

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().default(true),
});

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.note && v.note.length >= 3), { message: 'Give a reason for rejecting', path: ['note'] });

export const paymentRecordSchema = z.object({
  paidOn: date,
  method: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().trim().max(100).optional().nullable(),
});

export const reimbursementPaySchema = z.discriminatedUnion('via', [
  z.object({ via: z.literal('TRANSACTION'), paidOn: date, method: z.enum(PAYMENT_METHODS), referenceNo: z.string().trim().max(100).optional().nullable() }),
  z.object({ via: z.literal('PAYROLL'), ...period }),
]);

export const invoiceCancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** Workflow-generated ledger types cannot be entered manually (their sub-ledgers must stay consistent). */
export const MANUAL_TRANSACTION_TYPES = ['CUSTOMER_PAYMENT', 'REFUND', 'OTHER'] as const;

// ───────────── CMS ─────────────

export const homeSectionUpdateSchema = homeSectionSchema.partial().omit({ type: true });
export const homeSectionOrderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(50) });

// ───────────── Dashboards ─────────────

export type MetricFormat = 'number' | 'currency';

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  format?: MetricFormat;
  hint?: string;
  href?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}

export interface DashboardSection {
  key: string;
  title: string;
  metrics: DashboardMetric[];
}

export interface DashboardBreakdown {
  key: string;
  title: string;
  href?: string;
  items: { key: string; label: string; value: number }[];
}

export interface DashboardListItem {
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  status?: string | null;
  href?: string | null;
}

export interface DashboardList {
  key: string;
  title: string;
  href?: string;
  emptyText: string;
  items: DashboardListItem[];
}

export interface DashboardResponse {
  workspace: string;
  organizationId: string | null;
  generatedAt: string;
  sections: DashboardSection[];
  breakdowns: DashboardBreakdown[];
  lists: DashboardList[];
}

export interface CommissionStatementTotals {
  PENDING_APPROVAL: number;
  APPROVED: number;
  PAYABLE: number;
  PAID: number;
  CANCELLED: number;
}

/**
 * Top-level website paths owned by the app itself. A CMS page with one of these slugs would never be reachable
 * (the app route wins), so the API refuses them.
 */
export const RESERVED_PAGE_SLUGS = [
  'account', 'admin', 'api', 'buy', 'rent', 'sell', 'commercial', 'plots', 'search', 'property', 'properties', 'project', 'projects',
  'partners', 'brokers', 'builders', 'developers', 'localities', 'locality', 'login', 'logout', 'register', 'forgot-password',
  'reset-password', 'verify-email', 'faqs', 'contact', 'site', 'domain-not-found', 'uploads', 'sitemap', 'sitemap.xml', 'robots.txt',
] as const;
export const isReservedPageSlug = (slug: string) => (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug.toLowerCase());
