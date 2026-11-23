import { z } from 'zod';
import {
  AREA_UNITS,
  BLOCK_TYPES,
  DOCUMENT_VISIBILITIES,
  FACINGS,
  MEDIA_TYPES,
  NEARBY_CATEGORIES,
  PROJECT_TEAM_ROLES,
  PROJECT_TYPES,
  PROPERTY_DOCUMENT_TYPES,
  ProjectStatus,
  UNIT_STATUSES,
  UNIT_TYPES,
  UnitStatus,
} from './enums';

// ───────────────────────── Project lifecycle ─────────────────────────

/** Statuses only ever set by a person (never derived automatically). */
export const MANUAL_ONLY_PROJECT_STATUSES: ProjectStatus[] = ['DRAFT', 'COMPLETED', 'ARCHIVED'];
/** Statuses the scheduler may derive from booking timestamps and inventory. */
export const SALES_PROJECT_STATUSES: ProjectStatus[] = [
  'UPCOMING',
  'PRE_LAUNCH',
  'BOOKING_OPEN',
  'CLOSING_SOON',
  'SOLD_OUT',
  'CLOSED',
];
/** Statuses in which a published project is visible to the public. */
export const PUBLIC_PROJECT_STATUSES: ProjectStatus[] = [
  'UPCOMING',
  'PRE_LAUNCH',
  'BOOKING_OPEN',
  'CLOSING_SOON',
  'SOLD_OUT',
  'CLOSED',
  'COMPLETED',
];
/** Statuses during which customers can request a unit reservation/booking. */
export const BOOKABLE_PROJECT_STATUSES: ProjectStatus[] = ['BOOKING_OPEN', 'CLOSING_SOON'];

export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  DRAFT: ['UPCOMING', 'PRE_LAUNCH', 'BOOKING_OPEN', 'ARCHIVED'],
  UPCOMING: ['DRAFT', 'PRE_LAUNCH', 'BOOKING_OPEN', 'ARCHIVED'],
  PRE_LAUNCH: ['UPCOMING', 'BOOKING_OPEN', 'ARCHIVED'],
  BOOKING_OPEN: ['CLOSING_SOON', 'SOLD_OUT', 'CLOSED', 'ARCHIVED'],
  CLOSING_SOON: ['BOOKING_OPEN', 'SOLD_OUT', 'CLOSED', 'ARCHIVED'],
  SOLD_OUT: ['BOOKING_OPEN', 'CLOSED', 'COMPLETED', 'ARCHIVED'],
  CLOSED: ['BOOKING_OPEN', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface ProjectStatusInputs {
  status: ProjectStatus;
  autoStatus: boolean;
  bookingOpensAt: Date | string | null | undefined;
  bookingClosesAt: Date | string | null | undefined;
  closingSoonHours: number;
  /** Units currently AVAILABLE */
  availableUnits: number;
  /** Units released for sale (any status except NOT_RELEASED/BLOCKED) */
  releasedUnits: number;
}

/**
 * Derives the effective sales status from server time, booking window and inventory.
 * The database/server is the source of truth — client countdowns are display-only.
 */
export function computeProjectStatus(input: ProjectStatusInputs, now: Date = new Date()): ProjectStatus {
  const { status } = input;
  if (!input.autoStatus || MANUAL_ONLY_PROJECT_STATUSES.includes(status)) return status;

  const opens = input.bookingOpensAt ? new Date(input.bookingOpensAt) : null;
  const closes = input.bookingClosesAt ? new Date(input.bookingClosesAt) : null;
  const t = now.getTime();

  if (closes && t >= closes.getTime()) return 'CLOSED';

  const bookingStarted = opens ? t >= opens.getTime() : status === 'BOOKING_OPEN' || status === 'CLOSING_SOON' || status === 'SOLD_OUT';
  if (bookingStarted) {
    if (input.releasedUnits > 0 && input.availableUnits === 0) return 'SOLD_OUT';
    if (closes && t >= closes.getTime() - input.closingSoonHours * 3_600_000) return 'CLOSING_SOON';
    return 'BOOKING_OPEN';
  }
  if (opens && t < opens.getTime()) {
    return status === 'PRE_LAUNCH' ? 'PRE_LAUNCH' : 'UPCOMING';
  }
  return status;
}

/** Milliseconds until the next automatic status change (for scheduling), or null if none is pending. */
export function nextProjectStatusChangeAt(input: ProjectStatusInputs, now: Date = new Date()): Date | null {
  if (!input.autoStatus) return null;
  const candidates: number[] = [];
  const t = now.getTime();
  if (input.bookingOpensAt) candidates.push(new Date(input.bookingOpensAt).getTime());
  if (input.bookingClosesAt) {
    const closes = new Date(input.bookingClosesAt).getTime();
    candidates.push(closes, closes - input.closingSoonHours * 3_600_000);
  }
  const future = candidates.filter((c) => c > t).sort((a, b) => a - b);
  return future.length ? new Date(future[0]) : null;
}

// ───────────────────────── Unit inventory ─────────────────────────

export const UNIT_STATUS_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  NOT_RELEASED: ['AVAILABLE', 'BLOCKED'],
  AVAILABLE: ['ON_HOLD', 'RESERVED', 'BOOKED', 'BLOCKED', 'NOT_RELEASED'],
  ON_HOLD: ['AVAILABLE', 'RESERVED', 'BOOKED'],
  RESERVED: ['AVAILABLE', 'BOOKED'],
  BOOKED: ['SOLD', 'AVAILABLE'],
  SOLD: ['BOOKED'],
  BLOCKED: ['AVAILABLE', 'NOT_RELEASED'],
};

