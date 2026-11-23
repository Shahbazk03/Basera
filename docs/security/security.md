# Security

## Authentication & sessions
- Passwords hashed with **argon2id** (19 MiB, t=2). Timing is equalised for unknown accounts.
- 5 failed logins lock the account for 15 minutes; failures and logins are audited.
- Access token: HS256 JWT, 15 minutes, `httpOnly` + `SameSite=Lax` (+ `Secure` in production — enforced by env validation).
- Refresh token: 384-bit random, stored as SHA-256 only, cookie path-scoped to `/api/v1/auth`, rotated on each use. Reuse of the previous token after a 20 s grace window revokes the session (theft detection).
- Password reset / email verification tokens are single-use, hashed and short-lived; reset revokes every session. Forgot-password never reveals whether an account exists.
- Users can list and revoke their own sessions, change their password (other devices are signed out) and edit their own name and profile photo. Email and mobile number are sign-in identifiers and are not self-editable.
- The website and the console keep **separate sessions** (`estate_*` vs `estate_console_*` cookies, chosen by the host the request arrived on), so signing in on one never replaces the other — even on `localhost`, where browsers share cookies across ports. Two different users of the *same* app need separate browser profiles or an incognito window (one browser = one session per site).
- Administrators (`user.manage`) can correct a user's name, **send** a password-reset link (single-use, 60 minutes, at most 3 per 15 minutes), or **set** a password directly. A directly set password signs the user out everywhere; when it is emailed it is temporary — the account can do nothing except change it at the next sign-in (`mustChangePassword`, enforced by the API). The stored copy of that email is wiped as soon as delivery finishes (or is impossible), and the password never appears in API responses, logs or the audit trail. Administrator accounts can only be changed by a super admin; nobody uses these actions on their own account.
- Profile photos must be the user's own upload (purpose `avatar`), re-encoded to a 512 px WebP square — arbitrary image URLs are not accepted.
- `SEED_DEFAULT_PASSWORD` is only read when the development seed first creates accounts; changing it in `.env` does not change any existing password.

## Authorisation
- Every endpoint requires authentication unless explicitly marked `@Public()`.
- `@RequirePermissions` checks the permission exists in some scope; services then check the **record's organisation** (`AuthUser.assert(permission, organizationId)`) — frontend visibility is never relied on.
- Organisation isolation: brokers, developers, owners and lead providers only ever see their own organisation's data. Customers are stored per organisation.
- Sensitive separations: listers cannot approve their own listings; nobody approves their own payslip (approval is per payslip, an approver's own payslip waits for another approver) and, by default, the payroll approver differs from the preparer; nobody edits their own salary structure; leave and attendance corrections are never self-approved; commission approvers cannot approve their own commission; expenses/reimbursements cannot be approved by their creator.
- Platform administration (delivery logs, notification templates) requires a platform-wide grant — the same permission held inside a partner organisation is not enough. HR screens can never grant `SUPER_ADMIN`/`ADMIN` or roles beyond the granter's own permissions.
- Partial updates (`PATCH`) change only the fields sent: the shared `PatchPipe` validates sent fields and drops schema defaults that Zod would otherwise inject into omitted fields.

## Request protection
- **CSRF**: cookie-authenticated `POST/PUT/PATCH/DELETE` must carry an allowed `Origin`; plus `SameSite=Lax`. Bearer-token clients are exempt (not CSRF-exposed).
- **CORS**: explicit allow-list (`CORS_ORIGINS`) with credentials.
- **Rate limiting**: global 300 req/min/IP; auth endpoints 10/min; enquiries 5/min; uploads 60/min. Redis-backed when `REDIS_URL` is set (shared across instances), fails open if Redis is down.
- **Validation**: every body/query/param is validated with Zod; unknown enum values, oversized strings and malformed IDs are rejected (400 with field details).
- **SQL injection**: Prisma parameterises all queries; raw SQL uses tagged templates (`$queryRaw\`…${value}\``) only.
- **XSS**: React escapes output; CMS and page-builder content is structured data (never raw HTML); URLs in CMS content must be http(s) or site-relative (no `javascript:`); JSON-LD is serialised with `<` escaped.
- Security headers: Helmet on the API; CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies on the web apps; console is `noindex`.

## Spam protection (public enquiries)
Honeypot field, minimum form-fill time, per-IP rate limiting, IP fingerprint (HMAC, raw IP not stored on enquiries), optional Cloudflare Turnstile verified server-side.

## Files
- Type detection by magic bytes (client MIME types are ignored); size limits; images re-encoded to WebP (strips EXIF/GPS, defeats polyglots).
- Private documents live outside the public path/bucket and are served only via short-lived signed URLs after a record-level permission check.

## Data protection
- Owner contact details on listings and customer phone numbers are never returned by public endpoints.
- Bank account numbers and PAN are encrypted at rest with AES-256-GCM (`DATA_ENCRYPTION_KEY`); responses show masked values.
- Audit log entries redact secrets (password hashes, token hashes, encrypted fields).
- Delivery logs never show the body of messages carrying one-time security links (`auth.*` events: email verification, password reset) — not even to administrators.

## Secrets & configuration
- No secrets in code or the repository; `.env` is git-ignored; `.env.example` contains placeholders only.
- Startup validation refuses to run in production with placeholder secrets, insecure cookies or local file storage.
- Development seed refuses to run when `APP_ENV=production`.

## Custom domains
Only domains whose owner has published the DNS TXT verification record become ACTIVE. Certificates are requested only for ACTIVE domains (on-demand TLS `ask` endpoint). A hostname can belong to one project only; platform hosts and reserved subdomains cannot be claimed.

## Backups
See [backup & recovery](../deployment/backup-and-recovery.md).
