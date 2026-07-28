-- ============================================================================
-- Migration: Prevent role self-escalation on user_profiles
-- ============================================================================
--
-- VULNERABILITY (verified against migrations as checked in 2026-07-27):
-- supabase/migrations/002_rls_policies.sql:27-28 defines:
--
--   CREATE POLICY "Users can update their own profile" ON user_profiles
--       FOR UPDATE USING (auth.uid() = id);
--
-- With no WITH CHECK clause, Postgres reuses the USING expression as the
-- implicit WITH CHECK for the post-update row. That expression only asserts
-- `auth.uid() = id` -- it says nothing about which COLUMNS may change. Since
-- a role-escalation UPDATE never changes `id`, the implicit check still
-- passes, so any authenticated user can run, e.g. from the browser console:
--
--   supabase.from('user_profiles').update({ role: 'admin' }).eq('id', auth.uid())
--
-- and self-promote. COMPLETE_DATABASE_SETUP.sql:592-593 has the identical gap
-- ("Users can update own profile" ... USING (auth.uid() = id)) and is patched
-- in the same way by this task.
--
-- FIX: a BEFORE INSERT OR UPDATE trigger on user_profiles that makes `role`
-- immutable for any caller who is not (a) a service_role connection
-- (server-side/backend, e.g. admin tooling using the service key) or
-- (b) a caller who ALREADY holds admin/founder in their own row. Case (b)
-- preserves the existing src/pages/AdminDashboard.tsx:1534 `updateUserRole`
-- flow unchanged -- it calls
-- `supabase.from('user_profiles').update({ role }).eq('id', targetUserId)`
-- as the logged-in admin's authenticated session, so no application code
-- needs to change.
--
-- On INSERT (defense in depth -- the "Users can insert their own profile"
-- policy has the same missing-WITH-CHECK-on-role gap), any role value
-- supplied by a non-privileged caller is silently forced to 'customer'
-- rather than rejected, since INSERT of one's own profile row is otherwise
-- a normal, expected operation.
--
-- Reuses public.get_user_role(uuid), the SECURITY DEFINER helper already
-- shipped in 005_rls_fixes.sql to read a role without re-triggering RLS
-- recursion on user_profiles.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_user_profile_role_immutable()
RETURNS TRIGGER AS $$
BEGIN
  -- Role isn't changing on this UPDATE -- nothing to enforce.
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Server-side connections (service role key) may always set role.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- A caller who already holds admin/founder may change any user's role
  -- (covers AdminDashboard.tsx's updateUserRole, called as the admin's own
  -- authenticated session).
  IF public.get_user_role(auth.uid()) IN ('admin', 'founder') THEN
    RETURN NEW;
  END IF;

  -- Non-privileged caller. INSERT of their own profile: force a safe
  -- default instead of trusting a client-supplied role.
  IF TG_OP = 'INSERT' THEN
    NEW.role := 'customer';
    RETURN NEW;
  END IF;

  -- Non-privileged caller attempting to change role via UPDATE: reject.
  RAISE EXCEPTION 'permission denied: role cannot be changed by this user';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS enforce_user_profile_role_immutable_trigger ON public.user_profiles;

CREATE TRIGGER enforce_user_profile_role_immutable_trigger
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_profile_role_immutable();
