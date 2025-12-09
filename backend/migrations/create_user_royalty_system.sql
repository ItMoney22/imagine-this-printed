-- Migration: User Royalty System (10% ITC per sale)
-- Tracks user-generated products and credits creators when products sell

-- Add creator tracking to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES user_profiles(id),
ADD COLUMN IF NOT EXISTS is_user_generated BOOLEAN DEFAULT false;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_products_created_by_user ON products(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_products_user_generated ON products(is_user_generated);

-- Create user_product_royalties table to track earnings
CREATE TABLE IF NOT EXISTS user_product_royalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  product_id UUID NOT NULL REFERENCES products(id),
  order_id UUID REFERENCES orders(id), -- NULL for pending, set when order completes
  amount_cents INT NOT NULL, -- 10% of sale price
  itc_amount INT NOT NULL, -- ITC credits awarded
  status TEXT NOT NULL CHECK (status IN ('pending', 'credited', 'failed')),
  credited_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_royalties_user ON user_product_royalties(user_id);
CREATE INDEX IF NOT EXISTS idx_royalties_product ON user_product_royalties(product_id);
CREATE INDEX IF NOT EXISTS idx_royalties_order ON user_product_royalties(order_id);
CREATE INDEX IF NOT EXISTS idx_royalties_status ON user_product_royalties(status);

-- Create updated_at trigger
CREATE TRIGGER update_user_product_royalties_updated_at
  BEFORE UPDATE ON user_product_royalties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE user_product_royalties ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own royalties
CREATE POLICY user_royalties_read_own ON user_product_royalties
  FOR SELECT
  USING (user_id = auth.uid());

-- Admins can view all royalties
CREATE POLICY user_royalties_read_admin ON user_product_royalties
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- Only service role can insert/update royalties (webhook-driven)
-- No user-facing policies for INSERT/UPDATE

-- Add comments
COMMENT ON TABLE user_product_royalties IS 'Tracks 10% ITC royalties for user-generated products';
COMMENT ON COLUMN user_product_royalties.user_id IS 'Creator of the product';
COMMENT ON COLUMN user_product_royalties.product_id IS 'Product that was sold';
COMMENT ON COLUMN user_product_royalties.order_id IS 'Order that triggered the royalty';
COMMENT ON COLUMN user_product_royalties.amount_cents IS '10% of product sale price in cents';
COMMENT ON COLUMN user_product_royalties.itc_amount IS 'ITC credits awarded (1 cent = 1 ITC)';
COMMENT ON COLUMN user_product_royalties.status IS 'pending, credited, or failed';

-- Add royalty info to products metadata
COMMENT ON COLUMN products.created_by_user_id IS 'User who created this product (for royalty tracking)';
COMMENT ON COLUMN products.is_user_generated IS 'True if created via /create-design user flow';
