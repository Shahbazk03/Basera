import { randomUUID } from 'node:crypto';
import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { DbClient, type Tx } from './client';
import { ensureDatabaseRules } from './database-rules';

export { lockInTransaction } from './client';
export type { Db, Tx } from './client';

const logger = new Logger('Prisma');

/** MongoDB's default limit for a transaction is 60 s; job transactions stay below it. */
const JOB_TRANSACTION_TIMEOUT_MS = 55_000;

/**
 * Connections kept open and ready. Opening one costs several network round trips (TLS and sign-in) —
 * about half a second when the database is far away — which a page would otherwise wait for whenever a
 * burst of parallel queries (e.g. the admin dashboard's) needs more connections than are open.
 */
const POOL_DEFAULTS: [string, string][] = [
  ['minPoolSize', '30'],
  ['maxPoolSize', '40'],
  ['maxConnecting', '10'],
];

/** Adds the pool settings DATABASE_URL does not set itself (settings in the URL always win). */
export function withConnectionPool(url: string): string {
  const missing = POOL_DEFAULTS.filter(([name]) => !new RegExp(`[?&]${name}=`, 'i').test(url));
  if (!missing.length) return url;
  const options = missing.map(([name, value]) => `${name}=${value}`).join('&');
  if (url.includes('?')) return `${url}${url.endsWith('?') || url.endsWith('&') ? '' : '&'}${options}`;
  const hasPath = url.replace(/^mongodb(\+srv)?:\/\//, '').includes('/');
  return `${url}${hasPath ? '' : '/'}?${options}`;
}

@Injectable()
export class PrismaService extends DbClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const e = env();
    // Tests open and close many app instances against a local database: no standing pool there.
    super(e.APP_ENV === 'test' ? e.DATABASE_URL : withConnectionPool(e.DATABASE_URL), {
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    for (const warning of await ensureDatabaseRules(this)) logger.warn(warning);
    logger.log('Connected to MongoDB');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs a scheduled job on one API instance at a time: takes the job's lease, runs `fn` (in a
   * transaction unless `transactional: false`), then releases it. Returns null without running when
   * another instance holds the lease. A lease left by a crashed instance expires after `ttlMs`.
   */
  async withJobLock<T>(key: string, fn: (tx: Tx) => Promise<T>, opts: { ttlMs?: number; transactional?: boolean } = {}): Promise<T | null> {
    const owner = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? 10 * 60_000));
    const takenOver = await this.jobLock.updateMany({ where: { key, expiresAt: { lt: now } }, data: { owner, expiresAt } });
    if (takenOver.count === 0) {
      try {
        await this.jobLock.create({ data: { key, owner, expiresAt } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // held elsewhere
        throw e;
      }
    }
    try {
      if (opts.transactional === false) return await fn(this);
      return await this.$transaction(fn, { timeout: JOB_TRANSACTION_TIMEOUT_MS, maxWait: 10_000 });
    } finally {
      await this.jobLock.deleteMany({ where: { key, owner } }).catch((e: unknown) => logger.warn(`Could not release job lock ${key}: ${(e as Error).message}`));
    }
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
