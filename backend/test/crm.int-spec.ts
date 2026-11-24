import request from 'supertest';
import { createApp, createOrg, createUser, loginAgent, ORIGIN, uniq, type TestContext } from './helpers';

/**
 * Enquiry → customer → lead → assignment, end to end through the public API, plus lead privacy,
 * status rules, site visits and lead-provider duplicate detection.
 */
describe('Enquiries & CRM', () => {
  let ctx: TestContext;
  let platformOrgId: string;

  const mobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  beforeAll(async () => {
    ctx = await createApp();
    platformOrgId = (await ctx.prisma.organization.findFirstOrThrow({ where: { type: 'PLATFORM' } })).id;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const enquire = (body: Record<string, unknown>) =>
    request(ctx.app.getHttpServer())
      .post('/api/v1/public/enquiries')
      .set('Origin', ORIGIN)
      .send({ type: 'GENERAL', consent: true, message: 'Looking for a 3 BHK in Gomti Nagar', formStartedAt: Date.now() - 10_000, ...body });

  it('turns enquiries into round-robin assigned leads, attaches repeats and keeps leads private', async () => {
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    // Sales staff are members of the company organisation (as HR-created employees are).
    const s1 = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE', memberOf: platformOrgId });
    const s2 = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE', memberOf: platformOrgId });
    const outsider = await createUser(ctx.prisma, { roleKey: 'SALES_EXECUTIVE' });
    const adminAgent = await loginAgent(ctx, admin.email!);

    // Only members of the organisation who can work leads may join a team.
    expect((await adminAgent.post('/api/v1/crm/teams').set('Origin', ORIGIN).send({ name: uniq('Bad team '), memberIds: [outsider.id] })).status).toBe(400);
    const team = await adminAgent.post('/api/v1/crm/teams').set('Origin', ORIGIN).send({ name: uniq('Website team '), memberIds: [s1.id, s2.id] });
    expect(team.status).toBe(201);
    const rule = await adminAgent.post('/api/v1/crm/rules').set('Origin', ORIGIN).send({ name: 'All company enquiries', priority: 1, salesTeamId: team.body.id, strategy: 'ROUND_ROBIN' });
    expect(rule.status).toBe(201);

    // Spam protection: honeypot, too-fast submission, missing consent.
    const phone1 = mobile();
    expect((await enquire({ name: 'Bot', phone: phone1, website: 'http://spam.example' })).status).toBe(400);
    const fast = await enquire({ name: 'Too Fast', phone: phone1, formStartedAt: Date.now() });
    expect(fast.status).toBe(400);
    expect(fast.body.code).toBe('SUBMITTED_TOO_FAST');
    expect((await enquire({ name: 'No Consent', phone: phone1, consent: false })).status).toBe(400);

    // Two customers → two leads, one per team member.
    const e1 = await enquire({ name: 'Asha Verma', phone: phone1 });
    expect(e1.status).toBe(201);
    expect(e1.body.referenceNo).toMatch(/^ENQ-\d{4}-\d{6}$/);
    const e2 = await enquire({ name: 'Rohit Mishra', phone: mobile() });
    expect(e2.status).toBe(201);

    const enquiry1 = await ctx.prisma.enquiry.findUniqueOrThrow({ where: { referenceNo: e1.body.referenceNo }, include: { lead: true } });
    const enquiry2 = await ctx.prisma.enquiry.findUniqueOrThrow({ where: { referenceNo: e2.body.referenceNo }, include: { lead: true } });
    expect(enquiry1.organizationId).toBe(platformOrgId);
    expect(enquiry1.lead?.status).toBe('ASSIGNED');
    expect(new Set([enquiry1.lead?.assignedToId, enquiry2.lead?.assignedToId])).toEqual(new Set([s1.id, s2.id]));
    expect(await ctx.prisma.leadAssignment.count({ where: { leadId: enquiry1.leadId! } })).toBe(1);

    // A repeat enquiry from the same phone attaches to the open lead instead of creating another.
    const repeat = await enquire({ name: 'Asha Verma', phone: phone1, type: 'CALLBACK' });
    expect(repeat.status).toBe(201);
    const enquiry3 = await ctx.prisma.enquiry.findUniqueOrThrow({ where: { referenceNo: repeat.body.referenceNo } });
    expect(enquiry3.leadId).toBe(enquiry1.leadId);
    expect(await ctx.prisma.lead.count({ where: { organizationId: platformOrgId, customerId: enquiry1.lead!.customerId } })).toBe(1);
    expect(await ctx.prisma.customer.count({ where: { organizationId: platformOrgId, id: enquiry1.lead!.customerId } })).toBe(1);

    // Sales executives see only their own leads.
    const ownerId = enquiry1.lead!.assignedToId!;
    const owner = ownerId === s1.id ? s1 : s2;
    const other = ownerId === s1.id ? s2 : s1;
    const ownerAgent = await loginAgent(ctx, owner.email!);
    const otherAgent = await loginAgent(ctx, other.email!);
    const visible = await ownerAgent.get('/api/v1/crm/leads?pageSize=100');
    expect(visible.status).toBe(200);
    const rows: { id: string; assignedTo?: { id: string } | null; assignedToId?: string }[] = visible.body.data;
    expect(rows.map((r) => r.id)).toContain(enquiry1.leadId);
    expect(rows.map((r) => r.id)).not.toContain(enquiry2.leadId);
    expect([403, 404]).toContain((await otherAgent.get(`/api/v1/crm/leads/${enquiry1.leadId}`)).status);
    expect([403, 404]).toContain((await otherAgent.post(`/api/v1/crm/leads/${enquiry1.leadId}/status`).set('Origin', ORIGIN).send({ status: 'CONTACTED' })).status);

    // Status rules: conversions come from deals, losing needs a reason.
    const leadUrl = `/api/v1/crm/leads/${enquiry1.leadId}`;
    expect([400, 409]).toContain((await ownerAgent.post(`${leadUrl}/status`).set('Origin', ORIGIN).send({ status: 'CONVERTED' })).status);
    expect((await ownerAgent.post(`${leadUrl}/status`).set('Origin', ORIGIN).send({ status: 'LOST' })).status).toBe(400);
    expect((await ownerAgent.post(`${leadUrl}/status`).set('Origin', ORIGIN).send({ status: 'CONTACTED', note: 'Spoke to the customer' })).status).toBe(201);

    // Activity and a site visit; the visit moves the lead forward.
    expect((await ownerAgent.post(`${leadUrl}/activities`).set('Origin', ORIGIN).send({ type: 'CALL', direction: 'OUTBOUND', summary: 'Discussed budget and preferred localities' })).status).toBe(201);
    const visit = await ownerAgent.post('/api/v1/crm/site-visits').set('Origin', ORIGIN).send({ leadId: enquiry1.leadId, scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), meetingPoint: 'Project site office' });
    expect(visit.status).toBe(201);
    const lead = await ctx.prisma.lead.findUniqueOrThrow({ where: { id: enquiry1.leadId! } });
    expect(lead.status).toBe('SITE_VISIT_SCHEDULED');
    const timeline = await ctx.prisma.leadActivity.findMany({ where: { leadId: lead.id } });
    expect(timeline.length).toBeGreaterThanOrEqual(4); // enquiry, assignment, repeat enquiry, status, call, visit
  });

  it('records lead-provider submissions and flags duplicates within the provider window', async () => {
    const providerOrg = await createOrg(ctx.prisma, { type: 'LEAD_PROVIDER' });
    await ctx.prisma.leadProvider.create({ data: { organizationId: providerOrg.id, name: providerOrg.name, status: 'ACTIVE', duplicateWindowDays: 90 } });
    const providerUser = await createUser(ctx.prisma, { roleKey: 'LEAD_PROVIDER', organizationId: providerOrg.id, memberOf: providerOrg.id, accountType: 'LEAD_PROVIDER' });
    const agent = await loginAgent(ctx, providerUser.email!);
    const phone = mobile();

    const first = await agent.post('/api/v1/provider/leads').set('Origin', ORIGIN).send({ name: 'Kavita Singh', phone, requirement: '2 BHK apartment, budget 60 lakh' });
    expect(first.status).toBe(201);
    expect(first.body.intakeStatus).toBe('ACCEPTED');
    const dup = await agent.post('/api/v1/provider/leads').set('Origin', ORIGIN).send({ name: 'Kavita Singh', phone, requirement: 'Same customer again' });
    expect(dup.status).toBe(201);
    expect(dup.body.intakeStatus).toBe('DUPLICATE');

    const leads = await ctx.prisma.lead.findMany({ where: { leadProvider: { organizationId: providerOrg.id } }, orderBy: { createdAt: 'asc' } });
    expect(leads).toHaveLength(2);
    expect(leads[1].isDuplicate).toBe(true);
    expect(leads[1].duplicateOfId).toBe(leads[0].id);

    // Providers see only their own submissions.
    const mine = await agent.get('/api/v1/provider/leads');
    expect(mine.status).toBe(200);
    const list: { leadNo: string }[] = mine.body.data;
    expect(list).toHaveLength(2);
    // …and nothing of the CRM itself.
    expect((await agent.get('/api/v1/crm/leads')).status).toBe(403);
  });
});
