import { Injectable, NotFoundException } from '@nestjs/common';
import type { PropertySearchQuery, PropertySearchResult } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AuthUser } from '../../common/auth/auth-user';
import { propertyCardSelect, propertyDetailInclude, toPropertyCard, toPropertyDetail } from './property.mappers';

const MAX_GEO_RESULTS = 1000;

/** Public, database-backed marketplace search. Only PUBLISHED listings of ACTIVE organisations are visible. */
@Injectable()
export class PropertySearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  publicBaseWhere(): Prisma.PropertyWhereInput {
    return { status: 'PUBLISHED', deletedAt: null, organization: { status: 'ACTIVE', deletedAt: null } };
  }

  async search(q: PropertySearchQuery): Promise<PropertySearchResult> {
    const citySlug = q.city || (await this.settings.getString('marketplace.defaultCitySlug'));
    const city = await this.prisma.city.findFirst({ where: { slug: citySlug, isActive: true }, select: { id: true, name: true, slug: true } });

    const base: Prisma.PropertyWhereInput = {
      ...this.publicBaseWhere(),
      ...(city ? { cityId: city.id } : {}),
      ...(q.listingType ? { listingType: q.listingType } : {}),
    };
    const and: Prisma.PropertyWhereInput[] = [];
    if (q.segment) and.push({ segment: q.segment });
    if (q.type?.length) and.push({ propertyType: { slug: { in: q.type } } });
    if (q.locality?.length) and.push({ locality: { slug: { in: q.locality } } });
    if (q.minPrice !== undefined || q.maxPrice !== undefined) and.push({ price: { gte: q.minPrice, lte: q.maxPrice } });
    if (q.minArea !== undefined || q.maxArea !== undefined) and.push({ areaSqft: { gte: q.minArea, lte: q.maxArea } });
    if (q.bedrooms?.length) {
      const exact = q.bedrooms.filter((b) => /^\d+$/.test(b)).map(Number);
      const plus = q.bedrooms.filter((b) => /^\d+\+$/.test(b)).map((b) => Number(b.slice(0, -1)));
      const or: Prisma.PropertyWhereInput[] = [];
      if (exact.length) or.push({ bedrooms: { in: exact } });
      if (plus.length) or.push({ bedrooms: { gte: Math.min(...plus) } });
      if (or.length) and.push({ OR: or });
    }
    if (q.bathrooms) and.push({ bathrooms: { gte: q.bathrooms } });
    if (q.furnishing?.length) and.push({ furnishing: { in: q.furnishing.filter((f) => ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'].includes(f)) as never } });
    for (const slug of q.amenities ?? []) and.push({ amenities: { some: { amenity: { slug } } } });
    if (q.possession) and.push({ possessionStatus: q.possession });
    if (q.verified) and.push({ verificationStatus: 'VERIFIED' });
    if (q.source) and.push({ sourceType: q.source });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.q) {
      const term = q.q.trim();
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { locality: { name: { contains: term, mode: 'insensitive' } } },
          { propertyType: { name: { contains: term, mode: 'insensitive' } } },
          { project: { name: { contains: term, mode: 'insensitive' } } },
          { referenceCode: { equals: term.toUpperCase() } },
        ],
      });
    }

    let distances: Map<string, number> | null = null;
    if (q.lat !== undefined && q.lng !== undefined) {
      const radiusM = (q.radiusKm ?? 5) * 1000;
      const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
        SELECT id, ST_Distance(location, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography) AS distance
        FROM properties
        WHERE status = 'PUBLISHED' AND "deletedAt" IS NULL AND location IS NOT NULL
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${radiusM})
        ORDER BY distance ASC
        LIMIT ${MAX_GEO_RESULTS}`;
      distances = new Map(rows.map((r) => [r.id, Math.round((Number(r.distance) / 1000) * 10) / 10]));
      and.push({ id: { in: [...distances.keys()] } });
    }

    const where: Prisma.PropertyWhereInput = { ...base, AND: and };
    const orderBy: Prisma.PropertyOrderByWithRelationInput[] =
      q.sort === 'newest'
        ? [{ publishedAt: 'desc' }]
        : q.sort === 'price_asc'
          ? [{ price: 'asc' }]
          : q.sort === 'price_desc'
            ? [{ price: 'desc' }]
            : q.sort === 'area_desc'
              ? [{ areaSqft: 'desc' }]
              : [{ isFeatured: 'desc' }, { publishedAt: 'desc' }];

    const skip = (q.page - 1) * q.pageSize;
    let rows;
    let total: number;
    if (distances && q.sort === 'relevance') {
      // Nearby search: order by distance
      const all = await this.prisma.property.findMany({ where, select: propertyCardSelect, take: MAX_GEO_RESULTS });
      all.sort((a, b) => (distances!.get(a.id) ?? 0) - (distances!.get(b.id) ?? 0));
      total = all.length;
      rows = all.slice(skip, skip + q.pageSize);
    } else {
      [rows, total] = await Promise.all([
        this.prisma.property.findMany({ where, select: propertyCardSelect, orderBy: [...orderBy, { id: 'asc' }], skip, take: q.pageSize }),
        this.prisma.property.count({ where }),
      ]);
    }

    // Facets (counts within the city / listing type, independent of the other filters)
    const [localityCounts, typeCounts, priceAgg] = await Promise.all([
      this.prisma.property.groupBy({ by: ['localityId'], where: base, _count: { _all: true }, orderBy: { _count: { localityId: 'desc' } }, take: 40 }),
      this.prisma.property.groupBy({ by: ['propertyTypeId'], where: base, _count: { _all: true } }),
      this.prisma.property.aggregate({ where, _min: { price: true }, _max: { price: true } }),
    ]);
    const [localities, types] = await Promise.all([
      this.prisma.locality.findMany({ where: { id: { in: localityCounts.map((l) => l.localityId) } }, select: { id: true, name: true, slug: true } }),
      this.prisma.propertyType.findMany({ where: { id: { in: typeCounts.map((t) => t.propertyTypeId) } }, select: { id: true, name: true, slug: true, sortOrder: true } }),
    ]);
    const locById = new Map(localities.map((l) => [l.id, l]));
    const typeById = new Map(types.map((t) => [t.id, t]));

    return {
      data: rows.map((r) => toPropertyCard(r, distances ? (distances.get(r.id) ?? null) : undefined)),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      facets: {
        localities: localityCounts
          .filter((l) => locById.has(l.localityId))
          .map((l) => ({ slug: locById.get(l.localityId)!.slug, name: locById.get(l.localityId)!.name, count: l._count._all })),
        propertyTypes: typeCounts
          .filter((t) => typeById.has(t.propertyTypeId))
          .sort((a, b) => typeById.get(a.propertyTypeId)!.sortOrder - typeById.get(b.propertyTypeId)!.sortOrder)
          .map((t) => ({ slug: typeById.get(t.propertyTypeId)!.slug, name: typeById.get(t.propertyTypeId)!.name, count: t._count._all })),
        priceRange: { min: priceAgg._min.price ? Number(priceAgg._min.price) : null, max: priceAgg._max.price ? Number(priceAgg._max.price) : null },
      },
      appliedCity: city,
    };
  }

  /** Public detail. Authorised listers/reviewers may preview unpublished listings. */
  async detail(slugOrId: string, user?: AuthUser) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
    const row = await this.prisma.property.findFirst({ where: { ...(isUuid ? { id: slugOrId } : { slug: slugOrId }), deletedAt: null }, include: propertyDetailInclude });
    if (!row) throw new NotFoundException('Listing not found');
    const isPublic = row.status === 'PUBLISHED' && row.organization.status === 'ACTIVE';
    const canPreview = Boolean(user && (user.can('property.view_all', row.organizationId) || user.can('property.approve', row.organizationId)));
    if (!isPublic && !canPreview) {
      // Sold / rented listings remain reachable (for shared links) but are clearly marked and not enquirable.
      if (!['SOLD', 'RENTED', 'EXPIRED'].includes(row.status)) throw new NotFoundException('Listing not found');
    }
    if (isPublic) await this.prisma.property.update({ where: { id: row.id }, data: { viewCount: { increment: 1 } } });
    const activeListings = await this.prisma.property.count({ where: { organizationId: row.organizationId, status: 'PUBLISHED', deletedAt: null } });
    const companyWhatsapp = await this.settings.getString('contact.whatsapp');
    const whatsappAvailable = Boolean((row.organization.showContactPublicly && row.organization.whatsappNumber) || (row.organization.type === 'PLATFORM' && companyWhatsapp));
    return { ...toPropertyDetail(row, { activeListings, whatsappAvailable, includePrivateDocs: canPreview }), isPreview: !isPublic };
  }

  async similar(slugOrId: string, limit = 6) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
    const p = await this.prisma.property.findFirst({ where: isUuid ? { id: slugOrId } : { slug: slugOrId }, select: { id: true, cityId: true, localityId: true, propertyTypeId: true, segment: true, listingType: true, price: true } });
    if (!p) throw new NotFoundException('Listing not found');
    const price = Number(p.price);
    const rows = await this.prisma.property.findMany({
      where: {
        ...this.publicBaseWhere(),
        id: { not: p.id },
        cityId: p.cityId,
        listingType: p.listingType,
        segment: p.segment,
        price: { gte: price * 0.6, lte: price * 1.5 },
      },
      select: { ...propertyCardSelect, localityId: true, propertyTypeId: true },
      take: 30,
      orderBy: { publishedAt: 'desc' },
    });
    const score = (r: (typeof rows)[number]) =>
      (r.propertyTypeId === p.propertyTypeId ? 2 : 0) + (r.localityId === p.localityId ? 2 : 0) - Math.abs(Number(r.price) - price) / Math.max(price, 1);
    return rows.sort((a, b) => score(b) - score(a)).slice(0, limit).map((r) => toPropertyCard(r));
  }

  async cards(where: Prisma.PropertyWhereInput, take: number, orderBy: Prisma.PropertyOrderByWithRelationInput[] = [{ isFeatured: 'desc' }, { publishedAt: 'desc' }]) {
    const rows = await this.prisma.property.findMany({ where: { ...this.publicBaseWhere(), ...where }, select: propertyCardSelect, orderBy, take });
    return rows.map((r) => toPropertyCard(r));
  }
}
