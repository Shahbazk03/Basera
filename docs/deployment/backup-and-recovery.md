# Backup & recovery

## What must be protected

| Data | Where | Backup |
| --- | --- | --- |
| Business data | PostgreSQL | Provider PITR (primary) + nightly logical dumps (secondary, portable) |
| Uploaded files | Object storage (public + private buckets) | Bucket versioning + cross-region replication or scheduled sync |
| Secrets | Secret manager / deployment env | Managed by your secret store; `DATA_ENCRYPTION_KEY` **must** be backed up separately — encrypted HR fields are unrecoverable without it |
| Redis | Queues and rate limits | Not required (outbox state lives in PostgreSQL; queued jobs are re-dispatched by the sweeper) |

## Targets (recommended)
- RPO ≤ 5 minutes (PITR), RTO ≤ 1 hour.
- Keep 14 daily logical dumps and 12 monthly ones; store off-site.

## Logical dumps

```bash
# nightly (cron / scheduled job)
DATABASE_URL=postgresql://user:pass@db:5432/estate BACKUP_S3_URI=s3://estate-backups/db ./infrastructure/scripts/backup-db.sh /var/backups/estate
```

The script writes a compressed custom-format dump, verifies it with `pg_restore --list`, optionally uploads it, and prunes local copies older than `RETAIN_DAYS` (14).

## Restore procedure

1. Create an empty database (never restore over production directly).
2. `CONFIRM=yes DATABASE_URL=postgresql://…/estate_restore ./infrastructure/scripts/restore-db.sh backups/estate-<stamp>.dump`
3. Verify: row counts on key tables, latest `_prisma_migrations` entry matches the deployed release, application smoke test against the restored database.
4. Point the API at the restored database (or promote it), restart API containers.
5. If files were affected, restore bucket objects from versioning to the same keys (database rows reference storage keys).

## Restore drills
Run a full restore into staging at least quarterly and record the time taken (RTO) and data loss window (RPO).
