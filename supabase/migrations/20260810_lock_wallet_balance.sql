-- Lock ITC balances against self-minting.
--
-- FOUND 2026-08-10, verified against the LIVE production database (pg_policies,
-- pg_trigger, role_table_grants — the migration FILES disagree with live, so the
-- live dump is the authority here).
--
-- Live state before this migration:
--   * TWO duplicate UPDATE policies on public.user_wallets —
--       "Users can update own wallet"  and  "Users can update their own wallet"
--     both  USING (auth.uid() = user_id)  with  WITH CHECK = (none)
--   * the only trigger on the table is handle_user_wallets_updated_at (timestamps)
--     — NOTHING guards itc_balance
--   * roles anon + authenticated both hold a table-level UPDATE grant
--
-- Consequence: any signed-in user could run, with the public anon key,
--     supabase.from('user_wallets').update({ itc_balance: 1e9 }).eq('user_id', me)
-- which makes ITC decorative rather than a spend control for EVERY AI feature
-- (Imagination Station, Toy Creator, Metal Art Studio, Creator Studio).
--
-- WHY THIS IS SAFE:
--   * There are ZERO legitimate wallet writes from the browser. Every frontend
--     reference to user_wallets is a SELECT, except the welcome-bonus INSERT
--     below (src/context/SupabaseAuthContext.tsx:158) whose failure path is
--     already handled gracefully — it warns and leaves the balance at 0.
--   * All server-side wallet mutations (deductITC / refundITC / rewards /
--     order payments) run through backend/lib/supabase.ts, which uses the
--     SERVICE ROLE key and bypasses RLS entirely. Untouched by this migration.
--
-- DELIBERATELY NOT INCLUDED — decide separately:
--   * AdminDashboard.tsx:1679 "grant ITC" writes ANOTHER user's wallet, which no
--     policy has ever permitted, so it silently affects 0 rows while the UI
--     reports success. The right fix is a backend admin endpoint on the service
--     role, NOT a new RLS write path — so this migration does not add one.
--   * user_profiles.metadata is still self-writable (role is protected by
--     enforce_user_profile_role_immutable_trigger, metadata is not), which lets
--     a user self-grant metadata.creator and their own creator_royalty_percent.
--     Separate fix, separate blast radius.

-- 1. Users may no longer write their own wallet row at all.
DROP POLICY IF EXISTS "Users can update own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Users can update their own wallet" ON public.user_wallets;

-- 2. Self-INSERT stays possible (the client fallback fires when the
--    create_user_wallet trigger misses) but can no longer carry a balance.
--    A client that tries to insert the 50 ITC welcome bonus now fails this
--    CHECK and lands in the existing graceful warn path.
DROP POLICY IF EXISTS "Users can insert own wallet" ON public.user_wallets;
CREATE POLICY "Users can insert own wallet at zero"
  ON public.user_wallets
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(itc_balance, 0) = 0
    AND COALESCE(points_balance, 0) = 0
    AND COALESCE(lifetime_itc_earned, 0) = 0
    AND COALESCE(lifetime_points_earned, 0) = 0
  );

-- 3. Belt and braces: drop the table-level write grants the policies were
--    riding on. Service role is unaffected (it bypasses RLS and holds its own
--    grants); SELECT is left intact so users keep seeing their balance.
REVOKE UPDATE, DELETE, TRUNCATE ON public.user_wallets FROM anon, authenticated;

-- Verification (expect: zero UPDATE policies, one INSERT policy named
-- "Users can insert own wallet at zero", SELECT policies untouched):
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies WHERE tablename = 'user_wallets' ORDER BY cmd;
