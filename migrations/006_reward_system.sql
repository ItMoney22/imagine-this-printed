-- Migration: Reward System Tables
-- Description: Creates tables for tracking points and ITC transactions, referrals, and order rewards
-- Date: 2025-11-10

-- ===================================================
-- 1. Points Transactions Table
-- ===================================================
CREATE TABLE IF NOT EXISTS points_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('earned', 'redeemed', 'expired', 'adjusted')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  related_entity_type VARCHAR(50), -- 'order', 'referral', 'milestone', 'admin_adjustment'
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes for performance
CREATE INDEX idx_points_transactions_user_id ON points_transactions(user_id);
CREATE INDEX idx_points_transactions_created_at ON points_transactions(created_at DESC);
CREATE INDEX idx_points_transactions_type ON points_transactions(type);
CREATE INDEX idx_points_transactions_related_entity ON points_transactions(related_entity_type, related_entity_id);

-- Enable RLS
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own points transactions"
  ON points_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all points transactions"
  ON points_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can insert points transactions"
  ON points_transactions FOR INSERT
  WITH CHECK (true);

-- ===================================================
-- 2. ITC Transactions Table
-- ===================================================
CREATE TABLE IF NOT EXISTS itc_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('purchase', 'reward', 'redemption', 'ai_generation', 'referral', 'transfer')),
  amount NUMERIC(18, 8) NOT NULL,
  balance_after NUMERIC(18, 8) NOT NULL,
  usd_value NUMERIC(10, 2),
  reason TEXT NOT NULL,
  related_entity_type VARCHAR(50),
  related_entity_id UUID,
  transaction_hash VARCHAR(255), -- For blockchain integration later
  stripe_payment_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_itc_transactions_user_id ON itc_transactions(user_id);
CREATE INDEX idx_itc_transactions_created_at ON itc_transactions(created_at DESC);
CREATE INDEX idx_itc_transactions_type ON itc_transactions(type);
CREATE INDEX idx_itc_transactions_stripe_payment ON itc_transactions(stripe_payment_id);

-- Enable RLS
ALTER TABLE itc_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own ITC transactions"
  ON itc_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all ITC transactions"
  ON itc_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can insert ITC transactions"
  ON itc_transactions FOR INSERT
  WITH CHECK (true);

-- ===================================================
-- 3. Referral Codes Table
-- ===================================================
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  total_uses INTEGER DEFAULT 0,
  total_earnings NUMERIC(10, 2) DEFAULT 0,
  max_uses INTEGER, -- NULL = unlimited
  expires_at TIMESTAMPTZ,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_referral_codes_user_id ON referral_codes(user_id);
CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_codes_active ON referral_codes(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own referral codes"
  ON referral_codes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view active codes for validation"
  ON referral_codes FOR SELECT
  USING (is_active = true);

CREATE POLICY "Users can create their own referral codes"
  ON referral_codes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own referral codes"
  ON referral_codes FOR UPDATE
  USING (auth.uid() = user_id);

-- ===================================================
-- 4. Referral Transactions Table
-- ===================================================
CREATE TABLE IF NOT EXISTS referral_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_email VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('signup', 'purchase', 'milestone')),
  referrer_reward_points INTEGER DEFAULT 0,
  referrer_reward_itc NUMERIC(10, 2) DEFAULT 0,
  referee_reward_points INTEGER DEFAULT 0,
  referee_reward_itc NUMERIC(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  related_order_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_reason TEXT
);

-- Indexes
CREATE INDEX idx_referral_transactions_referrer ON referral_transactions(referrer_id);
CREATE INDEX idx_referral_transactions_referee ON referral_transactions(referee_id);
CREATE INDEX idx_referral_transactions_code ON referral_transactions(referral_code_id);
CREATE INDEX idx_referral_transactions_status ON referral_transactions(status);
CREATE INDEX idx_referral_transactions_created_at ON referral_transactions(created_at DESC);

-- Enable RLS
ALTER TABLE referral_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their referral transactions"
  ON referral_transactions FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

CREATE POLICY "Admins can view all referral transactions"
  ON referral_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can insert referral transactions"
  ON referral_transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update referral transactions"
  ON referral_transactions FOR UPDATE
  USING (true);

