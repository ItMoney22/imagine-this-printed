# Restoring the Admin submission tables — what happened and how it was done

**Date:** 2026-08-17 · **Watchtower task:** `08444193-a962-46de-9d1a-d55ff9d2fabe`
(implementing the scout brief from `6f1a3291`, commit `43927c2`)
**Target:** production Supabase project `czzyrmizvjqlifcivrhn`
**Migration:** `supabase/migrations/20260817010000_restore_admin_submission_tables.sql`

This is the process record for a **production database change**. It exists so the
next person can tell exactly what was changed, what was proved, and how to redo
or extend it without guessing.

---

## 1. The problem

Three objects the frontend depends on did not exist in production:

| Object | Symptom | Who breaks |
|---|---|---|
| `public.three_d_models` | `404` / `42P01` relation missing | Admin **Models** tab, overview "3D models" + pending counters, public design showcase |
| `public.vendor_products` | `404` / `42P01` relation missing | Admin **Vendors** tab, overview pending counter, legacy ITC design-download route |
| `products.approved` | `400` / `42703` column missing | `src/utils/design-showcase-service.ts` featured-designs query |

Two facts made this less obvious than it looks:

- **No migration in this repo ever declared either table**, at any point in git
  history. `001_initial_schema.sql` does not define them and never did. So this
  was not "a migration failed to apply" — the tables were created out of band and
  lost, or never existed. The fix had to be a *new additive* migration, not a
  repair of an existing file.
- `products` had already moved on. Its real lifecycle is `status` + `is_active`;
  `approved` is a leftover from an older model.

## 2. The decisions

**Keep both features.** `AdminDashboard.tsx` loads, approves and rejects rows from
both tables, the overview metrics count pending rows in both, `src/types/index.ts`
declares `VendorProduct` and `ThreeDModel`, and the public showcase reads approved
3D models. Deleting the tabs would have left several other callers broken.

**`approved` means two different things, deliberately.**

- On `vendor_products` / `three_d_models` it is a plain mutable boolean, because
  the admin handlers write it directly (`.update({ approved: true })`). Submitters
  can never set it true — that is enforced by RLS, not convention.
- On `products` it is a **synchronized compatibility field**. `status` +
  `is_active` stay the single source of truth; `approved` is always exactly
  `status = 'active' AND is_active IS TRUE`, recomputed by a trigger and pinned by
  a CHECK constraint. This is the whole point: without it, `approved` would become
  a third, independently-writable product state that silently disagrees with the
  other two.

**RLS contract** (identical shape on both restored tables):

| Who | Can |
|---|---|
| `anon`, `authenticated` | SELECT rows where `approved = true` |
| owner (`authenticated`) | SELECT all of their own rows |
| owner | INSERT only as themselves, only with `approved = false` |
| owner | UPDATE / DELETE only their own **still-pending** rows; UPDATE's `WITH CHECK` keeps ownership fixed and `approved = false` |
| `admin` / `founder` | `FOR ALL`, via `public.get_user_role(auth.uid())` |

No `USING (true)` write policy exists anywhere in the file. A submitter cannot
approve their own submission and cannot hand it to somebody else.

## 3. What is in the migration

1. `public.vendor_products` — the columns `AdminDashboard.tsx` and the
   `VendorProduct` type consume, plus bounded CHECKs (`price >= 0`,
   `commission_rate` 0–100, `product_type IN (physical|digital|both)`,
   `stock >= 0`), a `vendor_id` FK to `user_profiles(id) ON DELETE CASCADE`, and
   three indexes (owner, approval queue, newest-first).
2. `public.three_d_models` — same shape of treatment, with `category` and
   `file_type` constrained to the values the `ThreeDModel` type declares.
3. Both tables reuse the canonical `public.update_updated_at_column()` trigger
   from `001_initial_schema.sql`.
4. `products.approved` — added, backfilled, kept honest by
   `sync_products_approved()` on `BEFORE INSERT OR UPDATE OF status, is_active,
   approved` and by CHECK `products_approved_matches_status`.
5. RLS enabled + 6 named policies per table (12 total), all dropped-then-created
   so the file is re-runnable.
6. PostgREST grants (`SELECT` to `anon`; `SELECT/INSERT/UPDATE/DELETE` to
   `authenticated`). `service_role` bypasses RLS and was not touched.
7. `NOTIFY pgrst, 'reload schema'` so PostgREST picks the relations up
   immediately instead of on its next poll.

### Two additive legacy-compat columns

`vendor_products` also carries nullable `name` and `metadata jsonb`. They are not
part of the admin contract — `title` remains the display field. They exist because
`backend/routes/user-products.ts:1228` selects `id, name, images, metadata` from
this table and reads `metadata->>'creator_id'`. Without those columns PostgREST
answers that select with `400 / 42703` and the route reports "Design not found".
That route has no writer in current code and is probably pointed at the wrong
table entirely; repointing it is filed as follow-up work rather than done here.

## 4. The runner guard (why `--apply` can't hit the wrong project)

`scripts/apply-pending-migrations.mjs` gained a hard production-target guard.

