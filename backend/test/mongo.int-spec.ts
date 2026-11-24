import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { nextReference } from '../src/common/references';
import { ensureDatabaseRules } from '../src/prisma/database-rules';
import { lockInTransaction } from '../src/prisma/prisma.service';
import { createApp, createOrg, createUser, lucknowRefs, uniq, type TestContext } from './helpers';

/** The guarantees PostgreSQL gave for free and the MongoDB layer (src/prisma) now provides. */
describe('MongoDB data guarantees (integration)', () => {
  let ctx: TestContext;
  let refs: Awaited<ReturnType<typeof lucknowRefs>>;

  beforeAll(async () => {
    ctx = await createApp();
    refs = await lucknowRefs(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function createListing(orgId: string, userId: string, extra: Record<string, unknown> = {}) {
    return ctx.prisma.property.create({
      data: {
        referenceCode: uniq('TST-'),
        slug: uniq('mongo-test-listing-'),
        title: 'MongoDB test listing',
        description: 'Listing created by the MongoDB integration test.',
        propertyTypeId: refs.apartment.id,
        segment: 'RESIDENTIAL',
        listingType: 'SALE',
        sourceType: 'BROKER',
        organizationId: orgId,
        listedById: userId,
        stateId: refs.city.stateId,
        cityId: refs.city.id,
        localityId: refs.locality.id,
        area: 1200,
        areaUnit: 'SQFT',
        areaSqft: 1200,
        price: 7_500_000,
        ...extra,
      },
    });
  }

  it('writes explicit nulls so "not set" filters (deletedAt: null) match new records', async () => {
    const org = await createOrg(ctx.prisma, { type: 'BROKERAGE' });
    const raw = (await ctx.prisma.$runCommandRaw({ find: 'organizations', filter: { _id: org.id } })) as { cursor: { firstBatch: Record<string, unknown>[] } };
    expect(raw.cursor.firstBatch[0]).toHaveProperty('deletedAt', null);
    expect(await ctx.prisma.organization.count({ where: { id: org.id, deletedAt: null } })).toBe(1);
  });

  it('rejects references to missing records, and sees parents created earlier in the same transaction', async () => {
    await expect(ctx.prisma.locality.create({ data: { cityId: randomUUID(), name: 'Nowhere', slug: uniq('nowhere-') } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(ctx.prisma.locality.update({ where: { id: refs.locality.id }, data: { cityId: randomUUID() } })).rejects.toMatchObject({ code: 'P2003' });

    const locality = await ctx.prisma.$transaction(async (tx) => {
      const city = await tx.city.create({ data: { stateId: refs.city.stateId, name: uniq('Test City '), slug: uniq('test-city-'), isActive: false } });
      return tx.locality.create({ data: { cityId: city.id, name: 'Test Locality', slug: uniq('test-locality-') } });
    });
    expect(locality.cityId).toBeTruthy();
  });

  it('retries transactions that lose a write conflict, so concurrent work on one key all succeeds', async () => {
    const key = uniq('test-lock-');
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        ctx.prisma.$transaction(async (tx) => {
          await lockInTransaction(tx, key);
          await new Promise((resolve) => setTimeout(resolve, 15));
          return i;
        }),
      ),
    );
    expect([...results].sort()).toEqual([0, 1, 2, 3]);
    expect((await ctx.prisma.transactionLock.findUnique({ where: { key } }))?.version).toBe(4);
  });

  it('issues unique, consecutive reference numbers under concurrency (also inside transactions)', async () => {
    const prefix = `T${Date.now().toString(36).toUpperCase()}`;
    const plain = await Promise.all(Array.from({ length: 20 }, () => nextReference(ctx.prisma, prefix)));
    const inTx = await Promise.all(Array.from({ length: 5 }, () => ctx.prisma.$transaction((tx) => nextReference(tx, prefix))));
    const all = [...plain, ...inTx].map((r) => Number(r.split('-').pop()));
    expect(new Set(all).size).toBe(25);
    expect(Math.max(...all)).toBe(25);
  });

  it('keeps the GeoJSON location in step with latitude/longitude and finds listings nearby', async () => {
    const org = await createOrg(ctx.prisma, { type: 'BROKERAGE' });
    const user = await createUser(ctx.prisma, { roleKey: 'BROKER', organizationId: org.id, memberOf: org.id, accountType: 'BROKER' });
    const listing = await createListing(org.id, user.id, { latitude: 26.85, longitude: 80.99, status: 'PUBLISHED', publishedAt: new Date(), availableFrom: new Date('2026-12-05T15:30:00Z') });
    expect(listing.location).toEqual({ type: 'Point', coordinates: [80.99, 26.85] });
    expect(listing.availableFrom?.toISOString()).toBe('2026-12-05T00:00:00.000Z'); // calendar date, as PostgreSQL DATE stored it

    const moved = await ctx.prisma.property.update({ where: { id: listing.id }, data: { latitude: 26.86 } });
    expect(moved.location).toEqual({ type: 'Point', coordinates: [80.99, 26.86] });

    const near = await request(ctx.app.getHttpServer()).get('/api/v1/public/properties').query({ city: 'lucknow', lat: 26.861, lng: 80.991, radiusKm: 1 });
    expect(near.status).toBe(200);
    const hit = near.body.data.find((p: { id: string }) => p.id === listing.id);
    expect(hit).toBeDefined();
    expect(hit.distanceKm).toBeLessThan(1);

    // `prisma db push` (run on every deploy) drops the geo index until start-up recreates it:
    // nearby search must keep working in between.
    await ctx.prisma.$runCommandRaw({ dropIndexes: 'properties', index: 'properties_location_2dsphere' });
    const withoutIndex = await request(ctx.app.getHttpServer()).get('/api/v1/public/properties').query({ city: 'lucknow', lat: 26.861, lng: 80.991, radiusKm: 1 });
    expect(withoutIndex.body.data.some((p: { id: string }) => p.id === listing.id)).toBe(true);
    await ensureDatabaseRules(ctx.prisma);
    const far = await request(ctx.app.getHttpServer()).get('/api/v1/public/properties').query({ city: 'lucknow', lat: 26.95, lng: 80.99, radiusKm: 1 });
    expect(far.body.data.some((p: { id: string }) => p.id === listing.id)).toBe(false); // ~10 km away

    const cleared = await ctx.prisma.property.update({ where: { id: listing.id }, data: { latitude: null, longitude: null } });
    expect(cleared.location).toBeNull();
  });

  it('enforces the former CHECK constraints with collection validators', async () => {
    const org = await createOrg(ctx.prisma, { type: 'BROKERAGE' });
    await expect(
      ctx.prisma.payrollRun.create({ data: { organizationId: org.id, periodYear: 2026, periodMonth: 13, periodStart: new Date('2026-12-01'), periodEnd: new Date('2026-12-31') } }),
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '121' } });
    const user = await createUser(ctx.prisma, { roleKey: 'BROKER', organizationId: org.id, memberOf: org.id, accountType: 'BROKER' });
    await expect(createListing(org.id, user.id, { price: -1 })).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows many users without a phone but only one per email', async () => {
    const a = await createUser(ctx.prisma);
    const b = await createUser(ctx.prisma);
    expect(a.phone).toBeNull();
    expect(b.phone).toBeNull();
    await expect(ctx.prisma.user.create({ data: { email: a.email, fullName: 'Duplicate', passwordHash: 'x', accountType: 'STAFF' } })).rejects.toMatchObject({
      code: 'P2002',
      meta: { target: 'users_email_key' },
    });
  });

  it('treats search text literally (Prisma turns text filters into unescaped regular expressions)', async () => {
    const org = await createOrg(ctx.prisma, { type: 'BROKERAGE', name: uniq('Literal (Search) Co+ ') });
    const name = (await ctx.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).name;
    // reused where object: escaping must not be applied twice
    const where = { id: org.id, name: { contains: name } };
    expect(await ctx.prisma.organization.count({ where })).toBe(1);
    expect(await ctx.prisma.organization.count({ where })).toBe(1);
    expect(await ctx.prisma.organization.count({ where: { id: org.id, name: { startsWith: 'Literal (Search)' } } })).toBe(1);
    expect(await ctx.prisma.organization.count({ where: { id: org.id, name: { equals: name.toUpperCase(), mode: 'insensitive' } } })).toBe(1);
    // patterns are not interpreted
    expect(await ctx.prisma.organization.count({ where: { id: org.id, name: { contains: 'Literal .Search' } } })).toBe(0);
    expect(await ctx.prisma.organization.count({ where: { id: org.id, name: { equals: 'literal.*', mode: 'insensitive' } } })).toBe(0);
    expect(await ctx.prisma.organization.count({ where: { id: org.id, name: { in: ['.*'], mode: 'insensitive' } } })).toBe(0);
    // nested filters inside include/select are escaped too
    const withCount = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { _count: { select: { members: { where: { title: { contains: '(' } } } } } } });
    expect(withCount._count.members).toBe(0);
  });

  it('runs a scheduled job on one instance at a time', async () => {
    const key = uniq('jobs:test-');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = ctx.prisma.withJobLock(key, async () => {
      await gate;
      return 'first';
    }, { transactional: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await ctx.prisma.withJobLock(key, async () => 'second', { transactional: false })).toBeNull();
    release();
    expect(await first).toBe('first');
    expect(await ctx.prisma.withJobLock(key, async () => 'third')).toBe('third');
  });
});
