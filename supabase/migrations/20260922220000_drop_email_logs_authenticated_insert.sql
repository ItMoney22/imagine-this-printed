-- Drop the authenticated INSERT policy on public.email_logs.
--
-- Watchtower task 0c9f693c-c0ee-4f20-8b12-b1bbc94cce0c (Sifu, 2026-09-22).
-- Follow-up to 82d4ae2e, which deliberately left this policy live so the
-- reconciliation migration would not diverge from production. This file is
-- that divergence, done on purpose.
--
-- THE HOLE
-- --------
-- 20251223000000_email_templates.sql creates
--   "Service can insert email logs" FOR INSERT TO authenticated WITH CHECK (true)
-- The name says service. The role says any signed-in customer. WITH CHECK (true)
-- accepts any row, so an authenticated session can forge email audit records
-- (recipient, subject, status, metadata) with the anon key that ships in the
-- frontend bundle. service_role has rolbypassrls and never consulted this
-- policy; it granted the backend nothing.
--
-- WRITERS
-- -------
-- Every email_logs write in this repo is a service-role client under backend/:
--   backend/services/emailAI.ts          (insert, via backend/lib/supabase.js)
--   backend/routes/email.ts              (select + update on the Resend webhook)
--   backend/routes/admin/email-templates.ts (select)
-- src/ does not reference email_logs at all. The admin SELECT policy
-- "Admin can view email logs" is not touched.
--
-- Table-level INSERT/UPDATE/DELETE/TRUNCATE grants for anon and authenticated
-- are a separate mechanism (Watchtower b6d6720f). This file only drops the
-- policy. With RLS on and no INSERT policy left, those roles are denied
-- inserts. TRUNCATE is not gated by RLS; the grant sweep owns that.
--
-- DROP POLICY IF EXISTS still raises 42P01 when the table is missing
-- (IF EXISTS covers the policy, not the relation). The to_regclass guard
-- keeps a partial database from aborting the chain. The DROP itself stays a
-- literal statement so the reconciliation verifier can see it.

DO $$
BEGIN
  IF to_regclass('public.email_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service can insert email logs" ON public.email_logs;
  END IF;
END $$;
