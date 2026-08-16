-- Manager cost calculator persistence: product_cost_breakdowns + gpt_cost_queries.
-- Watchtower task 078ccd51 (follow-on to fe413f2e / migration 20260726_cost_variables.sql).
--
-- Same reason this migration exists standalone rather than relying on
-- 001_initial_schema.sql: 001 declares `product_cost_breakdowns` but was never
-- fully applied to the live database (confirmed missing 2026-07-26 while
-- building cost_variables). This migration also deliberately does NOT copy
-- 001's product_cost_breakdowns shape verbatim — that version requires a
-- NOT NULL FK to `products` and a `cost_variables_id`, which would force the
-- Cost Calculator tab to gain a full product picker before it could save
-- anything. `product_id` here is a manager-entered label (TEXT, matches the
-- existing ProductCostBreakdown.productId contract in src/types/index.ts,
-- which was never a strict products.id in the first place — the original
-- mock used arbitrary strings like 'product_1'). Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.product_cost_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  print_time_hours DECIMAL NOT NULL DEFAULT 0,
  material_usage_grams DECIMAL NOT NULL DEFAULT 0,
  material_cost DECIMAL NOT NULL DEFAULT 0,
  electricity_cost DECIMAL NOT NULL DEFAULT 0,
  labor_cost DECIMAL NOT NULL DEFAULT 0,
  packaging_cost DECIMAL NOT NULL DEFAULT 0,
  overhead_cost DECIMAL NOT NULL DEFAULT 0,
  total_cost DECIMAL NOT NULL DEFAULT 0,
  suggested_margin DECIMAL NOT NULL DEFAULT 0,
  suggested_price DECIMAL NOT NULL DEFAULT 0,
  final_price DECIMAL,
  notes TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (manager, product label) — saving a recalculated breakdown for
-- the same product updates in place instead of piling up duplicates, and
-- keeps getCostAnalytics() from double-counting a product recalculated twice.
CREATE UNIQUE INDEX IF NOT EXISTS product_cost_breakdowns_manager_product_key
  ON public.product_cost_breakdowns (manager_id, product_id);

CREATE INDEX IF NOT EXISTS idx_product_cost_breakdowns_manager
  ON public.product_cost_breakdowns (manager_id);

ALTER TABLE public.product_cost_breakdowns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can manage their cost breakdowns" ON public.product_cost_breakdowns;
CREATE POLICY "Managers can manage their cost breakdowns" ON public.product_cost_breakdowns
  FOR ALL
  USING (auth.uid() = manager_id)
  WITH CHECK (auth.uid() = manager_id);

-- Reuses the role helper from 20260726_cost_variables.sql (SECURITY DEFINER,
-- unambiguous column reference — see that migration for why this project's
-- own public.get_user_role() is unsafe to call from a policy).
DROP POLICY IF EXISTS "Admins have full access to all cost breakdowns" ON public.product_cost_breakdowns;
CREATE POLICY "Admins have full access to all cost breakdowns" ON public.product_cost_breakdowns
  FOR ALL
  USING (public.cost_variables_role_for(auth.uid()) IN ('admin', 'founder'))
  WITH CHECK (public.cost_variables_role_for(auth.uid()) IN ('admin', 'founder'));

DROP POLICY IF EXISTS "Service role full access to cost breakdowns" ON public.product_cost_breakdowns;
CREATE POLICY "Service role full access to cost breakdowns" ON public.product_cost_breakdowns
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

CREATE OR REPLACE FUNCTION public.touch_product_cost_breakdowns_last_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_cost_breakdowns_last_updated ON public.product_cost_breakdowns;
CREATE TRIGGER product_cost_breakdowns_last_updated
  BEFORE UPDATE ON public.product_cost_breakdowns
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_product_cost_breakdowns_last_updated();

GRANT ALL ON public.product_cost_breakdowns TO authenticated;
GRANT ALL ON public.product_cost_breakdowns TO service_role;

-- GPT/Keyword cost assistant query history. queryGPTAssistant() itself makes
-- no LLM call (see cost-management.ts) — this table just stops
-- saveGPTQuery() from console.logging a manager's Q&A into the void.
CREATE TABLE IF NOT EXISTS public.gpt_cost_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  response TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gpt_cost_queries_user ON public.gpt_cost_queries (user_id, created_at DESC);

ALTER TABLE public.gpt_cost_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own assistant history" ON public.gpt_cost_queries;
CREATE POLICY "Users can manage their own assistant history" ON public.gpt_cost_queries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins have full access to assistant history" ON public.gpt_cost_queries;
CREATE POLICY "Admins have full access to assistant history" ON public.gpt_cost_queries
  FOR ALL
  USING (public.cost_variables_role_for(auth.uid()) IN ('admin', 'founder'))
  WITH CHECK (public.cost_variables_role_for(auth.uid()) IN ('admin', 'founder'));

DROP POLICY IF EXISTS "Service role full access to assistant history" ON public.gpt_cost_queries;
CREATE POLICY "Service role full access to assistant history" ON public.gpt_cost_queries
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON public.gpt_cost_queries TO authenticated;
GRANT ALL ON public.gpt_cost_queries TO service_role;
