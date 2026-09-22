# Render → Fly migration · Step 1/6 — live configuration inventory

**Watchtower task:** `45975c35-fde4-4174-a600-ee7489710eb2`
**Parent umbrella:** `291fcf82-d89a-4848-af42-2ab70d5ec57d`
**Captured:** 2026-09-22 by Levi James
**Source of truth:** the live Render REST API (`api.render.com/v1`), read with the
workspace API key, plus the code in this repo at commit `861afd6`. Nothing here was
copied from an older doc.

> **Why this file exists.** There is **no `render.yaml` anywhere in this repository.**
> Both services are configured entirely in the Render dashboard. If the Render workspace
> is lost, closed, or the services are deleted, *this document is the only record of how
> production is wired.* Treat it as the cold-rebuild source, and re-capture it if anything
> changes before the cutover.

---

## 0. Executive summary — the six things that decide this migration

| # | Finding | Why it matters |
|---|---|---|
| 1 | **Render runs in `oregon`; Supabase runs in AWS `us-east-2` (Ohio).** | Production has been making every DB round-trip coast-to-coast for five months. Moving to Fly `ord` is not just cheaper, it's ~50 ms/query faster. |
| 2 | **Local `main` is 31 commits ahead of what Render is actually running** (`91811ccb`, deployed 2026-09-11). | A naive `fly deploy` at cutover would ship a quarter of unreleased work *at the same moment* it takes over live traffic. See §7.1 — this must be decided before Step 5. |
| 3 | **Six of the seven worker jobs are safe to run twice concurrently; one is not.** | This is what makes a zero-downtime worker cutover possible at all. See §4.3. |
| 4 | **The API's SIGTERM handler calls `process.exit(0)` without `server.close()`.** | In-flight requests are killed on every deploy. Render's health-gated rolling deploy hides it today; Fly will not. See §7.2. |
| 5 | **Render auto-deploys on every push to `main`. Fly has no equivalent.** | `CLAUDE.md` states "a push to `main` IS a production deploy". That guarantee silently disappears on Fly unless a GitHub Action replaces it. See §6.1. |
| 6 | **The cutover CNAME has a 300 s TTL and Cloudflare is API-writable.** | Step 5 needs no human and has a ~5-minute rollback window with Render still warm. See §2.1. |

---

## 1. Render account and services

| Field | Value |
|---|---|
| Workspace | `David's workspace` (`tea-d7jp7tt7vvec7392beeg`), owner `davidltrinidad@gmail.com` |
| Repo | `https://github.com/ItMoney22/imagine-this-printed` |
| Branch | `main` (both services) |
| Env groups | **none** — every variable is set per-service |
| Persistent disks | **none** (`GET /v1/disks` → `[]`) — both services are fully stateless |
| Render Cron Jobs | **none** — the account has no cron-job service type provisioned. Every recurring task is an in-process `setInterval` inside the worker (§4.2) |

### 1.1 `imagine-this-printed-backend` — the API

| Field | Live value |
|---|---|
| Service ID | `srv-d7jpgut7vvec739bsid0` |
| Type | `web_service` |
| Created | 2026-04-21T15:32:12Z |
| Runtime | `node` (Render native Node buildpack — **not** Docker) |
| Root directory | `backend` |
| Build command | `npm ci --include=dev && npx prisma generate && npm run build` |
| Start command | `node dist/index.js` |
| Health check path | `/api/health` |
| Plan / build plan | `starter` / `starter` |
| Instances | `1` |
| Region | **`oregon`** |
| Open port | `10000/TCP` (from the `PORT` env var) |
| Build cache | `no-cache` |
| Auto-deploy | `yes`, trigger `commit` |
| PR previews | disabled (`previews.generation: off`) |
| Maintenance mode | disabled |
| IP allow list | `0.0.0.0/0` ("everywhere") — effectively open |
| Render subdomain | `https://imagine-this-printed-backend.onrender.com` (policy `enabled`) |
| SSH | `srv-d7jpgut7vvec739bsid0@ssh.oregon.render.com` |
| Custom domain | `api.imaginethisprinted.com` — `cdm-d7jpkau7r5hc73b7jdog`, subdomain, **verified** |
| Live deploy | `91811ccb`, status `live`, finished 2026-09-11T11:12:00Z |

