# SUPABASE_SERVICE_ROLE_KEY "drift" — what is actually happening

**Watchtower task:** `547d0c0f-e9b5-41b6-bbbc-c89c9380eb43` (recurrence of `f436cc1b`)
**Investigated:** 2026-08-19 — Sifu
**Verdict:** `backend/.env` was never wrong. Nothing rewrites it. The bug is
environment **shadowing**, and it will keep looking like file corruption until
you know that.

---

## TL;DR

On this workstation, agent/CLI shells are spawned by the Watchtower engine, whose
own process environment carries **the dashboard project's** Supabase credentials
(`ref=yrjoblqqgrposgbvsbxm`). Every child shell inherits them.

Then:

- `dotenv.config()` **will not overwrite a variable that is already set**, and
- Node's / tsx's `--env-file=` flag **will not either**.

So a script starts, dutifully "loads" the correct `backend/.env`, and keeps the
inherited wrong-project key anyway. Every service-role call returns
`HTTP 401 {"message":"Invalid API key"}`. The obvious conclusion — "something
overwrote backend/.env with a foreign key" — is wrong, and the search for the
script that did it comes up empty because there is no such script.

---

## Evidence (2026-08-19, live)

**1. The file on disk was correct, and byte-identical to production.**

| Source | role | project ref | sha256 (first 16) |
|---|---|---|---|
| `D:/Projects for MetaSphere/imagine-this-printed/backend/.env` | `service_role` | `czzyrmizvjqlifcivrhn` | `7e810ddefe8e4968` |
| Render `srv-d7jpgut7vvec739bsid0` (backend) | `service_role` | `czzyrmizvjqlifcivrhn` | `7e810ddefe8e4968` |
| Render `srv-d7jppnn7f7vs73bb4p80` (worker) | `service_role` | `czzyrmizvjqlifcivrhn` | `7e810ddefe8e4968` |
| Key vault `itp.SUPABASE_SERVICE_ROLE_KEY` | `service_role` | `czzyrmizvjqlifcivrhn` | *(identical)* |

The file's mtime was 2026-08-16, three days before the report. No write, no drift,
nothing to restore.

**2. The ambient process environment held a different key.**

Inside the dispatch shell, `process.env.SUPABASE_SERVICE_ROLE_KEY` decoded to
`role=service_role ref=yrjoblqqgrposgbvsbxm` — a valid key for the *dashboard's*
Supabase project, sourced from `david-trinidad-com/.env.local`, inherited down the
process tree.

**3. Both keys were fired at ITP production side by side.**

```
FILE key    -> GET /rest/v1/products          HTTP 200
FILE key    -> GET /auth/v1/admin/users       HTTP 200
AMBIENT key -> GET /rest/v1/products          HTTP 401 {"message":"Invalid API key"}
AMBIENT key -> GET /auth/v1/admin/users       HTTP 401 {"message":"Invalid API key"}
```

That is the whole bug. The reported 401 belongs to the environment, not the file.

**4. It is not an OS-level variable.** `[Environment]::GetEnvironmentVariables('User')`
and `('Machine')` carry no `SUPABASE_SERVICE_ROLE_KEY` at all (only a
`SUPABASE_ACCESS_TOKEN`). An earlier write-up
(`docs/REFUND_DISPUTE_GOLIVE_REPORT.md` §4c) diagnosed the same *mechanism* but
attributed it to OS User scope; the source today is process inheritance from the
engine. The mechanism is what matters, and it was right about that.

---

## Why the backend and worker were never affected

`backend/index.ts` and `backend/worker/index.ts` both import `./load-env.js`
first, and `backend/load-env.ts` uses `dotenv.config({ override: true })`. The
file wins there. Only **standalone scripts** — which each load env their own way —
were losing to the environment. That is also why production was never at risk:
Render injects real env vars and there is no competing file at all.

---

## What was changed

### 1. A fail-fast guard — `backend/lib/supabase-env-guard.ts`

Base64url-decodes the JWT payload of `SUPABASE_SERVICE_ROLE_KEY` and compares its
`ref` claim with the sub-domain of `SUPABASE_URL`. No network call, no signature
verification (the signature needs the project JWT secret; a wrong-project key is a
*real* key for the *wrong* database, which is exactly what `ref` catches).

Called from `backend/lib/supabase.ts` at module load, before `createClient`, so
the API and the worker stop at boot with a message that names both project refs
and the remediation — instead of failing one query at a time, five layers deep.

Fatal states, both of which guarantee every service-role call fails:

- `ref-mismatch` — the key belongs to a different project.
- `wrong-role` — an anon key is sitting in the service-role slot, so every
  privileged write is silently evaluated under RLS.

Deliberately **not** fatal:

