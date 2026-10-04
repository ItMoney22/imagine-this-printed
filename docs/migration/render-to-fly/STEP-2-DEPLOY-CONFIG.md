# Render → Fly migration · Step 2/6 — deploy configuration

**Watchtower task:** `0f33268f-6582-4966-805c-6f9d83ac2246`
**Date:** 2026-09-22 · **Agent:** Levi James
**Reads on top of:** [`STEP-1-INVENTORY.md`](./STEP-1-INVENTORY.md) — the live Render
config this step reproduces. That document is still the cold-rebuild record; this one
records what was *built* from it and why each choice was made.

> **NOTHING IN THIS STEP TOUCHES PRODUCTION.** Both Fly apps still have zero machines
> and zero secrets, `api.imaginethisprinted.com` still CNAMEs to Render, and the Render
> services are untouched. What exists now is a buildable image and two validated
> manifests. Secrets are Step 3, the first real deploy is Step 4, DNS is Step 5.

---

## 0. What this step produced

| File | What it is |
|---|---|
| `backend/Dockerfile` | One multi-stage image, two entry points. Reproduces Render's build verbatim and self-checks at build time. |
| `backend/.dockerignore` | Keeps `.env*` out of the image. A correctness requirement, not tidiness — see §3. |
| `backend/fly.api.toml` | API manifest: health-gated blue-green deploys, request-based concurrency, `TRUST_PROXY_HOPS=1`. |
| `backend/fly.worker.toml` | Worker manifest: no service block, pinned always-on, restart `always`. |
| `backend/worker/heartbeat.ts` (+ test) | Minute-by-minute liveness proof for a process nothing can curl. |
| `backend/index.ts` | Real SIGTERM drain; explicit `0.0.0.0` bind; corrected trust-proxy comment. |
| `backend/routes/health.ts` | `GET /api/health/ip` — measures the proxy chain on a live host. |
| `backend/scripts/verify-security-middleware.ts` | Now asserts **both** the Render and Fly proxy topologies, including the spoof case. |
| `.github/workflows/fly-deploy.yml` | Replaces Render's git-push auto-deploy. **Off by default** (§7). |

---

## 1. Build parity with Render

Render builds with its native Node buildpack, `rootDir: backend`:

```
npm ci --include=dev && npx prisma generate && npm run build
node dist/index.js            # API
npm run start:worker          # worker -> node dist/worker/index.js
```

`backend/Dockerfile` runs exactly that in a build stage, then copies `dist`, `prisma`,
`assets` and the generated Prisma client into a clean runtime stage carrying production
dependencies only. Result: **155 MB**, Node 22 (the version this repo's own CI already
pins), running as the unprivileged `node` user.

**The build context is `backend/`, not the repo root.** Deploy from inside it:

```bash
cd backend && fly deploy -c fly.api.toml
cd backend && fly deploy -c fly.worker.toml
```

Both apps share the same Dockerfile and therefore the same image; only the command
differs (`[processes] worker = 'node dist/worker/index.js'` in the worker manifest).
Running the deploy from the repo root would ship the Vite storefront into the API image
and read the wrong `.dockerignore`.

### 1.1 Three things the compiler does not check, now checked by the image

The last layer of the runtime stage runs:

```
require('@prisma/client'); require('sharp'); readdirSync('dist/assets/fonts')
```

Each guards a failure that is invisible until production:

* **Prisma** — `@prisma/client` is an uninitialised stub until the generated client is
  present, and the `prisma` CLI that generates it is a devDependency that does not exist
  in the runtime stage. The image copies `node_modules/.prisma` across from the build
  stage; drop that line and every query throws *@prisma/client did not initialize yet*
  at runtime, off a perfectly green build.
* **sharp** — loads a native binary delivered through `optionalDependencies`. An
  `--omit=optional`, or an architecture mismatch, leaves the JS installed and the binary
  missing: the image builds, then the first mockup render dies on import.
* **fonts** — `services/team-plate/fonts.ts` resolves its font directory *relative to the
  compiled file*: `dist/services/team-plate/` → `../../assets/fonts` → **`dist/assets/fonts`**.
  `tsc` copies no `.ttf` files. `npm run build` (`tsc && node scripts/copy-assets.mjs`,
  commit `814fcd3`) copies `assets/` to `dist/assets/` and fails the build if the typeface
  count is short. The runtime stage copies `dist/` only. A second copy of `/app/assets`
  is never read by the compiled module and was removed (Watchtower `54ca0382`). Render
  still lacks `dist/assets/fonts` until `814fcd3` is actually deployed there.

Build output, 2026-09-22, on Fly's remote builder, against both manifests:

```
image self-check OK — prisma, sharp, 8 fonts
--> Building image done
image size: 155 MB
```

---

## 2. The worker must never autostop

