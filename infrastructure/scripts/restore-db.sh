#!/usr/bin/env sh
# Restores an archive created by backup-db.sh into the database named in DATABASE_URL.
#   DATABASE_URL='mongodb+srv://user:pass@cluster.mongodb.net/basera_restore' CONFIRM=yes \
#     ./infrastructure/scripts/restore-db.sh backups/basera-XXXX.archive.gz
# SOURCE_DB is the database name inside the archive (default: basera). Always restore into a NEW
# database first, verify it, then point the application at it.
set -eu

: "${DATABASE_URL:?Set DATABASE_URL}"
FILE="${1:?Usage: restore-db.sh <backup.archive.gz>}"
SOURCE_DB="${SOURCE_DB:-basera}"
TARGET_DB="$(printf '%s' "$DATABASE_URL" | sed -E 's#^mongodb(\+srv)?://[^/]+/?([^?]*).*$#\2#')"
[ -n "$TARGET_DB" ] || { echo "DATABASE_URL must name the target database (…/basera_restore)"; exit 1; }

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "This drops and replaces collections in database \"$TARGET_DB\". Re-run with CONFIRM=yes to continue."
  exit 1
fi

# Collections are restored with their indexes and validators; --drop replaces existing ones.
mongorestore --uri="$DATABASE_URL" --archive="$FILE" --gzip --drop \
  --nsInclude="$SOURCE_DB.*" --nsFrom="$SOURCE_DB.*" --nsTo="$TARGET_DB.*"
echo "Restore complete into \"$TARGET_DB\". Verify with: mongosh \"<url>\" --eval 'db.users.countDocuments()'"
