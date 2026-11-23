import request from 'supertest';
import { cookieValue, createApp, createUser, loginAgent, ORIGIN, PASSWORD, uniq, type TestContext } from './helpers';

describe('Authentication & sessions (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('rejects wrong passwords and locks the account after repeated failures', async () => {
    const user = await createUser(ctx.prisma);
    const server = ctx.app.getHttpServer();
    for (let i = 0; i < 5; i += 1) {
      const res = await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: 'wrong-password-1' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('logs in with httpOnly cookies and returns scoped permissions', async () => {
    const user = await createUser(ctx.prisma, { roleKey: 'OPERATIONS_MANAGER' });
    const res = await request(ctx.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('estate_at='))).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith('estate_rt='))).toMatch(/Path=\/api\/v1\/auth/);
    expect(res.body.user.permissions.global).toEqual(expect.arrayContaining(['property.approve', 'project.domain.manage']));
    expect(res.body.user.permissions.global).not.toContain('payroll.approve');
    expect(res.body.user.workspaces).toContain('admin');
  });

  it('rotates refresh tokens, tolerates a parallel refresh, and revokes the session on late reuse', async () => {
    const user = await createUser(ctx.prisma);
    const server = ctx.app.getHttpServer();
    const login = await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD });
    const rt1 = cookieValue(login.headers['set-cookie'] as unknown as string[], 'estate_rt')!;
    const at1 = cookieValue(login.headers['set-cookie'] as unknown as string[], 'estate_at')!;

    const r1 = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `estate_rt=${rt1}`);
    expect(r1.status).toBe(200);
    const rt2 = cookieValue(r1.headers['set-cookie'] as unknown as string[], 'estate_rt');
    expect(rt2).toBeDefined();
    expect(rt2).not.toBe(rt1);

    // Parallel tab presenting the previous token inside the grace window gets an access token only.
    const race = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `estate_rt=${rt1}`);
    expect(race.status).toBe(200);
    expect(cookieValue(race.headers['set-cookie'] as unknown as string[], 'estate_rt')).toBeUndefined();

    // Outside the grace window the same old token is treated as theft.
    await ctx.prisma.session.updateMany({ where: { userId: user.id }, data: { rotatedAt: new Date(Date.now() - 10 * 60_000) } });
    const theft = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `estate_rt=${rt1}`);
    expect(theft.status).toBe(401);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedReason).toBe('REFRESH_TOKEN_REUSE');

    // The legitimate holder's refresh token no longer works either.
    const after = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `estate_rt=${rt2}`);
    expect(after.status).toBe(401);
    // Access tokens bound to the revoked session stop working (after the auth cache TTL at most).
    await new Promise((r) => setTimeout(r, 16_000));
    const me = await request(server).get('/api/v1/auth/me').set('Cookie', `estate_at=${at1}`);
    expect(me.status).toBe(401);
  });

  it('blocks cross-site state-changing requests that carry session cookies', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAgent(ctx, user.email!);
    const res = await agent.post('/api/v1/auth/change-password').set('Origin', 'https://evil.example').send({ currentPassword: PASSWORD, newPassword: 'Another-Password-9' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('logs out and invalidates the session', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAgent(ctx, user.email!);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await agent.post('/api/v1/auth/logout').set('Origin', ORIGIN)).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('registers a broker as a PENDING organisation with an organisation-scoped role', async () => {
    const city = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'lucknow' } });
    const email = `${uniq('broker')}@example.test`;
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register/partner')
      .set('Origin', ORIGIN)
      .send({ partnerType: 'BROKERAGE', fullName: 'Test Broker', email, phone: `9${String(Date.now()).slice(-9)}`, password: PASSWORD, organizationName: uniq('Agency '), businessAddress: 'Hazratganj, Lucknow', cityId: city.id, acceptTerms: true });
    expect(res.status).toBe(201);
    expect(res.body.user.workspaces).toContain('broker');
    const membership = res.body.user.memberships[0];
    expect(membership.organizationStatus).toBe('PENDING');
    const grants = res.body.user.permissions.byOrganization[membership.organizationId];
    expect(grants).toEqual(expect.arrayContaining(['property.create', 'lead.view_all']));
    expect(res.body.user.permissions.global).toHaveLength(0);

    const dup = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register/partner')
      .set('Origin', ORIGIN)
      .send({ partnerType: 'BROKERAGE', fullName: 'Again', email, phone: '9000000001', password: PASSWORD, organizationName: 'Dup', businessAddress: 'Lucknow', cityId: city.id, acceptTerms: true });
    expect(dup.status).toBe(409);
  });
});
