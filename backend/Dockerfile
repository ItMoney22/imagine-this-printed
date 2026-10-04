# Fly.io build image for both imagine-this-printed services.
#
# ONE image, TWO apps. The API and the worker share a repo, a package.json and a
# build; they differ only in their start command, which fly.api.toml and
# fly.worker.toml each supply as a `processes` entry. Building one image keeps
# the two hosts byte-identical — exactly what Render does today, where both
# services run the same build command against the same rootDir.
#
# This reproduces Render's native Node buildpack, whose live config is:
#   rootDir      backend
#   build        npm ci --include=dev && npx prisma generate && npm run build
#   start (api)  node dist/index.js
#   start (wrk)  npm run start:worker  ->  node dist/worker/index.js
# See docs/migration/render-to-fly/STEP-1-INVENTORY.md §1.1, §1.2, §6.2.
#
# BUILD CONTEXT IS `backend/`, not the repo root — `fly deploy` is run from
# inside backend/ so that fly.api.toml / fly.worker.toml sit next to this file.
# The storefront (Vite, Vercel) is not part of this image.

# ---------------------------------------------------------------------------
# Stage 1 — build. Needs devDependencies: `npm run build` is `tsc`, and
# typescript + prisma (the CLI) both live in devDependencies.
# ---------------------------------------------------------------------------
FROM node:22-slim AS build

# sharp and @prisma/client both ship prebuilt binaries for linux-x64 glibc,
# which is what node:22-slim is. openssl is required by Prisma's query engine
# at generate time; slim does not include it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so `npm ci` is cached independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# prisma/schema.prisma only — `prisma generate` reads the schema, never the
# database. Verified in Step 1: it succeeds with DATABASE_URL unset, which is
# what makes this build safe on Fly, where secrets are runtime-only and are
# NOT present during `fly deploy`'s image build. (Render's env vars ARE
# available at build time; this repo happens not to depend on that. If the
# build command ever starts needing a secret, this breaks here, loudly.)
COPY prisma ./prisma
RUN npx prisma generate

# The rest of the backend source. .dockerignore keeps .env*, node_modules and
# dist out — see the note there about dotenv override, it is load-bearing.
COPY . .

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime. Production deps only; tsc and the prisma CLI are build
# tools and have no business in the running image.
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The generated Prisma client lives inside node_modules/.prisma and node_modules/@prisma/client.
# `npm ci --omit=dev` above installs a fresh @prisma/client with no generated
# client inside it, so the generated artifacts have to be copied over the top.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Runtime assets that are read from disk rather than imported, so tsc never
# copies them into dist/. Missing fonts surface as broken text rendering at
# request time, not as a build failure — copy them explicitly.
COPY assets ./assets

# Render's env sets PORT=10000 and backend/index.ts reads process.env.PORT.
# Kept identical so nothing downstream has to change. fly.api.toml's
# internal_port matches.
ENV PORT=10000
EXPOSE 10000

# Non-root. Render's buildpack runs as a non-root user; match that rather than
# quietly upgrading the process to root during a migration.
USER node

# Default is the API. fly.worker.toml overrides this per-process with
# `node dist/worker/index.js`.
#
# `node dist/index.js` directly, NOT `npm start` — npm start fires the
# `prestart` hook (scripts/check-jose.js), and scripts/ is excluded from
# tsconfig's build. Render invokes the same bare node command.
CMD ["node", "dist/index.js"]
