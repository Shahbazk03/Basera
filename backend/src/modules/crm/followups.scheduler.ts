import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatDateTime } from '@estate/shared';
import { env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Every 5 minutes (one instance via a job lease):
 *  • reminds assignees of follow-ups due within `leads.followUpReminderMinutes` (once per follow-up);
 *  • marks PENDING follow-ups more than 24 hours overdue as MISSED.
 */
@Injectable()
export class FollowUpsScheduler {
  private readonly logger = new Logger('FollowUpsScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 */5 * * * *')
  async cron(): Promise<void> {
    if (env().APP_ENV === 'test') return;
    try {
      const r = await this.run();
      if (r && (r.reminded || r.missed)) this.logger.log(`Follow-ups: ${r.reminded} reminder(s), ${r.missed} marked missed`);
    } catch (err) {
      this.logger.error('Follow-up job failed', err instanceof Error ? err.stack : String(err));
    }
  }

  async run(now: Date = new Date()): Promise<{ reminded: number; missed: number } | null> {
    const minutes = await this.settings.getNumber('leads.followUpReminderMinutes');
    const result = await this.prisma.withJobLock('jobs:crm-followups', async (tx) => {
      const due = await tx.leadFollowUp.findMany({
        where: {
          status: 'PENDING',
          reminderSentAt: null,
          dueAt: { lte: new Date(now.getTime() + minutes * 60_000), gte: new Date(now.getTime() - 24 * 3_600_000) },
          lead: { deletedAt: null, status: { notIn: ['CONVERTED', 'LOST'] } },
        },
        include: { lead: { select: { id: true, leadNo: true, name: true } }, assignedTo: { select: { id: true, fullName: true, email: true, phone: true, status: true } } },
        take: 200,
      });
      const outbox: string[] = [];
      for (const f of due) {
        const claimed = await tx.leadFollowUp.updateMany({ where: { id: f.id, reminderSentAt: null }, data: { reminderSentAt: now } });
        if (!claimed.count || f.assignedTo.status !== 'ACTIVE') continue;
        const data = { leadName: f.lead.name, leadNo: f.lead.leadNo, followUpType: f.type.replace(/_/g, ' ').toLowerCase(), dueAt: formatDateTime(f.dueAt) };
        const recipient = { userId: f.assignedTo.id, email: f.assignedTo.email, phone: f.assignedTo.phone, name: f.assignedTo.fullName };
        outbox.push(...(await this.notifications.notify({ eventKey: 'followup.due', recipients: [recipient], channels: ['IN_APP'], data, link: `/crm/leads/${f.lead.id}`, relatedType: 'LeadFollowUp', relatedId: f.id }, tx)));
        outbox.push(...(await this.notifications.notify({ eventKey: 'followup.due', recipients: [recipient], channels: ['EMAIL'], data, link: `${env().CONSOLE_PUBLIC_URL}/crm/leads/${f.lead.id}`, relatedType: 'LeadFollowUp', relatedId: f.id }, tx)));
      }
      const missed = await tx.leadFollowUp.updateMany({ where: { status: 'PENDING', dueAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } }, data: { status: 'MISSED' } });
      return { reminded: due.length, missed: missed.count, outbox };
    });
    if (!result) return null;
    this.notifications.kick(result.outbox);
    return { reminded: result.reminded, missed: result.missed };
  }
}
