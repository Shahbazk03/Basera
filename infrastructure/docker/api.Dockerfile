# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f infrastructure/docker/api.Dockerfile -t estate-api .

FROM node:22-bookworm-slim AS base
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# ── Dependencies (all workspaces so npm ci matches the lockfile) ─────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/web/package.json frontend/web/
COPY frontend/console/package.json frontend/console/
COPY shared/package.json shared/
COPY frontend/packages/ui/package.json frontend/packages/ui/
COPY frontend/packages/api-client/package.json frontend/packages/api-client/
RUN npm ci --no-audit --no-fund

# ── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
# DATABASE_URL is only needed by prisma.config.ts at generate time; no connection is made.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @estate/shared \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @estate/api

# ── Production dependencies only ────────────────────────────────────────────
FROM deps AS prod-deps
RUN npm prune --omit=dev --workspace @estate/api --workspace @estate/shared --include-workspace-root=false || npm prune --omit=dev

# ── Migration job image (has the Prisma CLI) ───────────────────────────────
FROM build AS migrate
WORKDIR /repo/backend
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/shared/package.json shared/package.json
COPY --from=build /repo/shared/dist shared/dist
COPY --from=build /repo/backend/package.json backend/package.json
COPY --from=build /repo/backend/dist backend/dist
RUN mkdir -p /repo/storage && chown -R node:node /repo/storage
USER node
WORKDIR /repo/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
