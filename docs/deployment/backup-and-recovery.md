# Backup & recovery

## What must be protected

| Data | Where | Backup |
| --- | --- | --- |
| Business data | MongoDB Atlas | Atlas cloud backups / point-in-time restore on Flex and dedicated tiers (primary; **none on the free M0 tier**) + nightly `mongodump` archives (secondary, portable) |
| Uploaded files | Object storage (public + private buckets) | Bucket versioning + cross-region replication or scheduled sync |
| Secrets | Secret manager / deployment env | Managed by your secret store; `DATA_ENCRYPTION_KEY` **must** be backed up separately — encrypted HR fields are unrecoverable without it |
| Redis | Queues and rate limits | Not required (outbox state lives in MongoDB; queued jobs are re-dispatched by the sweeper) |

## Targets (recommended)
- RPO ≤ 5 minutes (Atlas continuous backup), RTO ≤ 1 hour.
- Keep 14 daily logical dumps and 12 monthly ones; store off-site.

## Logical dumps

Needs the [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/) (`mongodump`, `mongorestore`).

```bash
# nightly (cron / scheduled job)
DATABASE_URL='mongodb+srv://user:pass@cluster.mongodb.net/basera' BACKUP_S3_URI=s3://basera-backups/db ./infrastructure/scripts/backup-db.sh /var/backups/basera
```

The script writes one gzip-compressed archive (documents, indexes and validators), checks it with `gzip -t`, optionally uploads it, and prunes local copies older than `RETAIN_DAYS` (14). Use a separate, read-only database user for backups where possible.

## Restore procedure

1. Restore into a new database name (never over production directly).
2. `CONFIRM=yes DATABASE_URL='mongodb+srv://…/basera_restore' ./infrastructure/scripts/restore-db.sh backups/basera-<stamp>.archive.gz` (`SOURCE_DB` if the archive's database is not `basera`).
3. Verify: document counts on key collections (`users`, `properties`, `leads`, `invoices`), application smoke test against the restored database.
4. Point the API at the restored database (or promote it), restart API containers.
5. If files were affected, restore bucket objects from versioning to the same keys (database rows reference storage keys).

## Restore drills
Run a full restore into staging at least quarterly and record the time taken (RTO) and data loss window (RPO).
