import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { PermissionKey } from '@estate/shared';
import { env } from '../../config/env';
import { DeliveryStatus, NotificationChannel, Prisma } from '@prisma/client';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { ChannelProvider, EmailProvider, SmsProvider, WhatsAppProvider } from './providers';
import { DEFAULT_TEMPLATES, renderTemplate } from './templates';

export interface Recipient {
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export interface NotifyInput {
  eventKey: string;
  recipients: Recipient[];
  channels: NotificationChannel[];
  data: Record<string, unknown>;
  link?: string | null;
  relatedType?: string;
  relatedId?: string;
}

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 900, 3600];
const QUEUE_NAME = 'notifications';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Notifications');
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private redis: IORedis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly providers: Record<Exclude<NotificationChannel, 'IN_APP'>, ChannelProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    readonly email: EmailProvider,
    readonly sms: SmsProvider,
    readonly whatsapp: WhatsAppProvider,
  ) {
    this.providers = { EMAIL: email, SMS: sms, WHATSAPP: whatsapp };
  }

  onModuleInit(): void {
    if (env().APP_ENV === 'test') return; // tests drive delivery explicitly via processDue()
    const redisUrl = env().REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
        this.redis.on('error', (err) => this.logger.warn(`Redis: ${err.message}`));
        this.queue = new Queue(QUEUE_NAME, { connection: this.redis });
        this.worker = new Worker(QUEUE_NAME, async (job) => this.deliver(String(job.data.id)), { connection: this.redis, concurrency: 5 });
        this.worker.on('failed', (job, err) => this.logger.warn(`Delivery job ${job?.id} failed: ${err.message}`));
        this.logger.log('Notification delivery: BullMQ (Redis)');
      } catch (err) {
        this.logger.warn(`BullMQ unavailable, using in-process delivery: ${(err as Error).message}`);
        this.queue = null;
      }
    } else {
      this.logger.log('Notification delivery: in-process outbox poller (REDIS_URL not set)');
    }
    // Sweeper: processes due rows without Redis, and recovers rows whose queue job was lost.
    this.timer = setInterval(() => void this.processDue(this.queue ? 120 : 0).catch((e) => this.logger.error(e)), 15_000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.redis?.disconnect();
  }

  /** Which delivery channels are usable (for the integrations screen and honest UI states). */
  channelStatus(): { channel: NotificationChannel; configured: boolean; provider: string; hint: string | null }[] {
    return [
      { channel: 'IN_APP', configured: true, provider: 'database', hint: null },
      ...(['EMAIL', 'SMS', 'WHATSAPP'] as const).map((c) => ({
        channel: c,
        configured: this.providers[c].isConfigured(),
        provider: this.providers[c].name,
        hint: this.providers[c].isConfigured() ? null : this.providers[c].configurationHint(),
      })),
    ];
  }

  /**
   * Records notifications (in-app rows + outbox rows) — pass a transaction client so they commit
   * atomically with the business change. Call kick() after the transaction commits.
   */
  /** Messages that contain a password: their stored body is wiped as soon as delivery is final (or impossible). */
  static readonly SECRET_BODY_EVENTS = new Set(['auth.password_set_by_admin']);
  static readonly WIPED_BODY = '[Removed after delivery — this message contained a password]';

  async notify(input: NotifyInput, db: Db = this.prisma): Promise<string[]> {
    const brand = await this.settings.getString('brand.name');
    const outboxIds: string[] = [];
    const templates = await db.notificationTemplate.findMany({ where: { eventKey: input.eventKey, isActive: true } });
    const seen = new Set<string>();
    // Written together at the end: one database round trip per kind instead of one per recipient
    // (inside a transaction, one-by-one writes for every staff member made it too slow).
    const inApp: Prisma.NotificationCreateManyInput[] = [];
    const unsent: Prisma.CommunicationLogCreateManyInput[] = [];

    for (const r of input.recipients) {
      for (const channel of input.channels) {
        const tpl = templates.find((t) => t.channel === channel) ?? DEFAULT_TEMPLATES[input.eventKey]?.[channel];
        if (!tpl) continue;
        const data = { brand, name: r.name ?? '', link: input.link ?? '', ...input.data };
        const subject = tpl.subject ? renderTemplate(tpl.subject, data) : null;
        const body = renderTemplate(tpl.body, data);

        if (channel === 'IN_APP') {
          if (!r.userId || seen.has(`IN_APP:${r.userId}`)) continue;
          seen.add(`IN_APP:${r.userId}`);
          inApp.push({ userId: r.userId, eventKey: input.eventKey, title: subject ?? input.eventKey, body, link: input.link ?? null });
          continue;
        }
        const address = channel === 'EMAIL' ? r.email : r.phone;
        if (!address || seen.has(`${channel}:${address}`)) continue;
        seen.add(`${channel}:${address}`);
        const provider = this.providers[channel];
        const configured = provider.isConfigured();
        const row: Prisma.CommunicationLogCreateManyInput = {
          channel,
          eventKey: input.eventKey,
          recipient: address,
          recipientUserId: r.userId ?? null,
          subject,
          body: !configured && NotificationsService.SECRET_BODY_EVENTS.has(input.eventKey) ? NotificationsService.WIPED_BODY : body,
          provider: provider.name,
          status: configured ? 'QUEUED' : 'NOT_CONFIGURED',
          nextAttemptAt: configured ? new Date() : null,
          lastError: configured ? null : provider.configurationHint(),
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
        };
        // A queued message needs its id for the delivery queue; the others are only a record.
        if (configured) outboxIds.push((await db.communicationLog.create({ data: row })).id);
        else unsent.push(row);
      }
    }
    if (inApp.length) await db.notification.createMany({ data: inApp });
    if (unsent.length) await db.communicationLog.createMany({ data: unsent });
    return outboxIds;
  }

  /** Dispatches queued outbox rows (call after the surrounding transaction has committed). */
  kick(ids: string[]): void {
    if (!ids.length || env().APP_ENV === 'test') return;
    if (this.queue) {
      for (const id of ids) void this.queue.add('deliver', { id }, { jobId: `${id}-0`, removeOnComplete: 1000, removeOnFail: 1000 }).catch(() => undefined);
    } else {
      setImmediate(() => void Promise.all(ids.map((id) => this.deliver(id))).catch((e) => this.logger.error(e)));
    }
  }

  /** Convenience: notify outside a transaction and dispatch immediately. */
  async send(input: NotifyInput): Promise<void> {
    const ids = await this.notify(input);
    this.kick(ids);
  }

  /** One delivery attempt with an atomic claim (safe under concurrent workers). */
  async deliver(id: string): Promise<DeliveryStatus | null> {
    // Single-document conditional update = atomic claim: only one worker moves nextAttemptAt forward.
    const now = new Date();
    const claimed = await this.prisma.communicationLog.updateMany({
      where: { id, status: 'QUEUED', nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
    });
    if (!claimed.count) return null;
    const row = await this.prisma.communicationLog.findUniqueOrThrow({ where: { id } });
    if (row.channel === 'IN_APP') return null;
    const provider = this.providers[row.channel];
    const wipe = NotificationsService.SECRET_BODY_EVENTS.has(row.eventKey) ? { body: NotificationsService.WIPED_BODY } : {};
    if (!provider.isConfigured()) {
      await this.prisma.communicationLog.update({ where: { id }, data: { status: 'NOT_CONFIGURED', nextAttemptAt: null, lastError: provider.configurationHint(), ...wipe } });
      return 'NOT_CONFIGURED';
    }
    try {
      const result = await provider.send(row.recipient, row.subject, row.body);
      await this.prisma.communicationLog.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, providerMessageId: result.providerMessageId ?? null, nextAttemptAt: null, lastError: null, ...wipe },
      });
      return 'SENT';
    } catch (err) {
      const attempts = row.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
      await this.prisma.communicationLog.update({
        where: { id },
        data: {
          attempts,
          status: final ? 'FAILED' : 'QUEUED',
          lastError: (err as Error).message.slice(0, 1000),
          ...(final ? wipe : {}),
          nextAttemptAt: final ? null : new Date(Date.now() + delay * 1000),
        },
      });
      if (!final && this.queue) {
        void this.queue.add('deliver', { id }, { jobId: `${id}-${attempts}`, delay: delay * 1000, removeOnComplete: 1000, removeOnFail: 1000 }).catch(() => undefined);
      }
      this.logger.warn(`Delivery ${id} via ${provider.name} failed (attempt ${attempts}): ${(err as Error).message}`);
      return final ? 'FAILED' : 'QUEUED';
    }
  }

  /** Processes due outbox rows. `staleSeconds` > 0 only picks rows overdue by that long (queue recovery). */
  async processDue(staleSeconds = 0, limit = 25): Promise<number> {
    const due = await this.prisma.communicationLog.findMany({
      where: { status: 'QUEUED', nextAttemptAt: { lte: new Date(Date.now() - staleSeconds * 1000) } },
      select: { id: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    for (const { id } of due) await this.deliver(id);
    return due.length;
  }

  /** Users holding a permission for an organisation (platform-wide grants included). */
  async recipientsWithPermission(permission: PermissionKey, organizationId: string | null): Promise<Recipient[]> {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: {
          some: {
            OR: organizationId ? [{ organizationId: null }, { organizationId }] : [{ organizationId: null }],
            role: { permissions: { some: { permission: { key: permission } } } },
          },
        },
      },
      select: { id: true, email: true, phone: true, fullName: true },
      take: 50,
    });
    return users.map((u) => ({ userId: u.id, email: u.email, phone: u.phone, name: u.fullName }));
  }

  async userRecipient(userId: string): Promise<Recipient | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true, fullName: true, status: true } });
    if (!u || u.status !== 'ACTIVE') return null;
    return { userId: u.id, email: u.email, phone: u.phone, name: u.fullName };
  }
}
