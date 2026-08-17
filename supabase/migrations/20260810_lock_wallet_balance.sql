-- Lock ITC balances against self-minting.
--
-- FOUND 2026-08-10, verified against the LIVE production database (pg_policies,
-- pg_trigger, role_table_grants — the migration FILES disagree with live, so the
-- live dump is the authority here).
--
-- REVISED + APPLIED 2026-08-16 (Watchtower task 2be49cee-1c54-4d52-a880-049d869030fc).
-- The 08-10 draft of this file was re-verified against live before applying and
-- would have FAILED mid-way. Two corrections, both forced by the live catalog:
--
--   (a) The INSERT policy referenced points_balance / lifetime_itc_earned /
--       lifetime_points_earned. Those columns DO NOT EXIST on live
--       public.user_wallets, whose real shape is
--         (id, user_id, points, itc_balance, created_at, updated_at,
--          usd_balance, total_earned, total_spent)
--       — the same repo-vs-live drift 20260727_fix_itc_wallet_schema_drift.sql
--       documents. CREATE POLICY would have raised 42703 "column
--       points_balance does not exist", and because the draft had no
--       transaction wrapper it would have left the table with its UPDATE
--       policies dropped, NO user INSERT policy, and the REVOKE never run.
--       This version names only live columns and runs in one transaction.
--
--   (b) The draft left the policy "Service role can insert wallets" in place:
--         cmd=INSERT, roles={public}, WITH CHECK (true)
--       Permissive policies OR together, so that one policy re-opens everything
--       the new zero-balance INSERT policy closes — any authenticated user
--       without a wallet row could still INSERT itself (or any other wallet-less
--       user_id) a row carrying an arbitrary itc_balance. It is also dead
--       weight: service_role has rolbypassrls = true and never consults RLS.
--       Dropped below.
--
-- Live state before this migration (verified 2026-08-16):
--   * TWO duplicate UPDATE policies on public.user_wallets —
--       "Users can update own wallet"  and  "Users can update their own wallet"
--     both  USING (auth.uid() = user_id)  with  WITH CHECK = (none)
--   * an INSERT policy "Service role can insert wallets" on role public with
--     WITH CHECK (true) — see (b)
--   * the only trigger on the table is handle_user_wallets_updated_at (timestamps)
--     — NOTHING guards itc_balance
--   * roles anon + authenticated both hold a table-level UPDATE grant
--     (relacl arwdDxtm); pg_attribute.attacl is empty, so there are no
--     column-level grants that would survive the table-level REVOKE below
--
-- Consequence: any signed-in user could run, with the public anon key,
--     supabase.from('user_wallets').update({ itc_balance: 1e9 }).eq('user_id', me)
-- which makes ITC decorative rather than a spend control for EVERY AI feature
-- (Imagination Station, Toy Creator, Metal Art Studio, Creator Studio, and the
-- new buyer-side virtual try-on paid tier).
--
-- WHY THIS IS SAFE:
--   * There are ZERO legitimate wallet writes from the browser. Every frontend
--     reference to user_wallets is a SELECT, except the welcome-bonus INSERT
--     at src/context/SupabaseAuthContext.tsx:158 — and that INSERT is ALREADY
--     dead in production: it sends points_balance / lifetime_points_earned /
--     lifetime_itc_earned / wallet_status, none of which exist on the live
--     table, so PostgREST rejects it before RLS is ever consulted. Its failure
--     path is handled gracefully (warns, leaves the balance at 0).
--   * New wallets are created by handle_new_user(), a SECURITY DEFINER trigger
--     on auth.users that inserts (user_id, 0.00, 0.00, 0.00, 0.00). It is
--     unaffected by RLS and already seeds at zero, which is exactly what the
--     new INSERT policy permits.
--   * All server-side wallet mutations (deductITC / refundITC / rewards /
--     order payments / the /api/admin/wallet credit|debit|adjust endpoints)
--     run through backend/lib/supabase.ts, which uses the SERVICE ROLE key and
--     bypasses RLS entirely. Untouched by this migration.
--
-- DELIBERATELY NOT INCLUDED — decide separately:
--   * AdminDashboard.tsx:1679 "grant ITC" writes ANOTHER user's wallet, which no
--     policy has ever permitted, so it silently affects 0 rows while the UI
--     reports success. After this migration it fails loudly (42501) instead of
--     silently — an improvement, but the real fix is to point that button at the
--     existing service-role endpoint POST /api/admin/wallet/credit, NOT to add a
--     new RLS write path. Tracked as a follow-up.
--   * user_profiles.metadata is still self-writable (role is protected by
--     enforce_user_profile_role_immutable_trigger, metadata is not), which lets
--     a user self-grant metadata.creator and their own creator_royalty_percent.
--     Separate fix, separate blast radius.
--   * The three duplicate SELECT policies ("Users can read own wallet",
--     "Users can view own wallet", "Users can view their own wallet") are
--     identical and harmless. Left alone so this migration cannot break reads.

BEGIN;

-- 1. Users may no longer write their own wallet row at all.
DROP POLICY IF EXISTS "Users can update own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Users can update their own wallet" ON public.user_wallets;

-- 2. Remove the catch-all INSERT policy. Despite the name it is granted to
--    `public`, not to service_role, and WITH CHECK (true) accepts any row from
--    anon/authenticated. service_role bypasses RLS, so it loses nothing.
DROP POLICY IF EXISTS "Service role can insert wallets" ON public.user_wallets;

-- 3. Self-INSERT stays possible (the client fallback fires when the
--    handle_new_user trigger misses) but can no longer carry a balance.
--    Column list is the LIVE one — see note (a) at the top of this file.
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Users can insert own wallet at zero" ON public.user_wallets;
CREATE POLICY "Users can insert own wallet at zero"
  ON public.user_wallets
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(itc_balance, 0) = 0
    AND COALESCE(points, 0) = 0
    AND COALESCE(usd_balance, 0) = 0
    AND COALESCE(total_earned, 0) = 0
    AND COALESCE(total_spent, 0) = 0
  );

-- 4. Belt and braces: drop the table-level write grants the policies were
--    riding on. Service role is unaffected (it bypasses RLS and holds its own
--    grants); SELECT is left intact so users keep seeing their balance.
REVOKE UPDATE, DELETE, TRUNCATE ON public.user_wallets FROM anon, authenticated;

COMMIT;

-- Verification (expect: zero UPDATE policies, exactly one INSERT policy named
-- "Users can insert own wallet at zero", SELECT policies untouched):
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies WHERE tablename = 'user_wallets' ORDER BY cmd;
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'user_wallets' AND grantee IN ('anon','authenticated');
