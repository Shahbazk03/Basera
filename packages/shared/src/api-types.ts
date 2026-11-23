/**
 * Response contracts of the /api/v1 REST API. The API maps database rows into these shapes
 * explicitly (database models are never returned unfiltered).
 */
import type {
  AccountType,
  AreaUnit,
  DocumentVisibility,
  Facing,
  Furnishing,
  ListingSource,
  ListingType,
  MediaType,
  OrganizationStatus,
  OrganizationType,
  OwnershipType,
  PossessionStatus,
  ProjectStatus,
  ProjectType,
  PropertySegment,
  PropertyStatus,
  ReviewStatus,
  UnitStatus,
  UnitType,
  VerificationStatus,
  NearbyCategory,
  Availability,
} from './enums';
import type { PermissionGrants } from './permissions';
import type { PageSection } from './page-builder';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  details?: { path: string; message: string }[];
  requestId?: string;
}

// ───────────────────────── Auth ─────────────────────────

export type WorkspaceKey = 'admin' | 'broker' | 'developer' | 'staff' | 'lead-provider' | 'owner';

export interface SessionMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationType: OrganizationType;
  organizationStatus: OrganizationStatus;
  verificationStatus: VerificationStatus;
  isOwner: boolean;
  title: string | null;
}

export interface SessionUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  accountType: AccountType;
  emailVerified: boolean;
  phoneVerified: boolean;
  memberships: SessionMembership[];
  roles: { key: string; name: string; organizationId: string | null }[];
  permissions: PermissionGrants;
  employeeId: string | null;
  platformOrganizationId: string | null;
  workspaces: WorkspaceKey[];
  /** An administrator set a temporary password: the user must choose their own before doing anything else. */
  mustChangePassword: boolean;
}

// ───────────────────────── Shared refs ─────────────────────────

export interface LocationRef {
  id: string;
  name: string;
  slug: string;
}

export interface OrganizationRef {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  logoUrl: string | null;
  isVerified: boolean;
}

// ───────────────────────── Properties ─────────────────────────

export interface PropertyCard {
  id: string;
  slug: string;
  referenceCode: string;
  title: string;
  listingType: ListingType;
  segment: PropertySegment;
  propertyType: { id: string; name: string; slug: string };
  price: number;
  pricePerSqft: number | null;
  priceNegotiable: boolean;
  area: number;
  areaUnit: AreaUnit;
  areaSqft: number;
  bedrooms: number | null;
  bathrooms: number | null;
  furnishing: Furnishing | null;
  possessionStatus: PossessionStatus | null;
  city: LocationRef;
  locality: LocationRef;
  coverImageUrl: string | null;
  imageCount: number;
  isVerified: boolean;
  isFeatured: boolean;
  sourceType: ListingSource;
  organization: OrganizationRef;
  project: { id: string; name: string; slug: string } | null;
  publishedAt: string | null;
  isDemo: boolean;
  distanceKm?: number | null;
}

export interface PropertyDetail extends PropertyCard {
  description: string;
  status: PropertyStatus;
  availability: Availability;
  addressLine: string | null;
  landmark: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  locationIsApproximate: boolean;
  state: LocationRef;
  media: { id: string; type: MediaType; url: string; caption: string | null }[];
  amenities: { id: string; name: string; icon: string | null; category: string }[];
  highlights: string[];
  attributes: Record<string, string | number | boolean>;
  formProfile: string;
  maintenanceMonthly: number | null;
  securityDeposit: number | null;
  bookingAmount: number | null;
  balconies: number | null;
  floorNumber: number | null;
  totalFloors: number | null;
  facing: Facing | null;
  availableFrom: string | null;
  ageYears: number | null;
  plotLengthFt: number | null;
  plotWidthFt: number | null;
  roadWidthFt: number | null;
  isCornerPlot: boolean | null;
  ownershipType: OwnershipType | null;
  approvalAuthority: string | null;
  reraNumber: string | null;
  coveredParking: number | null;
  openParking: number | null;
  carpetAreaSqft: number | null;
  builtUpAreaSqft: number | null;
  superAreaSqft: number | null;
  plotAreaSqft: number | null;
  documents: { id: string; title: string; docType: string; visibility: DocumentVisibility }[];
  lister: {
    name: string;
    type: OrganizationType;
    logoUrl: string | null;
    verificationStatus: VerificationStatus;
    memberSince: string;
    activeListings: number;
    broker: { displayName: string; reraAgentNumber: string | null; experienceYears: number | null } | null;
  };
  whatsappAvailable: boolean;
  updatedAt: string;
}

