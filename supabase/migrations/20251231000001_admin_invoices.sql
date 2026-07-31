-- ============================================
-- Admin Invoices Extension
-- Adds support for admin-only invoices without founder split
-- ============================================

-- Add invoice_type column to distinguish admin vs founder invoices
ALTER TABLE founder_invoices
ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'founder'
CHECK (invoice_type IN ('admin', 'founder'));

-- Make founder_id nullable for admin invoices
ALTER TABLE founder_invoices
ALTER COLUMN founder_id DROP NOT NULL;

-- Update constraint comment
COMMENT ON COLUMN founder_invoices.invoice_type IS 'Type of invoice: admin (100% to business) or founder (35% founder split)';
COMMENT ON COLUMN founder_invoices.founder_id IS 'Founder who receives 35% earnings. NULL for admin invoices.';

-- Add index for invoice_type queries
CREATE INDEX IF NOT EXISTS idx_founder_invoices_type ON founder_invoices(invoice_type);

-- Update RLS policies to allow viewing admin invoices by admins
-- (Backend uses service role, so this is mainly for documentation)
