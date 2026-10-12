-- Forward reconciliation: drop the legacy wide-open RLS policies that historical
-- migrations still CREATE, so replaying this chain on a fresh environment lands
-- on the same policy set production already has.
--
-- Watchtower task 82d4ae2e-cbfa-4331-9eda-51fa6a22d774 (Sifu, 2026-09-22).
-- Round 1 security pass: Watchtower e3e4f5de, commit 6f095da.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The 2026-08-06 (`security_round2`) and 2026-08-19 (`dbb8476`) hardening passes
-- dropped wide-open policies by running SQL straight at production. Production is
-- correct. The repo is not: `002_rls_policies.sql` and
-- `20251231000002_community_features.sql` still CREATE those policies, so
-- `supabase db reset`, a staging build, a DR rebuild or a test database replays
-- the chain and comes up WIDE OPEN while production is locked. This file closes
-- that gap forward. Historical migrations are NOT edited -- their checksums and
-- history stay intact.
--
-- GROUND TRUTH
-- ------------
-- Every APPLIED/ABSENT claim below was read out of the LIVE production database
-- (`pg_policies`, `to_regclass`) on 2026-09-22, not inferred from file contents.
-- Re-runnable proof: `node scripts/verify-rls-policy-reconciliation.mjs`, which
-- replays every CREATE/DROP POLICY in `supabase/migrations/` in filename order
-- and diffs the resulting policy set against live.
--
-- WHAT A WIDE-OPEN POLICY COSTS
-- -----------------------------
-- `FOR ALL` / `FOR INSERT ... WITH CHECK (true)` with no `TO` clause defaults to
-- `TO public`, which includes `anon` -- the key that ships inside the frontend JS
-- bundle. The `service_role` these policies were named for has `rolbypassrls`, so
-- they never granted the backend anything it did not already have; their only
-- real effect was handing anonymous browsers write access to the money tables
-- (ITC/points ledgers, referral payouts, order line items, vendor payouts,
-- founder earnings, creator boost earnings).
--
-- BLAST RADIUS: NONE.
-- Every legitimate writer of these tables is a service-role backend path
-- (`backend/**`), which bypasses RLS. Grepped `src/` for browser-client writes to
-- all seven tables: the only hit is `src/context/SupabaseAuthContext.tsx:191`, a
-- wallet-creation fallback that is ALREADY dead in production (the policy it
-- needed was removed live in August, and `20260922120000` made the DB trigger the
-- single authority for wallet creation). Filed separately -- not this file's job.

DO $$
BEGIN
  -- `DROP POLICY IF EXISTS ... ON <t>` still raises 42P01 when <t> is missing
  -- (IF EXISTS covers the policy, not the relation -- verified live, inside a
  -- rolled back transaction). These guards keep the file safe on partially
  -- provisioned databases; on a full replay every relation below exists.

  -- 002_rls_policies.sql -- six "System can ..." policies, all TO public.
  IF to_regclass('public.points_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can insert points transactions" ON public.points_transactions;
  END IF;

  IF to_regclass('public.itc_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can insert ITC transactions" ON public.itc_transactions;
  END IF;

  IF to_regclass('public.referral_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can manage referral transactions" ON public.referral_transactions;
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can manage order items" ON public.order_items;
  END IF;

  IF to_regclass('public.vendor_payouts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can manage vendor payouts" ON public.vendor_payouts;
  END IF;

  IF to_regclass('public.founder_earnings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can manage founder earnings" ON public.founder_earnings;
  END IF;

  -- 20251231000002_community_features.sql -- dropped live 2026-08-19 (dbb8476).
  IF to_regclass('public.community_boost_earnings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can insert earnings" ON public.community_boost_earnings;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ALREADY RECONCILED -- no statement needed here, listed so the next auditor does
-- not re-derive it. The nine wide-open policies in
-- `20251219_coupons_giftcards_support.sql` are already dropped forward by
-- migrations that sort AFTER it, so a from-scratch replay never leaves them:
--
--   discount_codes      "Service role full access to discount codes"      -> 20260805_security_lockdown.sql:31
--   coupon_usage        "Service role full access to coupon usage"        -> 20260805_security_lockdown.sql:32
--   gift_cards          "Service role full access to gift cards"          -> 20260805_security_lockdown.sql:30
--   support_tickets     "Service role full access to support tickets"     -> 20260805_security_lockdown.sql:26
--   ticket_messages     "Service role full access to ticket messages"     -> 20260805_security_lockdown.sql:27
--   admin_notifications "Service role full access to admin notifications" -> 20260805_security_lockdown.sql:28
--   agent_status        "Service role full access to agent status"        -> 20260805_security_lockdown.sql:34
--   chat_sessions       "Service role full access to chat sessions"       -> 20260805_security_lockdown.sql:33
--   discount_codes      "Anyone can read active discount codes"           -> 20260805_02_discount_codes_lockdown.sql:12
--
-- ---------------------------------------------------------------------------
-- DELIBERATELY RETAINED -- genuinely public catalog/read surfaces. Each one is
-- `FOR SELECT USING (true)`, each is LIVE in production today, and each is read by
-- the storefront through the anon client. Dropping them would be a storefront
-- outage, not a fix:
--
--   products                  "Anyone can view products"                  -- the catalogue itself
--   imagination_pricing       "Anyone can read pricing"                   -- public price list
--   imagination_products      "Anyone can read imagination products"      -- public catalogue
--   imagination_product_sizes "Anyone can read imagination product sizes" -- public size chart
--   shipping_methods          "shipping_methods_public_read"              -- public shipping options
--   social_votes              "Anyone can view votes"                     -- public vote counts
--   community_boosts          "Anyone can view boosts"                    -- public boost counts
--   agent_status              "Anyone can check agent availability"       -- online/offline flag the chat
--                                                                            widget needs; explicitly kept
--                                                                            by 20260805_security_lockdown.sql
--   product_copurchase        "Anyone can read product co-purchase data"  -- "bought together" pairs, queried
--                                                                            by the anon client in
--                                                                            src/utils/product-recommender.ts.
--                                                                            The table does not exist in prod
--                                                                            (that migration was never applied),
--                                                                            so no live state says it was revoked.
--
-- ---------------------------------------------------------------------------
-- KNOWN RESIDUAL, NOT CLOSED HERE -- `email_logs` carries
-- "Service can insert email logs" `FOR INSERT TO authenticated WITH CHECK (true)`
-- (20251223000000_email_templates.sql). It is LIVE in production, so dropping it
-- here would make the replay DIVERGE from production -- the opposite of this
-- file's job. No browser-client path writes `email_logs` (all five writers are
-- service-role `backend/**`), so it looks removable, but removing it is a live
-- production change and belongs in its own reviewed migration. Filed as a
-- follow-up Watchtower task; see supabase/migrations/MIGRATION_LEDGER.md.