export function canTransitionUnit(from: UnitStatus, to: UnitStatus): boolean {
  return UNIT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Units counted as released inventory. */
export function isReleasedUnit(status: UnitStatus): boolean {
  return status !== 'NOT_RELEASED' && status !== 'BLOCKED';
}

// ───────────────────────── Schemas ─────────────────────────

const optionalDate = z.iso.date().optional().nullable();
const optionalDateTime = z.iso.datetime({ offset: true }).optional().nullable();
const money = z.coerce.number().min(0).max(999_999_999_999);
const urlOrPath = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Must be an http(s) URL or a site-relative path');

export const projectBaseSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(80)
    .optional(),
  tagline: z.string().trim().max(160).optional().nullable(),
  projectType: z.enum(PROJECT_TYPES),
  organizationId: z.uuid().optional(),
  developerOrgId: z.uuid().optional().nullable(),
  cityId: z.uuid(),
  localityId: z.uuid(),
  addressLine: z.string().trim().max(300).optional().nullable(),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code').optional().nullable().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  description: z.string().trim().min(30).max(20000),
  heroImageUrl: urlOrPath.optional().nullable().or(z.literal('')),
  logoUrl: urlOrPath.optional().nullable().or(z.literal('')),
  masterPlanUrl: urlOrPath.optional().nullable().or(z.literal('')),
  videoUrls: z.array(z.url()).max(10).optional(),
  totalAreaAcres: z.coerce.number().min(0).max(100000).optional().nullable(),
  totalUnitsPlanned: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  launchDate: optionalDate,
  possessionDate: optionalDate,
  priceMinOverride: money.optional().nullable(),
  priceMaxOverride: money.optional().nullable(),
  reraNumber: z.string().trim().max(80).optional().nullable(),
  reraValidUntil: optionalDate,
  approvalDetails: z.string().trim().max(500).optional().nullable(),
  legalInformation: z.string().trim().max(5000).optional().nullable(),
  autoStatus: z.boolean().optional(),
  bookingOpensAt: optionalDateTime,
  bookingClosesAt: optionalDateTime,
  closingSoonHours: z.coerce.number().int().min(1).max(24 * 60).optional(),
  whatsappNumber: z.string().trim().max(20).optional().nullable(),
  salesPhone: z.string().trim().max(20).optional().nullable(),
  seoTitle: z.string().trim().max(70).optional().nullable(),
  seoDescription: z.string().trim().max(170).optional().nullable(),
  ogImageUrl: urlOrPath.optional().nullable().or(z.literal('')),
  amenityIds: z.array(z.uuid()).max(100).optional(),
});

export const projectCreateSchema = projectBaseSchema.superRefine((v, ctx) => {
  if (v.bookingOpensAt && v.bookingClosesAt && new Date(v.bookingClosesAt) <= new Date(v.bookingOpensAt)) {
    ctx.addIssue({ code: 'custom', path: ['bookingClosesAt'], message: 'Booking must close after it opens' });
  }
  if (v.priceMinOverride != null && v.priceMaxOverride != null && v.priceMaxOverride < v.priceMinOverride) {
    ctx.addIssue({ code: 'custom', path: ['priceMaxOverride'], message: 'Maximum price must be at least the minimum price' });
  }
});
export const projectUpdateSchema = projectBaseSchema.partial();
export type ProjectInput = z.input<typeof projectBaseSchema>;

