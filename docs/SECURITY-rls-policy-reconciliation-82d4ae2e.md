# RLS policy reconciliation — migration chain vs live production

**Watchtower task** `82d4ae2e-cbfa-4331-9eda-51fa6a22d774` (Step 2/10, ITP security)
**Agent** Sifu · **Date** 2026-09-22
**Round 1 security pass** Watchtower `e3e4f5de`, commit `6f095da`
**Forward migration** `supabase/migrations/20260922210000_drop_legacy_wide_open_rls_policies.sql`
**Re-runnable proof** `node scripts/verify-rls-policy-reconciliation.mjs [--live --env=<path to backend/.env>]`

---

## The problem this closes

The August 2026 hardening passes dropped wide-open RLS policies by running SQL
**straight at production** — `20260806_security_round2` work and commit `dbb8476`
(2026-08-19, anon INSERT policies). Production is correct. The repo was not:
`002_rls_policies.sql` and `20251231000002_community_features.sql` still `CREATE`
those policies, and nothing later in the chain dropped them.

Consequence: any environment built by replaying the migration history — a
`supabase db reset`, a staging stack, a DR rebuild, a test database — came up
**wide open** while production was locked. A "fresh environment" was strictly less
safe than production, which is the worst direction for that gap to point.

A wide-open policy here means `FOR ALL` / `FOR INSERT ... WITH CHECK (true)` with
no `TO` clause. No `TO` clause means `TO public`, which includes `anon` — the key
that ships inside the frontend JS bundle. The `service_role` these policies were
named for has `rolbypassrls`, so they never granted the backend anything it did
not already have. Their only real effect was granting anonymous browsers write
access to the money tables.

---

## Method

Ground truth came from the **live production database**, not from reading files:

1. `SELECT … FROM pg_policies WHERE schemaname='public'` against production
   (read-only) → **187 policies**.
2. Static replay: parse every `CREATE POLICY` / `DROP POLICY` in
   `supabase/migrations/*.sql` in filename order (the order the CLI applies them),
   apply them in sequence, keep the final set. Within a file, statement order is
   preserved, because this repo's idempotent house style is
   `DROP POLICY IF EXISTS` immediately followed by `CREATE POLICY` — a naive
   file-level pass would wrongly cancel those out.
3. Diff (2) against (1), restricted to wide-open policies.

A literal replay against a scratch Postgres was **not** used, and deliberately so:
`MIGRATION_LEDGER.md` documents that this chain does not currently replay clean
end-to-end (known ordering bugs, Supabase-only `auth.*` dependencies, and three
disjoint historical apply paths). A failed replay would have proved nothing about
policy posture. The static replay answers exactly the question asked and is
committed as a script so it can be re-run on every change.

---

## Audit result — every wide-open policy in the chain

