import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BOOKABLE_PROJECT_STATUSES,
  computeProjectStatus,
  defaultProjectPage,
  pageSectionsSchema,
  type PageSection,
  type Paginated,
  type ProjectCard,
  type ProjectDetail,
  type ProjectSearchQuery,
  type PublicUnit,
} from '@estate/shared';
import { Prisma, MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { SettingsService } from '../../common/settings.service';
import { iso, isoDate, num } from '../../common/http';
import { env } from '../../config/env';
import { FilesService } from '../files/files.service';
import { projectCardSelect, projectCards, publicProjectWhere, toProjectCard, unitStatsFor } from './project-card';
import { domainUrl } from './domains.service';
import { PageService } from './page.service';
import { sortByEnum } from '../../common/ordering';

const PRICE_VISIBLE: string[] = ['AVAILABLE', 'ON_HOLD', 'RESERVED'];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

@Injectable()
export class ProjectPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly pages: PageService,
  ) {}

  async search(q: ProjectSearchQuery): Promise<Paginated<ProjectCard> & { appliedCity: { id: string; name: string; slug: string } | null }> {
    const citySlug = q.city || (await this.settings.getString('marketplace.defaultCitySlug'));
    const city = await this.prisma.city.findFirst({ where: { slug: citySlug, isActive: true }, select: { id: true, name: true, slug: true } });
    const and: Prisma.ProjectWhereInput[] = [];
    if (city) and.push({ cityId: city.id });
    if (q.locality) and.push({ locality: { slug: q.locality } });
    if (q.projectType) and.push({ projectType: q.projectType });
    if (q.status) and.push({ status: q.status });
    if (q.developer) and.push({ developerOrg: { slug: q.developer } });
    if (q.q) {
      and.push({
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { locality: { name: { contains: q.q, mode: 'insensitive' } } },
          { developerOrg: { name: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
    }
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      // "Has something in my budget": a released unit in range, or (no units yet) an overlapping published range.
      and.push({
        OR: [
          { units: { some: { status: { notIn: ['NOT_RELEASED', 'BLOCKED'] }, totalPrice: { gte: q.minPrice, lte: q.maxPrice } } } },
          {
            units: { none: {} },
            ...(q.maxPrice !== undefined ? { priceMinOverride: { lte: q.maxPrice } } : {}),
            ...(q.minPrice !== undefined ? { priceMaxOverride: { gte: q.minPrice } } : {}),
          },
        ],
      });
    }
    const where: Prisma.ProjectWhereInput = { ...publicProjectWhere(), AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({ where, select: projectCardSelect, orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.project.count({ where }),
    ]);
    const stats = await unitStatsFor(this.prisma, rows.map((r) => r.id));
    const now = new Date();
    return {
      data: rows.map((r) => toProjectCard(r, stats.get(r.id), now)),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      appliedCity: city,
    };
  }

  async detail(slug: string, opts: { previewToken?: string; user?: AuthUser }): Promise<ProjectDetail> {
    const p = await this.prisma.project.findFirst({
      where: { slug, deletedAt: null },
      include: {
        city: { select: { id: true, name: true, slug: true } },
        locality: { select: { id: true, name: true, slug: true } },
        state: { select: { id: true, name: true, slug: true } },
        organization: { select: { id: true, type: true, status: true, whatsappNumber: true, showContactPublicly: true } },
        developerOrg: {
          select: { id: true, name: true, slug: true, type: true, logoUrl: true, description: true, website: true, verificationStatus: true, developerProfile: { select: { establishedYear: true, projectsDelivered: true, about: true } } },
        },
        media: { orderBy: [{ sortOrder: 'asc' }], select: { id: true, type: true, url: true, caption: true } }, // grouped by type below
        documents: { where: { visibility: { in: ['PUBLIC', 'ON_REQUEST'] } }, orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, docType: true, visibility: true } },
        amenities: { select: { amenity: { select: { id: true, name: true, icon: true, category: true, isActive: true } } } },
        nearbyPlaces: { orderBy: { sortOrder: 'asc' } },
        faqs: { orderBy: { sortOrder: 'asc' } },
        constructionUpdates: { orderBy: { updateDate: 'desc' } },
        blocks: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true } },
        units: { where: { status: { notIn: ['NOT_RELEASED', 'BLOCKED'] } }, include: { block: { select: { name: true, sortOrder: true } } } },
        page: { select: { draftSections: true, publishedSections: true } },
        domains: { where: { status: 'ACTIVE', isPrimary: true }, select: { hostname: true } },
      },
    });
    if (!p) throw new NotFoundException('Project not found');

    const isPublic = await this.prisma.project.count({ where: { id: p.id, ...publicProjectWhere() } });
    const previewOk = await this.pages.previewValid(p.id, opts.previewToken);
    const staffPreview = Boolean(opts.user && (opts.user.can('project.view_all', p.organizationId) || opts.user.can('project.approve', p.organizationId)) && opts.previewToken !== undefined);
    const showDraft = previewOk || staffPreview;
    if (!isPublic && !showDraft) throw new NotFoundException('Project not found');
    const isPreview = showDraft;

    const stats = (await unitStatsFor(this.prisma, [p.id])).get(p.id);
    const now = new Date();
    const card = toProjectCard(p as unknown as Parameters<typeof toProjectCard>[0], stats, now);
    const status = computeProjectStatus({ status: p.status, autoStatus: p.autoStatus, bookingOpensAt: p.bookingOpensAt, bookingClosesAt: p.bookingClosesAt, closingSoonHours: p.closingSoonHours, availableUnits: stats?.available ?? 0, releasedUnits: stats?.released ?? 0 }, now);

    const rawSections = showDraft ? p.page?.draftSections : (p.page?.publishedSections ?? p.page?.draftSections);
    const parsed = pageSectionsSchema.safeParse(rawSections);
    const sections = (parsed.success ? parsed.data : defaultProjectPage()) as PageSection[];

    const units: PublicUnit[] = p.units
      .sort((a, b) => (a.block?.sortOrder ?? 999) - (b.block?.sortOrder ?? 999) || collator.compare(a.code, b.code))
      .map((u) => ({
        id: u.id,
        code: u.code,
        block: u.block?.name ?? null,
        unitType: u.unitType,
        floorNumber: u.floorNumber,
        configuration: u.configuration,
        bedrooms: u.bedrooms,
        area: num(u.area)!,
        areaUnit: u.areaUnit,
        areaSqft: num(u.areaSqft)!,
        facing: u.facing,
        dimensions: u.dimensions,
        isCorner: u.isCorner,
        totalPrice: PRICE_VISIBLE.includes(u.status) ? num(u.totalPrice) : null,
        status: u.status,
      }));

    const companyWhatsapp = await this.settings.getString('contact.whatsapp');
    const whatsappAvailable = Boolean(p.whatsappNumber || (p.organization.showContactPublicly && p.organization.whatsappNumber) || (p.organization.type === 'PLATFORM' && companyWhatsapp));
    const primaryDomain = p.domains[0]?.hostname ?? null;
    const canonicalUrl = primaryDomain ? domainUrl(primaryDomain) : `${env().WEB_PUBLIC_URL.replace(/\/$/, '')}/projects/${p.slug}`;
    const dev = p.developerOrg;

    return {
      ...card,
      status,
      description: p.description,
      addressLine: p.addressLine,
      pincode: p.pincode,
      latitude: num(p.latitude),
      longitude: num(p.longitude),
      state: p.state,
      logoUrl: p.logoUrl,
      masterPlanUrl: p.masterPlanUrl,
      videoUrls: p.videoUrls,
      totalAreaAcres: num(p.totalAreaAcres),
      totalUnitsPlanned: p.totalUnitsPlanned,
      launchDate: isoDate(p.launchDate),
      reraValidUntil: isoDate(p.reraValidUntil),
      approvalDetails: p.approvalDetails,
      legalInformation: p.legalInformation,
      serverTime: now.toISOString(),
      media: sortByEnum(p.media, (m) => m.type, MediaType),
      amenities: p.amenities.filter((a) => a.amenity.isActive).map(({ amenity: { isActive: _i, ...a } }) => a),
      nearbyPlaces: p.nearbyPlaces.map((n) => ({ id: n.id, category: n.category, name: n.name, distanceKm: num(n.distanceKm)!, travelMinutes: n.travelMinutes })),
      faqs: p.faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
      constructionUpdates: p.constructionUpdates.map((u) => ({ id: u.id, title: u.title, description: u.description, progressPercent: u.progressPercent, updateDate: isoDate(u.updateDate)!, imageUrls: u.imageUrls })),
      documents: p.documents,
      blocks: p.blocks,
      units,
      developerProfile: dev
        ? {
            name: dev.name,
            logoUrl: dev.logoUrl,
            description: dev.developerProfile?.about ?? dev.description,
            website: dev.website,
            establishedYear: dev.developerProfile?.establishedYear ?? null,
            projectsDelivered: dev.developerProfile?.projectsDelivered ?? null,
            isVerified: dev.verificationStatus === 'VERIFIED',
          }
        : null,
      sections,
      primaryDomain,
      canonicalUrl,
      whatsappAvailable,
      isBookable: BOOKABLE_PROJECT_STATUSES.includes(status),
      seo: {
        title: p.seoTitle || `${p.name} — ${p.locality.name}, ${p.city.name}`,
        description: p.seoDescription || p.tagline || p.description.replace(/\s+/g, ' ').slice(0, 160),
        ogImageUrl: p.ogImageUrl || p.heroImageUrl,
      },
      isPreview,
      bookingOpensAt: iso(p.bookingOpensAt),
      bookingClosesAt: iso(p.bookingClosesAt),
    };
  }

  async related(slug: string, limit = 4): Promise<ProjectCard[]> {
    const p = await this.prisma.project.findFirst({ where: { slug, deletedAt: null }, select: { id: true, cityId: true, localityId: true, projectType: true } });
    if (!p) throw new NotFoundException('Project not found');
    const candidates = await projectCards(this.prisma, { cityId: p.cityId, id: { not: p.id } }, 20);
    const score = (c: ProjectCard) => (c.projectType === p.projectType ? 2 : 0) + (c.locality.id === p.localityId ? 1 : 0);
    return candidates.sort((a, b) => score(b) - score(a)).slice(0, limit);
  }

  /** Download link for a PUBLIC project document (ON_REQUEST documents are requested through an enquiry). */
  async documentUrl(slug: string, docId: string) {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: docId, visibility: 'PUBLIC', project: { slug, ...publicProjectWhere() } },
      select: { fileId: true },
    });
    if (!doc) throw new NotFoundException('Document not available');
    return this.files.downloadUrl(undefined, doc.fileId);
  }
}
