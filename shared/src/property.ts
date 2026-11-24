import { z } from 'zod';
import {
  AREA_UNITS,
  AreaUnit,
  FACINGS,
  FormProfileKey,
  FURNISHINGS,
  LISTING_SOURCES,
  LISTING_TYPES,
  MEDIA_TYPES,
  OWNERSHIP_TYPES,
  POSSESSION_STATUSES,
  PROPERTY_SEGMENTS,
  PropertyStatus,
  REPORT_REASONS,
} from './enums';
import type { PermissionKey } from './permissions';
import { queryBoolean } from './query';

// ───────────────────────── Area units ─────────────────────────

/** Square feet per unit. Only internationally fixed units are supported (bigha/biswa vary by district). */
export const AREA_UNIT_TO_SQFT: Record<AreaUnit, number> = {
  SQFT: 1,
  SQYD: 9,
  SQM: 10.763910417,
  ACRE: 43560,
  HECTARE: 107639.10417,
};

export function toSqft(area: number, unit: AreaUnit): number {
  return Math.round(area * AREA_UNIT_TO_SQFT[unit] * 100) / 100;
}

export function fromSqft(sqft: number, unit: AreaUnit): number {
  return Math.round((sqft / AREA_UNIT_TO_SQFT[unit]) * 100) / 100;
}

// ───────────────────────── Category form profiles ─────────────────────────

