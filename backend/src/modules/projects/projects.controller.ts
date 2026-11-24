import { Body, Controller, Delete, Get, Header, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  constructionUpdateSchema,
  DOCUMENT_VISIBILITIES,
  domainCreateSchema,
  MEDIA_TYPES,
  PROJECT_STATUSES,
  projectBlockSchema,
  projectCreateSchema,
  projectDocumentSchema,
  projectFaqSchema,
  projectNearbySchema,
  projectReviewSchema,
  projectSearchSchema,
  projectStatusChangeSchema,
  projectTeamMemberSchema,
  PROJECT_TEAM_ROLES,
  projectUnitSchema,
  projectUnitUpdateSchema,
  projectUpdateSchema,
  REVIEW_STATUSES,
  UNIT_STATUSES,
  UNIT_TYPES,
  unitBulkCreateSchema,
  unitReserveSchema,
  unitStatusChangeSchema,
} from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, ApiZodQuery, CurrentUser, OptionalUser, Public, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { PatchPipe, UuidParam, ZodPipe } from '../../common/zod.pipe';
import { DomainsService } from './domains.service';
import { InventoryService } from './inventory.service';
import { PageService } from './page.service';
import { ProjectPublicService } from './project-public.service';
import { ProjectsScheduler } from './projects.scheduler';
import { ProjectsService } from './projects.service';

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

const listQuery = paginationSchema.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
  review: z.enum(REVIEW_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  organizationId: z.uuid().optional(),
  published: boolParam.optional(),
});
const mediaSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(MEDIA_TYPES).optional(),
        fileId: z.uuid().optional(),
        url: z.string().max(2000).optional(),
        caption: z.string().trim().max(200).optional().nullable(),
      }),
    )
    .max(80),
});
const reviewSchema = projectReviewSchema.extend({ publish: z.boolean().optional() });
const docUpdateSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), visibility: z.enum(DOCUMENT_VISIBILITIES).optional() });
const teamUpdateSchema = z.object({ role: z.enum(PROJECT_TEAM_ROLES).optional(), isPrimaryContact: z.boolean().optional() });
const unitListQuery = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(UNIT_STATUSES).optional(),
  blockId: z.union([z.uuid(), z.literal('none')]).optional(),
  unitType: z.enum(UNIT_TYPES).optional(),
  q: z.string().trim().max(40).optional(),
});
const unitStatusBody = unitStatusChangeSchema.extend({ holdHours: z.coerce.number().int().min(1).max(24 * 30).optional() });
const unitUpdateBody = projectUnitUpdateSchema.extend({ expectedVersion: z.coerce.number().int().min(0).optional() });

// ───────────────────────── Project management ─────────────────────────

