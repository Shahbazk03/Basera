import request from 'supertest';
import { createApp, createUser, loginAgent, ORIGIN, PASSWORD, type TestContext } from './helpers';

const WEB_ORIGIN = 'http://localhost:3200';

function cookieNames(setCookie: string[] | string | undefined): string[] {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  // Session cookies carry a per-sign-in slot suffix (estate_console_at_<slot>); compare their prefixes.
  return list.map((c) => c.split('=')[0].replace(/_[a-z0-9]{12,24}$/, ''));
}

/** Independent website/console sessions, and administrator-set (temporary) passwords. */
describe('Sessions & administrator-set passwords', () => {
  let ctx: TestContext;
  let consoleHost: string;

  beforeAll(async () => {
    ctx = await createApp();
    consoleHost = new URL(process.env.CONSOLE_PUBLIC_URL!).host;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('keeps the console and the website signed in as different users in the same browser', async () => {
    const staff = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE' });
    const customer = await createUser(ctx.prisma, { accountType: 'CUSTOMER' });
    const browser = request.agent(ctx.app.getHttpServer()); // one cookie jar, like one Chrome profile

    const consoleLogin = await browser.post('/api/v1/auth/login').set('Origin', ORIGIN).set('X-Forwarded-Host', consoleHost).send({ identifier: staff.email, password: PASSWORD });
    expect(consoleLogin.status).toBe(200);
    expect(cookieNames(consoleLogin.headers['set-cookie'])).toEqual(expect.arrayContaining(['estate_console_at', 'estate_console_rt', 'estate_console_session']));
    expect(cookieNames(consoleLogin.headers['set-cookie'])).not.toContain('estate_at');

    const webLogin = await browser.post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ identifier: customer.email, password: PASSWORD });
    expect(webLogin.status).toBe(200);

    expect((await browser.get('/api/v1/auth/me').set('X-Forwarded-Host', consoleHost)).body.id).toBe(staff.id);
    expect((await browser.get('/api/v1/auth/me')).body.id).toBe(customer.id);

    // Signing out of the website does not sign the console out (and vice versa).
    expect((await browser.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN)).status).toBe(200);
    expect((await browser.get('/api/v1/auth/me')).status).toBe(401);
    expect((await browser.get('/api/v1/auth/me').set('X-Forwarded-Host', consoleHost)).body.id).toBe(staff.id);
    // The console refresh flow uses the console's own refresh cookie.
    expect((await browser.post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('X-Forwarded-Host', consoleHost)).status).toBe(200);
  });

  it('keeps two tabs of the same app signed in as different people', async () => {
    const ops = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE' });
    const broker = await createUser(ctx.prisma);
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const server = ctx.app.getHttpServer();
    const browser = request.agent(server); // one cookie jar, like one Chrome profile
    const call = <T extends { set(k: string, v: string): T }>(r: T, slot?: string) => {
      const withHost = r.set('Origin', ORIGIN).set('X-Forwarded-Host', consoleHost);
      return slot ? withHost.set('X-Session-Slot', slot) : withHost;
    };
    const signIn = (email: string, slot?: string) => call(browser.post('/api/v1/auth/login'), slot).send({ identifier: email, password: PASSWORD });
    const me = (slot?: string) => call(browser.get('/api/v1/auth/me'), slot);

    // Tab A signs in first: that becomes the browser's main account (plain cookie names, as before).
    const a = await signIn(ops.email!);
    expect(a.headers['x-session-slot']).toBe('main');
    // Tab B is a fresh tab and signs in too while the main account is in use: it gets an account of its own.
    const b = await signIn(broker.email!);
    const slotB = b.headers['x-session-slot'] as string;
    expect(slotB).toMatch(/^[a-z0-9]{12,24}$/);
    expect((await me('main')).body.id).toBe(ops.id);
    expect((await me()).body.id).toBe(ops.id); // new tabs, plain links: always the main account — never guessed
    expect((await me(slotB)).body.id).toBe(broker.id);
    expect((await me('none')).status).toBe(401); // a tab that chose "use another account" and has not signed in yet

    // Signing in again in tab B replaces only tab B's account (same slot, old session revoked).
    const b2 = await signIn(admin.email!, slotB);
    expect(b2.headers['x-session-slot']).toBe(slotB);
    expect((await me(slotB)).body.id).toBe(admin.id);
    const brokerSessions = await ctx.prisma.session.findMany({ where: { userId: broker.id } });
    expect(brokerSessions.every((x) => x.revokedAt)).toBe(true);

    // Refreshing tab B keeps it in its slot; signing tab B out leaves tab A signed in.
    const refreshed = await call(browser.post('/api/v1/auth/refresh'), slotB);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers['x-session-slot']).toBe(slotB);
    expect((await call(browser.post('/api/v1/auth/logout'), slotB)).status).toBe(200);
    expect((await me(slotB)).status).toBe(401);
    expect((await me()).body.id).toBe(ops.id);

    // At most 5 tab-only accounts: a 6th signs the oldest out, on the server as well.
    const tabSlots: string[] = [];
    for (let i = 0; i < 6; i += 1) tabSlots.push((await signIn(broker.email!, 'none')).headers['x-session-slot'] as string);
    expect((await me(tabSlots[0])).status).toBe(401);
    expect((await me(tabSlots[5])).body.id).toBe(broker.id);
    expect(await ctx.prisma.session.count({ where: { userId: broker.id, revokedReason: 'TAB_LIMIT' } })).toBe(1);

    // "Sign out of all accounts" ends every account of this app in this browser.
    expect((await call(browser.post('/api/v1/auth/logout-all'))).status).toBe(200);
    expect((await me()).status).toBe(401);
    expect((await me(tabSlots[5])).status).toBe(401);
    expect(await ctx.prisma.session.count({ where: { userId: { in: [ops.id, broker.id] }, revokedAt: null } })).toBe(0);
  });

  it('starts a new main session when the main account was signed out, even from a tab that chose another account', async () => {
    const first = await createUser(ctx.prisma);
    const second = await createUser(ctx.prisma);
    const browser = request.agent(ctx.app.getHttpServer());
    const call = <T extends { set(k: string, v: string): T }>(r: T, slot?: string) => {
      const withHost = r.set('Origin', ORIGIN).set('X-Forwarded-Host', consoleHost);
      return slot ? withHost.set('X-Session-Slot', slot) : withHost;
    };
    await call(browser.post('/api/v1/auth/login')).send({ identifier: first.email, password: PASSWORD });
    expect((await call(browser.post('/api/v1/auth/logout'))).status).toBe(200);
    const again = await call(browser.post('/api/v1/auth/login'), 'none').send({ identifier: second.email, password: PASSWORD });
    expect(again.headers['x-session-slot']).toBe('main');
    expect((await call(browser.get('/api/v1/auth/me'))).body.id).toBe(second.id);
  });

  it('lets an administrator set a password that must be replaced at the next sign-in', async () => {
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const superAdmin = await createUser(ctx.prisma, { roleKey: 'SUPER_ADMIN' });
    const target = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE' });
    const adminAgent = await loginAgent(ctx, admin.email!);
    const targetOld = await loginAgent(ctx, target.email!); // an existing session of the target
    const temporary = 'Temporary-pass-2026';

    // An emailed password is always temporary; own account and other administrators are protected.
    expect((await adminAgent.post(`/api/v1/admin/users/${target.id}/password`).set('Origin', ORIGIN).send({ password: temporary, sendEmail: true, mustChange: false })).status).toBe(400);
    expect((await adminAgent.post(`/api/v1/admin/users/${target.id}/password`).set('Origin', ORIGIN).send({ password: 'short1', sendEmail: false })).status).toBe(400);
    expect((await adminAgent.post(`/api/v1/admin/users/${admin.id}/password`).set('Origin', ORIGIN).send({ password: temporary, sendEmail: false })).status).toBe(400);
    expect((await adminAgent.post(`/api/v1/admin/users/${superAdmin.id}/password`).set('Origin', ORIGIN).send({ password: temporary, sendEmail: false })).status).toBe(403);

    const set = await adminAgent.post(`/api/v1/admin/users/${target.id}/password`).set('Origin', ORIGIN).send({ password: temporary, sendEmail: true, mustChange: true });
    expect(set.status).toBe(201);
    expect(set.body).toMatchObject({ ok: true, mustChange: true, emailStatus: 'NOT_CONFIGURED' }); // SMTP is off in tests
    expect(set.body.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(set.body)).not.toContain(temporary);

    // The stored copy of the email never keeps the password; neither does the audit log.
    const mail = await ctx.prisma.communicationLog.findFirstOrThrow({ where: { eventKey: 'auth.password_set_by_admin', recipientUserId: target.id } });
    expect(mail.body).not.toContain(temporary);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'user.password.set_by_admin', entityId: target.id } });
    expect(JSON.stringify(audit)).not.toContain(temporary);

    // Existing sessions were signed out; the old password no longer works.
    expect((await targetOld.get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(ctx.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: target.email, password: PASSWORD })).status).toBe(401);

    // Signed in with the temporary password: only the password change works.
    const fresh = request.agent(ctx.app.getHttpServer());
    expect((await fresh.post('/api/v1/auth/login').set('Origin', ORIGIN).send({ identifier: target.email, password: temporary })).status).toBe(200);
    expect((await fresh.get('/api/v1/auth/me')).body.mustChangePassword).toBe(true);
    const blocked = await fresh.get('/api/v1/crm/leads');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await fresh.post('/api/v1/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: temporary, newPassword: temporary })).status).toBe(400);
    expect((await fresh.post('/api/v1/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: temporary, newPassword: 'My-own-password-9' })).status).toBe(200);
    expect((await fresh.get('/api/v1/auth/me')).body.mustChangePassword).toBe(false);
    expect((await fresh.get('/api/v1/crm/leads')).status).toBe(200);

    // A super admin may set an administrator's password, without forcing a change when it is not emailed.
    const superAgent = await loginAgent(ctx, superAdmin.email!);
    const direct = await superAgent.post(`/api/v1/admin/users/${admin.id}/password`).set('Origin', ORIGIN).send({ password: 'Admin-reset-2026', sendEmail: false, mustChange: false });
    expect(direct.status).toBe(201);
    expect(direct.body).toMatchObject({ mustChange: false, emailStatus: null });
  });
});
