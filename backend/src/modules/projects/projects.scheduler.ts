import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MANUAL_ONLY_PROJECT_STATUSES, type ProjectStatus } from '@estate/shared';
import { env } from '../../config/env';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { DomainsService } from './domains.service';
import { InventoryService } from './inventory.service';
import { ProjectsService } from './projects.service';

export interface StatusChange {
  projectId: string;
  from: ProjectStatus;
  to: ProjectStatus;
}

/**
 * Server-side lifecycle automation (single instance at a time via job leases):
 *  • every minute — release lapsed unit holds/reservations, then persist derived project statuses;
 *  • every 15 minutes — re-check DNS for custom domains awaiting verification.
 */
@Injectable()
export class ProjectsScheduler {
  private readonly logger = new Logger('ProjectsScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly inventory: InventoryService,
    private readonly domains: DomainsService,
  ) {}

  /** Job body (also callable directly from tests / ops tooling). */
  async runStatusJob(tx: Tx, now = new Date()): Promise<{ released: number; changes: StatusChange[] }> {
    const affected = await this.inventory.expireHolds(tx, now);
    const candidates = await tx.project.findMany({
      where: { deletedAt: null, autoStatus: true, status: { notIn: MANUAL_ONLY_PROJECT_STATUSES } },
      select: { id: true },
    });
    const ids = new Set([...candidates.map((c) => c.id), ...affected]);
    const changes: StatusChange[] = [];
    for (const id of ids) {
      const change = await this.projects.syncStatus(id, tx, null, now);
      if (change) changes.push({ projectId: id, ...change });
    }
    return { released: affected.length, changes };
  }

  async runStatusJobNow(): Promise<{ released: number; changes: StatusChange[] } | null> {
    const result = await this.prisma.withJobLock('jobs:project-status', (tx) => this.runStatusJob(tx));
    if (result) {
      for (const c of result.changes) {
        this.logger.log(`Project ${c.projectId}: ${c.from} → ${c.to}`);
        await this.projects.notifyStatusChange(c.projectId, c.to).catch((e) => this.logger.warn(`Notification failed: ${(e as Error).message}`));
      }
    }
    return result;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async statusTick(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    try {
      await this.runStatusJobNow();
    } catch (e) {
      this.logger.error(`Project status job failed: ${(e as Error).message}`);
    }
  }

  @Cron('0 */15 * * * *')
  async domainTick(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    try {
      const checked = await this.prisma.withJobLock('jobs:domain-recheck', () => this.domains.recheckPending(), { transactional: false, ttlMs: 30 * 60_000 });
      if (checked) this.logger.log(`Re-checked ${checked} pending domain(s)`);
    } catch (e) {
      this.logger.error(`Domain re-check failed: ${(e as Error).message}`);
    }
  }
}