export const projectStatusChangeSchema = z.object({
  status: z.enum(['DRAFT', 'UPCOMING', 'PRE_LAUNCH', 'BOOKING_OPEN', 'CLOSING_SOON', 'SOLD_OUT', 'CLOSED', 'COMPLETED', 'ARCHIVED']),
  reason: z.string().trim().max(500).optional(),
});

export const projectReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(1000).optional(),
});

export const projectMediaSchema = z.object({
  type: z.enum(MEDIA_TYPES),
  url: urlOrPath,
  storageKey: z.string().max(500).optional().nullable(),
  caption: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
});

export const projectDocumentSchema = z.object({
  docType: z.enum(PROPERTY_DOCUMENT_TYPES),
  title: z.string().trim().min(2).max(160),
  fileId: z.uuid(),
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('PRIVATE'),
});

export const projectNearbySchema = z.object({
  category: z.enum(NEARBY_CATEGORIES),
  name: z.string().trim().min(2).max(160),
  distanceKm: z.coerce.number().min(0).max(500),
  travelMinutes: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

export const projectFaqSchema = z.object({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(2).max(3000),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

export const constructionUpdateSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(3000).optional().nullable(),
  progressPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  updateDate: z.iso.date(),
  imageUrls: z.array(urlOrPath).max(20).optional(),
});

export const projectTeamMemberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(PROJECT_TEAM_ROLES).default('SALES_EXECUTIVE'),
  isPrimaryContact: z.boolean().optional(),
});

export const projectBlockSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(BLOCK_TYPES).default('BLOCK'),
  totalFloors: z.coerce.number().int().min(0).max(200).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

export const projectUnitSchema = z.object({
  blockId: z.uuid().optional().nullable(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(30)
    .regex(/^[A-Z0-9][A-Z0-9\-/ ]*$/, 'Use letters, numbers, hyphens or slashes'),
  unitType: z.enum(UNIT_TYPES),
  floorNumber: z.coerce.number().int().min(-3).max(200).optional().nullable(),
  configuration: z.string().trim().max(40).optional().nullable(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional().nullable(),
  area: z.coerce.number().positive().max(100_000_000),
  areaUnit: z.enum(AREA_UNITS),
  carpetAreaSqft: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  facing: z.enum(FACINGS).optional().nullable(),
  dimensions: z.string().trim().max(60).optional().nullable(),
  isCorner: z.boolean().optional(),
  basePrice: money,
  additionalCharges: money.optional(),
  status: z.enum(UNIT_STATUSES).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});
export const projectUnitUpdateSchema = projectUnitSchema.partial().omit({ status: true });

export const unitBulkCreateSchema = z.object({
  blockId: z.uuid().optional().nullable(),
  prefix: z.string().trim().toUpperCase().max(10).regex(/^[A-Z0-9-]*$/),
  startNumber: z.coerce.number().int().min(0).max(100000),
  count: z.coerce.number().int().min(1).max(500),
  unitType: z.enum(UNIT_TYPES),
  floorNumber: z.coerce.number().int().min(-3).max(200).optional().nullable(),
  configuration: z.string().trim().max(40).optional().nullable(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional().nullable(),
  area: z.coerce.number().positive().max(100_000_000),
  areaUnit: z.enum(AREA_UNITS),
  basePrice: money,
  additionalCharges: money.optional(),
  status: z.enum(['NOT_RELEASED', 'AVAILABLE']).default('AVAILABLE'),
});

export const unitStatusChangeSchema = z.object({
  status: z.enum(UNIT_STATUSES),
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

export const unitReserveSchema = z.object({
  leadId: z.uuid().optional().nullable(),
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(48),
  notes: z.string().trim().max(500).optional(),
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

export const projectSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  locality: z.string().trim().max(80).optional(),
  projectType: z.enum(PROJECT_TYPES).optional(),
  status: z.enum(['UPCOMING', 'PRE_LAUNCH', 'BOOKING_OPEN', 'CLOSING_SOON', 'SOLD_OUT', 'CLOSED', 'COMPLETED']).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  developer: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});
export type ProjectSearchQuery = z.output<typeof projectSearchSchema>;
