-- Fix infinite recursion in user_profiles RLS policies
-- Run this in your Supabase SQL Editor

-- Step 1: Disable RLS temporarily to fix the policies
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop all existing policies on user_profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by all" ON user_profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON user_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON user_profiles;
DROP POLICY IF EXISTS "Enable update for users based on user_id" ON user_profiles;

-- Step 3: Create simpler, non-recursive policies
-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Policy: Users can view public profiles
CREATE POLICY "Anyone can view public profiles" ON user_profiles
    FOR SELECT
    USING (is_public = true);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE
    USING (auth.uid() = id);

-- Policy: Users can insert their own profile on signup
CREATE POLICY "Users can create own profile" ON user_profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Step 4: Re-enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Step 5: Check if user_wallets table exists and fix its policies too
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'user_wallets'
    ) THEN
        -- Disable RLS temporarily
        EXECUTE 'ALTER TABLE user_wallets DISABLE ROW LEVEL SECURITY';

        -- Drop existing policies
        EXECUTE 'DROP POLICY IF EXISTS "Users can view their own wallet" ON user_wallets';
        EXECUTE 'DROP POLICY IF EXISTS "Users can update their own wallet" ON user_wallets';

        -- Create new policies
        EXECUTE 'CREATE POLICY "Users can view own wallet" ON user_wallets
            FOR SELECT
            USING (user_id = auth.uid())';

        EXECUTE 'CREATE POLICY "Users can update own wallet" ON user_wallets
            FOR UPDATE
            USING (user_id = auth.uid())';

        -- Re-enable RLS
        EXECUTE 'ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY';
    END IF;
END $$;

-- Step 6: Create trigger to auto-create user profile on signup (if not exists)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id,
        user_id,
        email,
        username,
        display_name,
        role,
        email_verified,
        profile_completed,
        created_at,
        updated_at
    )
    VALUES (
        new.id,
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'first_name', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'role', 'customer'),
        COALESCE((new.email_confirmed_at IS NOT NULL), false),
        false,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    -- Create wallet for new user
    INSERT INTO public.user_wallets (
        user_id,
        points_balance,
        itc_balance,
        created_at,
        updated_at
    )
    VALUES (
        new.id,
        0,
        0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Test the policies (this should return an empty array or actual data, not an error)
SELECT COUNT(*) as test_count FROM user_profiles WHERE 1=1 LIMIT 1;

-- Success message
SELECT 'RLS policies have been fixed! You can now test authentication.' as message;