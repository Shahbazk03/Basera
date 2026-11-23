/**
 * Enum values shared by the API and every frontend.
 * They mirror the Prisma enums in apps/api/prisma/schema.prisma — a unit test in the API
 * (enum-parity.spec.ts) fails if the two drift apart.
 */

export const ACCOUNT_TYPES = ['CUSTOMER', 'STAFF', 'BROKER', 'DEVELOPER', 'LEAD_PROVIDER', 'OWNER'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const USER_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ORGANIZATION_TYPES = [
  'PLATFORM',
  'BROKERAGE',
  'DEVELOPER',
  'LEAD_PROVIDER',
  'INDIVIDUAL_OWNER',
  'PARTNER',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const VERIFICATION_STATUSES = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ORG_DOCUMENT_TYPES = [
  'IDENTITY_PROOF',
  'ADDRESS_PROOF',
  'PAN_CARD',
  'GST_CERTIFICATE',
  'RERA_CERTIFICATE',
  'INCORPORATION_CERTIFICATE',
  'TRADE_LICENSE',
  'OTHER',
] as const;
export type OrgDocumentType = (typeof ORG_DOCUMENT_TYPES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PROPERTY_SEGMENTS = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'AGRICULTURAL'] as const;
export type PropertySegment = (typeof PROPERTY_SEGMENTS)[number];

export const FORM_PROFILE_KEYS = [
  'PLOT',
  'APARTMENT',
  'HOUSE',
  'COMMERCIAL_UNIT',
  'COMMERCIAL_BUILDING',
  'INDUSTRIAL',
  'AGRICULTURAL',
] as const;
export type FormProfileKey = (typeof FORM_PROFILE_KEYS)[number];

export const LISTING_TYPES = ['SALE', 'RENT'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_SOURCES = ['COMPANY', 'BROKER', 'DEVELOPER', 'OWNER'] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

export const PROPERTY_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'SOLD',
  'RENTED',
  'EXPIRED',
  'ARCHIVED',
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const AVAILABILITIES = ['AVAILABLE', 'ON_HOLD', 'UNDER_OFFER'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const AREA_UNITS = ['SQFT', 'SQYD', 'SQM', 'ACRE', 'HECTARE'] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

export const FURNISHINGS = ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'] as const;
export type Furnishing = (typeof FURNISHINGS)[number];

export const FACINGS = [
  'NORTH',
  'SOUTH',
  'EAST',
  'WEST',
  'NORTH_EAST',
  'NORTH_WEST',
  'SOUTH_EAST',
  'SOUTH_WEST',
] as const;
export type Facing = (typeof FACINGS)[number];

export const POSSESSION_STATUSES = ['READY_TO_MOVE', 'UNDER_CONSTRUCTION'] as const;
export type PossessionStatus = (typeof POSSESSION_STATUSES)[number];

export const OWNERSHIP_TYPES = ['FREEHOLD', 'LEASEHOLD', 'POWER_OF_ATTORNEY', 'COOPERATIVE_SOCIETY'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const MEDIA_TYPES = ['IMAGE', 'VIDEO', 'FLOOR_PLAN', 'MASTER_PLAN'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const DOCUMENT_VISIBILITIES = ['PRIVATE', 'PUBLIC', 'ON_REQUEST'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const PROPERTY_DOCUMENT_TYPES = [
  'TITLE_DEED',
  'SALE_DEED',
  'APPROVED_MAP',
  'ENCUMBRANCE_CERTIFICATE',
  'TAX_RECEIPT',
  'NOC',
  'RERA_CERTIFICATE',
  'BROCHURE',
  'PRICE_LIST',
  'LEGAL_OPINION',
  'OTHER',
] as const;
export type PropertyDocumentType = (typeof PROPERTY_DOCUMENT_TYPES)[number];

export const REPORT_REASONS = [
  'FAKE_LISTING',
  'INCORRECT_PRICE',
  'ALREADY_SOLD',
  'WRONG_LOCATION',
  'DUPLICATE',
  'FRAUD',
  'INAPPROPRIATE',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const PROJECT_STATUSES = [
  'DRAFT',
  'UPCOMING',
  'PRE_LAUNCH',
  'BOOKING_OPEN',
  'CLOSING_SOON',
  'SOLD_OUT',
  'CLOSED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const REVIEW_STATUSES = ['NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PROJECT_TYPES = [
  'RESIDENTIAL_PLOTS',
  'APARTMENTS',
  'VILLAS',
  'INDEPENDENT_HOUSES',
  'COMMERCIAL',
  'MIXED_USE',
  'TOWNSHIP',
  'INDUSTRIAL',
  'FARMHOUSES',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const BLOCK_TYPES = ['TOWER', 'BLOCK', 'PHASE', 'SECTOR', 'WING'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const UNIT_TYPES = ['PLOT', 'FLAT', 'VILLA', 'HOUSE', 'SHOP', 'OFFICE', 'SHOWROOM', 'WAREHOUSE', 'OTHER'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_STATUSES = ['NOT_RELEASED', 'AVAILABLE', 'ON_HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'BLOCKED'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const RESERVATION_STATUSES = ['ACTIVE', 'RELEASED', 'CONVERTED', 'EXPIRED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const NEARBY_CATEGORIES = [
  'SCHOOL',
  'COLLEGE',
  'HOSPITAL',
  'METRO',
  'RAILWAY',
  'AIRPORT',
  'BUS_STAND',
  'MALL',
  'MARKET',
  'HIGHWAY',
  'OFFICE_HUB',
  'PARK',
  'RELIGIOUS',
  'OTHER',
] as const;
export type NearbyCategory = (typeof NEARBY_CATEGORIES)[number];

export const PROJECT_TEAM_ROLES = ['SALES_LEAD', 'SALES_EXECUTIVE', 'RELATIONSHIP_MANAGER', 'SUPPORT'] as const;
export type ProjectTeamRole = (typeof PROJECT_TEAM_ROLES)[number];

export const DOMAIN_TYPES = ['SUBDOMAIN', 'CUSTOM'] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];

export const DOMAIN_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'DISABLED', 'FAILED'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const SSL_STATUSES = ['NOT_REQUESTED', 'PENDING', 'ACTIVE', 'FAILED', 'MANAGED_EXTERNALLY'] as const;
export type SslStatus = (typeof SSL_STATUSES)[number];

export const ENQUIRY_TYPES = [
  'GENERAL',
  'CALLBACK',
  'SITE_VISIT',
  'UNIT_ENQUIRY',
  'PRICE_REQUEST',
  'BROKER_CONTACT',
  'WHATSAPP',
  'DOCUMENT_REQUEST',
] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];

export const ENQUIRY_STATUSES = ['NEW', 'PROCESSED', 'SPAM', 'CLOSED'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const LEAD_STATUSES = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'NOT_REACHABLE',
  'INTERESTED',
  'SITE_VISIT_SCHEDULED',
  'SITE_VISIT_COMPLETED',
  'NEGOTIATION',
  'BOOKING_PENDING',
  'CONVERTED',
  'LOST',
  'FOLLOW_UP',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'HOT'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_INTAKE_STATUSES = ['ACCEPTED', 'REJECTED', 'DUPLICATE', 'PENDING_REVIEW'] as const;
export type LeadIntakeStatus = (typeof LEAD_INTAKE_STATUSES)[number];

export const ASSIGNMENT_METHODS = ['MANUAL', 'ROUND_ROBIN', 'LOCATION', 'PROJECT', 'WORKLOAD', 'TEAM'] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];

export const ASSIGNMENT_STRATEGIES = ['ROUND_ROBIN', 'WORKLOAD'] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export const ACTIVITY_TYPES = [
  'CALL',
  'EMAIL',
  'WHATSAPP',
  'SMS',
  'NOTE',
  'MEETING',
  'SITE_VISIT',
  'STATUS_CHANGE',
  'ASSIGNMENT',
  'FOLLOW_UP',
  'ENQUIRY',
  'CUSTOMER_RESPONSE',
  'SYSTEM',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Activity types a user may log manually (the rest are written by the system). */
export const MANUAL_ACTIVITY_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'SMS', 'NOTE', 'MEETING', 'CUSTOMER_RESPONSE'] as const;
export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number];

export const ACTIVITY_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number];

export const FOLLOW_UP_TYPES = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'SITE_VISIT', 'OTHER'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_STATUSES = ['PENDING', 'COMPLETED', 'MISSED', 'CANCELLED'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const SITE_VISIT_STATUSES = ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type SiteVisitStatus = (typeof SITE_VISIT_STATUSES)[number];

export const DEAL_TYPES = ['SALE', 'RENT', 'LEASE'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_STATUSES = ['OPEN', 'BOOKED', 'AGREEMENT_SIGNED', 'CLOSED_WON', 'CANCELLED'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const PAYMENT_RECEIVERS = ['COMPANY', 'DEVELOPER', 'OWNER', 'OTHER'] as const;
export type PaymentReceiver = (typeof PAYMENT_RECEIVERS)[number];

export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const LEAD_PROVIDER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type LeadProviderStatus = (typeof LEAD_PROVIDER_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_STATUSES = ['PROBATION', 'ACTIVE', 'ON_NOTICE', 'EXITED', 'SUSPENDED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYEE_DOCUMENT_TYPES = [
  'ID_PROOF',
  'ADDRESS_PROOF',
  'PAN_CARD',
  'OFFER_LETTER',
  'CONTRACT',
  'EDUCATION',
  'EXPERIENCE',
  'OTHER',
] as const;
export type EmployeeDocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number];

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_SOURCES = ['WEB', 'MANUAL', 'CORRECTION', 'SYSTEM'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const SALARY_COMPONENT_TYPES = ['EARNING', 'DEDUCTION'] as const;
export type SalaryComponentType = (typeof SALARY_COMPONENT_TYPES)[number];

export const SALARY_CALC_TYPES = ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS'] as const;
export type SalaryCalcType = (typeof SALARY_CALC_TYPES)[number];

export const PAYROLL_STATUSES = ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYSLIP_STATUSES = ['DRAFT', 'APPROVED', 'PAID'] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYROLL_ADJUSTMENT_TYPES = ['INCENTIVE', 'BONUS', 'DEDUCTION', 'ARREARS', 'REIMBURSEMENT'] as const;
export type PayrollAdjustmentType = (typeof PAYROLL_ADJUSTMENT_TYPES)[number];

export const ADJUSTMENT_STATUSES = ['PENDING', 'APPLIED', 'CANCELLED'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const COMMISSION_RECIPIENT_TYPES = [
  'COMPANY',
  'BROKER',
  'SALES_EMPLOYEE',
  'SALES_MANAGER',
  'LEAD_PROVIDER',
  'PARTNER',
] as const;
export type CommissionRecipientType = (typeof COMMISSION_RECIPIENT_TYPES)[number];

export const COMMISSION_CALC_TYPES = ['FIXED', 'PERCENTAGE'] as const;
export type CommissionCalcType = (typeof COMMISSION_CALC_TYPES)[number];

export const COMMISSION_BASES = ['DEAL_VALUE', 'COMPANY_REVENUE'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const COMMISSION_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'PAYABLE', 'PAID', 'CANCELLED'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const PAYOUT_STATUSES = ['PENDING', 'PAID', 'CANCELLED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const TRANSACTION_DIRECTIONS = ['INFLOW', 'OUTFLOW'] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const TRANSACTION_TYPES = [
  'CUSTOMER_PAYMENT',
  'INVOICE_RECEIPT',
  'COMMISSION_PAYOUT',
  'SALARY_PAYMENT',
  'EXPENSE_PAYMENT',
  'REIMBURSEMENT_PAYMENT',
  'REFUND',
  'OTHER',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EXPENSE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const REIMBURSEMENT_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

export const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DELIVERY_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED', 'SKIPPED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_PERIODS = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/** Converts an enum constant such as `SITE_VISIT_SCHEDULED` into "Site visit scheduled". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '';
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Labels that read better than the generic humanised form. */
export const ENUM_LABELS: Record<string, string> = {
  SQFT: 'sq.ft',
  SQYD: 'sq.yd',
  SQM: 'sq.m',
  ACRE: 'acre',
  HECTARE: 'hectare',
  SALE: 'Buy',
  RENT: 'Rent',
  NORTH_EAST: 'North-East',
  NORTH_WEST: 'North-West',
  SOUTH_EAST: 'South-East',
  SOUTH_WEST: 'South-West',
  BOOKING_OPEN: 'Booking open',
  PRE_LAUNCH: 'Pre-launch',
  NOT_RELEASED: 'Not released',
  HOT: 'Hot',
  PERCENT_OF_BASIC: '% of Basic',
  PERCENT_OF_GROSS: '% of Gross',
  NOC: 'NOC',
  RERA_CERTIFICATE: 'RERA certificate',
  GST_CERTIFICATE: 'GST certificate',
  PAN_CARD: 'PAN card',
  UPI: 'UPI',
};

export function enumLabel(value: string | null | undefined): string {
  if (!value) return '';
  return ENUM_LABELS[value] ?? humanizeEnum(value);
}
