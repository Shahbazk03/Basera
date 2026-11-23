import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  AttendanceStatus,
  EMPLOYEE_DOCUMENT_TYPES,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  PayrollAdjustmentType,
  PAYROLL_ADJUSTMENT_TYPES,
  PAYMENT_METHODS,
  SALARY_CALC_TYPES,
  SALARY_COMPONENT_TYPES,
  SalaryCalcType,
  SalaryComponentType,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './enums';
import { fromPaise, percentOfPaise, toPaise } from './money';

// ───────────────────────── Calendar helpers ─────────────────────────

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** YYYY-MM-DD of an instant in a timezone. */
export function localDateString(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes since local midnight of an instant in a timezone. */
export function localMinutesOfDay(instant: Date, timeZone = DEFAULT_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function parseHHmm(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid time "${value}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Iterates calendar dates (YYYY-MM-DD, inclusive) using UTC arithmetic on date-only values. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d.getTime() <= last.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export interface WorkCalendar {
  /** 0 = Sunday … 6 = Saturday */
  weeklyOffDays: number[];
  /** YYYY-MM-DD */
  holidays: string[];
}

export function isWorkingDay(date: string, cal: WorkCalendar): boolean {
  return !cal.weeklyOffDays.includes(dayOfWeek(date)) && !cal.holidays.includes(date);
}

export function workingDaysBetween(start: string, end: string, cal: WorkCalendar): number {
  return eachDate(start, end).filter((d) => isWorkingDay(d, cal)).length;
}

/** Leave days requested between two dates, excluding weekly offs and holidays; half days count 0.5. */
export function countLeaveDays(
  start: string,
  end: string,
  cal: WorkCalendar,
  opts: { halfDayStart?: boolean; halfDayEnd?: boolean } = {},
): number {
  if (end < start) return 0;
  const days = eachDate(start, end).filter((d) => isWorkingDay(d, cal));
  let total = days.length;
  if (opts.halfDayStart && days.includes(start)) total -= 0.5;
  if (opts.halfDayEnd && days.includes(end) && (start !== end || !opts.halfDayStart)) total -= 0.5;
  return Math.max(0, total);
}

export interface ShiftRules {
  startTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
}

export function attendanceStatusForMinutes(workMinutes: number, shift: ShiftRules): AttendanceStatus {
  if (workMinutes >= shift.fullDayMinutes) return 'PRESENT';
  if (workMinutes >= shift.halfDayMinutes) return 'HALF_DAY';
  return 'ABSENT';
}

export function isLateCheckIn(checkInMinutesOfDay: number, shift: ShiftRules): boolean {
  return checkInMinutesOfDay > parseHHmm(shift.startTime) + shift.graceMinutes;
}

// ───────────────────────── Payroll calculation (pure) ─────────────────────────

export interface PayrollComponentInput {
  code: string;
  name: string;
  type: SalaryComponentType;
  calcType: SalaryCalcType;
  /** Monthly amount (FIXED) or percentage (PERCENT_OF_*) */
  value: number;
  maxAmount?: number | null;
  prorate: boolean;
  sortOrder: number;
}

export interface PayrollAdjustmentInput {
  type: PayrollAdjustmentType;
  amount: number;
  description: string;
}

export interface PayrollCalcInput {
  components: PayrollComponentInput[];
  workingDays: number;
  payableDays: number;
  adjustments: PayrollAdjustmentInput[];
}

export interface PayslipLineResult {
  componentCode: string;
  componentName: string;
  type: SalaryComponentType;
  amount: number;
  calculation: string;
  sortOrder: number;
}

export interface PayrollCalcResult {
  lines: PayslipLineResult[];
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  warnings: string[];
}

/**
 * Documented formulas (docs/workflows/payroll.md):
 *   proration      = payableDays / workingDays            (components with prorate = true)
 *   FIXED          = value × proration
 *   % of BASIC     = (BASIC monthly × value / 100) × proration
 *   % of GROSS     = (gross of salary-component earnings, after proration) × value / 100   (deductions only)
 *   cap            = min(amount, maxAmount) when maxAmount is set
 *   adjustments    = INCENTIVE / BONUS / ARREARS / REIMBURSEMENT add to earnings, DEDUCTION adds to deductions
 *   net            = total earnings − total deductions (never below zero; a warning is raised instead)
 * No statutory rate is assumed — every percentage comes from configured components.
 */
export function calculatePayslip(input: PayrollCalcInput): PayrollCalcResult {
  const warnings: string[] = [];
  const workingDays = input.workingDays;
  const payable = Math.min(Math.max(input.payableDays, 0), workingDays);
  const proration = workingDays > 0 ? payable / workingDays : 0;
  const fmtRatio = `${payable}/${workingDays} days`;

  const sorted = [...input.components].sort((a, b) => a.sortOrder - b.sortOrder);
  const basic = sorted.find((c) => c.code === 'BASIC' && c.type === 'EARNING');
  if (!basic) warnings.push('No BASIC earning component configured; percentage-of-basic components evaluate to zero.');
  if (basic && basic.calcType !== 'FIXED') warnings.push('BASIC must be a FIXED component; treated as zero.');
  const basicMonthlyPaise = basic && basic.calcType === 'FIXED' ? toPaise(basic.value) : 0;

  const lines: PayslipLineResult[] = [];
  const cap = (paise: number, c: PayrollComponentInput) =>
    c.maxAmount != null && paise > toPaise(c.maxAmount) ? toPaise(c.maxAmount) : paise;

  // Earnings first (gross is needed for % of gross deductions)
  let earningsPaise = 0;
  for (const c of sorted.filter((x) => x.type === 'EARNING')) {
    let paise = 0;
    let calc = '';
    if (c.calcType === 'FIXED') {
      paise = toPaise(c.value);
      calc = `₹${c.value.toFixed(2)} monthly`;
    } else if (c.calcType === 'PERCENT_OF_BASIC') {
      paise = percentOfPaise(basicMonthlyPaise, c.value);
      calc = `${c.value}% of Basic (₹${fromPaise(basicMonthlyPaise).toFixed(2)})`;
    } else {
      warnings.push(`${c.name}: % of gross is only supported for deductions; skipped.`);
      continue;
    }
    if (c.prorate && workingDays > 0 && payable !== workingDays) {
      paise = Math.round(paise * proration);
      calc += ` × ${fmtRatio}`;
    }
    const capped = cap(paise, c);
    if (capped !== paise) calc += ` (capped at ₹${c.maxAmount})`;
    earningsPaise += capped;
    lines.push({ componentCode: c.code, componentName: c.name, type: 'EARNING', amount: fromPaise(capped), calculation: calc, sortOrder: c.sortOrder });
  }
  const componentGrossPaise = earningsPaise;
  const proratedBasicPaise = basic ? toPaise(lines.find((l) => l.componentCode === 'BASIC')?.amount ?? 0) : 0;

  let order = 1000;
  for (const adj of input.adjustments) {
    if (adj.type === 'DEDUCTION') continue;
    const paise = toPaise(adj.amount);
    earningsPaise += paise;
    lines.push({
      componentCode: adj.type,
      componentName: adj.description,
      type: 'EARNING',
      amount: fromPaise(paise),
      calculation: `One-time ${adj.type.toLowerCase()}`,
      sortOrder: order++,
    });
  }

  let deductionsPaise = 0;
  for (const c of sorted.filter((x) => x.type === 'DEDUCTION')) {
    let paise = 0;
    let calc = '';
    if (c.calcType === 'FIXED') {
      paise = toPaise(c.value);
      calc = `₹${c.value.toFixed(2)} monthly`;
      if (c.prorate && workingDays > 0 && payable !== workingDays) {
        paise = Math.round(paise * proration);
        calc += ` × ${fmtRatio}`;
      }
    } else if (c.calcType === 'PERCENT_OF_BASIC') {
      paise = percentOfPaise(proratedBasicPaise, c.value);
      calc = `${c.value}% of earned Basic (₹${fromPaise(proratedBasicPaise).toFixed(2)})`;
    } else {
      paise = percentOfPaise(componentGrossPaise, c.value);
      calc = `${c.value}% of earned gross (₹${fromPaise(componentGrossPaise).toFixed(2)})`;
    }
    const capped = cap(paise, c);
    if (capped !== paise) calc += ` (capped at ₹${c.maxAmount})`;
    deductionsPaise += capped;
    lines.push({ componentCode: c.code, componentName: c.name, type: 'DEDUCTION', amount: fromPaise(capped), calculation: calc, sortOrder: c.sortOrder });
  }
  for (const adj of input.adjustments) {
    if (adj.type !== 'DEDUCTION') continue;
    const paise = toPaise(adj.amount);
    deductionsPaise += paise;
    lines.push({
      componentCode: 'DEDUCTION',
      componentName: adj.description,
      type: 'DEDUCTION',
      amount: fromPaise(paise),
      calculation: 'One-time deduction',
      sortOrder: order++,
    });
  }

  let netPaise = earningsPaise - deductionsPaise;
  if (netPaise < 0) {
    warnings.push('Deductions exceed earnings; net pay set to zero. Review the configured deductions.');
    netPaise = 0;
  }
  return {
    lines,
    grossEarnings: fromPaise(earningsPaise),
    totalDeductions: fromPaise(deductionsPaise),
    netPay: fromPaise(netPaise),
    warnings,
  };
}

// ───────────────────────── Schemas ─────────────────────────

const date = z.iso.date();

export const employeeCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.email().max(160),
  phone: z.string().trim().max(20).optional().nullable(),
  employeeCode: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9-]+$/),
  departmentId: z.uuid().optional().nullable(),
  designationId: z.uuid().optional().nullable(),
  managerId: z.uuid().optional().nullable(),
  shiftId: z.uuid().optional().nullable(),
  joiningDate: date,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).default('ACTIVE'),
  workLocation: z.string().trim().max(120).optional().nullable(),
  dateOfBirth: date.optional().nullable(),
  gender: z.string().trim().max(30).optional().nullable(),
  personalEmail: z.email().optional().nullable().or(z.literal('')),
  emergencyContact: z.string().trim().max(200).optional().nullable(),
  roleKeys: z.array(z.string().max(40)).max(10).default([]),
  /** Initial password; when omitted an invite/reset flow is required before first login */
  password: z.string().min(10).max(128).optional(),
});

