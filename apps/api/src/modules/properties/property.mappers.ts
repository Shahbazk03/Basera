import type { PropertyCard, PropertyDetail } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { iso, isoDate, num } from '../../common/http';

export const propertyCardSelect = {
  id: true,
  slug: true,
  referenceCode: true,
  title: true,
  listingType: true,
  segment: true,
  price: true,
  pricePerSqft: true,
  priceNegotiable: true,
  area: true,
  areaUnit: true,
  areaSqft: true,
  bedrooms: true,
  bathrooms: true,
  furnishing: true,
  possessionStatus: true,
  coverImageUrl: true,
  verificationStatus: true,
  isFeatured: true,
  sourceType: true,
  publishedAt: true,
  isDemo: true,
  propertyType: { select: { id: true, name: true, slug: true } },
  city: { select: { id: true, name: true, slug: true } },
  locality: { select: { id: true, name: true, slug: true } },
  organization: { select: { id: true, name: true, slug: true, type: true, logoUrl: true, verificationStatus: true } },
  project: { select: { id: true, name: true, slug: true } },
  _count: { select: { media: { where: { type: 'IMAGE' as const } } } },
} satisfies Prisma.PropertySelect;

export type PropertyCardRow = Prisma.PropertyGetPayload<{ select: typeof propertyCardSelect }>;

export function toPropertyCard(p: PropertyCardRow, distanceKm?: number | null): PropertyCard {
  return {
    id: p.id,
    slug: p.slug,
    referenceCode: p.referenceCode,
    title: p.title,
    listingType: p.listingType,
    segment: p.segment,
    propertyType: p.propertyType,
    price: num(p.price)!,
    pricePerSqft: num(p.pricePerSqft),
    priceNegotiable: p.priceNegotiable,
    area: num(p.area)!,
    areaUnit: p.areaUnit,
    areaSqft: num(p.areaSqft)!,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    furnishing: p.furnishing,
    possessionStatus: p.possessionStatus,
    city: p.city,
    locality: p.locality,
    coverImageUrl: p.coverImageUrl,
    imageCount: p._count.media,
    isVerified: p.verificationStatus === 'VERIFIED',
    isFeatured: p.isFeatured,
    sourceType: p.sourceType,
    organization: {
      id: p.organization.id,
      name: p.organization.type === 'INDIVIDUAL_OWNER' ? 'Individual owner' : p.organization.name,
      slug: p.organization.slug,
      type: p.organization.type,
      logoUrl: p.organization.logoUrl,
      isVerified: p.organization.verificationStatus === 'VERIFIED',
    },
    project: p.project,
    publishedAt: iso(p.publishedAt),
    isDemo: p.isDemo,
    ...(distanceKm !== undefined ? { distanceKm } : {}),
  };
}

export const propertyDetailInclude = {
  propertyType: { select: { id: true, name: true, slug: true, formProfile: true } },
  city: { select: { id: true, name: true, slug: true } },
  locality: { select: { id: true, name: true, slug: true } },
  state: { select: { id: true, name: true, slug: true } },
  organization: { select: { id: true, name: true, slug: true, type: true, logoUrl: true, verificationStatus: true, status: true, createdAt: true, whatsappNumber: true, showContactPublicly: true } },
  project: { select: { id: true, name: true, slug: true } },
  listedBy: { select: { brokerProfile: { select: { displayName: true, reraAgentNumber: true, experienceYears: true } } } },
  media: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, type: true, url: true, caption: true } },
  amenities: { select: { amenity: { select: { id: true, name: true, icon: true, category: true } } } },
  documents: { select: { id: true, title: true, docType: true, visibility: true } },
  _count: { select: { media: { where: { type: 'IMAGE' as const } } } },
} satisfies Prisma.PropertyInclude;

export type PropertyDetailRow = Prisma.PropertyGetPayload<{ include: typeof propertyDetailInclude }>;

export function toPropertyDetail(p: PropertyDetailRow, ctx: { activeListings: number; whatsappAvailable: boolean; includePrivateDocs: boolean }): PropertyDetail {
  const approximate = p.hideExactLocation;
  const coord = (v: Prisma.Decimal | null) => {
    const n = num(v);
    return n === null ? null : approximate ? Math.round(n * 100) / 100 : n;
  };
  return {
    ...toPropertyCard(p as unknown as PropertyCardRow),
    description: p.description,
    status: p.status,
    availability: p.availability,
    addressLine: approximate ? null : p.addressLine,
    landmark: approximate ? null : p.landmark,
    pincode: p.pincode,
    latitude: coord(p.latitude),
    longitude: coord(p.longitude),
    locationIsApproximate: approximate,
    state: p.state,
    media: p.media,
    amenities: p.amenities.map((a) => a.amenity),
    highlights: p.highlights,
    attributes: (p.attributes ?? {}) as Record<string, string | number | boolean>,
    formProfile: p.propertyType.formProfile,
    maintenanceMonthly: num(p.maintenanceMonthly),
    securityDeposit: num(p.securityDeposit),
    bookingAmount: num(p.bookingAmount),
    balconies: p.balconies,
    floorNumber: p.floorNumber,
    totalFloors: p.totalFloors,
    facing: p.facing,
    availableFrom: isoDate(p.availableFrom),
    ageYears: p.ageYears,
    plotLengthFt: num(p.plotLengthFt),
    plotWidthFt: num(p.plotWidthFt),
    roadWidthFt: num(p.roadWidthFt),
    isCornerPlot: p.isCornerPlot,
    ownershipType: p.ownershipType,
    approvalAuthority: p.approvalAuthority,
    reraNumber: p.reraNumber,
    coveredParking: p.coveredParking,
    openParking: p.openParking,
    carpetAreaSqft: num(p.carpetAreaSqft),
    builtUpAreaSqft: num(p.builtUpAreaSqft),
    superAreaSqft: num(p.superAreaSqft),
    plotAreaSqft: num(p.plotAreaSqft),
    documents: p.documents.filter((d) => ctx.includePrivateDocs || d.visibility !== 'PRIVATE'),
    lister: {
      name: p.organization.type === 'INDIVIDUAL_OWNER' ? 'Individual owner' : p.organization.name,
      type: p.organization.type,
      logoUrl: p.organization.logoUrl,
      verificationStatus: p.organization.verificationStatus,
      memberSince: p.organization.createdAt.toISOString(),
      activeListings: ctx.activeListings,
      broker: p.sourceType === 'BROKER' && p.listedBy.brokerProfile ? p.listedBy.brokerProfile : null,
    },
    whatsappAvailable: ctx.whatsappAvailable,
    updatedAt: p.updatedAt.toISOString(),
  };
}
