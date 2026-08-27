-- ============================================
-- Founder Invoices System
-- Allows founders and admins to create Stripe invoices
-- and track payments with 35% founder earnings
-- ============================================

-- Founder invoices table
CREATE TABLE IF NOT EXISTS founder_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who created this invoice
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('founder', 'admin')),

  -- Which founder gets the 35% (same as created_by for founders, can differ for admin-created)
  founder_id UUID NOT NULL REFERENCES auth.users(id),

  -- Client info
  client_email TEXT NOT NULL,
  client_name TEXT,

  -- Optional order link
  order_id UUID REFERENCES orders(id),

  -- Stripe references
  stripe_invoice_id TEXT,
  stripe_invoice_url TEXT,
  stripe_hosted_invoice_url TEXT,

  -- Amounts (in cents for precision)
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  founder_earnings_cents INTEGER NOT NULL DEFAULT 0,

  -- Calculated percentages
  founder_percentage NUMERIC(5,2) NOT NULL DEFAULT 35.00,
  platform_percentage NUMERIC(5,2) NOT NULL DEFAULT 65.00,

  -- Invoice details
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [{ "description": "Custom T-Shirt Design", "amount_cents": 5000, "quantity": 1 }]

  memo TEXT,
  due_date DATE,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void', 'uncollectible')),

  -- Timestamps
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_founder_invoices_founder_id ON founder_invoices(founder_id);
CREATE INDEX idx_founder_invoices_created_by ON founder_invoices(created_by_user_id);
CREATE INDEX idx_founder_invoices_status ON founder_invoices(status);
CREATE INDEX idx_founder_invoices_stripe_id ON founder_invoices(stripe_invoice_id);
CREATE INDEX idx_founder_invoices_client_email ON founder_invoices(client_email);

-- RLS policies
ALTER TABLE founder_invoices ENABLE ROW LEVEL SECURITY;

-- Founders can view their own invoices (where they are the founder or creator)
CREATE POLICY "Founders can view own invoices" ON founder_invoices
  FOR SELECT
  USING (
    auth.uid() = founder_id
    OR auth.uid() = created_by_user_id
  );

-- Founders can create invoices for themselves
CREATE POLICY "Founders can create own invoices" ON founder_invoices
  FOR INSERT
  WITH CHECK (
    auth.uid() = founder_id
    AND auth.uid() = created_by_user_id
  );

-- Founders can update their draft invoices
CREATE POLICY "Founders can update own draft invoices" ON founder_invoices
  FOR UPDATE
  USING (
    auth.uid() = founder_id
    AND status = 'draft'
  );

-- Admins can do everything (uses service role in backend)
-- No explicit policy needed - backend uses service role key

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_founder_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER founder_invoices_updated_at
  BEFORE UPDATE ON founder_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_founder_invoices_updated_at();

-- Add comment for documentation
COMMENT ON TABLE founder_invoices IS 'Invoices created by founders/admins to bill clients. Payments processed through Stripe with 35% going to founder earnings.';