### 1.2 `imagine-this-printed-worker` — the background worker

| Field | Live value |
|---|---|
| Service ID | `srv-d7jppnn7f7vs73bb4p80` |
| Type | `background_worker` |
| Created | 2026-04-21T15:50:56Z |
| Runtime | `node` |
| Root directory | `backend` |
| Build command | `npm ci --include=dev && npx prisma generate && npm run build` |
| Start command | `npm run start:worker` → `node dist/worker/index.js` |
| Health check | **none** — background workers accept no inbound HTTP |
| Plan / build plan | `starter` / `starter` |
| Instances | `1` |
| Region | **`oregon`** |
| Auto-deploy | `yes`, trigger `commit` |
| Custom domains | none |
| SSH | `srv-d7jppnn7f7vs73bb4p80@ssh.oregon.render.com` |
| Live deploy | `91811ccb`, status `live`, finished 2026-09-11T11:11:53Z |

Render Starter is **0.5 vCPU / 512 MB RAM, $7/mo** per service → **$14/mo today**.
512 MB is *proven adequate* for both processes by five months of production uptime,
so the Fly target of `shared-cpu-1x` @ 512 MB is a like-for-like sizing, not a gamble.
(Note `backend/ecosystem.config.cjs` sets a pm2 `max_memory_restart: '1G'`, but that
file is not used by Render and has never gated production.)

---

## 2. DNS and the traffic path

```
browser ──► imaginethisprinted.com                    (Vercel, storefront)
             │  VITE_API_BASE = https://api.imaginethisprinted.com
             ▼
           api.imaginethisprinted.com
             │  CNAME  →  imagine-this-printed-backend.onrender.com   ← verified live 2026-09-22
             ▼
           Render web service (oregon)
             │
             ▼
           aws-0-us-east-2.pooler.supabase.com:5432   (Supabase, Ohio)
```

The `api.imaginethisprinted.com` CNAME is the **single cutover point** and the single
point of failure. It is untouched by this step.

Verified live at capture time:

```
GET https://api.imaginethisprinted.com/api/health          → 200 {"ok":true} (0.38 s)
GET https://api.imaginethisprinted.com/api/health/worker   → 200 {"status":"alive",
                                                                 "message":"Worker heartbeat is current"}
nslookup -type=CNAME api.imaginethisprinted.com            → imagine-this-printed-backend.onrender.com
```

### 2.1 The zone — answers the parent task's open DNS question

`imaginethisprinted.com` is hosted on **Cloudflare**, and the API token in the vault can
read *and write* it (verified by a live record read). **The Step 5 CNAME repoint can be
fully automated — it does not need David.** Parent task `291fcf82` can close that open
question.

| Record | Type | Target | Proxied | TTL |
|---|---|---|---|---|
| `api.imaginethisprinted.com` | CNAME | `imagine-this-printed-backend.onrender.com` | **false** | **300** |
| `imaginethisprinted.com` | CNAME | `cname.vercel-dns.com` | false | 300 |
| `www.imaginethisprinted.com` | CNAME | `cname.vercel-dns.com` | false | 300 |

Record id for the cutover: `74b5eb9b47e763da941199bfcc7e0941`.

Three consequences, all of which matter more than they look:

1. **`proxied: false` — there is no Cloudflare edge in front of the API.** Traffic goes
   browser → Render directly. This *contradicts the comment in `backend/index.ts`*, which
   justifies `TRUST_PROXY_HOPS=2` as a "Cloudflare+Render" hop count. Whatever the 2 is
   counting, it is Render's own proxy layers, not Cloudflare. See §6.6 — this makes
   re-deriving the value on Fly mandatory rather than optional.
