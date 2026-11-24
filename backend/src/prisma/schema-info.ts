import { Prisma } from '@prisma/client';

/**
 * Schema facts read once from Prisma's DMMF. The MongoDB guards (mongo-guards.ts) and the error
 * mapper use them to do what PostgreSQL did for us: foreign keys, NULL columns, constraint names.
 */

export interface RelationInfo {
  /** Related model name. */
  model: string;
  /** Foreign-key scalar on this model (null when the related model holds the key). */
  foreignKey: string | null;
  /** Foreign-key scalar on the related model that points back here (Prisma fills it in nested writes). */
  backForeignKey: string | null;
}

export interface ModelInfo {
  name: string;
  /** Prisma Client property, e.g. `property` for model Property. */
  delegate: string;
  /** Collection name (@@map). */
  collection: string;
  /** Optional scalar fields without a default — always written (as null when absent) on create. */
  nullable: readonly string[];
  /** Foreign-key scalar → referenced model. */
  foreignKeys: ReadonlyMap<string, string>;
  /** Relation field → relation details. */
  relations: ReadonlyMap<string, RelationInfo>;
}

const dmmfModels = Prisma.dmmf.datamodel.models;
const MODELS = new Map<string, ModelInfo>();
/** Unique index name → field names (Prisma's default `<collection>_<fields>_key` naming plus our partial indexes). */
const UNIQUE_INDEXES = new Map<string, string[]>();

for (const m of dmmfModels) {
  const relations = new Map<string, RelationInfo>();
  const foreignKeys = new Map<string, string>();
  const nullable: string[] = [];
  for (const f of m.fields) {
    if (f.kind === 'object') {
      const fk = f.relationFromFields?.length === 1 ? f.relationFromFields[0] : null;
      if (fk) foreignKeys.set(fk, f.type);
      const other = dmmfModels.find((x) => x.name === f.type);
      const back = other?.fields.find((x) => x.kind === 'object' && x.relationName === f.relationName && !(other.name === m.name && x.name === f.name));
      const backForeignKey = back?.relationFromFields?.length === 1 ? back.relationFromFields[0] : null;
      relations.set(f.name, { model: f.type, foreignKey: fk, backForeignKey });
    } else if (!f.isRequired && !f.isList && !f.hasDefaultValue && !f.isId) {
      nullable.push(f.name);
    }
  }
  const collection = m.dbName ?? m.name;
  MODELS.set(m.name, { name: m.name, delegate: m.name.charAt(0).toLowerCase() + m.name.slice(1), collection, nullable, foreignKeys, relations });

  for (const f of m.fields) if (f.isUnique) UNIQUE_INDEXES.set(`${collection}_${f.dbName ?? f.name}_key`, [f.name]);
  for (const u of m.uniqueIndexes) UNIQUE_INDEXES.set(u.name ?? `${collection}_${u.fields.join('_')}_key`, [...u.fields]);
}

/** Unique indexes on optional fields that only apply when the field has a value (see database-rules.ts). */
export const PARTIAL_UNIQUE_INDEXES = [
  { collection: 'users', name: 'users_email_key', fields: ['email'] },
  { collection: 'users', name: 'users_phone_key', fields: ['phone'] },
  { collection: 'customers', name: 'customers_organizationId_phone_key', fields: ['organizationId', 'phone'] },
] as const;
for (const p of PARTIAL_UNIQUE_INDEXES) UNIQUE_INDEXES.set(p.name, [...p.fields]);

/**
 * Calendar-date fields (PostgreSQL `DATE` columns before the move to MongoDB). They are stored as
 * UTC midnight; writes are truncated to the date exactly as PostgreSQL did.
 */
const DATE_ONLY: Record<string, string[]> = {
  Property: ['availableFrom'],
  Project: ['launchDate', 'possessionDate', 'reraValidUntil'],
  ProjectConstructionUpdate: ['updateDate'],
  Enquiry: ['preferredDate'],
  Campaign: ['startDate', 'endDate'],
  Deal: ['bookingDate', 'agreementDate'],
  DealPayment: ['receivedOn'],
  Employee: ['joiningDate', 'exitDate', 'dateOfBirth'],
  Holiday: ['date'],
  AttendanceRecord: ['date'],
  AttendanceCorrection: ['date'],
  LeaveRequest: ['startDate', 'endDate'],
  SalaryStructure: ['effectiveFrom', 'effectiveTo'],
  PayrollRun: ['periodStart', 'periodEnd'],
  SalaryPayment: ['paidOn'],
  CommissionRule: ['effectiveFrom', 'effectiveTo'],
  CommissionPayout: ['paidOn'],
  FinanceTransaction: ['txnDate'],
  Expense: ['expenseDate'],
  Invoice: ['issueDate', 'dueDate'],
  Reimbursement: ['expenseDate'],
};
const DATE_ONLY_FIELDS = new Map<string, ReadonlySet<string>>();
for (const [model, fields] of Object.entries(DATE_ONLY)) {
  const m = dmmfModels.find((x) => x.name === model);
  for (const f of fields) {
    if (m?.fields.find((x) => x.name === f)?.type !== 'DateTime') throw new Error(`DATE_ONLY lists ${model}.${f}, which is not a DateTime field`);
  }
  DATE_ONLY_FIELDS.set(model, new Set(fields));
}

/** Date-only fields of a model (empty set when none). */
export function dateOnlyFields(model: string): ReadonlySet<string> {
  return DATE_ONLY_FIELDS.get(model) ?? new Set();
}

export function modelInfo(name: string): ModelInfo {
  const info = MODELS.get(name);
  if (!info) throw new Error(`Unknown Prisma model ${name}`);
  return info;
}

/** Field names behind a unique index name reported by MongoDB (undefined for `_id_` and unknown names). */
export function uniqueIndexFields(indexName: string): string[] | undefined {
  return UNIQUE_INDEXES.get(indexName);
}
