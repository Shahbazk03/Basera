import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { bannerSchema, CONTENT_STATUSES, cmsPageSchema, faqSchema, homeSectionOrderSchema, homeSectionSchema, homeSectionUpdateSchema, seoOverrideSchema } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { CmsService } from './cms.service';

const cmsPagePartial = z.object(cmsPageSchema.shape).partial();
const bannerPartial = z.object(bannerSchema.shape).partial();
const faqPartial = z.object(faqSchema.shape).partial();
const seoPartial = z.object(seoOverrideSchema.shape).partial();

/** Keep only keys the client actually sent (partial schemas must not apply create-time defaults). */
function present<T extends object>(parsed: T, raw: unknown): Partial<T> {
  const keys = raw && typeof raw === 'object' ? Object.keys(raw as object) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => keys.includes(k))) as Partial<T>;
}

@ApiTags('CMS — administration')
@Controller({ path: 'cms', version: '1' })
export class CmsController {
  constructor(private readonly cms: CmsService) {}

  @Get('pages')
  @RequirePermissions('cms.manage')
  pages(@Query(new ZodPipe(z.object({ q: z.string().trim().max(80).optional(), status: z.enum(CONTENT_STATUSES).optional() }))) q: { q?: string; status?: (typeof CONTENT_STATUSES)[number] }) {
    return this.cms.pages(q);
  }

  @Get('pages/:id')
  @RequirePermissions('cms.manage')
  page(@Param('id', UuidParam) id: string) {
    return this.cms.page(id);
  }

  @Post('pages')
  @RequirePermissions('cms.manage')
  @ApiZodBody(cmsPageSchema)
  createPage(@CurrentUser() user: AuthUser, @Body(new ZodPipe(cmsPageSchema)) body: z.output<typeof cmsPageSchema>) {
    return this.cms.createPage(user, body);
  }

  @Patch('pages/:id')
  @RequirePermissions('cms.manage')
  updatePage(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: unknown) {
    return this.cms.updatePage(user, id, present(new ZodPipe(cmsPagePartial).transform(raw), raw));
  }

  @Delete('pages/:id')
  @RequirePermissions('cms.manage')
  deletePage(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.cms.deletePage(user, id);
  }

  @Get('home-sections')
  @RequirePermissions('cms.manage')
  homeSections() {
    return this.cms.homeSections();
  }

  @Post('home-sections')
  @RequirePermissions('cms.manage')
  addHomeSection(@CurrentUser() user: AuthUser, @Body(new ZodPipe(homeSectionSchema)) body: z.output<typeof homeSectionSchema>) {
    return this.cms.addHomeSection(user, body);
  }

  @Put('home-sections/order')
  @RequirePermissions('cms.manage')
  reorder(@CurrentUser() user: AuthUser, @Body(new ZodPipe(homeSectionOrderSchema)) body: z.output<typeof homeSectionOrderSchema>) {
    return this.cms.reorderHomeSections(user, body.ids);
  }

  @Patch('home-sections/:id')
  @RequirePermissions('cms.manage')
  updateHomeSection(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: unknown) {
    return this.cms.updateHomeSection(user, id, present(new ZodPipe(homeSectionUpdateSchema).transform(raw), raw));
  }

  @Delete('home-sections/:id')
  @RequirePermissions('cms.manage')
  deleteHomeSection(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.cms.deleteHomeSection(user, id);
  }

  @Get('banners')
  @RequirePermissions('cms.manage')
  banners() {
    return this.cms.banners();
  }

  @Post('banners')
  @RequirePermissions('cms.manage')
  @ApiZodBody(bannerSchema)
  createBanner(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bannerSchema)) body: z.output<typeof bannerSchema>) {
    return this.cms.createBanner(user, body);
  }

  @Patch('banners/:id')
  @RequirePermissions('cms.manage')
  updateBanner(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: unknown) {
    return this.cms.updateBanner(user, id, present(new ZodPipe(bannerPartial).transform(raw), raw));
  }

  @Delete('banners/:id')
  @RequirePermissions('cms.manage')
  deleteBanner(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.cms.deleteBanner(user, id);
  }

  @Get('faqs')
  @RequirePermissions('cms.manage')
  faqs() {
    return this.cms.faqs();
  }

  @Post('faqs')
  @RequirePermissions('cms.manage')
  @ApiZodBody(faqSchema)
  createFaq(@CurrentUser() user: AuthUser, @Body(new ZodPipe(faqSchema)) body: z.output<typeof faqSchema>) {
    return this.cms.createFaq(user, body);
  }

  @Patch('faqs/:id')
  @RequirePermissions('cms.manage')
  updateFaq(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: unknown) {
    return this.cms.updateFaq(user, id, present(new ZodPipe(faqPartial).transform(raw), raw));
  }

  @Delete('faqs/:id')
  @RequirePermissions('cms.manage')
  deleteFaq(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.cms.deleteFaq(user, id);
  }

  @Get('seo')
  @RequirePermissions('cms.manage')
  seo() {
    return this.cms.seoOverrides();
  }

  @Post('seo')
  @RequirePermissions('cms.manage')
  @ApiZodBody(seoOverrideSchema)
  createSeo(@CurrentUser() user: AuthUser, @Body(new ZodPipe(seoOverrideSchema)) body: z.output<typeof seoOverrideSchema>) {
    return this.cms.createSeo(user, body);
  }

  @Patch('seo/:id')
  @RequirePermissions('cms.manage')
  updateSeo(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() raw: unknown) {
    return this.cms.updateSeo(user, id, present(new ZodPipe(seoPartial).transform(raw), raw));
  }

  @Delete('seo/:id')
  @RequirePermissions('cms.manage')
  deleteSeo(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.cms.deleteSeo(user, id);
  }
}

@ApiTags('CMS — public')
@Controller({ path: 'public', version: '1' })
export class PublicCmsController {
  constructor(private readonly cms: CmsService) {}

  @Public()
  @Get('pages')
  footer() {
    return this.cms.footerLinks();
  }

  @Public()
  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.cms.publicPage(slug.toLowerCase());
  }

  @Public()
  @Get('faqs')
  faqs(@Query(new ZodPipe(z.object({ category: z.string().trim().max(60).optional() }))) q: { category?: string }) {
    return this.cms.publicFaqs(q.category);
  }

  @Public()
  @Get('seo')
  seo(@Query(new ZodPipe(z.object({ path: z.string().trim().startsWith('/').max(300) }))) q: { path: string }) {
    return this.cms.publicSeo(q.path);
  }

  @Public()
  @Get('banners')
  banners(@Query(new ZodPipe(z.object({ placement: z.string().trim().max(40).optional() }))) q: { placement?: string }) {
    return this.cms.publicBanners(q.placement);
  }

  @Public()
  @Get('sitemap-data')
  sitemap() {
    return this.cms.sitemapData();
  }
}

@Module({ controllers: [CmsController, PublicCmsController], providers: [CmsService], exports: [CmsService] })
export class CmsModule {}
