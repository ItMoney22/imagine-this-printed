-- Signup hardening: stop the unconditional 500 ITC mint, and stop welcome mail
-- going to addresses nobody has proved they own.
--
-- Watchtower task 4d915741-ef3f-4f20-bd15-31cea0069fc7 (Sifu, 2026-09-22).
--
-- GROUND TRUTH. Everything below was read out of the LIVE production database
-- (pg_proc / pg_trigger / information_schema), not out of this repo, because
-- the migration files here disagree with production in exactly this area --
-- COMPLETE_DATABASE_SETUP.sql and supabase/migrations/003_user_triggers.sql
-- both show create_user_wallet() inserting zeros, and production does not.
--
-- WHAT PRODUCTION ACTUALLY HAD
-- ----------------------------
--   CREATE FUNCTION public.create_user_wallet() ... AS $$
--     INSERT INTO user_wallets (user_id, points, itc_balance)
--     VALUES (NEW.id, 0, 500)          -- <<<< 500, unconditional
--     ON CONFLICT (user_id) DO NOTHING;
--   $$
--   CREATE TRIGGER trigger_create_user_wallet
--     AFTER INSERT ON public.user_profiles FOR EACH ROW ...
--
-- The fight nobody noticed: on_auth_user_created -> handle_new_user() inserts
-- the profile row, that INSERT fires trigger_create_user_wallet, which creates
-- the wallet at 500. handle_new_user() THEN tries to insert the same wallet at
-- 0.00 -- and loses to its own ON CONFLICT (user_id) DO NOTHING. So the column
-- default (0), the schema, handle_new_user(), and three migration files all
-- said zero, and every account still got 500. 290 bot signups in September
-- carried ~145,000 ITC out of that gap, against AI features that bill real
-- Replicate/OpenAI money per generation.
--
-- WHY ZERO AND NOT "500 ON CONFIRMATION"
-- --------------------------------------
-- ITC is the spend control in front of every paid AI lane (Imagination
-- Station, Toy Creator, Metal Art Studio, Creator Studio, try-on). A welcome
-- credit handed out by a DB trigger is a faucet that opens the instant anyone
-- can create a row, and the only thing standing between it and a scripted
-- signup is a captcha that is still being turned on. If a welcome credit is
-- wanted later it belongs in a server-side grant on the service role, keyed to
-- a confirmed account and revocable in one place -- not in a trigger. New
-- wallets are therefore created at 0 on every path, which is what the column
-- default and handle_new_user() have claimed all along.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. create_user_wallet(): zero balances, and a pinned search_path.
-- ---------------------------------------------------------------------------
-- Column names below are production's (points, not points_balance;
-- usd_balance/total_earned/total_spent, no lifetime_*). Do not "fix" them
-- against the older migration files -- those describe a table that does not
-- exist here.
--
-- SET search_path matters as much as the number. This is SECURITY DEFINER and
-- ran without one, so it resolved user_wallets through the caller's
-- search_path; anyone able to prepend a schema could have had it write their
-- own table instead. Every other hardened function in this database
-- (handle_new_user, enforce_user_profile_metadata_immutable) already pins it.
CREATE OR REPLACE FUNCTION public.create_user_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.user_wallets (
    user_id, points, itc_balance, usd_balance, total_earned, total_spent
  )
  VALUES (NEW.id, 0, 0.00, 0.00, 0.00, 0.00)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. One welcome email per account, ever.
-- ---------------------------------------------------------------------------
-- The backend used to dedupe welcome mail in an in-process Map, which forgot
-- everything on each Render restart and was per-instance anyway. This stamp is
-- the durable version: backend/routes/account.ts sets it (service role) before
-- sending and clears it if the send throws.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.welcome_email_sent_at IS
  'Set when the one-time welcome email was sent for this confirmed account. Written only by POST /api/account/send-welcome-email on the service role.';

-- Backfill: every account that exists right now has already had whatever
-- welcome mail it was going to get. Without this, the first confirmed sign-in
-- after deploy would mail all of them again.
UPDATE public.user_profiles
   SET welcome_email_sent_at = COALESCE(created_at, NOW())
 WHERE welcome_email_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Drop on_auth_user_welcome_email and its function.
-- ---------------------------------------------------------------------------
-- What it did, live: AFTER INSERT ON auth.users -> send_welcome_email_webhook()
-- -> net.http_post() to https://api.imaginethisprinted.com/api/webhooks/supabase-auth
-- with NO x-webhook-secret header, for EVERY row inserted into auth.users,
-- confirmed or not.
--
-- Two separate reasons it goes rather than gets patched:
--
--   * It cannot deliver anything. The receiving route
--     (backend/routes/webhooks.ts) fails closed on a missing or incorrect
--     x-webhook-secret, and the trigger sends no such header -- so every one of
--     these calls has been answered 401/503. It has been a per-signup
--     unauthenticated outbound HTTP request from inside the database and
--     nothing else.
--   * It fires on INSERT, which is before confirmation. Even wired up
--     correctly it would mail exactly the unproved addresses this task exists
--     to stop mailing.
--
-- The replacement is not a trigger. src/pages/AuthCallback.tsx calls
-- POST /api/account/send-welcome-email at the first moment a CONFIRMED session
-- exists (email-confirmation link and OAuth return both land there), and that
-- endpoint reads the destination address out of the verified access token,
-- refuses unconfirmed accounts, and is idempotent against the stamp added in
-- section 2. The trade is that delivery now depends on the customer's browser
-- reaching the callback; a missed welcome email is a far cheaper failure than
-- branded mail landing in a scraped corporate inbox.
--
-- To restore a browser-independent path later: point a trigger at the
-- email_confirmed_at NULL -> NOT NULL transition on auth.users (AFTER UPDATE),
-- provision SUPABASE_WEBHOOK_SECRET on Render AND in a DB setting so the POST
-- is authenticated, and teach backend/routes/webhooks.ts the same
-- welcome_email_sent_at dedupe so the two paths cannot double-send.
DROP TRIGGER IF EXISTS on_auth_user_welcome_email ON auth.users;
DROP FUNCTION IF EXISTS public.send_welcome_email_webhook();

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run after applying; expected results in brackets)
-- ---------------------------------------------------------------------------
--   -- [no 500 anywhere in the body; search_path pinned]
--   SELECT pg_get_functiondef(oid) FROM pg_proc
--    WHERE proname = 'create_user_wallet';
--
--   -- [one row: on_auth_user_created]
--   SELECT tgname FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
--
--   -- [0 rows]
--   SELECT proname FROM pg_proc WHERE proname = 'send_welcome_email_webhook';
--
--   -- [0 rows]
--   SELECT id FROM public.user_profiles WHERE welcome_email_sent_at IS NULL;