-- ===================================================
-- 5. Order Rewards Tracking Table
-- ===================================================
CREATE TABLE IF NOT EXISTS order_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_total NUMERIC(10, 2) NOT NULL,
  user_tier VARCHAR(20) DEFAULT 'bronze',
  base_points INTEGER NOT NULL,
  tier_bonus_points INTEGER DEFAULT 0,
  promo_bonus_points INTEGER DEFAULT 0,
  total_points INTEGER NOT NULL,
  itc_bonus NUMERIC(10, 2) DEFAULT 0,
  promo_multiplier NUMERIC(4, 2) DEFAULT 1.0,
  is_first_purchase BOOLEAN DEFAULT false,
  points_transaction_id UUID REFERENCES points_transactions(id),
  itc_transaction_id UUID REFERENCES itc_transactions(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'awarded', 'failed', 'reversed')),
  awarded_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_order_rewards_order_id ON order_rewards(order_id);
CREATE INDEX idx_order_rewards_user_id ON order_rewards(user_id);
CREATE INDEX idx_order_rewards_status ON order_rewards(status);
CREATE INDEX idx_order_rewards_created_at ON order_rewards(created_at DESC);

-- Unique constraint to prevent duplicate rewards for same order
CREATE UNIQUE INDEX idx_order_rewards_unique_order ON order_rewards(order_id);

-- Enable RLS
ALTER TABLE order_rewards ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own order rewards"
  ON order_rewards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all order rewards"
  ON order_rewards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can insert order rewards"
  ON order_rewards FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update order rewards"
  ON order_rewards FOR UPDATE
  USING (true);

-- ===================================================
-- 6. User Total Spend View (for tier calculation)
-- ===================================================
CREATE OR REPLACE VIEW user_total_spend AS
SELECT
  user_id,
  COUNT(*) as total_orders,
  SUM(total) as total_spent,
  MAX(created_at) as last_order_date,
  MIN(created_at) as first_order_date
FROM orders
WHERE status IN ('delivered', 'completed', 'shipped')
GROUP BY user_id;

