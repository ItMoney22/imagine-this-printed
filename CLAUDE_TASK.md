# Claude Task Brief

## Request
- Watchtower task: `6f1a3291-e9fa-4c26-89b4-85d5af505c56`.
- Restore the legacy Admin Dashboard submission surfaces backed by `public.three_d_models` and `public.vendor_products` in the live Imagine This Printed Supabase project.
- Resolve the `products.approved` compatibility gap without replacing the current product lifecycle model.
- Verify and document the live `public.get_user_role(uuid)` state.

## Repo detection
- Vite/React frontend, Express/TypeScript backend, Supabase/PostgreSQL database.
- Production Supabase project ref: `czzyrmizvjqlifcivrhn`.
- Canonical migrations live in `supabase/migrations/`; production has extensive out-of-band drift, so catalog/PostgREST results are authoritative.
- The admin routes `/admin` and `/admin/dashboard` are admin-only and `AdminDashboard.tsx` already loads, approves, and rejects rows from both missing tables.

## Decision and assumptions
- Keep both features. The current admin tabs, overview metrics, public 3D showcase query, types, and legacy vendor-product code still reference them; removing the tabs would leave other callers broken.
- `vendor_products.approved` and `three_d_models.approved` remain mutable booleans because the current admin handlers update them directly.
- `products.status` plus `products.is_active` remain the source of truth. Restore `products.approved` only as a synchronized compatibility field: `true` exactly when `status = 'active' AND is_active IS TRUE`. Backfill it and enforce the rule with a trigger so callers cannot create a third independent approval state.
- Staff authority follows the established role model: admin/founder have full table access. Owners may create/read/edit/delete only their own still-pending submissions. Anonymous/authenticated public readers may select approved rows only.
- No Admin Dashboard code change is expected. If the tabs still fail after the database contract is restored, diagnose before expanding scope.

## Live baseline verified 2026-08-16
- Anonymous PostgREST `GET /rest/v1/three_d_models?select=id&limit=1` -> HTTP 404 / PostgreSQL `42P01` relation missing.
- Anonymous PostgREST `GET /rest/v1/vendor_products?select=id&limit=1` -> HTTP 404 / PostgreSQL `42P01` relation missing.
- Anonymous PostgREST `GET /rest/v1/products?select=id,approved&limit=1` -> HTTP 400 / PostgreSQL `42703` column missing.
- Anonymous PostgREST `POST /rest/v1/rpc/get_user_role` with the zero UUID -> HTTP 200 and `"customer"`; the ambiguity fix is already live even though stale ledger text still says it is not.
- Contrary to the task context, the current and historical `supabase/migrations/001_initial_schema.sql` do not define either missing table. Create a new additive migration; never edit `001_initial_schema.sql`.