/** Core columns that are category-specific. Anything not listed for a profile must be empty. */
export const PROFILE_FIELDS = [
  'bedrooms',
  'bathrooms',
  'balconies',
  'furnishing',
  'floorNumber',
  'totalFloors',
  'facing',
  'possessionStatus',
  'availableFrom',
  'ageYears',
  'plotLengthFt',
  'plotWidthFt',
  'roadWidthFt',
  'isCornerPlot',
  'ownershipType',
  'approvalAuthority',
  'reraNumber',
  'coveredParking',
  'openParking',
  'carpetAreaSqft',
  'builtUpAreaSqft',
  'superAreaSqft',
  'plotAreaSqft',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type AttributeDefinition =
  | { key: string; label: string; kind: 'text'; maxLength?: number; required?: boolean }
  | { key: string; label: string; kind: 'number'; min?: number; max?: number; unit?: string; required?: boolean }
  | { key: string; label: string; kind: 'boolean'; required?: boolean }
  | { key: string; label: string; kind: 'select'; options: readonly string[]; required?: boolean };

export interface FormProfileDefinition {
  key: FormProfileKey;
  label: string;
  description: string;
  /** Applicable core fields */
  fields: readonly ProfileField[];
  /** Core fields that must be provided */
  required: readonly ProfileField[];
  /** Extra attributes stored in `attributes` JSON */
  attributes: readonly AttributeDefinition[];
}

export const FORM_PROFILES: Record<FormProfileKey, FormProfileDefinition> = {
  PLOT: {
    key: 'PLOT',
    label: 'Plot / land parcel',
    description: 'Residential, commercial or industrial plots sold as land.',
    fields: [
      'facing',
      'plotLengthFt',
      'plotWidthFt',
      'roadWidthFt',
      'isCornerPlot',
      'ownershipType',
      'approvalAuthority',
      'reraNumber',
      'possessionStatus',
      'plotAreaSqft',
    ],
    required: ['ownershipType'],
    attributes: [
      { key: 'boundaryWall', label: 'Boundary wall', kind: 'boolean' },
      { key: 'gatedSociety', label: 'In a gated society', kind: 'boolean' },
      { key: 'openSides', label: 'Open sides', kind: 'number', min: 1, max: 4 },
      { key: 'constructionAllowedFloors', label: 'Floors allowed for construction', kind: 'number', min: 0, max: 100 },
    ],
  },
  APARTMENT: {
    key: 'APARTMENT',
    label: 'Apartment / flat',
    description: 'Units in a multi-storey building.',
    fields: [
      'bedrooms',
      'bathrooms',
      'balconies',
      'furnishing',
      'floorNumber',
      'totalFloors',
      'facing',
      'possessionStatus',
      'availableFrom',
      'ageYears',
      'ownershipType',
      'reraNumber',
      'coveredParking',
      'openParking',
      'carpetAreaSqft',
      'builtUpAreaSqft',
      'superAreaSqft',
    ],
    required: ['bedrooms', 'bathrooms', 'furnishing', 'floorNumber', 'totalFloors', 'possessionStatus'],
    attributes: [
      { key: 'liftAvailable', label: 'Lift available', kind: 'boolean' },
      { key: 'powerBackup', label: 'Power backup', kind: 'select', options: ['None', 'Partial', 'Full'] },
      { key: 'waterSupply', label: 'Water supply', kind: 'select', options: ['Municipal', 'Borewell', 'Both'] },
      { key: 'societyName', label: 'Society / building name', kind: 'text', maxLength: 120 },
    ],
  },
  HOUSE: {
    key: 'HOUSE',
    label: 'Independent house / villa',
    description: 'Independent houses, villas, row houses and farmhouses.',
    fields: [
      'bedrooms',
      'bathrooms',
      'balconies',
      'furnishing',
      'totalFloors',
      'facing',
      'possessionStatus',
      'availableFrom',
      'ageYears',
      'roadWidthFt',
      'isCornerPlot',
      'ownershipType',
      'approvalAuthority',
      'reraNumber',
      'coveredParking',
      'openParking',
      'builtUpAreaSqft',
      'plotAreaSqft',
    ],
    required: ['bedrooms', 'bathrooms', 'furnishing', 'totalFloors', 'possessionStatus'],
    attributes: [
      { key: 'servantRoom', label: 'Servant room', kind: 'boolean' },
      { key: 'gardenOrLawn', label: 'Garden / lawn', kind: 'boolean' },
      { key: 'gatedSociety', label: 'In a gated society', kind: 'boolean' },
      { key: 'powerBackup', label: 'Power backup', kind: 'select', options: ['None', 'Partial', 'Full'] },
    ],
  },
  COMMERCIAL_UNIT: {
    key: 'COMMERCIAL_UNIT',
    label: 'Shop / office / showroom',
    description: 'A unit inside a commercial or mixed-use building.',
    fields: [
      'furnishing',
      'floorNumber',
      'totalFloors',
      'facing',
      'possessionStatus',
      'availableFrom',
      'ageYears',
      'ownershipType',
      'reraNumber',
      'coveredParking',
      'carpetAreaSqft',
      'superAreaSqft',
    ],
    required: ['floorNumber', 'possessionStatus'],
    attributes: [
      { key: 'washrooms', label: 'Washrooms', kind: 'number', min: 0, max: 50 },
      { key: 'pantry', label: 'Pantry', kind: 'boolean' },
      { key: 'frontageFt', label: 'Frontage', kind: 'number', min: 0, max: 1000, unit: 'ft' },
      { key: 'mainRoadFacing', label: 'Main-road facing', kind: 'boolean' },
      { key: 'suitableFor', label: 'Suitable for', kind: 'text', maxLength: 160 },
    ],
  },
  COMMERCIAL_BUILDING: {
    key: 'COMMERCIAL_BUILDING',
    label: 'Commercial building',
    description: 'An entire commercial building or complex.',
    fields: [
      'totalFloors',
      'facing',
      'possessionStatus',
      'ageYears',
      'roadWidthFt',
      'ownershipType',
      'approvalAuthority',
      'reraNumber',
      'coveredParking',
      'openParking',
      'builtUpAreaSqft',
      'plotAreaSqft',
    ],
    required: ['totalFloors', 'possessionStatus'],
    attributes: [
      { key: 'lifts', label: 'Lifts', kind: 'number', min: 0, max: 100 },
      { key: 'fireNoc', label: 'Fire NOC obtained', kind: 'boolean' },
      { key: 'occupancyCertificate', label: 'Occupancy certificate', kind: 'boolean' },
    ],
  },
  INDUSTRIAL: {
    key: 'INDUSTRIAL',
    label: 'Industrial',
    description: 'Warehouses, factories and industrial land.',
    fields: [
      'possessionStatus',
      'availableFrom',
      'ageYears',
      'roadWidthFt',
      'ownershipType',
      'approvalAuthority',
      'builtUpAreaSqft',
      'plotAreaSqft',
    ],
    required: ['ownershipType'],
    attributes: [
      { key: 'powerLoadKva', label: 'Sanctioned power load', kind: 'number', min: 0, max: 100000, unit: 'kVA' },
      { key: 'clearHeightFt', label: 'Clear height', kind: 'number', min: 0, max: 200, unit: 'ft' },
      { key: 'loadingDocks', label: 'Loading docks', kind: 'number', min: 0, max: 200 },
      { key: 'industrialArea', label: 'Industrial area / estate', kind: 'text', maxLength: 160 },
      { key: 'zoning', label: 'Zoning / land use', kind: 'text', maxLength: 120 },
    ],
  },
  AGRICULTURAL: {
    key: 'AGRICULTURAL',
    label: 'Agricultural land',
    description: 'Agricultural land and farm plots.',
    fields: ['roadWidthFt', 'ownershipType', 'plotAreaSqft'],
    required: ['ownershipType'],
    attributes: [
      { key: 'soilType', label: 'Soil type', kind: 'select', options: ['Alluvial', 'Loamy', 'Clay', 'Sandy', 'Black', 'Red', 'Other'] },
      { key: 'irrigation', label: 'Irrigation', kind: 'select', options: ['Rain-fed', 'Canal', 'Tube well', 'Borewell', 'Multiple'] },
      { key: 'electricityConnection', label: 'Electricity connection', kind: 'boolean' },
      { key: 'roadAccess', label: 'Road access', kind: 'select', options: ['Paved', 'Unpaved', 'None'] },
      { key: 'khasraNumber', label: 'Khasra / survey number', kind: 'text', maxLength: 80 },
    ],
  },
};

export function profileAllowsField(profile: FormProfileKey, field: ProfileField): boolean {
  return FORM_PROFILES[profile].fields.includes(field);
}

// ───────────────────────── Property lifecycle ─────────────────────────

export type PropertyActor = 'LISTER' | 'REVIEWER' | 'SYSTEM';

export interface PropertyTransition {
  from: PropertyStatus;
  to: PropertyStatus;
  action: string;
  /** Who may trigger it. LISTER = has property.edit on the listing's organisation. */
  actors: PropertyActor[];
  requiresReason?: boolean;
  /** Restrict to a listing type (SOLD only for SALE etc.) */
  listingType?: 'SALE' | 'RENT';
}

export const PROPERTY_TRANSITIONS: PropertyTransition[] = [
  { from: 'DRAFT', to: 'PENDING_REVIEW', action: 'submit', actors: ['LISTER', 'REVIEWER'] },
  { from: 'DRAFT', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'PENDING_REVIEW', to: 'DRAFT', action: 'withdraw', actors: ['LISTER', 'REVIEWER'] },
  { from: 'PENDING_REVIEW', to: 'APPROVED', action: 'approve', actors: ['REVIEWER'] },
  { from: 'PENDING_REVIEW', to: 'REJECTED', action: 'reject', actors: ['REVIEWER'], requiresReason: true },
  { from: 'APPROVED', to: 'PUBLISHED', action: 'publish', actors: ['LISTER', 'REVIEWER'] },
  { from: 'APPROVED', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'REJECTED', to: 'DRAFT', action: 'revise', actors: ['LISTER', 'REVIEWER'] },
  { from: 'REJECTED', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'PUBLISHED', to: 'SOLD', action: 'mark_sold', actors: ['LISTER', 'REVIEWER'], listingType: 'SALE' },
  { from: 'PUBLISHED', to: 'RENTED', action: 'mark_rented', actors: ['LISTER', 'REVIEWER'], listingType: 'RENT' },
  { from: 'PUBLISHED', to: 'EXPIRED', action: 'expire', actors: ['SYSTEM', 'REVIEWER'] },
  { from: 'PUBLISHED', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'PUBLISHED', to: 'PENDING_REVIEW', action: 'resubmit', actors: ['LISTER', 'REVIEWER', 'SYSTEM'] },
  { from: 'EXPIRED', to: 'PENDING_REVIEW', action: 'renew', actors: ['LISTER', 'REVIEWER'] },
  { from: 'EXPIRED', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'SOLD', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'RENTED', to: 'DRAFT', action: 'relist', actors: ['LISTER', 'REVIEWER'] },
  { from: 'RENTED', to: 'ARCHIVED', action: 'archive', actors: ['LISTER', 'REVIEWER'] },
  { from: 'ARCHIVED', to: 'DRAFT', action: 'restore', actors: ['LISTER', 'REVIEWER'] },
];

export const PROPERTY_ACTIONS = [...new Set(PROPERTY_TRANSITIONS.map((t) => t.action))] as const;

export function findPropertyTransition(
  from: PropertyStatus,
  action: string,
  listingType: 'SALE' | 'RENT',
): PropertyTransition | undefined {
  return PROPERTY_TRANSITIONS.find(
    (t) => t.from === from && t.action === action && (!t.listingType || t.listingType === listingType),
  );
}

export function availablePropertyActions(
  from: PropertyStatus,
  listingType: 'SALE' | 'RENT',
  actor: PropertyActor | PropertyActor[],
): PropertyTransition[] {
  const actors = Array.isArray(actor) ? actor : [actor];
  return PROPERTY_TRANSITIONS.filter(
    (t) =>
      t.from === from &&
      (!t.listingType || t.listingType === listingType) &&
      t.actors.some((a) => actors.includes(a)),
  );
}

/** Statuses that are publicly visible inventory. */
export const PUBLIC_PROPERTY_STATUSES: PropertyStatus[] = ['PUBLISHED'];
/** Statuses where non-reviewer edits are allowed without forcing re-review. */
export const EDITABLE_PROPERTY_STATUSES: PropertyStatus[] = ['DRAFT', 'REJECTED', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'EXPIRED'];

export const PROPERTY_ACTION_PERMISSION: Record<PropertyActor, PermissionKey | null> = {
  LISTER: 'property.edit',
  REVIEWER: 'property.approve',
  SYSTEM: null,
};

// ───────────────────────── Validation schemas ─────────────────────────

const money = z.coerce.number().min(0).max(999_999_999_999);
const optionalInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional().nullable();
const optionalDecimal = (min: number, max: number) => z.coerce.number().min(min).max(max).optional().nullable();

/** Category-specific extras. Optional attributes left empty (null / undefined / '') are accepted and dropped, never stored. */
export const propertyAttributesSchema = z
  .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()]).nullish())
  .transform((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Record<string, string | number | boolean>);

export const propertyMediaInputSchema = z.object({
  type: z.enum(MEDIA_TYPES).default('IMAGE'),
  url: z.string().min(1).max(2000),
  storageKey: z.string().max(500).optional().nullable(),
  caption: z.string().max(200).optional().nullable(),
  isCover: z.boolean().optional(),
});

export const propertyBaseSchema = z.object({
  title: z.string().trim().min(10, 'Title must be at least 10 characters').max(140),
  description: z.string().trim().min(30, 'Describe the property in at least 30 characters').max(8000),
  propertyTypeId: z.uuid(),
  listingType: z.enum(LISTING_TYPES),
  sourceType: z.enum(LISTING_SOURCES).optional(),
  organizationId: z.uuid().optional(),
  projectId: z.uuid().optional().nullable(),
  ownerName: z.string().trim().max(120).optional().nullable(),
  ownerPhone: z.string().trim().max(20).optional().nullable(),
  ownerEmail: z.email().optional().nullable().or(z.literal('')),
  cityId: z.uuid(),
  localityId: z.uuid(),
  addressLine: z.string().trim().max(300).optional().nullable(),
  landmark: z.string().trim().max(160).optional().nullable(),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code')
    .optional()
    .nullable()
    .or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  hideExactLocation: z.boolean().optional(),
  area: z.coerce.number().positive('Area must be greater than zero').max(1_000_000_000),
  areaUnit: z.enum(AREA_UNITS),
  price: money.refine((v) => v > 0, 'Price must be greater than zero'),
  priceNegotiable: z.boolean().optional(),
  maintenanceMonthly: money.optional().nullable(),
  securityDeposit: money.optional().nullable(),
  bookingAmount: money.optional().nullable(),
  bedrooms: optionalInt(0, 20),
  bathrooms: optionalInt(0, 20),
  balconies: optionalInt(0, 20),
  furnishing: z.enum(FURNISHINGS).optional().nullable(),
  floorNumber: optionalInt(-3, 200),
  totalFloors: optionalInt(1, 200),
  facing: z.enum(FACINGS).optional().nullable(),
  possessionStatus: z.enum(POSSESSION_STATUSES).optional().nullable(),
  availableFrom: z.iso.date().optional().nullable(),
  ageYears: optionalInt(0, 150),
  plotLengthFt: optionalDecimal(0, 100000),
  plotWidthFt: optionalDecimal(0, 100000),
  roadWidthFt: optionalDecimal(0, 1000),
  isCornerPlot: z.boolean().optional().nullable(),
  ownershipType: z.enum(OWNERSHIP_TYPES).optional().nullable(),
  approvalAuthority: z.string().trim().max(120).optional().nullable(),
  reraNumber: z.string().trim().max(60).optional().nullable(),
  coveredParking: optionalInt(0, 100),
  openParking: optionalInt(0, 100),
  carpetAreaSqft: optionalDecimal(0, 100_000_000),
  builtUpAreaSqft: optionalDecimal(0, 100_000_000),
  superAreaSqft: optionalDecimal(0, 100_000_000),
  plotAreaSqft: optionalDecimal(0, 10_000_000_000),
  attributes: propertyAttributesSchema.optional(),
  highlights: z.array(z.string().trim().min(2).max(120)).max(12).optional(),
  amenityIds: z.array(z.uuid()).max(80).optional(),
  media: z.array(propertyMediaInputSchema).max(40).optional(),
});

export type PropertyInput = z.input<typeof propertyBaseSchema>;
export type PropertyPayload = z.output<typeof propertyBaseSchema>;

export const propertyCreateSchema = propertyBaseSchema;
export const propertyUpdateSchema = propertyBaseSchema.partial();

export interface ProfileValidationIssue {
  path: string;
  message: string;
}

/**
 * Category-specific validation: required fields present, non-applicable fields empty, attributes valid.
 * Runs on both client (form feedback) and server (authoritative).
 */
export function validatePropertyForProfile(
  profileKey: FormProfileKey,
  data: Partial<PropertyPayload>,
  listingType: 'SALE' | 'RENT',
): ProfileValidationIssue[] {
  const profile = FORM_PROFILES[profileKey];
  const issues: ProfileValidationIssue[] = [];
  const record = data as Record<string, unknown>;

  for (const field of profile.required) {
    const v = record[field];
    if (v === undefined || v === null || v === '') {
      issues.push({ path: field, message: `${labelForField(field)} is required for ${profile.label.toLowerCase()} listings` });
    }
  }
  for (const field of PROFILE_FIELDS) {
    if (profile.fields.includes(field)) continue;
    const v = record[field];
    if (v !== undefined && v !== null && v !== '') {
      issues.push({ path: field, message: `${labelForField(field)} does not apply to ${profile.label.toLowerCase()} listings` });
    }
  }
  if (record.floorNumber != null && record.totalFloors != null && Number(record.floorNumber) > Number(record.totalFloors)) {
    issues.push({ path: 'floorNumber', message: 'Floor number cannot exceed total floors' });
  }
  if (listingType === 'SALE' && record.securityDeposit != null && record.securityDeposit !== '') {
    issues.push({ path: 'securityDeposit', message: 'Security deposit applies to rental listings only' });
  }

  const attrs = (data.attributes ?? {}) as Record<string, unknown>;
  const known = new Map(profile.attributes.map((a) => [a.key, a]));
  for (const key of Object.keys(attrs)) {
    if (!known.has(key)) issues.push({ path: `attributes.${key}`, message: `Unknown attribute "${key}"` });
  }
  for (const def of profile.attributes) {
    const v = attrs[def.key];
    if (v === undefined || v === null || v === '') {
      if (def.required) issues.push({ path: `attributes.${def.key}`, message: `${def.label} is required` });
      continue;
    }
    if (def.kind === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) issues.push({ path: `attributes.${def.key}`, message: `${def.label} must be a number` });
      else if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max))
        issues.push({ path: `attributes.${def.key}`, message: `${def.label} is out of range` });
    } else if (def.kind === 'boolean' && typeof v !== 'boolean') {
      issues.push({ path: `attributes.${def.key}`, message: `${def.label} must be yes or no` });
    } else if (def.kind === 'select' && !def.options.includes(String(v))) {
      issues.push({ path: `attributes.${def.key}`, message: `${def.label} has an invalid option` });
    } else if (def.kind === 'text' && String(v).length > (def.maxLength ?? 200)) {
      issues.push({ path: `attributes.${def.key}`, message: `${def.label} is too long` });
    }
  }
  return issues;
}