export interface PropertySearchFacets {
  localities: { slug: string; name: string; count: number }[];
  propertyTypes: { slug: string; name: string; count: number }[];
  priceRange: { min: number | null; max: number | null };
}

export interface PropertySearchResult extends Paginated<PropertyCard> {
  facets: PropertySearchFacets;
  appliedCity: LocationRef | null;
}

// ───────────────────────── Projects ─────────────────────────

export interface ProjectCard {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  projectType: ProjectType;
  status: ProjectStatus;
  city: LocationRef;
  locality: LocationRef;
  developer: OrganizationRef | null;
  heroImageUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  unitTypes: string[];
  availableUnits: number;
  totalUnits: number;
  reraNumber: string | null;
  possessionDate: string | null;
  bookingOpensAt: string | null;
  bookingClosesAt: string | null;
  isFeatured: boolean;
  isDemo: boolean;
}

export interface PublicUnit {
  id: string;
  code: string;
  block: string | null;
  unitType: UnitType;
  floorNumber: number | null;
  configuration: string | null;
  bedrooms: number | null;
  area: number;
  areaUnit: AreaUnit;
  areaSqft: number;
  facing: Facing | null;
  dimensions: string | null;
  isCorner: boolean;
  totalPrice: number | null;
  status: UnitStatus;
}

export interface ProjectDetail extends ProjectCard {
  description: string;
  addressLine: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  state: LocationRef;
  logoUrl: string | null;
  masterPlanUrl: string | null;
  videoUrls: string[];
  totalAreaAcres: number | null;
  totalUnitsPlanned: number | null;
  launchDate: string | null;
  reraValidUntil: string | null;
  approvalDetails: string | null;
  legalInformation: string | null;
  serverTime: string;
  media: { id: string; type: MediaType; url: string; caption: string | null }[];
  amenities: { id: string; name: string; icon: string | null; category: string }[];
  nearbyPlaces: { id: string; category: NearbyCategory; name: string; distanceKm: number; travelMinutes: number | null }[];
  faqs: { id: string; question: string; answer: string }[];
  constructionUpdates: { id: string; title: string; description: string | null; progressPercent: number | null; updateDate: string; imageUrls: string[] }[];
  documents: { id: string; title: string; docType: string; visibility: DocumentVisibility }[];
  blocks: { id: string; name: string; type: string }[];
  units: PublicUnit[];
  developerProfile: {
    name: string;
    logoUrl: string | null;
    description: string | null;
    website: string | null;
    establishedYear: number | null;
    projectsDelivered: number | null;
    isVerified: boolean;
  } | null;
  sections: PageSection[];
  primaryDomain: string | null;
  canonicalUrl: string;
  whatsappAvailable: boolean;
  isBookable: boolean;
  seo: { title: string; description: string; ogImageUrl: string | null };
  isPreview: boolean;
}

// ───────────────────────── Misc ─────────────────────────

export interface PublicSettings {
  brand: { name: string; tagline: string; logoUrl: string | null; primaryColor: string };
  contact: { phone: string; whatsapp: string; email: string; address: string; hours: string };
  company: { legalName: string; reraAgentNumber: string };
  social: { label: string; url: string }[];
  marketplace: { defaultCitySlug: string };
  seo: { defaultTitle: string; defaultDescription: string; robotsAllowIndexing: boolean };
  environment: string;
  integrations: { maps: 'google' | 'osm'; captcha: boolean };
}

export interface EnquiryReceipt {
  referenceNo: string;
  message: string;
  whatsappUrl: string | null;
}

export interface ProjectCardWithReview extends ProjectCard {
  reviewStatus: ReviewStatus;
  isPublished: boolean;
}