2. **TTL is 300 s.** The cutover propagates in ~5 minutes and, critically, **rolls back in
   ~5 minutes**. That is the Step 5 safety net: flip the CNAME, watch, and if anything is
   wrong flip it straight back to `imagine-this-printed-backend.onrender.com` while the
   Render service is still running. Do not lower or raise this TTL before the cutover.
3. **CAA records restrict certificate issuance** — the zone allows `ssl.com`, `sectigo.com`,
   `pki.goog`, `letsencrypt.org`, `globalsign.com`, `digicert.com`, `comodoca.com`.
   **Fly issues via Let's Encrypt, which is on the list — so `fly certs add` will work.**
   Checked deliberately: a missing CAA entry blocks issuance silently and the new host
   would serve TLS errors the moment DNS moved. This one is clear.

---

## 3. Region: where Supabase actually lives

The brief says "provision in the same region as the Supabase project". Established by
evidence, not assumption:

* Live `DATABASE_URL` on **both** Render services points at
  `aws-0-us-east-2.pooler.supabase.com:5432`.
* That hostname resolves through
  `pool-tcp-us-east-2-…elb.us-east-2.amazonaws.com` → **AWS `us-east-2`, Columbus, Ohio**.
* `SUPABASE_URL` = `https://czzyrmizvjqlifcivrhn.supabase.co` on both services.

**Fly has no Ohio region.** The full US region list is `ord, iad, ewr, dfw, lax, sjc` (+ `yyz` Toronto).

| Fly region | City | ≈ distance to Columbus OH | Verdict |
|---|---|---|---|
| **`ord`** | **Chicago, IL** | **~300 mi** | **chosen** |
| `iad` | Ashburn, VA | ~400 mi | runner-up; pick this only if `ord` capacity fails |
| `ewr` | Secaucus, NJ | ~550 mi | no |

**Target region: `ord`.** This also *improves* on today: Oregon → Ohio is ~2,000 mi and
roughly 60–70 ms RTT; Chicago → Ohio is single-digit ms.

---

## 4. Worker audit — every job, confirmed against the code

### 4.1 The entry graph (this is the part that bites)

`backend/worker/index.ts` imports and starts **six** functions. The brief lists **seven**
jobs. Both are correct — `etsy-receipt-ingest` is **not** started from `index.ts`. It is
started *transitively* from inside the Etsy publish worker:

```
backend/worker/index.ts
  ├─ '../load-env.js'                               ← MUST stay the first import (§7.3)
  ├─ startWorker()                  → ai-jobs-worker.ts
  ├─ startEtsyWorker()              → etsy-jobs-worker.ts
  │     └─ startEtsyReceiptPoller() → etsy-receipt-ingest.ts   ◄── NESTED, invisible in index.ts
  ├─ startTryOnRetentionSweep()     → tryon-retention-sweep.ts
  ├─ startMrsImagineDaily()         → mrs-imagine-daily.ts
  ├─ startStepFlowStallSweep()      → step-flow-stall-sweep.ts
  └─ startDeliveryTrackingSweep()   → delivery-tracking-sweep.ts
```

Anyone porting the worker by reading `index.ts` alone will believe there are six jobs.
There are seven. `etsy-jobs-worker.ts:40` is the line that matters. Because the whole
process is started by one command (`node dist/worker/index.js`) the nesting is harmless
for the migration itself — but it must not be "tidied up" during it.

`index.ts` also installs `unhandledRejection` / `uncaughtException` handlers that log and
`process.exit(1)`, deliberately delegating recovery to the platform's restart-on-crash.
The code comment explicitly flags that this was never confirmed for Render. **On Fly this
must be pinned explicitly** — see §6.4.

### 4.2 Cadence and gating