-- ===================================================
-- 7. Function: Award Order Rewards
-- ===================================================
CREATE OR REPLACE FUNCTION award_order_rewards(
  p_order_id UUID,
  p_user_id UUID,
  p_order_total NUMERIC,
  p_promo_multiplier NUMERIC DEFAULT 1.0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_tier VARCHAR(20);
  v_total_spent NUMERIC;
  v_is_first_purchase BOOLEAN;
  v_base_points INTEGER;
  v_tier_multiplier NUMERIC;
  v_tier_bonus INTEGER;
  v_promo_bonus INTEGER;
  v_total_points INTEGER;
  v_itc_bonus NUMERIC;
  v_points_tx_id UUID;
  v_itc_tx_id UUID;
  v_current_points INTEGER;
  v_current_itc NUMERIC;
  v_reward_id UUID;
BEGIN
  -- Check if reward already exists
  IF EXISTS (SELECT 1 FROM order_rewards WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Rewards already awarded for this order';
  END IF;

  -- Get user's total spend and determine tier
  SELECT
    COALESCE(total_spent, 0),
    COALESCE(total_orders, 0) = 0
  INTO v_total_spent, v_is_first_purchase
  FROM user_total_spend
  WHERE user_id = p_user_id;

  -- Determine tier
  IF v_total_spent >= 10000 THEN
    v_user_tier := 'platinum';
    v_tier_multiplier := 2.0;
    v_itc_bonus := p_order_total * 0.02;
  ELSIF v_total_spent >= 2000 THEN
    v_user_tier := 'gold';
    v_tier_multiplier := 1.5;
    v_itc_bonus := p_order_total * 0.01;
  ELSIF v_total_spent >= 500 THEN
    v_user_tier := 'silver';
    v_tier_multiplier := 1.25;
    v_itc_bonus := p_order_total * 0.005;
  ELSE
    v_user_tier := 'bronze';
    v_tier_multiplier := 1.0;
    v_itc_bonus := 0;
  END IF;

  -- Calculate points (1% base = 100 points per dollar)
  v_base_points := FLOOR(p_order_total * 100);
  v_tier_bonus := FLOOR(v_base_points * (v_tier_multiplier - 1));
  v_promo_bonus := FLOOR(v_base_points * (p_promo_multiplier - 1));

  -- Add first purchase bonus (50% extra)
  IF v_is_first_purchase THEN
    v_promo_bonus := v_promo_bonus + FLOOR(v_base_points * 0.5);
  END IF;

  v_total_points := v_base_points + v_tier_bonus + v_promo_bonus;

  -- Get current balances
  SELECT points, itc_balance
  INTO v_current_points, v_current_itc
  FROM user_wallets
  WHERE user_id = p_user_id;

  -- Create points transaction
  INSERT INTO points_transactions (
    user_id,
    type,
    amount,
    balance_after,
    reason,
    related_entity_type,
    related_entity_id,
    metadata
  ) VALUES (
    p_user_id,
    'earned',
    v_total_points,
    v_current_points + v_total_points,
    'Order completion reward',
    'order',
    p_order_id,
    jsonb_build_object(
      'tier', v_user_tier,
      'base_points', v_base_points,
      'tier_bonus', v_tier_bonus,
      'promo_bonus', v_promo_bonus,
      'is_first_purchase', v_is_first_purchase
    )
  ) RETURNING id INTO v_points_tx_id;

  -- Create ITC transaction if applicable
  IF v_itc_bonus > 0 THEN
    INSERT INTO itc_transactions (
      user_id,
      type,
      amount,
      balance_after,
      usd_value,
      reason,
      related_entity_type,
      related_entity_id,
      metadata
    ) VALUES (
      p_user_id,
      'reward',
      v_itc_bonus,
      v_current_itc + v_itc_bonus,
      p_order_total,
      'Order completion ITC bonus',
      'order',
      p_order_id,
      jsonb_build_object('tier', v_user_tier)
    ) RETURNING id INTO v_itc_tx_id;
  END IF;

  -- Update user wallet
  UPDATE user_wallets
  SET
    points = points + v_total_points,
    itc_balance = itc_balance + v_itc_bonus,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Create order reward record
  INSERT INTO order_rewards (
    order_id,
    user_id,
    order_total,
    user_tier,
    base_points,
    tier_bonus_points,
    promo_bonus_points,
    total_points,
    itc_bonus,
    promo_multiplier,
    is_first_purchase,
    points_transaction_id,
    itc_transaction_id,
    status,
    awarded_at
  ) VALUES (
    p_order_id,
    p_user_id,
    p_order_total,
    v_user_tier,
    v_base_points,
    v_tier_bonus,
    v_promo_bonus,
    v_total_points,
    v_itc_bonus,
    p_promo_multiplier,
    v_is_first_purchase,
    v_points_tx_id,
    v_itc_tx_id,
    'awarded',
    NOW()
  ) RETURNING id INTO v_reward_id;

  RETURN jsonb_build_object(
    'success', true,
    'reward_id', v_reward_id,
    'points_awarded', v_total_points,
    'itc_awarded', v_itc_bonus,
    'tier', v_user_tier,
    'is_first_purchase', v_is_first_purchase
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- ===================================================
-- 8. Function: Process Referral Reward
-- ===================================================
CREATE OR REPLACE FUNCTION process_referral_reward(
  p_referral_code VARCHAR,
  p_referee_id UUID,
  p_referee_email VARCHAR,
  p_reward_type VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code_record RECORD;
  v_referrer_points INTEGER := 500;
  v_referrer_itc NUMERIC := 5;
  v_referee_points INTEGER := 250;
  v_referee_itc NUMERIC := 2.5;
  v_transaction_id UUID;
BEGIN
  -- Get referral code details
  SELECT *
  INTO v_code_record
  FROM referral_codes
  WHERE code = p_referral_code
    AND is_active = true
    AND (max_uses IS NULL OR total_uses < max_uses)
    AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired referral code');
  END IF;

  -- Prevent self-referral
  IF v_code_record.user_id = p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot use your own referral code');
  END IF;

  -- Create referral transaction
  INSERT INTO referral_transactions (
    referral_code_id,
    referrer_id,
    referee_id,
    referee_email,
    type,
    referrer_reward_points,
    referrer_reward_itc,
    referee_reward_points,
    referee_reward_itc,
    status
  ) VALUES (
    v_code_record.id,
    v_code_record.user_id,
    p_referee_id,
    p_referee_email,
    p_reward_type,
    v_referrer_points,
    v_referrer_itc,
    v_referee_points,
    v_referee_itc,
    'completed'
  ) RETURNING id INTO v_transaction_id;

  -- Award points to referrer
  INSERT INTO points_transactions (user_id, type, amount, balance_after, reason, related_entity_type, related_entity_id)
  SELECT v_code_record.user_id, 'earned', v_referrer_points,
    (SELECT points + v_referrer_points FROM user_wallets WHERE user_id = v_code_record.user_id),
    'Referral reward', 'referral', v_transaction_id;

  -- Award ITC to referrer
  INSERT INTO itc_transactions (user_id, type, amount, balance_after, reason, related_entity_type, related_entity_id)
  SELECT v_code_record.user_id, 'referral', v_referrer_itc,
    (SELECT itc_balance + v_referrer_itc FROM user_wallets WHERE user_id = v_code_record.user_id),
    'Referral reward', 'referral', v_transaction_id;

  -- Update referrer wallet
  UPDATE user_wallets
  SET
    points = points + v_referrer_points,
    itc_balance = itc_balance + v_referrer_itc,
    updated_at = NOW()
  WHERE user_id = v_code_record.user_id;

  -- Award welcome bonus to referee
  INSERT INTO points_transactions (user_id, type, amount, balance_after, reason, related_entity_type, related_entity_id)
  SELECT p_referee_id, 'earned', v_referee_points,
    (SELECT points + v_referee_points FROM user_wallets WHERE user_id = p_referee_id),
    'Welcome bonus', 'referral', v_transaction_id;

  INSERT INTO itc_transactions (user_id, type, amount, balance_after, reason, related_entity_type, related_entity_id)
  SELECT p_referee_id, 'referral', v_referee_itc,
    (SELECT itc_balance + v_referee_itc FROM user_wallets WHERE user_id = p_referee_id),
    'Welcome bonus', 'referral', v_transaction_id;

  UPDATE user_wallets
  SET
    points = points + v_referee_points,
    itc_balance = itc_balance + v_referee_itc,
    updated_at = NOW()
  WHERE user_id = p_referee_id;

  -- Update referral code usage
  UPDATE referral_codes
  SET
    total_uses = total_uses + 1,
    updated_at = NOW()
  WHERE id = v_code_record.id;

  -- Mark transaction as completed
  UPDATE referral_transactions
  SET completed_at = NOW()
  WHERE id = v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'referrer_rewards', jsonb_build_object('points', v_referrer_points, 'itc', v_referrer_itc),
    'referee_rewards', jsonb_build_object('points', v_referee_points, 'itc', v_referee_itc)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ===================================================
-- 9. Add referral_code column to user_profiles
-- ===================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES auth.users(id);

-- Create index
CREATE INDEX IF NOT EXISTS idx_user_profiles_referral_code ON user_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by ON user_profiles(referred_by);

-- ===================================================
-- Grant permissions
-- ===================================================
GRANT SELECT ON user_total_spend TO authenticated;
GRANT EXECUTE ON FUNCTION award_order_rewards TO service_role;
GRANT EXECUTE ON FUNCTION process_referral_reward TO service_role;

-- ===================================================
-- Comments
-- ===================================================
COMMENT ON TABLE points_transactions IS 'Tracks all points transactions including earning and redemption';
COMMENT ON TABLE itc_transactions IS 'Tracks all ITC token transactions';
COMMENT ON TABLE referral_codes IS 'User-generated referral codes for inviting new users';
COMMENT ON TABLE referral_transactions IS 'Tracks referral rewards for both referrer and referee';
COMMENT ON TABLE order_rewards IS 'Tracks rewards awarded for completed orders';
COMMENT ON FUNCTION award_order_rewards IS 'Calculates and awards points/ITC for completed orders';
COMMENT ON FUNCTION process_referral_reward IS 'Processes referral rewards when new user signs up with code';
