import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import type * as runtime from '@prisma/client/runtime/library';
import { mongoGuards } from './mongo-guards';

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
type TxOptions = { maxWait?: number; timeout?: number };

/** Attempts for an interactive transaction that loses a write conflict (each attempt re-runs the callback). */
const TX_ATTEMPTS = 8;

/** The interactive transaction the current async call chain is running in (see DbClient.$transaction). */
const transactionContext = new AsyncLocalStorage<{ tx: Tx; open: boolean }>();

export function currentTransaction(): Tx | null {
  const store = transactionContext.getStore();
  return store?.open ? store.tx : null;
}

/** MongoDB aborts the later of two transactions that write the same document (Prisma P2034). Safe to retry. */
export function isWriteConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Prisma Client for MongoDB with the platform's guards (explicit nulls, foreign-key checks, GeoJSON
 * locations — see mongo-guards.ts) and write-conflict retries. Use this everywhere instead of
 * `new PrismaClient()` so scripts, seeds and tests write exactly the documents the API writes.
 */
export class DbClient extends PrismaClient {
  constructor(url: string, options: { log?: Prisma.LogDefinition[] } = {}) {
    super({ datasourceUrl: url, ...(options.log ? { log: options.log } : {}) });
    // The extended client keeps this instance (and its subclass methods) as its prototype.
    const extended: unknown = this.$extends(mongoGuards(() => currentTransaction() ?? extended));
    return extended as DbClient;
  }

  /**
   * Interactive transactions are retried when MongoDB reports a write conflict (another transaction
   * changed one of the same documents first). The callback must therefore only touch the database:
   * collect side effects (emails, queue jobs) and run them after the transaction resolves.
   */
  override $transaction<P extends Prisma.PrismaPromise<unknown>[]>(arg: [...P]): Promise<runtime.Types.Utils.UnwrapTuple<P>>;
  override $transaction<R>(fn: (tx: Tx) => Promise<R>, options?: TxOptions): Promise<R>;
  override async $transaction(arg: unknown, options?: TxOptions): Promise<unknown> {
    if (typeof arg !== 'function') return super.$transaction(arg as Prisma.PrismaPromise<unknown>[]);
    const fn = arg as (tx: Tx) => Promise<unknown>;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await super.$transaction(
          (tx) => {
            const store = { tx, open: true };
            return transactionContext.run(store, async () => {
              try {
                return await fn(tx);
              } finally {
                store.open = false;
              }
            });
          },
          options,
        );
      } catch (e) {
        if (attempt >= TX_ATTEMPTS || !isWriteConflict(e)) throw e;
        await sleep(20 * 2 ** attempt + Math.random() * 50);
      }
    }
  }
}

/**
 * Serialises transactions that work on the same key — the MongoDB stand-in for PostgreSQL's
 * `SELECT … FOR UPDATE` / advisory locks. Writing the lock document makes any other transaction
 * that writes it get a write conflict; DbClient.$transaction then retries that one with fresh reads.
 */
export async function lockInTransaction(tx: Tx, key: string): Promise<void> {
  await tx.$runCommandRaw({
    update: 'transaction_locks',
    updates: [{ q: { _id: key }, u: { $inc: { version: 1 }, $currentDate: { updatedAt: true } }, upsert: true }],
  });
}