This is the trap the whole step exists for. **Fly's auto-stop is a proxy feature.**
`auto_stop_machines` and `min_machines_running` are keys of `[http_service]` /
`[[services]]`, and the proxy parks a machine when the services it backs go idle. A
background worker backs no service, so a config copied from a web app parks it — and when
that happens, nothing errors. The Etsy queue, AI jobs, delivery tracking, the step-flow
stall sweep and the daily timers just stop.

**The brief asked for `auto_stop_machines = false` and `min_machines_running = 1` on the
worker. Those keys cannot be written there** — there is no service block for them to
belong to, and flyctl rejects them at the top level. The Fly equivalent, and the stronger
form of the same guarantee, is four things:

1. **No `[http_service]` and no `[[services]]`.** With no service, the proxy has nothing
   to watch and no authority to stop the machine. There is no idle timer to expire.
2. **No public IP.** `fly ips list -a imagine-this-printed-worker` must stay empty.
3. **`fly scale count worker=1`** — one machine in the `worker` process group, matching
   Render's `numInstances: 1`.
4. **`[[restart]] policy = 'always'`** — `worker/index.ts` deliberately `process.exit(1)`s
   on an unhandled rejection and hands recovery to the platform. On Render that was
   assumed; here it is pinned.

The API is the opposite case and states it explicitly: `auto_stop_machines = false`,
`auto_start_machines = true`, `min_machines_running = 1`. Render never cold-starts, and
neither will this.

---

## 3. `.dockerignore` excludes `.env*` — required, not hygiene

`backend/load-env.ts` is the **first import of both entry points** and calls
`dotenv.config({ override: true })`. On Render this is inert: `.env` is gitignored and
never reaches the build. On Fly the Docker context is the working tree, so a `.env`
sitting in `backend/` would be baked into the image and would then **beat every value set
with `fly secrets set`** — silently, with nothing logged. A stale key or a dev Supabase
URL would be running production while the secrets list looked correct.

---

## 4. `TRUST_PROXY_HOPS` — re-derived, and now asserted

Render runs with `2`. `backend/index.ts` attributed that to "Cloudflare + Render"; Step 1
then read the zone and found `api.imaginethisprinted.com` is `proxied: false`. Both are
half right, and the resolution matters:

> Production responses carry **`server: cloudflare`** and `cf-cache-status` **alongside
> Render's own `rndr-id`**, while the zone record is DNS-only. The Cloudflare in that
> chain is **Render's**, not the imaginethisprinted.com zone. Render's `2` counts
> *client → Render's CF edge → Render's router → app*.

Fly's chain is *client → Fly proxy → app*: **one hop**. `TRUST_PROXY_HOPS = '1'` is pinned
in `backend/fly.api.toml`.

Why it matters, precisely. Express resolves `req.ip` by walking `X-Forwarded-For` from the
right and treating the *n* rightmost entries as trusted proxies, and Fly's proxy
**appends** the real client address:

| Value on Fly | `X-Forwarded-For: <forged>, <real>` resolves to | Consequence |
|---|---|---|
| `1` (correct) | `<real>` | rate limiting keys on the actual client |
| `2` (copied from Render) | `<forged>` | any caller mints a fresh bucket per request — or poisons someone else's |
| `0` | the Fly proxy address | one bucket for the whole storefront; one abuser throttles everybody |

`npm run verify:security` (`backend/scripts/verify-security-middleware.ts`) now asserts all
of it — the Render topology at 2, the Fly topology at 1, the forged-header case at 1, and
a regression guard proving 2-on-Fly trusts the forgery. All pass as of 2026-09-22.

**Step 5 dependency:** the `1` holds only while the Cloudflare record stays DNS-only.
Orange-clouding `api.imaginethisprinted.com` at cutover adds an edge and makes the answer
`2`. Measure it against the live host before and after the flip:

```bash
curl https://imagine-this-printed-api.fly.dev/api/health/ip
```

That endpoint (new in this step) returns the resolved `ip`, the hop count in force, the
raw `X-Forwarded-For`, and Fly's own unspoofable `fly-client-ip` to compare against.

---

## 5. Proving the worker is actually running

Two signals, deliberately at different timescales.

**a) The log heartbeat — `backend/worker/heartbeat.ts`, every 60 s.**

```
[worker] alive uptime=2m0s rss=53MB ticks: ai-poll=11 etsy-poll=1 — app=... machine=... region=ord
```

Read it like this:

| What you see | What it means |
|---|---|
| `uptime` climbing monotonically | The machine has genuinely stayed up. **This is the autostop test.** |
| `uptime` resetting to ~0 | The machine was parked/restarted. A bare "worker alive" line could not tell you this — which is why uptime is in every beat. |
| `uptime` climbing but a tick counter frozen | Process alive, that poll loop dead. Different bug, different fix. |
| `heartbeat gap: Ns` warning | The event loop was blocked, or the machine was suspended and resumed with its clock intact. |

Verifying the acceptance criterion ("worker stays up ≥1 h with zero inbound HTTP"), once
Step 4 has deployed it:

