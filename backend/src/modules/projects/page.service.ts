import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { defaultProjectPage, pageSectionsSchema, type PageSection } from '@estate/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit.service';
import { randomToken, safeEqual } from '../../common/crypto';
import { zodIssues } from '../../common/zod.pipe';
import { env } from '../../config/env';
import { ProjectsService } from './projects.service';

const PREVIEW_TTL_HOURS = 24;

@Injectable()
export class PageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  private async access(user: AuthUser, projectId: string, write = false) {
    const p = await this.projects.loadForAccess(user, projectId);
    if (write) user.assert('project.page.manage', p.organizationId, 'You cannot edit this project page');
    return p;
  }

  private async ensurePage(projectId: string) {
    const existing = await this.prisma.projectPage.findUnique({ where: { projectId } });
    if (existing) return existing;
    return this.prisma.projectPage.create({ data: { projectId, draftSections: defaultProjectPage() as unknown as Prisma.InputJsonValue } });
  }

  private validate(sections: unknown): PageSection[] {
    const parsed = pageSectionsSchema.safeParse(sections);
    if (!parsed.success) throw new BadRequestException({ message: 'The page contains invalid sections', code: 'INVALID_SECTIONS', details: zodIssues(parsed.error) });
    return parsed.data as PageSection[];
  }

  async get(user: AuthUser, projectId: string) {
    const p = await this.access(user, projectId);
    const page = await this.ensurePage(projectId);
    const draft = page.draftSections as unknown as PageSection[];
    const published = (page.publishedSections ?? null) as unknown as PageSection[] | null;
    const token = this.parseToken(page.previewToken);
    return {
      projectId,
      slug: p.slug,
      draftSections: draft,
      publishedSections: published,
      revision: page.revision,
      publishedAt: page.publishedAt,
      draftUpdatedAt: page.draftUpdatedAt,
      hasUnpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published),
      preview: token && token.expiresAt > new Date() ? { token: page.previewToken!, expiresAt: token.expiresAt, url: this.previewUrl(p.slug, page.previewToken!) } : null,
      canPublish: this.canPublishPage(user, p),
    };
  }

  /** Publishing the live page follows the same rule as publishing the project (review-controlled organisations need a publisher). */
  private canPublishPage(user: AuthUser, p: { organizationId: string; organization: { projectPublishMode: string } }) {
    return user.can('project.publish', p.organizationId) || (p.organization.projectPublishMode === 'DIRECT' && user.can('project.page.manage', p.organizationId));
  }

  async saveDraft(user: AuthUser, projectId: string, sections: unknown) {
    const p = await this.access(user, projectId, true);
    const valid = this.validate(sections);
    await this.ensurePage(projectId);
    await this.prisma.$transaction(async (tx) => {
      await tx.projectPage.update({ where: { projectId }, data: { draftSections: valid as unknown as Prisma.InputJsonValue, draftUpdatedAt: new Date() } });
      await this.audit.log({ actorId: user.id, action: 'project.page.save_draft', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, metadata: { sections: valid.length } }, tx);
    });
    return this.get(user, projectId);
  }

  async publish(user: AuthUser, projectId: string) {
    const p = await this.access(user, projectId, true);
    if (!this.canPublishPage(user, p)) throw new ForbiddenException('Page changes for this organisation are published by the review team — save your draft and ask a reviewer to publish it');
    const page = await this.ensurePage(projectId);
    const valid = this.validate(page.draftSections);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.projectPage.update({
        where: { projectId },
        data: { publishedSections: valid as unknown as Prisma.InputJsonValue, publishedAt: new Date(), publishedById: user.id, revision: { increment: 1 } },
      });
      await tx.projectPageRevision.create({ data: { projectId, revision: updated.revision, sections: valid as unknown as Prisma.InputJsonValue, publishedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'project.page.publish', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, metadata: { revision: updated.revision } }, tx);
    });
    return this.get(user, projectId);
  }

  async revisions(user: AuthUser, projectId: string) {
    await this.access(user, projectId);
    return this.prisma.projectPageRevision.findMany({
      where: { projectId },
      orderBy: { revision: 'desc' },
      select: { id: true, revision: true, createdAt: true, publishedBy: { select: { fullName: true } }, sections: true },
      take: 50,
    });
  }

  async restore(user: AuthUser, projectId: string, revision: number) {
    const p = await this.access(user, projectId, true);
    const rev = await this.prisma.projectPageRevision.findUnique({ where: { projectId_revision: { projectId, revision } } });
    if (!rev) throw new NotFoundException('Revision not found');
    const valid = this.validate(rev.sections);
    await this.prisma.$transaction(async (tx) => {
      await tx.projectPage.update({ where: { projectId }, data: { draftSections: valid as unknown as Prisma.InputJsonValue, draftUpdatedAt: new Date() } });
      await this.audit.log({ actorId: user.id, action: 'project.page.restore', entityType: 'Project', entityId: projectId, organizationId: p.organizationId, metadata: { revision } }, tx);
    });
    return this.get(user, projectId);
  }

  // ───────────────────────── Preview ─────────────────────────

  private parseToken(token: string | null): { expiresAt: Date } | null {
    if (!token) return null;
    const exp = Number(token.split('.')[1]);
    return Number.isFinite(exp) ? { expiresAt: new Date(exp * 1000) } : null;
  }

  private previewUrl(slug: string, token: string) {
    return `${env().WEB_PUBLIC_URL.replace(/\/$/, '')}/projects/${slug}?preview=${encodeURIComponent(token)}`;
  }

  async createPreviewToken(user: AuthUser, projectId: string) {
    const p = await this.access(user, projectId, true);
    await this.ensurePage(projectId);
    const expires = Math.floor(Date.now() / 1000) + PREVIEW_TTL_HOURS * 3600;
    const token = `${randomToken(24)}.${expires}`;
    await this.prisma.projectPage.update({ where: { projectId }, data: { previewToken: token } });
    await this.audit.log({ actorId: user.id, action: 'project.page.preview_token', entityType: 'Project', entityId: projectId, organizationId: p.organizationId });
    return { token, expiresAt: new Date(expires * 1000), url: this.previewUrl(p.slug, token) };
  }

  /** True when `token` is the project's current, unexpired preview token. */
  async previewValid(projectId: string, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const page = await this.prisma.projectPage.findUnique({ where: { projectId }, select: { previewToken: true } });
    if (!page?.previewToken || !safeEqual(page.previewToken, token)) return false;
    const parsed = this.parseToken(page.previewToken);
    return Boolean(parsed && parsed.expiresAt > new Date());
  }
}
