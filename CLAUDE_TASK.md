# Claude Task Brief

## Request
- Complete Watchtower task `3ac9973b-623b-4519-811a-0185f6c9e4ff` for Supabase project `czzyrmizvjqlifcivrhn`.
- Replace the legacy `anon` and `service_role` JWT API keys with publishable/secret API keys, update every live and local consumer, redeploy, and smoke-test login.
- Migrate Auth to an asymmetric signing key only after the backend can validate both legacy HS256 and asymmetric tokens during the overlap window.
- Do not place any live API key or JWT secret in a tracked file, logs, commits, task notes, or chat output.

## Repo detection
- Vite/React frontend and Vercel serverless SEO function, plus an Express/TypeScript backend and worker on Render.
- Supabase clients are `@supabase/supabase-js` 2.78.0 (frontend) and 2.87.1 (backend); both support publishable/secret API keys.
- Live read-only preflight on 2026-08-16 found exactly two Supabase API keys, both `legacy`; no publishable/secret keys exist yet.
- Both Render services currently have `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, and both values match the live legacy keys.
- Vercel project `prj_YWYYcdME1et2sR124OkPodWYXaih` has `VITE_SUPABASE_ANON_KEY` in Production and Development, but not Preview.
- The current tracked tree contains placeholder `eyJ...` examples only; no syntactically complete legacy JWT was found in tracked files. Git history still needs a final secret scan after the migration.
- Baseline before any mutation: storefront, `/api/health`, and `/api/health/database` all return HTTP 200.

## Relevant files
- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `src/lib/supabase.ts`
- `backend/lib/supabase.ts`
- `backend/middleware/supabaseAuth.ts`
- `backend/middleware/supabaseAuth.test.ts`
- `api/_seo/bot-meta.mjs`
- `api/_seo/bot-meta.test.mjs`
- `backend/add-metadata-column.cjs`
- `scripts/verify-signin-live.ts`
- `backend/routes/health.ts`
- `.env.example`
- `backend/.env.example`
- `docs/ENV_VARIABLES.md`
- `RUNBOOK.md`
- `package.json`
- `backend/package.json`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/middleware/supabaseAuth.ts`
- `backend/middleware/supabaseAuth.test.ts`
- `api/_seo/bot-meta.mjs`
- `api/_seo/bot-meta.test.mjs`
- `backend/add-metadata-column.cjs`
- `.env.example`, `backend/.env.example`, `docs/ENV_VARIABLES.md`, and `RUNBOOK.md` only for key-format/rotation guidance; examples must remain placeholders.
- No other tracked file may be edited without first adding a narrow, justified scope entry to `TASK_NOTES.md`.
- Approved external state: Supabase project `czzyrmizvjqlifcivrhn`; Render services `srv-d7jpgut7vvec739bsid0` and `srv-d7jppnn7f7vs73bb4p80`; Vercel project `prj_YWYYcdME1et2sR124OkPodWYXaih`; `C:/Users/David/.secrets/keys.json`; and the exact local environment files listed below.
- Local environment files to update: dispatch `.env.local`; shared-tree `.env` and `.env.local`; shared-tree `backend/.env`; Mr. Imagine worktree `.env.local` and `backend/.env`. After legacy revocation, remove the two exact plaintext `backend/.env.bak-prerotate` files rather than copying new secrets into backups.

## Plan
1. Preflight and rollback: capture only key IDs/types/prefixes and current deployment IDs/statuses; never print values. Confirm Supabase Auth access-token lifetime and inventory any Dashboard database webhooks before changing keys.
2. Fix compatibility first:
   - Make `backend/middleware/supabaseAuth.ts` validate asymmetric JWTs through Supabase JWKS while temporarily retaining explicit HS256 verification through `SUPABASE_JWT_SECRET`. Reject unknown algorithms and keep issuer validation. Add tests for HS256 overlap, asymmetric success, bad issuer, bad signature, and unknown algorithm.
   - In `api/_seo/bot-meta.mjs`, send a publishable key only in `apikey`; never send `sb_publishable_*` as `Authorization: Bearer`. Preserve a real user JWT in `Authorization` only when one exists. Pin this in tests.
   - Apply the same no-secret-key-as-bearer rule to `backend/add-metadata-column.cjs`.
