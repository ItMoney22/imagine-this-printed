-- ============================================================================
-- Task 5: User Profile Creation Triggers
-- ============================================================================
--
-- This migration creates triggers that automatically:
-- 1. Create a user_profiles record when a new user signs up in auth.users
-- 2. Create a user_wallets record with 0 balance
-- 3. Generate a unique 8-character referral code
-- 4. Handle cascade deletion when a user is deleted
--
-- MANUAL APPLICATION IN SUPABASE DASHBOARD:
-- 1. Go to https://app.supabase.com
-- 2. Select your project
-- 3. Click "SQL Editor" in the left sidebar
-- 4. Click "New query"
-- 5. Copy and paste the SQL below (between the markers)
-- 6. Click "Run"
--
-- ============================================================================

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create user profile
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );

  -- Create user wallet with 0 balance
  INSERT INTO public.user_wallets (user_id, itc_balance, usd_balance)
  VALUES (NEW.id, 0.00, 0.00);

  -- Generate referral code (8 character uppercase code from MD5 hash of user ID)
  UPDATE public.user_profiles
  SET referral_code = UPPER(SUBSTR(MD5(NEW.id::text), 1, 8))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users INSERT to create profile and wallet
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to handle user deletion (cascade cleanup)
CREATE OR REPLACE FUNCTION public.handle_user_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete user profile (cascades to wallet and other tables via FK)
  DELETE FROM public.user_profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users DELETE to cleanup profile and related data
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_delete();
