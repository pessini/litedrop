# litedrop — Node 24, multi-stage build. Self-contained image: the backend
# serves the API, the SSR public pages, AND the built dashboard SPA.
#
# Build context is the REPO ROOT (npm-workspaces monorepo):
#   docker build -f apps/backend/Dockerfile .
FROM node:24-slim AS base
WORKDIR /app

# --- deps: workspace install with dev deps for building ---
# Full `npm ci` (no -w filtering): filtered installs hit the npm optional-deps
# bug (npm/cli#4828) and drop platform-native bindings (rolldown, libsql).
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/dashboard/package.json apps/dashboard/
COPY cli/package.json cli/
COPY packages/core/package.json packages/core/
COPY packages/api-types/package.json packages/api-types/
RUN npm ci

# --- build: compile backend TS -> dist, dashboard SPA -> apps/dashboard/dist ---
FROM deps AS build
COPY apps/backend ./apps/backend
COPY apps/dashboard ./apps/dashboard
COPY packages/core ./packages/core
COPY packages/api-types ./packages/api-types
RUN npm run -w @litedrop/backend build && npm run -w @litedrop/dashboard build

# --- prod deps only ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/dashboard/package.json apps/dashboard/
COPY cli/package.json cli/
COPY packages/core/package.json packages/core/
COPY packages/api-types/package.json packages/api-types/
RUN npm ci --omit=dev && mkdir -p apps/backend/node_modules

# --- runtime ---
# Keeps the monorepo layout (/app/apps/backend, /app/apps/dashboard/dist) so module resolution
# and the backend's auto-detection of ../dashboard/dist work exactly as on a host.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
# SQL migrations ship alongside dist: the server applies the sqlite set itself
# at boot (src/db/migrate.ts resolves this exact path).
COPY --from=build /app/apps/backend/src/db/migrations ./apps/backend/src/db/migrations
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist
COPY apps/backend/package.json ./apps/backend/
COPY package.json ./
WORKDIR /app/apps/backend
EXPOSE 8080
# Embedded SQLite (the default DATABASE_URL) and local blob storage live here —
# mount volumes to persist them:
#   docker run -v litedrop-db:/app/apps/backend/.data -v litedrop-blobs:/app/apps/backend/.storage …
VOLUME /app/apps/backend/.data
VOLUME /app/apps/backend/.storage
CMD ["node", "dist/index.js"]
