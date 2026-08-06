-- 2026-08-06 SECURITY ROUND 2 — spam-ticket flood + safe profile view
-- (Both parts here are SAFE/ADDITIVE — no user-facing breakage. The breaking
--  step, cutting anon's read of the base table, is 20260806_03_profiles_cut_anon.sql,
--  applied only AFTER the repointed frontend is live.)
--
-- PART A — Stop the ongoing support-ticket spam.
-- The anon-key insert path is already closed (RLS). The remaining vector is the
-- PUBLIC contact-form endpoint POST /api/support/tickets, which runs as the
-- service role (bypasses RLS) and is intentionally unauthenticated. The bot is
-- low-and-slow (~1 ticket/1-2h) so the 5/hr-per-IP rate limit never trips.
-- Every spam ticket has the same signature: a subject that is one unbroken run
-- of mixed-case letters, no spaces (e.g. 'KWHDgyxkCacsyvSjhF'). A BEFORE INSERT
-- trigger rejects that signature at the DB, blocking the endpoint path AND any
-- future path. Conservative on purpose (length>=12, letters-only, BOTH cases)
-- so a real user's short/one-word/lowercase subject is never rejected.
CREATE OR REPLACE FUNCTION public.reject_spam_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subject ~ '^[A-Za-z]{12,}$'
     AND NEW.subject ~ '[a-z]'
     AND NEW.subject ~ '[A-Z]' THEN
    RAISE EXCEPTION 'support ticket rejected: subject looks like automated spam';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_spam_support_ticket ON public.support_tickets;
CREATE TRIGGER reject_spam_support_ticket
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.reject_spam_support_ticket();

-- PART B — Safe public profile view (additive; the frontend is repointed here).
-- Exposes ONLY non-sensitive display columns — never email, first/last/full
-- name, tax_id, stripe_account_id, credit_limit, itc_balance, shipping_* or
-- phone. Runs with the view owner's rights, so anon/authenticated granted SELECT
-- on the view see is_public=true rows without any access to the base table.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  display_name,
  bio,
  profile_image,
  avatar_url,
  cover_image_url,
  location,
  website,
  social_links,
  social_tiktok,
  is_public,
  show_order_history,
  show_designs,
  show_models,
  show_activity,
  show_reviews,
  allow_messages,
  points,
  joined_date,
  created_at
FROM public.user_profiles
WHERE is_public = true;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
