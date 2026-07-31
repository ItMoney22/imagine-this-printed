-- ============================================================================
-- Fix ambiguous column reference in public.get_user_role()
-- ============================================================================
-- 005_rls_fixes.sql (line 28) defines the helper as:
--
--     SELECT role INTO user_role FROM public.user_profiles WHERE id = user_id;
--
-- The parameter is named `user_id`, and the live `user_profiles` table also has
-- a `user_id` column. (Schema drift: supabase/migrations/001_initial_schema.sql
-- declares only `id`, but diagnostics/create-missing-tables.sql line 10 adds
-- `user_id`, and the live table has it.) plpgsql therefore resolves `user_id`
-- in that WHERE clause against BOTH the parameter and the column, so every call
-- raises:
--
--     ERROR: column reference "user_id" is ambiguous
--
-- Any RLS policy or trigger that calls the helper then fails closed. Verified
-- live 2026-07-26. Live callers today: the admin policies in 005_rls_fixes.sql
-- (user_profiles, user_wallets, products, orders, cost_variables,
-- product_cost_breakdowns) and the role-escalation trigger in
-- 20260727_prevent_role_self_escalation.sql line 60.
--
-- Fix: qualify every reference in the body -- `up.` for columns,
-- `get_user_role.` for the parameter -- and add `SET search_path = public` as
-- standard SECURITY DEFINER hardening.
--
-- WHY THE PARAMETER IS NOT RENAMED TO `p_user_id`: Postgres rejects a parameter
-- rename through CREATE OR REPLACE ("cannot change name of input parameter"),
-- and DROP FUNCTION would cascade into every RLS policy that references the
-- helper. Qualifying the parameter with the function name disambiguates it
-- exactly as well, with no drop and no signature change.
--
-- Idempotent; safe to re-run. Safe whether or not 005_rls_fixes.sql has been
-- applied (CREATE OR REPLACE creates the function if it is absent).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT up.role
    INTO v_role
    FROM public.user_profiles up
   WHERE up.id = get_user_role.user_id;

  RETURN COALESCE(v_role, 'customer');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO anon;

-- Verification (run manually after applying, as an admin/founder user):
--   SELECT public.get_user_role('<a real user_profiles.id uuid>');
-- Expect the user's role back, with no "column reference is ambiguous" error.
