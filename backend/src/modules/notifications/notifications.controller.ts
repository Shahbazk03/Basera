import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DELIVERY_STATUSES, NOTIFICATION_CHANNELS, queryBoolean } from '@estate/shared';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { paginated, paginationSchema, skipTake } from '../../common/http';
import { UuidParam, ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { DEFAULT_TEMPLATES } from './templates';
import { enumRank } from '../../common/ordering';
import { NotificationChannel } from '@prisma/client';

const logQuery = paginationSchema.extend({
  status: z.enum(DELIVERY_STATUSES).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  q: z.string().trim().max(100).optional(),
});

/** Messages whose body carries a one-time secret (verification / password-reset links). */
const SECRET_EVENT_PREFIXES = ['auth.'];
const REDACTED_BODY = 'Hidden: this message contains a one-time security link that only the recipient may see.';

/** Delivery logs and templates are platform administration: a grant scoped to a partner organisation is not enough. */
function assertPlatformAdmin(user: AuthUser) {
  const platform = user.platformOrganizationId;
  if (!user.hasGlobal('notification.manage') && !(platform && user.can('notification.manage', platform))) {
    throw new ForbiddenException('You do not have permission to manage platform notifications');
  }
}

const templateSchema = z.object({
  eventKey: z.string().min(3).max(60),
  channel: z.enum(NOTIFICATION_CHANNELS),
  subject: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().min(2).max(4000),
  isActive: z.boolean().default(true),
});

@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema.extend({ unread: queryBoolean }))) q: { page: number; pageSize: number; unread?: boolean }) {
    const where = { userId: user.id, ...(q.unread ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { ...paginated(rows, total, q), unread };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { unread: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    const res = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  // ── Administration ──

  @Get('admin/integrations')
  @RequirePermissions('notification.manage')
  integrations(@CurrentUser() user: AuthUser) {
    assertPlatformAdmin(user);
    return { channels: this.notifications.channelStatus() };
  }

  @Get('admin/logs')
  @RequirePermissions('notification.manage')
  async logs(@CurrentUser() user: AuthUser, @Query(new ZodPipe(logQuery)) q: z.output<typeof logQuery>) {
    assertPlatformAdmin(user);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.q ? { OR: [{ recipient: { contains: q.q, mode: 'insensitive' as const } }, { eventKey: { contains: q.q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.communicationLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.communicationLog.count({ where }),
    ]);
    const counts = await this.prisma.communicationLog.groupBy({ by: ['status'], _count: { _all: true } });
    const safe = rows.map((r) => (SECRET_EVENT_PREFIXES.some((p) => r.eventKey.startsWith(p)) ? { ...r, body: REDACTED_BODY, redacted: true } : { ...r, redacted: false }));
    return { ...paginated(safe, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  @Post('admin/logs/:id/retry')
  @RequirePermissions('notification.manage')
  async retry(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    assertPlatformAdmin(user);
    const row = await this.prisma.communicationLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Message not found');
    await this.prisma.communicationLog.update({ where: { id }, data: { status: 'QUEUED', nextAttemptAt: new Date(), lastError: null } });
    await this.audit.log({ actorId: user.id, action: 'notification.retry', entityType: 'CommunicationLog', entityId: id });
    const status = await this.notifications.deliver(id);
    return { id, status };
  }

  @Get('admin/templates')
  @RequirePermissions('notification.manage')
  async templates(@CurrentUser() user: AuthUser) {
    assertPlatformAdmin(user);
    const channelRank = enumRank(NotificationChannel);
    const custom = (await this.prisma.notificationTemplate.findMany({ orderBy: [{ eventKey: 'asc' }] })).sort((a, b) => (a.eventKey === b.eventKey ? channelRank(a.channel) - channelRank(b.channel) : 0));
    const defaults = Object.entries(DEFAULT_TEMPLATES).flatMap(([eventKey, channels]) =>
      Object.entries(channels).map(([channel, t]) => ({ eventKey, channel, subject: t?.subject ?? null, body: t?.body ?? '' })),
    );
    return { custom, defaults };
  }

  @Put('admin/templates')
  @RequirePermissions('notification.manage')
  async upsertTemplate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(templateSchema)) body: z.output<typeof templateSchema>) {
    assertPlatformAdmin(user);
    const row = await this.prisma.notificationTemplate.upsert({
      where: { eventKey_channel: { eventKey: body.eventKey, channel: body.channel } },
      create: { eventKey: body.eventKey, channel: body.channel, subject: body.subject ?? null, body: body.body, isActive: body.isActive },
      update: { subject: body.subject ?? null, body: body.body, isActive: body.isActive },
    });
    await this.audit.log({ actorId: user.id, action: 'notification.template.update', entityType: 'NotificationTemplate', entityId: row.id, after: row });
    return row;
  }
}