- an opaque `sb_secret_*` key (Supabase's newer format is not a JWT),
- a custom `SUPABASE_URL` domain (no ref to derive),
- anything under vitest (`NODE_ENV=test` / `VITEST`), where 18 test files inject
  the placeholder `test-service-role-key` on purpose.

### 2. `backend/load-env.ts` — cwd-independent, and it says when it overrode you

Resolved the `.env` path from the module's own location instead of
`process.cwd()`. Previously `tsx backend/index.ts` run from the repo root loaded
the *root* `.env` (VITE_* vars only), overrode nothing, and left the ambient key
in place. It now also logs which `SUPABASE_*`/`DATABASE_URL` variables it actually
replaced — the shadowing fingerprint, visible without a debugger — and skips
loading entirely under vitest so a unit test can never be handed production
credentials.

### 3. 25 standalone scripts now let the file win

Every script that reads `SUPABASE_*` and loads its own env was loading it
non-overridingly. All of them now use `override: true`, or import
`backend/load-env.js`:

```
backend/check-ai-workflow.mjs                     backend/scripts/setup-database.js
backend/check-assets-detailed.mjs                 backend/scripts/setup-rls.js
backend/check-products.mjs                        diagnostics/auth-flow-test.js
backend/scripts/gen-metal-mockup.ts               diagnostics/check-tables.js
backend/scripts/refresh-product-copurchase.ts     diagnostics/supabase-connection-test.js
backend/scripts/refresh-product-images.ts         diagnostics/test-supabase-auth.js
backend/scripts/run-migration.ts                  scripts/auth-diagnose.ts
backend/scripts/run-migration-pg.ts               scripts/create-or-reset-admin.ts
backend/scripts/run-email-templates-migration.ts  scripts/debug-orders.mjs
scripts/hard-reset-auth.ts                        scripts/migrate-product-variants.js
scripts/reset-auth-and-data.ts                    scripts/seed-admin-profile.ts
scripts/verify-setup.js                           scripts/verify-signin-live.ts
scripts/verify-signin.ts
```

Three of them were also cwd-relative (`dotenv.config({ path: '.env' })`,
`path: '../backend/.env'`), so they only worked from one directory; those now
resolve from the module's own path.

Note the two genuinely dangerous ones: `scripts/hard-reset-auth.ts` **deletes
every user**, and `backend/scripts/run-migration.ts` **applies DDL**. Both were one
stray shell variable away from doing that to whichever project the environment
happened to name.

The seven `backend/routes/*.ts` files that call a bare `dotenv.config()` were left
alone on purpose: `load-env.js` has already run by the time a route module is
evaluated, and dotenv never overrides, so those calls are no-ops.

### 4. `npm run verify:supabase-env` (in `backend/`)

- checks the key on disk against `SUPABASE_URL` (and the anon key too),
- reports **shadowing** — an ambient value that differs from the file,
- fails if any standalone script reading `SUPABASE_*` loads env without override,
  so this cannot silently regress,
- with `--live`, makes real `/rest/v1` and `/auth/v1/admin` calls.

`--env=<path>` points it at another checkout's `.env` (a dispatch worktree has
none of its own).

---

## How this was verified

1. `npm run verify:supabase-env -- --live --env=<shared>/backend/.env` — key matches
   `czzyrmizvjqlifcivrhn`, anon matches, REST 200, auth-admin 200, and it correctly
   flags the ambient key as shadowing.
2. Scanner negative test — dropped a script with a bare `dotenv.config()` into
   `scripts/`; the check failed on it, then passed once removed.
3. Guard in its real position, poisoned env: importing `backend/lib/supabase.ts`
   with the inherited key threw before `createClient`, printing both refs.
4. **Real backend booted locally** (`tsx index.ts`, port 4123) with the file's env:
   logged `[supabase-env] OK - service_role key matches project "czzyrmizvjqlifcivrhn"`,
   then `/api/health` → 200, **`/api/health/database` → 200 "Database connected
   successfully (185 users)"** (a genuine service-role query), `/api/health/auth` → 200,
   `/api/health/worker` → 200. No 401 anywhere.
5. Same entrypoint booted with the wrong-project key on top → refused to start with
   the full diagnostic.
6. `vitest run` — **57 files / 757 tests pass**, including 21 new guard tests.
   `tsc --noEmit` clean in `backend/` and at the root. eslint: 0 errors on changed
   files (37 pre-existing `no-explicit-any`-class warnings, none introduced).

---

## If you see `401 Invalid API key` again

```bash
# 1. What is the process actually holding?
node -e "console.log(process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-6))"

# 2. What does the file hold? (tails should match)
grep SUPABASE_SERVICE_ROLE_KEY backend/.env | tail -c 12

# 3. Full diagnosis, including which scripts are still loading env unsafely
cd backend && npm run verify:supabase-env -- --live
```

If the two tails differ, the environment is shadowing the file. That is this bug —
**do not go looking for the script that rewrote `backend/.env`, and do not paste a
new key into it.** Ground truth is the Render env of
`imagine-this-printed-backend` (`srv-d7jpgut7vvec739bsid0`) and the key vault.

---

## Still open

The engine-side fix — dispatch child processes should not inherit another
project's `SUPABASE_*` / `DATABASE_URL` variables at all — lives in the
`david-trinidad-com` repo and is filed separately. Until that lands, every ITP
dispatch window is still born with a wrong-project key in its environment; this
repo simply refuses to be fooled by it now.
