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

## Known pre-existing ordering bugs (NOT introduced by the consolidation)

Two migrations ALTER a table that a *later-sorting* migration CREATEs, so a from-scratch
`supabase db push` fails on them:

1. `20251224_3d_models_licenses.sql` ALTERs `user_3d_models`, CREATEd in `20251224_user_3d_models.sql`
2. `20251231_admin_invoices.sql` ALTERs `founder_invoices`, CREATEd in `20251231_founder_invoices.sql`

Separately, four migrations share the version prefix `20251231`, which the Supabase CLI
expects to be unique.

Fixing these means renaming already-applied migration files, which changes what
`supabase_migrations.schema_migrations` has recorded — that needs a decision against the live
database, so it was deliberately left alone. Tracked as follow-up work.