@ApiTags('Projects — manage')
@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly scheduler: ProjectsScheduler,
  ) {}

  @Get()
  @RequirePermissions('project.view_all')
  @ApiZodQuery(listQuery)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>) {
    return this.projects.list(user, q);
  }

  @Get('options/developers')
  @RequirePermissions('project.create')
  developerOptions(@CurrentUser() user: AuthUser) {
    return this.projects.developerOptions(user);
  }

  /** Runs the lifecycle job immediately (operations tooling); normally it runs every minute. */
  @Post('jobs/sync-status')
  @RequirePermissions('settings.manage')
  runJob() {
    return this.scheduler.runStatusJobNow().then((r) => r ?? { skipped: 'Another instance is running the job' });
  }

  @Post()
  @RequirePermissions('project.create')
  @ApiZodBody(projectCreateSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(projectCreateSchema)) body: z.output<typeof projectCreateSchema>) {
    return this.projects.create(user, body);
  }

  @Get(':id')
  @RequirePermissions('project.view_all')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.getForManage(user, id);
  }

  @Patch(':id')
  @RequirePermissions('project.edit')
  @ApiZodBody(projectUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectUpdateSchema)) body: z.output<typeof projectUpdateSchema>) {
    return this.projects.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('project.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.remove(user, id);
  }

  @Post(':id/review/submit')
  @RequirePermissions('project.edit')
  submit(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.submitForReview(user, id);
  }

  @Post(':id/review/decision')
  @RequirePermissions('project.approve')
  @ApiZodBody(reviewSchema)
  decide(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(reviewSchema)) body: z.output<typeof reviewSchema>) {
    return this.projects.decide(user, id, body.decision, body.note, body.publish);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.setPublished(user, id, true);
  }

  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.setPublished(user, id, false);
  }

  @Post(':id/feature')
  @RequirePermissions('project.publish')
  feature(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ featured: z.boolean() }))) body: { featured: boolean }) {
    return this.projects.setFeatured(user, id, body.featured);
  }

  @Post(':id/status')
  @RequirePermissions('project.edit')
  @ApiZodBody(projectStatusChangeSchema)
  status(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectStatusChangeSchema)) body: z.output<typeof projectStatusChangeSchema>) {
    return this.projects.changeStatus(user, id, body.status, body.reason);
  }

  @Get(':id/history')
  @RequirePermissions('project.view_all')
  history(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.history(user, id);
  }

  @Put(':id/media')
  @RequirePermissions('project.edit')
  media(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(mediaSchema)) body: z.output<typeof mediaSchema>) {
    return this.projects.replaceMedia(user, id, body.items);
  }

  @Post(':id/documents')
  @RequirePermissions('project.edit')
  addDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectDocumentSchema)) body: z.output<typeof projectDocumentSchema>) {
    return this.projects.addDocument(user, id, body);
  }

  @Patch(':id/documents/:docId')
  @RequirePermissions('project.edit')
  updateDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('docId', UuidParam) docId: string, @Body(new ZodPipe(docUpdateSchema)) body: z.output<typeof docUpdateSchema>) {
    return this.projects.updateDocument(user, id, docId, body);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('project.edit')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('docId', UuidParam) docId: string) {
    return this.projects.removeDocument(user, id, docId);
  }

  @Post(':id/nearby')
  @RequirePermissions('project.edit')
  addNearby(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectNearbySchema)) body: z.output<typeof projectNearbySchema>) {
    return this.projects.addNearby(user, id, body);
  }

  @Patch(':id/nearby/:itemId')
  @RequirePermissions('project.edit')
  updateNearby(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('itemId', UuidParam) itemId: string, @Body(new PatchPipe(projectNearbySchema)) body: Partial<z.output<typeof projectNearbySchema>>) {
    return this.projects.updateNearby(user, id, itemId, body);
  }

  @Delete(':id/nearby/:itemId')
  @RequirePermissions('project.edit')
  removeNearby(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('itemId', UuidParam) itemId: string) {
    return this.projects.removeNearby(user, id, itemId);
  }

  @Post(':id/faqs')
  @RequirePermissions('project.edit')
  addFaq(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectFaqSchema)) body: z.output<typeof projectFaqSchema>) {
    return this.projects.addFaq(user, id, body);
  }

  @Patch(':id/faqs/:itemId')
  @RequirePermissions('project.edit')
  updateFaq(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('itemId', UuidParam) itemId: string, @Body(new PatchPipe(projectFaqSchema)) body: Partial<z.output<typeof projectFaqSchema>>) {
    return this.projects.updateFaq(user, id, itemId, body);
  }

  @Delete(':id/faqs/:itemId')
  @RequirePermissions('project.edit')
  removeFaq(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('itemId', UuidParam) itemId: string) {
    return this.projects.removeFaq(user, id, itemId);
  }

  @Post(':id/construction-updates')
  @RequirePermissions('project.edit')
  addUpdate(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(constructionUpdateSchema)) body: z.output<typeof constructionUpdateSchema>) {
    return this.projects.addUpdate(user, id, body);
  }

  @Patch(':id/construction-updates/:itemId')
  @RequirePermissions('project.edit')
  updateUpdate(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('itemId', UuidParam) itemId: string, @Body(new PatchPipe(constructionUpdateSchema)) body: Partial<z.output<typeof constructionUpdateSchema>>) {
    return this.projects.updateUpdate(user, id, itemId, body);
  }

  @Delete(':id/construction-updates/:itemId')
  @RequirePermissions('project.edit')
  removeUpdate(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('itemId', UuidParam) itemId: string) {
    return this.projects.removeUpdate(user, id, itemId);
  }

  @Get(':id/team/candidates')
  @RequirePermissions('project.edit')
  teamCandidates(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.projects.teamCandidates(user, id);
  }

  @Post(':id/team')
  @RequirePermissions('project.edit')
  addTeam(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectTeamMemberSchema)) body: z.output<typeof projectTeamMemberSchema>) {
    return this.projects.addTeamMember(user, id, body);
  }

  @Patch(':id/team/:memberId')
  @RequirePermissions('project.edit')
  updateTeam(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('memberId', UuidParam) memberId: string, @Body(new ZodPipe(teamUpdateSchema)) body: z.output<typeof teamUpdateSchema>) {
    return this.projects.updateTeamMember(user, id, memberId, body);
  }

  @Delete(':id/team/:memberId')
  @RequirePermissions('project.edit')
  removeTeam(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('memberId', UuidParam) memberId: string) {
    return this.projects.removeTeamMember(user, id, memberId);
  }
}

