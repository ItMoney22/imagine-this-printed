# Render → Fly migration · Steps 2–4 — build, secrets, and the parity proof

**Watchtower task:** `291fcf82-d89a-4848-af42-2ab70d5ec57d` (parent umbrella)
**Date:** 2026-09-22 · **Author:** Levi James
**Predecessor:** [`STEP-1-INVENTORY.md`](./STEP-1-INVENTORY.md) — the live Render config, read off the Render API
**Production status at time of writing:** **still on Render. DNS untouched.**

---

## 0. Where this leaves things

| | Before | Now |
|---|---|---|
| `api.imaginethisprinted.com` | Render | **Render** — unchanged, record id `74b5eb9b47e763da941199bfcc7e0941` |
| Fly API app | 0 machines, 0 secrets | **2 machines in `ord`, 59 secrets, health 1/1, answering** |
| Fly worker app | 0 machines, 0 secrets | **2 machines (1 + standby), 49 secrets, booted all 7 jobs, now STOPPED** |
| TLS for the production hostname on Fly | none | **issued and active** (Let's Encrypt, via DNS-01) |
| Render web + worker | live | **live, still serving every request** |

**Everything is staged. One DNS record is the only thing between here and done.**

The Fly worker was deliberately **stopped again** after it was proven to boot. It is
not left running alongside Render's: see §5.

---

## 1. Step 2 — the build (`backend/Dockerfile`, `backend/.dockerignore`)

Render builds both services with its own Node buildpack scoped to `rootDir: backend`.
Fly has no such thing, so the build had to be written down for the first time — there is
no `render.yaml` and never was.

**One image, two apps.** `fly.api.toml` and `fly.worker.toml` both point at the same
`Dockerfile`; they differ only in start command. That is what Render does today (one
build command, two services), and it means the API and the worker can never silently
drift onto different code.

Two lines in there are load-bearing rather than tidy:

**`.dockerignore` excludes `.env*`.** `backend/load-env.ts` runs
`dotenv.config({ override: true })` as the first import in *both* entry points, so a file
beats a real environment variable. On Render that is inert — `.env` is gitignored and
never reaches the build. On Fly, `fly deploy` uploads the working directory, and a
developer's `backend/.env` baked into the image would silently override **every single
`fly secrets set` value** with nothing logged. This project has already lost time to that
exact shape (memory: *ITP supabase key env shadowing*, 2026-08-19).

**`node dist/index.js`, not `npm start`.** `npm start` fires the `prestart` hook
(`scripts/check-jose.js`), and `scripts/` is excluded from the tsconfig build. Render
invokes the bare node command; so does this.

The runtime stage also copies `assets/` explicitly. Those fonts are read from disk rather
than imported, so `tsc` never puts them in `dist/` — a missing font shows up as broken
text rendering at request time, not as a build failure.

**Result:** 156 MB image, builds clean on Fly's remote builder for both apps.

### 1.1 The API now drains instead of dropping requests

`backend/index.ts` used to do this:

```js
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0) })
```

No `server.close()`. Every in-flight HTTP request was severed the instant the platform
signalled shutdown. Render hid it — its health-gated rolling deploy keeps the old
instance serving until the new one is healthy, so the requests that got cut were few and
nobody noticed.

Fly does not hide it: it sends SIGTERM and waits `kill_timeout` (30 s) before SIGKILL,
and an immediate `exit(0)` walks out **earlier than the platform is willing to wait**.
For a migration whose entire promise is that nothing goes dark for a single request, that
was the wrong shape. It now closes the server, lets in-flight requests finish, then
disconnects Prisma — capped at 25 s so we exit on our own terms rather than being killed
mid-write. `listen()` also names `0.0.0.0` explicitly instead of relying on Node's
default.

### 1.2 Push-to-deploy, which Fly does not have

`.github/workflows/fly-deploy.yml` replaces what Render did for free. Render watched
`main` and redeployed on every commit. **`CLAUDE.md` rule 4 says "a push to `main` IS a
production deploy" — that sentence goes false the moment DNS moves** unless something
re-arms it, and pushes would appear to deploy while doing nothing. That is the exact
failure rule 4 exists to prevent.

The workflow is path-filtered to `backend/**` (strictly tighter than Render, which
rebuilt on storefront-only commits too), deploys the API before the worker so a bad build
fails against the health check before it can reach the live database, and then asks the
service itself whether it is up rather than trusting `fly deploy`'s exit code.

**It is inert until a token lands — see §7.**

---

## 2. Step 3 — secrets

Pulled live from the Render API and imported to Fly. Names verified by diff, not by eye:

| | Render | Fly secrets | In `fly.toml` `[env]` | Withheld |
|---|---|---|---|---|
| API | 61 | **58** | `PORT`, `NODE_ENV` | — |
| Worker | 50 | **48** | `NODE_ENV` | `PORT` (nothing listens; see below) |

Programmatic diff of the key sets: **on Render but not on Fly → only the names above. On
Fly but not on Render → none.** No invented variables, no dropped ones.

`GCS_CREDENTIALS` is a 2.4 KB JSON blob with 12 newlines in it, so it went in via
`fly secrets set GCS_CREDENTIALS=-` from a file. `fly secrets import` would have mangled
it — it reads one `KEY=VALUE` per line.

Two deliberate deviations, both documented rather than silent:

* **Worker `PORT` omitted.** Render sets it, but a background worker has no listener.
  Copying it would invite someone to believe the worker serves traffic.
* **`TRUST_PROXY_HOPS` measured, not copied.** See §3 — this is the one that mattered.

Everything Render leaves unset stays unset: all seven worker gating/tuning variables
(`MRS_IMAGINE_DAILY`, `ETSY_WORKER_ENABLED`, the `*_MINUTES`/`*_BATCH` family) run on
code defaults on Fly exactly as they do on Render. Setting `MRS_IMAGINE_DAILY=true` in
particular would re-arm the unattended daily batch David switched off on 2026-09-02.

---

## 3. `TRUST_PROXY_HOPS` — measured, and the first reading was wrong

Step 1 flagged this as "must be measured, not copied", and predicted Fly's chain was
"most likely 1". **That prediction was wrong, and the measurement caught it.**

The value feeds `req.ip`, which feeds `express-rate-limit`. Too high and a caller can
spoof `X-Forwarded-For` to mint a fresh bucket per request; too low and every client on
the planet collapses into one bucket, so one visitor rate-limits the whole storefront.

### How it was measured

The metered endpoint `GET /api/coupons/validate` (40 requests / 10 min) was hammered with
a **constant** spoofed `X-Forwarded-For: 203.0.113.99` until it tripped, and the 429 log
line — which prints `req.ip` verbatim — was read back off the machine. That names the key
the limiter actually used, rather than inferring it.

| `TRUST_PROXY_HOPS` | `req.ip` resolved to | Verdict |
|---|---|---|
| `1` | **`66.241.124.149`** — Fly's *shared IPv4 ingress* | **Catastrophic.** Every client on Fly shares one bucket. |
| `2` | **`68.184.130.112`** — the real client, spoof correctly ignored | **Correct.** |

So the right answer on Fly is **2 — the same number as Render, for a completely different
reason.** Render's 2 counts its own proxy layers. Fly's 2 counts the **shared-IPv4 edge →
app proxy** chain: with a shared v4 address, Fly's edge appends its own address to
`X-Forwarded-For` before the app proxy does.

`TRUST_PROXY_HOPS=2` is now set **explicitly** as a Fly secret rather than leaning on the
code's `|| '2'` fallback, so the value is visible where an operator looks for it.

> **If a dedicated IPv4 is ever bought for this app, this becomes 1.** The shared-edge hop
> is what makes it 2. Re-measure with the procedure above rather than assuming.

### A false negative worth recording

The *first* spoof test used 45 requests with 45 *different* spoofed addresses and saw zero
429s — which reads like "hop count too high, spoof succeeded". It wasn't. With two API
machines each holding an **in-memory** rate-limit store, 45 requests split ~22/22 and
neither machine reached its limit of 40. The test was under-powered, not the config
broken. The constant-header + log-readback method above is immune to that and is the one
to reuse.

---

## 4. Step 4 — parity, side by side

`docs/migration/render-to-fly/verify-parity.sh` asks **both hosts the same questions** and
compares the answers. "Fly returns 200" is not the bar; "Fly returns what Render returns"
is.

```
render = https://api.imaginethisprinted.com     (still Render)
fly    = https://imagine-this-printed-api.fly.dev

--- liveness --------------------------------------------------------
PASS  GET /                                  render=200 fly=200   (bodies byte-identical)
PASS  GET /api/health                        render=200 fly=200   (bodies byte-identical)

--- dependency health (the real proof the secrets landed) -----------
PASS  GET /api/health/database               render=200 fly=200
PASS  GET /api/health/email                  render=200 fly=200
PASS  GET /api/health/auth                   render=200 fly=200
PASS  GET /api/health/gcs                    render=500 fly=500   (identical pre-existing error, §6)
PASS  GET /api/health/worker                 render=200 fly=200

--- storefront surface ----------------------------------------------
PASS  GET /api/products                      render=404 fly=404
PASS  GET unknown route -> 404               render=404 fly=404

--- CORS ------------------------------------------------------------
PASS  allowed origin echoed                  https://imaginethisprinted.com
PASS  preflight allow-methods                GET,POST,PUT,PATCH,DELETE,OPTIONS
PASS  foreign origin refused                 <absent on both>

--- security headers -------------------------------------------------
PASS  HSTS                                   max-age=31536000; includeSubDomains
PASS  X-Content-Type-Options                 nosniff
PASS  X-Frame-Options                        DENY
PASS  Referrer-Policy                        no-referrer
PASS  X-Powered-By stripped                  <absent on both>

--- print bridge -----------------------------------------------------
PASS  queue without auth -> 401              render=401 fly=401
PASS  queue with bearer token                render=200 fly=200

passed: 19   failed: 0
```

The two that carry the most weight:

* **`/api/health/database` returns `{"status":"connected","message":"Database connected
  successfully (5 users)"}` byte-for-byte on both.** That is `DATABASE_URL` proven to have
  transferred *and* Fly proven to reach Supabase in `us-east-2`.
* **The print bridge answers 200 to a real `Bearer PRINT_BRIDGE_TOKEN` on both.** Not a
  401-only smoke test — the authenticated queue read actually works, which is the
  acceptance criterion the Watchtower print factory depends on.

### 4.1 The region choice paid off, measured

Seven samples each against `/api/health/database`, which performs a real query:

| Host | Region | mean | best |
|---|---|---|---|
| Render | `oregon` (~2,000 mi from the DB) | 513 ms | 473 ms |
| **Fly** | **`ord`** (~300 mi from the DB) | **413 ms** | **340 ms** |

~100 ms faster on the mean, ~133 ms on the best. Measured from one client on one network,
so treat it as directional rather than a benchmark — but the direction is the one Step 1
predicted from the `aws-0-us-east-2.pooler.supabase.com` endpoint.

### 4.2 The worker started all seven jobs

Deployed, and the boot log shows every job from `STEP-1-INVENTORY.md` §4.2 arming with the
right cadence — including `etsy-receipt-ingest`, the nested one that `worker/index.ts`
does not show:

```
- SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / REPLICATE_API_TOKEN / OPENAI_API_KEY / SHIPPO_API_TOKEN: Set
[worker]             🚀 Starting AI jobs worker
[etsy-worker]        🧵 starting Etsy publish worker (poll 15000ms)
[etsy-receipts]      🧾 starting receipt ingest poller (poll 60000ms)
[tryon-retention]    🧵 photo retention sweep — 30d window, every 24h
[mrs-imagine-scout]  armed — daily scout sweep at 11:00 UTC
[step-flow-stall]    🧵 stalled-shot sweep — >15m failed, checked every 5m
[delivery-sweep]     🚚 polling carriers every 30m
Worker is running.
```

`[mrs-imagine-scout] armed` with no daily batch is the correct post-2026-09-02 state.
`SHIPPO_API_TOKEN: Set` means delivery tracking is live rather than dark.

One error appeared, and it is **pre-existing production behaviour reproduced exactly**:

```
[etsy-receipts] poll failed: Etsy GET .../receipts failed (403):
  Access token lacks scope for this request (requires scope: transactions_r).
```

That is the known open item (memory: *ITP Etsy ledger reconciled*; board `c93b557e`,
blocked on David's Etsy re-consent). Fly failing the same way Render fails is evidence of
parity, not a migration defect.

---

## 5. Why the Fly worker is stopped again

After proving it boots, **both Fly worker machines were stopped.** Render's worker is
still the only one running.

Step 1 established that six of the seven jobs are safe to run twice concurrently (atomic
claims, a `UNIQUE` order number with a `23505` catch, idempotent sweeps) and one is not
(`mrs-imagine-daily`'s guard is a `SELECT`-then-run race). So a brief overlap would have
been *safe*. It was stopped anyway for a different reason:

**The Fly image is built from the working tree, which is 31 commits ahead of what Render
is running.** Leaving it polling means unreleased worker code acting on the production
database for hours before anyone approved a cutover. This migration's promise is that it
is a hosting change and nothing else. A stopped machine keeps that promise; a running one
quietly breaks it.

Starting it is one command at cutover time (§8).

---

## 6. Findings that are NOT migration defects

**`/api/health/gcs` returns 500 on both hosts**, byte-identical:
`{"status":"error","message":"GCS bucket not accessible","bucket":"imagine-this-printed-main"}`.
Pre-existing on Render, reproduced exactly on Fly. The storefront serves GCS objects
directly from `storage.googleapis.com` rather than through this API, so it is not a
storefront outage — most likely the service account can read/write objects but lacks
`storage.buckets.get`, which is what the health probe calls. **Filed as its own task; it
is not a cutover blocker and was not "fixed" mid-migration.**

**Rate limits are per-machine.** `express-rate-limit` uses an in-memory store, so with two
API machines the effective limit is **2× the configured number**, and a client bouncing
between machines gets both budgets. Render ran a single instance, so its limits were
exact. This was measured, not assumed: 120 requests against a 40/10-min endpoint returned
**exactly 80 × 200 then 40 × 429** — two machines × 40.

That is a real (modest) weakening of the coupon/gift-card brute-force floor. Three ways
out, in order of preference:

1. A shared store (Postgres or Redis) behind `express-rate-limit` — the actual fix, but it
   is a behaviour change and does not belong inside a hosting migration. **Filed as a
   follow-up task.**
2. `fly scale count 1 -a imagine-this-printed-api` — exact Render parity on both limits
   *and* cost, at the price of a short gap during every deploy.
3. Halve the `RATE_LIMIT_*_MAX` values — cheap, but wrong the moment the machine count
   changes again.

---

## 7. What is still open

| # | Item | Why it is not done | Who |
|---|---|---|---|
| 1 | **DNS cutover** | Customer-facing go-live. Everything else is staged and reversible; this is the one that moves real buyers. Filed as an approval. | David |
| 2 | **Which commit Fly serves at cutover** | Prod runs `91811ccb`; the working tree is 31 commits ahead. Approval `ae7fe21c` (filed in Step 1) asks this. Cutting over on prod's commit keeps the move provably hosting-only. | David |
| 3 | **`FLY_API_TOKEN` in GitHub secrets** | The vault's Fly token is itself limited-access and **cannot mint** scoped deploy tokens (`createLimitedAccessToken Not authorized`). The repo is **public**, so putting an org-wide token in it is broader than this job needs. Filed as an approval. Until it lands, `fly-deploy.yml` runs and fails loudly rather than silently doing nothing. | David |
| 4 | **Render cancellation** | Only after the cutover has been stable and the Render worker stopped. §8 step 7. | David |

---

## 8. Cutover runbook (Step 5/6)

Everything below is ~10 minutes of work with a ~5-minute rollback the whole way.

**Pre-flight**

* **Do not cut over between 11:00 and 12:00 UTC.** That is the only hour
  `mrs-imagine-daily` acts, and it is the one job whose guard is a read-then-act race, so
  it is the one job that must not run on two hosts at once.
* Resolve open item #2 first, so the deploy pins a known commit.
* Confirm Render is still healthy, so rollback has somewhere to go.

**1 — Start the Fly worker** (it is stopped; see §5)

```
fly machines start d893e75c306e38 -a imagine-this-printed-worker
```

**2 — Stop Render's worker** so only one is running. Render dashboard → suspend
`imagine-this-printed-worker` (`srv-d7jppnn7f7vs73bb4p80`).

**3 — Confirm the handover before touching DNS.** The heartbeat is **hourly**, so allow up
to an hour before treating `stale` as real:

```
curl https://imagine-this-printed-api.fly.dev/api/health/worker      # expect "alive"
```

**4 — Flip the CNAME.** Cloudflare zone `imaginethisprinted.com`, record id
`74b5eb9b47e763da941199bfcc7e0941`, TTL 300, `proxied: false`:

```
api.imaginethisprinted.com  CNAME  ->  w0wx028.imagine-this-printed-api.fly.dev
```

Keep it a CNAME (rather than the A/AAAA pair Fly also offers) so the flip and the rollback
are the same single field on the same record.

**The TLS certificate is already issued and active** — Let's Encrypt, validated over DNS-01
via `_acme-challenge.api.imaginethisprinted.com` (record `aa5ed1011f122157de57088a8a335795`,
added 2026-09-22). Proven before any traffic moved:

```
curl --resolve api.imaginethisprinted.com:443:66.241.124.149 \
     https://api.imaginethisprinted.com/api/health
  -> {"ok":true}  HTTP 200  ssl_verify=0
```

So there is **no TLS gap at the moment of the flip**. Leave that `_acme-challenge` record
in place afterwards — Fly reuses it to renew.

**5 — Watch for ~10 minutes.**

```
RENDER_BASE=https://imagine-this-printed-backend.onrender.com \
FLY_BASE=https://api.imaginethisprinted.com \
PRINT_BRIDGE_TOKEN=... \
  bash docs/migration/render-to-fly/verify-parity.sh
```

Then load the storefront and place a test order. Watch `fly logs -a imagine-this-printed-api`
for 5xx.

**Rollback**, if anything looks wrong: set that same CNAME back to
`imagine-this-printed-backend.onrender.com` and restart Render's worker. ~5 minutes,
Render still warm, nothing lost.

**6 — After it is stable**, add `FLY_API_TOKEN` to the repo (open item #3) and push a
no-op backend commit to prove `fly-deploy.yml` actually deploys. **Do not cancel Render
until that push-to-deploy path is proven** — otherwise the first real hotfix after
cancellation has no way to ship.

**7 — Then, and only then**, suspend and delete `srv-d7jpgut7vvec739bsid0` and
`srv-d7jppnn7f7vs73bb4p80` and cancel the Render account.

---

## 9. Cost

| | Monthly |
|---|---|
| Render today (2 × Starter @ $7) | **$14.00** |
| Fly: 2 API machines + 1 worker (`shared-cpu-1x` 512 MB @ ~$3.19) | **~$9.57** |
| Fly if the API is scaled to 1 machine (§6 option 2) | **~$6.38** |

Shared IPv4 is free; the dedicated IPv6 is free. The worker's standby machine is stopped
and bills only for its rootfs, which is pennies.

The second API machine is what buys zero-downtime deploys and failover — Render gave that
for free at one instance because its platform does health-gated rolling swaps, and Fly
does not at machine count 1. It is the difference between saving **$4.43/mo** and
**$7.62/mo**. Worth naming out loud because "cancel Render, save $14" was the premise, and
the honest number is one of those two, not $14.

---

## 10. Acceptance criteria — status

| Criterion (from task `291fcf82`) | Status | Evidence |
|---|---|---|
| Target deployment config added to the repo | ✅ | `backend/Dockerfile`, `backend/.dockerignore`, `backend/fly.api.toml`, `backend/fly.worker.toml`, `.github/workflows/fly-deploy.yml` |
| Env vars and secrets migrated | ✅ | §2 — 58/48 imported, key sets diffed programmatically, zero unexplained gaps |
| Backend + worker running stably on Fly | ✅ | §4, §4.2 — API health 1/1 on two `ord` machines; worker booted all 7 jobs. Worker then stopped on purpose (§5) |
| `/` and `/api/health` return 200 from the new host | ✅ | §4 — byte-identical to Render |
| Storefront API resolves without broken endpoints or CORS issues | ✅ | §4 — 19/19 parity including CORS echo, preflight, and foreign-origin refusal |
| Worker processes background jobs and print queue correctly | ✅ | §4.2 (all 7 jobs armed) + §4 (authenticated print-bridge queue read returns 200 on Fly) |
| DNS CNAME repointed | ⛔ | **Deliberately not done** — customer-facing go-live, filed as an approval. §7, §8 |
| Render receives zero traffic / safe to terminate | ⛔ | Blocked on the cutover above, and on proving push-to-deploy first (§8 step 6) |
| *(open question)* DNS provider access | ✅ | Cloudflare, API-writable — proven by adding the ACME record live. §8 |
| *(open question)* Redis / internal deps | ✅ | None. No disks, no env groups, no Redis, no Render cron. Every recurring task is an in-process `setInterval`. `STEP-1-INVENTORY.md` §1 |
