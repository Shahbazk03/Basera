import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';
import { HostnameError, normalizeHostname, normalizeRequestHost, validateSubdomainLabel, verificationRecordName } from '@estate/shared';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { randomToken } from '../../common/crypto';
import { env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from './projects.service';
import { publicProjectWhere } from './project-card';

const MAX_DOMAINS_PER_PROJECT = 10;
const VERIFICATION_WINDOW_HOURS = 72;

interface DnsCheck {
  txtOk: boolean;
  txtValues: string[];
  txtError: string | null;
  targetOk: boolean;
  targetDetail: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Builds a browsable URL for a mapped host, mirroring the protocol/port used by the public web app. */
export function domainUrl(host: string): string {
  try {
    const web = new URL(env().WEB_PUBLIC_URL);
    if (web.protocol === 'http:' && (host === env().PLATFORM_ROOT_DOMAIN || host.endsWith(`.${env().PLATFORM_ROOT_DOMAIN}`))) {
      return `http://${host}${web.port ? `:${web.port}` : ''}`;
    }
  } catch {
    /* fall through */
  }
  return `https://${host}`;
}

@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly projects: ProjectsService,
  ) {}

  private rootDomain(): string {
    return env().PLATFORM_ROOT_DOMAIN.toLowerCase();
  }

  /** Hosts that always serve the marketplace/console/API and can never be mapped to a project. */
  private reservedHosts(): Set<string> {
    const e = env();
    const hosts = new Set<string>(e.PLATFORM_MAIN_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
    for (const u of [e.WEB_PUBLIC_URL, e.CONSOLE_PUBLIC_URL, e.API_PUBLIC_URL]) {
      const h = hostOf(u);
      if (h) hosts.add(h);
    }
    hosts.add(this.rootDomain());
    hosts.add(`www.${this.rootDomain()}`);
    return hosts;
  }

  private async projectFor(user: AuthUser, projectId: string) {
    const p = await this.projects.loadForAccess(user, projectId);
    user.assert('project.domain.manage', p.organizationId, 'You cannot manage domains for this project');
    return p;
  }

  private async domainFor(user: AuthUser, domainId: string) {
    const d = await this.prisma.projectDomain.findUnique({ where: { id: domainId }, include: { project: { select: { id: true, name: true, organizationId: true, developerOrgId: true, deletedAt: true } } } });
    if (!d || d.project.deletedAt || !this.projects.canView(user, d.project)) throw new NotFoundException('Domain not found');
    user.assert('project.domain.manage', d.project.organizationId, 'You cannot manage domains for this project');
    return d;
  }

  instructions(d: { hostname: string; type: string; verificationRecord: string; verificationToken: string }) {
    const e = env();
    if (d.type === 'SUBDOMAIN') {
      return { type: 'SUBDOMAIN' as const, notes: [`${d.hostname} is served by the platform's wildcard DNS for *.${this.rootDomain()}. No DNS changes are needed.`] };
    }
    const labels = d.hostname.split('.');
    const isApex = labels.length === 2;
    return {
      type: 'CUSTOM' as const,
      txt: { name: d.verificationRecord, value: d.verificationToken },
      cname: e.CUSTOM_DOMAIN_CNAME_TARGET ? { name: d.hostname, target: e.CUSTOM_DOMAIN_CNAME_TARGET } : null,
      a: e.CUSTOM_DOMAIN_A_RECORD ? { name: d.hostname, value: e.CUSTOM_DOMAIN_A_RECORD } : null,
      notes: [
        `1. Create a TXT record named ${d.verificationRecord} with the value shown — this proves you control the domain.`,
        isApex
          ? `2. ${d.hostname} is a root (apex) domain: most DNS providers do not allow a CNAME here. ${e.CUSTOM_DOMAIN_A_RECORD ? `Create an A record pointing to ${e.CUSTOM_DOMAIN_A_RECORD}` : 'Use your provider’s ALIAS/ANAME (CNAME flattening) record'} — or use www.${d.hostname} instead.`
          : `2. Point ${d.hostname} at the platform with a CNAME record${e.CUSTOM_DOMAIN_CNAME_TARGET ? ` to ${e.CUSTOM_DOMAIN_CNAME_TARGET}` : ''}${e.CUSTOM_DOMAIN_A_RECORD ? ` (or an A record to ${e.CUSTOM_DOMAIN_A_RECORD})` : ''}.`,
        '3. DNS changes can take from a few minutes up to 48 hours to propagate. Press “Verify” once the records are in place — we also re-check automatically every 15 minutes for 72 hours.',
        e.TLS_PROVIDER === 'caddy-on-demand'
          ? '4. HTTPS certificates are issued automatically on the first visit after the domain is enabled.'
          : '4. HTTPS must be provided by your hosting/CDN configuration for this domain (TLS is not managed by the platform in this environment).',
      ],
    };
  }

  private present<T extends { hostname: string; type: string; verificationRecord: string; verificationToken: string }>(d: T) {
    return { ...d, url: domainUrl(d.hostname), instructions: this.instructions(d) };
  }

  async list(user: AuthUser, projectId: string) {
    await this.projectFor(user, projectId);
    const rows = await this.prisma.projectDomain.findMany({ where: { projectId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], include: { createdBy: { select: { fullName: true } } } });
    return {
      rootDomain: this.rootDomain(),
      tlsProvider: env().TLS_PROVIDER,
      cnameTarget: env().CUSTOM_DOMAIN_CNAME_TARGET || null,
      aRecord: env().CUSTOM_DOMAIN_A_RECORD ?? null,
      domains: rows.map((r) => this.present(r)),
    };
  }

  async add(user: AuthUser, projectId: string, input: { type: 'SUBDOMAIN'; label: string } | { type: 'CUSTOM'; hostname: string }) {
    const p = await this.projectFor(user, projectId);
    if ((await this.prisma.projectDomain.count({ where: { projectId } })) >= MAX_DOMAINS_PER_PROJECT) throw new ConflictException(`A project can have at most ${MAX_DOMAINS_PER_PROJECT} domains`);
    const root = this.rootDomain();
    let hostname: string;
    if (input.type === 'SUBDOMAIN') {
      const label = input.label.trim().toLowerCase();
      const problem = validateSubdomainLabel(label);
      if (problem) throw new BadRequestException({ message: problem, details: [{ path: 'label', message: problem }] });
      hostname = `${label}.${root}`;
    } else {
      try {
        hostname = normalizeHostname(input.hostname);
      } catch (e) {
        const message = e instanceof HostnameError ? e.message : 'Enter a valid domain name';
        throw new BadRequestException({ message, details: [{ path: 'hostname', message }] });
      }
      if (this.reservedHosts().has(hostname) || hostname === root || hostname.endsWith(`.${root}`)) {
        throw new BadRequestException({ message: `${hostname} belongs to the platform — add a subdomain instead of a custom domain`, details: [{ path: 'hostname', message: 'Platform domain' }] });
      }
    }
    const existing = await this.prisma.projectDomain.findUnique({ where: { hostname }, include: { project: { select: { id: true, name: true } } } });
    if (existing) {
      if (existing.projectId === projectId) throw new ConflictException({ message: `${hostname} is already added to this project`, code: 'DOMAIN_EXISTS' });
      if (existing.organizationId !== p.organizationId) {
        throw new ConflictException({ message: `${hostname} is registered to another organisation on the platform. If you own this domain, contact support to have it released.`, code: 'DOMAIN_CLAIMED' });
      }
      throw new ConflictException({ message: `${hostname} is already used by your project “${existing.project.name}”. Remove it there first.`, code: 'DOMAIN_IN_USE' });
    }
    const now = new Date();
    const isSub = input.type === 'SUBDOMAIN';
    const data: Prisma.ProjectDomainUncheckedCreateInput = isSub
      ? {
          projectId,
          organizationId: p.organizationId,
          hostname,
          type: 'SUBDOMAIN',
          status: 'ACTIVE',
          verificationToken: 'platform-managed',
          verificationRecord: 'platform-managed',
          verifiedAt: now,
          enabledAt: now,
          dnsTargetOk: true,
          sslStatus: env().TLS_PROVIDER === 'caddy-on-demand' ? 'PENDING' : 'MANAGED_EXTERNALLY',
          createdById: user.id,
          isPrimary: false,
        }
      : {
          projectId,
          organizationId: p.organizationId,
          hostname,
          type: 'CUSTOM',
          status: 'PENDING_VERIFICATION',
          verificationToken: `estate-verify=${randomToken(24)}`,
          verificationRecord: verificationRecordName(hostname),
          sslStatus: 'NOT_REQUESTED',
          createdById: user.id,
        };
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectDomain.create({ data });
      await this.audit.log({ actorId: user.id, action: 'project.domain.add', entityType: 'ProjectDomain', entityId: row.id, organizationId: p.organizationId, after: { hostname, type: row.type, status: row.status } }, tx);
      return row;
    });
    return this.present(created);
  }

  async checkDns(hostname: string, record: string, token: string): Promise<DnsCheck> {
    const resolver = new Resolver({ timeout: 4000, tries: 2 });
    const out: DnsCheck = { txtOk: false, txtValues: [], txtError: null, targetOk: false, targetDetail: '' };
    try {
      const records = await resolver.resolveTxt(record);
      out.txtValues = records.map((chunks) => chunks.join(''));
      out.txtOk = out.txtValues.some((v) => v.trim() === token);
      if (!out.txtOk) out.txtError = `TXT record ${record} exists but none of its values match the verification token`;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'ERROR';
      out.txtError = `TXT record ${record} was not found (${code})`;
    }
    const e = env();
    const want = e.CUSTOM_DOMAIN_CNAME_TARGET.toLowerCase().replace(/\.$/, '');
    try {
      const cnames = await resolver.resolveCname(hostname);
      const found = cnames.map((c) => c.toLowerCase().replace(/\.$/, ''));
      out.targetOk = Boolean(want) && found.includes(want);
      out.targetDetail = `CNAME → ${found.join(', ') || 'none'}`;
    } catch {
      out.targetDetail = 'No CNAME record';
    }
    if (!out.targetOk && e.CUSTOM_DOMAIN_A_RECORD) {
      try {
        const a = await resolver.resolve4(hostname);
        out.targetOk = a.includes(e.CUSTOM_DOMAIN_A_RECORD);
        out.targetDetail += `; A → ${a.join(', ') || 'none'}`;
      } catch {
        out.targetDetail += '; no A record';
      }
    }
    return out;
  }

  /** Runs DNS verification for a custom domain and records the honest outcome. */
  async verifyRecord(d: { id: string; hostname: string; type: string; status: string; verificationRecord: string; verificationToken: string; verifiedAt: Date | null; createdAt: Date }, db: PrismaService | Tx = this.prisma) {
    const result = await this.checkDns(d.hostname, d.verificationRecord, d.verificationToken);
    const now = new Date();
    let status = d.status;
    if (result.txtOk && d.status === 'PENDING_VERIFICATION') status = 'VERIFIED';
    if (result.txtOk && d.status === 'FAILED') status = 'VERIFIED';
    if (!result.txtOk && d.status === 'PENDING_VERIFICATION' && now.getTime() - d.createdAt.getTime() > VERIFICATION_WINDOW_HOURS * 3_600_000) status = 'FAILED';
    const errors = [result.txtError, result.targetOk ? null : `Domain does not point to the platform yet (${result.targetDetail})`].filter(Boolean);
    const updated = await db.projectDomain.update({
      where: { id: d.id },
      data: {
        status: status as never,
        lastCheckedAt: now,
        dnsTargetOk: result.targetOk,
        verifiedAt: result.txtOk && !d.verifiedAt ? now : d.verifiedAt,
        lastError: errors.length ? errors.join('. ') : null,
      },
    });
    return { updated, result };
  }

  async verify(user: AuthUser, domainId: string) {
    const d = await this.domainFor(user, domainId);
    if (d.type === 'SUBDOMAIN') return this.present(d);
    const { updated, result } = await this.verifyRecord(d);
    await this.audit.log({ actorId: user.id, action: 'project.domain.verify', entityType: 'ProjectDomain', entityId: d.id, organizationId: d.project.organizationId, after: { status: updated.status, txtOk: result.txtOk, dnsTargetOk: result.targetOk } });
    if (updated.status !== d.status) await this.notifyVerification(updated.id);
    return { ...this.present(updated), check: result };
  }

  private async notifyVerification(domainId: string) {
    const d = await this.prisma.projectDomain.findUnique({ where: { id: domainId }, include: { project: { select: { id: true, name: true } } } });
    if (!d?.createdById) return;
    const r = await this.notifications.userRecipient(d.createdById);
    if (!r) return;
    const result = d.status === 'VERIFIED' ? 'verified' : d.status === 'FAILED' ? 'verification failed' : d.status.replace(/_/g, ' ').toLowerCase();
    await this.notifications.send({
      eventKey: 'domain.verification',
      recipients: [r],
      channels: ['IN_APP', 'EMAIL'],
      data: { hostname: d.hostname, projectName: d.project.name, result, detail: d.status === 'VERIFIED' ? 'Enable the domain to start serving the project microsite.' : (d.lastError ?? '') },
      link: `/projects/${d.project.id}?tab=domains`,
      relatedType: 'ProjectDomain',
      relatedId: d.id,
    });
  }

  async enable(user: AuthUser, domainId: string) {
    const d = await this.domainFor(user, domainId);
    if (d.status === 'ACTIVE') return this.present(d);
    if (!d.verifiedAt || !['VERIFIED', 'DISABLED'].includes(d.status)) {
      throw new ConflictException({ message: 'Verify ownership of the domain before enabling it', code: 'DOMAIN_NOT_VERIFIED' });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectDomain.update({
        where: { id: domainId },
        data: { status: 'ACTIVE', enabledAt: new Date(), disabledAt: null, sslStatus: d.type === 'SUBDOMAIN' ? d.sslStatus : env().TLS_PROVIDER === 'caddy-on-demand' ? 'PENDING' : 'MANAGED_EXTERNALLY' },
      });
      await this.audit.log({ actorId: user.id, action: 'project.domain.enable', entityType: 'ProjectDomain', entityId: domainId, organizationId: d.project.organizationId }, tx);
      return row;
    });
    return { ...this.present(updated), warning: updated.dnsTargetOk ? null : 'Ownership is verified, but DNS does not point to the platform yet — visitors will not reach the microsite until the CNAME/A record is in place.' };
  }

  async disable(user: AuthUser, domainId: string) {
    const d = await this.domainFor(user, domainId);
    if (d.status !== 'ACTIVE') throw new ConflictException('Only active domains can be disabled');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectDomain.update({ where: { id: domainId }, data: { status: 'DISABLED', disabledAt: new Date(), isPrimary: false } });
      await this.audit.log({ actorId: user.id, action: 'project.domain.disable', entityType: 'ProjectDomain', entityId: domainId, organizationId: d.project.organizationId }, tx);
      return row;
    });
    return this.present(updated);
  }

  async setPrimary(user: AuthUser, domainId: string) {
    const d = await this.domainFor(user, domainId);
    if (d.status !== 'ACTIVE') throw new ConflictException('Only an active domain can be the primary address');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.projectDomain.updateMany({ where: { projectId: d.projectId, isPrimary: true }, data: { isPrimary: false } });
      const row = await tx.projectDomain.update({ where: { id: domainId }, data: { isPrimary: true } });
      await this.audit.log({ actorId: user.id, action: 'project.domain.primary', entityType: 'ProjectDomain', entityId: domainId, organizationId: d.project.organizationId }, tx);
      return row;
    });
    return this.present(updated);
  }

  async remove(user: AuthUser, domainId: string) {
    const d = await this.domainFor(user, domainId);
    await this.prisma.$transaction(async (tx) => {
      await tx.projectDomain.delete({ where: { id: domainId } });
      await this.audit.log({ actorId: user.id, action: 'project.domain.remove', entityType: 'ProjectDomain', entityId: domainId, organizationId: d.project.organizationId, before: { hostname: d.hostname, status: d.status } }, tx);
    });
    return { ok: true };
  }

  /** Probes https://host:443 and records whether a valid certificate is served. */
  probeTls(host: string): Promise<{ ok: boolean; validTo?: string; issuer?: string; error?: string }> {
    return new Promise((resolve) => {
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 6000, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        resolve({ ok: authorized, validTo: cert?.valid_to, issuer: (cert?.issuer as { O?: string } | undefined)?.O, error: authorized ? undefined : String(socket.authorizationError ?? 'Certificate not trusted') });
        socket.end();
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      });
      socket.on('error', (e) => resolve({ ok: false, error: e.message }));
    });
  }

  async checkSsl(user: AuthUser, domainId: string) {
    const d = await this.domainFor(user, domainId);
    const root = this.rootDomain();
    if (root === 'localhost' && d.hostname.endsWith('.localhost')) {
      throw new ConflictException('Local development subdomains are served over plain HTTP — there is no certificate to check');
    }
    if (d.status !== 'ACTIVE') throw new ConflictException('Enable the domain before checking its certificate');
    const probe = await this.probeTls(d.hostname);
    const updated = await this.prisma.projectDomain.update({
      where: { id: domainId },
      data: { sslStatus: probe.ok ? 'ACTIVE' : 'FAILED', lastCheckedAt: new Date(), lastError: probe.ok ? d.lastError : `HTTPS check failed: ${probe.error}` },
    });
    await this.audit.log({ actorId: user.id, action: 'project.domain.ssl_check', entityType: 'ProjectDomain', entityId: domainId, organizationId: d.project.organizationId, after: { sslStatus: updated.sslStatus, validTo: probe.validTo } });
    return { ...this.present(updated), probe };
  }

  // ───────────────────────── Public resolution ─────────────────────────

  async resolve(hostRaw: string) {
    const host = normalizeRequestHost(hostRaw);
    if (!host) throw new NotFoundException('Domain not configured');
    const d = await this.prisma.projectDomain.findUnique({ where: { hostname: host }, select: { status: true, projectId: true } });
    if (!d || d.status !== 'ACTIVE') throw new NotFoundException('Domain not configured');
    const project = await this.prisma.project.findFirst({ where: { id: d.projectId, ...publicProjectWhere() }, select: { slug: true } });
    if (!project) throw new NotFoundException('Domain not configured');
    const primary = await this.prisma.projectDomain.findFirst({ where: { projectId: d.projectId, isPrimary: true, status: 'ACTIVE' }, select: { hostname: true } });
    return { projectSlug: project.slug, canonicalHost: primary?.hostname ?? host };
  }

  /** Caddy on-demand TLS "ask" endpoint: only ACTIVE mapped hosts may obtain certificates. */
  async tlsAllowed(domain: string): Promise<boolean> {
    const host = normalizeRequestHost(domain);
    if (!host) return false;
    const d = await this.prisma.projectDomain.findUnique({ where: { hostname: host }, select: { status: true } });
    return d?.status === 'ACTIVE';
  }

  /** Background re-check of pending custom domains (and expiry after the verification window). */
  async recheckPending(): Promise<number> {
    const pending = await this.prisma.projectDomain.findMany({
      where: { type: 'CUSTOM', status: 'PENDING_VERIFICATION', project: { deletedAt: null }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
      take: 50,
    });
    for (const d of pending) {
      const { updated } = await this.verifyRecord(d);
      if (updated.status !== d.status) await this.notifyVerification(d.id);
    }
    return pending.length;
  }
}
