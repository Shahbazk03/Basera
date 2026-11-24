#!/usr/bin/env sh
# Logical backup of the MongoDB database: one gzip-compressed mongodump archive (data, indexes, validators).
#   DATABASE_URL='mongodb+srv://user:pass@cluster.mongodb.net/basera' ./infrastructure/scripts/backup-db.sh [backup-dir]
# Needs the MongoDB Database Tools (mongodump/mongorestore). Optional off-site copy: set
# BACKUP_S3_URI=s3://bucket/path (requires the aws CLI and credentials).
# MongoDB Atlas also takes managed snapshots (dedicated and Flex tiers) — keep them enabled in production;
# these archives are an additional, portable safety net (see docs/deployment/backup-and-recovery.md).
set -eu

: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/basera-$STAMP.archive.gz"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

mkdir -p "$DIR"
mongodump --uri="$DATABASE_URL" --archive="$FILE" --gzip --quiet
gzip -t "$FILE"   # verifies the archive is complete and readable
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$FILE" "$BACKUP_S3_URI/$(basename "$FILE")" --only-show-errors
  echo "Uploaded to $BACKUP_S3_URI"
fi

find "$DIR" -name 'basera-*.archive.gz' -type f -mtime +"$RETAIN_DAYS" -print -delete || true
