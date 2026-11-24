# syntax=docker/dockerfile:1.7
# API image for Render (or any single-container host without a separate release job).
# The container runs its release tasks at start-up — database indexes (prisma db push), reference data
# and the first Super Admin — then starts the API (see api-start.sh). Build context: repository root.
#   docker build -f infrastructure/docker/api.render.Dockerfile -t basera-api .

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Prisma's query engine needs OpenSSL; CA certificates are needed for TLS to MongoDB Atlas.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/web/package.json frontend/web/
COPY frontend/console/package.json frontend/console/
COPY shared/package.json shared/
COPY frontend/packages/ui/package.json frontend/packages/ui/
COPY frontend/packages/api-client/package.json frontend/packages/api-client/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
# Generating the Prisma client makes no database connection; a placeholder URL is enough.
RUN DATABASE_URL=mongodb://build:27017/build npm run build -w @estate/shared \
 && DATABASE_URL=mongodb://build:27017/build npm run build -w @estate/api

# Runtime keeps the Prisma CLI and tsx so the release tasks can run inside the container.
FROM build AS runtime
ENV NODE_ENV=production
COPY infrastructure/docker/api-start.sh /usr/local/bin/api-start
RUN chmod 755 /usr/local/bin/api-start
USER node
WORKDIR /repo/backend
EXPOSE 10000
CMD ["api-start"]
