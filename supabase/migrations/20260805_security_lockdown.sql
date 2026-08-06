-- 2026-08-05 EMERGENCY SECURITY LOCKDOWN — anon-exposed tables
-- Trigger: flood of bot-spam support tickets + security audit.
--
-- ROOT CAUSE: several tables carried a "Service role full access" policy
-- written as FOR ALL TO public USING (true). The service role bypasses RLS
-- anyway, so these policies did nothing but expose the tables to the public
-- anon key (which ships in the frontend JS bundle and is public by design).
-- Net effect verified live 2026-08-05: the anon key could read AND write
-- support_tickets (the spam vector — bypassing the backend's per-IP rate
-- limit entirely), and read gift_cards, discount_codes, admin_notifications,
-- ticket_messages, etc.
--
-- The frontend does NOT use the anon client on any of these tables (verified:
-- AdminSupport / AdminNotificationBell use supabase only for auth and fetch
-- data through the backend API). All legitimate access is service-role, which
-- bypasses RLS. Dropping the public policies removes anon access with no
-- application impact.
--
-- The separate self-promotion hole on user_profiles.role is fixed by
-- 20260727_prevent_role_self_escalation.sql (with its prerequisite
-- 20260728_fix_get_user_role_ambiguity.sql) — applied via the same runner —
-- NOT here, to avoid a second competing trigger.
--
-- Idempotent; safe to re-run.

DROP POLICY IF EXISTS "Service role full access to support tickets"     ON public.support_tickets;
DROP POLICY IF EXISTS "Service role full access to ticket messages"     ON public.ticket_messages;
DROP POLICY IF EXISTS "Service role full access to admin notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "System can insert notifications"                 ON public.admin_notifications;
DROP POLICY IF EXISTS "Service role full access to gift cards"          ON public.gift_cards;
DROP POLICY IF EXISTS "Service role full access to discount codes"      ON public.discount_codes;
DROP POLICY IF EXISTS "Service role full access to coupon usage"        ON public.coupon_usage;
DROP POLICY IF EXISTS "Service role full access to chat sessions"       ON public.chat_sessions;
DROP POLICY IF EXISTS "Service role full access to agent status"        ON public.agent_status;
-- agent_status keeps its "Anyone can check agent availability" SELECT policy
-- (low-sensitivity online/offline flag the chat widget relies on).
