import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HOME_SECTION_TYPES, isReservedPageSlug } from '@estate/shared';
import type { z } from 'zod';
import type { bannerSchema, cmsPageSchema, faqSchema, homeSectionSchema, homeSectionUpdateSchema, seoOverrideSchema } from '@estate/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { publicProjectWhere } from '../projects/project-card';

const pageSelect = {
  id: true,
  slug: true,
  title: true,
  status: true,
  showInFooter: true,
  footerGroup: true,
  seoTitle: true,
  seoDescription: true,
  canonicalUrl: true,
  ogImageUrl: true,
  noIndex: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: { select: { fullName: true } },
} satisfies Prisma.CmsPageSelect;

/** Website content: pages (typed blocks, never raw HTML), homepage sections, banners, FAQs and SEO. */
@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ───────────────────────── Pages ─────────────────────────

  async pages(q: { q?: string; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }) {
    return this.prisma.cmsPage.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }] } : {}) },
      orderBy: [{ footerGroup: 'asc' }, { title: 'asc' }],
      select: pageSelect,
    });
  }

  async page(id: string) {
    const p = await this.prisma.cmsPage.findUnique({ where: { id }, select: { ...pageSelect, blocks: true } });
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  private pageData(input: Partial<z.output<typeof cmsPageSchema>>) {
    return {
      ...input,
      ...(input.blocks ? { blocks: input.blocks as unknown as Prisma.InputJsonValue } : {}),
      ...(input.canonicalUrl !== undefined ? { canonicalUrl: input.canonicalUrl || null } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl || null } : {}),
    } as Prisma.CmsPageUncheckedUpdateInput;
  }

  private assertSlug(slug: string | undefined) {
    if (slug && isReservedPageSlug(slug)) throw new BadRequestException({ message: `/${slug} is used by the website itself — choose another address`, details: [{ path: 'slug', message: 'Reserved address' }] });
  }

  async createPage(user: AuthUser, input: z.output<typeof cmsPageSchema>) {
    this.assertSlug(input.slug);
    if (await this.prisma.cmsPage.findUnique({ where: { slug: input.slug } })) throw new ConflictException({ message: `A page with the address /${input.slug} already exists`, code: 'DUPLICATE' });
    const p = await this.prisma.cmsPage.create({
      data: { ...(this.pageData(input) as Prisma.CmsPageUncheckedCreateInput), updatedById: user.id, publishedAt: input.status === 'PUBLISHED' ? new Date() : null },
    });
    await this.audit.log({ actorId: user.id, action: 'cms.page.create', entityType: 'CmsPage', entityId: p.id, after: { slug: p.slug, title: p.title, status: p.status } });
    return this.page(p.id);
  }

  async updatePage(user: AuthUser, id: string, input: Partial<z.output<typeof cmsPageSchema>>) {
    const before = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Page not found');
    if (input.slug !== before.slug) this.assertSlug(input.slug);
    if (input.slug && input.slug !== before.slug && (await this.prisma.cmsPage.findUnique({ where: { slug: input.slug } }))) {
      throw new ConflictException({ message: `A page with the address /${input.slug} already exists`, code: 'DUPLICATE' });
    }
    const publishing = input.status === 'PUBLISHED' && before.status !== 'PUBLISHED';
    await this.prisma.cmsPage.update({ where: { id }, data: { ...this.pageData(input), updatedById: user.id, ...(publishing ? { publishedAt: new Date() } : {}) } });
    await this.audit.log({ actorId: user.id, action: 'cms.page.update', entityType: 'CmsPage', entityId: id, before: { slug: before.slug, title: before.title, status: before.status }, after: { slug: input.slug ?? before.slug, title: input.title ?? before.title, status: input.status ?? before.status } });
    return this.page(id);
  }

  async deletePage(user: AuthUser, id: string) {
    const before = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Page not found');
    if (before.status === 'PUBLISHED') throw new ConflictException('Unpublish the page before deleting it');
    await this.prisma.cmsPage.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'cms.page.delete', entityType: 'CmsPage', entityId: id, before: { slug: before.slug, title: before.title } });
    return { ok: true };
  }

  // ───────────────────────── Homepage sections ─────────────────────────

  homeSections() {
    return this.prisma.cmsSection.findMany({ where: { pageKey: 'home' }, orderBy: { sortOrder: 'asc' } });
  }

  async addHomeSection(user: AuthUser, input: z.output<typeof homeSectionSchema>) {
    if (await this.prisma.cmsSection.findFirst({ where: { pageKey: 'home', type: input.type } })) throw new ConflictException('This section is already on the homepage — show it instead');
    const last = await this.prisma.cmsSection.aggregate({ where: { pageKey: 'home' }, _max: { sortOrder: true } });
    const s = await this.prisma.cmsSection.create({
      data: { pageKey: 'home', type: input.type, title: input.title ?? null, subtitle: input.subtitle ?? null, isVisible: input.isVisible, config: input.config as Prisma.InputJsonValue, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await this.audit.log({ actorId: user.id, action: 'cms.home_section.create', entityType: 'CmsSection', entityId: s.id, after: s });
    return s;
  }

  async updateHomeSection(user: AuthUser, id: string, input: z.output<typeof homeSectionUpdateSchema>) {
    const before = await this.prisma.cmsSection.findFirst({ where: { id, pageKey: 'home' } });
    if (!before) throw new NotFoundException('Section not found');
    if (!(HOME_SECTION_TYPES as readonly string[]).includes(before.type)) throw new BadRequestException('Unknown section type');
    const s = await this.prisma.cmsSection.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title || null } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle || null } : {}),
        ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({ actorId: user.id, action: 'cms.home_section.update', entityType: 'CmsSection', entityId: id, before, after: s });
    return s;
  }

  async reorderHomeSections(user: AuthUser, ids: string[]) {
    const existing = await this.prisma.cmsSection.findMany({ where: { pageKey: 'home' }, select: { id: true } });
    const set = new Set(existing.map((e) => e.id));
    if (ids.length !== set.size || ids.some((id) => !set.has(id))) throw new BadRequestException('Send every homepage section exactly once');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.cmsSection.update({ where: { id }, data: { sortOrder: i } })));
    await this.audit.log({ actorId: user.id, action: 'cms.home_section.reorder', entityType: 'CmsSection', metadata: { order: ids } });
    return this.homeSections();
  }

  async deleteHomeSection(user: AuthUser, id: string) {
    const before = await this.prisma.cmsSection.findFirst({ where: { id, pageKey: 'home' } });
    if (!before) throw new NotFoundException('Section not found');
    await this.prisma.cmsSection.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'cms.home_section.delete', entityType: 'CmsSection', entityId: id, before });
    return { ok: true };
  }

  // ───────────────────────── Banners ─────────────────────────

  banners() {
    return this.prisma.cmsBanner.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }] });
  }

  private bannerData(input: Partial<z.output<typeof bannerSchema>>): Prisma.CmsBannerUncheckedUpdateInput {
    return {
      ...input,
      ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl || null } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
    };
  }

  async createBanner(user: AuthUser, input: z.output<typeof bannerSchema>) {
    if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) throw new BadRequestException({ message: 'The banner must end after it starts', details: [{ path: 'endsAt', message: 'Invalid range' }] });
    const b = await this.prisma.cmsBanner.create({ data: this.bannerData(input) as Prisma.CmsBannerUncheckedCreateInput });
    await this.audit.log({ actorId: user.id, action: 'cms.banner.create', entityType: 'CmsBanner', entityId: b.id, after: b });
    return b;
  }

  async updateBanner(user: AuthUser, id: string, input: Partial<z.output<typeof bannerSchema>>) {
    const before = await this.prisma.cmsBanner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Banner not found');
    const b = await this.prisma.cmsBanner.update({ where: { id }, data: this.bannerData(input) });
    await this.audit.log({ actorId: user.id, action: 'cms.banner.update', entityType: 'CmsBanner', entityId: id, before, after: b });
    return b;
  }

  async deleteBanner(user: AuthUser, id: string) {
    const before = await this.prisma.cmsBanner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Banner not found');
    await this.prisma.cmsBanner.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'cms.banner.delete', entityType: 'CmsBanner', entityId: id, before });
    return { ok: true };
  }

  // ───────────────────────── FAQs ─────────────────────────

  faqs() {
    return this.prisma.faq.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async createFaq(user: AuthUser, input: z.output<typeof faqSchema>) {
    const f = await this.prisma.faq.create({ data: input });
    await this.audit.log({ actorId: user.id, action: 'cms.faq.create', entityType: 'Faq', entityId: f.id, after: f });
    return f;
  }

  async updateFaq(user: AuthUser, id: string, input: Partial<z.output<typeof faqSchema>>) {
    const before = await this.prisma.faq.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('FAQ not found');
    const f = await this.prisma.faq.update({ where: { id }, data: input });
    await this.audit.log({ actorId: user.id, action: 'cms.faq.update', entityType: 'Faq', entityId: id, before, after: f });
    return f;
  }

  async deleteFaq(user: AuthUser, id: string) {
    const before = await this.prisma.faq.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('FAQ not found');
    await this.prisma.faq.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'cms.faq.delete', entityType: 'Faq', entityId: id, before });
    return { ok: true };
  }

  // ───────────────────────── SEO overrides ─────────────────────────

  seoOverrides() {
    return this.prisma.seoOverride.findMany({ orderBy: { path: 'asc' } });
  }

  private seoData(input: Partial<z.output<typeof seoOverrideSchema>>): Prisma.SeoOverrideUncheckedUpdateInput {
    return {
      ...input,
      ...(input.path ? { path: input.path.replace(/\/+$/, '') || '/' } : {}),
      ...(input.canonicalUrl !== undefined ? { canonicalUrl: input.canonicalUrl || null } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl || null } : {}),
    };
  }

  async createSeo(user: AuthUser, input: z.output<typeof seoOverrideSchema>) {
    const data = this.seoData(input) as Prisma.SeoOverrideUncheckedCreateInput;
    if (await this.prisma.seoOverride.findUnique({ where: { path: data.path } })) throw new ConflictException('An override for this path already exists');
    const s = await this.prisma.seoOverride.create({ data });
    await this.audit.log({ actorId: user.id, action: 'cms.seo.create', entityType: 'SeoOverride', entityId: s.id, after: s });
    return s;
  }

  async updateSeo(user: AuthUser, id: string, input: Partial<z.output<typeof seoOverrideSchema>>) {
    const before = await this.prisma.seoOverride.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Override not found');
    const data = this.seoData(input);
    if (typeof data.path === 'string' && data.path !== before.path && (await this.prisma.seoOverride.findUnique({ where: { path: data.path } }))) throw new ConflictException('An override for this path already exists');
    const s = await this.prisma.seoOverride.update({ where: { id }, data });
    await this.audit.log({ actorId: user.id, action: 'cms.seo.update', entityType: 'SeoOverride', entityId: id, before, after: s });
    return s;
  }

  async deleteSeo(user: AuthUser, id: string) {
    const before = await this.prisma.seoOverride.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Override not found');
    await this.prisma.seoOverride.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'cms.seo.delete', entityType: 'SeoOverride', entityId: id, before });
    return { ok: true };
  }

  // ───────────────────────── Public ─────────────────────────

  async publicPage(slug: string) {
    const p = await this.prisma.cmsPage.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { slug: true, title: true, blocks: true, seoTitle: true, seoDescription: true, canonicalUrl: true, ogImageUrl: true, noIndex: true, publishedAt: true, updatedAt: true },
    });
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  async footerLinks() {
    const rows = await this.prisma.cmsPage.findMany({ where: { status: 'PUBLISHED', showInFooter: true }, orderBy: [{ footerGroup: 'asc' }, { title: 'asc' }], select: { slug: true, title: true, footerGroup: true } });
    const groups = new Map<string, { slug: string; title: string }[]>();
    for (const r of rows) groups.set(r.footerGroup ?? 'Company', [...(groups.get(r.footerGroup ?? 'Company') ?? []), { slug: r.slug, title: r.title }]);
    return [...groups.entries()].map(([group, links]) => ({ group, links }));
  }

  publicFaqs(category?: string) {
    return this.prisma.faq.findMany({
      where: { isPublished: true, ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, category: true, question: true, answer: true },
    });
  }

  async publicSeo(path: string) {
    const clean = path.replace(/\/+$/, '') || '/';
    return (await this.prisma.seoOverride.findUnique({ where: { path: clean }, select: { path: true, title: true, description: true, canonicalUrl: true, ogImageUrl: true, noIndex: true } })) ?? null;
  }

  publicBanners(placement?: string) {
    const now = new Date();
    return this.prisma.cmsBanner.findMany({
      where: {
        isActive: true,
        ...(placement ? { placement } : {}),
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, placement: true, title: true, subtitle: true, imageUrl: true, linkUrl: true },
    });
  }

  /** Data for sitemap.xml generation on the web app. */
  async sitemapData() {
    if (!(await this.settings.getBoolean('seo.sitemapEnabled'))) return { enabled: false, properties: [], projects: [], pages: [], localities: [] };
    const [properties, projects, pages, localities] = await Promise.all([
      this.prisma.property.findMany({ where: { status: 'PUBLISHED', deletedAt: null, organization: { status: 'ACTIVE' } }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 45000 }),
      // A project whose primary address is its own domain is canonical there (listed in that domain's sitemap), not here.
      this.prisma.project.findMany({
        where: { AND: [publicProjectWhere(), { NOT: { domains: { some: { isPrimary: true, status: 'ACTIVE' } } } }] },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
      }),
      this.prisma.cmsPage.findMany({ where: { status: 'PUBLISHED', noIndex: false }, select: { slug: true, updatedAt: true } }),
      this.prisma.locality.findMany({
        where: { isActive: true, city: { isActive: true }, properties: { some: { status: 'PUBLISHED', deletedAt: null } } },
        select: { slug: true, city: { select: { slug: true } } },
      }),
    ]);
    return {
      enabled: true,
      properties: properties.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt.toISOString() })),
      projects: projects.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt.toISOString() })),
      pages: pages.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt.toISOString() })),
      localities: localities.map((l) => ({ citySlug: l.city.slug, slug: l.slug })),
    };
  }
}
