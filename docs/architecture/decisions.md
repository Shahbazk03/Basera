# Architecture decisions

Short records of the decisions that shape the codebase. Newest last.

## ADR-001 Modular monolith over microservices
One NestJS deployable with strongly separated modules. The business domains (marketplace, projects, CRM, HR, finance) share entities (organisations, users, leads, deals) and need transactional consistency; a monolith keeps that simple and operable by a small team. Module boundaries (one folder per domain, explicit services) keep a later extraction possible.

## ADR-002 Versions (chosen November 2026)
- **NestJS 11** instead of 12: Nest 12 is ESM-only; the CommonJS toolchain (Jest/ts-jest, Prisma CJS client) is more mature on 11. Upgrade when the test toolchain is migrated.
- **TypeScript 5.9.3** instead of 7.x: TS 7 is the native (Go) compiler and tools such as ts-jest support `<7` only.
- **Prisma 6.19.3** (pinned exactly): Prisma 7 does not support MongoDB (see ADR-011). The code relies on tested details of this version (regex filters, null handling), so upgrade only with the MongoDB test suite green.
- **Next.js 16.4 / React 19.3, Tailwind 4.3, Zod 4.6** — current stable releases.

## ADR-003 Two Next.js applications
Public site (SEO, ISR, microsites on customer domains) and back-office (client-rendered, authenticated, noindex) have different needs. Admin/broker/developer/staff/lead-partner workspaces share most screens and are permission-filtered inside one console app instead of five near-identical apps.

## ADR-004 Shared Zod schemas as the validation contract
The same schema validates forms in the browser and requests in the API (`ZodPipe`). OpenAPI bodies are generated from Zod (`z.toJSONSchema`). Category-specific property validation (`validatePropertyForProfile`) is shared too, so the console form and the API agree exactly.

## ADR-005 Dynamic property types with code-defined form profiles
Property types are data (admins can add "Penthouse" or "Studio"). Each type maps to one of seven **form profiles** (plot, apartment, house, commercial unit, commercial building, industrial, agricultural) defined in code, which decide which fields apply and are required — farmland, flats and shops never share one generic form.

## ADR-006 Refresh token rotation without session churn
The session id inside access tokens stays stable; only the refresh token rotates (current + previous hash). Parallel refreshes inside a short grace window are tolerated; a stale token presented later revokes the session (token theft detection).

## ADR-007 Notification outbox
Messages are rows first, deliveries second. A provider outage can delay but never lose a notification; missing credentials produce `NOT_CONFIGURED`, never a fake `SENT`.

## ADR-008 Locations as GeoJSON maintained by the data layer
`latitude`/`longitude` remain plain fields (simple for forms); the Prisma guard keeps a GeoJSON `location` point in step (formerly a PostGIS trigger) with a 2dsphere index. Nearby search uses `$geoWithin` and measures distances in the API, so it keeps working while `prisma db push` rebuilds indexes during a deploy.

## ADR-009 Customers are tenant-scoped
A person enquiring with two brokers becomes two customer records, one in each organisation's CRM. Brokers never see each other's customers; platform staff with platform-wide grants can.

## ADR-010 No online property payments in v1
Bookings and deals are recorded by the sales team; customer money received (`deal_payments`) is tracked separately from company revenue (invoice receipts) and commissions. No payment gateway is integrated.

## ADR-011 MongoDB Atlas instead of PostgreSQL (November 2026)
The owner chose MongoDB Atlas over a managed PostgreSQL. The schema moved to Prisma 6.19 (Prisma 7 has no MongoDB support); raw SQL was replaced by Prisma queries, aggregation and `findAndModify`. Guarantees PostgreSQL enforced are provided by `backend/src/prisma` (reference checks, explicit nulls, literal text search, calendar dates, validators for the former CHECK constraints, partial unique indexes, lock documents with transaction retries, job leases) and covered by `backend/test/mongo.int-spec.ts`. Trade-offs: references are checked by the application rather than the database, and a transaction that loses a write conflict is re-run (callbacks must have no side effects outside the database).
