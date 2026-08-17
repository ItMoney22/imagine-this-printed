# Database schema — canonical sources

Consolidated 2026-07-26 (Watchtower task `c759b3d4-4c14-4b02-be11-e41db8e408e0`).

There are exactly **two** sources of schema truth in this repo:

| Concern | Canonical location |
|---|---|
| PostgreSQL / Supabase migrations | `supabase/migrations/` |
| Prisma schema | `backend/prisma/schema.prisma` |

Nothing else. Do not add migrations under `migrations/`, `backend/migrations/`,
`backend/db/migrations/`, `backend/supabase/migrations/`, or `backend/prisma/migrations/` —
all of those were merged into the timeline above and deleted.

## What was folded in

These migrations were recovered from the deleted directories. They are **load-bearing** —
the timeline could not rebuild a database from scratch without them:

| Migration | Recovered from | Why it matters |
|---|---|---|
| `20251104000000_ai_product_builder.sql` | `migrations/2025-11-04-ai-product-builder.sql` | CREATEs `product_assets`, `ai_jobs`, `product_categories`, `product_tags`, `product_variants` — later migrations ALTER these tables |
| `20251110000000_reward_system.sql` | `migrations/006_reward_system.sql` | `order_rewards` + the `award_order_rewards()` RPC called live by `backend/services/order-reward-service.ts` |
| `20251110000001_product_mockups.sql` | `migrations/add_product_mockups_table.sql` | `product_mockups`, used live by `backend/routes/mockups.ts` and `designer.ts` |
| `20251110000002_wallet_transactions.sql` | *rewritten* — see note below | ITC ledger written by the mockup / imagination-station spend+refund paths |
| `20251130153953_...product_assets.sql` | `backend/supabase/migrations/` | The canonical copy was committed **empty (0 bytes)**; content restored |
| `20251209000001_sync_product_images.sql` | `migrations/fix_sync_product_images.sql` | `sync_product_images()` + `auto_sync_product_images` trigger |
| `20251209000002_admin_settings.sql` | `backend/migrations/create_admin_settings.sql` | `admin_settings`, used live by `backend/services/minimax-voice.ts`; defines shared `update_updated_at_column()` |
| `20251209000003_user_product_royalties.sql` | `backend/migrations/create_user_royalty_system.sql` | `user_product_royalties`, used live by the user-product approval + royalty routes |

Timestamps were chosen so each table is CREATEd before any migration ALTERs it.
Ported files were made **idempotent** (`IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`)
so they are no-ops against the live database, which already has these objects.

### Note on `wallet_transactions`

`20251110000002_wallet_transactions.sql` is **not** a verbatim port. The orphaned
`migrations/create_wallet_transactions_table.sql` described a different table
(`type` / `currency` / `reason` / `admin_id`, DECIMAL balances) that **no code writes to** —
the admin wallet routes it was written for actually write to `itc_transactions`. The
committed shape is reconstructed from the live writers instead. See the file header.