3. Verify and production-deploy the compatibility code before rotating Auth. Confirm old HS256 login and protected backend routes still work.
4. Create one publishable key plus distinct secret keys for Render backend, Render worker, and local development. Keep the existing environment variable names for compatibility, but store the new formats as `database.SUPABASE_PUBLISHABLE_KEY_ITP`, `database.SUPABASE_SECRET_KEY_ITP_BACKEND`, `database.SUPABASE_SECRET_KEY_ITP_WORKER`, and `database.SUPABASE_SECRET_KEY_ITP_LOCAL` in the vault.
5. Roll out keys while legacy remains active:
   - Set `SUPABASE_ANON_KEY` to the publishable key on both Render services.
   - Set each Render service's `SUPABASE_SERVICE_ROLE_KEY` to its own secret key.
   - Set `VITE_SUPABASE_ANON_KEY` to the publishable key in Vercel Production and Development; add Preview only if previews are intended to query production Supabase.
   - Update the approved live local `.env` files. Do not put live values in any example or documentation file.
6. Redeploy Vercel and both Render services. Poll each deployment to a terminal `live`/`READY` state. An environment-variable write alone is not a Render deploy.
7. Smoke-test before revocation: storefront and health endpoints, public catalog/SEO metadata, service-role database access from backend and worker, email/password login, token refresh, a protected backend route, and a real browser login at desktop and mobile widths.
8. Disable the legacy `anon` and `service_role` API keys only after Supabase's last-used indicators show the new keys in use and the old keys idle. Verify the old keys now fail and all new-key probes still pass.
9. Migrate the legacy JWT secret into Supabase Signing Keys, rotate Auth to the generated asymmetric key, and verify newly issued access tokens use the new `kid`/algorithm while existing HS256 sessions remain valid during overlap.
10. After the configured access-token lifetime plus 15 minutes, revoke the previous legacy signing key, remove the HS256 fallback and `SUPABASE_JWT_SECRET` requirement from the backend, remove that env var from both Render services, redeploy, and prove old HS256 user tokens fail while fresh login/refresh succeeds.
11. Run a final secret scan of the working tree and history, remove the two obsolete plaintext backup env files, record only key IDs/prefixes and deployment IDs in the handoff, and reference Watchtower task `3ac9973b-623b-4519-811a-0185f6c9e4ff`.

## Acceptance criteria
- [ ] Publishable/secret API keys exist and all three new secret keys are independently rotatable.
- [ ] Both Render services use the publishable key and their assigned secret key under the existing required variable names.
- [ ] Vercel Production and Development use the publishable key; Preview is explicitly configured or explicitly excluded.
- [ ] Vault and every approved live local environment file contain the new values; no live value appears in tracked examples/docs.
- [ ] Legacy `anon` and `service_role` keys are disabled and fail an explicit negative test.
- [ ] Supabase Auth signs new sessions with an asymmetric key; after the overlap window, the legacy signing key is revoked.
- [ ] Backend verification supports the new signing key, then has its HS256 fallback and `SUPABASE_JWT_SECRET` removed after revocation.
- [ ] Render backend, Render worker, and Vercel frontend redeploy successfully and report healthy.
- [ ] Public data/SEO requests, backend service-role operations, worker processing, login, refresh, protected-route access, and browser login all pass.
- [ ] No valid Supabase legacy JWT or new secret key is present in the tracked tree, task artifacts, logs, or commit.

## Commands
- `npm run typecheck`
- `npm --prefix backend run typecheck`
- `npm test -- api/_seo/bot-meta.test.mjs`
- `npm --prefix backend test -- middleware/supabaseAuth.test.ts`
- `npm run build`
- `npm --prefix backend run build`
- `npm run verify:auth`
- `npx tsx scripts/verify-signin-live.ts` after supplying the required variables from a temporary, untracked environment source.
- `curl https://api.imaginethisprinted.com/api/health`
- `curl https://api.imaginethisprinted.com/api/health/database`
- Render redeploy endpoints are documented in `docs/DEPLOY_RENDER_GITHUB_RECONNECT.md`; trigger both explicitly after env writes and poll their deploy IDs until `live`.
- Use `vercel env ls --cwd "D:/Projects for MetaSphere/imagine-this-printed"` to verify environment coverage, then explicitly create a new Production deployment after the env update.
