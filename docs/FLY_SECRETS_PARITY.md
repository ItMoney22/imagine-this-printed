# Render -> Fly: secrets parity (Step 3/6)

Watchtower task `c4cbd8d0-cfb9-4661-ad8c-3dae42f5b7d9` (umbrella `291fcf82`). Verified live 2026-09-23.
Names only. No value, and no hash of a value, lives in this file or in git.

## Apps

| Render service | Fly app | Machines |
|---|---|---|
| `imagine-this-printed-backend` (srv-d7jpgut7vvec739bsid0) | `imagine-this-printed-api` | 2x shared-cpu-1x/512MB, ord, **started** (not serving prod: `api.` still CNAMEs to Render) |
| `imagine-this-printed-worker` (srv-d7jppnn7f7vs73bb4p80) | `imagine-this-printed-worker` | 2x shared-cpu-1x/512MB, ord, **stopped on purpose** until cutover |

(The task text says `imagine-this-printed-backend` on Fly. The Fly app is really named `imagine-this-printed-api`, which Levi created in fe536cc.)

## Build-time vs runtime

**Build time: none.** The Dockerfile's build stage runs `npm ci` + `npm run build` (tsc + copy-assets) and reads no env var.
It only bakes `NODE_ENV=production` and `PORT=10000` into the runtime stage. The `VITE_*` frontend variables belong to Vercel and are untouched.

**Runtime:** `PORT` and `NODE_ENV` are declared in `fly.api.toml` / `fly.worker.toml` `[env]`. Everything else is a Fly secret.

## Variable-name diff (live Render API vs Fly runtime `process.env`)

Render API has 61 vars and Render worker has 50. The worker set is a strict subset of the API set.

**Ported (identical names, byte-identical values at runtime):**

```
AI_WEBHOOK_SECRET ALLOWED_ORIGINS API_ORIGIN APP_ORIGIN ASSET_BUCKET DATABASE_URL DESIGN_AGENT_TOKEN
EMAIL_DOMAIN ETSY_APPROVER_EMAIL ETSY_ENABLED ETSY_KEYSTRING ETSY_READINESS_STATE_ID ETSY_REDIRECT_URI
ETSY_RETURN_POLICY_ID ETSY_SHARED_SECRET ETSY_SHIPPING_PROFILE_ID ETSY_SHOTS_MODEL ETSY_TAXONOMY_MAP
FRONTEND_URL GCS_BUCKET_NAME GCS_CREDENTIALS GCS_PROJECT_ID GOOGLE_API_KEY GOOGLE_MAPS_API_KEY HF_TOKEN
JWT_SECRET NODE_ENV OPENAI_API_KEY OPENROUTER_API_KEY ORDER_STATUS_TOKEN_SECRET PORT PUBLIC_URL
REMOVEBG_API_KEY REPLICATE_API_TOKEN REPLICATE_PRODUCT_MODEL_ID REPLICATE_TRYON_MODEL_ID RESEND_API_KEY
SERPAPI_API_KEY SHIPPO_API_TOKEN STRIPE_PUBLISHABLE_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL TRIPO_API_KEY            <- both apps (46)

PRINT_BRIDGE_TOKEN PRINT_WORKER_EMAILS RESEND_WEBHOOK_SECRET STOREFRONT_API_KEY
STOREFRONT_BACK_PRINT_UPCHARGE_USD STOREFRONT_BASE_COST_USD STOREFRONT_CREATOR_KEYS
SUPABASE_JWT_SECRET TRUST_PROXY_HOPS WATCHTOWER_INTERNAL_SECRET XAI_API_KEY       <- API only (+11 = 57)
```

**Deliberately NOT ported. Render still has them, but nothing on `main` reads them:**

| Var | Evidence |
|---|---|
| `BREVO_API_KEY` | only a comment in `backend/utils/email.ts` ("was armed live via BREVO_API_KEY, removed"). Resend is the only transport |
| `BREVO_SENDER_EMAIL` | zero references in `backend/` |
| `BREVO_SENDER_NAME` | zero references in `backend/` |
| `REPLICATE_REMBG_MODEL_ID` | zero references in `backend/`. BG removal goes through `services/background-removal.ts` |

