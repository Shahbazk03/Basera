# Deployment

> **Managed hosting:** step-by-step setup on MongoDB Atlas (database), Amazon S3 (files), Render (API, [`render.yaml`](../../render.yaml)) and Vercel (website + console) is in [render-vercel-atlas-s3.md](render-vercel-atlas-s3.md). This page describes the self-hosted Docker/Caddy alternative.

## Environments

| Environment | `APP_ENV` | Purpose | Data |
| --- | --- | --- | --- |
| Local | `local` | Developer machines (`docker-compose.yml` + `npm run dev`) | Demo seed |
| Development | `development` | Shared integration environment | Demo seed |
| Staging | `staging` | Release candidate verification, production-like config | Reference seed + anonymised or test data |
| Production | `production` | Live | Reference seed only (`npm run db:seed` runs reference data only when `APP_ENV=production`) |

Non-production environments show a "Development environment — Demo data" banner and are `noindex`.

## Production building blocks

- **MongoDB Atlas** (a replica set — required for transactions) on a tier with automated backups. The database user needs `readWrite` and `dbAdmin` on the application database.
- **Managed Redis** for BullMQ and shared rate limiting.
- **S3-compatible object storage** with two buckets: public (served via CDN) and private (no public access; signed URLs only).
- **Container runtime** for `api`, `web`, `console` images (Docker hosts, ECS, Cloud Run, Kubernetes…).
- **Reverse proxy with TLS**: the bundled Caddy configuration provides automatic HTTPS and on-demand certificates for verified project domains. Cloudflare can sit in front for CDN/WAF.

## Images

```bash
docker build -f infrastructure/docker/api.Dockerfile --target runtime -t estate-api .
docker build -f infrastructure/docker/api.Dockerfile --target migrate -t estate-migrate .
docker build -f infrastructure/docker/next.Dockerfile --build-arg APP=web     --build-arg API_INTERNAL_URL=http://api:4000 --build-arg WEB_PUBLIC_URL=https://brand.in --build-arg CONSOLE_PUBLIC_URL=https://console.brand.in -t estate-web .
docker build -f infrastructure/docker/next.Dockerfile --build-arg APP=console --build-arg API_INTERNAL_URL=http://api:4000 --build-arg WEB_PUBLIC_URL=https://brand.in --build-arg CONSOLE_PUBLIC_URL=https://console.brand.in -t estate-console .
```

Next.js rewrites and `NEXT_PUBLIC_*` values are baked in at build time — build one image per environment.

## Release procedure

1. CI (`.github/workflows/ci.yml`) typechecks, runs unit + integration tests against a MongoDB replica set, and builds both Next apps.
2. Run the **release job** (`migrate` image target → `prisma db push` + reference data) before rolling out new API containers. MongoDB has no migrations: `db push` creates collections and indexes and refuses changes that could lose data (e.g. a new unique index that existing documents violate) — fix the data first. Keep schema changes backwards-compatible (add fields before using them) for zero-downtime releases. The API installs its extra indexes and validators at start-up.
3. Roll out `api`, then `web` and `console`.
4. First production deploy only: `APP_ENV=production npm run db:seed` (reference data: permissions, roles, geography, property types, amenities, lead sources, platform organisation), then create the first Super Admin with `ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=… npm run admin:create -w @estate/api` (the password must pass the strength policy), and configure brand/contact settings in the console.

## Single-host stack

`infrastructure/deployment/docker-compose.prod.yml` runs Redis, the release job, API, web, console and Caddy on one host (suitable for staging or a small production); the database is MongoDB Atlas (`DATABASE_URL`). Copy `.env.production.example`, fill it in, then:

```bash
docker compose -f infrastructure/deployment/docker-compose.prod.yml --env-file infrastructure/deployment/.env up -d --build
```

DNS: `brand.in`, `www.brand.in`, `console.brand.in` and a wildcard `*.brand.in` → the host; customers point custom domains (CNAME) at `CUSTOM_DOMAIN_CNAME_TARGET`.

## Health, logging and monitoring

- `GET /api/v1/health` — liveness. `GET /api/v1/health/ready` — readiness (MongoDB + Redis), returns 503 when the database is unreachable. Docker images include `HEALTHCHECK`s.
- Every response carries `x-request-id` (propagated from the proxy when present); errors are logged with it.
- `LOG_FORMAT=json` switches the API to one-JSON-object-per-line logs for log aggregation (CloudWatch, Loki, Datadog…). Caddy logs are JSON.
- Recommended alerts: readiness failures, 5xx rate, 409 `WRITE_CONFLICT` responses (transactions that kept conflicting after retries), `communication_logs` rows stuck in `QUEUED` or `FAILED`, BullMQ queue depth, Atlas storage and replication lag.
- Error tracking: plug a provider (e.g. Sentry) into `AllExceptionsFilter` — not bundled, because it needs a DSN.

## Scaling notes
- API instances are stateless; scheduled jobs take an expiring lease (`job_locks`), so running several replicas is safe.
- Rate limiting is shared through Redis.
- Public pages use ISR (60 s) and the CDN; search pages are cached 30 s.
