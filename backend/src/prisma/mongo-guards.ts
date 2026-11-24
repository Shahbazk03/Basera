import { Prisma } from '@prisma/client';
import { dateOnlyFields, modelInfo, type ModelInfo } from './schema-info';

/**
 * Prisma query extension that gives MongoDB the guarantees the PostgreSQL schema had:
 *
 *  1. Explicit nulls — Prisma leaves absent optional fields out of a MongoDB document, and a
 *     `{ field: null }` filter does not match a missing field. Every create therefore writes all
 *     optional fields (null when not given), so filters such as `deletedAt: null` keep working.
 *  2. Foreign keys — MongoDB does not check references. Every foreign key written by a create or
 *     update must point at an existing record (checked inside the caller's transaction), otherwise
 *     the write fails with P2003, exactly like a PostgreSQL foreign-key violation.
 *  3. Locations — `location` (GeoJSON point, 2dsphere-indexed) follows latitude/longitude on
 *     properties and projects; PostgreSQL did this with a trigger.
 *  4. Calendar dates — former `DATE` columns are truncated to UTC midnight on write, as PostgreSQL did.
 *  5. Literal text search — Prisma's MongoDB connector turns contains/startsWith/endsWith (and
 *     equals/in/not with mode 'insensitive') into regular expressions WITHOUT escaping the text, so
 *     "+91…" found nothing and user input could inject patterns (including catastrophic ones).
 *     Filter text is escaped, giving PostgreSQL's literal LIKE/ILIKE semantics.
 *
 * Only arguments are rewritten; the queries themselves are Prisma's.
 */

type Data = Record<string, unknown>;
type Delegate = {
  findMany(args: unknown): Promise<{ id: string }[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
};
/** Returns the client to read with: the open interactive transaction, or the root client. */
export type DbResolver = () => unknown;

const GEO_MODELS = new Set(['Property', 'Project']);

const isObj = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : []);
const onlyKeys = (v: Data, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));
const unwrapSet = (v: unknown) => (isObj(v) && 'set' in v ? v.set : v);

// ── 5. Literal text search ───────────────────────────────────────────────────

const isPlain = (v: unknown): v is Data => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const REGEX_OPERATORS = new Set(['contains', 'startsWith', 'endsWith']);
const STRING_FILTER_KEYS = new Set(['equals', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'mode', 'not', 'isSet']);

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function isStringFilter(v: Data): boolean {
  const keys = Object.keys(v);
  if (!keys.length || !keys.every((k) => STRING_FILTER_KEYS.has(k))) return false;
  return v.mode === 'insensitive' || keys.some((k) => REGEX_OPERATORS.has(k) && typeof v[k] === 'string');
}

/** Copy of a where/having tree with the text of regex-backed string filters escaped. */
function escapeFilter(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(escapeFilter);
  if (!isPlain(value)) return value;
  const out: Data = {};
  const stringFilter = isStringFilter(value);
  const insensitive = value.mode === 'insensitive';
  for (const [k, v] of Object.entries(value)) {
    if (stringFilter && typeof v === 'string' && (REGEX_OPERATORS.has(k) || (insensitive && (k === 'equals' || k === 'not')))) out[k] = escapeRegex(v);
    else if (stringFilter && insensitive && (k === 'in' || k === 'notIn') && Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? escapeRegex(x) : x));
    else out[k] = escapeFilter(v);
  }
  return out;
}

/** Copy of an include/select tree with its nested `where` filters escaped. */
function escapeProjection(value: unknown): unknown {
  if (!isPlain(value)) return value;
  const out: Data = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === 'where' ? escapeFilter(v) : isPlain(v) ? escapeProjection(v) : v;
  return out;
}

/**
 * Query arguments with escaped filters. A copy, never an in-place change: callers reuse one `where`
 * object for a list and its count, and escaping twice would break the search.
 */
function escapeQueryArgs(args: Data): Data {
  const out: Data = { ...args };
  if (args.where !== undefined) out.where = escapeFilter(args.where);
  if (args.having !== undefined) out.having = escapeFilter(args.having);
  if (args.include !== undefined) out.include = escapeProjection(args.include);
  if (args.select !== undefined) out.select = escapeProjection(args.select);
  return out;
}

/** References collected from one write: referenced model → (id → "Model.field" that holds it). */
type Refs = Map<string, Map<string, string>>;

/**
 * Rewrites `relation: { connect: { id } }` (and `disconnect: true` on updates) on the foreign-key
 * side into the plain scalar, so the input can carry explicit nulls. Leaves other shapes untouched.
 */
function toScalarForeignKeys(info: ModelInfo, data: Data, isUpdate: boolean): boolean {
  const keys = Object.keys(data).filter((k) => info.relations.get(k)?.foreignKey);
  if (!keys.length) return true;
  const converted: [string, string, string | null][] = [];
  for (const k of keys) {
    const v = data[k];
    const fk = info.relations.get(k)!.foreignKey!;
    if (isObj(v) && onlyKeys(v, ['connect']) && isObj(v.connect) && onlyKeys(v.connect, ['id']) && typeof v.connect.id === 'string') converted.push([k, fk, v.connect.id]);
    else if (isUpdate && isObj(v) && onlyKeys(v, ['disconnect']) && v.disconnect === true) converted.push([k, fk, null]);
    else return false;
  }
  for (const [k, fk, value] of converted) {
    delete data[k];
    data[fk] = value;
  }
  return true;
}

function point(lat: unknown, lng: unknown): Data | null {
  return typeof lat === 'number' && typeof lng === 'number' ? { type: 'Point', coordinates: [lng, lat] } : null;
}

