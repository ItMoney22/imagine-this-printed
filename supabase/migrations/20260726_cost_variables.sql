-- Manager cost variables — real storage for the ManagerDashboard cost inputs.
--
-- Why this migration exists even though `cost_variables` appears in
-- 001_initial_schema.sql / COMPLETE_DATABASE_SETUP.sql / prisma/schema.prisma:
-- those early files were never fully applied to this project. Verified against
-- the live database on 2026-07-26 — `relation "public.cost_variables" does not
-- exist`. Until now `costManagementService.saveCostVariables` only console.logged
-- the values and `getCostVariables` returned hardcoded defaults, so managers were
-- pricing against numbers that were never saved.
--
-- Column names match prisma/schema.prisma's existing @map() names so the Prisma
-- model keeps working without an edit. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.cost_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  location_id TEXT,
  location_name TEXT,
  filament_price_per_gram DECIMAL NOT NULL DEFAULT 0,
  electricity_cost_per_hour DECIMAL NOT NULL DEFAULT 0,
  average_packaging_cost DECIMAL NOT NULL DEFAULT 0,
  monthly_rent DECIMAL NOT NULL DEFAULT 0,
  overhead_percentage DECIMAL NOT NULL DEFAULT 0,
  default_margin_percentage DECIMAL NOT NULL DEFAULT 25,
  labor_rate_per_hour DECIMAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per manager. This is what makes the dashboard's upsert
-- (onConflict: 'manager_id') resolve to an UPDATE instead of piling up a new
-- row on every save, and it is the "keyed by user ID" guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS cost_variables_manager_id_key
  ON public.cost_variables (manager_id);

ALTER TABLE public.cost_variables ENABLE ROW LEVEL SECURITY;

-- Managers own their row.
DROP POLICY IF EXISTS "Managers can manage their cost variables" ON public.cost_variables;
CREATE POLICY "Managers can manage their cost variables" ON public.cost_variables
  FOR ALL
  USING (auth.uid() = manager_id)
  WITH CHECK (auth.uid() = manager_id);

-- Role lookup for the admin policy below.
--
-- Deliberately NOT public.get_user_role() from 005_rls_fixes.sql: that helper
-- does `WHERE id = user_id` while public.user_profiles has BOTH an `id` and a
-- `user_id` column, so every call raises `column reference "user_id" is
-- ambiguous` (verified live, 2026-07-26). Any policy calling it fails closed.
-- This helper takes an unambiguously-named parameter and is SECURITY DEFINER so
-- it reads user_profiles without dragging that table's own RLS (and its
-- recursion risk) into this policy.
CREATE OR REPLACE FUNCTION public.cost_variables_role_for(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_role TEXT;
BEGIN
  SELECT up.role INTO resolved_role
  FROM public.user_profiles up
  WHERE up.id = p_user_id;
  RETURN COALESCE(resolved_role, 'customer');
END;
$$;

-- Admins/founders can see and override everyone's.
DROP POLICY IF EXISTS "Admins have full access to all cost variables" ON public.cost_variables;
CREATE POLICY "Admins have full access to all cost variables" ON public.cost_variables
  FOR ALL
  USING (public.cost_variables_role_for(auth.uid()) IN ('admin', 'founder'))
  WITH CHECK (public.cost_variables_role_for(auth.uid()) IN ('admin', 'founder'));

-- Backend/service-role access.
DROP POLICY IF EXISTS "Service role full access to cost variables" ON public.cost_variables;
CREATE POLICY "Service role full access to cost variables" ON public.cost_variables
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Keep last_updated honest no matter who writes the row.
CREATE OR REPLACE FUNCTION public.touch_cost_variables_last_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cost_variables_last_updated ON public.cost_variables;
CREATE TRIGGER cost_variables_last_updated
  BEFORE UPDATE ON public.cost_variables
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_cost_variables_last_updated();

CREATE INDEX IF NOT EXISTS idx_cost_variables_manager ON public.cost_variables (manager_id);

GRANT ALL ON public.cost_variables TO authenticated;
GRANT ALL ON public.cost_variables TO service_role;
