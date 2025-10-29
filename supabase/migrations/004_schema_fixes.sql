-- ============================================================================
-- Migration 004: Schema Fixes for Missing Columns
-- ============================================================================
--
-- CRITICAL FIX: This migration adds columns that were applied manually during
-- testing but were not committed to migrations, causing schema drift.
--
-- These fixes ensure fresh deployments match the tested schema.
--
-- ============================================================================

-- Add missing columns to user_profiles (if not already present)
DO $$
BEGIN
  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN user_id UUID;
    UPDATE user_profiles SET user_id = id WHERE user_id IS NULL;
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_id_key ON user_profiles(user_id);
  END IF;

  -- Add profile_image column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'profile_image'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN profile_image TEXT;
  END IF;

  -- Add location column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'location'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN location VARCHAR(255);
  END IF;

  -- Add website column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'website'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN website VARCHAR(255);
  END IF;

  -- Add social_links column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'social_links'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN social_links JSONB DEFAULT '{}';
  END IF;

  -- Add is_public column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'is_public'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN is_public BOOLEAN DEFAULT true;
  END IF;

  -- Add show_order_history column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'show_order_history'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN show_order_history BOOLEAN DEFAULT true;
  END IF;

  -- Add show_designs column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'show_designs'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN show_designs BOOLEAN DEFAULT true;
  END IF;

  -- Add show_models column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'show_models'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN show_models BOOLEAN DEFAULT true;
  END IF;

  -- Add points column if it doesn't exist (for backward compatibility)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'points'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN points INTEGER DEFAULT 0;
  END IF;

  -- Add itc_balance column if it doesn't exist (for backward compatibility)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'itc_balance'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN itc_balance DECIMAL(10,2) DEFAULT 0;
  END IF;

  -- Add joined_date column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'joined_date'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN joined_date TIMESTAMPTZ DEFAULT NOW();
  END IF;

END $$;

-- Add missing columns to user_wallets
DO $$
BEGIN
  -- Add stripe_customer_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_wallets'
    AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE user_wallets ADD COLUMN stripe_customer_id VARCHAR(255);
  END IF;
END $$;

-- Add missing columns to referral_codes
DO $$
BEGIN
  -- Add discount_type if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'referral_codes'
    AND column_name = 'discount_type'
  ) THEN
    ALTER TABLE referral_codes ADD COLUMN discount_type VARCHAR(20) DEFAULT 'percentage';
  END IF;

  -- Add discount_value if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'referral_codes'
    AND column_name = 'discount_value'
  ) THEN
    ALTER TABLE referral_codes ADD COLUMN discount_value DECIMAL(10,2);
  END IF;

  -- Add points_reward if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'referral_codes'
    AND column_name = 'points_reward'
  ) THEN
    ALTER TABLE referral_codes ADD COLUMN points_reward INTEGER DEFAULT 0;
  END IF;

  -- Add metadata if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'referral_codes'
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE referral_codes ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END $$;

-- Add missing columns to products
DO $$
BEGIN
  -- Add currency if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name = 'currency'
  ) THEN
    ALTER TABLE products ADD COLUMN currency VARCHAR(3) DEFAULT 'USD';
  END IF;

  -- Add inventory_count if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name = 'inventory_count'
  ) THEN
    ALTER TABLE products ADD COLUMN inventory_count INTEGER DEFAULT 0;
  END IF;

  -- Add is_active if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;

  -- Add images as JSONB if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name = 'images'
  ) THEN
    ALTER TABLE products ADD COLUMN images JSONB DEFAULT '[]';
  END IF;

  -- Add variants if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name = 'variants'
  ) THEN
    ALTER TABLE products ADD COLUMN variants JSONB DEFAULT '[]';
  END IF;

  -- Add metadata if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE products ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END $$;

-- Ensure UNIQUE constraints are in place
DO $$
BEGIN
  -- Ensure email is unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_email_key'
  ) THEN
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_email_key UNIQUE (email);
  END IF;

  -- Ensure username is unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_username_key'
  ) THEN
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_username_key UNIQUE (username);
  END IF;

  -- Ensure referral code is unique
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referral_codes_code_key'
  ) THEN
    ALTER TABLE referral_codes ADD CONSTRAINT referral_codes_code_key UNIQUE (code);
  END IF;
END $$;

-- Add any missing indexes
CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Schema fixes applied successfully. Missing columns added with backward compatibility.';
END $$;
