# Migration Ledger — imagine-this-printed

Audited 2026-07-28 by Iahhm, Watchtower ITP Closeout campaign (tasks `5b86e9ac`,
`c5335439`, `3390cc85`). Read-only against production throughout — every
APPLIED/MISSING claim below comes from a live `information_schema` / `pg_proc`
/ `pg_policies` / `pg_trigger` SELECT run against the production database, not
from reading file contents and assuming. No migration was applied, no `supabase
db push`/`db reset` was run, nothing was written to the live database.

## 2026-08-05/06 — security hardening applied (Zero Nine)

Applied LIVE to prod via `scripts/apply-pending-migrations.mjs` (each verified
in-transaction; re-confirmed against the live catalog after). Applied via the
pg-script path, so NOT tracked in `schema_migrations` (like most of this repo).

- `20260728_fix_get_user_role_ambiguity.sql` + `20260727_prevent_role_self_escalation.sql`
  — the role self-escalation trigger + its prerequisite (were listed MISSING
  below; now LIVE). Trigger `enforce_user_profile_role_immutable_trigger`.
- `20260805_security_lockdown.sql` — dropped the wide-open "Service role full
  access … TO public USING(true)" policies on support_tickets, ticket_messages,
  admin_notifications, gift_cards, discount_codes, coupon_usage, chat_sessions,
  agent_status (they exposed those tables to the anon key).
- `20260805_02_discount_codes_lockdown.sql` — dropped "Anyone can read active
  discount codes".
- `20260806_security_round2.sql` — `reject_spam_support_ticket` BEFORE INSERT
  trigger (kills the contact-form spam bot) + the `public_profiles` safe view.
- `20260806_03_profiles_cut_anon.sql` — `REVOKE SELECT ON user_profiles FROM
  anon` (closes the email/address/tax_id leak). Kept the "Public profiles
  viewable by all" RLS policy so authenticated cross-user reads still work.

`orders-staff-write` and `landing-page-suggestions` (below) remain PENDING —
unrelated to the security work, left for a separate decision.

## Root cause: why nobody could tell what's applied

Migrations in this repo reach production through **three different, disjoint
paths**, and only one of them is visible to the Supabase CLI:

1. **Supabase CLI** (`supabase db push` / `migration up`) — the only path that
   writes to `supabase_migrations.schema_migrations`. Live has exactly **7
   rows**, oldest `20251224000340`, newest `20251231204047` (all Dec 2025).
2. **Ad hoc Node/`pg` scripts** that open a direct `pg.Client`/`Pool` and run
   raw SQL — e.g. `backend/scripts/run-migration-pg.ts` (ran
   `20251209000000_product_assets_role_columns.sql` by hand),
   `scripts/fix-rls.mjs` (ran only the `CREATE FUNCTION get_user_role`
   statement out of `005_rls_fixes.sql`, nothing else in that file). **These
   never touch `schema_migrations`.**
3. **Manual SQL** (Supabase Studio SQL editor, or similar) — indistinguishable
   from (2) after the fact.

Because most of this repo's real history went through (2)/(3), **the 7-row
`schema_migrations` table is not an honest ledger of what's live**, and cannot
be trusted for a "what's applied" answer. This audit went object-by-object
against the live catalog instead. That's also why the 7 tracked rows use full
14-digit timestamp versions (`20251224121126`, `add_3d_model_licenses`, etc.)
that don't match ANY current filename in this repo — those files were
originally created with `supabase migration new` (which auto-generates a
14-digit stamp), applied under those names, and later renamed locally to the
short `YYYYMMDD_name.sql` convention without ever repairing the remote ledger.
**Every file discussed below was already desynced from `schema_migrations`
before this audit touched anything.**

## Which branch you're reading this on matters

This campaign runs many agents across many unmerged branches sharing one
working tree. This ledger describes the file state on
**`earth/zero-nine/itp-payments-hardening`** (current branch as of this audit).
Two sibling branches materially change the picture and are **not merged
here**:

- `earth/iahhm/consolidate-database-sch-c759b3d4-ms2cp0pn` (commit `7bf3d36`) —
  ports 8 migrations out of the root `migrations/` directory into
  `supabase/migrations/` with proper timestamps, and deletes `migrations/`,
  `backend/migrations/`, `backend/db/migrations/`, `backend/supabase/migrations/`,
  `backend/prisma/migrations/`, root `prisma/` entirely. Its own README
  documents the exact same two ordering bugs this audit fixes (see below) and
  explicitly deferred fixing them for the same reason this task now had to
  weigh: renaming an applied migration is dangerous.
