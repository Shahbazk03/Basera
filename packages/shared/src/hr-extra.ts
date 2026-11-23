import { z } from 'zod';
import { salaryPaymentSchema } from './hr';

/** Roles that can never be granted from the HR employee screens (user administration only). */
export const HR_NON_ASSIGNABLE_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

export const employeeExitSchema = z.object({
  exitDate: z.iso.date(),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

/** Approve/reject for HR requests (attendance corrections). A reason is required when rejecting. */
export const hrApprovalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.note && v.note.length >= 3), { message: 'Give a reason for rejecting', path: ['note'] });

export const leaveBalanceSetSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
  allocated: z.coerce.number().min(0).max(365),
  carriedForward: z.coerce.number().min(0).max(365).optional(),
});

export const leaveYearAllocateSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  carryForward: z.boolean().default(true),
});

/** Record salary payment for selected payslips (all unpaid approved payslips when omitted). */
export const payrollPaymentSchema = salaryPaymentSchema.extend({
  payslipIds: z.array(z.uuid()).max(2000).optional(),
});

export const payrollRunCancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