export const employeeUpdateSchema = employeeCreateSchema
  .omit({ email: true, password: true, roleKeys: true })
  .partial()
  .extend({ exitDate: date.optional().nullable() });

export const employeeSensitiveSchema = z.object({
  bankAccountName: z.string().trim().max(120).optional(),
  bankAccountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6–20 digits').optional(),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC').optional(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN').optional(),
});

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().min(2).max(16).regex(/^[A-Z0-9_-]+$/),
  description: z.string().trim().max(500).optional().nullable(),
  parentId: z.uuid().optional().nullable(),
  headEmployeeId: z.uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const designationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  level: z.coerce.number().int().min(1).max(20).default(1),
  departmentId: z.uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const shiftSchema = z.object({
  name: z.string().trim().min(2).max(60),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  graceMinutes: z.coerce.number().int().min(0).max(180).default(15),
  fullDayMinutes: z.coerce.number().int().min(60).max(1440).default(480),
  halfDayMinutes: z.coerce.number().int().min(30).max(1440).default(240),
  weeklyOffDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([0]),
  timezone: z.string().max(60).default(DEFAULT_TIMEZONE),
  isDefault: z.boolean().optional(),
});

export const holidaySchema = z.object({
  date,
  name: z.string().trim().min(2).max(100),
  isOptional: z.boolean().optional(),
});