- `earth/iahhm/fix-award-order-rewards-e9034a97-ms3eu9v5` (commit `cbbbc5c`) —
  adds `20260727_fix_award_order_rewards.sql` and a superseded-banner on
  `migrations/006_reward_system.sql`.

**The live database already reflects both of those branches' intended end
state**, even though neither branch is merged anywhere yet — the SQL was run
against production directly (path 2/3 above) as part of doing that work. This
is exactly the drift mechanism described above, caught in the act: branch
merge state and live DB state are two different timelines in this repo. Don't
infer "is this applied" from `git log`/`git branch --contains`. Query the
database.

Also touched by a concurrent agent in this same session: `20260728_fix_get_user_role_ambiguity.sql`
and a rewrite of `src/pages/OrderManagement.tsx` / `backend/routes/orders.ts`
(see the "manager order-write" section below) — both already sitting in this
working tree as of this audit.

## Canonical directories, going forward

| Concern | Canonical location | Status |
|---|---|---|
| PostgreSQL / Supabase migrations | `supabase/migrations/` | ACTIVE — keep adding here |
| Prisma model layer | `backend/prisma/schema.prisma` | ACTIVE |
| Root `migrations/` | — | LEGACY. 7 files, all either superseded-by-live-drift or already ported elsewhere. See table below. Do not add new files here. |
| `backend/migrations/`, `backend/db/migrations/`, `backend/supabase/migrations/`, `backend/prisma/migrations/` | — | STRAY DUPLICATES, mostly single files each, superseded by files in `supabase/migrations/`. Not deleted by this audit (out of scope for tasks `5b86e9ac`/`3390cc85`/`c5335439` — `7bf3d36` already deletes them, pending merge). Do not add new files here. |

## `supabase/migrations/` — file-by-file status

Legend: **APPLIED** = live objects verified to exist and match the file.
**APPLIED (drifted)** = live objects exist but their shape differs from what
the file declares (file is a no-op today; do not trust its `CREATE TABLE`
shape as documentation of live reality). **NEVER APPLIED** = live objects
confirmed absent. **NOT RE-VERIFIED** = not independently re-checked in this
pass; classified by strong circumstantial evidence only (noted per row) —
treat as a lead, not a fact, until someone runs the actual query.

