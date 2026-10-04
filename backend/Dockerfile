# syntax=docker/dockerfile:1.7
#
# imagine-this-printed backend — ONE image, TWO processes.
#
#   API     → node dist/index.js          (fly.api.toml,    app imagine-this-printed-api)
#   Worker  → node dist/worker/index.js   (fly.worker.toml, app imagine-this-printed-worker)
#
# Reproduces the Render native-Node build exactly (INVENTORY §1.1/§1.2/§6.2):
#   rootDir backend · npm ci --include=dev · npx prisma generate · npm run build
#   start: node dist/index.js  /  npm run start:worker → node dist/worker/index.js
#
# BUILD CONTEXT IS `backend/`, NOT THE REPO ROOT. Deploy from inside backend/:
#     cd backend && fly deploy -c fly.api.toml
#     cd backend && fly deploy -c fly.worker.toml
# The repo root carries the Vite storefront and is irrelevant to this image;
# pointing the context there would ship ~600 MB of frontend for nothing and
# would look for .dockerignore in the wrong place.

# ─────────────────────────────── build ────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prisma's query engine links against libssl; node:*-slim ships without it.
# ca-certificates is needed the moment anything in the build talks HTTPS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Dependency layer first so a source-only change doesn't reinstall 47 packages.
# --include=dev is REQUIRED: typescript and prisma are devDependencies and the
# build cannot run without them.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# prisma generate before the rest of the source, for the same cache reason.
# Verified in Step 1: this succeeds with DATABASE_URL UNSET, which matters
# because Fly secrets are runtime-only and are NOT present during the image
# build (Render's env vars are). Keep it that way — if the build ever starts
# needing a secret, this image stops being buildable on Fly.
COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# tsc emits .js only. services/team-plate/fonts.ts resolves its font directory
# RELATIVE TO THE COMPILED FILE (dist/services/team-plate → ../../assets/fonts
# → dist/assets/fonts), so without this copy every bundled typeface is missing
# at runtime and team-plate rendering fails on a file-not-found. This is a
# latent bug the Render buildpack shares — see STEP-2-DEPLOY-CONFIG.md §6.
# Copied to BOTH locations so neither resolution can miss.
RUN cp -R assets dist/assets

# ────────────────────────────── runtime ───────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Production dependencies only. NOT --omit=optional: sharp pulls its native
# binary (@img/sharp-linux-x64) through optionalDependencies and silently
# fails to load without it.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The generated Prisma client lives in node_modules/.prisma/client and the
# `prisma` CLI is a devDependency, so it cannot be regenerated in this stage —
# carry it over from the build stage instead.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets

# Nothing in this codebase writes to the local filesystem (no multer
# diskStorage, no fs writes outside node_modules — checked), so dropping root
# costs nothing.
USER node

# Self-check, run at BUILD time so a broken image can never reach a machine.
# Each of these has a specific way of failing silently until production:
#   - @prisma/client is a stub until `prisma generate` output is present, and
#     the CLI that generates it is a devDependency that does not exist in this
#     stage. If the .prisma copy above is ever dropped, every query throws
#     "@prisma/client did not initialize yet" — at runtime, not here.
#   - sharp loads a platform-specific native binary through optionalDependencies.
#     `npm ci --omit=optional`, or an arch mismatch, leaves the JS package
#     installed and the binary missing: the image builds, then every mockup
#     render dies on first import.
#   - the fonts are copied by a `cp` that no compiler checks. Missing them
#     fails team-plate rendering on a file-not-found nobody sees in a build log.
# Prove all three now; the build fails loudly if any regresses.
RUN node -e "require('@prisma/client'); require('sharp'); const n=require('fs').readdirSync('dist/assets/fonts').filter(f=>f.endsWith('.ttf')).length; if(n<8) throw new Error('expected the bundled typefaces in dist/assets/fonts, found '+n); console.log('image self-check OK — prisma, sharp, '+n+' fonts')"

EXPOSE 10000

# Default command = the API. fly.worker.toml overrides it with a [processes]
# entry, so the worker runs the same image with a different entry point.
CMD ["node", "dist/index.js"]
