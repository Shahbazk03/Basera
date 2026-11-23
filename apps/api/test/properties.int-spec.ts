import request from 'supertest';
import { createApp, createOrg, createUser, loginAgent, lucknowRefs, ORIGIN, tinyPng, uniq, type TestContext } from './helpers';

describe('Listing workflow (integration)', () => {
  let ctx: TestContext;
  let refs: Awaited<ReturnType<typeof lucknowRefs>>;
  let brokerA: Awaited<ReturnType<typeof loginAgent>>;
  let brokerB: Awaited<ReturnType<typeof loginAgent>>;
  let reviewer: Awaited<ReturnType<typeof loginAgent>>;
  let orgA: { id: string };
  let pendingOrg: { id: string };
  let pendingBroker: Awaited<ReturnType<typeof loginAgent>>;

  const apartment = () => ({
    title: `${uniq('Integration 3 BHK ')} in Gomti Nagar`,
    description: 'Spacious three bedroom apartment with park view, modular kitchen and two covered parkings.',
    propertyTypeId: refs.apartment.id,
    listingType: 'SALE',
    cityId: refs.city.id,
    localityId: refs.locality.id,
    area: 1500,
    areaUnit: 'SQFT',
    price: 9500000,
    bedrooms: 3,
    bathrooms: 3,
    furnishing: 'SEMI_FURNISHED',
    floorNumber: 4,
    totalFloors: 12,
    possessionStatus: 'READY_TO_MOVE',
    ownerName: 'Private Owner',
    ownerPhone: '+919999999999',
  });

  async function withPhoto(agent: Awaited<ReturnType<typeof loginAgent>>, id: string, orgId: string) {
    const upload = await agent.post('/api/v1/files').set('Origin', ORIGIN).field('purpose', 'property-media').field('organizationId', orgId).attach('file', await tinyPng(), 'photo.png');
    expect(upload.status).toBe(201);
    expect(upload.body.mimeType).toBe('image/webp'); // re-encoded server-side
    const media = await agent.put(`/api/v1/properties/${id}/media`).set('Origin', ORIGIN).send({ items: [{ fileId: upload.body.id, isCover: true }] });
    expect(media.status).toBe(200);
  }

  beforeAll(async () => {
    ctx = await createApp();
    refs = await lucknowRefs(ctx.prisma);
    orgA = await createOrg(ctx.prisma, { type: 'BROKERAGE' });
    const orgB = await createOrg(ctx.prisma, { type: 'BROKERAGE' });
    pendingOrg = await createOrg(ctx.prisma, { type: 'BROKERAGE', status: 'PENDING' });
    const a = await createUser(ctx.prisma, { roleKey: 'BROKER', organizationId: orgA.id, memberOf: orgA.id, accountType: 'BROKER' });
    const b = await createUser(ctx.prisma, { roleKey: 'BROKER', organizationId: orgB.id, memberOf: orgB.id, accountType: 'BROKER' });
    const p = await createUser(ctx.prisma, { roleKey: 'BROKER', organizationId: pendingOrg.id, memberOf: pendingOrg.id, accountType: 'BROKER' });
    const r = await createUser(ctx.prisma, { roleKey: 'OPERATIONS_MANAGER' });
    brokerA = await loginAgent(ctx, a.email!);
    brokerB = await loginAgent(ctx, b.email!);
    pendingBroker = await loginAgent(ctx, p.email!);
    reviewer = await loginAgent(ctx, r.email!);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('enforces category-specific fields', async () => {
    const res = await brokerA.post('/api/v1/properties').set('Origin', ORIGIN).send({ ...apartment(), bedrooms: null, furnishing: null, plotLengthFt: 40 });
    expect(res.status).toBe(400);
    const paths = (res.body.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['bedrooms', 'furnishing', 'plotLengthFt']));
  });

  it('runs draft → review → published → re-review on material edit → sold, with public visibility rules', async () => {
    const create = await brokerA.post('/api/v1/properties').set('Origin', ORIGIN).send(apartment());
    expect(create.status).toBe(201);
    const id = create.body.id as string;
    expect(create.body.status).toBe('DRAFT');
    expect(create.body.sourceType).toBe('BROKER');

    const noPhoto = await brokerA.post(`/api/v1/properties/${id}/transition`).set('Origin', ORIGIN).send({ action: 'submit' });
    expect(noPhoto.status).toBe(409);
    expect(noPhoto.body.code).toBe('PHOTOS_REQUIRED');

    await withPhoto(brokerA, id, orgA.id);
    const submit = await brokerA.post(`/api/v1/properties/${id}/transition`).set('Origin', ORIGIN).send({ action: 'submit' });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe('PENDING_REVIEW');

    // Listers cannot approve their own listings
    const selfApprove = await brokerA.post(`/api/v1/properties/${id}/transition`).set('Origin', ORIGIN).send({ action: 'approve' });
    expect(selfApprove.status).toBe(403);

    // Other organisations cannot see or edit it
    expect((await brokerB.get(`/api/v1/properties/${id}`)).status).toBe(404);
    expect((await brokerB.patch(`/api/v1/properties/${id}`).set('Origin', ORIGIN).send({ price: 1 })).status).toBe(403);

    // Not public while in review
    const server = ctx.app.getHttpServer();
    const slug = create.body.slug as string;
    expect((await request(server).get(`/api/v1/public/properties/${slug}`)).status).toBe(404);

    const approve = await reviewer.post(`/api/v1/properties/${id}/transition`).set('Origin', ORIGIN).send({ action: 'approve' });
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('PUBLISHED'); // auto-publish on approval (setting default)

    const pub = await request(server).get(`/api/v1/public/properties/${slug}`);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).not.toContain('9999999999'); // private owner phone never exposed
    expect(pub.body).not.toHaveProperty('ownerName');
    const search = await request(server).get('/api/v1/public/properties').query({ q: create.body.title, listingType: 'SALE' });
    expect(search.body.data.map((p: { id: string }) => p.id)).toContain(id);

    // Material edit by the lister sends it back to review and removes it from the marketplace
    const edit = await brokerA.patch(`/api/v1/properties/${id}`).set('Origin', ORIGIN).send({ price: 9900000 });
    expect(edit.status).toBe(200);
    expect(edit.body.status).toBe('PENDING_REVIEW');
    expect((await request(server).get(`/api/v1/public/properties/${slug}`)).status).toBe(404);

    expect((await reviewer.post(`/api/v1/properties/${id}/transition`).set('Origin', ORIGIN).send({ action: 'approve' })).body.status).toBe('PUBLISHED');

    // SOLD is not available for rent listings and removes the listing from search
    const sold = await brokerA.post(`/api/v1/properties/${id}/transition`).set('Origin', ORIGIN).send({ action: 'mark_sold' });
    expect(sold.status).toBe(201);
    expect(sold.body.status).toBe('SOLD');
    const afterSale = await request(server).get('/api/v1/public/properties').query({ q: create.body.title, listingType: 'SALE' });
    expect(afterSale.body.data.map((p: { id: string }) => p.id)).not.toContain(id);
    const soldDetail = await request(server).get(`/api/v1/public/properties/${slug}`);
    expect(soldDetail.status).toBe(200);
    expect(soldDetail.body.status).toBe('SOLD');

    const history = await ctx.prisma.propertyStatusHistory.findMany({ where: { propertyId: id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'SOLD']);
    expect(await ctx.prisma.auditLog.count({ where: { entityType: 'Property', entityId: id } })).toBeGreaterThanOrEqual(6);
  });

  it('does not let listings of unverified organisations go live', async () => {
    const create = await pendingBroker.post('/api/v1/properties').set('Origin', ORIGIN).send(apartment());
    expect(create.status).toBe(201);
    await withPhoto(pendingBroker, create.body.id, pendingOrg.id);
    expect((await pendingBroker.post(`/api/v1/properties/${create.body.id}/transition`).set('Origin', ORIGIN).send({ action: 'submit' })).status).toBe(201);
    const approve = await reviewer.post(`/api/v1/properties/${create.body.id}/transition`).set('Origin', ORIGIN).send({ action: 'approve' });
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe('ORGANIZATION_NOT_ACTIVE');
  });

  it('rejects uploads whose content is not an allowed type', async () => {
    const res = await brokerA.post('/api/v1/files').set('Origin', ORIGIN).field('purpose', 'property-media').attach('file', Buffer.from('<?php echo "x"; ?>'), 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });
});
