# Step 5/6 — api.imaginethisprinted.com: Render → Fly cutover + rollback

Watchtower task `13e1c509` · umbrella `291fcf82` · go-live approval `2f38cf1a` (renewal of `1b935741`)
Author: dominic-vane, 2026-09-23

## State as of 2026-09-23 ~13:10 UTC

| Item | Value | How it was checked |
|---|---|---|
| Cloudflare record | `74b5eb9b47e763da941199bfcc7e0941` CNAME `api` → `imagine-this-printed-backend.onrender.com` | CF API |
| Proxy status | **DNS-only (grey cloud)**, `proxied:false` | CF API |
| TTL | **60 s** (lowered from 300 today) | CF API |
| Fly cert | `api.imaginethisprinted.com` **Issued**, RSA + ECDSA, Let's Encrypt, expires 2026-12-21 | `fly certs show`, `openssl s_client` on 66.241.124.149 |
| ACME renewal record | `_acme-challenge.api` CNAME → `api.imaginethisprinted.com.w0wx028.flydns.net` (DNS-01, keep forever) | CF API |
| Fly API commit | **576b362**, the same commit Render's live deploy is on (`GIT_COMMIT` env on the machines) | Render deploys API + `printenv` on the Fly machine |
| Fly API machines | 2 × shared-cpu-1x/512 MB in `ord`, both passing the `/api/health` check, bluegreen deploys | `fly status` |
| Secrets parity | 57/57 byte-identical on both machines; every credential authenticates | `scripts/fly/fly-env-probe.mjs` run inside each machine |
| HTTP parity | 13/13 identical (status + security/CORS headers + DB body) | `scripts/fly/cutover-parity.sh` |
| Worker | Stays on **Render**. The Fly worker machines stay stopped. Moving it is Step 6 (`c92b86ed`). | `fly status -a imagine-this-printed-worker` |

## Deliverable 1 — Proxy status vs TRUST_PROXY_HOPS

The record is **grey-cloud**, so the Fly chain is client → Fly edge → app. Fly's edge
appends the client IP **and its own ingress IP** to `X-Forwarded-For`, so Express needs
**2** trusted hops. This was measured on the live Fly app, not taken from a config comment:

```
GET /api/health/ip                        -> ip 68.184.130.112 (the real caller), XFF "68.184.130.112, 66.241.124.149"
GET /api/health/ip  X-Forwarded-For: 6.6.6.6 -> ip 68.184.130.112, forged 6.6.6.6 ignored
```

`TRUST_PROXY_HOPS=2` is the Fly **secret**, which overrides `[env]`. The `1` and the
"one hop" comment in the landing-chain `backend/fly.api.toml` (982b0d5) are wrong. The
cutover toml in `deploy/fly-cutover/fly.api.toml` says `2`.
**Never orange-cloud this record.** Proxying adds a Cloudflare hop, and 2 would then
key the rate limiter on Cloudflare's IP.

## Why Fly was redeployed today (hosting-only move)

Earlier today (Step 4, deployment `01M371HQ…`) the Fly API was running the unmerged
landing chain `554b32a`, which is not what production serves. Approval `1b935741` option A requires
Fly to serve the **same app bytes** as Render. `origin/main` has no Dockerfile, and
the landing-chain Dockerfile needs `copy-assets.mjs` + bundled fonts that `main` lacks.
So `deploy/fly-cutover/Dockerfile.render-parity` reproduces Render's native
build literally: `npm ci --include=dev → prisma generate → npm run build → node dist/index.js`.
The build context is `git archive <commit> backend`.

`deploy/fly-cutover/deploy-api.sh` with no argument asks Render which commit is live and
deploys exactly that one. **Main moves fast.** Render went from 8ccedd0 to 576b362 in the middle of
my first deploy. Always re-run it right before the flip.

The API process has **no timers** (`setInterval` lives only under `backend/worker/`),
so Render and Fly serving the API at the same time is safe. Nothing double-fires.

## Cutover — run in order (≈10 min, no downtime)

Prereqs, from the vault: `FLY_API_TOKEN` = `fly.FLY_API_TOKEN`, `RENDER_API_KEY` = `render.RENDER_API_KEY`.

1. **Re-pin Fly to Render's live commit**
   `bash deploy/fly-cutover/deploy-api.sh`, then wait for "Deployment Complete". Both green machines must pass.