The reason it is needed: **every Supabase project answers `current_database()`
with `postgres` and `current_user` with `postgres`.** Neither tells you which
project you are about to write to, and prior audits found vault/pooler
`DATABASE_URL`s aimed at entirely different projects. The project ref is the only
identity that distinguishes them.

The guard resolves the ref from the connection string — session-pooler URLs carry
it in the username (`postgres.<ref>`), direct connections in the host
(`db.<ref>.supabase.co`) — cross-checks it against `SUPABASE_URL` when that is
set, and refuses `--apply` unless it equals `czzyrmizvjqlifcivrhn`. It exits
**before any connection is opened**. An unresolvable ref is a stop, not a shrug.

Tested failure modes, each exiting `1` without connecting:

```
wrong ref            → "DATABASE_URL points at project <x>, not czzyrmizvjqlifcivrhn"
unresolvable ref     → "could not resolve a Supabase project ref from DATABASE_URL — refusing to guess"
URL disagreement     → "DATABASE_URL (<a>) and SUPABASE_URL (<b>) disagree about the project"
```

The `restore-admin-submissions` status check is deliberately paranoid: it proves
both relations, every column the UI consumes, RLS enabled, all 12 policies **by
name**, the trigger, the CHECK, zero `approved` drift, and a non-throwing
`get_user_role()`. A partial state (table present, policies missing) reports
`PENDING`, so a half-applied restore can never be mistaken for a finished one.

## 5. How it was applied

```powershell
# 0. rehearse: run the whole file in a transaction that ALWAYS rolls back
#    (proved SQL, backfill counts, trigger derivation, FK, and that a second
#     run of the entire file is a no-op)

# 1. dry run — reports status, prints the plan, writes nothing
node --env-file=backend/.env scripts/apply-pending-migrations.mjs --only=restore-admin-submissions

# 2. apply, in one transaction, verified in-transaction before COMMIT,
#    and recorded in supabase_migrations.schema_migrations
node --env-file=backend/.env scripts/apply-pending-migrations.mjs --apply --track --only=restore-admin-submissions
```

Run the write command only after the guard prints `czzyrmizvjqlifcivrhn`.

Unlike most of this repo's history, this migration **is** tracked —
`schema_migrations` carries version `20260817010000`.

## 6. What was verified, and how

**31/31 automated checks passed.**

Anonymous PostgREST, before → after:

| Probe | Before | After |
|---|---|---|
| `GET /rest/v1/three_d_models?select=id&limit=1` | 404 / `42P01` | **200** `[]` |
| `GET /rest/v1/vendor_products?select=id&limit=1` | 404 / `42P01` | **200** `[]` |
| `GET /rest/v1/products?select=id,approved&limit=1` | 400 / `42703` | **200** |

- **Backfill:** 2,466 product rows → 43 `true` / 2,423 `false`, and **0 rows**
  where `approved IS DISTINCT FROM (status='active' AND is_active IS TRUE)`.
- **Trigger:** inserting a product with `status='active', is_active=true,
  approved=false` returns `approved=true`; updating `status` to `'draft'` returns
  `approved=false`; forcing `approved=false` on an active product is overridden.
- **RLS**, proved by acting as each role inside a rolled-back transaction (so
  nothing was left behind): an owner can submit, but is blocked `42501` from
  inserting pre-approved rows, from self-approving, and from reassigning a
  submission to another user; `anon` cannot see pending rows but can see approved
  ones; `admin` can approve and delete both resource types.
- **Authenticated admin over real HTTP** with a properly signed JWT: insert →
  list pending → approve → delete, for both tables. All smoke rows deleted; both
  tables confirmed back to **0 rows**.
- **Live production browser**, signed in as an admin: the **Vendors** ("Vendor
  Product Approvals") and **Models** ("3D Model Approvals") tabs render, and
  clicking **Approve** on a seeded row flipped the badge Pending → Approved with
  a success toast, persisting across a reload. The overview "Pending Approvals"
  tile moved 2418 → 2420 when two pending rows were seeded, which proves the
  metric queries in `AdminDashboard.tsx` are working again too.
- **Mobile, 390 × 844**: both tabs re-rendered in a real Chromium at mobile
  viewport — cards stack into one column, tab pills wrap, **no horizontal
  overflow**, and no console error naming either table.

> Note on verifying at mobile width: the Chrome extension's `resize_window` is a
> no-op in this environment (the window stays 1920px), and the site sends
> `X-Frame-Options`, so the same-origin-iframe trick does not work either. The
> way that does work is driving Puppeteer (already a dependency) with
> `setViewport({ width: 390, height: 844, isMobile: true })`.

## 7. Known gaps left open

- `backend/routes/user-products.ts` reads designs out of `vendor_products`, a
  table with no writer in current code. The two compat columns stop it erroring,
  but it is probably pointed at the wrong table. Filed as follow-up.
- `src/utils/design-showcase-service.ts` filters `products` on `approved`, which
  now works — but since `approved` mirrors `status='active' AND is_active`, that
  query would read more naturally against `status`/`is_active` directly. Left
  alone deliberately: this task restored the contract, it did not refactor callers.
