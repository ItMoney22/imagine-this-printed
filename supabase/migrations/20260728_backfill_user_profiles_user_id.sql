-- ============================================================================
-- Backfill user_profiles.user_id and stop it going NULL again
-- ============================================================================
-- Watchtower task b17afacb. Live 2026-07-27: 5 rows in user_profiles, `user_id`
-- NULL on 4 of them, populated on exactly 1.
--
-- ROOT CAUSE (the writer, not the data):
--
--   supabase/migrations/001_initial_schema.sql:5 declares user_profiles with a
--   single key column, `id UUID REFERENCES auth.users(id) PRIMARY KEY`.
--
--   supabase/migrations/004_schema_fixes.sql:22-26 later ADDS a second column,
--   `user_id UUID`, with a FK to auth.users and a UNIQUE index, and backfills it
--   ONCE with `UPDATE user_profiles SET user_id = id WHERE user_id IS NULL`.
--   That one-shot backfill is why exactly one row (the only row that existed at
--   the time) has a value.
--
--   Nothing was ever taught to KEEP it populated. The live signup writer,
--   public.handle_new_user() -- defined in 003_user_triggers.sql:17-48 and
--   re-defined by 20260727_signup_role_hardcode_customer.sql:43-74 -- inserts
--   `id` and never mentions `user_id`. So every account created after 004 was
--   applied lands with user_id = NULL. Same for create_user_profile() in
--   COMPLETE_DATABASE_SETUP.sql:760. (Note diagnostics/fix-rls-policies.sql:73
--   DOES insert both columns -- that variant is almost certainly what produced
--   the one good row, and it is not what is bound to auth.users today.)
--
-- WHY BACKFILL RATHER THAN RE-POINT THE CODE AT `id`:
--   `id` is unquestionably the canonical join key -- every FK in
--   001_initial_schema.sql (orders, wallets, referrals, invoices, ...) points at
--   user_profiles(id). But `user_id` is *read* in two places that a code sweep
--   cannot reach cheaply:
--     - RLS policies of the form `user_profiles.user_id = auth.uid()`
--       (migrations/006_reward_system.sql lines 66/119/213/272, and whatever
--       drift of them is live), which fail CLOSED while the column is NULL;
--     - backend queries `.eq('user_id', userId)` on user_profiles
--       (backend/services/referral-service.ts:193 and :222 -- the confirmed
--       symptom, where a real referral silently reports "User was not referred"
--       -- plus backend/routes/stripe.ts:549 and backend/routes/wallet.ts:264).
--   Populating the column fixes all of those at once, changes no application
--   code, drops no policy, and cannot cascade. Re-pointing would mean editing
--   RLS policy files owned by other in-flight work (task 3390cc85 / 8dccb9da)
--   and would still leave the NULL column as a trap for the next writer.
--   DECISION: user_id is a maintained mirror of id. It is NOT a second identity.
--
-- SAFETY: idempotent, re-runnable, and safe on a database where 004 was never
-- applied (the column is created here if missing). No data is destroyed -- the
-- UPDATE only touches rows where user_id IS NULL.
--
-- ORDERING: no dependency in either direction. This file's UPDATE does not
-- change `role`, so 20260727_prevent_role_self_escalation.sql's trigger
-- short-circuits at its line 48 and never reaches the currently-broken
-- get_user_role() -- the backfill is safe to run before OR after that pair.
-- The trigger installed below is also BEFORE INSERT OR UPDATE on the same
-- table; Postgres fires same-timing triggers in name order, so
-- enforce_user_profile_role_immutable_trigger runs first. They do not overlap
-- (that one only touches NEW.role, this one only NEW.user_id).
--
-- DO NOT APPLY TO PRODUCTION FROM AN AGENT SESSION. David applies this.
-- ============================================================================

-- 1. Make sure the column, FK and unique index exist (no-op if 004 ran).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'user_profiles'
       AND column_name  = 'user_id'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN user_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_profiles_user_id_fkey'
       AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_id_key
  ON public.user_profiles(user_id);

-- 2. Backfill. Expected on production 2026-07-28: 4 rows updated.
UPDATE public.user_profiles
   SET user_id = id
 WHERE user_id IS NULL;

-- 3. Keep it populated, whichever writer inserts the row.
--    A BEFORE ROW trigger on user_profiles itself covers ALL four known writers
--    (handle_new_user, create_user_profile, the diagnostics variant, and any
--    service-role insert from backend/) without duplicating a 60-line signup
--    function here -- and without racing the role-hardcoding work in
--    20260727_signup_role_hardcode_customer.sql, which owns that function.
--    BEFORE ROW triggers run before constraints are checked, so this also makes
--    the NOT NULL in step 4 unreachable in practice.
CREATE OR REPLACE FUNCTION public.user_profiles_sync_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_id := COALESCE(NEW.user_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_sync_user_id ON public.user_profiles;

CREATE TRIGGER user_profiles_sync_user_id
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_sync_user_id();

-- 4. Now the column can be declared what it has always meant to be.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'user_profiles'
       AND column_name  = 'user_id'
       AND is_nullable  = 'YES'
  ) THEN
    ALTER TABLE public.user_profiles ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- Verification (run manually after applying, as service role):
--
--   SELECT count(*) AS still_null
--     FROM public.user_profiles WHERE user_id IS NULL;
--   -- expect 0
--
--   SELECT count(*) AS mismatched
--     FROM public.user_profiles WHERE user_id IS DISTINCT FROM id;
--   -- expect 0
--
-- Then re-check the symptom that opened the task -- a referred user's
-- referred_by lookup (backend/services/referral-service.ts:222) should now
-- return a row instead of "User was not referred".
-- ============================================================================