export const attendanceCorrectionSchema = z
  .object({
    date,
    requestedCheckIn: z.iso.datetime({ offset: true }).optional().nullable(),
    requestedCheckOut: z.iso.datetime({ offset: true }).optional().nullable(),
    reason: z.string().trim().min(5).max(500),
  })
  .refine((v) => v.requestedCheckIn || v.requestedCheckOut, { message: 'Provide a check-in or check-out time', path: ['requestedCheckIn'] });

export const attendanceManualSchema = z.object({
  employeeId: z.uuid(),
  date,
  status: z.enum(ATTENDANCE_STATUSES),
  checkInAt: z.iso.datetime({ offset: true }).optional().nullable(),
  checkOutAt: z.iso.datetime({ offset: true }).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().toUpperCase().min(1).max(10).regex(/^[A-Z0-9_]+$/),
  isPaid: z.boolean().default(true),
  annualQuota: z.coerce.number().min(0).max(365),
  carryForward: z.boolean().default(false),
  maxCarryForward: z.coerce.number().min(0).max(365).optional().nullable(),
  allowHalfDay: z.boolean().default(true),
  isActive: z.boolean().optional(),
});

export const leaveApplySchema = z
  .object({
    leaveTypeId: z.uuid(),
    startDate: date,
    endDate: date,
    halfDayStart: z.boolean().default(false),
    halfDayEnd: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const leaveDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});

export const taskSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  assignedToId: z.uuid(),
  leadId: z.uuid().optional().nullable(),
  dueAt: z.iso.datetime({ offset: true }).optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
});
export const taskUpdateSchema = taskSchema.partial().extend({ status: z.enum(TASK_STATUSES).optional() });

export const salaryComponentSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  type: z.enum(SALARY_COMPONENT_TYPES),
  calcType: z.enum(SALARY_CALC_TYPES).default('FIXED'),
  defaultValue: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  maxAmount: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  isStatutory: z.boolean().default(false),
  isTaxable: z.boolean().default(true),
  prorateByAttendance: z.boolean().default(true),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().optional(),
});

export const salaryStructureSchema = z.object({
  effectiveFrom: date,
  notes: z.string().trim().max(500).optional().nullable(),
  lines: z
    .array(z.object({ componentId: z.uuid(), value: z.coerce.number().min(0).max(100_000_000) }))
    .min(1)
    .max(40),
});

export const payrollRunCreateSchema = z.object({
  periodYear: z.coerce.number().int().min(2020).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  notes: z.string().trim().max(500).optional(),
});

export const payrollAdjustmentSchema = z.object({
  employeeId: z.uuid(),
  periodYear: z.coerce.number().int().min(2020).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  type: z.enum(PAYROLL_ADJUSTMENT_TYPES),
  amount: z.coerce.number().positive().max(100_000_000),
  description: z.string().trim().min(3).max(200),
});

export const salaryPaymentSchema = z.object({
  paidOn: date,
  method: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const employeeDocumentSchema = z.object({
  docType: z.enum(EMPLOYEE_DOCUMENT_TYPES),
  title: z.string().trim().min(2).max(160),
  fileId: z.uuid(),
});
