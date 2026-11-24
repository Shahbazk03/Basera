# API conventions

- **Base path**: `/api/v1` (URI versioning; a future `/api/v2` can coexist).
- **Interactive docs**: `/api/docs` (Swagger UI) and `/api/docs/openapi.json` — enabled outside production by default (`SWAGGER_ENABLED`).
- **Endpoint index**: [endpoints.md](endpoints.md) (generated from the OpenAPI document).

## Authentication
- Browser apps use httpOnly cookies set by `POST /auth/login` (`estate_at` access token, `estate_rt` refresh token). `POST /auth/refresh` rotates the refresh token; clients retry once on `401`.
- Machine clients may send `Authorization: Bearer <access token>`.
- Cookie-authenticated `POST/PUT/PATCH/DELETE` requests must come from an allowed `Origin` (CSRF protection).

## Requests
- JSON bodies (max 1 MB); uploads are `multipart/form-data` to `POST /files` (field `file`, plus `purpose`).
- Every body, query and path parameter is validated with the shared Zod schemas from `@estate/shared`.
- Identifiers are UUIDs; human references look like `ENQ-2026-000123`, `LD-…`, `DL-…`, `INV-…`, `TXN-…`; listings have short codes (`PR-7K2M9X`).

## Responses
- Lists: `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }` (some lists add aggregates such as `statusCounts`).
- Money is returned as numbers in INR (stored as `numeric`); instants are ISO-8601 UTC; calendar dates are `YYYY-MM-DD`.
- Database rows are never returned raw: every endpoint maps to an explicit shape, and public endpoints exclude private fields (owner contacts, customer phones, internal notes).

## Errors
All errors share one shape:

```json
{ "statusCode": 409, "error": "CONFLICT", "message": "Add at least one photo before submitting for review", "code": "PHOTOS_REQUIRED", "details": [{ "path": "price", "message": "…" }], "requestId": "…" }
```

| Status | Meaning |
| --- | --- |
| 400 | Validation failed (`details` lists field errors — forms map them onto inputs) |
| 401 | Not signed in / session expired (`UNAUTHENTICATED`, `SESSION_INVALID`) |
| 403 | Signed in but not allowed (`FORBIDDEN`, `CSRF_ORIGIN_MISMATCH`, `ACCOUNT_LOCKED`) |
| 404 | Not found **or not visible to you** (records of other organisations are reported as not found) |
| 409 | Business-rule conflict (`INVALID_TRANSITION`, `ORGANIZATION_NOT_ACTIVE`, `CONCURRENT_UPDATE`, duplicates …) |
| 429 | Rate limited |
| 5xx | Unexpected — the `requestId` correlates with server logs |

## Pagination, filtering, sorting
`?page=1&pageSize=25` (max 100), endpoint-specific filters (e.g. `status`, `q`, `organizationId`), and `sort` where documented. Public property search: see `propertySearchSchema` in `shared/src/property.ts`.
