import request from 'supertest';
import { DomainsService } from '../src/modules/projects/domains.service';
import { createApp, createOrg, createUser, loginAgent, lucknowRefs, ORIGIN, uniq, type TestContext } from './helpers';

/**
 * Projects end to end: creation, publication, server-derived sales status (booking window + inventory),
 * transaction-safe reservations, page-builder validation and honest custom-domain verification.
 * DNS answers are stubbed through DomainsService.checkDns so both outcomes are deterministic.
 */
describe('Projects, inventory & domains', () => {
  let ctx: TestContext;
  let domains: DomainsService;

  beforeAll(async () => {
    ctx = await createApp();
    domains = ctx.app.get(DomainsService);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx.app.close();
  });

  const publicStatus = async (slug: string) => {
    const r = await request(ctx.app.getHttpServer()).get(`/api/v1/public/projects/${slug}`);
    return { status: r.status, project: r.body as { status: string; units?: unknown[] } };
  };

  it('publishes a project whose sales status follows the booking window and live inventory', async () => {
    const refs = await lucknowRefs(ctx.prisma);
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const agent = await loginAgent(ctx, admin.email!);
    const hour = 3_600_000;
    const slug = uniq('test-project-');

    const created = await agent.post('/api/v1/projects').set('Origin', ORIGIN).send({
      name: 'Integration Test Residency',
      slug,
      projectType: 'APARTMENTS',
      cityId: refs.city.id,
      localityId: refs.locality.id,
      description: 'Integration-test project used to verify the project lifecycle and inventory rules.',
      heroImageUrl: '/images/test-hero.jpg',
      autoStatus: true,
      bookingOpensAt: new Date(Date.now() - hour).toISOString(),
      bookingClosesAt: new Date(Date.now() + 10 * 24 * hour).toISOString(),
      closingSoonHours: 72,
    });
    expect(created.status).toBe(201);
    const projectId: string = created.body.id;

    // Drafts are never public.
    expect((await publicStatus(slug)).status).toBe(404);

    // Inventory: two released units.
    const unit = async (code: string) => {
      const r = await agent.post(`/api/v1/projects/${projectId}/units`).set('Origin', ORIGIN).send({ code, unitType: 'FLAT', area: 1250, areaUnit: 'SQFT', basePrice: 6_500_000, status: 'AVAILABLE' });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const u1 = await unit('A-101');
    const u2 = await unit('A-102');

    const published = await agent.post(`/api/v1/projects/${projectId}/publish`).set('Origin', ORIGIN);
    expect(published.status).toBe(201);
    let pub = await publicStatus(slug);
    expect(pub.status).toBe(200);
    expect(pub.project.status).toBe('BOOKING_OPEN');
    const html = JSON.stringify(pub.project);
    expect(html).not.toMatch(/verificationToken|reservedById|passwordHash/);

    // Sales statuses are derived while automatic status is on.
    const manual = await agent.post(`/api/v1/projects/${projectId}/status`).set('Origin', ORIGIN).send({ status: 'SOLD_OUT' });
    expect(manual.status).toBe(409);

    // Concurrent reservations of one unit: exactly one wins.
    const attempts = await Promise.all(Array.from({ length: 6 }, () => agent.post(`/api/v1/project-units/${u1}/reserve`).set('Origin', ORIGIN).send({ expiresInHours: 24 })));
    const codes = attempts.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect(await ctx.prisma.unitReservation.count({ where: { unitId: u1, status: 'ACTIVE' } })).toBe(1);

    // Last available unit reserved → sold out; released → booking open again.
    expect((await agent.post(`/api/v1/project-units/${u2}/reserve`).set('Origin', ORIGIN).send({})).status).toBe(201);
    expect((await publicStatus(slug)).project.status).toBe('SOLD_OUT');
    expect((await agent.post(`/api/v1/project-units/${u2}/release`).set('Origin', ORIGIN).send({ reason: 'Customer withdrew' })).status).toBe(201);
    expect((await publicStatus(slug)).project.status).toBe('BOOKING_OPEN');

    // Closing window → closing soon; past the closing time → closed, and reservations stop.
    expect((await agent.patch(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN).send({ bookingClosesAt: new Date(Date.now() + 2 * hour).toISOString() })).status).toBe(200);
    expect((await publicStatus(slug)).project.status).toBe('CLOSING_SOON');
    expect((await agent.patch(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN).send({ bookingClosesAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(200);
    pub = await publicStatus(slug);
    expect(pub.project.status).toBe('CLOSED');
    const late = await agent.post(`/api/v1/project-units/${u2}/reserve`).set('Origin', ORIGIN).send({});
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PROJECT_NOT_BOOKABLE');

    // The scheduler persists the derived status with history.
    const job = await agent.post('/api/v1/projects/jobs/sync-status').set('Origin', ORIGIN);
    expect(job.status).toBe(201);
    const stored = await ctx.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(stored.status).toBe('CLOSED');
    expect(await ctx.prisma.projectStatusHistory.count({ where: { projectId, toStatus: 'CLOSED' } })).toBe(1);

    // Page builder: only typed, validated sections — no raw HTML blocks or script URLs.
    const rawHtml = await agent.put(`/api/v1/projects/${projectId}/page/draft`).set('Origin', ORIGIN).send({ sections: [{ id: 'sec_raw1', type: 'RAW_HTML', data: { html: '<script>alert(1)</script>' } }] });
    expect(rawHtml.status).toBe(400);
    const scriptUrl = await agent.put(`/api/v1/projects/${projectId}/page/draft`).set('Origin', ORIGIN).send({ sections: [{ id: 'sec_hero1', type: 'HERO', data: { imageUrl: 'javascript:alert(1)' } }] });
    expect(scriptUrl.status).toBe(400);
    const valid = await agent.put(`/api/v1/projects/${projectId}/page/draft`).set('Origin', ORIGIN).send({ sections: [{ id: 'sec_hero1', type: 'HERO', data: { headline: 'Homes near Gomti Nagar' } }, { id: 'sec_cta01', type: 'CTA', data: { heading: 'Book a site visit' } }] });
    expect(valid.status).toBe(200);
  });

  it('activates custom domains only after DNS proves ownership, and never across organisations', async () => {
    const refs = await lucknowRefs(ctx.prisma);
    const admin = await createUser(ctx.prisma, { roleKey: 'ADMIN' });
    const agent = await loginAgent(ctx, admin.email!);
    const developer = await createOrg(ctx.prisma, { type: 'DEVELOPER' });

    const project = async (organizationId?: string) => {
      const r = await agent.post('/api/v1/projects').set('Origin', ORIGIN).send({
        name: 'Domain Test Enclave',
        slug: uniq('domain-test-'),
        projectType: 'RESIDENTIAL_PLOTS',
        cityId: refs.city.id,
        localityId: refs.locality.id,
        description: 'Integration-test project used to verify custom domain verification rules.',
        heroImageUrl: '/images/test-hero.jpg',
        ...(organizationId ? { organizationId } : {}),
      });
      expect(r.status).toBe(201);
      const pub = await agent.post(`/api/v1/projects/${r.body.id}/publish`).set('Origin', ORIGIN);
      return { id: r.body.id as string, slug: r.body.slug as string, publishStatus: pub.status };
    };
    const own = await project();
    expect(own.publishStatus).toBe(201);
    const other = await project(developer.id);

    const http = request(ctx.app.getHttpServer());
    const hostname = `www.${uniq('estate-test-')}.example`;

    // Platform hostnames cannot be claimed as custom domains.
    const root = process.env.PLATFORM_ROOT_DOMAIN!;
    expect((await agent.post(`/api/v1/projects/${own.id}/domains`).set('Origin', ORIGIN).send({ type: 'CUSTOM', hostname: `shop.${root}` })).status).toBe(400);

    // Subdomains of the platform zone are live immediately.
    const label = uniq('tst').toLowerCase().slice(0, 30);
    const sub = await agent.post(`/api/v1/projects/${own.id}/domains`).set('Origin', ORIGIN).send({ type: 'SUBDOMAIN', label });
    expect(sub.status).toBe(201);
    const resolvedSub = await http.get(`/api/v1/public/domains/resolve?host=${label}.${root}`);
    expect(resolvedSub.status).toBe(200);
    expect(resolvedSub.body.projectSlug).toBe(own.slug);

    // A custom domain starts pending; it cannot be enabled, resolved or issued a certificate.
    const added = await agent.post(`/api/v1/projects/${own.id}/domains`).set('Origin', ORIGIN).send({ type: 'CUSTOM', hostname: hostname.toUpperCase() });
    expect(added.status).toBe(201);
    expect(added.body.status).toBe('PENDING_VERIFICATION');
    expect(added.body.hostname).toBe(hostname);
    const domainId: string = added.body.id;
    expect((await agent.post(`/api/v1/project-domains/${domainId}/enable`).set('Origin', ORIGIN)).status).toBe(409);
    expect((await http.get(`/api/v1/public/domains/resolve?host=${hostname}`)).status).toBe(404);
    expect((await http.get(`/api/v1/public/domains/tls-check?domain=${hostname}`)).status).toBe(404);

    // Another organisation cannot take the hostname.
    const claim = await agent.post(`/api/v1/projects/${other.id}/domains`).set('Origin', ORIGIN).send({ type: 'CUSTOM', hostname });
    expect(claim.status).toBe(409);
    expect(claim.body.code).toBe('DOMAIN_CLAIMED');

    // DNS without the TXT record: stays pending, with the real reason recorded.
    const dns = jest.spyOn(domains, 'checkDns');
    dns.mockResolvedValueOnce({ txtOk: false, txtValues: [], txtError: `TXT record _estate-verify.${hostname} was not found (ENOTFOUND)`, targetOk: false, targetDetail: 'No CNAME record' });
    const failed = await agent.post(`/api/v1/project-domains/${domainId}/verify`).set('Origin', ORIGIN);
    expect(failed.status).toBe(201);
    let row = await ctx.prisma.projectDomain.findUniqueOrThrow({ where: { id: domainId } });
    expect(row.status).toBe('PENDING_VERIFICATION');
    expect(row.verifiedAt).toBeNull();
    expect(row.lastError).toContain('was not found');

    // Matching TXT record: verified, then enabled; only now does the host resolve and qualify for TLS.
    dns.mockResolvedValueOnce({ txtOk: true, txtValues: [row.verificationToken], txtError: null, targetOk: true, targetDetail: 'CNAME → sites.example' });
    expect((await agent.post(`/api/v1/project-domains/${domainId}/verify`).set('Origin', ORIGIN)).status).toBe(201);
    row = await ctx.prisma.projectDomain.findUniqueOrThrow({ where: { id: domainId } });
    expect(row.status).toBe('VERIFIED');
    expect((await agent.post(`/api/v1/project-domains/${domainId}/enable`).set('Origin', ORIGIN)).status).toBe(201);
    const resolved = await http.get(`/api/v1/public/domains/resolve?host=${hostname}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.projectSlug).toBe(own.slug);
    expect((await http.get(`/api/v1/public/domains/tls-check?domain=${hostname}`)).status).toBe(200);

    // Disabling stops resolution and certificates immediately.
    expect((await agent.post(`/api/v1/project-domains/${domainId}/disable`).set('Origin', ORIGIN)).status).toBe(201);
    expect((await http.get(`/api/v1/public/domains/resolve?host=${hostname}`)).status).toBe(404);
    expect((await http.get(`/api/v1/public/domains/tls-check?domain=${hostname}`)).status).toBe(404);
    dns.mockRestore();
  });
});
