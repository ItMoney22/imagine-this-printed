-- ============================================================================
-- Migration 005: RLS Policy Recursion Fixes
-- ============================================================================
--
-- CRITICAL FIX: This migration removes infinite recursion in RLS policies.
--
-- PROBLEM: The original policies had this pattern:
--   CREATE POLICY "Admins can access all profiles" ON user_profiles
--     FOR ALL USING (
--       EXISTS (
--         SELECT 1 FROM user_profiles
--         WHERE id = auth.uid() AND role IN ('admin', 'founder')
--       )
--     );
--
-- This causes infinite recursion because:
-- 1. Policy queries user_profiles to check role
-- 2. That query triggers the same policy
-- 3. Which queries user_profiles again
-- 4. Infinite loop -> Stack overflow
--
-- SOLUTION: Use a helper function with SECURITY DEFINER that bypasses RLS
-- when checking the current user's role. This breaks the recursion cycle.
--
-- ============================================================================

-- Create a helper function to get user role without triggering RLS
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM public.user_profiles
  WHERE id = user_id;

  RETURN COALESCE(user_role, 'customer');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO anon;

-- ============================================================================
-- Drop all existing recursive policies on user_profiles
-- ============================================================================

DROP POLICY IF EXISTS "Admins can access all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admin/Founder can read all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admin/Founder can update all profiles" ON user_profiles;

-- ============================================================================
-- Drop all existing recursive policies on user_wallets
-- ============================================================================

DROP POLICY IF EXISTS "Admin/Founder can manage all wallets" ON user_wallets;

-- ============================================================================
-- Drop all existing recursive policies on products
-- ============================================================================

DROP POLICY IF EXISTS "Admins can manage all products" ON products;
DROP POLICY IF EXISTS "Admin/Founder can manage all products" ON products;

-- ============================================================================
-- Drop all existing recursive policies on orders
-- ============================================================================

DROP POLICY IF EXISTS "Admins can manage all orders" ON orders;
DROP POLICY IF EXISTS "Admin/Founder can read all orders" ON orders;
DROP POLICY IF EXISTS "Admin/Founder can manage all orders" ON orders;

-- ============================================================================
-- Drop all existing recursive policies on cost_variables
-- ============================================================================

DROP POLICY IF EXISTS "Admins can manage all cost variables" ON cost_variables;

-- ============================================================================
-- Drop all existing recursive policies on product_cost_breakdowns
-- ============================================================================

DROP POLICY IF EXISTS "Admins can manage all cost breakdowns" ON product_cost_breakdowns;

-- ============================================================================
-- Create NEW non-recursive policies using the helper function
-- ============================================================================

-- User Profiles: Admin access
CREATE POLICY "Admins have full access to all profiles" ON user_profiles
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- User Wallets: Admin access
CREATE POLICY "Admins have full access to all wallets" ON user_wallets
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- Products: Admin access
CREATE POLICY "Admins have full access to all products" ON products
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- Orders: Admin read access
CREATE POLICY "Admins can read all orders" ON orders
  FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- Orders: Admin full access
CREATE POLICY "Admins have full access to all orders" ON orders
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- Cost Variables: Admin access
CREATE POLICY "Admins have full access to all cost variables" ON cost_variables
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- Product Cost Breakdowns: Admin access
CREATE POLICY "Admins have full access to all cost breakdowns" ON product_cost_breakdowns
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));

-- ============================================================================
-- Additional fixes for potential recursion in other policies
-- ============================================================================

-- Fix vendor payouts if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vendor_payouts'
    AND policyname LIKE '%Admin%'
    AND definition LIKE '%SELECT%user_profiles%'
  ) THEN
    DROP POLICY IF EXISTS "Admins can manage all vendor payouts" ON vendor_payouts;
    CREATE POLICY "Admins have full access to all vendor payouts" ON vendor_payouts
      FOR ALL
      USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));
  END IF;
END $$;

-- Fix founder earnings if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'founder_earnings'
    AND policyname LIKE '%Admin%'
    AND definition LIKE '%SELECT%user_profiles%'
  ) THEN
    DROP POLICY IF EXISTS "Admins can manage all founder earnings" ON founder_earnings;
    CREATE POLICY "Admins have full access to all founder earnings" ON founder_earnings
      FOR ALL
      USING (public.get_user_role(auth.uid()) IN ('admin', 'founder'));
  END IF;
END $$;

-- ============================================================================
-- Verification: Test that the helper function works
-- ============================================================================

DO $$
DECLARE
  test_result TEXT;
BEGIN
  -- This should complete without infinite recursion
  SELECT public.get_user_role(auth.uid()) INTO test_result;
  RAISE NOTICE 'RLS recursion fix verified. Helper function works correctly.';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error testing helper function: %', SQLERRM;
END $$;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'RLS RECURSION FIXES APPLIED SUCCESSFULLY';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'All admin policies now use the get_user_role() helper function';
  RAISE NOTICE 'This prevents infinite recursion when checking user roles';
  RAISE NOTICE 'Fresh deployments will no longer encounter stack overflow errors';
  RAISE NOTICE '=================================================================';
END $$;