Levi's first import (0c357ea) carried all four, so I removed them from both Fly apps. The API had them unset live. The worker had them unset `--stage`, because its machines are stopped.
Dynamic `process.env[name]` lookups (rate-limits, storefront garment cost, delivery-coupon, presentation-qa) were checked. None of them builds these names.

**Totals:** API 57/57 and worker 46/46 Render vars are present on Fly with identical values. Missing: 0. Stale: 0. Fly has nothing Render doesn't.

**Critical-secret checklist from the task:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, `EMAIL_FROM`, OPENAI_API_KEY, REPLICATE_API_TOKEN, ETSY_KEYSTRING, ETSY_SHARED_SECRET,
SHIPPO_API_TOKEN, GCS_CREDENTIALS and WATCHTOWER_INTERNAL_SECRET are all ported and verified. The exceptions:
- `EMAIL_FROM` is not set on Render at all. The code default applies on both hosts, so parity holds.
- The Etsy OAuth token is not an env var. It lives in the database (`etsy_connection`, access + refresh token), so it travels with `DATABASE_URL` / Supabase.
- `WATCHTOWER_INTERNAL_SECRET` is API-only on Render, and API-only on Fly to match.

## Drift caught during this run

At 11:30Z on 2026-09-23 another session rotated `OPENROUTER_API_KEY` on both Render services, in the same window as a Render deploy.
My first parity pass (11:22Z) was green. The re-run of the committed probe caught the change within minutes.
I synced the new value to Fly through stdin (`fly secrets import`; the value is never echoed). The API had it set live and the worker had it `--stage`d.
**Lesson for Step 5:** the parity is only true at the moment you measure it. Re-run the probe right before the DNS flip.

## How it was proven (and how to re-prove it)

```
node scripts/fly/render-env-hashes.mjs <scratch>      # sha256 of every live Render value -> expected-{api,worker}.json
# API: copy fly-env-probe.mjs + expected-api.json into each started machine (fly ssh console), run with node
# Worker: one-off machine from the worker image, so the real worker loop never starts:
fly machine run <worker image> -a imagine-this-printed-worker -r ord --rm --restart no \
  --file-local /tmp/p.mjs=scripts/fly/fly-env-probe.mjs --file-local /tmp/e.json=<scratch>/expected-worker.json \
  --entrypoint node -- /tmp/p.mjs /tmp/e.json
```

The probe runs inside the Fly runtime and checks three things:
1. Every Render var is in `process.env` with a matching sha256, and the four stale vars are absent.
2. The Supabase boot guard runs the same JWT `ref`/`role` logic as `backend/lib/supabase-env-guard.ts` (sifu, e77aae9). That guard is still unmerged, so the image doesn't include it and the probe re-implements it. `SUPABASE_JWT_SECRET` also HMAC-verifies the service-role key.
3. Live read-only auth calls go out to Supabase REST and Auth-admin, Stripe, Resend, Replicate, OpenAI, OpenRouter, Shippo and Etsy. The probe also parses GCS_CREDENTIALS (28 newlines intact) and DATABASE_URL.

Final results (2026-09-23 ~11:40Z):
- API machines 78417e0c141368 and 8654912bee9578 showed 57/57 identical with every check PASS.
- Worker one-off 8654932fee3098 showed 46/46 identical with every check PASS.
- After the secret-triggered rolling restart, `/api/health` returned 200 and `/api/health/database` returned 200 (DB connected).

**Worker job claim:** `scripts/fly/claim-probe.mjs` ran in a one-off worker-image machine using the worker's compiled Supabase client and `claimQueuedJob()`, the exact call `startJob()` makes.
It inserted one tagged no-op `ai_jobs` row (type `fly_migration_probe`, id 944d9fe4) and claimed it (`claimed=true`, status `running`). A second claim was refused, then the row was deleted, and a re-query confirms 0 probe rows remain.
The full worker process was not started. Its image carries code that isn't on `main` yet (team-plate and more; see approval `ae7fe21c`), and running it against production beside Render's worker would ship unreleased code. The full-worker boot was already proven by Levi (0c357ea, all seven loops armed). It gets re-proven at cutover on the approved image.

## Open for Step 4/5

- The stopped worker machines still hold their pre-change config: the Brevo/rembg vars and the old OpenRouter key. The staged secrets apply on the next `fly deploy`, which is the cutover deploy. Don't `fly machine start` the old machines before that deploy.
- Render still carries the four dead vars. Render is being retired, so they are left alone.
