-- ============================================================================
-- Migration 003: User Profile Creation Triggers
-- ============================================================================
--
-- This migration creates triggers that automatically:
-- 1. Create a user_profiles record when a new user signs up in auth.users
-- 2. Create a user_wallets record with 0 balance
-- 3. Handle proper field mapping from auth metadata
--
-- ============================================================================

-- Function to create user profile and wallet on signup
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
    COALESCE(NEW.raw_user_meta_data->>'role', 'customer'),
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

-- Drop existing trigger if it exists and create new one
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to handle user deletion (cleanup)
CREATE OR REPLACE FUNCTION public.handle_user_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete user profile (cascades to wallet and other tables via FK)
  -- This happens automatically due to ON DELETE CASCADE constraints
  -- But we keep this for explicit logging if needed
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users DELETE
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;

CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_delete();