// ───────────────────────── Inventory ─────────────────────────

@ApiTags('Projects — inventory')
@Controller({ version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('projects/:id/blocks')
  @RequirePermissions('project.view_all')
  blocks(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.inventory.blocks(user, id);
  }

  @Post('projects/:id/blocks')
  @RequirePermissions('project.inventory.manage')
  createBlock(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectBlockSchema)) body: z.output<typeof projectBlockSchema>) {
    return this.inventory.createBlock(user, id, body);
  }

  @Patch('projects/:id/blocks/:blockId')
  @RequirePermissions('project.inventory.manage')
  updateBlock(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('blockId', UuidParam) blockId: string, @Body(new PatchPipe(projectBlockSchema)) body: Partial<z.output<typeof projectBlockSchema>>) {
    return this.inventory.updateBlock(user, id, blockId, body);
  }

  @Delete('projects/:id/blocks/:blockId')
  @RequirePermissions('project.inventory.manage')
  deleteBlock(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('blockId', UuidParam) blockId: string) {
    return this.inventory.deleteBlock(user, id, blockId);
  }

  @Get('projects/:id/units')
  @RequirePermissions('project.view_all')
  @ApiZodQuery(unitListQuery)
  units(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Query(new ZodPipe(unitListQuery)) q: z.output<typeof unitListQuery>) {
    return this.inventory.listUnits(user, id, q);
  }

  @Get('projects/:id/inventory/summary')
  @RequirePermissions('project.view_all')
  summary(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.inventory.summary(user, id);
  }

  @Post('projects/:id/units')
  @RequirePermissions('project.inventory.manage')
  @ApiZodBody(projectUnitSchema)
  createUnit(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(projectUnitSchema)) body: z.output<typeof projectUnitSchema>) {
    return this.inventory.createUnit(user, id, body);
  }

  @Post('projects/:id/units/bulk')
  @RequirePermissions('project.inventory.manage')
  @ApiZodBody(unitBulkCreateSchema)
  bulk(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(unitBulkCreateSchema)) body: z.output<typeof unitBulkCreateSchema>) {
    return this.inventory.bulkCreate(user, id, body);
  }

  @Patch('project-units/:unitId')
  @RequirePermissions('project.inventory.manage')
  updateUnit(@CurrentUser() user: AuthUser, @Param('unitId', UuidParam) unitId: string, @Body(new ZodPipe(unitUpdateBody)) body: z.output<typeof unitUpdateBody>) {
    return this.inventory.updateUnit(user, unitId, body);
  }

  @Delete('project-units/:unitId')
  @RequirePermissions('project.inventory.manage')
  deleteUnit(@CurrentUser() user: AuthUser, @Param('unitId', UuidParam) unitId: string) {
    return this.inventory.deleteUnit(user, unitId);
  }

  @Post('project-units/:unitId/status')
  @RequirePermissions('project.inventory.manage')
  @ApiZodBody(unitStatusBody)
  unitStatus(@CurrentUser() user: AuthUser, @Param('unitId', UuidParam) unitId: string, @Body(new ZodPipe(unitStatusBody)) body: z.output<typeof unitStatusBody>) {
    return this.inventory.changeStatus(user, unitId, body);
  }

  @Post('project-units/:unitId/reserve')
  @RequirePermissions('project.inventory.manage')
  @ApiZodBody(unitReserveSchema)
  reserve(@CurrentUser() user: AuthUser, @Param('unitId', UuidParam) unitId: string, @Body(new ZodPipe(unitReserveSchema)) body: z.output<typeof unitReserveSchema>) {
    return this.inventory.reserve(user, unitId, body);
  }

  @Post('project-units/:unitId/release')
  @RequirePermissions('project.inventory.manage')
  release(@CurrentUser() user: AuthUser, @Param('unitId', UuidParam) unitId: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().max(500).optional() }))) body: { reason?: string }) {
    return this.inventory.release(user, unitId, body.reason);
  }

  @Get('project-units/:unitId/history')
  @RequirePermissions('project.view_all')
  unitHistory(@CurrentUser() user: AuthUser, @Param('unitId', UuidParam) unitId: string) {
    return this.inventory.history(user, unitId);
  }
}

// ───────────────────────── Domains ─────────────────────────

