-- Create wallet_transactions table for tracking all wallet operations
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('admin_credit', 'admin_debit', 'admin_adjust', 'redeem', 'purchase', 'reward', 'order_refund', 'signup_bonus')),
  currency TEXT NOT NULL CHECK (currency IN ('points', 'itc')),
  amount DECIMAL(10, 2) NOT NULL,
  balance_before DECIMAL(10, 2) NOT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  reason TEXT NOT NULL,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_currency ON wallet_transactions(currency);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_admin_id ON wallet_transactions(admin_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own transactions
CREATE POLICY "Users can view own wallet transactions"
  ON wallet_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Admins can view all transactions
CREATE POLICY "Admins can view all wallet transactions"
  ON wallet_transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policy: System can insert transactions (via service role)
CREATE POLICY "System can insert wallet transactions"
  ON wallet_transactions
  FOR INSERT
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE wallet_transactions IS 'Tracks all wallet balance changes including admin operations, redemptions, purchases, and rewards';
COMMENT ON COLUMN wallet_transactions.type IS 'Type of transaction: admin_credit, admin_debit, admin_adjust, redeem, purchase, reward, order_refund, signup_bonus';
COMMENT ON COLUMN wallet_transactions.currency IS 'Currency type: points or itc';
COMMENT ON COLUMN wallet_transactions.amount IS 'Transaction amount (can be negative for debits)';
COMMENT ON COLUMN wallet_transactions.balance_before IS 'Balance before the transaction';
COMMENT ON COLUMN wallet_transactions.balance_after IS 'Balance after the transaction';
COMMENT ON COLUMN wallet_transactions.reason IS 'Human-readable reason for the transaction';
COMMENT ON COLUMN wallet_transactions.admin_id IS 'ID of admin who performed the action (if applicable)';
COMMENT ON COLUMN wallet_transactions.metadata IS 'Additional transaction metadata as JSON';