/** Truncates calendar-date values (Date, ISO string or `{ set }`) to UTC midnight. */
function truncateDates(model: string, data: Data): void {
  for (const f of dateOnlyFields(model)) {
    const v = data[f];
    if (isObj(v) && 'set' in v) {
      v.set = toUtcMidnight(v.set);
    } else if (v !== undefined) {
      data[f] = toUtcMidnight(v);
    }
  }
}

function toUtcMidnight(v: unknown): unknown {
  const d = v instanceof Date ? v : typeof v === 'string' && v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return v;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function collectRef(refs: Refs, target: string, id: unknown, holder: string): void {
  if (typeof id !== 'string') return;
  let ids = refs.get(target);
  if (!ids) refs.set(target, (ids = new Map()));
  if (!ids.has(id)) ids.set(id, holder);
}

/** Prepares a create payload (recursively, including nested creates) and collects its references. */
function visitCreate(model: string, data: Data, implicitFk: string | null, refs: Refs): void {
  const info = modelInfo(model);
  const scalarForm = toScalarForeignKeys(info, data, false);
  for (const f of info.nullable) {
    if (f === implicitFk || (!scalarForm && info.foreignKeys.has(f))) continue;
    if (data[f] === undefined) data[f] = null;
  }
  if (GEO_MODELS.has(model)) data.location = point(unwrapSet(data.latitude), unwrapSet(data.longitude));
  truncateDates(model, data);
  visitFields(info, data, implicitFk, refs);
}

/** Prepares an update payload (nested creates get explicit nulls too) and collects its references. */
function visitUpdate(model: string, data: Data, refs: Refs): void {
  const info = modelInfo(model);
  toScalarForeignKeys(info, data, true);
  if (GEO_MODELS.has(model) && data.latitude !== undefined && data.longitude !== undefined) {
    data.location = point(unwrapSet(data.latitude), unwrapSet(data.longitude));
  }
  truncateDates(model, data);
  visitFields(info, data, null, refs);
}

function visitFields(info: ModelInfo, data: Data, implicitFk: string | null, refs: Refs): void {
  for (const [key, value] of Object.entries(data)) {
    const target = info.foreignKeys.get(key);
    if (target) {
      if (key !== implicitFk) collectRef(refs, target, unwrapSet(value), `${info.name}.${key}`);
      continue;
    }
    const rel = info.relations.get(key);
    if (!rel || !isObj(value)) continue;
    const childFk = rel.backForeignKey;
    for (const c of list(value.create)) visitCreate(rel.model, c, childFk, refs);
    if (isObj(value.createMany)) for (const c of list(value.createMany.data)) visitCreate(rel.model, c, childFk, refs);
    for (const c of list(value.connectOrCreate)) if (isObj(c.create)) visitCreate(rel.model, c.create, childFk, refs);
    for (const u of list(value.upsert)) {
      if (isObj(u.create)) visitCreate(rel.model, u.create, childFk, refs);
      if (isObj(u.update)) visitUpdate(rel.model, u.update, refs);
    }
    for (const u of list(value.update)) visitUpdate(rel.model, isObj(u.data) && (isObj(u.where) || onlyKeys(u, ['data'])) ? u.data : u, refs);
    for (const u of list(value.updateMany)) if (isObj(u.data)) visitUpdate(rel.model, u.data, refs);
  }
}

async function assertReferences(refs: Refs, db: DbResolver): Promise<void> {
  if (!refs.size) return;
  const client = db() as Record<string, Delegate>;
  for (const [target, ids] of refs) {
    const wanted = [...ids.keys()];
    const found = await client[modelInfo(target).delegate].findMany({ where: { id: { in: wanted } }, select: { id: true } });
    if (found.length === wanted.length) continue;
    const have = new Set(found.map((r) => r.id));
    const [missingId, holder] = [...ids].find(([id]) => !have.has(id))!;
    throw new Prisma.PrismaClientKnownRequestError(`Foreign key constraint violated: ${holder} references a ${target} that does not exist (${missingId})`, {
      code: 'P2003',
      clientVersion: Prisma.prismaVersion.client,
      meta: { field_name: holder, target },
    });
  }
}

/** For an update that changes only one coordinate, reads the other so `location` stays in step. */
async function completeLocation(model: string, where: unknown, data: Data, db: DbResolver): Promise<void> {
  if (!GEO_MODELS.has(model) || data.location !== undefined) return;
  const hasLat = data.latitude !== undefined;
  const hasLng = data.longitude !== undefined;
  if (hasLat === hasLng) return; // neither changed, or both (already handled)
  const client = db() as Record<string, Delegate>;
  const current = await client[modelInfo(model).delegate].findUnique({ where, select: { latitude: true, longitude: true } });
  data.location = point(hasLat ? unwrapSet(data.latitude) : current?.latitude, hasLng ? unwrapSet(data.longitude) : current?.longitude);
}

export function mongoGuards(db: DbResolver) {
  return Prisma.defineExtension({
    name: 'mongo-guards',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = escapeQueryArgs((args ?? {}) as Data);
          const refs: Refs = new Map();
          switch (operation) {
            case 'create':
              visitCreate(model, a.data as Data, null, refs);
              break;
            case 'createMany':
              for (const row of list(a.data)) visitCreate(model, row, null, refs);
              break;
            case 'update':
              visitUpdate(model, a.data as Data, refs);
              await completeLocation(model, a.where, a.data as Data, db);
              break;
            case 'updateMany':
              visitUpdate(model, a.data as Data, refs);
              break;
            case 'upsert':
              visitCreate(model, a.create as Data, null, refs);
              visitUpdate(model, a.update as Data, refs);
              await completeLocation(model, a.where, a.update as Data, db);
              break;
            default:
              break;
          }
          await assertReferences(refs, db);
          return query(a as typeof args);
        },
      },
    },
  });
}
