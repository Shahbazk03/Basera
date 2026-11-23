# syntax=docker/dockerfile:1.7
# Builds either Next.js application (web or console) as a standalone server.
#   docker build -f infrastructure/docker/next.Dockerfile --build-arg APP=web     -t estate-web .
#   docker build -f infrastructure/docker/next.Dockerfile --build-arg APP=console -t estate-console .
# Rewrites and NEXT_PUBLIC_* values are resolved at build time, so pass them as build args.

FROM node:22-bookworm-slim AS base
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/console/package.json apps/console/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM deps AS build
ARG APP=web
ARG API_INTERNAL_URL=http://api:4000
ARG WEB_PUBLIC_URL
ARG CONSOLE_PUBLIC_URL
ARG APP_ENV=production
ARG NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG S3_PUBLIC_BASE_URL=
ENV API_INTERNAL_URL=$API_INTERNAL_URL WEB_PUBLIC_URL=$WEB_PUBLIC_URL CONSOLE_PUBLIC_URL=$CONSOLE_PUBLIC_URL APP_ENV=$APP_ENV \
    NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    S3_PUBLIC_BASE_URL=$S3_PUBLIC_BASE_URL NEXT_OUTPUT=standalone
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN npm run build -w @estate/shared && npm run build -w @estate/${APP}

FROM base AS runtime
ARG APP=web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /repo/apps/${APP}/public ./apps/${APP}/public
USER node
ENV APP_DIR=apps/${APP}
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node $APP_DIR/server.js"]
