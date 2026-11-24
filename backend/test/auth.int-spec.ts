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

  it('lets a burst of parallel guesses try at most 5 passwords before locking', async () => {
    const user = await createUser(ctx.prisma);
    const server = ctx.app.getHttpServer();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: `wrong-password-${i}` })),
    );
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    const refused = results.filter((r) => r.status === 403);
    expect(refused).toHaveLength(7);
    expect(refused.every((r) => r.body.code === 'ACCOUNT_LOCKED')).toBe(true);
    const locked = await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD });
    expect(locked.status).toBe(403);
    expect(locked.body.message).toMatch(/paused for 15 minutes/);
    expect(refused.every((r) => /paused for (1[0-5]|[1-9]) minutes?/.test(r.body.message))).toBe(true); // never more than the 15-minute lock
  });

  it('gives a session 5 current-password guesses on change-password, then signs it out', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAgent(ctx, user.email!);
    const change = (currentPassword: string, newPassword = 'Brand-New-Pass-123') => agent.post('/api/v1/auth/change-password').set('Origin', ORIGIN).send({ currentPassword, newPassword });
    // "Same as current" is answered before any password check, so it reveals nothing and costs no guess.
    expect((await change('Any-Guess-123', 'Any-Guess-123')).status).toBe(400);
    for (let i = 0; i < 5; i += 1) expect((await change(`Wrong-Guess-${i}1`)).status).toBe(400);
    const sixth = await change(PASSWORD);
    expect(sixth.status).toBe(401);
    expect(sixth.body.code).toBe('SESSION_INVALID');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401); // that session is gone
    // The account itself is not locked: the owner can still sign in.
    expect((await request(ctx.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD })).status).toBe(200);
  });

  it('lets a signed-in user change the password while outsiders have locked sign-in, which ends the lock', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAgent(ctx, user.email!);
    const server = ctx.app.getHttpServer();
    for (let i = 0; i < 5; i += 1) await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: `outsider-guess-${i}` });
    expect((await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD })).body.code).toBe('ACCOUNT_LOCKED');
    expect(await ctx.prisma.auditLog.count({ where: { entityId: user.id, action: 'auth.account_locked' } })).toBe(1);
    const changed = await agent.post('/api/v1/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: PASSWORD, newPassword: 'Brand-New-Pass-123' });
    expect(changed.status).toBe(200);
    expect((await request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: 'Brand-New-Pass-123' })).status).toBe(200);
  });

  it('clears earlier failures when the right password is used', async () => {
    const user = await createUser(ctx.prisma);
    const server = ctx.app.getHttpServer();
    const attempt = (password: string) => request(server).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password });
    for (let i = 0; i < 4; i += 1) expect((await attempt('wrong-password-1')).status).toBe(401);
    expect((await attempt(PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await attempt('wrong-password-2')).status).toBe(401);
    expect((await attempt(PASSWORD)).status).toBe(200); // the count restarted at the successful login
  });

  it('logs in with httpOnly cookies and returns scoped permissions', async () => {
    const user = await createUser(ctx.prisma, { roleKey: 'OPERATIONS_MANAGER' });
    const res = await request(ctx.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(res.headers['x-session-slot']).toBe('main'); // the browser's main session uses the plain cookie names
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
    const RT = 'estate_rt';
    const AT = 'estate_at';
    const rt1 = cookieValue(login.headers['set-cookie'] as unknown as string[], RT)!;
    const at1 = cookieValue(login.headers['set-cookie'] as unknown as string[], AT)!;

    const r1 = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `${RT}=${rt1}`);
    expect(r1.status).toBe(200);
    const rt2 = cookieValue(r1.headers['set-cookie'] as unknown as string[], RT);
    expect(rt2).toBeDefined();
    expect(rt2).not.toBe(rt1);

    // Parallel tab presenting the previous token inside the grace window gets an access token only.
    const race = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `${RT}=${rt1}`);
    expect(race.status).toBe(200);
    expect(cookieValue(race.headers['set-cookie'] as unknown as string[], RT)).toBeUndefined();

    // Outside the grace window the same old token is treated as theft.
    await ctx.prisma.session.updateMany({ where: { userId: user.id }, data: { rotatedAt: new Date(Date.now() - 10 * 60_000) } });
    const theft = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `${RT}=${rt1}`);
    expect(theft.status).toBe(401);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedReason).toBe('REFRESH_TOKEN_REUSE');

    // The legitimate holder's refresh token no longer works either.
    const after = await request(server).post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', `${RT}=${rt2}`);
    expect(after.status).toBe(401);
    // Access tokens bound to the revoked session stop working (after the auth cache TTL at most).
    await new Promise((r) => setTimeout(r, 16_000));
    const me = await request(server).get('/api/v1/auth/me').set('Cookie', `${AT}=${at1}`);
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
