-- ============================================================================
-- Restore the Admin Dashboard submission tables + the products.approved
-- compatibility column
-- ============================================================================
-- Watchtower task 08444193-a962-46de-9d1a-d55ff9d2fabe (implementation of the
-- scout brief committed as 43927c2 under parent task 6f1a3291).
--
-- WHY THIS EXISTS
-- ---------------
-- `src/pages/AdminDashboard.tsx` loads, approves and rejects rows from
-- `public.three_d_models` and `public.vendor_products`, and the overview metrics
-- count pending rows in both. `src/utils/design-showcase-service.ts` reads
-- approved 3D models for the public showcase and filters `products` on an
-- `approved` column. None of the three objects exist in production. Verified
-- live 2026-08-16 against project ref czzyrmizvjqlifcivrhn:
--
--   GET /rest/v1/three_d_models?select=id&limit=1  -> 404 / 42P01 (relation missing)
--   GET /rest/v1/vendor_products?select=id&limit=1 -> 404 / 42P01 (relation missing)
--   GET /rest/v1/products?select=id,approved       -> 400 / 42703 (column missing)
--
-- No migration in this repo has ever declared either table -- the tables were
-- created out of band and lost, or never created at all. `001_initial_schema.sql`
-- does NOT define them at any point in git history, so this is an additive new
-- migration, not a repair of an existing file.
--
-- APPROVAL MODEL (the decision this migration encodes)
-- ----------------------------------------------------
-- * `vendor_products.approved` and `three_d_models.approved` are plain mutable
--   booleans, because the admin handlers update them directly
--   (`.update({ approved: true })`). Submitters can never set them true --
--   that is enforced by RLS, not by convention.
-- * `products` keeps `status` + `is_active` as the ONE source of truth.
--   `products.approved` is restored only as a SYNCHRONIZED COMPATIBILITY field:
--   it is always exactly `status = 'active' AND is_active IS TRUE`. A trigger
--   recomputes it on every insert and on every update that touches
--   status/is_active/approved, and a CHECK constraint makes drift impossible.
--   This deliberately prevents `approved` from becoming a third, independent
--   product lifecycle state.
--
-- SAFETY
-- ------
-- Idempotent and re-runnable. Additive only: no table is dropped, no existing
-- column is altered, no existing row loses data. `public.products` carried zero
-- non-internal triggers before this migration (verified live 2026-08-16), so the
-- new BEFORE trigger cannot collide with an existing one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.vendor_products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price           NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  images          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  category        TEXT NOT NULL DEFAULT 'other',
  approved        BOOLEAN NOT NULL DEFAULT false,
  commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 15 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  product_type    TEXT NOT NULL DEFAULT 'physical' CHECK (product_type IN ('physical', 'digital', 'both')),
  digital_price   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (digital_price >= 0),
  file_url        TEXT,
  shipping_cost   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  -- Legacy-compat, additive: backend/routes/user-products.ts (the ITC design
  -- download path) selects `name` and `metadata` from this table and reads
  -- metadata->>'creator_id'. Without these two columns PostgREST answers that
  -- select with 400/42703 and the route reports "Design not found". They are
  -- nullable and carry no behaviour of their own; `title` remains the display
  -- field the admin UI maps.
  name            TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.vendor_products IS 'Vendor product submissions awaiting admin approval. Read/approved by src/pages/AdminDashboard.tsx.';
COMMENT ON COLUMN public.vendor_products.approved IS 'Admin approval flag. Submitters can only ever write false (enforced by RLS WITH CHECK).';
COMMENT ON COLUMN public.vendor_products.name IS 'Legacy-compat alias field read by backend/routes/user-products.ts. `title` is authoritative for the admin UI.';

CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor_id  ON public.vendor_products (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_products_queue      ON public.vendor_products (approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_products_created_at ON public.vendor_products (created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. public.three_d_models
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.three_d_models (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  file_url    TEXT NOT NULL,
  preview_url TEXT,
  category    TEXT NOT NULL DEFAULT 'figurines'
              CHECK (category IN ('figurines', 'tools', 'decorative', 'functional', 'toys')),
  uploaded_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  approved    BOOLEAN NOT NULL DEFAULT false,
  votes       INTEGER NOT NULL DEFAULT 0 CHECK (votes >= 0),
  points      INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  file_type   TEXT NOT NULL DEFAULT 'stl' CHECK (file_type IN ('stl', '3mf', 'obj', 'glb')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.three_d_models IS '3D model submissions awaiting admin approval. Read/approved by src/pages/AdminDashboard.tsx; approved rows feed the public showcase in src/utils/design-showcase-service.ts.';
COMMENT ON COLUMN public.three_d_models.approved IS 'Admin approval flag. Submitters can only ever write false (enforced by RLS WITH CHECK).';

CREATE INDEX IF NOT EXISTS idx_three_d_models_uploaded_by ON public.three_d_models (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_three_d_models_queue       ON public.three_d_models (approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_three_d_models_created_at  ON public.three_d_models (created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. updated_at maintenance -- reuse the canonical helper from 001_initial_schema.sql
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_vendor_products_updated_at ON public.vendor_products;
CREATE TRIGGER update_vendor_products_updated_at
  BEFORE UPDATE ON public.vendor_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_three_d_models_updated_at ON public.three_d_models;
CREATE TRIGGER update_three_d_models_updated_at
  BEFORE UPDATE ON public.three_d_models
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. products.approved -- synchronized compatibility boolean
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.approved IS
  'COMPATIBILITY FIELD -- do not write directly. Always recomputed as (status = ''active'' AND is_active IS TRUE) by sync_products_approved_trigger. products.status + products.is_active remain the source of truth.';

-- Recompute the whole column from the source of truth. Cheap and idempotent.
UPDATE public.products
   SET approved = (status = 'active' AND is_active IS TRUE)
 WHERE approved IS DISTINCT FROM (status = 'active' AND is_active IS TRUE);

CREATE OR REPLACE FUNCTION public.sync_products_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- `approved` is never accepted from the caller; it is derived, every time.
  NEW.approved := (NEW.status = 'active' AND NEW.is_active IS TRUE);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_products_approved() IS
  'Keeps products.approved exactly equal to (status = ''active'' AND is_active IS TRUE) so the compatibility boolean can never drift into an independent approval state.';

DROP TRIGGER IF EXISTS sync_products_approved_trigger ON public.products;
CREATE TRIGGER sync_products_approved_trigger
  BEFORE INSERT OR UPDATE OF status, is_active, approved ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_products_approved();

-- With the backfill above and the trigger in place the constraint holds for
-- every existing row and can never be violated by a future write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname  = 'products_approved_matches_status'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_approved_matches_status
      CHECK (approved = (status = 'active' AND is_active IS TRUE));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
-- Contract, identical for both tables:
--   * anon + authenticated may SELECT approved rows only;
--   * an owner may SELECT all of their own rows;
--   * an owner may INSERT only as themselves and only with approved = false;
--   * an owner may UPDATE/DELETE only their own STILL-PENDING rows, and the
--     UPDATE WITH CHECK keeps ownership and approved = false -- i.e. nobody can
--     approve their own submission or hand it to someone else;
--   * admin/founder get FOR ALL through public.get_user_role(auth.uid()).
-- No `USING (true)` write policy is created anywhere in this file.
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.three_d_models  ENABLE ROW LEVEL SECURITY;

-- ---- vendor_products ----
DROP POLICY IF EXISTS "Public can view approved vendor products"        ON public.vendor_products;
DROP POLICY IF EXISTS "Vendors can view their own vendor products"      ON public.vendor_products;
DROP POLICY IF EXISTS "Vendors can submit vendor products"              ON public.vendor_products;
DROP POLICY IF EXISTS "Vendors can update their own pending products"   ON public.vendor_products;
DROP POLICY IF EXISTS "Vendors can delete their own pending products"   ON public.vendor_products;
DROP POLICY IF EXISTS "Staff have full access to vendor products"       ON public.vendor_products;

CREATE POLICY "Public can view approved vendor products"
  ON public.vendor_products FOR SELECT TO anon, authenticated
  USING (approved = true);

CREATE POLICY "Vendors can view their own vendor products"
  ON public.vendor_products FOR SELECT TO authenticated
  USING (vendor_id = (SELECT auth.uid()));

CREATE POLICY "Vendors can submit vendor products"
  ON public.vendor_products FOR INSERT TO authenticated
  WITH CHECK (vendor_id = (SELECT auth.uid()) AND approved = false);

CREATE POLICY "Vendors can update their own pending products"
  ON public.vendor_products FOR UPDATE TO authenticated
  USING      (vendor_id = (SELECT auth.uid()) AND approved = false)
  WITH CHECK (vendor_id = (SELECT auth.uid()) AND approved = false);

CREATE POLICY "Vendors can delete their own pending products"
  ON public.vendor_products FOR DELETE TO authenticated
  USING (vendor_id = (SELECT auth.uid()) AND approved = false);

CREATE POLICY "Staff have full access to vendor products"
  ON public.vendor_products FOR ALL TO authenticated
  USING      ((SELECT public.get_user_role((SELECT auth.uid()))) IN ('admin', 'founder'))
  WITH CHECK ((SELECT public.get_user_role((SELECT auth.uid()))) IN ('admin', 'founder'));

-- ---- three_d_models ----
DROP POLICY IF EXISTS "Public can view approved 3D models"            ON public.three_d_models;
DROP POLICY IF EXISTS "Uploaders can view their own 3D models"        ON public.three_d_models;
DROP POLICY IF EXISTS "Uploaders can submit 3D models"                ON public.three_d_models;
DROP POLICY IF EXISTS "Uploaders can update their own pending models" ON public.three_d_models;
DROP POLICY IF EXISTS "Uploaders can delete their own pending models" ON public.three_d_models;
DROP POLICY IF EXISTS "Staff have full access to 3D models"           ON public.three_d_models;

CREATE POLICY "Public can view approved 3D models"
  ON public.three_d_models FOR SELECT TO anon, authenticated
  USING (approved = true);

CREATE POLICY "Uploaders can view their own 3D models"
  ON public.three_d_models FOR SELECT TO authenticated
  USING (uploaded_by = (SELECT auth.uid()));

CREATE POLICY "Uploaders can submit 3D models"
  ON public.three_d_models FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = (SELECT auth.uid()) AND approved = false);

CREATE POLICY "Uploaders can update their own pending models"
  ON public.three_d_models FOR UPDATE TO authenticated
  USING      (uploaded_by = (SELECT auth.uid()) AND approved = false)
  WITH CHECK (uploaded_by = (SELECT auth.uid()) AND approved = false);

CREATE POLICY "Uploaders can delete their own pending models"
  ON public.three_d_models FOR DELETE TO authenticated
  USING (uploaded_by = (SELECT auth.uid()) AND approved = false);

CREATE POLICY "Staff have full access to 3D models"
  ON public.three_d_models FOR ALL TO authenticated
  USING      ((SELECT public.get_user_role((SELECT auth.uid()))) IN ('admin', 'founder'))
  WITH CHECK ((SELECT public.get_user_role((SELECT auth.uid()))) IN ('admin', 'founder'));

-- ---------------------------------------------------------------------------
-- 6. PostgREST grants (RLS above is what actually gates the rows)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT                         ON public.vendor_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_products TO authenticated;

GRANT SELECT                         ON public.three_d_models TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.three_d_models TO authenticated;

-- service_role bypasses RLS and already holds its grants; nothing to change.

-- ---------------------------------------------------------------------------
-- 7. Make PostgREST pick up the new relations without waiting for its poll
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
