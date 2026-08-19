-- ============================================================================
-- Migration: Vendor-scoped RLS policies for public.products (INSERT/UPDATE/DELETE)
-- Watchtower task f8ecc070-f7ea-4f45-8aaa-92016dba0c9e
-- ============================================================================
--
-- PROBLEM (verified against the LIVE production catalog 2026-08-19):
--   pg_policies on public.products had exactly four policies --
--     "Anyone can view products"   SELECT TO public  USING (true)
--     "Admins can insert products" INSERT TO authenticated
--     "Admins can update products" UPDATE TO authenticated
--     "Admins can delete products" DELETE TO authenticated
--   -- all three write policies gated on
--   EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin').
--
--   There was NO vendor-scoped write policy at all. Every write from
--   src/pages/VendorDashboard.tsx -- handleAddToStore (line ~164),
--   handleSubmitProduct (line ~205) and handleUpdateProduct (line ~400) --
--   therefore hit a closed door: INSERT raised 42501, and UPDATE matched zero
--   rows and returned 200 with an empty array, which the UI reported as
--   success. Live proof: SELECT count(*) FROM products WHERE vendor_id IS NOT
--   NULL returned 0 across 2,468 rows. Not one vendor product has ever
--   persisted.
--
-- WHAT THIS MIGRATION DOES:
--   1. Adds three vendor-scoped policies keyed on vendor_id = auth.uid().
--      products.vendor_id is uuid REFERENCES user_profiles(id), and
--      user_profiles.id is itself REFERENCES auth.users(id), so
--      vendor_id = auth.uid() is the correct join -- NOT user_profiles.user_id
--      (that column exists too, and is the wrong one).
--   2. Adds a BEFORE INSERT OR UPDATE trigger that keeps the admin-owned
--      columns out of a vendor's reach, so "vendors can write their own rows"
--      never becomes "vendors can publish and feature themselves".
--
-- WHY A TRIGGER AND NOT JUST WITH CHECK:
--   A WITH CHECK expression sees only the NEW row, so it cannot express
--   "this column may not CHANGE" -- only "this column must equal a constant".
--   Pinning is_active = false in WITH CHECK would make an approved, live
--   product permanently uneditable by the vendor who owns it. The trigger can
--   compare OLD to NEW, so a vendor can edit a live listing's copy and images,
--   and can take their own listing back down, but can never put one up.
--
-- THE PUBLISH GATE IS status + is_active, NOT `approved`:
--   products.approved is a DERIVED column. The pre-existing
--   sync_products_approved() BEFORE trigger overwrites it on every write with
--   (NEW.status = 'active' AND NEW.is_active IS TRUE), and the
--   products_approved_matches_status CHECK constraint enforces the same
--   identity. So `approved` is never accepted from a caller and there is no
--   point policing it -- the columns that actually decide whether a product
--   goes live are status and is_active, and those are what this trigger guards.
--
-- ADMIN ACCESS IS UNTOUCHED:
--   The three "Admins can ..." policies are left exactly as they are.
--   Permissive RLS policies are OR-ed, so adding vendor policies can only
--   widen access for vendors; it cannot narrow an admin's. The trigger exempts
--   both service_role connections (backend/worker/admin tooling on the service
--   key) and any caller whose own profile row already holds
--   admin / manager / founder.
--
-- ROLE GATE:
--   The vendor policies additionally require the caller's own role to be
--   'vendor'. Without that, any of the ~180 `customer` accounts could insert
--   rows into a table whose SELECT policy is USING (true) -- a public-facing
--   spam surface. public.get_user_role(uuid) is the existing SECURITY DEFINER
--   helper (its "WHERE id = user_id" ambiguity bug was fixed live on
--   2026-08-05; the live definition now reads "WHERE up.id =
--   get_user_role.user_id", confirmed with pg_get_functiondef before writing
--   this). SECURITY DEFINER is required here -- user_profiles' own RLS would
--   otherwise recurse.
--
-- DELETE IS NARROWED TO UNPUBLISHED ROWS -- deliberate, flagged in the handoff:
--   Twelve tables FK to products.id and ten of them are ON DELETE CASCADE
--   (reviews, product_variants, product_assets, etsy_listings,
--   design_qa_reviews, social_outbox, community_posts, ai_jobs, product_tags).
--   A one-click delete of a LIVE listing would silently cascade away its
--   reviews, variants and marketplace links. Vendors may delete their own rows
--   while those rows are not published; taking a live listing down is the
--   two-step unpublish-then-delete, both halves of which a vendor can do
--   unaided. (order_items has NO FK to products -- it snapshots product_name
--   and unit_price -- so order history is not at risk either way. Verified
--   live against pg_constraint.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Guard trigger: admin-owned columns stay admin-owned
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_vendor_product_write_limits()
RETURNS TRIGGER AS $fn$
DECLARE
  v_role TEXT;
BEGIN
  -- Server-side connections (service role key) bypass entirely: the backend,
  -- the worker and admin tooling all legitimately set these columns.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- No JWT at all (raw SQL, migrations, cron over a direct connection).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := public.get_user_role(auth.uid());

  -- Staff may set anything; this trigger exists only to fence non-staff in.
  IF v_role IN ('admin', 'manager', 'founder') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A vendor submission always lands as an unpublished draft awaiting admin
    -- approval, whatever the client sent. Forced rather than rejected, because
    -- submitting a product is a normal, expected vendor action -- the same
    -- shape as enforce_user_profile_role_immutable() forcing 'customer'.
    NEW.status      := 'draft';
    NEW.is_active   := false;
    NEW.is_featured := false;
    NEW.cost_price  := NULL;
    RETURN NEW;
  END IF;

  -- ---- UPDATE ----

  -- Ownership may not be reassigned. (The UPDATE policy's WITH CHECK already
  -- blocks handing a row to someone else; this makes the failure legible
  -- instead of a bare RLS violation.)
  IF NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
    RAISE EXCEPTION 'permission denied: vendor_id cannot be reassigned by this user';
  END IF;

  IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'permission denied: created_by_user_id cannot be changed by this user';
  END IF;

  -- Merchandising and margin belong to the admin, not the vendor.
  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured THEN
    RAISE EXCEPTION 'permission denied: is_featured can only be changed by staff';
  END IF;

  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    RAISE EXCEPTION 'permission denied: cost_price can only be changed by staff';
  END IF;

  -- The publish gate. Going live requires status='active' AND is_active. A
  -- vendor may never move a row INTO that state -- only an admin approves.
  -- Going the other way (unpublishing their own listing) stays allowed.
  IF (NEW.status = 'active' AND NEW.is_active IS TRUE)
     AND NOT (OLD.status = 'active' AND OLD.is_active IS TRUE) THEN
    RAISE EXCEPTION 'permission denied: products must be approved by an admin before they go live';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS enforce_vendor_product_write_limits_trigger ON public.products;

-- Fires BEFORE sync_products_approved_trigger -- same timing, and Postgres runs
-- same-timing triggers in name order, where "enforce_..." sorts before
-- "sync_...". So `approved` is derived from the status/is_active values this
-- trigger has already settled.
CREATE TRIGGER enforce_vendor_product_write_limits_trigger
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vendor_product_write_limits();

-- ---------------------------------------------------------------------------
-- 2. Vendor-scoped RLS policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Vendors can insert their own products" ON public.products;
CREATE POLICY "Vendors can insert their own products"
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    vendor_id = auth.uid()
    AND public.get_user_role(auth.uid()) = 'vendor'
  );

DROP POLICY IF EXISTS "Vendors can update their own products" ON public.products;
CREATE POLICY "Vendors can update their own products"
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    vendor_id = auth.uid()
    AND public.get_user_role(auth.uid()) = 'vendor'
  )
  WITH CHECK (
    vendor_id = auth.uid()
    AND public.get_user_role(auth.uid()) = 'vendor'
  );

DROP POLICY IF EXISTS "Vendors can delete their own products" ON public.products;
CREATE POLICY "Vendors can delete their own products"
  ON public.products
  FOR DELETE
  TO authenticated
  USING (
    vendor_id = auth.uid()
    AND public.get_user_role(auth.uid()) = 'vendor'
    -- Unpublished only -- see the cascade note in the header.
    AND approved IS NOT TRUE
  );
