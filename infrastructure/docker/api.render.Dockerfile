# syntax=docker/dockerfile:1.7
# API image for Render (or any single-container host without a separate release job).
# The container runs its release tasks at start-up — database migrations, reference data and the first
# Super Admin — then starts the API (see api-start.sh). Build context: repository root.
#   docker build -f infrastructure/docker/api.render.Dockerfile -t basera-api .

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/console/package.json apps/console/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# DATABASE_URL is only read by prisma.config.ts while generating the client; no connection is made.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @estate/shared \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @estate/api

# Runtime keeps the Prisma CLI and tsx so the release tasks can run inside the container.
FROM build AS runtime
ENV NODE_ENV=production
COPY infrastructure/docker/api-start.sh /usr/local/bin/api-start
RUN chmod 755 /usr/local/bin/api-start
USER node
WORKDIR /repo/apps/api
EXPOSE 10000
CMD ["api-start"]