| # | Table | Policy | Declared in | Live in prod? | Disposition |
|---|---|---|---|---|---|
| 1 | `points_transactions` | `System can insert points transactions` | `002_rls_policies.sql:53` | **ABSENT** | **DROPPED** by the new migration |
| 2 | `itc_transactions` | `System can insert ITC transactions` | `002_rls_policies.sql:60` | **ABSENT** | **DROPPED** |
| 3 | `referral_transactions` | `System can manage referral transactions` | `002_rls_policies.sql:77` | **ABSENT** | **DROPPED** |
| 4 | `order_items` | `System can manage order items` | `002_rls_policies.sql:182` | **ABSENT** | **DROPPED** |
| 5 | `vendor_payouts` | `System can manage vendor payouts` | `002_rls_policies.sql:202` | **ABSENT** | **DROPPED** |
| 6 | `founder_earnings` | `System can manage founder earnings` | `002_rls_policies.sql:209` | **ABSENT** | **DROPPED** |
| 7 | `community_boost_earnings` | `System can insert earnings` | `20251231000002_community_features.sql:247` | **ABSENT** | **DROPPED** |
| 8 | `discount_codes` | `Service role full access to discount codes` | `20251219…:142` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:31` |
| 9 | `coupon_usage` | `Service role full access to coupon usage` | `20251219…:149` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:32` |
| 10 | `gift_cards` | `Service role full access to gift cards` | `20251219…:156` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:30` |
| 11 | `support_tickets` | `Service role full access to support tickets` | `20251219…:166` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:26` |
| 12 | `ticket_messages` | `Service role full access to ticket messages` | `20251219…:181` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:27` |
| 13 | `admin_notifications` | `Service role full access to admin notifications` | `20251219…:185` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:28` |
| 14 | `agent_status` | `Service role full access to agent status` | `20251219…:192` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:34` |
| 15 | `chat_sessions` | `Service role full access to chat sessions` | `20251219…:199` | ABSENT | already dropped forward — `20260805_security_lockdown.sql:33` |
| 16 | `agent_status` | `Anyone can check agent availability` | `20251219…:189` | **LIVE** | **RETAINED** — online/offline flag the chat widget reads; explicitly kept by `20260805_security_lockdown.sql` |
| 17 | `imagination_pricing` | `Anyone can read pricing` | `20251211_imagination_station.sql:96` | **LIVE** | **RETAINED** — public price list |
| 18 | `social_votes` | `Anyone can view votes` | `20251222000001_social_content.sql:141` | **LIVE** | **RETAINED** — public vote counts |
| 19 | `community_boosts` | `Anyone can view boosts` | `20251231000002_community_features.sql:230` | **LIVE** | **RETAINED** — public boost counts |
| 20 | `product_copurchase` | `Anyone can read product co-purchase data` | `20260728_product_copurchase.sql:34` | table not in prod | **RETAINED** — queried by the anon client in `src/utils/product-recommender.ts`; the table does not exist in production (that migration was never applied), so no live state says it was revoked |
| 21 | `email_logs` | `Service can insert email logs` | `20251223000000_email_templates.sql:104` | **LIVE** | **RETAINED** — see *Known residual* |

The brief listed `20251223000000_email_templates.sql:107` among the
`FOR SELECT USING (true)` instances. It is not a SELECT policy — it is
`FOR INSERT TO authenticated WITH CHECK (true)` (row 21). Corrected here.

Rows 8–15 needed no new statement: `20260805_security_lockdown.sql` sorts after
`20251219…` and already drops all eight, so a from-scratch replay never leaves
them. They are listed in the new migration's comment block so the next auditor
does not re-derive it.

---

## Blast radius of the seven drops: none

Every legitimate writer of those seven tables is a service-role path under
`backend/**`, and `service_role` has `rolbypassrls` — RLS is never consulted.
Grepping `src/` (the browser/anon client) for writes to all seven tables returns
exactly one hit:

- `src/context/SupabaseAuthContext.tsx:191` — an `itc_transactions` insert inside
  a wallet-creation fallback. **Already dead in production**: the policy it needed
  was removed live in August, its sibling `user_wallets` insert was locked by
  `20260810_lock_wallet_balance.sql`, and `20260922120000` made the DB trigger the
  single authority for wallet creation. It also swallows the failure
  (`supabase.insert()` returns `{ error }` rather than throwing, and the result is
  discarded), which is why nobody noticed. Filed as a follow-up; not touched here.

Backend write counts confirming the service-role path is the real one:
`order_items` 20, `itc_transactions` 45, `referral_transactions` 7,
`community_boost_earnings` 3, `points_transactions` 2, `email_logs` 5,
`vendor_payouts` 0, `founder_earnings` 0.

---

## One Postgres behaviour that shaped the file

`DROP POLICY IF EXISTS "p" ON public.t` **still raises `42P01` when `t` does not
exist** — `IF EXISTS` covers the policy, not the relation. Verified against
production inside a rolled-back transaction:

```
RESULT: DROP POLICY IF EXISTS on a MISSING table -> ERROR 42P01
        relation "public.definitely_not_a_real_table_zzz" does not exist
```

So each drop in the new migration sits behind a `to_regclass(...) IS NOT NULL`
guard inside a single `DO $$ … $$` block. On a full replay every relation exists
and the guards are free; on a partially provisioned database the migration no
longer aborts. The `DROP POLICY IF EXISTS … ON <table>;` statements themselves are
written out literally, one per line, so they stay greppable.

---

## Verification evidence

`node scripts/verify-rls-policy-reconciliation.mjs --live` — 2026-09-22, exit code `0`:

```
RLS policy reconciliation
=========================
migrations dir : supabase\migrations
replayed set   : 142 policies

wide-open in replayed set : 6
  OK   imagination_pricing||Anyone can read pricing  [SELECT TO public]  PUBLIC READ  <- 20251211_imagination_station.sql
  OK   agent_status||Anyone can check agent availability  [SELECT TO public]  PUBLIC READ  <- 20251219_coupons_giftcards_support.sql
  OK   social_votes||Anyone can view votes  [SELECT TO public]  PUBLIC READ  <- 20251222000001_social_content.sql
  OK   email_logs||Service can insert email logs  [INSERT TO authenticated]  LIVE RESIDUAL  <- 20251223000000_email_templates.sql
  OK   community_boosts||Anyone can view boosts  [SELECT TO public]  PUBLIC READ  <- 20251231000002_community_features.sql
  OK   product_copurchase||Anyone can read product co-purchase data  [SELECT TO public]  PUBLIC READ  <- 20260728_product_copurchase.sql

live source    : .../backend/.env (--env)
live set       : 187 policies

wide-open LIVE in production : 8
  OK   agent_status||Anyone can check agent availability [SELECT TO {public}]
  OK   community_boosts||Anyone can view boosts [SELECT TO {public}]
  OK   imagination_pricing||Anyone can read pricing [SELECT TO {public}]
  OK   imagination_product_sizes||Anyone can read imagination product sizes [SELECT TO {public}]
  OK   imagination_products||Anyone can read imagination products [SELECT TO {public}]
  OK   products||Anyone can view products [SELECT TO {public}]
  OK   shipping_methods||shipping_methods_public_read [SELECT TO {public}]
  OK   social_votes||Anyone can view votes [SELECT TO {public}]

wide-open convergence (replay vs live)
  replay-only : product_copurchase||Anyone can read product co-purchase data  (table absent from production)
  live-only   : imagination_product_sizes||Anyone can read imagination product sizes
  live-only   : imagination_products||Anyone can read imagination products
  live-only   : products||Anyone can view products
  live-only   : shipping_methods||shipping_methods_public_read

residual STILL LIVE : email_logs||Service can insert email logs

PASS: no unreconciled wide-open RLS policy in the migration chain.
```

**Before the new migration the replayed set was 149 policies with 13 wide-open.
After, it is 142 with 6, and all six are allow-listed by name with a reason.**
Every wide-open WRITE policy is gone from the replay. The only wide-open policies
a fresh environment now creates are public `FOR SELECT USING (true)` reads that
production also has, plus the two documented exceptions below.

Production itself was left untouched. The migration was executed against
production inside a transaction with a full `pg_policies` snapshot either side:
**0 policies removed, 0 added, 187 before and 187 after** — a proven no-op, as
expected, because production was already in the hardened state. Because it is a
proven no-op it was committed and recorded in
`supabase_migrations.schema_migrations` as version `20260922210000`, so a future
`supabase migration up` will not attempt to replay it.

---

## Known residual — NOT closed here

`email_logs` · `Service can insert email logs` · `FOR INSERT TO authenticated
WITH CHECK (true)` (`20251223000000_email_templates.sql:104`).

It is **live in production**. This task's contract is convergence with production,
so dropping it here would make the replay *diverge* — the opposite of the job. No
browser-client path writes `email_logs` (all five writers are service-role
`backend/**`), so it looks removable, but removing it is a live production change
and belongs in its own reviewed migration. Filed as a follow-up.

## Drift found in the other direction — production is MORE open than the chain

Four wide-open `SELECT` policies are **live in production but exist in no
migration file at all**. A fresh environment does not get them:

| Table | Live policy | Chain equivalent |
|---|---|---|
| `products` | `Anyone can view products` — `USING (true)` | `All users can view approved products` — `USING (approved = true AND status = 'active')` (`002_rls_policies.sql:81`) |
| `imagination_products` | `Anyone can read imagination products` — `USING (true)` | none |
| `imagination_product_sizes` | `Anyone can read imagination product sizes` — `USING (true)` | none |
| `shipping_methods` | `shipping_methods_public_read` — `USING (true)` | none |

The `products` row is the one that matters and it is a **real exposure**, not
just bookkeeping. The chain's policy restricts the public catalogue to approved,
active rows; production's replacement has no predicate at all. Measured live on
2026-09-22: **2,474 of 2,602 `products` rows are not approved and not active**,
and every one of them is readable with the public anon key — the design library
and unreleased drafts included.

That is out of scope for this task (this file only removes policies the chain
should never have created) and fixing it is a storefront-behaviour change that
needs review, since admin and Step-Flow surfaces may read unapproved rows through
the same client. **Filed as its own follow-up task.**

The three `imagination_*` / `shipping_methods` rows are legitimate public
catalogue reads; the finding there is only that no migration file creates them,
so staging/DR would come up without them. Tracked in `MIGRATION_LEDGER.md` under
the existing drift section.

---

## Scope boundaries honoured

- **No historical migration file was modified.** Checksums and history intact —
  `git status` shows only the new migration, the verification script, this
  document, `MIGRATION_LEDGER.md` and `TASK_NOTES.md`.
- **Exactly one new migration file** under `supabase/migrations/`.
- **Legitimate public SELECT policies retained** — nine of them, each named with
  its reason in the migration and allow-listed by name in the verifier, so a
  future pass cannot silently drop one.
- Table-level `anon` write **grants** (89 tables) are a different mechanism and
  remain Watchtower task `b6d6720f` — not touched here.