| Job | File | Cadence | First run | Disable switch (env) | Set on Render? |
|---|---|---|---|---|---|
| AI jobs | `ai-jobs-worker.ts` | poll **5 s**; cleanup pass every **60 min** | immediate | — (always on) | n/a |
| Etsy publish | `etsy-jobs-worker.ts` | poll **15 s** | immediate | `ETSY_WORKER_ENABLED=false` | **no** |
| Etsy receipt ingest | `etsy-receipt-ingest.ts` | poll **60 s** | immediate | `ETSY_WORKER_ENABLED=false` (shared) | **no** |
| Try-on retention | `tryon-retention-sweep.ts` | every **24 h** (`TRYON_RETENTION_SWEEP_HOURS`) | +2 min | `TRYON_RETENTION_ENABLED=false` | **no** |
| Step-Flow stall | `step-flow-stall-sweep.ts` | every **5 min** (`STEP_FLOW_STALL_SWEEP_MINUTES`) | +2 min | `STEP_FLOW_STALL_SWEEP_ENABLED=false` | **no** |
| Delivery tracking | `delivery-tracking-sweep.ts` | every **30 min** (`DELIVERY_SWEEP_MINUTES`) | +60 s | `DELIVERY_SWEEP_ENABLED=false`, **or** absent `SHIPPO_API_TOKEN` | **no** |
| Mrs. Imagine daily | `mrs-imagine-daily.ts` | ticks every **10 min**, fires at **11:00 UTC** | +delay | `MRS_IMAGINE_SCOUT=false`; full batch needs `MRS_IMAGINE_DAILY=true` | **no** |

**Every one of these tuning/gating variables is absent from Render.** All seven jobs run
on their hard-coded code defaults. That is the behaviour to reproduce: **do not "helpfully"
set any of them on Fly.** Setting `MRS_IMAGINE_DAILY=true` in particular would re-arm the
unattended daily batch David switched off on 2026-09-02.

Other defaults worth recording, all currently unset and therefore in force:
`TRYON_PHOTO_RETENTION_DAYS=30`, `TRYON_RETENTION_BATCH=200`,
`TRYON_RETENTION_KEEP_RESULTS=false`, `STEP_FLOW_STALL_MINUTES=15`,
`STEP_FLOW_STALL_BATCH=20`, `DELIVERY_SWEEP_BATCH=25`, `DELIVERY_SWEEP_MAX_AGE_DAYS=45`,
`MRS_IMAGINE_SCOUT_HOUR_UTC=11`.

### 4.3 Overlap safety — can Render and Fly workers run at the same time?

This is the question the whole zero-downtime plan turns on. Checked job by job in code:

| Job | Concurrency control | Safe to double-run? |
|---|---|---|
| AI jobs | `claimQueuedJob()` → `claimOnce()`: conditional `UPDATE … WHERE id=? AND status='queued' RETURNING`. `ai-jobs-worker.claim.test.ts` exercises exactly the two-worker race. | **Yes** |
| Etsy publish | `claimEtsyListing()`, same conditional-UPDATE shape on `etsy_listings.state='queued'`, plus stale-claim requeue (Watchtower `13dcdf0a`). | **Yes** |
| Etsy receipt ingest | Inserts `order_number = 'ETSY-<receipt_id>'`; `orders.order_number` is `TEXT UNIQUE NOT NULL`, and the code catches Postgres `23505` and returns `duplicate`. Deduped by the database. | **Yes** |
| Delivery tracking | `claimDelivered()` → `UPDATE … WHERE id=? AND status<>'delivered' RETURNING`; the buyer's thank-you email is sent **only** by the caller that wins. Designed for two simultaneous callers (admin modal + sweep). | **Yes** |
| Step-Flow stall | Only ever flips `running` → `failed` on rows already past their stall deadline. Idempotent. | **Yes** |
| Try-on retention | Deletes expired GCS objects; a second delete of an already-deleted object is a no-op. | **Yes** |
| **Mrs. Imagine daily** | **Guard is `SELECT count(...)` then run — a read-then-act race, not a lock.** Two processes ticking in the same instant both see zero and both start a sweep. | **No** |

