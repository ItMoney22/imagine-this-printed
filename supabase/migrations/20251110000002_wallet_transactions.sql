-- Migration: wallet_transactions ledger
-- Ported into the canonical timeline during schema consolidation (Watchtower task c759b3d4).
-- Corrected against LIVE production (Watchtower task 8dccb9da) via read-only introspection
-- of information_schema / pg_indexes / pg_policies / pg_constraint on the prod Supabase DB
-- (project czzyrmizvjqlifcivrhn) on 2026-08-17.
--
-- IMPORTANT — this is NOT a verbatim port of the orphaned
-- `migrations/create_wallet_transactions_table.sql`. That file described a DIFFERENT table
-- (columns: type / currency / reason / admin_id, DECIMAL balances) that no code in this repo
-- ever writes to. It appears to be an abandoned draft: the admin wallet routes it was written
-- for (`backend/routes/admin/wallet.ts`) actually write to `itc_transactions`, not here.
--
-- The shape below was reconstructed from the LIVE writers on the first pass (2026-07-26):
--   backend/routes/realistic-mockups.ts   (generate / reject-refund / auto-refund)
--   backend/routes/imagination-station.ts (auto-nest / smart-fill)
-- The 2026-08-17 verification pass then diffed that reconstruction against the actual live
-- catalog and found three drifts, corrected below:
--   1. user_id's FK targets public.user_profiles(id), not auth.users(id).
--   2. transaction_type carries a live CHECK constraint restricting it to a fixed enum —
--      'spend' (mentioned in the original column comment) is NOT one of the allowed values.
--   3. Only ONE RLS policy exists live (owner SELECT). The admin-SELECT and open INSERT
--      policies below were never applied — the open `WITH CHECK (true)` INSERT policy in
--      particular would have let ANY authenticated/anon caller forge ledger rows, since it
--      carried no `TO` clause; it's removed rather than fixed forward, since all live writers
--      use the service-role key and bypass RLS entirely, so no INSERT policy is needed.
--   idx_wallet_transactions_type and idx_wallet_transactions_reference were also dropped —
--   they don't exist live, so keeping them would have made this migration a no-op in name
--   only. Add them as a genuine forward migration if a query pattern needs them.
--
-- The table already exists in production, so every statement here is guarded; this migration
-- is a no-op against the live DB and exists so a from-scratch rebuild of supabase/migrations
-- produces a working ledger that matches production exactly.

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,      -- constrained below to the live CHECK enum
  amount INTEGER NOT NULL,             -- negative for spends, positive for credits/refunds
  balance_before INTEGER NOT NULL,     -- NOT NULL, no default (live constraint)
  balance_after INTEGER NOT NULL,      -- NOT NULL, no default (live constraint)
  reference_id UUID,                   -- e.g. mockup generation id
  reference_type TEXT,                 -- 'mockup' | 'imagination_auto_nest' | 'imagination_smart_fill' | ...
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- transaction_type enum (live CHECK constraint — confirmed via pg_constraint 2026-08-17)
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'mockup_generation'::text,
    'mockup_refund'::text,
    'background_removal'::text,
    'image_upscale'::text,
    'purchase'::text,
    'reward'::text,
    'admin_adjustment'::text
  ]));

-- Indexes (matches live exactly — confirmed via pg_indexes 2026-08-17)
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON public.wallet_transactions(created_at DESC);

-- Row Level Security (matches live exactly — confirmed via pg_policies 2026-08-17)
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wallet transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Admins can view all wallet transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "System can insert wallet transactions" ON public.wallet_transactions;

DROP POLICY IF EXISTS wallet_transactions_owner_select ON public.wallet_transactions;
CREATE POLICY wallet_transactions_owner_select
  ON public.wallet_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Documentation
COMMENT ON TABLE public.wallet_transactions IS 'ITC wallet ledger: one row per balance change, written by the mockup and imagination-station spend/refund paths';
COMMENT ON COLUMN public.wallet_transactions.transaction_type IS 'mockup_generation, mockup_refund, background_removal, image_upscale, purchase, reward, admin_adjustment (enforced by CHECK)';
COMMENT ON COLUMN public.wallet_transactions.amount IS 'Signed ITC delta (negative for spends)';
COMMENT ON COLUMN public.wallet_transactions.balance_before IS 'ITC balance before the transaction (NOT NULL — callers must supply)';
COMMENT ON COLUMN public.wallet_transactions.balance_after IS 'ITC balance after the transaction (NOT NULL — callers must supply)';
COMMENT ON COLUMN public.wallet_transactions.reference_type IS 'What the transaction refers to (mockup, imagination_auto_nest, imagination_smart_fill, ...)';
