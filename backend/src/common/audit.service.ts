import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../prisma/prisma.service';
import { toPlain } from './http-infra';

export interface AuditEntry {
  actorId?: string | null;
  actorIp?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

const REDACT = new Set(['passwordHash', 'refreshTokenHash', 'tokenHash', 'bankDetailsEncrypted', 'panEncrypted', 'apiKeyHash', 'verificationToken']);

function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const plain = toPlain(value);
  return JSON.parse(
    JSON.stringify(plain, (key, v) => (REDACT.has(key) ? '[redacted]' : v)),
  ) as Prisma.InputJsonValue;
}

/** Append-only audit trail. Pass a transaction client to make the entry atomic with the change. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorIp: entry.actorIp ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          organizationId: entry.organizationId ?? null,
          before: sanitize(entry.before),
          after: sanitize(entry.after),
          metadata: sanitize(entry.metadata),
        },
      });
    } catch (err) {
      // Inside a transaction the error must propagate so the business change is rolled back too.
      if (db !== this.prisma) throw err;
      this.logger.error(`Failed to write audit entry ${entry.action}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
