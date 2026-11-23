import request from 'supertest';
import { createApp, createOrg, createUser, loginAgent, ORIGIN, uniq, type TestContext } from './helpers';

/** Administration safeguards: partial updates, query booleans, and notification-log confidentiality. */
describe('Administration safeguards', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('PATCH changes only the fields sent, and ?active=false means false', async () => {
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const agent = await loginAgent(ctx, admin.email!);
    const up = await ctx.prisma.state.findFirstOrThrow({ where: { cities: { some: { slug: 'lucknow' } } } });
    const created = await agent.post('/api/v1/admin/cities').set('Origin', ORIGIN).send({ stateId: up.id, name: uniq('Testpur '), isActive: true, isFeatured: true, sortOrder: 7 });
    expect(created.status).toBe(201);
    const id: string = created.body.id;

    const renamed = await agent.patch(`/api/v1/admin/cities/${id}`).set('Origin', ORIGIN).send({ name: 'Renamed Testpur' });
    expect(renamed.status).toBe(200);
    const city = await ctx.prisma.city.findUniqueOrThrow({ where: { id } });
    expect(city).toMatchObject({ name: 'Renamed Testpur', isActive: true, isFeatured: true, sortOrder: 7 });

    const inactive = await agent.get('/api/v1/admin/cities?active=false&pageSize=100');
    expect(inactive.status).toBe(200);
    const rows: { id: string; isActive: boolean }[] = inactive.body.data;
    expect(rows.every((r) => r.isActive === false)).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(id);
  });

  it('never shows one-time security links in delivery logs, and needs a platform-level grant', async () => {
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const agent = await loginAgent(ctx, admin.email!);
    const target = await createUser(ctx.prisma, {});
    expect((await request(ctx.app.getHttpServer()).post('/api/v1/auth/forgot-password').set('Origin', ORIGIN).send({ email: target.email })).status).toBe(200);
    const log = await ctx.prisma.communicationLog.findFirstOrThrow({ where: { eventKey: 'auth.password_reset', recipient: target.email! } });
    expect(log.body).toContain('http'); // the stored message really contains the link…

    const res = await agent.get(`/api/v1/notifications/admin/logs?q=${encodeURIComponent(target.email!)}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { id: string }) => r.id === log.id);
    expect(row.redacted).toBe(true); // …but administrators never see it
    expect(JSON.stringify(res.body)).not.toContain(log.body);

    // A custom role holding notification.manage inside a partner organisation is not platform administration.
    const broker = await createOrg(ctx.prisma, { type: 'BROKERAGE' });
    const perm = await ctx.prisma.permission.findUniqueOrThrow({ where: { key: 'notification.manage' } });
    const role = await ctx.prisma.role.create({ data: { key: uniq('CUSTOM_NOTIFY_').toUpperCase(), name: 'Custom notifications', scope: 'ORGANIZATION', permissions: { create: [{ permissionId: perm.id }] } } });
    const scoped = await createUser(ctx.prisma, { memberOf: broker.id, accountType: 'BROKER' });
    await ctx.prisma.userRole.create({ data: { userId: scoped.id, roleId: role.id, organizationId: broker.id } });
    const scopedAgent = await loginAgent(ctx, scoped.email!);
    expect((await scopedAgent.get('/api/v1/notifications/admin/logs')).status).toBe(403);
  });
});