```bash
fly logs -a imagine-this-printed-worker | grep alive
# wait an hour, sending it nothing, then:
fly status -a imagine-this-printed-worker      # one machine, state = started
```

Sixty beats with uptime climbing from `0m` past `1h`, all from a single `machine=` id, and
no gap warnings, is the proof. Any `stopped` / `suspended` state, or an uptime that
restarted, is the failure.

**b) The database heartbeat — hourly, already existed.** The worker stamps a
`worker_heartbeat` row into `audit_logs` from its hourly cleanup pass, and
`GET /api/health/worker` reports `alive` / `stale` (stale = nothing for 2.5 h). That is the
end-to-end probe for Steps 5–6: after the Fly worker takes over and Render is stopped,
that endpoint must still read `alive`. Allow up to an hour before treating `stale` as
real — hence the log heartbeat above for anything faster.

---

## 6. Two production behaviours fixed here because Fly exposes them

* **The API now drains.** `SIGTERM` used to run `prisma.$disconnect()` and
  `process.exit(0)` with no `server.close()` — every in-flight request severed on every
  shutdown. Render's health-gated rolling deploy hid it. Fly sends SIGTERM and hard-kills
  at `kill_timeout` (30 s, pinned), so the drain is now real: stop accepting new
  connections, close *idle* keep-alive sockets immediately (otherwise the drain would time
  out on every deploy waiting for browsers), let in-flight requests finish, then disconnect
  Prisma. A self-imposed 25 s ceiling logs and force-exits just before the platform would,
  so the process reports its own failure instead of vanishing mid-log.
* **The listen address is explicit.** `app.listen(PORT)` inherited the unspecified address.
  It happens to work on Fly; "happens to work" is not a deployment contract, and a bind to
  `127.0.0.1` would be invisible to Fly's proxy while looking perfectly healthy in the
  app's own logs. Now `0.0.0.0`, overridable via `HOST`.

Deploy strategy follows from the same concern: the API is `bluegreen` (new machine up,
health checks pass, traffic swaps, old machine destroyed — zero downtime on a single
instance, which plain `rolling` cannot do); the worker is `rolling` (a few seconds with
nothing polling, which is free, and which avoids two workers overlapping — see
INVENTORY §4.3 on the Mrs. Imagine race).

---

## 7. Replacing Render's git-push auto-deploy

`.github/workflows/fly-deploy.yml` restores the behaviour `CLAUDE.md` rule 4 depends on.
**It is off by default and must stay off until cutover.** Two switches, both required:

1. repository **variable** `FLY_DEPLOY_ENABLED = true`
2. repository **secret** `FLY_API_TOKEN` (`fly tokens create deploy`, scoped to the two apps)

With either missing, every job short-circuits to a logged no-op, so merging this branch
cannot deploy anything. The workflow deploys the API, waits for `/api/health` to return
200, deploys the worker, then asserts via `fly status --json` that its machine is
`started` — a parked worker fails the run instead of quietly going dark.

---

## 8. What is verified, and what is not

**Verified on 2026-09-22:**

* Both manifests pass `flyctl config validate` against the real Fly API.
* The image builds on Fly's remote builder from **both** configs, and its build-time
  self-check passes: `prisma, sharp, 8 fonts`. 155 MB.
* `npm run verify:security` — all checks pass, including the four proxy-topology
  assertions.
* `npx vitest run backend/worker backend/routes/health.test.ts` — 9 files, 64 tests, pass.
* The compiled heartbeat, run from `dist/`, emits climbing uptime and tick counters.

**Not verified, and not verifiable until Step 4 deploys:**

* The SIGTERM drain end to end. Proof procedure: hold a slow request open against the
  `.fly.dev` host, `fly machine restart`, confirm that request completes with a 200 rather
  than a dropped connection.
* The one-hour no-autostop run (§5a) — there is no machine yet to watch.
* `TRUST_PROXY_HOPS=1` against a live Fly host (`/api/health/ip`). The value is proven
  correct against a Fly-shaped chain in the verifier; the live host confirms the chain is
  the shape assumed.

**Note for anyone running `npm run build` in a dispatch worktree:** it exits non-zero here
with six `TS2742` errors in `middleware/rate-limits.ts`. That is an artifact of this
worktree's `node_modules` being a **symlink** into the shared checkout, which puts the
`@types/qs` path outside the project root and breaks declaration emit. It does not
reproduce in CI, on Render, or in the Docker build — `tsc` exits 0 inside the image.

---

## 9. Next

Step 3: set the 61 API / 50 worker secrets (INVENTORY §5). `GCS_CREDENTIALS` is a 2.4 KB
JSON blob — pipe it from a file, never a command line. Then Step 4 deploys, and everything
in §8's second list becomes testable.

Approval `ae7fe21c` (which commit to cut over on — production is 31 commits behind local
`main`) should be answered before Step 5 pins a build.