2. **Re-prove secrets.** Render keys rotate without notice.
   `node scripts/fly/render-env-hashes.mjs <scratch>`, then run `scripts/fly/fly-env-probe.mjs <scratch>/expected-api.json`
   inside each `fly machines list -a imagine-this-printed-api` machine (base64 in via `fly ssh console`,
   see `docs/FLY_SECRETS_PARITY.md` on f232c2e). Every line must be PASS.
3. **Re-prove HTTP parity:** `bash scripts/fly/cutover-parity.sh` → `PARITY OK`.
4. **Baseline Stripe:** note `pending_webhooks` on the most recent events (should be 0).
5. **Flip:** `bash scripts/fly/dns-point.sh fly`. It exits 0 once Cloudflare's
   authoritative nameserver answers `w0wx028.imagine-this-printed-api.fly.dev`.
6. **Watch 15 min:**
   - `bash scripts/fly/cutover-parity.sh live` shows `live /api/health 200 via fly-request-id` once caches expire (≤60 s + resolver slop).
   - `fly logs -a imagine-this-printed-api` shows real storefront traffic arriving from both origins.
   - Load https://www.imaginethisprinted.com: catalog, product page, cart, and checkout up to the Stripe step. Zero CORS/TLS errors in the console.
   - Stripe: newest events show `pending_webhooks: 0`, and a new webhook delivery lands on Fly (`fly logs | grep stripe`).
   - Render keeps getting a trickle from stale resolvers. That is expected, and it is why Render stays up.

## ROLLBACK — under 5 minutes, one command

Trigger it on any of: storefront CORS/TLS errors, 5xx rate above Render's baseline, Stripe `pending_webhooks > 0`
climbing, or checkout failures.

```bash
bash scripts/fly/dns-point.sh render     # ~1.5 s to apply at Cloudflare's authoritative NS (rehearsed 2026-09-23)
bash scripts/fly/cutover-parity.sh live  # confirm "via rndr-id" on /api/health
```

Why it is fast:
- **TTL is 60 s**, so resolvers drop the Fly answer within about a minute.
- **Render is never stopped during Step 5.** Both Render services stay `not_suspended` on the same commit, so nothing needs to warm up.
- The PATCH was **rehearsed live** today: `dns-point.sh render` against the current record returned in 1.4 s, and the authoritative NS confirmed.
- No data migration is involved: both hosts use the same Supabase, Stripe and GCS. Anything written while traffic was on Fly is already in the shared stores.

If the vault CF token is ever dead, do it by hand in the Cloudflare dashboard: imaginethisprinted.com → DNS →
`api` CNAME → content `imagine-this-printed-backend.onrender.com`, **proxy OFF**, TTL 1 min → Save.

After a rollback, stripe will retry any webhook that failed on Fly (for up to 3 days). Check
`pending_webhooks` returns to 0 within an hour.

## What Step 5 deliberately does NOT do

- It does not move the worker (Step 6, `c92b86ed`). Starting the Fly worker next to Render's would double-run the
  Mrs. Imagine scout, which is a read-then-act race.
- It does not suspend or cancel Render. Render is the rollback target until Step 6 signs off.
- It does not turn on `FLY_DEPLOY_ENABLED`. Until the push-to-deploy workflow (`6bec6d3b`) is proven, **a push to main
  deploys to Render only**. After the flip, re-run `deploy-api.sh` after every main push, or Fly drifts behind.
  This is the biggest operational risk between Step 5 and Step 6.

## Files

- `deploy/fly-cutover/Dockerfile.render-parity`: Render-literal build
- `deploy/fly-cutover/.dockerignore`: excludes only secrets, build output and VCS
- `deploy/fly-cutover/fly.api.toml`: landing-chain toml with the corrected `TRUST_PROXY_HOPS=2`, pointed at the parity Dockerfile
- `deploy/fly-cutover/deploy-api.sh`: deploys Fly API from Render's live commit
- `scripts/fly/cutover-parity.sh`: Render vs Fly HTTP parity + live DNS check
- `scripts/fly/dns-point.sh`: cutover / rollback, a single Cloudflare PATCH with authoritative verification
- `scripts/fly/render-env-hashes.mjs`, `scripts/fly/fly-env-probe.mjs`: secrets parity (from f232c2e)
