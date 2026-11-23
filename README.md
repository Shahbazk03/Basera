# Basera
LIVE working project go and Explore.

A real estate marketplace and business-management platform, launching in Lucknow (Uttar Pradesh) and built for multi-city, multi-organisation operation. It covers:

- **Public marketplace** — buy/rent search with filters, PostGIS radius search, listing pages, enquiries, WhatsApp lead capture, favourites.
- **Projects & microsites** — project pages on the main domain, platform subdomains and verified custom domains; page builder; live unit inventory with concurrency-safe reservations.
- **Partners** — broker, builder/developer, owner and lead-provider self-registration with verification by the platform team.
- **CRM** — enquiries → customers → leads with rule-based assignment (project / location / round-robin / workload), activities, follow-ups, site visits, deals and bookings.
- **People & money** — employees, attendance, leave, payroll with maker-checker approval, commissions, invoices, expenses, reimbursements and reports.
- **Administration** — role-based access control with organisation scoping, CMS & SEO, notification outbox with honest delivery states, audit log, settings.

> Records created by the development seed are flagged **Demo** everywhere they appear. They are sample data, not real properties or businesses.

## Architecture at a glance

| Part | Tech | Port (dev) |
| --- | --- | --- |
| `apps/api` | NestJS 11 modular monolith, Prisma 7, PostgreSQL 17 + PostGIS, Redis/BullMQ | 4000 (`/api/v1`, Swagger at `/api/docs`) |
| `apps/web` | Next.js 16 (App Router, server-rendered) — public site and project microsites | 3200 |
| `apps/console` | Next.js 16 — admin, broker, developer, staff and lead-partner workspaces | 3300 |
| `packages/shared` | Zod schemas, enums, permission catalogue, lifecycle state machines, payroll/commission calculators | — |
| `packages/ui` | Tailwind v4 design system on Radix primitives | — |
| `packages/api-client` | Typed fetch client with silent session refresh | — |

The API is the single source of truth: every rule (permissions, lifecycles, validation) is enforced server-side; the UIs reuse the same shared schemas for instant feedback. See [docs/architecture/overview.md](docs/architecture/overview.md).

## Getting started (local development)

Prerequisites: Node.js 22, npm 10, Docker Desktop.

```bash
cp .env.example .env                 # then replace every "replace-with-…" value (see comments in the file)
npm run infra:up                     # PostgreSQL+PostGIS :5433, Redis :6380, Mailpit :1025/:8025
npm install
npm run build:shared
npm run db:deploy                    # apply migrations
npm run db:seed                      # reference data + development demo data (refuses to run in production)
npm run dev                          # shared watcher + API + web + console
```

- Website: http://localhost:3200 · Console: http://localhost:3300 · API docs: http://localhost:4000/api/docs · Captured email: http://localhost:8025
- Project microsite via subdomain: http://green-valley.localhost:3200 (browsers resolve `*.localhost` to 127.0.0.1).

### Development accounts

All seeded accounts use the password from `SEED_DEFAULT_PASSWORD` in your `.env` and the reserved `example.com` domain:

| Account | Role |
| --- | --- |
| `superadmin@example.com` | Super Admin (not on payroll) |
| `admin@example.com` | Admin (employee) |
| `ops@example.com` | Operations Manager |
| `partners@example.com` | Broker Manager (partner verification) |
| `sales.manager@example.com`, `sales1/2/3@example.com` | Sales Manager / Sales Executives |
| `hr@example.com`, `accounts@example.com`, `support@example.com` | HR Manager, Accountant, Customer Support |
| `broker1@`, `broker2@` (verified), `broker3@` (pending verification), `agent1@` | Brokerage users |
| `developer1@`, `developer2@` | Developer organisations |
| `leads@example.com` | Lead provider |
| `owner@example.com`, `customer@example.com` | Property owner, customer |

## Common scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run everything in watch mode |
| `npm run typecheck` | Typecheck API, web and console |
| `npm test` | Shared-package unit tests + API unit & integration tests (uses `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright end-to-end tests (needs the dev stack running) |
| `npm run db:migrate` | Create/apply a migration in development (`prisma migrate dev`) |
| `npm run db:deploy` | Apply migrations (CI/production) |
| `npm run build` | Production builds |

## Tests

| Suite | Location | Covers |
| --- | --- | --- |
| Shared unit | `packages/shared/src/*.spec.ts` | Lifecycle state machines, project status derivation, commission & payslip calculators, assignment engine, phone normalisation, hostname rules |
| API unit | `apps/api/src/**/*.spec.ts` | Enum parity Prisma ↔ shared, encryption, upload type detection, permission scoping, PATCH/query-boolean validation |
| API integration | `apps/api/test/*.int-spec.ts` | Through HTTP against a throw-away `*_test` database migrated with `prisma migrate deploy`: auth (lockout, refresh rotation & theft detection, CSRF), listings lifecycle & isolation, enquiries → leads → round-robin assignment, lead providers & duplicates, projects (booking-window statuses, concurrent reservations, page builder, domain verification), HR (attendance, leave, corrections), payroll (calculation, maker-checker, per-payslip approval, payments → ledger), commissions, invoices, expenses, admin safeguards |
| End-to-end | `e2e/*.spec.ts` (Playwright) | Public search & detail pages, mobile layouts (no horizontal scroll), broker registration → verification → listing → approval → public enquiry → CRM lead, project creation → inventory → publication → unit enquiry → CRM lead |

E2E tests run against the dev stack and create uniquely named records in the development database.

## External integrations

Integrations are optional. When credentials are missing the feature shows **Not configured** in the console and messages are recorded with that status — the platform never reports a message as sent unless the provider accepted it.

| Capability | Provider abstraction | Configure with |
| --- | --- | --- |
| Email | SMTP (any provider; Mailpit in development) | `SMTP_*`, `MAIL_FROM` |
| SMS | Twilio Messages API | `TWILIO_*` |
| WhatsApp messages | Meta WhatsApp Business Cloud API (approved templates needed for business-initiated messages) | `WHATSAPP_*` |
| WhatsApp click-to-chat | `wa.me` links after lead capture | company/project WhatsApp number in settings |
| Maps | OpenStreetMap embed by default, Google Maps Embed when a browser-restricted key is set | `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` |
| Spam protection | Cloudflare Turnstile (optional) + honeypot, fill-time and rate limits | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| File storage | Local disk (development) or any S3-compatible store | `STORAGE_DRIVER`, `S3_*` |
| TLS for custom domains | Caddy on-demand TLS gated by the API | `TLS_PROVIDER=caddy-on-demand` |

## Documentation

- [Architecture](docs/architecture/overview.md) · [Decisions](docs/architecture/decisions.md)
- [Database & ER diagram](docs/database/schema.md)
- [API conventions](docs/api/README.md)
- Workflows: [listings](docs/workflows/listings.md) · [projects & domains](docs/workflows/projects-and-domains.md) · [enquiries & CRM](docs/workflows/crm.md) · [payroll](docs/workflows/payroll.md) · [commissions & finance](docs/workflows/finance.md)
- [Security](docs/security/security.md)
- [Deployment](docs/deployment/deployment.md) · **[Supabase + Render + Vercel guide](docs/deployment/render-vercel-supabase.md)** · [Backup & recovery](docs/deployment/backup-and-recovery.md)
