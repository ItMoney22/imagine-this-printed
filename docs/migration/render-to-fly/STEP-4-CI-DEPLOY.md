# Step 4/6 — Fly deploys from GitHub Actions (replacing Render auto-deploy)

Watchtower task `03cf95a0` · umbrella `291fcf82` · 2026-09-23 · Ethan Dunn

## What replaces what

| | Render (today) | Fly (after Step 5) |
|---|---|---|
| Trigger | Render GitHub App, commit to `main` under `backend/` | `.github/workflows/fly-deploy.yml`, push to `main` under `backend/**` (or the workflow file), or manual `workflow_dispatch` |
| API | `srv-d7jpgut7vvec739bsid0` | `imagine-this-printed-api` — `backend/fly.api.toml`, bluegreen, health-gated on `/api/health` |
| Worker | `srv-d7jppnn7f7vs73bb4p80` | `imagine-this-printed-worker` — `backend/fly.worker.toml`, rolling, no services, one machine |
| Build | Render native `npm ci && prisma generate && tsc` | `backend/Dockerfile` on Fly's remote builder (same `npm run build`, plus a fonts/prisma/sharp self-check) |

## The workflow, in order

1. **`deploy switch`** — reads repo variable `FLY_DEPLOY_ENABLED`. Not `true` → a
   `::notice::` saying Render is still production, and every later job is **skipped**
   (grey), never a green run that deployed nothing.
2. **`backend compiles`** — `npm ci`, `prisma generate`, `npm run build` on the runner.
   A compile error is a red check here, before the remote builder or any machine is
   touched.
3. **`deploy api + worker`**
   - fails with `::error title=No Fly token::` if no token resolves;
   - `flyctl deploy --config fly.api.toml --remote-only --wait-timeout 300`;
   - `flyctl deploy --config fly.worker.toml --remote-only --wait-timeout 300`
     (only after the API went healthy — the worker has no health check);
   - curls `https://imagine-this-printed-api.fly.dev/api/health` until 200 (~100 s max);
   - asserts **exactly one** `worker`-group machine is `started` (0 = dead queue,
     2+ = two schedulers racing).

Every failure is a nonzero exit on a named step, so the run is red on the commit in
GitHub. `concurrency` serialises deploys and never cancels one mid-flight.

## Why it ships switched off

While Render is production, a Fly deploy would start a second worker against the live
database. Six of seven jobs tolerate that; the Mrs. Imagine daily scout does not
(STEP-1-INVENTORY §4.3). The switch keeps this file safe to merge before the cutover.

## Tokens

Preferred: per-app deploy tokens in `FLY_API_TOKEN_API` and `FLY_API_TOKEN_WORKER`
(`fly tokens create deploy -a <app> -x 8760h`). Fallback: one `FLY_API_TOKEN`. The repo
is **public**; the only token an agent holds (vault `fly.FLY_API_TOKEN`) is an
org-wide token that can also reach `darrell-voice-bridge`, and it is refused
permission to mint scoped ones (`createLimitedAccessToken Not authorized`). Which token
goes in is David's call — approval `3f6ebdf0`. No secret is set yet.

## What was proven (2026-09-23)

Run from this branch (`982b0d5` + this change), with the vault token, using the
workflow's exact commands:

- `flyctl deploy --config fly.api.toml --remote-only --wait-timeout 300` → exit 0.
  Remote build passed the image self-check; bluegreen brought up two green machines
  (`847d25b2966d68`, `2862e41c560348`, image
  `deployment-01M371HQFMWCQZAD50J2BJAEQ1`), health-gated, then destroyed the blue pair.
- `/api/health` → 200 `{"ok":true}`; `/api/health/database` → 200 connected.
- `flyctl deploy --config fly.worker.toml --remote-only --build-only` → exit 0, image
  `deployment-01M371NWWDC9TM6AP9XAXSNK72` (154 MB). Deliberately build-only: the two
  worker machines stay **stopped** until Step 5 (Dominic's step-3 hand-off).
- The worker assertion's query, run against the live app, counts **0** started worker
  machines — i.e. the step correctly fails today, and would pass only with one running.

## NOT yet proven — the push-to-main run

The acceptance test ("push to main → both apps deploy, no hands") cannot run until:

1. **Workflow scope** — the fleet's GitHub credential lacks the `workflow` OAuth scope, so
   no branch touching `.github/workflows/` can be pushed (task `2249959e`). Fix:
   `gh auth refresh -h github.com -s workflow` (browser login — David).
2. **Token** — approval `3f6ebdf0` (which token goes in the public repo).
3. **Cutover** — Step 5 (`13e1c509`) flips `FLY_DEPLOY_ENABLED=true`, then the first
   backend push to `main` (or `gh workflow run "Deploy to Fly"`) is the E2E proof.

## Step 5 checklist for this workflow

- Worker has **two** stopped machines (`d893e75c306e38`, `2870193a5d4d18`); the toml
  wants one. `fly scale count worker=1 -c backend/fly.worker.toml` before or right after
  the cutover deploy, or the "exactly one worker" step fails the run (by design).
- Set the token secret(s), then `gh variable set FLY_DEPLOY_ENABLED --body true`.
- `gh workflow run "Deploy to Fly" -R ItMoney22/imagine-this-printed` and watch
  `gh run watch` — all three jobs green is the Step 4 acceptance.
- The moment the Fly worker starts, suspend the Render worker (and turn off Render
  auto-deploy on both services) — otherwise two workers run against the live DB
  until Step 6 cancels Render. The API overlap is harmless; the worker overlap is not.