**Verified against live production 2026-08-17** (Watchtower task `8dccb9da`), via read-only
`information_schema` / `pg_indexes` / `pg_policies` / `pg_constraint` introspection against
prod (project `czzyrmizvjqlifcivrhn`, through the Supabase Management API's SQL endpoint using
the vault's `database.SUPABASE_MANAGEMENT_PAT_ITP`). The 2026-07-26 reconstruction had three
drifts from the live catalog, now corrected:

1. `user_id`'s FK targets `public.user_profiles(id)`, not `auth.users(id)`.
2. `transaction_type` carries a live `CHECK` constraint (`mockup_generation`, `mockup_refund`,
   `background_removal`, `image_upscale`, `purchase`, `reward`, `admin_adjustment`) — `'spend'`,
   named in the original column comment, is not actually an allowed value live.
3. Only one RLS policy exists live (`wallet_transactions_owner_select`, owner SELECT). The
   committed file additionally had an admin-SELECT policy and an **open INSERT policy**
   (`WITH CHECK (true)`, no `TO` clause) that were never applied to prod — the INSERT policy
   would have let any authenticated/anon caller forge ledger rows had it ever run. Removed
   rather than fixed forward: all live writers use the service-role key, which bypasses RLS,
   so no INSERT policy is needed.
4. `idx_wallet_transactions_type` and `idx_wallet_transactions_reference` don't exist live —
   dropped from the file so the migration is a true no-op against production, as its header
   claims. Add them as a fresh forward migration if a query pattern ends up needing them.

## Dropped as obsolete

- `migrations/sync_product_images.sql` — superseded by `fix_sync_product_images.sql`
- `backend/db/migrations/01_support_system.sql` — earlier draft of the support tables using
  `content`; the live schema and all live code use `message` + `sender_type`, per
  `20251219_coupons_giftcards_support.sql`
- `backend/prisma/migrations/00{1,2,3}_*.sql` — a 4-table subset of `supabase/migrations/001`,
  and not valid Prisma migrations (Prisma expects `<timestamp>_<name>/migration.sql`)
- `migrations/2025-12-09-product-assets-role-columns.sql` — byte-identical duplicate of
  `20251209000000_product_assets_role_columns.sql`
- `prisma/schema.prisma` (root) — nothing in `src/` imports Prisma; `backend/prisma` is canonical

`COMPLETE_DATABASE_SETUP.sql` was moved to `archive/database/` as a historical snapshot.
It is **not** part of active schema management — do not apply it.

## Pre-existing ordering bugs — RESOLVED 2026-08-17 (Watchtower task `8dccb9da`)

Two migrations ALTERed a table that a *later-sorting* migration CREATEd, so a from-scratch
`supabase db push` would have failed on them, and four migrations shared the version prefix
`20251231`, which the Supabase CLI expects to be unique:

1. `20251224_3d_models_licenses.sql` ALTERed `user_3d_models`, CREATEd in `20251224_user_3d_models.sql`
2. `20251231_admin_invoices.sql` ALTERed `founder_invoices`, CREATEd in `20251231_founder_invoices.sql`
3. `20251231_admin_invoices.sql`, `20251231_community_features.sql`, `20251231_founder_invoices.sql`,
   and `20251231_stripe_connect_cashout.sql` all shared the bare `20251231` version.

**Resolution**: read-only introspection of `supabase_migrations.schema_migrations` on prod
showed every one of these migrations had already been applied — just under their original
full 14-digit timestamps, not the truncated 8-digit dates the consolidation gave the files.
The files were renamed to match those recorded versions exactly, which both fixes the sort
order (CREATE now sorts before its ALTER) and keeps the Supabase CLI's tracking intact — a
version already present in `schema_migrations` is treated as applied and skipped, so this
rename does **not** cause a re-run:

| Old filename | New filename | Live tracking row |
|---|---|---|
| `20251224_user_3d_models.sql` | `20251224121126_user_3d_models.sql` | `20251224121126 / user_3d_models` |
| `20251224_3d_models_licenses.sql` | `20251224160017_add_3d_model_licenses.sql` | `20251224160017 / add_3d_model_licenses` |
| `20251231_stripe_connect_cashout.sql` | `20251231151403_stripe_connect_cashout.sql` | `20251231151403 / stripe_connect_cashout` |
| `20251231_founder_invoices.sql` | `20251231202037_founder_invoices.sql` | `20251231202037 / founder_invoices` |
| `20251231_admin_invoices.sql` | `20251231204047_admin_invoices.sql` | `20251231204047 / admin_invoices` |

`20251231_community_features.sql` → `20251231160000_community_features.sql` is the one
exception: its tables (`community_posts`, `community_boosts`, `community_boost_earnings`)
exist live but there is **no** corresponding row in `schema_migrations` — it was applied to
prod by some non-CLI mechanism (direct SQL) and never tracked. `20251231160000` is a
synthesized, unique timestamp (not recovered from tracking, since none exists), chosen to
sort between the other two `20251231` migrations it has no CREATE/ALTER relationship with —
its position among them is inconsequential. Because its statements are fully idempotent
(`CREATE TABLE IF NOT EXISTS`), the next real `supabase db push` will apply it for the first
time as a safe no-op and finally record it in `schema_migrations`, closing the drift.

All six files were confirmed idempotent before renaming (`IF NOT EXISTS` guards throughout;
the two `INSERT INTO imagination_pricing` statements in the 3d-model files use
`ON CONFLICT (feature_key) DO UPDATE`) — safe to re-run regardless of tracking state.