**Conclusion:** the worker cutover can be a safe overlap (run both, then stop Render)
for six of seven jobs. The one exception is bounded and easy to neutralise: the
Mrs. Imagine scout only acts in the **11:00 UTC** hour, so **schedule the worker cutover
outside 11:00–12:00 UTC**, or set `MRS_IMAGINE_SCOUT=false` on the Fly worker for the
overlap window and remove it after Render is stopped. Worst case if ignored is a
duplicate scout run — no customer impact, no money — but it should not be left to luck.

### 4.4 Worker liveness signal for the cutover

The worker stamps an hourly heartbeat into `audit_logs`; the API exposes it at
`GET /api/health/worker` (`200 alive` / `503 stale`). This is the verification probe for
Steps 5–6: after the Fly worker takes over and the Render worker is stopped, that endpoint
must still read `alive`. Note the heartbeat is *hourly*, so allow up to ~1 h before
treating `stale` as a real failure.

---

## 5. Environment variables

Values are deliberately **not** recorded here (Step 3 handles the transfer). These are the
exact key sets read live from Render on 2026-09-22.

### 5.1 API — 61 variables

```
AI_WEBHOOK_SECRET              ETSY_SHOTS_MODEL              REPLICATE_PRODUCT_MODEL_ID
ALLOWED_ORIGINS                ETSY_TAXONOMY_MAP             REPLICATE_REMBG_MODEL_ID
API_ORIGIN                     FRONTEND_URL                  REPLICATE_TRYON_MODEL_ID
APP_ORIGIN                     GCS_BUCKET_NAME               RESEND_API_KEY
ASSET_BUCKET                   GCS_CREDENTIALS               RESEND_WEBHOOK_SECRET
BREVO_API_KEY                  GCS_PROJECT_ID                SERPAPI_API_KEY
BREVO_SENDER_EMAIL             GOOGLE_API_KEY                SHIPPO_API_TOKEN
BREVO_SENDER_NAME              GOOGLE_MAPS_API_KEY           STOREFRONT_API_KEY
DATABASE_URL                   HF_TOKEN                      STOREFRONT_BACK_PRINT_UPCHARGE_USD
DESIGN_AGENT_TOKEN             JWT_SECRET                    STOREFRONT_BASE_COST_USD
EMAIL_DOMAIN                   NODE_ENV                      STOREFRONT_CREATOR_KEYS
ETSY_APPROVER_EMAIL            OPENAI_API_KEY                STRIPE_PUBLISHABLE_KEY
ETSY_ENABLED                   OPENROUTER_API_KEY            STRIPE_SECRET_KEY
ETSY_KEYSTRING                 ORDER_STATUS_TOKEN_SECRET     STRIPE_WEBHOOK_SECRET
ETSY_READINESS_STATE_ID        PORT                          SUPABASE_ANON_KEY
ETSY_REDIRECT_URI              PRINT_BRIDGE_TOKEN            SUPABASE_JWT_SECRET
ETSY_RETURN_POLICY_ID          PRINT_WORKER_EMAILS           SUPABASE_SERVICE_ROLE_KEY
ETSY_SHARED_SECRET             PUBLIC_URL                    SUPABASE_URL
ETSY_SHIPPING_PROFILE_ID       REMOVEBG_API_KEY              TRIPO_API_KEY
                               REPLICATE_API_TOKEN           TRUST_PROXY_HOPS
                                                             WATCHTOWER_INTERNAL_SECRET
                                                             XAI_API_KEY
```

### 5.2 Worker — 50 variables

The worker set is the API set **minus these 11**:

```
PRINT_BRIDGE_TOKEN      STOREFRONT_API_KEY                   SUPABASE_JWT_SECRET
PRINT_WORKER_EMAILS     STOREFRONT_BACK_PRINT_UPCHARGE_USD   TRUST_PROXY_HOPS
RESEND_WEBHOOK_SECRET   STOREFRONT_BASE_COST_USD             WATCHTOWER_INTERNAL_SECRET
                        STOREFRONT_CREATOR_KEYS              XAI_API_KEY
```

`61 − 11 = 50`. ✅

### 5.3 Non-secret values, recorded because they must be reproduced exactly

