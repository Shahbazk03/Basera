import { z } from 'zod';
import {
  BILLING_PERIODS,
  COMMISSION_BASES,
  COMMISSION_CALC_TYPES,
  COMMISSION_RECIPIENT_TYPES,
  CommissionCalcType,
  CommissionStatus,
  DEAL_TYPES,
  PAYMENT_METHODS,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_TYPES,
} from './enums';
import { fromPaise, percentOfPaise, toPaise } from './money';

// ───────────────────────── Commission calculation (pure) ─────────────────────────

export interface CommissionRuleInput {
  calcType: CommissionCalcType;
  /** Fixed amount in INR, or percentage */
  value: number;
  minDealValue?: number | null;
  maxPayout?: number | null;
}

export interface CommissionCalcResult {
  applicable: boolean;
  amount: number;
  explanation: string;
}

export function calculateCommission(rule: CommissionRuleInput, basisAmount: number): CommissionCalcResult {
  if (rule.minDealValue != null && basisAmount < rule.minDealValue) {
    return { applicable: false, amount: 0, explanation: `Basis ₹${basisAmount} is below the rule minimum ₹${rule.minDealValue}` };
  }
  let paise: number;
  let explanation: string;
  if (rule.calcType === 'FIXED') {
    paise = toPaise(rule.value);
    explanation = `Fixed ₹${rule.value}`;
  } else {
    paise = percentOfPaise(toPaise(basisAmount), rule.value);
    explanation = `${rule.value}% of ₹${basisAmount}`;
  }
  if (rule.maxPayout != null && paise > toPaise(rule.maxPayout)) {
    paise = toPaise(rule.maxPayout);
    explanation += ` (capped at ₹${rule.maxPayout})`;
  }
  return { applicable: true, amount: fromPaise(paise), explanation };
}

export const COMMISSION_STATUS_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PAYABLE', 'CANCELLED'],
  PAYABLE: ['PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

// ───────────────────────── Invoices ─────────────────────────

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Percent, configured per line — never assumed */
  taxRate: number;
}

export interface InvoiceTotals {
  lines: (InvoiceLineInput & { amount: number; taxAmount: number })[];
  subtotal: number;
  taxTotal: number;
  total: number;
}

export function calculateInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let subtotal = 0;
  let tax = 0;
  const out = lines.map((l) => {
    const amountPaise = Math.round(toPaise(l.unitPrice) * l.quantity);
    const taxPaise = percentOfPaise(amountPaise, l.taxRate);
    subtotal += amountPaise;
    tax += taxPaise;
    return { ...l, amount: fromPaise(amountPaise), taxAmount: fromPaise(taxPaise) };
  });
  return { lines: out, subtotal: fromPaise(subtotal), taxTotal: fromPaise(tax), total: fromPaise(subtotal + tax) };
}

// ───────────────────────── Schemas ─────────────────────────

const date = z.iso.date();
const money = z.coerce.number().min(0).max(999_999_999_999);

export const commissionRuleSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    recipientType: z.enum(COMMISSION_RECIPIENT_TYPES),
    calcType: z.enum(COMMISSION_CALC_TYPES),
    value: z.coerce.number().min(0).max(999_999_999),
    basis: z.enum(COMMISSION_BASES).default('DEAL_VALUE'),
    dealType: z.enum(DEAL_TYPES).optional().nullable(),
    projectId: z.uuid().optional().nullable(),
    propertyTypeId: z.uuid().optional().nullable(),
    cityId: z.uuid().optional().nullable(),
    leadProviderId: z.uuid().optional().nullable(),
    brokerOrganizationId: z.uuid().optional().nullable(),
    minDealValue: money.optional().nullable(),
    maxPayout: money.optional().nullable(),
    priority: z.coerce.number().int().min(0).max(10000).default(100),
    isActive: z.boolean().default(true),
    effectiveFrom: date.optional().nullable(),
    effectiveTo: date.optional().nullable(),
  })
  .refine((v) => v.calcType !== 'PERCENTAGE' || v.value <= 100, { message: 'Percentage cannot exceed 100', path: ['value'] });

export const commissionManualSchema = z.object({
  dealId: z.uuid(),
  recipientType: z.enum(COMMISSION_RECIPIENT_TYPES),
  recipientUserId: z.uuid().optional().nullable(),
  recipientOrganizationId: z.uuid().optional().nullable(),
  leadProviderId: z.uuid().optional().nullable(),
  recipientName: z.string().trim().min(2).max(120),
  calcType: z.enum(COMMISSION_CALC_TYPES),
  value: z.coerce.number().min(0).max(999_999_999),
  basisAmount: money,
  notes: z.string().trim().max(500).optional().nullable(),
});

export const commissionStatusSchema = z.object({
  status: z.enum(['APPROVED', 'PAYABLE', 'CANCELLED']),
  notes: z.string().trim().max(500).optional(),
});

export const payoutCreateSchema = z.object({
  commissionRecordIds: z.array(z.uuid()).min(1).max(200),
  notes: z.string().trim().max(500).optional(),
});

export const payoutPaySchema = z.object({
  paidOn: date,
  method: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().trim().max(100).optional().nullable(),
});

export const transactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  direction: z.enum(TRANSACTION_DIRECTIONS),
  amount: z.coerce.number().positive().max(999_999_999_999),
  txnDate: date,
  method: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().trim().max(100).optional().nullable(),
  counterparty: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  dealId: z.uuid().optional().nullable(),
});

export const invoiceSchema = z.object({
  billToName: z.string().trim().min(2).max(160),
  billToAddress: z.string().trim().max(500).optional().nullable(),
  billToGstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'Invalid GSTIN')
    .optional()
    .nullable()
    .or(z.literal('')),
  billToOrganizationId: z.uuid().optional().nullable(),
  customerId: z.uuid().optional().nullable(),
  dealId: z.uuid().optional().nullable(),
  issueDate: date,
  dueDate: date.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(300),
        quantity: z.coerce.number().positive().max(100000),
        unitPrice: money,
        taxRate: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1)
    .max(50),
});

export const invoicePaymentSchema = z.object({
  amount: z.coerce.number().positive().max(999_999_999_999),
  txnDate: date,
  method: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().trim().max(100).optional().nullable(),
});

export const expenseSchema = z.object({
  categoryId: z.uuid(),
  amount: z.coerce.number().positive().max(999_999_999),
  expenseDate: date,
  vendor: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().min(3).max(500),
  receiptFileId: z.uuid().optional().nullable(),
});

export const reimbursementSchema = z.object({
  title: z.string().trim().min(3).max(160),
  category: z.string().trim().min(2).max(60),
  amount: z.coerce.number().positive().max(10_000_000),
  expenseDate: date,
  description: z.string().trim().max(1000).optional().nullable(),
  receiptFileId: z.uuid().optional().nullable(),
});

export const subscriptionPlanSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(30).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  price: money,
  billingPeriod: z.enum(BILLING_PERIODS),
  listingQuota: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  featuredQuota: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  features: z.array(z.string().trim().min(2).max(120)).max(20).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export const subscriptionAssignSchema = z.object({
  planId: z.uuid(),
  startsAt: date,
  paymentReference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  activate: z.boolean().default(true),
});