@ApiTags('Projects — domains')
@Controller({ version: '1' })
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get('projects/:id/domains')
  @RequirePermissions('project.domain.manage')
  list(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.domains.list(user, id);
  }

  @Post('projects/:id/domains')
  @RequirePermissions('project.domain.manage')
  @ApiZodBody(domainCreateSchema)
  add(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(domainCreateSchema)) body: z.output<typeof domainCreateSchema>) {
    return this.domains.add(user, id, body);
  }

  @Post('project-domains/:domainId/verify')
  @RequirePermissions('project.domain.manage')
  verify(@CurrentUser() user: AuthUser, @Param('domainId', UuidParam) id: string) {
    return this.domains.verify(user, id);
  }

  @Post('project-domains/:domainId/enable')
  @RequirePermissions('project.domain.manage')
  enable(@CurrentUser() user: AuthUser, @Param('domainId', UuidParam) id: string) {
    return this.domains.enable(user, id);
  }

  @Post('project-domains/:domainId/disable')
  @RequirePermissions('project.domain.manage')
  disable(@CurrentUser() user: AuthUser, @Param('domainId', UuidParam) id: string) {
    return this.domains.disable(user, id);
  }

  @Post('project-domains/:domainId/primary')
  @RequirePermissions('project.domain.manage')
  primary(@CurrentUser() user: AuthUser, @Param('domainId', UuidParam) id: string) {
    return this.domains.setPrimary(user, id);
  }

  @Post('project-domains/:domainId/check-ssl')
  @RequirePermissions('project.domain.manage')
  checkSsl(@CurrentUser() user: AuthUser, @Param('domainId', UuidParam) id: string) {
    return this.domains.checkSsl(user, id);
  }

  @Delete('project-domains/:domainId')
  @RequirePermissions('project.domain.manage')
  remove(@CurrentUser() user: AuthUser, @Param('domainId', UuidParam) id: string) {
    return this.domains.remove(user, id);
  }

  /** Host → project mapping used by the public web app's proxy. */
  @Public()
  @SkipThrottle()
  @Get('public/domains/resolve')
  @Header('Cache-Control', 'public, max-age=30')
  resolve(@Query(new ZodPipe(z.object({ host: z.string().trim().min(1).max(260) }))) q: { host: string }) {
    return this.domains.resolve(q.host);
  }

  /** Caddy on-demand TLS "ask" endpoint — 200 only for active mapped domains. */
  @Public()
  @SkipThrottle()
  @Get('public/domains/tls-check')
  async tlsCheck(@Query(new ZodPipe(z.object({ domain: z.string().trim().min(1).max(260) }))) q: { domain: string }) {
    if (!(await this.domains.tlsAllowed(q.domain))) throw new NotFoundException('Domain not allowed');
    return { ok: true };
  }
}

// ───────────────────────── Page builder ─────────────────────────

@ApiTags('Projects — page builder')
@Controller({ path: 'projects/:id/page', version: '1' })
export class PageController {
  constructor(private readonly pages: PageService) {}

  @Get()
  @RequirePermissions('project.view_all')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.pages.get(user, id);
  }

  @Put('draft')
  @RequirePermissions('project.page.manage')
  saveDraft(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ sections: z.array(z.unknown()).max(40) }))) body: { sections: unknown[] }) {
    return this.pages.saveDraft(user, id, body.sections);
  }

  @Post('publish')
  @RequirePermissions('project.page.manage')
  publish(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.pages.publish(user, id);
  }

  @Post('preview-token')
  @RequirePermissions('project.page.manage')
  previewToken(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.pages.createPreviewToken(user, id);
  }

  @Get('revisions')
  @RequirePermissions('project.view_all')
  revisions(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.pages.revisions(user, id);
  }

  @Post('revisions/:revision/restore')
  @RequirePermissions('project.page.manage')
  restore(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('revision', ParseIntPipe) revision: number) {
    return this.pages.restore(user, id, revision);
  }
}

// ───────────────────────── Public ─────────────────────────

@ApiTags('Projects — public')
@Controller({ path: 'public/projects', version: '1' })
export class PublicProjectsController {
  constructor(private readonly publicProjects: ProjectPublicService) {}

  @Public()
  @Get()
  @ApiZodQuery(projectSearchSchema)
  search(@Query(new ZodPipe(projectSearchSchema)) q: z.output<typeof projectSearchSchema>) {
    return this.publicProjects.search(q);
  }

  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string, @Query(new ZodPipe(z.object({ preview: z.string().max(200).optional() }))) q: { preview?: string }, @OptionalUser() user?: AuthUser) {
    return this.publicProjects.detail(slug, { previewToken: q.preview, user });
  }

  @Public()
  @Get(':slug/related')
  related(@Param('slug') slug: string) {
    return this.publicProjects.related(slug);
  }

  @Public()
  @Get(':slug/documents/:docId/url')
  documentUrl(@Param('slug') slug: string, @Param('docId', UuidParam) docId: string) {
    return this.publicProjects.documentUrl(slug, docId);
  }
}
