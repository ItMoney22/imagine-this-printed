-- Stripe Connect Cash-Out System for ITC
-- Enables users to cash out ITC tokens to real USD via instant debit card payouts

-- ==============================================================
-- Table: stripe_connect_accounts
-- Stores user's Stripe Connect Express account information
-- ==============================================================
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  account_type TEXT DEFAULT 'express',

  -- Onboarding status
  onboarding_complete BOOLEAN DEFAULT false,
  details_submitted BOOLEAN DEFAULT false,
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,

  -- Instant payout eligibility
  instant_payouts_enabled BOOLEAN DEFAULT false,
  default_payout_method TEXT DEFAULT 'instant',

  -- External account info (debit card)
  has_external_account BOOLEAN DEFAULT false,
  external_account_last4 TEXT,
  external_account_brand TEXT,
  external_account_type TEXT,

  -- Requirements tracking from Stripe
  currently_due JSONB DEFAULT '[]',
  eventually_due JSONB DEFAULT '[]',
  past_due JSONB DEFAULT '[]',
  disabled_reason TEXT,

  -- Metadata
  country TEXT DEFAULT 'US',
  currency TEXT DEFAULT 'usd',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================
-- Table: itc_cashout_requests
-- Tracks all ITC cash-out requests and their status
-- ==============================================================
CREATE TABLE IF NOT EXISTS itc_cashout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  stripe_connect_account_id UUID REFERENCES stripe_connect_accounts(id) NOT NULL,

  -- Amounts
  amount_itc DECIMAL NOT NULL,
  gross_amount_usd DECIMAL NOT NULL,
  platform_fee_usd DECIMAL NOT NULL,
  platform_fee_percent DECIMAL DEFAULT 5.0,
  instant_fee_usd DECIMAL DEFAULT 0,
  net_amount_usd DECIMAL NOT NULL,

  -- Payout details
  payout_type TEXT DEFAULT 'instant',
  stripe_payout_id TEXT,
  stripe_transfer_id TEXT,

  -- Status tracking
  status TEXT DEFAULT 'pending',
  -- Values: 'pending', 'processing', 'paid', 'failed', 'cancelled'

  failure_code TEXT,
  failure_message TEXT,

  -- Timestamps
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================
-- Indexes for performance
-- ==============================================================
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_user_id
  ON stripe_connect_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_stripe_id
  ON stripe_connect_accounts(stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_itc_cashout_requests_user_id
  ON itc_cashout_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_itc_cashout_requests_status
  ON itc_cashout_requests(status);

CREATE INDEX IF NOT EXISTS idx_itc_cashout_requests_stripe_payout_id
  ON itc_cashout_requests(stripe_payout_id);

CREATE INDEX IF NOT EXISTS idx_itc_cashout_requests_created_at
  ON itc_cashout_requests(created_at DESC);

-- ==============================================================
-- Enable Row Level Security
-- ==============================================================
ALTER TABLE stripe_connect_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE itc_cashout_requests ENABLE ROW LEVEL SECURITY;

-- ==============================================================
-- RLS Policies for stripe_connect_accounts
-- ==============================================================

-- Users can view their own connect account
CREATE POLICY "Users can view own connect account"
  ON stripe_connect_accounts FOR SELECT
  USING (auth.uid() = user_id);

-- System can insert (via service role)
CREATE POLICY "Service role can manage connect accounts"
  ON stripe_connect_accounts FOR ALL
  USING (auth.role() = 'service_role');

-- Admins can view all
CREATE POLICY "Admins can view all connect accounts"
  ON stripe_connect_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ==============================================================
-- RLS Policies for itc_cashout_requests
-- ==============================================================

-- Users can view their own cashout requests
CREATE POLICY "Users can view own cashout requests"
  ON itc_cashout_requests FOR SELECT
  USING (auth.uid() = user_id);

-- System can insert/update (via service role)
CREATE POLICY "Service role can manage cashout requests"
  ON itc_cashout_requests FOR ALL
  USING (auth.role() = 'service_role');

-- Admins can view all
CREATE POLICY "Admins can view all cashout requests"
  ON itc_cashout_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ==============================================================
-- Updated_at triggers
-- ==============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_stripe_connect_accounts_updated_at
  ON stripe_connect_accounts;
CREATE TRIGGER update_stripe_connect_accounts_updated_at
  BEFORE UPDATE ON stripe_connect_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_itc_cashout_requests_updated_at
  ON itc_cashout_requests;
CREATE TRIGGER update_itc_cashout_requests_updated_at
  BEFORE UPDATE ON itc_cashout_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================
-- Add comments for documentation
-- ==============================================================
COMMENT ON TABLE stripe_connect_accounts IS
  'Stores Stripe Connect Express account info for ITC cash-out functionality';

COMMENT ON TABLE itc_cashout_requests IS
  'Tracks all ITC cash-out requests including amounts, fees, and payout status';

COMMENT ON COLUMN itc_cashout_requests.status IS
  'pending: awaiting processing, processing: funds transferring, paid: completed, failed: payout failed, cancelled: user cancelled';

COMMENT ON COLUMN stripe_connect_accounts.instant_payouts_enabled IS
  'Whether the connected debit card supports instant payouts';
