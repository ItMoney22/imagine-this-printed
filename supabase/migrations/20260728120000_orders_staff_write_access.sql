-- ============================================================================
-- Orders: restore admin/founder access, add manager write access
-- ============================================================================
--
-- Watchtower task 3390cc85 (manager can't write orders; RLS and the app's role
-- gate disagree). Verified live against production 2026-07-28 before writing
-- this file (read-only introspection only -- no writes were made to prod):
--
-- supabase/migrations/005_rls_fixes.sql defines "Admins have full access to
-- all orders" (admin/founder, FOR ALL) and "Admins can read all orders", but
-- neither was ever applied to production. `orders` has RLS enabled
-- (relrowsecurity = true) and the ONLY live policy is
-- "Users can view their own orders" (SELECT, auth.uid() = user_id). 005 as a
-- whole was only ever partially applied -- e.g. cost_variables got its
-- "Admins have full access to all cost variables" policy through some
-- out-of-band path, but user_profiles/user_wallets/products/orders did not.
-- Full detail in supabase/migrations/MIGRATION_LEDGER.md.
--
-- Consequence: any direct-from-browser write to `orders` (signed in as the
-- user's own JWT, subject to RLS) silently matches zero rows today -- admin
-- included -- with no Postgres error. src/pages/OrderManagement.tsx's
-- updateOrderStatus/updateOrderNotes used to do exactly this; a concurrent fix
-- in this same working tree (see backend/routes/orders.ts PATCH /:orderId,
-- requireRole(['admin','manager','founder'])) moved those writes behind the
-- backend API, which runs on SUPABASE_SERVICE_ROLE_KEY and so bypasses RLS
-- entirely -- that already fixes the live user-facing bug and is the correct
-- place for the manager-write decision to be enforced day to day. This
-- migration is the complementary DB-layer fix: RLS on `orders` should still
-- reflect real intent (defense in depth if a browser-side write path ever
-- comes back, and because task 3390cc85 asks for the RLS policy itself to
-- stop disagreeing with the app's role model, not just for the symptom to go
-- away).
--
-- src/pages/OrderManagement.tsx:272 already gates the whole page to
-- 'admin' | 'manager' | 'founder'. 'manager' is treated as write-equivalent to
-- 'admin' everywhere else this schema has a manager-reachable write surface:
-- marketing_campaigns (INSERT/UPDATE), email_templates, social_content,
-- community_features, and cost_variables ("Managers can manage their cost
-- variables", live today) all do this. Orders is the outlier, not a deliberate
-- restriction -- 005 simply never shipped for this table. DECISION: give
-- manager write access to orders, matching the rest of the app and the page's
-- own access gate.
--
-- Manager does NOT get DELETE (narrower than admin/founder's FOR ALL) -- no
-- delete-order flow exists in the app today and it was not asked for.
--
-- ORDERING CONSTRAINT: this migration DEPENDS on
-- supabase/migrations/20260728_fix_get_user_role_ambiguity.sql having already
-- applied. public.get_user_role(uuid) is currently BROKEN live: user_profiles
-- has both an `id` column and a drifted `user_id` column, and the original 005
-- function body (`WHERE id = user_id`) resolves the bare `user_id` reference
-- ambiguously between the column and the parameter, raising
-- `column reference "user_id" is ambiguous` on every single call (reproduced
-- live 2026-07-28). This file's version prefix (20260728120000) was chosen to
-- sort after 20260728_fix_get_user_role_ambiguity.sql (version 20260728)
-- specifically so a `supabase db push` applies the fix first. Do not apply this
-- file on its own against a database that doesn't already have the fix.
--
-- Idempotent; safe to re-run.
-- ============================================================================

DROP POLICY IF EXISTS "Admins have full access to all orders" ON orders;
CREATE POLICY "Admins have full access to all orders" ON orders
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

DROP POLICY IF EXISTS "Managers can update orders" ON orders;
CREATE POLICY "Managers can update orders" ON orders
  FOR UPDATE
  USING (public.get_user_role(auth.uid()) = 'manager')
  WITH CHECK (public.get_user_role(auth.uid()) = 'manager');
