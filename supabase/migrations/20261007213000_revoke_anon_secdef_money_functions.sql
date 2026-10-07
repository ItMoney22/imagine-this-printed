-- ============================================================================
-- Close the other SECURITY DEFINER money/inventory functions to anon
-- ============================================================================
-- Watchtower task bdfa6939 (dr-dill, 2026-10-07). Found by the same sweep that
-- caught process_referral_reward (20261007210000): Postgres grants EXECUTE to
-- PUBLIC on every new function, so these SECURITY DEFINER functions were
-- callable over PostgREST by anyone holding the public anon key:
--
--   award_order_rewards(order, user, total, multiplier) - writes points + ITC
--   record_blank_sale / reverse_blank_sale              - moves blank stock
--   next_design_qa_submission_no                         - bumps a QA counter
--
-- Every caller is the API/worker on the service-role client
-- (order-reward-service.ts, blank-inventory.ts, order-refunds.ts,
-- design-qa-gate.ts); no trigger, function body or RLS policy calls them, and
-- the site never does. get_user_role / cost_variables_role_for are RLS helpers
-- and stay as they are.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.award_order_rewards(uuid, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_order_rewards(uuid, uuid, numeric, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.record_blank_sale(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_blank_sale(uuid, uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_blank_sale(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_blank_sale(uuid, uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.next_design_qa_submission_no(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_design_qa_submission_no(uuid, text) TO service_role;

COMMIT;
