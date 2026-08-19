-- ============================================================================
-- Migration: drop the two wide-open `TO public WITH CHECK (true)` INSERT
--            policies that let the publishable anon key write to
--            public.community_boost_earnings and public.user_profiles
-- Watchtower task 1e03d8e0-e3e1-4e7b-b4b2-d46233e4756f (Sifu)
-- Found by Zero Nine while auditing grants for task f8ecc070.
-- ============================================================================
--
-- WHAT WAS WRONG (verified against PRODUCTION 2026-08-19, not inferred from
-- these files -- most of this repo's schema reached prod outside the migration
-- ledger, see MIGRATION_LEDGER.md):
--
--   community_boost_earnings | "System can insert earnings"      | INSERT
--                            | TO {public} | WITH CHECK (true)
--   user_profiles            | "Service role can insert profiles"| INSERT
--                            | TO {public} | WITH CHECK (true)
--
-- Both names claim service-role intent. Neither enforces it. `TO public` is
-- every role including `anon`, and `anon` holds the INSERT grant on both
-- tables, so anyone holding the publishable key that ships in the client
-- bundle could POST arbitrary rows through PostgREST. Proven live, in a
-- rolled-back transaction, by impersonating `anon`:
--   * community_boost_earnings -- INSERT succeeded outright (1 row). That
--     table feeds the public `community_leaderboard` view, so fabricated
--     rows poison creator earnings totals; it is also an unbounded write
--     surface on a table nothing rate-limits.
--   * user_profiles -- INSERT (including role='admin') got past RLS and was
--     stopped only by user_profiles_id_fkey. A foreign key is not an
--     authorization boundary: any auth.users id that has no profile row yet
--     is a writable slot, and the attacker picks the role column.
--
-- WHY DROPPING IS THE WHOLE FIX -- these policies are not load-bearing:
--   * `service_role` has rolbypassrls = true (confirmed live), so RLS never
--     evaluates for it. Every real writer is service-role:
--     backend/lib/supabase.ts builds its client with SUPABASE_SERVICE_ROLE_KEY,
--     and backend/routes/community.ts:739 (creditCreatorITC) is the only
--     writer to community_boost_earnings in the entire codebase.
--   * user_profiles rows are created by public.handle_new_user(), a SECURITY
--     DEFINER trigger owned by `postgres` (rolbypassrls = true) -- signup does
--     not depend on any RLS policy either.
--   * A user creating their own profile row keeps working through the
--     surviving "Users can insert own profile" policy (WITH CHECK
--     auth.uid() = id), which is the correctly-scoped version of the same
--     idea. community_boost_earnings is left with no INSERT policy at all,
--     which is right: no client should ever write its own earnings.
--
-- Re-runnable. Drops only; no table, grant, row or other policy is touched.
-- Verify with: node scripts/verify-anon-insert-lockdown.mjs
-- ============================================================================

DROP POLICY IF EXISTS "System can insert earnings" ON public.community_boost_earnings;

DROP POLICY IF EXISTS "Service role can insert profiles" ON public.user_profiles;

-- Fail loudly if either survives (e.g. a same-named policy is re-created by an
-- older migration file being replayed).
DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*) INTO leftover
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'INSERT'
    AND with_check = 'true'
    AND 'public' = ANY (roles)
    AND tablename IN ('community_boost_earnings', 'user_profiles');

  IF leftover > 0 THEN
    RAISE EXCEPTION
      'wide-open public INSERT policy still present on community_boost_earnings/user_profiles (% found)',
      leftover;
  END IF;
END $$;
