# Deploying to MongoDB Atlas + Amazon S3 + Render + Vercel

| Part | Service | Region |
| --- | --- | --- |
| Database | **MongoDB Atlas** (on AWS) | Singapore (`ap-southeast-1`) |
| Photos and documents | **Amazon S3** — two buckets | Asia Pacific (Singapore) `ap-southeast-1` |
| Backend API, background jobs, queue (Redis-compatible Key Value) | **Render** — [`render.yaml`](../../render.yaml) | Singapore |
| Website (`frontend/web`) and business console (`frontend/console`) | **Vercel** — two projects, see `frontend/*/vercel.json` | Singapore (`sin1`) |

Everything sits in one region because the API makes many database queries per page.
Passwords, connection strings and access keys go **only** into the Atlas, AWS, Render and Vercel dashboards —
never into GitHub, chat or email.

## 1. MongoDB Atlas — database

1. cloud.mongodb.com → create a project (e.g. *Basera*) → **Create** a cluster: provider **AWS**, region
   **Singapore (ap-southeast-1)**.
   - **M0 (free)** is fine for trying things out (512 MB, shared, **no backups**).
   - For the live site use a paid tier (**Flex** or **M10+**) — they include automatic backups.
   Transactions, which the app relies on, work on every tier.
2. **Security → Database Access → Add new database user**
   - Authentication: password. Username e.g. `basera-api`; use **Autogenerate** (letters and digits only — no
     `@ : / ? # %`, which would have to be URL-encoded) and keep it in a password manager.
   - **Database user privileges → Specific privileges**: add `readWrite` on database `basera` **and**
     `dbAdmin` on database `basera`. (`dbAdmin` lets the API install the integrity validators. With only
     `readWrite` the app still works and logs a warning that the validators were skipped.)
3. **Connect → Drivers** → copy the connection string, put your password in place of `<db_password>` and add
   the database name `basera` right after `.mongodb.net/`:
   ```
   mongodb+srv://basera-api:<password>@<cluster>.<id>.mongodb.net/basera?retryWrites=true&w=majority&appName=<cluster>
   ```
   This is **`DATABASE_URL`**.
4. **Security → Network Access**: done in step 4.4 below, once Render shows the addresses its API uses.

Collections, indexes, integrity validators and reference data (roles, permissions, locations, property types)
are created automatically when the backend starts.

## 2. Amazon S3 — photos and documents

All in region **Asia Pacific (Singapore) ap-southeast-1**. Bucket names are global, so add something unique
(e.g. `basera-media-<yourname>`).

