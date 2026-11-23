import request from 'supertest';
import { createApp, createUser, loginAgent, ORIGIN, PASSWORD, type TestContext } from './helpers';

const WEB_ORIGIN = 'http://localhost:3200';

function cookieNames(setCookie: string[] | string | undefined): string[] {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split('=')[0]);
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
