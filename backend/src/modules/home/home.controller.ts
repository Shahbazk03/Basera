import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ProjectCard, PropertyCard } from '@estate/shared';
import { Public } from '../../common/decorators';
import { SettingsService } from '../../common/settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertySearchService } from '../properties/property-search.service';
import { PropertiesModule } from '../properties/properties.module';
import { projectCards, publicProjectWhere } from '../projects/project-card';

interface HomeSection {
  type: string;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown>;
  data: unknown;
}

/**
 * Homepage aggregate: every section's content in one request, ordered and toggled from CMS
 * (cms_sections, pageKey "home"). All numbers are live counts — nothing is fabricated.
 */
@ApiTags('Public — home')
@Controller({ path: 'public/home', version: '1' })
export class HomeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly search: PropertySearchService,
  ) {}

  @Public()
  @Get()
  async home(): Promise<{ city: { id: string; name: string; slug: string } | null; sections: HomeSection[] }> {
    const citySlug = await this.settings.getString('marketplace.defaultCitySlug');
    const city = await this.prisma.city.findFirst({ where: { slug: citySlug, isActive: true }, select: { id: true, name: true, slug: true } });
    const cityWhere = city ? { cityId: city.id } : {};
    const sections = await this.prisma.cmsSection.findMany({ where: { pageKey: 'home', isVisible: true }, orderBy: { sortOrder: 'asc' } });

    const out: HomeSection[] = [];
    for (const s of sections) {
      const config = (s.config ?? {}) as Record<string, unknown>;
      const limit = typeof config.limit === 'number' ? config.limit : 8;
      let data: unknown = null;
      switch (s.type) {
        case 'HERO_SEARCH': {
          const now = new Date();
          const [banners, localities, liveListings, liveProjects, verifiedPartners] = await Promise.all([
            this.prisma.cmsBanner.findMany({
              where: { placement: 'HOME_HERO', isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
              orderBy: { sortOrder: 'asc' },
              select: { id: true, title: true, subtitle: true, imageUrl: true, linkUrl: true },
            }),
            this.prisma.locality.findMany({ where: { ...(city ? { cityId: city.id } : {}), isPopular: true, isActive: true }, orderBy: { name: 'asc' }, take: 6, select: { name: true, slug: true } }),
            this.prisma.property.count({ where: { ...this.search.publicBaseWhere(), ...cityWhere } }),
            this.prisma.project.count({ where: { ...publicProjectWhere(), ...cityWhere } }),
            this.prisma.organization.count({ where: { type: { in: ['BROKERAGE', 'DEVELOPER'] }, status: 'ACTIVE', verificationStatus: 'VERIFIED', deletedAt: null } }),
          ]);
          data = { banners, quickLocalities: localities, counts: { liveListings, liveProjects, verifiedPartners } };
          break;
        }
        case 'FEATURED_PROPERTIES': {
          const featured = await this.search.cards({ ...cityWhere, isFeatured: true }, limit);
          data = featured.length >= 4 ? featured : await this.search.cards({ ...cityWhere }, limit, [{ isFeatured: 'desc' }, { verificationStatus: 'asc' }, { viewCount: 'desc' }]);
          break;
        }
        case 'POPULAR_LOCALITIES': {
          const groups = await this.prisma.property.groupBy({
            by: ['localityId'],
            where: { ...this.search.publicBaseWhere(), ...cityWhere },
            _count: { _all: true },
            _min: { price: true },
          });
          const counts = new Map(groups.map((g) => [g.localityId, g._count._all]));
          const localities = await this.prisma.locality.findMany({
            where: { ...(city ? { cityId: city.id } : {}), isActive: true, OR: [{ isPopular: true }, { id: { in: groups.map((g) => g.localityId) } }] },
            select: { id: true, name: true, slug: true, isPopular: true, _count: { select: { projects: { where: publicProjectWhere() } } } },
          });
          data = localities
            .map((l) => ({ name: l.name, slug: l.slug, listings: counts.get(l.id) ?? 0, projects: l._count.projects, popular: l.isPopular }))
            .filter((l) => l.listings > 0 || l.projects > 0 || l.popular)
            .sort((a, b) => b.listings + b.projects - (a.listings + a.projects) || a.name.localeCompare(b.name))
            .slice(0, limit);
          break;
        }
        case 'FEATURED_PROJECTS':
          data = (await projectCards(this.prisma, { ...cityWhere }, limit)) satisfies ProjectCard[];
          break;
        case 'RESIDENTIAL_PLOTS':
          data = await this.search.cards({ ...cityWhere, segment: 'RESIDENTIAL', propertyType: { formProfile: 'PLOT' } }, limit);
          break;
        case 'COMMERCIAL':
          data = await this.search.cards({ ...cityWhere, segment: 'COMMERCIAL' }, limit);
          break;
        case 'RECENT_LISTINGS':
          data = (await this.search.cards({ ...cityWhere }, limit, [{ publishedAt: 'desc' }])) satisfies PropertyCard[];
          break;
        case 'VERIFIED_BROKERS': {
          const orgs = await this.prisma.organization.findMany({
            where: { type: 'BROKERAGE', status: 'ACTIVE', verificationStatus: 'VERIFIED', deletedAt: null },
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
              description: true,
              createdAt: true,
              isDemo: true,
              city: { select: { name: true } },
              brokerProfiles: { where: { verificationStatus: 'VERIFIED' }, select: { experienceYears: true, reraAgentNumber: true }, orderBy: { experienceYears: 'desc' }, take: 1 },
              _count: { select: { properties: { where: { status: 'PUBLISHED', deletedAt: null } } } },
            },
          });
          data = orgs
            .map((o) => ({
              id: o.id,
              name: o.name,
              slug: o.slug,
              logoUrl: o.logoUrl,
              city: o.city?.name ?? null,
              liveListings: o._count.properties,
              experienceYears: o.brokerProfiles[0]?.experienceYears ?? null,
              reraRegistered: Boolean(o.brokerProfiles[0]?.reraAgentNumber),
              memberSince: o.createdAt.toISOString(),
              isDemo: o.isDemo,
            }))
            .sort((a, b) => b.liveListings - a.liveListings)
            .slice(0, limit);
          break;
        }
        case 'WHY_CHOOSE_US':
        case 'ENQUIRY_CTA':
          data = null;
          break;
        default:
          continue;
      }
      out.push({ type: s.type, title: s.title, subtitle: s.subtitle, config, data });
    }
    return { city, sections: out };
  }

  /** Category counts for the "explore by type" strip and navigation menus. */
  @Public()
  @Get('categories')
  async categories() {
    const citySlug = await this.settings.getString('marketplace.defaultCitySlug');
    const city = await this.prisma.city.findFirst({ where: { slug: citySlug, isActive: true }, select: { id: true } });
    const groups = await this.prisma.property.groupBy({
      by: ['propertyTypeId', 'listingType'],
      where: { ...this.search.publicBaseWhere(), ...(city ? { cityId: city.id } : {}) },
      _count: { _all: true },
    });
    const types = await this.prisma.propertyType.findMany({ where: { isActive: true }, orderBy: [{ segment: 'asc' }, { sortOrder: 'asc' }], select: { id: true, name: true, slug: true, segment: true, formProfile: true } });
    return types.map((t) => ({
      ...t,
      sale: groups.find((g) => g.propertyTypeId === t.id && g.listingType === 'SALE')?._count._all ?? 0,
      rent: groups.find((g) => g.propertyTypeId === t.id && g.listingType === 'RENT')?._count._all ?? 0,
    }));
  }
}

@Module({ imports: [PropertiesModule], controllers: [HomeController] })
export class HomeModule {}
