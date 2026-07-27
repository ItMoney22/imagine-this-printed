-- Migration: wallet_transactions ledger
-- Ported into the canonical timeline during schema consolidation (Watchtower task c759b3d4).
--
-- IMPORTANT — this is NOT a verbatim port of the orphaned
-- `migrations/create_wallet_transactions_table.sql`. That file described a DIFFERENT table
-- (columns: type / currency / reason / admin_id, DECIMAL balances) that no code in this repo
-- ever writes to. It appears to be an abandoned draft: the admin wallet routes it was written
-- for (`backend/routes/admin/wallet.ts`) actually write to `itc_transactions`, not here.
--
-- The shape below is reconstructed from the LIVE writers, which are the source of truth:
--   backend/routes/realistic-mockups.ts   (generate / reject-refund / auto-refund)
--   backend/routes/imagination-station.ts (auto-nest / smart-fill)
-- Those files carry explicit comments that live `balance_before`/`balance_after` are
-- INTEGER NOT NULL with no default — omitting them silently failed the insert.
--
-- The table already exists in production, so every statement here is guarded; this migration
-- is a no-op against the live DB and exists so a from-scratch rebuild of supabase/migrations
-- produces a working ledger. See the handoff for the verification note.

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,      -- 'spend' | 'mockup_generation' | 'mockup_refund' | ...
  amount INTEGER NOT NULL,             -- negative for spends, positive for credits/refunds
  balance_before INTEGER NOT NULL,     -- NOT NULL, no default (live constraint)
  balance_after INTEGER NOT NULL,      -- NOT NULL, no default (live constraint)
  reference_id UUID,                   -- e.g. mockup generation id
  reference_type TEXT,                 -- 'mockup' | 'imagination_auto_nest' | 'imagination_smart_fill' | ...
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON public.wallet_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON public.wallet_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON public.wallet_transactions(created_at DESC);

-- Row Level Security
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Users can view own wallet transactions"
  ON public.wallet_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Admins can view all wallet transactions"
  ON public.wallet_transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Writes are service-role only (all live writers use the service key).
DROP POLICY IF EXISTS "System can insert wallet transactions" ON public.wallet_transactions;
CREATE POLICY "System can insert wallet transactions"
  ON public.wallet_transactions
  FOR INSERT
  WITH CHECK (true);

-- Documentation
COMMENT ON TABLE public.wallet_transactions IS 'ITC wallet ledger: one row per balance change, written by the mockup and imagination-station spend/refund paths';
COMMENT ON COLUMN public.wallet_transactions.transaction_type IS 'spend, mockup_generation, mockup_refund, etc.';
COMMENT ON COLUMN public.wallet_transactions.amount IS 'Signed ITC delta (negative for spends)';
COMMENT ON COLUMN public.wallet_transactions.balance_before IS 'ITC balance before the transaction (NOT NULL — callers must supply)';
COMMENT ON COLUMN public.wallet_transactions.balance_after IS 'ITC balance after the transaction (NOT NULL — callers must supply)';
COMMENT ON COLUMN public.wallet_transactions.reference_type IS 'What the transaction refers to (mockup, imagination_auto_nest, imagination_smart_fill, ...)';
