#!/bin/sh
# Start-up for the single-container API (Render): release tasks, then the API.
#   RUN_RELEASE_TASKS=false            skip index sync and reference data (default: run them)
#   ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD   create the first Super Admin if it does not exist yet
set -e
cd /repo/backend

if [ "${RUN_RELEASE_TASKS:-true}" = "true" ]; then
  # MongoDB has no migrations: db push creates collections and the schema's indexes. It never deletes
  # data and stops (without --accept-data-loss) if a change could lose data, e.g. a new unique index
  # that existing documents violate. Indexes and validators Prisma cannot declare are added by the
  # seed below and again at API start-up.
  echo "[release] Syncing database collections and indexes"
  npx --no-install prisma db push --skip-generate
  echo "[release] Syncing reference data (roles, permissions, locations, catalogue)"
  npx --no-install tsx prisma/seed.ts --reference
  if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
    echo "[release] Ensuring the first Super Admin exists"
    npx --no-install tsx prisma/create-admin.ts
  fi
fi

echo "[start] Starting the API"
exec node dist/main.js
