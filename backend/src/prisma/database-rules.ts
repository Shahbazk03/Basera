import { Prisma } from '@prisma/client';
import { PARTIAL_UNIQUE_INDEXES } from './schema-info';

/**
 * What `prisma db push` cannot declare for MongoDB: geo indexes, unique indexes that only apply when
 * an optional field has a value, and the integrity checks the PostgreSQL schema enforced with CHECK
 * constraints (now collection validators). Idempotent; runs at API start-up, before seeding and in tests.
 */

type RawDb = { $runCommandRaw(command: Prisma.InputJsonObject): Prisma.PrismaPromise<Prisma.JsonObject> };

const nullOrBetween = (field: string, min: number, max: number) => ({ $or: [{ [field]: null }, { [field]: { $gte: min, $lte: max } }] });

/** Collection validators (CHECK constraints of the former PostgreSQL schema). */
export const VALIDATORS: Record<string, Prisma.InputJsonObject> = {
  properties: { price: { $gte: 0 }, area: { $gt: 0 }, $and: [nullOrBetween('latitude', -90, 90), nullOrBetween('longitude', -180, 180)] },
  projects: {
    $and: [
      nullOrBetween('latitude', -90, 90),
      nullOrBetween('longitude', -180, 180),
      { $or: [{ bookingOpensAt: null }, { bookingClosesAt: null }, { $expr: { $gt: ['$bookingClosesAt', '$bookingOpensAt'] } }] },
    ],
  },
  project_units: { basePrice: { $gte: 0 }, additionalCharges: { $gte: 0 }, totalPrice: { $gte: 0 }, area: { $gt: 0 } },
  project_domains: { $expr: { $eq: ['$hostname', { $toLower: '$hostname' }] } },
  deals: { dealValue: { $gte: 0 } },
  deal_payments: { amount: { $gt: 0 } },
  transactions: { amount: { $gt: 0 } },
  invoices: { total: { $gte: 0 }, amountPaid: { $gte: 0 }, $expr: { $lte: ['$amountPaid', '$total'] } },
  commission_records: { amount: { $gte: 0 }, amountPaid: { $gte: 0 }, $expr: { $lte: ['$amountPaid', '$amount'] } },
  payroll_runs: { periodMonth: { $gte: 1, $lte: 12 } },
  leave_requests: { days: { $gt: 0 }, $expr: { $gte: ['$endDate', '$startDate'] } },
  expenses: { amount: { $gt: 0 } },
  reimbursements: { amount: { $gt: 0 } },
};

/** MongoDB error 13 (Unauthorized), reported by Prisma as P2010 for raw commands. */
export function isUnauthorized(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2010' && String((e.meta as { code?: unknown } | undefined)?.code) === '13';
}

/**
 * Creates the indexes and validators. Returns warnings for what could not be installed but is not
 * required to run: validators need the `dbAdmin` role (collMod), which Atlas's "read and write"
 * roles lack. Index failures (e.g. duplicates violating a unique index) throw.
 */
export async function ensureDatabaseRules(db: RawDb): Promise<string[]> {
  const warnings: string[] = [];
  // Collections are created only by `prisma db push`: creating one here (with a validator) first would
  // make db push fail with NamespaceExists. Missing collections are skipped and handled on the next start.
  const listed = (await db.$runCommandRaw({ listCollections: 1, nameOnly: true })) as { cursor?: { firstBatch?: { name: string }[] } };
  const existing = new Set((listed.cursor?.firstBatch ?? []).map((c) => c.name));
  const needed = ['properties', 'projects', 'users', 'customers', ...Object.keys(VALIDATORS)];
  if (needed.some((name) => !existing.has(name))) warnings.push('Some collections do not exist yet — run `prisma db push` (npm run db:deploy) first; their indexes and validators will be added on the next start.');

  // Speeds up nearby search ($geoWithin works without it too). 2dsphere indexes skip null locations.
  for (const collection of ['properties', 'projects']) {
    if (!existing.has(collection)) continue;
    await db.$runCommandRaw({ createIndexes: collection, indexes: [{ key: { location: '2dsphere' }, name: `${collection}_location_2dsphere` }] });
  }
  // Unique only when set: many users have no phone, many customers have no phone yet.
  for (const p of PARTIAL_UNIQUE_INDEXES) {
    if (!existing.has(p.collection)) continue;
    await db.$runCommandRaw({
      createIndexes: p.collection,
      indexes: [{ key: Object.fromEntries(p.fields.map((f) => [f, 1])), name: p.name, unique: true, partialFilterExpression: { [p.fields[p.fields.length - 1]]: { $type: 'string' } } }],
    });
  }
  for (const [collection, validator] of Object.entries(VALIDATORS)) {
    if (!existing.has(collection)) continue;
    try {
      await db.$runCommandRaw({ collMod: collection, validator, validationLevel: 'strict', validationAction: 'error' });
    } catch (e) {
      if (!isUnauthorized(e)) throw e;
      warnings.push('Integrity validators were not installed: give the database user the dbAdmin role on this database (collMod). The app works without them; they are a safety net.');
      break;
    }
  }
  return warnings;
}