## Relevant files
- `AGENTS.md`
- `CLAUDE.md`
- `TASK_NOTES.md`
- `supabase/migrations/README.md`
- `supabase/migrations/MIGRATION_LEDGER.md`
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/20260728_fix_get_user_role_ambiguity.sql`
- `scripts/apply-pending-migrations.mjs`
- `src/pages/AdminDashboard.tsx`
- `src/types/index.ts`
- `src/utils/design-showcase-service.ts`
- `backend/prisma/schema.prisma`
- `package.json`

## Files to edit (STRICT)
- `supabase/migrations/20260817010000_restore_admin_submission_tables.sql` (new)
- `scripts/apply-pending-migrations.mjs`
- `supabase/migrations/MIGRATION_LEDGER.md`
- `TASK_NOTES.md` (append one implementation-result work-log bullet)
- Do not edit `AdminDashboard.tsx`, types, Prisma, or any other file unless a verified post-migration contract mismatch requires it; if so, update the approved shortlist before editing.

## Migration contract
1. Create `public.vendor_products` idempotently with the fields consumed by `AdminDashboard.tsx`/`VendorProduct`: UUID `id`, `vendor_id` FK to `public.user_profiles(id)`, `title`, `description`, nonnegative `price`, `images text[]`, `category`, `approved boolean NOT NULL DEFAULT false`, bounded `commission_rate` (default 15), `product_type` (`physical|digital|both`), nonnegative `digital_price`, `file_url`, nonnegative `shipping_cost`, nonnegative integer `stock`, and timestamps.
2. Create `public.three_d_models` idempotently with UUID `id`, `title`, `description`, `file_url`, `preview_url`, category (`figurines|tools|decorative|functional|toys`), `uploaded_by` FK to `public.user_profiles(id)`, `approved boolean NOT NULL DEFAULT false`, nonnegative `votes`/`points`, file type (`stl|3mf|obj|glb`), and timestamps.
3. Add useful indexes for owner, approval queue, and newest-first queries. Reuse the canonical `public.update_updated_at_column()` trigger for both tables.
4. Add `products.approved boolean NOT NULL DEFAULT false`, backfill it from `status/is_active`, and install an idempotent `BEFORE INSERT OR UPDATE OF status, is_active, approved` trigger that always recomputes it. Add a consistency CHECK if it is safe for existing rows. Never make this boolean independently writable approval state.
5. Enable RLS on both restored tables. Drop/recreate named policies idempotently:
   - anon/authenticated SELECT approved rows;
   - authenticated owners SELECT their own rows;
   - authenticated owners INSERT only with owner column = `auth.uid()` and `approved = false`;
   - authenticated owners UPDATE/DELETE only their own pending rows, with UPDATE `WITH CHECK` keeping owner unchanged and `approved = false`;
   - admin/founder `FOR ALL` using `public.get_user_role(auth.uid()) IN ('admin','founder')`, with the same `WITH CHECK`.
6. Grant schema/table privileges needed by PostgREST (`SELECT` to anon; `SELECT/INSERT/UPDATE/DELETE` to authenticated). Service role remains unaffected. End with `NOTIFY pgrst, 'reload schema'`.
7. Do not add permissive `USING (true)` write policies, and do not let submitters self-approve.

## Plan
1. Add the migration and a corresponding `restore-admin-submissions` entry to `scripts/apply-pending-migrations.mjs`.
2. Make the runner's status check prove both relations, their required columns, RLS enabled, required policies, the products synchronization trigger, and a non-throwing `get_user_role()` call. Unknown state must block writes.
3. Add a hard production-target guard before `--apply`: the connection identity must resolve to project ref `czzyrmizvjqlifcivrhn`. Do not trust a generic `DATABASE_URL`; prior audits found vault/pooler URLs pointing at other projects.
4. Run the runner in dry-run mode, then apply only this migration in one transaction with tracking enabled. Verify inside the transaction before commit.
5. Re-probe anonymous PostgREST after schema reload. Then use an authenticated admin session to verify pending SELECT and a reversible insert -> approve -> delete smoke test for each table; clean up all smoke rows.
6. Open the production Admin Dashboard at desktop and mobile widths. Confirm Vendor Products and 3D Models render empty/data states with no related console errors and that approval succeeds.
7. Update `MIGRATION_LEDGER.md` with the exact live evidence: new migration applied path/time, schema/policy/trigger verification, anonymous HTTP results, admin smoke results, and `get_user_role()` already functional.

## Acceptance criteria
- [ ] Anonymous-key GETs for both restored tables return HTTP 200 (normally `[]` when empty), never 404.
- [ ] `products.approved` selects successfully and always mirrors `status='active' AND is_active=true` after insert/update.
- [ ] Pending owners cannot approve themselves; anonymous users cannot see pending rows.
- [ ] An authenticated admin can list pending rows and approve/delete both resource types.
- [ ] Admin Vendor Products and 3D Models tabs load without their current console errors at desktop and mobile widths.
- [ ] `get_user_role()` returns without ambiguity and the ledger no longer claims the fix is missing.
- [ ] Migration is transactional, idempotent, tracked, and verified against project `czzyrmizvjqlifcivrhn`.
- [ ] No smoke-test rows remain in production.

## Commands
```powershell
node --env-file=backend/.env scripts/apply-pending-migrations.mjs --only=restore-admin-submissions
node --env-file=backend/.env scripts/apply-pending-migrations.mjs --apply --track --only=restore-admin-submissions
npm run typecheck
npm run test
npm run build
npm --prefix backend run typecheck
git diff --check
```

- Run the write command only after the new project-ref guard prints `czzyrmizvjqlifcivrhn`.
- Use PostgREST and authenticated browser checks for the live acceptance gates; local type/build success alone is insufficient.
