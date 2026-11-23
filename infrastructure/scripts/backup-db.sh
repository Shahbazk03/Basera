#!/usr/bin/env sh
# Logical backup of the PostgreSQL database (custom format, compressed).
#   DATABASE_URL=postgresql://user:pass@host:5432/estate ./infrastructure/scripts/backup-db.sh [backup-dir]
# Optional off-site copy: set BACKUP_S3_URI=s3://bucket/path (requires the aws CLI and credentials).
# Managed PostgreSQL providers also offer point-in-time recovery — keep it enabled in production;
# these dumps are an additional, portable safety net (see docs/deployment/backup-and-recovery.md).
set -eu

: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/estate-$STAMP.dump"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

mkdir -p "$DIR"
# Prisma-style ?schema=public query strings are not understood by libpq — strip them.
URL="$(printf '%s' "$DATABASE_URL" | sed 's/[?&]schema=[^&]*//')"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file "$FILE" "$URL"
pg_restore --list "$FILE" > /dev/null   # verifies the archive is readable
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$FILE" "$BACKUP_S3_URI/$(basename "$FILE")" --only-show-errors
  echo "Uploaded to $BACKUP_S3_URI"
fi

find "$DIR" -name 'estate-*.dump' -type f -mtime +"$RETAIN_DAYS" -print -delete || true