| Key | API | Worker |
|---|---|---|
| `PORT` | `10000` | `10000` (unused — no listener) |
| `NODE_ENV` | `production` | `production` |
| `TRUST_PROXY_HOPS` | `2` | *(unset)* |
| `ALLOWED_ORIGINS` | `https://imaginethisprinted.com,https://www.imaginethisprinted.com` | same |
| `API_ORIGIN` / `PUBLIC_URL` | `https://api.imaginethisprinted.com` | same |
| `APP_ORIGIN` / `FRONTEND_URL` | `https://imaginethisprinted.com` | same |
| `ETSY_ENABLED` | `true` | `true` |
| `ASSET_BUCKET` | `products` | `products` |
| `GCS_BUCKET_NAME` | `imagine-this-printed-main` | `imagine-this-printed-main` |
| `GCS_CREDENTIALS` | 2418-char inline JSON service-account key | identical |

`TRUST_PROXY_HOPS=2` is calibrated for the **Cloudflare + Render** hop count. Fly is a
different edge topology; see §6.6 — this value is *not* portable as-is.

`GCS_CREDENTIALS` being a 2.4 KB inline JSON blob matters operationally: it must go in via
`fly secrets set` from a file or stdin, not typed on a command line.

### 5.4 Variables the code reads that are **not** set on Render

Not a migration blocker — recording them so nobody "fixes" them mid-cutover and changes
behaviour:

* `FASHN_API_KEY` — virtual try-on stays dark without it (known; approval `303ab404`).
* `MERCH_WEBHOOK_SECRET` — open board item `4a43156f`.
* `XAI_API_KEY`, `WATCHTOWER_INTERNAL_SECRET` — present on the **API**, absent on the
  **worker**. If any worker-side code path ever needs them, it is failing silently today
  and will fail identically on Fly. Reproduce the asymmetry; don't repair it here.

---

## 6. Render behaviours with no direct Fly equivalent

### 6.1 Git-push auto-deploy — **the biggest gap**
Render watches `ItMoney22/imagine-this-printed@main` and redeploys both services on every
commit (`autoDeploy: yes`, `autoDeployTrigger: commit`). Fly has **no** built-in Git
integration. `CLAUDE.md` rule 4 states *"A push to `main` IS a production deploy"* — that
rule becomes **false** the moment traffic moves, unless a GitHub Action
(`superfly/flyctl-actions/setup-flyctl` + `flyctl deploy`) is added in Step 2/3 with
`FLY_API_TOKEN` as a repo secret. If this is skipped, pushes to `main` will appear to
deploy and silently do nothing — the exact failure mode `CLAUDE.md` rule 4 was written
to prevent.

### 6.2 Native Node buildpack + `rootDir` → needs a Dockerfile
Render builds with its own Node buildpack, scoped by `rootDir: backend`. There is **no
Dockerfile, no `.dockerignore`, no `render.yaml`, and no `fly.toml`** anywhere in the repo
(`railway.backend.toml` exists but is a dead NIXPACKS leftover from an abandoned Railway
attempt — it is not what production uses). Step 2 has to author a Dockerfile from scratch
that reproduces:
`WORKDIR /app` ← `backend/` · `npm ci --include=dev` · `npx prisma generate` ·
`npm run build` (`tsc`) · then `node dist/index.js` or `node dist/worker/index.js`.
`--include=dev` is required because the build needs `typescript`.

**Verified:** `npx prisma generate` runs fine with `DATABASE_URL` unset, so no build-time
secret is needed. That matters because **Fly secrets are runtime-only and are not
available during `fly deploy`'s image build**, whereas Render's env vars *are* available
at build time. This repo happens not to depend on that — confirm it stays true if the
build command ever changes.

### 6.3 Health-gated zero-downtime deploys
Render will not shift traffic to a new instance until `/api/health` returns healthy. Fly
*can* do the same, but only if the check is declared explicitly in `fly.toml`
(`[[http_service.checks]]`) — it is not a default. Staged in `backend/fly.api.toml`.