1. **Public bucket** (listing and project photos): **S3 → Create bucket** `basera-media-…`
   - Object Ownership: **ACLs disabled**.
   - **Untick "Block all public access"** and confirm.
   - After creating it: **Permissions → Bucket policy** (replace `BUCKET`):
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [{ "Sid": "PublicRead", "Effect": "Allow", "Principal": "*", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::BUCKET/*" }]
     }
     ```
2. **Private bucket** (documents, receipts — served only through short-lived signed links): **Create bucket**
   `basera-private-…` with **Block all public access left ON**.
3. **IAM → Users → Create user** `basera-api` (no console access) → **Add permissions → Create inline policy →
   JSON** (replace both bucket names). The API only uploads files and signs download links, so nothing more:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:PutObject", "Resource": ["arn:aws:s3:::PUBLIC_BUCKET/*", "arn:aws:s3:::PRIVATE_BUCKET/*"] },
       { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::PRIVATE_BUCKET/*" }
     ]
   }
   ```
   Then **Security credentials → Create access key → "Application running outside AWS"** and copy the
   **Access key ID** and **Secret access key** (shown once).

| Render variable | Value |
| --- | --- |
| `S3_REGION` | `ap-southeast-1` (already set by `render.yaml`) |
| `S3_BUCKET_PUBLIC` / `S3_BUCKET_PRIVATE` | the two bucket names |
| `S3_PUBLIC_BASE_URL` | `https://<public-bucket>.s3.ap-southeast-1.amazonaws.com` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | the access key |

`S3_ENDPOINT` stays empty for Amazon S3.

## 3. Choose the Vercel addresses first

Vercel gives each project `https://<project-name>.vercel.app`. Decide the names now (for example `basera-web`
and `basera-console`) because Render needs the addresses. If a name is taken, use the address Vercel actually
gives you everywhere below.

## 4. Render — backend

1. Render → **New → Blueprint** → connect GitHub → repository **Basera** → Render reads `render.yaml` and
   proposes **basera-api** (web service, Docker) and **basera-redis** (Key Value).
2. Fill in the values it asks for:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | from step 1.3 |
   | `WEB_PUBLIC_URL` | `https://basera-web.vercel.app` |
   | `CONSOLE_PUBLIC_URL` | `https://basera-console.vercel.app` |
   | `PLATFORM_ROOT_DOMAIN` | `basera-web.vercel.app` (your own domain later) |
   | `PLATFORM_MAIN_HOSTS` | `basera-web.vercel.app` |
   | `S3_*` | from step 2 |
   | `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | your first Super Admin (password ≥ 10 characters with a letter and a number) |

   Secrets (`JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY`, `FILE_URL_SIGNING_SECRET`) are generated by Render —
   never change `DATA_ENCRYPTION_KEY` afterwards (it encrypts bank/PAN details).
3. **Apply**. The first deploy cannot reach the database yet — that is expected.
4. **Let Render in to Atlas:** in Render open **basera-api → Connect → Outbound** and copy the IP ranges listed
   there. In Atlas **Security → Network Access → Add IP Address**, add each range. Then in Render
   **Manual Deploy → Deploy latest commit**.
   (Allowing `0.0.0.0/0` instead also works, but then anyone on the internet can try to log in to your
   database — it stays protected only by the password. Prefer Render's ranges.)
5. The logs show `[release] Syncing database collections and indexes`, `Seed complete.`, `Super Admin ready`,
   `Connected to MongoDB` and `API listening`. Check
   `https://basera-api.onrender.com/api/v1/health/ready` (use your service's address) → `"status":"ready"`.

Later, in **basera-api → Environment**, add email so password resets and notifications are delivered:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (any SMTP provider). Until then messages
are recorded as "not configured".

The admin variables can stay: an existing Super Admin is never changed on restart (set
`ADMIN_RESET_PASSWORD=true` once to reset that password).

## 5. Vercel — website and console

Vercel → **Add New → Project** → import **Shahbazk03/Basera** — do this twice:

| | Website | Console |
| --- | --- | --- |
| Project name | `basera-web` | `basera-console` |
| Root Directory | `frontend/web` | `frontend/console` |
| `API_INTERNAL_URL` | `https://basera-api.onrender.com` | same |
| `WEB_PUBLIC_URL` | `https://basera-web.vercel.app` | same |
| `CONSOLE_PUBLIC_URL` / `NEXT_PUBLIC_CONSOLE_URL` | `https://basera-console.vercel.app` | — |
| `NEXT_PUBLIC_WEB_URL` | — | `https://basera-web.vercel.app` |
| `PLATFORM_ROOT_DOMAIN` / `PLATFORM_MAIN_HOSTS` | `basera-web.vercel.app` | — |
| `APP_ENV` | — | `production` |
| `S3_PUBLIC_BASE_URL` | same as Render | same as Render |

Build and install commands come from each app's `vercel.json` (it builds the shared package first).
Environment variables are read at build time — **redeploy after changing them**.

## 6. First sign-in and checks

1. Open `https://basera-console.vercel.app/login` and sign in with the Super Admin from step 4.
2. **Admin → Settings**: brand name, contact details. Add locations and property types if needed.
3. Upload a listing photo larger than 5 MB. Vercel limits request sizes; if this fails, report it — uploads
   will then be sent directly to storage.
4. Send a test enquiry from the website and see it arrive under **CRM → Leads**.
5. Backups: on M0 there are none — before real data arrives, move to a tier with backups or schedule
   [`infrastructure/scripts/backup-db.sh`](../../infrastructure/scripts/backup-db.sh) (see
   [backup-and-recovery.md](backup-and-recovery.md)).

Project microsites on their own domains need your own domain on Vercel (custom domains cannot use
`vercel.app`); this comes later.
