import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FORM_PROFILE_KEYS, PROPERTY_SEGMENTS, queryBoolean, slugify } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { conflict, notFound, paginated, paginationSchema, skipTake } from '../../common/http';
import { PatchPipe, UuidParam, ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TRIGRAM_MATCH_THRESHOLD, trigramSimilarity } from '../../common/fuzzy';
import { sortByEnum } from '../../common/ordering';
import { PropertySegment } from '@prisma/client';

const citySchema = z.object({
  stateId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  isActive: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
});
const localitySchema = z.object({
  cityId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80).optional(),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/).optional().nullable().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
const stateSchema = z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().toUpperCase().max(4).optional().nullable(), isActive: z.boolean().default(true) });
const propertyTypeSchema = z.object({
  segment: z.enum(PROPERTY_SEGMENTS),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  formProfile: z.enum(FORM_PROFILE_KEYS),
  allowSale: z.boolean().default(true),
  allowRent: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
const amenitySchema = z.object({
  name: z.string().trim().min(2).max(80),
  icon: z.string().trim().max(40).optional().nullable(),
  category: z.string().trim().min(2).max(40).default('General'),
  forProperties: z.boolean().default(true),
  forProjects: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

@ApiTags('Locations & catalogue')
@Controller({ version: '1' })
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Public ─────────────

  @Public()
  @Get('public/cities')
  cities() {
    return this.prisma.city.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, latitude: true, longitude: true, isFeatured: true, state: { select: { id: true, name: true, slug: true } } },
    });
  }

  @Public()
  @Get('public/cities/:slug/localities')
  async localities(@Param('slug') slug: string, @Query(new ZodPipe(z.object({ popular: queryBoolean }))) q: { popular?: boolean }) {
    const city = await this.prisma.city.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!city) notFound('City');
    const rows = await this.prisma.locality.findMany({
      where: { cityId: city.id, isActive: true, ...(q.popular ? { isPopular: true } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, pincode: true, latitude: true, longitude: true, isPopular: true, _count: { select: { properties: { where: { status: 'PUBLISHED', deletedAt: null } } } } },
    });
    return rows.map(({ _count, ...l }) => ({ ...l, activeListings: _count.properties }));
  }

  /** Active localities (with their active city) for autocomplete, cached briefly per city. */
  private readonly localityCache = new Map<string, { at: number; rows: { id: string; name: string; slug: string; pincode: string | null; citySlug: string; cityName: string }[] }>();

  private async activeLocalities(cityId: string | null) {
    const key = cityId ?? '*';
    const hit = this.localityCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.rows;
    const rows = await this.prisma.locality.findMany({
      where: { isActive: true, city: { isActive: true }, ...(cityId ? { cityId } : {}) },
      select: { id: true, name: true, slug: true, pincode: true, city: { select: { slug: true, name: true } } },
      orderBy: { name: 'asc' },
      take: 20_000,
    });
    const flat = rows.map((l) => ({ id: l.id, name: l.name, slug: l.slug, pincode: l.pincode, citySlug: l.city.slug, cityName: l.city.name }));
    this.localityCache.set(key, { at: Date.now(), rows: flat });
    return flat;
  }

  /** Autocomplete across localities, cities and projects (typo-tolerant trigram matching for localities). */
  @Public()
  @Get('public/locations/suggest')
  async suggest(@Query(new ZodPipe(z.object({ q: z.string().trim().min(1).max(60), city: z.string().max(80).optional() }))) q: { q: string; city?: string }) {
    const term = q.q;
    const lower = term.toLowerCase();
    const city = q.city ? await this.prisma.city.findFirst({ where: { slug: q.city, isActive: true }, select: { id: true } }) : null;
    // Same ranking as before: prefix matches first, then similarity, then name.
    const localities = (await this.activeLocalities(city?.id ?? null))
      .map((l) => ({ ...l, prefix: l.name.toLowerCase().startsWith(lower), contains: l.name.toLowerCase().includes(lower), score: trigramSimilarity(l.name, term) }))
      .filter((l) => l.contains || l.pincode === term || l.score >= TRIGRAM_MATCH_THRESHOLD)
      .sort((a, b) => Number(b.prefix) - Number(a.prefix) || b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 8);
    const cities = await this.prisma.city.findMany({ where: { isActive: true, name: { contains: term, mode: 'insensitive' } }, select: { id: true, name: true, slug: true }, take: 3 });
    const projects = await this.prisma.project.findMany({
      where: { isPublished: true, deletedAt: null, status: { notIn: ['DRAFT', 'ARCHIVED'] }, name: { contains: term, mode: 'insensitive' } },
      select: { id: true, name: true, slug: true, locality: { select: { name: true } } },
      take: 4,
    });
    return [
      ...cities.map((c) => ({ type: 'city' as const, id: c.id, label: c.name, sublabel: 'City', slug: c.slug, citySlug: c.slug })),
      ...localities.map((l) => ({ type: 'locality' as const, id: l.id, label: l.name, sublabel: l.cityName, slug: l.slug, citySlug: l.citySlug })),
      ...projects.map((p) => ({ type: 'project' as const, id: p.id, label: p.name, sublabel: `Project · ${p.locality.name}`, slug: p.slug, citySlug: null })),
    ];
  }

  @Public()
  @Get('public/property-types')
  async propertyTypes() {
    const rows = await this.prisma.propertyType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true, segment: true, name: true, slug: true, formProfile: true, allowSale: true, allowRent: true, description: true },
    });
    return sortByEnum(rows, (t) => t.segment, PropertySegment);
  }

  @Public()
  @Get('public/amenities')
  amenities(@Query(new ZodPipe(z.object({ for: z.enum(['property', 'project']).optional() }))) q: { for?: 'property' | 'project' }) {
    return this.prisma.amenity.findMany({
      where: { isActive: true, ...(q.for === 'property' ? { forProperties: true } : q.for === 'project' ? { forProjects: true } : {}) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, name: true, slug: true, icon: true, category: true },
    });
  }

  // ───────────── Admin: locations ─────────────

  @Get('admin/states')
  @RequirePermissions('location.manage')
  states() {
    return this.prisma.state.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { cities: true } } } });
  }

  @Post('admin/states')
  @RequirePermissions('location.manage')
  async createState(@CurrentUser() user: AuthUser, @Body(new ZodPipe(stateSchema)) body: z.output<typeof stateSchema>) {
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: 'IN' } });
    const row = await this.prisma.state.create({ data: { ...body, countryId: country.id, slug: slugify(body.name) } });
    await this.audit.log({ actorId: user.id, action: 'location.state.create', entityType: 'State', entityId: row.id, after: row });
    return row;
  }

  @Get('admin/cities')
  @RequirePermissions('location.manage')
  async adminCities(@Query(new ZodPipe(paginationSchema.extend({ q: z.string().max(80).optional(), stateId: z.uuid().optional(), active: queryBoolean }))) q: { page: number; pageSize: number; q?: string; stateId?: string; active?: boolean }) {
    const where = { ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}), ...(q.stateId ? { stateId: q.stateId } : {}), ...(q.active !== undefined ? { isActive: q.active } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.city.findMany({ where, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }], include: { state: { select: { name: true } }, _count: { select: { localities: true, properties: true, projects: true } } }, ...skipTake(q) }),
      this.prisma.city.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  @Post('admin/cities')
  @RequirePermissions('location.manage')
  async createCity(@CurrentUser() user: AuthUser, @Body(new ZodPipe(citySchema)) body: z.output<typeof citySchema>) {
    const slug = body.slug || slugify(body.name);
    if (await this.prisma.city.findUnique({ where: { slug } })) conflict(`A city with slug "${slug}" already exists — use a distinct slug (e.g. ${slug}-${body.name.slice(0, 3).toLowerCase()})`);
    const row = await this.prisma.city.create({ data: { ...body, slug } });
    await this.audit.log({ actorId: user.id, action: 'location.city.create', entityType: 'City', entityId: row.id, after: row });
    return row;
  }

  @Patch('admin/cities/:id')
  @RequirePermissions('location.manage')
  async updateCity(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(citySchema)) body: Partial<z.output<typeof citySchema>>) {
    const before = await this.prisma.city.findUnique({ where: { id } });
    if (!before) notFound('City');
    const row = await this.prisma.city.update({ where: { id }, data: body });
    await this.audit.log({ actorId: user.id, action: 'location.city.update', entityType: 'City', entityId: id, before, after: row });
    return row;
  }

  @Get('admin/localities')
  @RequirePermissions('location.manage')
  async adminLocalities(@Query(new ZodPipe(paginationSchema.extend({ q: z.string().max(80).optional(), cityId: z.uuid().optional() }))) q: { page: number; pageSize: number; q?: string; cityId?: string }) {
    const where = { ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}), ...(q.cityId ? { cityId: q.cityId } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.locality.findMany({ where, orderBy: [{ name: 'asc' }], include: { city: { select: { name: true, slug: true } }, _count: { select: { properties: true, projects: true } } }, ...skipTake(q) }),
      this.prisma.locality.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  @Post('admin/localities')
  @RequirePermissions('location.manage')
  async createLocality(@CurrentUser() user: AuthUser, @Body(new ZodPipe(localitySchema)) body: z.output<typeof localitySchema>) {
    const slug = body.slug || slugify(body.name);
    if (await this.prisma.locality.findUnique({ where: { cityId_slug: { cityId: body.cityId, slug } } })) conflict('This locality already exists in the city');
    const row = await this.prisma.locality.create({ data: { ...body, slug, pincode: body.pincode || null } });
    await this.audit.log({ actorId: user.id, action: 'location.locality.create', entityType: 'Locality', entityId: row.id, after: row });
    return row;
  }

  @Patch('admin/localities/:id')
  @RequirePermissions('location.manage')
  async updateLocality(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(localitySchema)) body: Partial<z.output<typeof localitySchema>>) {
    const before = await this.prisma.locality.findUnique({ where: { id } });
    if (!before) notFound('Locality');
    const row = await this.prisma.locality.update({ where: { id }, data: { ...body, ...(body.pincode !== undefined ? { pincode: body.pincode || null } : {}) } });
    await this.audit.log({ actorId: user.id, action: 'location.locality.update', entityType: 'Locality', entityId: id, before, after: row });
    return row;
  }

  // ───────────── Admin: catalogue ─────────────

  @Get('admin/property-types')
  @RequirePermissions('catalog.manage')
  async adminPropertyTypes() {
    const rows = await this.prisma.propertyType.findMany({ orderBy: [{ sortOrder: 'asc' }], include: { _count: { select: { properties: true } } } });
    return sortByEnum(rows, (t) => t.segment, PropertySegment);
  }

  @Post('admin/property-types')
  @RequirePermissions('catalog.manage')
  async createPropertyType(@CurrentUser() user: AuthUser, @Body(new ZodPipe(propertyTypeSchema)) body: z.output<typeof propertyTypeSchema>) {
    const slug = slugify(body.name);
    if (await this.prisma.propertyType.findUnique({ where: { slug } })) conflict('A property type with this name already exists');
    const row = await this.prisma.propertyType.create({ data: { ...body, slug } });
    await this.audit.log({ actorId: user.id, action: 'catalog.property_type.create', entityType: 'PropertyType', entityId: row.id, after: row });
    return row;
  }

  @Patch('admin/property-types/:id')
  @RequirePermissions('catalog.manage')
  async updatePropertyType(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(propertyTypeSchema)) body: Partial<z.output<typeof propertyTypeSchema>>) {
    const before = await this.prisma.propertyType.findUnique({ where: { id }, include: { _count: { select: { properties: true } } } });
    if (!before) notFound('Property type');
    if (body.formProfile && body.formProfile !== before.formProfile && before._count.properties > 0) {
      conflict('The form profile cannot change while listings use this type — create a new type instead', 'PROFILE_IN_USE');
    }
    if (body.segment && body.segment !== before.segment && before._count.properties > 0) conflict('The segment cannot change while listings use this type', 'SEGMENT_IN_USE');
    const row = await this.prisma.propertyType.update({ where: { id }, data: body });
    await this.audit.log({ actorId: user.id, action: 'catalog.property_type.update', entityType: 'PropertyType', entityId: id, before, after: row });
    return row;
  }

  @Get('admin/amenities')
  @RequirePermissions('catalog.manage')
  adminAmenities() {
    return this.prisma.amenity.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }], include: { _count: { select: { properties: true, projects: true } } } });
  }

  @Post('admin/amenities')
  @RequirePermissions('catalog.manage')
  async createAmenity(@CurrentUser() user: AuthUser, @Body(new ZodPipe(amenitySchema)) body: z.output<typeof amenitySchema>) {
    const slug = slugify(body.name);
    if (await this.prisma.amenity.findUnique({ where: { slug } })) conflict('An amenity with this name already exists');
    const row = await this.prisma.amenity.create({ data: { ...body, slug } });
    await this.audit.log({ actorId: user.id, action: 'catalog.amenity.create', entityType: 'Amenity', entityId: row.id, after: row });
    return row;
  }

  @Patch('admin/amenities/:id')
  @RequirePermissions('catalog.manage')
  async updateAmenity(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body(new PatchPipe(amenitySchema)) body: Partial<z.output<typeof amenitySchema>>) {
    const before = await this.prisma.amenity.findUnique({ where: { id } });
    if (!before) notFound('Amenity');
    const row = await this.prisma.amenity.update({ where: { id }, data: body });
    await this.audit.log({ actorId: user.id, action: 'catalog.amenity.update', entityType: 'Amenity', entityId: id, before, after: row });
    return row;
  }

  @Delete('admin/amenities/:id')
  @RequirePermissions('catalog.manage')
  async deactivateAmenity(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    const row = await this.prisma.amenity.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ actorId: user.id, action: 'catalog.amenity.deactivate', entityType: 'Amenity', entityId: id });
    return row;
  }
}