const FIELD_LABELS: Record<ProfileField, string> = {
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  balconies: 'Balconies',
  furnishing: 'Furnishing',
  floorNumber: 'Floor number',
  totalFloors: 'Total floors',
  facing: 'Facing',
  possessionStatus: 'Possession status',
  availableFrom: 'Available from',
  ageYears: 'Age of property',
  plotLengthFt: 'Plot length',
  plotWidthFt: 'Plot width',
  roadWidthFt: 'Road width',
  isCornerPlot: 'Corner plot',
  ownershipType: 'Ownership',
  approvalAuthority: 'Approval authority',
  reraNumber: 'RERA number',
  coveredParking: 'Covered parking',
  openParking: 'Open parking',
  carpetAreaSqft: 'Carpet area',
  builtUpAreaSqft: 'Built-up area',
  superAreaSqft: 'Super area',
  plotAreaSqft: 'Plot area',
};

export function labelForField(field: ProfileField): string {
  return FIELD_LABELS[field];
}

// ───────────────────────── Search ─────────────────────────

export const PROPERTY_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'area_desc'] as const;
export type PropertySort = (typeof PROPERTY_SORTS)[number];

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));

export const propertySearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  city: z.string().trim().max(80).optional(),
  locality: csv,
  segment: z.enum(PROPERTY_SEGMENTS).optional(),
  type: csv,
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minArea: z.coerce.number().min(0).optional(),
  maxArea: z.coerce.number().min(0).optional(),
  bedrooms: csv,
  bathrooms: z.coerce.number().int().min(1).max(20).optional(),
  furnishing: csv,
  amenities: csv,
  possession: z.enum(POSSESSION_STATUSES).optional(),
  verified: queryBoolean,
  source: z.enum(LISTING_SOURCES).optional(),
  projectId: z.uuid().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.5).max(50).optional(),
  sort: z.enum(PROPERTY_SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(20),
});
export type PropertySearchQuery = z.output<typeof propertySearchSchema>;

export const propertyReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
  email: z.email().optional().or(z.literal('')),
});

export const propertyTransitionSchema = z.object({
  action: z.string().min(2).max(40),
  reason: z.string().trim().max(1000).optional(),
});