### 6.4 Background-worker restart-on-crash
`backend/worker/index.ts` deliberately exits non-zero on an unhandled rejection and relies
on the platform to restart it — and its own comment flags that this was never verified for
Render. On Fly this is explicit: pin `[[restart]] policy = "always"`. Staged in
`backend/fly.worker.toml`. Do not leave it to the default.

### 6.5 Miscellaneous, all low-risk
| Render feature | Fly equivalent |
|---|---|
| `ipAllowList: 0.0.0.0/0` | No per-app allow list. Currently open → no-op. |
| `maintenanceMode` | None. Would need an app-level flag or Cloudflare rule. |
| `*.onrender.com` free hostname | `*.fly.dev` — use for Step 4 smoke-testing before DNS moves. |
| `sshAddress` (`ssh.oregon.render.com`) | `fly ssh console -a <app>`. |
| `numInstances: 1` | `min_machines_running = 1` + `auto_stop_machines = false`. |
| `cache.profile: no-cache` (API) | Fly's remote Docker builder caches by layer; use `--no-cache` if a clean build is ever needed. |
| Persistent disks | None in use — nothing to migrate. Both services are stateless. |

### 6.6 `TRUST_PROXY_HOPS` must be re-derived, not copied
`backend/index.ts` sets `app.set('trust proxy', 2)` and its comment attributes the 2 to a
**Cloudflare → Render** chain. **Live DNS says that is not the current topology:**
`api.imaginethisprinted.com` is `proxied: false`, so no Cloudflare edge sits in front of
the API at all (§2.1). The 2 is counting Render's own proxy layers.

So the value is not portable and cannot be reasoned about from the comment. Fly's proxy is
a different chain and is most likely **1** hop. Getting it wrong silently breaks `req.ip`,
which feeds `express-rate-limit`: too high and every client collapses into one bucket, so
a single abuser rate-limits the whole storefront; too low and the limiter keys on the edge
address instead of the client.

**Step 4 must measure it, not guess it.** `backend/scripts/verify-security-middleware.ts`
already asserts the correct behaviour — run it against the `*.fly.dev` hostname before
DNS moves, and set `TRUST_PROXY_HOPS` on Fly from that result. This is why the variable is
deliberately left out of `backend/fly.api.toml`.

---

## 7. Risks found during the audit (not caused by it)

### 7.1 Production is 31 commits behind local `main`
Render runs `91811ccb` (2026-09-11). Local `main` is at `861afd6` with **31 commits**
ahead, none pushed. `fly deploy` builds from the **working tree**, not from GitHub — so
unless the deploy is pinned to `91811ccb`, Step 5 would ship a quarter's worth of
unreleased work at the exact moment production traffic moves hosts. Two failure domains
at once is the opposite of a zero-downtime migration.

**Recommendation:** deploy Fly from `91811ccb` so the cutover is provably hosting-only
(byte-identical application, different host). Push `main` as a *separate, later* event
once Fly is stable. This needs a decision before Step 5 — filed as a follow-up.

### 7.2 The API does not drain connections on SIGTERM
```js
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0) })
```
No `server.close()`, no drain window. Every in-flight HTTP request is severed the instant
the platform signals shutdown. Today Render's health-gated rolling deploy masks this.
Fly sends SIGTERM and waits only `kill_timeout` before SIGKILL — with an immediate
`exit(0)` the process leaves *earlier* than it has to. For a migration whose headline rule
is "nothing goes dark for a single request", this should be fixed in Step 2:
`server.close(() => prisma.$disconnect().then(() => process.exit(0)))`, with
`kill_timeout = 30` in `fly.toml` (already staged).

### 7.3 `dotenv.config({ override: true })` will shadow Fly secrets
`backend/load-env.ts` runs first in **both** entry points and calls
`dotenv.config({ override: true })` — a `.env` file beats real environment variables. On
Render this is inert: `.env` is gitignored and never lands in the build. On Fly, if a
`.env` ever gets copied into the Docker image, it silently overrides every `fly secret`
with stale values and *nothing logs it*. This has bitten this project before (memory:
"ITP supabase key env shadowing"). **Step 2's `.dockerignore` must exclude `.env*`** —
treat it as a required line, not a nicety.

