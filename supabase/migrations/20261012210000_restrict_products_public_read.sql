-- Restrict the public read on products to published rows, and put the live
-- catalogue policies production already carries into the migration chain.
--
-- Watchtower task 7e54a10f-bbe6-47ab-b5ec-0123c4c7b688 (Cole Iverson, 2026-10-12).
-- Follow-up to 82d4ae2e (docs/SECURITY-rls-policy-reconciliation-82d4ae2e.md),
-- which found the products leak and left it for its own reviewed change.
--
-- THE LEAK
-- --------
-- Production carried "Anyone can view products" FOR SELECT USING (true) on
-- public.products. No migration file created it; the chain's own read rule
-- (002_rls_policies.sql) was "All users can view approved products" with
-- USING (approved = true AND status = 'active'). Measured live 2026-10-12:
-- 2,605 rows, 38 published, so 2,567 drafts, design-library imports,
-- rejected and archived rows (titles, prices, metadata) were readable with
-- the anon key that ships in the frontend bundle.
--
-- products.approved is derived: sync_products_approved() sets it to
-- (status = 'active' AND is_active IS TRUE) on every write and the
-- products_approved_matches_status CHECK enforces it. So the public rule is
-- exactly "published": what the storefront already filters to.
--
-- WHO STILL NEEDS UNPUBLISHED ROWS, AND HOW THEY GET THEM
-- -------------------------------------------------------
-- Audited every products read in src/ (task 7e54a10f handoff). The storefront
-- (catalog, home, toys, product page, recommendations, blanks lane, kiosk,
-- design showcase, the Vercel SEO functions) already filters to published
-- rows. The readers that need unpublished rows are all signed in:
--   * admin / manager screens: AdminDashboard, the Step Flow builder's admin
--     lane (PromoPicker), PromoPricingModal, AdminTeamTemplatesIndex,
--     TeamStudio, AdminAIProductBuilder, AdminCreateProductWizard. Their
--     UPDATEs also need the row visible to SELECT (PostgREST filters and
--     returns rows), so without a staff read they would silently match 0 rows.
--   * vendors: VendorDashboard reads its own rows; order_items' vendor policy
--     looks products up by vendor_id.
--   * creators: UserProfile lists the signed-in user's own designs, drafts
--     included; the customer Step Flow itself goes through the service-role
--     API (/api/studio) and is unaffected.
-- So three signed-in read rules replace the open one: staff see every row,
-- vendors and creators see their own. The backend and worker use the service
-- role (rolbypassrls) and never consulted any of this.
--
-- CHAIN CONVERGENCE (products)
-- ----------------------------
-- The chain still created two products policies production does not have
-- ("Vendors can manage their own products" FOR ALL from 002 and "Admins have
-- full access to all products" from 005), and production carries three admin
-- write policies no file creates. Both directions are reconciled here, using
-- production's exact definitions, so a rebuilt environment gets production's
-- products policies and nothing else.
--
-- THE THREE CATALOGUE TABLES
-- --------------------------
-- imagination_products, imagination_product_sizes and shipping_methods are
-- live with a public read and (for the first two) an admin manage rule, but no
-- migration creates the tables or their policies. Their policies are codified
-- here with production's definitions. The tables themselves are still absent
-- from the chain (MIGRATION_LEDGER.md drift section), so each block is behind a
-- to_regclass guard: removing a policy on a missing relation raises 42P01 even
-- with IF EXISTS, and a partially provisioned database must not abort here.
--
-- Table-level grants to anon/authenticated are a separate mechanism (task
-- b6d6720f) and are not touched.
--
-- Prove it: node scripts/verify-rls-policy-reconciliation.mjs --live
-- (strict convergence on these four tables + a read-only probe of what anon,
-- a customer, a draft owner and an admin can each SELECT).

DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    -- the open read, and the chain-only rules production never had
    DROP POLICY IF EXISTS "Anyone can view products" ON public.products;
    DROP POLICY IF EXISTS "Vendors can manage their own products" ON public.products;
    DROP POLICY IF EXISTS "Admins have full access to all products" ON public.products;

    -- everyone, anon included: published rows only
    DROP POLICY IF EXISTS "All users can view approved products" ON public.products;
    CREATE POLICY "All users can view approved products" ON public.products
      FOR SELECT
      USING (approved = true AND status = 'active');

    -- signed-in readers of unpublished rows
    DROP POLICY IF EXISTS "Staff can view all products" ON public.products;
    CREATE POLICY "Staff can view all products" ON public.products
      FOR SELECT TO authenticated
      USING ((SELECT public.get_user_role((SELECT auth.uid()))) = ANY (ARRAY['admin'::text, 'manager'::text]));

    DROP POLICY IF EXISTS "Vendors can view their own products" ON public.products;
    CREATE POLICY "Vendors can view their own products" ON public.products
      FOR SELECT TO authenticated
      USING (vendor_id = (SELECT auth.uid()));

    DROP POLICY IF EXISTS "Creators can view their own products" ON public.products;
    CREATE POLICY "Creators can view their own products" ON public.products
      FOR SELECT TO authenticated
      USING (created_by_user_id = (SELECT auth.uid()));

    -- admin writes, as production already has them
    DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
    CREATE POLICY "Admins can insert products" ON public.products
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'::text));

    DROP POLICY IF EXISTS "Admins can update products" ON public.products;
    CREATE POLICY "Admins can update products" ON public.products
      FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'::text))
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'::text));

    DROP POLICY IF EXISTS "Admins can delete products" ON public.products;
    CREATE POLICY "Admins can delete products" ON public.products
      FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'::text));
  END IF;

  IF to_regclass('public.imagination_products') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can read imagination products" ON public.imagination_products;
    CREATE POLICY "Anyone can read imagination products" ON public.imagination_products
      FOR SELECT
      USING (true);

    DROP POLICY IF EXISTS "Admins can manage imagination products" ON public.imagination_products;
    CREATE POLICY "Admins can manage imagination products" ON public.imagination_products
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
  END IF;

  IF to_regclass('public.imagination_product_sizes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can read imagination product sizes" ON public.imagination_product_sizes;
    CREATE POLICY "Anyone can read imagination product sizes" ON public.imagination_product_sizes
      FOR SELECT
      USING (true);

    DROP POLICY IF EXISTS "Admins can manage imagination product sizes" ON public.imagination_product_sizes;
    CREATE POLICY "Admins can manage imagination product sizes" ON public.imagination_product_sizes
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = ANY (ARRAY['admin'::text, 'manager'::text])));
  END IF;

  IF to_regclass('public.shipping_methods') IS NOT NULL THEN
    DROP POLICY IF EXISTS "shipping_methods_public_read" ON public.shipping_methods;
    CREATE POLICY "shipping_methods_public_read" ON public.shipping_methods
      FOR SELECT
      USING (true);
  END IF;
END $$;
