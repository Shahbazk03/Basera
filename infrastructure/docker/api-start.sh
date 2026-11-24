#!/bin/sh
# Start-up for the single-container API (Render): release tasks, then the API.
#   RUN_RELEASE_TASKS=false            skip migrations and reference data (default: run them)
#   ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD   create the first Super Admin if it does not exist yet
set -e
cd /repo/backend

if [ "${RUN_RELEASE_TASKS:-true}" = "true" ]; then
  echo "[release] Applying database migrations"
  npx --no-install prisma migrate deploy
  echo "[release] Syncing reference data (roles, permissions, locations, catalogue)"
  npx --no-install tsx prisma/seed.ts --reference
  if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
    echo "[release] Ensuring the first Super Admin exists"
    npx --no-install tsx prisma/create-admin.ts
  fi
fi

echo "[start] Starting the API"
exec node dist/main.js