### 7.4 `app.listen(PORT)` binds without an explicit host
Node defaults to all interfaces, so this works on Fly's IPv6-first internal network — but
it is implicit. If anything ever narrows it to `127.0.0.1`, the Fly health check fails with
no obvious cause. Worth an explicit `'0.0.0.0'` while Step 2 is in the file anyway.

---

## 8. What was provisioned in this step

Two Fly apps created in the `personal` org (`David Trinidad (DMoneyGMG)`), both idle:

| App | Purpose | Machines | IPs | Secrets | Cost |
|---|---|---|---|---|---|
| `imagine-this-printed-api` | replaces the Render web service | **0** | **0** | **0** | **$0** |
| `imagine-this-printed-worker` | replaces the Render background worker | **0** | **0** | **0** | **$0** |

Verified immediately after creation:

```
$ flyctl apps list
 imagine-this-printed-api    │ personal │ pending │
 imagine-this-printed-worker │ personal │ pending │

$ flyctl machines list -a imagine-this-printed-api      → No machines are available
$ flyctl machines list -a imagine-this-printed-worker   → No machines are available
$ flyctl ips list      -a <both>                        → (empty)
$ flyctl secrets list  -a <both>                        → (empty)
```

A Fly app with no machines runs nothing, is billed nothing, and has no address that could
receive traffic. Status `pending` is the correct and expected state for an app that has
never been deployed. The pre-existing `darrell-voice-bridge` app was not touched.

Region is staged in the committed manifests rather than on the app object — Fly apps have
no region of their own, only machines do:

* `backend/fly.api.toml` — `primary_region = "ord"`
* `backend/fly.worker.toml` — `primary_region = "ord"`

Both are annotated as **staged, not deployed**.

---

## 9. Cold-rebuild recipe

If both Render services vanished tomorrow, this reproduces them exactly:

1. New Render **Web Service** from `ItMoney22/imagine-this-printed`, branch `main`,
   root dir `backend`, runtime Node, region `oregon`, plan Starter, 1 instance.
   Build: `npm ci --include=dev && npx prisma generate && npm run build`.
   Start: `node dist/index.js`. Health check: `/api/health`. Build cache: no-cache.
   Auto-deploy on commit. Add all 61 variables from §5.1 (§5.3 gives the non-secret values;
   secrets come from `C:\Users\David\.secrets\keys.json` and the Supabase/Stripe dashboards).
   Add custom domain `api.imaginethisprinted.com` and point the CNAME at the new
   `*.onrender.com` host.
2. New Render **Background Worker**, same repo/branch/root/region/plan/build command.
   Start: `npm run start:worker`. No health check, no domain.
   Add the 50 variables from §5.2.
3. No disks, no env groups, no cron jobs to recreate.
4. Verify: `/api/health` → `{"ok":true}`; `/api/health/worker` → `alive` (allow up to 1 h
   for the first hourly heartbeat).

---

## 10. Acceptance criteria — status

| Criterion | Status | Evidence |
|---|---|---|
| Full Render inventory documented, sufficient for cold rebuild | ✅ | §1–§5, recipe in §9; read live from the Render API, not from prior docs |
| Both Fly apps provisioned in the correct target region | ✅ | §8 — apps created, `primary_region = "ord"` staged in both manifests; region justified by evidence in §3 |
| Render services and DNS completely untouched and active | ✅ | §2 — only `GET` calls were made to the Render API and only a record *read* against Cloudflare; `/api/health` 200, worker heartbeat current, CNAME unchanged, both deploys still `live` |
| No production traffic routed to Fly | ✅ | §8 — zero machines, zero IPs, zero secrets on both apps |
| Worker jobs and entry points fully audited | ✅ | §4 — all 7 found, including the nested one `index.ts` does not show |