| File | Status | Evidence |
|---|---|---|
| `001_initial_schema.sql` | APPLIED | Baseline; `orders`, `user_profiles`, `products`, etc. all live. |
| `002_rls_policies.sql` | APPLIED (partially superseded) | Original policies; many later replaced by `005`'s function-based versions where `005` actually shipped (see below). |
| `003_user_triggers.sql` | APPLIED (drifted) | `handle_new_user()` is live but its current body is **not** this file's — it's the hardcoded-role version from `20260727_signup_role_hardcode_customer.sql` territory (see that row). |
| `004_schema_fixes.sql` | NOT RE-VERIFIED | Not individually queried this pass. |
| `005_rls_fixes.sql` | **APPLIED (PARTIALLY — this is the one to know)** | `get_user_role()` exists live, but was created by `scripts/fix-rls.mjs` running *only* that one `CREATE FUNCTION` statement out of this file — not the file itself. None of the file's `CREATE POLICY` statements for `orders` shipped (`orders` RLS live has exactly one policy, `"Users can view their own orders"`, SELECT-own-only — confirmed via `pg_policies`). `cost_variables` **does** have `"Admins have full access to all cost variables"` live (matches this file's policy name) via an unknown out-of-band path — so this file was applied piecemeal, table by table, not as a unit. `user_profiles`/`user_wallets`/`products`/`product_cost_breakdowns` policies from this file were checked and are **not** live under these names either (different, older policy names are live instead). Treat every policy this file declares as independently unverified until checked — do not assume "one policy from this file is live" implies the rest are. |
| `20251130153953_add_metadata_column_to_product_assets.sql` | Was **EMPTY (0 bytes)**, now fixed by this audit | Live `product_assets.metadata` column exists (applied via the `backend/supabase/migrations/` duplicate or another out-of-band run); canonical file restored to match live, idempotent. A from-scratch `supabase db reset` would previously have silently skipped this column. |
| `20251209000000_product_assets_role_columns.sql` | APPLIED | `asset_role`/`is_primary`/`display_order` all live on `product_assets`. Applied by hand via `backend/scripts/run-migration-pg.ts` (untracked in `schema_migrations`). |
| `20251211_imagination_station.sql` | NOT RE-VERIFIED | `imagination_pricing` table confirmed to exist (see `20260612` row below), strongly implying this shipped, but not independently re-checked. |
| `20251219_coupons_giftcards_support.sql` | NOT RE-VERIFIED | `7bf3d36`'s README claims this table's `message`/`sender_type` shape is the live one (vs. `backend/db/migrations/01_support_system.sql`'s `content` shape) — not independently re-confirmed here. |
| `20251220_performance_indexes.sql` | NOT RE-VERIFIED | Indexes only; low risk either way (`CREATE INDEX IF NOT EXISTS` is safe to re-run). |
| `20251222000000_marketing_campaigns.sql` (renamed, was `20251222_marketing_campaigns.sql`) | NOT RE-VERIFIED | Referenced for its RLS convention (manager = write-equivalent to admin) in task `3390cc85`'s fix; not independently re-verified as applied. Renamed for prefix uniqueness (see "ordering fix" below) — self-contained, no cross-file ordering risk. |
| `20251222000001_social_content.sql` (renamed, was `20251222_social_content.sql`) | NOT RE-VERIFIED | Same as above. |
| `20251222000002_platform_settings.sql` (renamed, was `20251222_platform_settings.sql`) | NOT RE-VERIFIED | Renamed for prefix uniqueness. |
| `20251223000000_email_templates.sql` | NOT RE-VERIFIED | — |
| `20251224000000_user_3d_models.sql` (renamed, was `20251224_user_3d_models.sql`) | APPLIED (untracked under this name) | `user_3d_models` table live; tracked in `schema_migrations` under version `20251224121126` / name `user_3d_models` — a different version string than any filename that has ever existed for it. See "Ordering fix" below. |
| `20251224000001_3d_models_licenses.sql` (renamed, was `20251224_3d_models_licenses.sql`) | APPLIED (untracked under this name) | `user_3d_models.purchased_licenses` column live; tracked under version `20251224160017` / name `add_3d_model_licenses`. |
| `20251230000000_product_variants.sql` (renamed, was `20251230_product_variants.sql`) | NOT RE-VERIFIED | Renamed for prefix uniqueness — altered `products` only, no cross-file ordering risk. |
| `20251230000001_profile_storage_buckets.sql` (renamed, was `20251230_profile_storage_buckets.sql`) | NOT RE-VERIFIED | Renamed for prefix uniqueness. |
| `20251231000000_founder_invoices.sql` (renamed, was `20251231_founder_invoices.sql`) | APPLIED (untracked under this name) | `founder_invoices` table live; tracked under version `20251231202037`. |
| `20251231000001_admin_invoices.sql` (renamed, was `20251231_admin_invoices.sql`) | APPLIED (untracked under this name) | `founder_invoices.invoice_type` column live; tracked under version `20251231204047`. |
| `20251231000002_community_features.sql` (renamed, was `20251231_community_features.sql`) | APPLIED, **NOT tracked at all** | `community_posts`/`community_boosts` live, but no corresponding row exists in `schema_migrations` under any version — applied entirely out-of-band. |
| `20251231000003_stripe_connect_cashout.sql` (renamed, was `20251231_stripe_connect_cashout.sql`) | APPLIED (untracked under this name) | `stripe_connect_accounts`/`itc_cashout_requests` live; tracked under version `20251231151403`. |
| `20260428_decrement_itc_atomic.sql` | **NEVER APPLIED — live incident risk** | `public.decrement_itc(uuid, numeric)` does not exist in `pg_proc`. `backend/routes/wallet.ts` calls this RPC live — any code path that hits it is 500ing today. Not fixed by this audit (out of scope for `5b86e9ac`/`c5335439`/`3390cc85`); flagging for a follow-up task. |
| `20260612000000_imagination_reimagine_pricing.sql` (renamed, was `20260612_imagination_reimagine_pricing.sql`) | APPLIED | `imagination_pricing` rows `reimagine_standard`/`reimagine_premium` confirmed present via `SELECT`. Renamed for prefix uniqueness — pure `INSERT ... ON CONFLICT DO NOTHING`, no ordering risk. |
| `20260612000001_email_system.sql` (renamed, was `20260612_email_system.sql`) | APPLIED | `email_mailboxes`/`email_messages` tables live. Renamed for prefix uniqueness. |
| `20260613_email_signatures.sql` | APPLIED | `email_mailboxes.signature_title` column live (file likely adds more signature columns; only this one spot-checked). |
| `20260614_audit_logs.sql` | APPLIED | `audit_logs` table live. |
| `20260629_tshirt_print_locations.sql` | NOT RE-VERIFIED | `products` table columns not individually diffed for this file's additions. |
| `20260706000000_blank_inventory.sql` (renamed, was `20260706_blank_inventory.sql`) | APPLIED | `blank_inventory`, `blank_inventory_movements` tables and `record_blank_sale()` function all live. Renamed for prefix uniqueness — self-contained. |
| `20260706000001_product_seo_columns.sql` (renamed, was `20260706_product_seo_columns.sql`) | APPLIED | `products.meta_title`/`meta_description`/`search_keywords` live. Renamed for prefix uniqueness. |
| `20260706000002_social_outbox.sql` (renamed, was `20260706_social_outbox.sql`) | APPLIED | `social_outbox` table live. Renamed for prefix uniqueness. |
| `20260710_merch_studio_storefront.sql` | APPLIED | `products.cost_price` live. |
| `20260714_product_alt_text.sql` | APPLIED | `products.alt_text` live. |
| `20260724_etsy_integration.sql` | APPLIED | `etsy_oauth_states`, `etsy_connection`, `etsy_listings` all live. |
| `20260725_email_forwarding.sql` | NOT RE-VERIFIED | `email_mailboxes` confirmed to exist generally; this file's specific columns not individually checked. |
| `20260727_prevent_role_self_escalation.sql` | **NOT APPLIED — and must not be, alone** | `enforce_user_profile_role_immutable_trigger` confirmed absent from `pg_trigger`. Its trigger body calls `public.get_user_role()`, which is currently broken live (see next row) — **do not apply this file without `20260728_fix_get_user_role_ambiguity.sql` in the same push.** If this file ever applies on its own, every role-changing `UPDATE user_profiles` (including David's own admin tooling) will start raising `column reference "user_id" is ambiguous` and role management breaks. See "Ordering / dependency constraints" below. |
| `20260727_signup_role_hardcode_customer.sql` | APPLIED (drifted from `003`) | Live `handle_new_user()` already hardcodes `default_role := 'customer'` with an admin-email allowlist, matching this file's intent — confirmed via `pg_get_functiondef`. Applied out-of-band, not tracked. |
| `20260727_fix_itc_wallet_schema_drift.sql` | APPLIED | `itc_transactions`/`user_wallets` live columns match the corrected shape this file documents (`itc_transactions`: id/user_id/type/amount/reference/balance_after/metadata/created_at; `user_wallets` has `points`, no `points_balance`). |
| `20260727_imagination_layers_allow_shape.sql` | APPLIED | `imagination_layers` table live (specific column not isolated, but table-level presence is a strong signal — this file only alters an existing table). |
| `20260728_fix_get_user_role_ambiguity.sql` | **NOT YET APPLIED — fixes a live-broken function** | Added by a concurrent agent in this session. Verified live: `public.get_user_role(uuid)` currently raises `ERROR: column reference "user_id" is ambiguous` on **every call** — `user_profiles` has both `id` and a drifted `user_id` column, and the original `005_rls_fixes.sql` body (`WHERE id = user_id`) can't tell them apart. This file qualifies every reference (`up.id`, `up.role`, `get_user_role.user_id`) without dropping/renaming the function (a rename or `DROP FUNCTION` would cascade into every RLS policy that calls it). Confirmed correct by direct read. **This is the single highest-priority migration in this ledger** — every RLS policy in this repo that calls `get_user_role()` (there are ~15+) is silently broken until this applies. |
| `20260728120000_orders_staff_write_access.sql` | **NOT YET APPLIED — new, added by this audit** | See "manager order-write" section below. |

## `migrations/` (root, legacy) — file-by-file status

| File | Status | Notes |
|---|---|---|
| `006_reward_system.sql` | **SUPERSEDED — banner added by this audit, do not apply** | Live `itc_transactions`/`points_transactions` are in a corrected shape this file doesn't match (see banner in the file for exact column diff). `order_rewards`, `referral_codes`, `referral_transactions`, `user_total_spend`, `award_order_rewards()`, `process_referral_reward()` are all live and correct, fixed via commit `cbbbc5c` on an unmerged sibling branch — the corrected SQL is already live even though that branch isn't merged. Applying this file today would `CREATE OR REPLACE` the two RPCs back into their broken, phantom-column form, silently re-breaking order rewards exactly as they were broken from 2025-11-10 until the `cbbbc5c` fix. |
| `2025-11-04-ai-product-builder.sql` | APPLIED, untracked | `ai_jobs`/`product_assets`/`product_categories`/`product_tags`/`product_variants` all live. Ported (with a corrected timestamp so it CREATEs before later ALTERs) into `supabase/migrations/20251104000000_ai_product_builder.sql` on the unmerged `7bf3d36` branch — not present under that name here. |
| `2025-12-09-product-assets-role-columns.sql` | APPLIED, byte-for-byte duplicate | Identical content to `supabase/migrations/20251209000000_product_assets_role_columns.sql`, which is the one that actually ran (see table above). Orphaned duplicate. |
| `add_product_mockups_table.sql` | APPLIED, untracked | `product_mockups` table live, used by `backend/routes/mockups.ts`/`designer.ts`. |
| `create_wallet_transactions_table.sql` | **ORPHANED — describes a table that was never built this way** | Live `wallet_transactions` has columns `transaction_type`/`amount [integer]`/`balance_before`/`balance_after`/`reference_id`/`reference_type`/`description` — completely different from this file's `type`/`currency`/`amount [decimal]`/`admin_id` shape. No code in this repo writes to the shape this file declares (admin wallet routes write to `itc_transactions` instead). Do not apply. |
| `sync_product_images.sql` | APPLIED (this is the live version) | Live `sync_product_images()` matches this file's body exactly (`kind IN ('mockup','source')` only) — **not** the newer `fix_` version below. |
| `fix_sync_product_images.sql` | **NEVER APPLIED — live gap** | Meant to widen the sync to `kind IN ('mockup','dtf','source','nobg','upscaled')`. Live function body is still the 2-kind version from `sync_product_images.sql` above, confirmed via `pg_get_functiondef`. Products with only DTF/nobg/upscaled assets are missing images in `products.images` today. Out of scope to fix in this pass; flagging for follow-up. |

## Other stray migration directories (found, not audited in depth)

Out of scope for `c5335439`'s stated deliverable ("audit `migrations/` and
`supabase/migrations/` against each other") but discovered during this pass —
worth knowing they exist:

- `backend/prisma/migrations/{001,002,003}_*.sql` — smaller (86-105 lines)
  subsets of `supabase/migrations/{001,002,003}_*.sql` (277-422 lines). Not a
  valid Prisma migration layout (Prisma expects `<timestamp>_<name>/migration.sql`
  directories, not loose `.sql` files) — Prisma almost certainly never reads
  these. Orphaned.
- `backend/migrations/add-metadata-column-to-product-assets.sql`,
  `create_admin_settings.sql`, `create_user_royalty_system.sql` — the latter
  two's target tables (`admin_settings`, `user_product_royalties`) are
  confirmed live with matching shapes; likely the actual source of those two
  tables, applied out-of-band.
- `backend/db/migrations/01_support_system.sql` — earlier draft of support
  tables, believed superseded by `20251219_coupons_giftcards_support.sql`
  (not independently re-verified this pass).
- `backend/supabase/migrations/20251130153953_add_metadata_column_to_product_assets.sql` —
  the non-empty twin of the canonical file this audit just restored.

None of these were modified by this audit (not in scope for the three tasks
this ledger closes out). The unmerged `7bf3d36` branch already deletes all of
them.

## The 2026-07-28 ordering fix (`5b86e9ac`)

**Bugs found**, both pre-existing (not introduced by any work in this
campaign):

1. `supabase/migrations/20251224_3d_models_licenses.sql` `ALTER`s
   `user_3d_models`, which `20251224_user_3d_models.sql` `CREATE`s. Lexical
   sort put the `ALTER` first (`3` < `u`) — a from-scratch `supabase db reset`
   would fail here.
2. `supabase/migrations/20251231_admin_invoices.sql` `ALTER`s
   `founder_invoices`, which `20251231_founder_invoices.sql` `CREATE`s. Same
   bug (`a` < `f`).
3. Four files shared the bare `20251231` version prefix
   (`admin_invoices`/`community_features`/`founder_invoices`/`stripe_connect_cashout`) —
   the Supabase CLI requires unique prefixes; three of the four could never
   have been tracked simultaneously under that prefix.

**Safety check performed before renaming anything** (per this task's explicit
instruction — renaming an applied migration can corrupt the live ledger):
queried `supabase_migrations.schema_migrations` directly. All six affected
files' *current* filenames (`20251224_*`, `20251231_*`) **already fail to
match any row** in that table — the table's real entries use full 14-digit
timestamps (see "Root cause" above) that predate the short-name convention
these files were renamed to at some earlier point in this repo's history.
**Renaming these files again changes their match status from
"already-mismatched" to "still-mismatched" — a no-op for `schema_migrations`
purposes.** No already-tracked-and-matching migration was touched. This is
the basis for treating the renames as safe rather than merely convenient.

**Fix applied**: renamed to full 14-digit-safe unique prefixes, `CREATE`s
sorting before their `ALTER`s:

- `20251224_user_3d_models.sql` → `20251224000000_user_3d_models.sql`
- `20251224_3d_models_licenses.sql` → `20251224000001_3d_models_licenses.sql`
- `20251231_founder_invoices.sql` → `20251231000000_founder_invoices.sql`
- `20251231_admin_invoices.sql` → `20251231000001_admin_invoices.sql`
- `20251231_community_features.sql` → `20251231000002_community_features.sql`
- `20251231_stripe_connect_cashout.sql` → `20251231000003_stripe_connect_cashout.sql`

**Scope note**: `5b86e9ac`'s deliverables list named exactly those six files.
While re-running the ordering/uniqueness check the task also asked for
(deliverable 5, "re-run the ordering check documented in the README"), this
audit found the acceptance criterion ("all migration files have unique
version prefixes") was violated by four more **pre-existing** collision
groups the task description didn't mention, none with cross-file
CREATE/ALTER ordering issues (each file only touches its own new tables or
already-live tables) but all equally untrackable by the CLI. Verified safe by
the same method as above (none of their prefixes match any live
`schema_migrations` row either) and fixed in the same pass rather than
leaving the acceptance criterion half-met:

- `20251222_marketing_campaigns.sql` / `_social_content.sql` / `_platform_settings.sql` → `20251222000000_…` / `20251222000001_…` / `20251222000002_…`
- `20251230_product_variants.sql` / `_profile_storage_buckets.sql` → `20251230000000_…` / `20251230000001_…`
- `20260612_imagination_reimagine_pricing.sql` / `_email_system.sql` → `20260612000000_…` / `20260612000001_…`
- `20260706_blank_inventory.sql` / `_product_seo_columns.sql` / `_social_outbox.sql` → `20260706000000_…` / `20260706000001_…` / `20260706000002_…`

**What this fix does NOT do**: reconcile `schema_migrations`. These files
remain untracked under their new names exactly as they were untracked under
their old names. A `supabase db push` against production today would still
attempt to (re-)apply all six — each `CREATE TABLE`/`ADD COLUMN` is
`IF NOT EXISTS` (safe, no-op) but every bare `CREATE POLICY` in these files
(no `DROP POLICY IF EXISTS` guard) would error `policy already exists`. **This
was already true before the rename; renaming did not create this risk.**
Reconciling it is a separate, deliberate, live-write action — see "For David"
below.

## Ordering / dependency constraints (read this before running `db push`)

1. `20251224000000_user_3d_models.sql` before `20251224000001_3d_models_licenses.sql` (CREATE before ALTER, enforced by filename now).
2. `20251231000000_founder_invoices.sql` before `20251231000001_admin_invoices.sql` (CREATE before ALTER, enforced by filename now).
3. **`20260728_fix_get_user_role_ambiguity.sql` must apply before or together with `20260727_prevent_role_self_escalation.sql`.** Filenames currently sort the *other* way (`27` before `28`) — that's fine for a single atomic `db push` that applies both in the same run (nothing calls the trigger in the gap between the two statements executing), but **do not apply `20260727_prevent_role_self_escalation.sql` in isolation** while `get_user_role()` is still broken, or every admin role change starts failing with `column reference "user_id" is ambiguous` the moment the trigger goes live.
4. `20260728120000_orders_staff_write_access.sql` (this audit's new file) depends on `20260728_fix_get_user_role_ambiguity.sql` — named with a later 14-digit prefix specifically so it sorts after.

## Manager order-write mismatch (`3390cc85`)

**Diagnosis**: `src/pages/OrderManagement.tsx:284` gates the whole page to
`admin`/`manager`/`founder`. The RLS policy `005_rls_fixes.sql` intended for
`orders` (`"Admins have full access to all orders"`, admin/founder only) was
never actually applied live (see the `005` row above) — live `orders` RLS has
exactly one policy, self-view SELECT only. So the mismatch as originally
filed was real, but worse than described: **no staff role**, not just
manager, could write to `orders` via a direct browser/RLS path.

**A concurrent agent in this same working tree already fixed the live
user-facing bug** by moving `OrderManagement.tsx`'s writes off the browser
Supabase client entirely, onto `PATCH /api/orders/:orderId`
(`backend/routes/orders.ts:294`), gated by
`requireRole(['admin','manager','founder'])`. That backend client runs on
`SUPABASE_SERVICE_ROLE_KEY` (`backend/lib/supabase.ts:5`), which bypasses RLS
— so authorization for this path is enforced entirely by the Express
middleware now, and manager writes already work end-to-end with explicit
success/failure toasts (`extractApiError`). **Deliverables 1 and 4 from task
`3390cc85` are already done, by that other agent, not by this ledger.**

**Decision on the underlying security question** (independently reached the
same way, before finding the other agent's fix): manager **should** have
order write access. Every other RLS-gated write surface in this schema treats
`manager` as write-equivalent to `admin` — `marketing_campaigns` (INSERT/UPDATE),
`email_templates`, `social_content`, `20251231_community_features` (renamed
`20251231000002_...`), and `cost_variables` (`"Managers can manage their cost
variables"`, live today) all do this. `orders` was the outlier by omission,
not by design.

**What this audit added on top**: `20260728120000_orders_staff_write_access.sql`
restores `005`'s never-shipped `"Admins have full access to all orders"`
policy and adds a new `"Managers can update orders"` policy (UPDATE only, not
DELETE — no delete-order flow exists in the app and it wasn't asked for). This
is not what fixes the live bug (the backend route already does); it closes
the actual RLS-layer gap task `3390cc85` named in its objective ("ensure UI
role gates align with database RLS policies"), and is defense-in-depth if a
browser-side write path to `orders` is ever reintroduced.

## LIVE, GROWING collision — found mid-audit, NOT fixed, needs coordinator routing

This surfaced *while this ledger was being written*, from other agents' concurrent
commits landing in this same shared working tree, and **kept changing while
this section was being written** — file counts below are a snapshot, not a
stable fact. Flagging instead of fixing because these are other agents'
in-flight files, not something in the three tasks this pass closes out, and
touching them mid-edit risks colliding with work in progress. **The pattern
matters more than the exact count**: this working tree is actively
regenerating the exact bug task `5b86e9ac` fixed, in real time, faster than
one agent can chase it file-by-file.

**Two more duplicate-prefix groups, neither present when this audit started
(snapshot ~2026-07-28, mid-session):**

- `20260727` — at least five files seen: `fix_itc_wallet_schema_drift`,
  `imagination_layers_allow_shape`, `prevent_role_self_escalation`,
  `signup_role_hardcode_customer` (all four pre-existing), plus
  `refunds_and_disputes` (new this session).
- `20260728` — at least eight files seen and climbing:
  `backfill_user_profiles_user_id`, `email_unmatched_inbound`,
  `etsy_receipts_and_inventory_sync`, `fix_get_user_role_ambiguity`,
  `kiosk_device_sessions`, `refund_reward_reversal`,
  `social_outbox_scheduled_for`, `wholesale_applications` (all new this
  session; this ledger's own `20260728120000_orders_staff_write_access.sql`
  uses a 14-digit prefix specifically to avoid adding to this group).

Checked all twelve for the CREATE-before-ALTER ordering bug this ledger
already fixed once (`5b86e9ac`) — **none of them collide that way**; each
either creates its own new table or alters an existing live table
(`itc_transactions`, `user_wallets`, `imagination_layers`, `orders`,
`etsy_connection`, `coupon_usage`, `blank_inventory_movements`,
`user_product_royalties`, `admin_notifications`), never a table created by
another file in the same group.

**One of them is a real correctness bug, not just an untrackable-prefix
nuisance**: `20260727_refunds_and_disputes.sql` and
`20260728_wholesale_applications.sql` both `DROP CONSTRAINT IF EXISTS` +
`ADD CONSTRAINT admin_notifications_type_check` on the same table, with
**different, non-overlapping allowed values** —
`refunds_and_disputes` adds `'payment_dispute'`, `wholesale_applications` adds
`'wholesale_application'`, and neither includes the other's. Applied in
filename order (727 then 728, since both are new/never-applied — no
already-tracked version to worry about here), the second file's `DROP
CONSTRAINT` silently removes `'payment_dispute'` as an allowed value. Whoever
owns `refund_reward_reversal`/`refunds_and_disputes` needs to know the value
they added will vanish unless one of these two files is updated to include
both values in its `CHECK (type IN (...))`.

**Recommendation for the coordinator**: route the prefix collisions back to
whichever agents own `refunds_and_disputes`/`wholesale_applications` (constraint
conflict, needs a real merge of the two CHECK lists — not just a rename) and
have the remaining `20260728_*` bare-date files renamed to unique full
14-digit timestamps before this branch's migrations are considered ready,
same pattern this ledger used for `20260728120000_orders_staff_write_access.sql`.

## Other drift observed, not fixed (out of scope for this pass)

- `20260428_decrement_itc_atomic.sql`'s `decrement_itc(uuid, numeric)` is
  **never applied live**; `backend/routes/wallet.ts` calls it. Live incident
  risk — recommend filing a follow-up task at the same severity as the
  reward-system incident (`e9034a97`).
- `migrations/fix_sync_product_images.sql` never applied; live
  `sync_product_images()` is still the narrower 2-kind version. Products with
  only DTF/nobg/upscaled assets are missing from `products.images`.
- `social_posts.status` three-way drift (reported by the build agent this
  session, spot-checked here): live CHECK constraint allows
  `approved/featured/hidden`; the frontend `Order`-adjacent type previously
  said `pending/approved/rejected/featured` (written against a different
  table, `social_submissions`) and has since been narrowed to match the wire
  by that same agent. Not this ledger's area; logged for awareness only.
- `20260726_cost_variables.sql` does **not exist** in this working tree —
  it's only on unmerged commit `1ada658`
  (`earth/zero-nine/persist-manager-cost-var-fe413f2e-ms2cs8qp`). Anything
  that assumes it's part of the current tree is wrong.

## For David — exact next steps, in order

Nothing below was run by this audit. All of it writes to production; treat as
a reviewed, deliberate action, not a rubber stamp.

1. **Apply `20260728_fix_get_user_role_ambiguity.sql` first, alone or together
   with everything below it** — this unblocks every RLS policy in the repo
   that calls `get_user_role()`, including the two below.
2. Then `20260727_prevent_role_self_escalation.sql` and
   `20260728120000_orders_staff_write_access.sql` (both depend on step 1).
3. Reconcile `schema_migrations` for the untracked-but-live migrations listed
   as "APPLIED, untracked" above, so future `supabase db push` runs stop
   trying to re-apply them. The CLI's own mechanism for this is
   `supabase migration repair --status applied <version>` run once per
   version, using each file's *current* filename-derived version (not the
   old 14-digit ones in the table — those correspond to filenames that no
   longer exist anywhere). This does not change any table/column/function;
   it only edits the ledger row.
4. File the two "other drift observed" items above as their own follow-up
   tasks (`decrement_itc` missing is the more urgent of the two — it's an
   active 500, not just a data-completeness gap).
5. Decide whether to merge `earth/iahhm/consolidate-database-sch-c759b3d4-ms2cp0pn`
   (`7bf3d36`) — once merged, this ledger's "root `migrations/` / stray
   directories" sections collapse to "deleted," and the ordering-bug section
   above becomes redundant with that branch's own fix (verify the merge
   doesn't reintroduce the bare-prefix filenames when combining the two
   branches' renames).

## Keeping this ledger honest going forward

- Any new migration PR should update this file's "file-by-file status" table
  in the same PR — don't let it drift again.
- Prefer full 14-digit timestamp prefixes (`YYYYMMDDHHMMSS`) over bare dates
  for any migration landing the same day as another, per
  `supabase/migrations/README.md` rule 1.
- If you must apply a migration by hand (`pg`/`psql`, not `supabase db push`),
  also manually insert the matching row into
  `supabase_migrations.schema_migrations (version, name, statements)` so the
  CLI's ledger doesn't drift further from reality. This is the single biggest
  lever available to stop this problem from recurring — everything in this
  document exists because that step kept getting skipped.

## New since this ledger was written

| File | Applied to prod? | Notes |
|---|---|---|
| `20260816_virtual_tryon.sql` | **NO — pending** | Watchtower task 3b362203. Creates `virtual_tryon_runs`, `virtual_tryon_daily_usage`, `virtual_tryon_events`, the `virtual_tryon_conversion` view, and seeds two `imagination_pricing` rows (`tryon_standard`, `tryon_premium`). Idempotent: every CREATE is `IF NOT EXISTS`, policies are `DROP POLICY IF EXISTS` first, and the pricing seed is `ON CONFLICT DO NOTHING`. Safe to re-run. The feature stays dark without `FASHN_API_KEY`, so applying this early is harmless. |
| `20260816_02_tryon_photo_retention.sql` | **NO — pending** | Watchtower task f3bf450c. Adds `virtual_tryon_runs.photos_purged_at` (audit stamp for the automatic photo-retention sweep) plus the partial index `idx_tryon_runs_retention` that the sweep's query rides. Additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`); order against `20260816_virtual_tryon.sql` does not matter as long as that one is applied first. **The sweep does not depend on this migration** — `purgeRow()` retries the write without the stamp if PostgREST reports the column missing, so an unapplied migration costs the audit timestamp and the index, not the deletions. |
