import type { PageSection } from '@estate/shared';

export interface ProjectListRow {
  id: string;
  slug: string;
  name: string;
  projectType: string;
  status: string;
  computedStatus: string;
  reviewStatus: string;
  isPublished: boolean;
  isFeatured: boolean;
  isDemo: boolean;
  heroImageUrl: string | null;
  updatedAt: string;
  city: { name: string };
  locality: { name: string };
  organization: { id: string; name: string; type: string; status: string };
  developerOrg: { id: string; name: string } | null;
  units: { available: number; total: number };
}

export interface MediaRow {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'FLOOR_PLAN' | 'MASTER_PLAN';
  url: string;
  caption: string | null;
  sortOrder: number;
}

export interface ManageProject {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  projectType: string;
  organizationId: string;
  developerOrgId: string | null;
  cityId: string;
  localityId: string;
  addressLine: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string;
  heroImageUrl: string | null;
  logoUrl: string | null;
  masterPlanUrl: string | null;
  videoUrls: string[];
  totalAreaAcres: number | null;
  totalUnitsPlanned: number | null;
  launchDate: string | null;
  possessionDate: string | null;
  priceMinOverride: number | null;
  priceMaxOverride: number | null;
  reraNumber: string | null;
  reraValidUntil: string | null;
  approvalDetails: string | null;
  legalInformation: string | null;
  status: string;
  computedStatus: string;
  autoStatus: boolean;
  autoStatusLocksDerived: boolean;
  bookingOpensAt: string | null;
  bookingClosesAt: string | null;
  closingSoonHours: number;
  reviewStatus: string;
  reviewNote: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  isFeatured: boolean;
  isDemo: boolean;
  whatsappNumber: string | null;
  salesPhone: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  city: { id: string; name: string; slug: string };
  locality: { id: string; name: string; slug: string };
  organization: { id: string; name: string; type: string; status: string; projectPublishMode: string };
  developerOrg: { id: string; name: string; slug: string } | null;
  createdBy: { id: string; fullName: string } | null;
  media: MediaRow[];
  documents: { id: string; title: string; docType: string; visibility: string; createdAt: string; file: { id: string; fileName: string; mimeType: string; sizeBytes: number } }[];
  amenityIds: string[];
  nearbyPlaces: { id: string; category: string; name: string; distanceKm: number; travelMinutes: number | null; sortOrder: number }[];
  faqs: { id: string; question: string; answer: string; sortOrder: number }[];
  constructionUpdates: { id: string; title: string; description: string | null; progressPercent: number | null; updateDate: string; imageUrls: string[] }[];
  team: { id: string; userId: string; role: string; isPrimaryContact: boolean; user: { id: string; fullName: string; email: string | null; phone: string | null } }[];
  blocks: { id: string; name: string; type: string; totalFloors: number | null; description: string | null; sortOrder: number; _count: { units: number } }[];
  statusHistory: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; changedBy: { fullName: string } | null }[];
  page: { revision: number; publishedAt: string | null; draftUpdatedAt: string } | null;
  _count: { domains: number; units: number; enquiries: number; leads: number };
  inventory: { available: number; released: number; total: number; priceMin: number | null; priceMax: number | null; types: string[]; byStatus: Record<string, number> };
  isBookable: boolean;
  publicUrl: string;
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canApprove: boolean;
    canPublish: boolean;
    canManageInventory: boolean;
    canManagePage: boolean;
    canManageDomains: boolean;
    canFeature: boolean;
  };
  statusTargets: string[];
}

export interface UnitRow {
  id: string;
  code: string;
  blockId: string | null;
  unitType: string;
  floorNumber: number | null;
  configuration: string | null;
  bedrooms: number | null;
  area: number;
  areaUnit: string;
  areaSqft: number;
  carpetAreaSqft: number | null;
  facing: string | null;
  dimensions: string | null;
  isCorner: boolean;
  basePrice: number;
  additionalCharges: number;
  totalPrice: number;
  status: string;
  holdExpiresAt: string | null;
  notes: string | null;
  version: number;
  block: { id: string; name: string; sortOrder: number } | null;
  reservations: { id: string; expiresAt: string | null; notes: string | null; lead: { id: string; leadNo: string; name: string } | null; reservedBy: { fullName: string } | null }[];
}

export interface PageState {
  projectId: string;
  slug: string;
  draftSections: PageSection[];
  publishedSections: PageSection[] | null;
  revision: number;
  publishedAt: string | null;
  draftUpdatedAt: string;
  hasUnpublishedChanges: boolean;
  preview: { token: string; expiresAt: string; url: string } | null;
  canPublish: boolean;
}

export interface DomainRow {
  id: string;
  hostname: string;
  type: 'SUBDOMAIN' | 'CUSTOM';
  isPrimary: boolean;
  status: string;
  verificationToken: string;
  verificationRecord: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  dnsTargetOk: boolean;
  sslStatus: string;
  enabledAt: string | null;
  createdAt: string;
  url: string;
  createdBy: { fullName: string } | null;
  instructions:
    | { type: 'SUBDOMAIN'; notes: string[] }
    | { type: 'CUSTOM'; txt: { name: string; value: string }; cname: { name: string; target: string } | null; a: { name: string; value: string } | null; notes: string[] };
}

/** "2026-12-01T10:00" (browser local) ⇄ ISO */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
