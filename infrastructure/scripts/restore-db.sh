#!/usr/bin/env sh
# Restores a backup created by backup-db.sh into the database at DATABASE_URL.
#   DATABASE_URL=postgresql://user:pass@host:5432/estate_restore ./infrastructure/scripts/restore-db.sh backups/estate-XXXX.dump
# Always restore into a NEW database first, verify it, then switch the application over.
set -eu

: "${DATABASE_URL:?Set DATABASE_URL}"
FILE="${1:?Usage: restore-db.sh <backup.dump>}"
URL="$(printf '%s' "$DATABASE_URL" | sed 's/[?&]schema=[^&]*//')"

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "This replaces objects in the target database. Re-run with CONFIRM=yes to continue."
  exit 1
fi

psql "$URL" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$URL" "$FILE"
echo "Restore complete. Verify with: psql \"$URL\" -c 'SELECT count(*) FROM \"_prisma_migrations\";'"
