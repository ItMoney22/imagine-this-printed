-- ============================================================================
-- Migration: Hardcode 'customer' role in the signup trigger
-- ============================================================================
--
-- VULNERABILITY (verified against migrations as checked in 2026-07-27):
-- supabase/migrations/003_user_triggers.sql:42 defines the currently-active
-- public.handle_new_user() (it CREATE OR REPLACEs and re-attaches the
-- on_auth_user_created trigger from 001_initial_schema.sql; no later
-- migration touches handle_new_user or on_auth_user_created again):
--
--   COALESCE(NEW.raw_user_meta_data->>'role', 'customer'),
--
-- `raw_user_meta_data` is populated verbatim from the `options.data` object
-- passed to `supabase.auth.signUp()`. Any caller holding the public anon key
-- (i.e. anyone -- it ships in the client bundle) can therefore call:
--
--   supabase.auth.signUp({ email, password, options: { data: { role: 'admin' } } })
--
-- and the new user_profiles row is created with role='admin' on account
-- creation, before any other check ever runs. Verified that neither
-- src/context/SupabaseAuthContext.tsx (signUp, ~line 343-354) nor
-- src/components/AuthModal.tsx nor src/pages/Signup.tsx ever pass `role` in
-- signup metadata themselves -- the app's own UI is not the vector, but the
-- trigger accepts it from ANY client calling the API directly, which is the
-- reported vulnerability.
--
-- COMPLETE_DATABASE_SETUP.sql's equivalent function, create_user_profile()
-- (~line 757-781), already hardcodes role to the literal 'customer' and does
-- NOT read raw_user_meta_data->>'role' -- that fresh-provision script was
-- not vulnerable to this specific vector and needs no change here.
--
-- FIX: replace the role expression with the literal 'customer'. Client-
-- supplied role metadata is now ignored entirely at signup. (Elevating a
-- user afterward still works via AdminDashboard.tsx's updateUserRole, which
-- is authorized by the companion migration
-- 20260727_prevent_role_self_escalation.sql.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create user profile
  INSERT INTO public.user_profiles (
    id,
    email,
    username,
    display_name,
    first_name,
    last_name,
    role,
    email_verified,
    profile_completed,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'first_name',
      SPLIT_PART(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    'customer', -- hardcoded: client-supplied role metadata is never trusted
    COALESCE((NEW.email_confirmed_at IS NOT NULL), false),
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Create user wallet with 0 balance
  INSERT INTO public.user_wallets (
    user_id,
    points_balance,
    itc_balance,
    lifetime_points_earned,
    lifetime_itc_earned,
    wallet_status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    0,
    0.00,
    0,
    0.00,
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- CREATE OR REPLACE FUNCTION preserves the existing on_auth_user_created
-- trigger binding (same function OID) -- no need to touch the trigger.
