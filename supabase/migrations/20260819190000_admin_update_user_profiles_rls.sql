-- ============================================================================
-- Admin/founder UPDATE policy on public.user_profiles
-- Marcus Wolfe · Watchtower 54fb9414-40fd-47cf-9607-faca4f6e59fc · 2026-08-19
-- ============================================================================
--
-- WHY
-- AdminDashboard.tsx's updateUserRole() has never worked on anyone but the
-- signed-in admin themselves. public.user_profiles carried exactly one UPDATE
-- policy — "Users can update own profile", USING (auth.uid() = id) — so an
-- admin promoting somebody else matched ZERO rows. PostgREST answers that with
-- 200 and an empty array, not an error, so the dashboard showed a green
-- "Role updated" toast for a write that never happened. That is why production
-- has 183 customers, 2 admins and 0 vendors: the promotion UI has been a no-op
-- since it was written.
--
-- The enforce_user_profile_role_immutable trigger already decides WHO may
-- change a role (service_role, or a caller whose own role is admin/founder).
-- It was never the thing blocking this — RLS was, one layer earlier. This
-- policy lets an admin's statement reach the row; the trigger still has the
-- final say on the role column itself.
--
-- SCOPE
-- Purely additive. No existing policy is dropped or rewritten. Permissive
-- policies OR together, so every user keeps their own self-update path and
-- service_role is unaffected. A non-admin caller gains nothing: USING is
-- evaluated against the CALLER's role, not the target row's.
-- ============================================================================

DROP POLICY IF EXISTS "Admins can update any profile" ON public.user_profiles;

CREATE POLICY "Admins can update any profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  -- get_user_role() is SECURITY DEFINER, so this does not recurse through
  -- user_profiles' own SELECT policies.
  USING (public.get_user_role((SELECT auth.uid())) = ANY (ARRAY['admin', 'founder']))
  WITH CHECK (public.get_user_role((SELECT auth.uid())) = ANY (ARRAY['admin', 'founder']));

COMMENT ON POLICY "Admins can update any profile" ON public.user_profiles IS
  'Lets an admin/founder session update another user''s profile row — the row-level half of AdminDashboard role management. The role column itself is still governed by enforce_user_profile_role_immutable.';
