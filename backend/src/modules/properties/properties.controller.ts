import { Body, Controller, Delete, Get, Injectable, Logger, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  MEDIA_TYPES,
  PROPERTY_DOCUMENT_TYPES,
  PROPERTY_STATUSES,
  propertyCreateSchema,
  propertyReportSchema,
  propertySearchSchema,
  propertyTransitionSchema,
  propertyUpdateSchema,
  queryBoolean,
} from '@estate/shared';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiZodBody, ApiZodQuery, CurrentUser, OptionalUser, Public, RequirePermissions } from '../../common/decorators';
import { paginationSchema } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertiesService } from './properties.service';
import { PropertySearchService } from './property-search.service';

const manageQuery = paginationSchema.extend({
  status: z.enum(PROPERTY_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  organizationId: z.uuid().optional(),
  listingType: z.enum(['SALE', 'RENT']).optional(),
  verification: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
  mine: queryBoolean,
});
const mediaSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(MEDIA_TYPES).optional(),
        fileId: z.uuid().optional(),
        url: z.string().max(2000).optional(),
        caption: z.string().trim().max(200).optional().nullable(),
        isCover: z.boolean().optional(),
      }),
    )
    .max(40),
});
const documentSchema = z.object({
  docType: z.enum(PROPERTY_DOCUMENT_TYPES),
  title: z.string().trim().min(2).max(160),
  fileId: z.uuid(),
  visibility: z.enum(['PRIVATE', 'PUBLIC', 'ON_REQUEST']).default('PRIVATE'),
});

@ApiTags('Properties — public')
@Controller({ path: 'public/properties', version: '1' })
export class PublicPropertiesController {
  constructor(
    private readonly search: PropertySearchService,
    private readonly properties: PropertiesService,
  ) {}

  @Public()
  @Get()
  @ApiZodQuery(propertySearchSchema)
  find(@Query(new ZodPipe(propertySearchSchema)) q: z.output<typeof propertySearchSchema>) {
    return this.search.search(q);
  }

  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string, @OptionalUser() user?: AuthUser) {
    return this.search.detail(slug, user);
  }

  @Public()
  @Get(':slug/similar')
  similar(@Param('slug') slug: string) {
    return this.search.similar(slug);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/report')
  @ApiZodBody(propertyReportSchema)
  report(@Param('id', UuidParam) id: string, @Body(new ZodPipe(propertyReportSchema)) body: z.output<typeof propertyReportSchema>, @OptionalUser() user?: AuthUser) {
    return this.properties.report(id, body, user);
  }
}

@ApiTags('Account')
@Controller({ path: 'me', version: '1' })
export class AccountController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly search: PropertySearchService,
  ) {}

  @Get('favourites')
  async favourites(@CurrentUser() user: AuthUser) {
    const favs = await this.properties.favourites(user);
    const cards = await this.search.cards({ id: { in: favs.map((f) => f.propertyId) } }, 100);
    const byId = new Map(cards.map((c) => [c.id, c]));
    return { ids: favs.map((f) => f.propertyId), properties: favs.map((f) => byId.get(f.propertyId)).filter(Boolean) };
  }

  @Post('favourites/:propertyId')
  add(@CurrentUser() user: AuthUser, @Param('propertyId', UuidParam) id: string) {
    return this.properties.addFavourite(user, id);
  }

  @Delete('favourites/:propertyId')
  remove(@CurrentUser() user: AuthUser, @Param('propertyId', UuidParam) id: string) {
    return this.properties.removeFavourite(user, id);
  }
}

@ApiTags('Properties — manage')
@Controller({ path: 'properties', version: '1' })
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @RequirePermissions('property.view_all')
  @ApiZodQuery(manageQuery)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(manageQuery)) q: z.output<typeof manageQuery>) {
    return this.properties.list(user, q);
  }

  @Post()
  @RequirePermissions('property.create')
  @ApiZodBody(propertyCreateSchema)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(propertyCreateSchema)) body: z.output<typeof propertyCreateSchema>) {
    return this.properties.create(user, body);
  }

  @Get(':id')
  @RequirePermissions('property.view_all')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.properties.getForManage(user, id);
  }

  @Patch(':id')
  @RequirePermissions('property.edit')
  @ApiZodBody(propertyUpdateSchema)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(propertyUpdateSchema)) body: z.output<typeof propertyUpdateSchema>) {
    return this.properties.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('property.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.properties.softDelete(user, id);
  }

  @Post(':id/transition')
  @ApiZodBody(propertyTransitionSchema)
  transition(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(propertyTransitionSchema)) body: z.output<typeof propertyTransitionSchema>) {
    return this.properties.transition(user, id, body.action, body.reason);
  }

  @Put(':id/media')
  @RequirePermissions('property.edit')
  media(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(mediaSchema)) body: z.output<typeof mediaSchema>) {
    return this.properties.replaceMedia(user, id, body.items);
  }

  @Post(':id/documents')
  @RequirePermissions('property.edit')
  addDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(documentSchema)) body: z.output<typeof documentSchema>) {
    return this.properties.addDocument(user, id, body);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('property.edit')
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Param('docId', UuidParam) docId: string) {
    return this.properties.removeDocument(user, id, docId);
  }

  @Patch(':id/availability')
  @RequirePermissions('property.edit')
  availability(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ availability: z.enum(['AVAILABLE', 'ON_HOLD', 'UNDER_OFFER']) }))) body: { availability: 'AVAILABLE' | 'ON_HOLD' | 'UNDER_OFFER' }) {
    return this.properties.setAvailability(user, id, body.availability);
  }

  @Post(':id/verification')
  @RequirePermissions('property.approve')
  verification(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ status: z.enum(['VERIFIED', 'REJECTED', 'PENDING']), note: z.string().max(500).optional() }))) body: { status: 'VERIFIED' | 'REJECTED' | 'PENDING'; note?: string }) {
    return this.properties.setVerification(user, id, body.status, body.note);
  }

  @Post(':id/feature')
  @RequirePermissions('property.feature')
  feature(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ featured: z.boolean(), days: z.coerce.number().int().min(1).max(365).optional() }))) body: { featured: boolean; days?: number }) {
    return this.properties.setFeatured(user, id, body.featured, body.days);
  }
}

@ApiTags('Properties — reports')
@Controller({ path: 'admin/property-reports', version: '1' })
export class PropertyReportsController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @RequirePermissions('property.report.manage')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema.extend({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional() }))) q: { page: number; pageSize: number; status?: 'OPEN' | 'RESOLVED' | 'DISMISSED' }) {
    return this.properties.listReports(user, q);
  }

  @Post(':id/resolve')
  @RequirePermissions('property.report.manage')
  resolve(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new ZodPipe(z.object({ status: z.enum(['RESOLVED', 'DISMISSED']), resolution: z.string().trim().min(3).max(1000) }))) body: { status: 'RESOLVED' | 'DISMISSED'; resolution: string }) {
    return this.properties.resolveReport(user, id, body.status, body.resolution);
  }
}

/** Hourly listing maintenance (single-instance via a job lease). */
@Injectable()
export class PropertiesScheduler {
  private readonly logger = new Logger('PropertiesScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    const expired = await this.prisma.withJobLock('jobs:property-expiry', (tx) => this.properties.expireListings(tx));
    if (expired) this.logger.log(`Expired ${expired} listing(s)`);
  }
}
