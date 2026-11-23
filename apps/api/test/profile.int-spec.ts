import { createApp, createUser, loginAgent, ORIGIN, tinyPng, type TestContext } from './helpers';

/** Self-service profile (name, photo) and administrator account help (rename, password-reset link). */
describe('Profiles & account administration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('lets every user change their name and profile photo — only with their own uploaded photo', async () => {
    const customer = await createUser(ctx.prisma, { accountType: 'CUSTOMER' });
    const other = await createUser(ctx.prisma, { accountType: 'CUSTOMER' });
    const agent = await loginAgent(ctx, customer.email!);
    const otherAgent = await loginAgent(ctx, other.email!);

    const renamed = await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ fullName: '  Priya Srivastava ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.fullName).toBe('Priya Srivastava');
    expect((await agent.get('/api/v1/auth/me')).body.fullName).toBe('Priya Srivastava');
    expect((await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ fullName: 'P' })).status).toBe(400);
    // Sign-in identifiers are not editable here.
    const ignored = await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ email: 'someone-else@example.test' });
    expect(ignored.status).toBe(200);
    expect(ignored.body.email).toBe(customer.email);

    // Photos are uploaded as "avatar" files, re-encoded and cropped to a 512px square.
    const upload = await agent.post('/api/v1/files').set('Origin', ORIGIN).field('purpose', 'avatar').attach('file', await tinyPng(), 'me.png');
    expect(upload.status).toBe(201);
    expect(upload.body).toMatchObject({ width: 512, height: 512, mimeType: 'image/webp' });
    const withPhoto = await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ avatarFileId: upload.body.id });
    expect(withPhoto.status).toBe(200);
    expect(withPhoto.body.avatarUrl).toBe(upload.body.url);

    // Someone else's upload cannot become your photo.
    expect((await otherAgent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ avatarFileId: upload.body.id })).status).toBe(400);

    const removed = await agent.patch('/api/v1/auth/me').set('Origin', ORIGIN).send({ avatarFileId: null });
    expect(removed.body.avatarUrl).toBeNull();
    expect(removed.body.fullName).toBe('Priya Srivastava'); // untouched by a photo-only change
    expect(await ctx.prisma.auditLog.count({ where: { entityId: customer.id, action: 'user.profile.update' } })).toBe(3);
  });

  it('lets administrators rename users and send reset links, without ever seeing the link', async () => {
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const superAdmin = await createUser(ctx.prisma, { roleKey: 'SUPER_ADMIN' });
    const staff = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE' });
    const noEmail = await ctx.prisma.user.create({ data: { fullName: 'Phone Only', phone: `+9198${String(Date.now()).slice(-8)}`, accountType: 'CUSTOMER' } });
    const adminAgent = await loginAgent(ctx, admin.email!);
    const superAgent = await loginAgent(ctx, superAdmin.email!);

    const rename = await adminAgent.patch(`/api/v1/admin/users/${staff.id}`).set('Origin', ORIGIN).send({ fullName: 'Rohan Verma' });
    expect(rename.status).toBe(200);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).fullName).toBe('Rohan Verma');
    // Administrators' accounts are protected from other (non-super) admins…
    expect((await adminAgent.patch(`/api/v1/admin/users/${superAdmin.id}`).set('Origin', ORIGIN).send({ fullName: 'Changed' })).status).toBe(403);
    expect((await adminAgent.post(`/api/v1/admin/users/${superAdmin.id}/password-reset`).set('Origin', ORIGIN)).status).toBe(403);
    // …but a super admin may help another administrator.
    expect((await superAgent.patch(`/api/v1/admin/users/${admin.id}`).set('Origin', ORIGIN).send({ fullName: 'Renamed Admin' })).status).toBe(200);
    // Staff without user.manage cannot use these endpoints at all.
    const staffAgent = await loginAgent(ctx, staff.email!);
    expect((await staffAgent.patch(`/api/v1/admin/users/${admin.id}`).set('Origin', ORIGIN).send({ fullName: 'Nope' })).status).toBe(403);

    const reset = await adminAgent.post(`/api/v1/admin/users/${staff.id}/password-reset`).set('Origin', ORIGIN);
    expect(reset.status).toBe(201);
    expect(reset.body).toEqual({ ok: true, sentTo: staff.email });
    const token = await ctx.prisma.verificationToken.findFirstOrThrow({ where: { userId: staff.id, type: 'PASSWORD_RESET' } });
    expect(JSON.stringify(reset.body)).not.toContain(token.tokenHash);
    const mail = await ctx.prisma.communicationLog.findFirstOrThrow({ where: { eventKey: 'auth.password_reset', recipientUserId: staff.id } });
    expect(mail.recipient).toBe(staff.email);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.password_reset_requested', entityId: staff.id, actorId: admin.id } })).toBe(1);

    expect((await adminAgent.post(`/api/v1/admin/users/${noEmail.id}/password-reset`).set('Origin', ORIGIN)).status).toBe(409);
    // At most three links per account per 15 minutes.
    expect((await adminAgent.post(`/api/v1/admin/users/${staff.id}/password-reset`).set('Origin', ORIGIN)).status).toBe(201);
    expect((await adminAgent.post(`/api/v1/admin/users/${staff.id}/password-reset`).set('Origin', ORIGIN)).status).toBe(201);
    expect((await adminAgent.post(`/api/v1/admin/users/${staff.id}/password-reset`).set('Origin', ORIGIN)).status).toBe(429);
  });
});
