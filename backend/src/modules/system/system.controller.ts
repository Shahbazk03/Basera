import { Body, Controller, Get, Param, Put, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import IORedis from 'ioredis';
import { z } from 'zod';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { paginated, paginationSchema, skipTake } from '../../common/http';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { PrismaService } from '../../prisma/prisma.service';

const startedAt = new Date();

@ApiTags('System')
@Controller({ version: '1' })
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Liveness: the process is up. */
  @Public()
  @SkipThrottle()
  @Get('health')
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), startedAt: startedAt.toISOString(), environment: env().APP_ENV };
  }

  /** Readiness: dependencies reachable. Returns 503 if the database is down. */
  @Public()
  @SkipThrottle()
  @Get('health/ready')
  async ready() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string; configured?: boolean }> = {};
    const t0 = Date.now();
    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
      checks.database = { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      checks.database = { ok: false, error: (e as Error).message };
    }
    const redisUrl = env().REDIS_URL;
    if (redisUrl) {
      const client = new IORedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
      const t1 = Date.now();
      try {
        await client.connect();
        await client.ping();
        checks.redis = { ok: true, latencyMs: Date.now() - t1 };
      } catch (e) {
        checks.redis = { ok: false, error: (e as Error).message };
      } finally {
        client.disconnect();
      }
    } else checks.redis = { ok: true, configured: false };
    const ok = checks.database.ok;
    const body = { status: ok ? 'ready' : 'degraded', checks };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }

  @Public()
  @Get('public/settings')
  publicSettings() {
    return this.settings.publicSettings();
  }

  @Get('admin/settings')
  @RequirePermissions('settings.manage')
  allSettings() {
    return this.settings.all();
  }

  @Put('admin/settings/:key')
  @RequirePermissions('settings.manage')
  async updateSetting(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body(new ZodPipe(z.object({ value: z.unknown() }))) body: { value: unknown }) {
    const before = await this.settings.get(key as never);
    const value = await this.settings.set(key, body.value, user.id);
    await this.audit.log({ actorId: user.id, action: 'settings.update', entityType: 'SystemSetting', entityId: key, before: { value: before }, after: { value } });
    return { key, value };
  }

  @Get('admin/feature-flags')
  @RequirePermissions('settings.manage')
  featureFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  @Put('admin/feature-flags/:key')
  @RequirePermissions('settings.manage')
  async setFlag(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body(new ZodPipe(z.object({ enabled: z.boolean() }))) body: { enabled: boolean }) {
    const flag = await this.prisma.featureFlag.update({ where: { key }, data: { enabled: body.enabled } });
    await this.audit.log({ actorId: user.id, action: 'feature_flag.update', entityType: 'FeatureFlag', entityId: key, after: flag });
    return flag;
  }

  @Get('admin/audit-logs')
  @RequirePermissions('audit.view')
  async auditLogs(
    @Query(
      new ZodPipe(
        paginationSchema.extend({
          entityType: z.string().max(60).optional(),
          entityId: z.string().max(60).optional(),
          actorId: z.uuid().optional(),
          action: z.string().max(80).optional(),
        }),
      ),
    )
    q: { page: number; pageSize: number; entityType?: string; entityId?: string; actorId?: string; action?: string },
  ) {
    const where = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, include: { actor: { select: { id: true, fullName: true, email: true } } }, ...skipTake(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(rows, total, q);
  }
}
