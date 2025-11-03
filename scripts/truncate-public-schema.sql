-- ============================================================================
-- TRUNCATE ALL PUBLIC SCHEMA TABLES (NO BACKUP - DESTRUCTIVE)
-- ============================================================================
-- Purpose: Wipe all data in public schema while preserving table structure
-- WARNING: This is IRREVERSIBLE. Proceed without backups by explicit request.
--
-- Usage:
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire script
--   3. Click "Run"
--
-- What it does:
--   - Truncates all tables in public schema
--   - Resets identity sequences (auto-increment back to 1)
--   - Cascades to dependent tables
--   - Preserves table structure (DDL unchanged)
--   - Skips special/system tables
-- ============================================================================

DO $$
DECLARE
  r record;
  table_count integer := 0;
BEGIN
  RAISE NOTICE '⚠️  WARNING: Starting DESTRUCTIVE truncate of all public schema tables';
  RAISE NOTICE '';

  -- Loop through all tables in public schema
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('spatial_ref_sys')  -- Skip PostGIS system tables if present
  LOOP
    BEGIN
      RAISE NOTICE '🗑️  Truncating: public.%', r.tablename;

      -- TRUNCATE with RESTART IDENTITY (resets sequences) and CASCADE (handles dependencies)
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', r.tablename);

      table_count := table_count + 1;
      RAISE NOTICE '   ✅ Truncated';
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING '   ❌ Failed to truncate public.%: %', r.tablename, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '📊 Summary: Truncated % tables', table_count;
  RAISE NOTICE '✅ Public schema data wiped (structure preserved)';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- Optional: Recreate admin profile row (if your app uses profiles table)
-- ============================================================================
-- Uncomment and run this if you have a profiles table that needs seeding
-- Replace with actual admin user ID from auth.users

/*
INSERT INTO public.profiles (id, email, role, full_name, username, created_at, updated_at)
SELECT
  id,
  'davidltrinidad@gmail.com' as email,
  'admin' as role,
  'David Trinidad' as full_name,
  'admin' as username,
  NOW() as created_at,
  NOW() as updated_at
FROM auth.users
WHERE email = 'davidltrinidad@gmail.com'
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  role = 'admin',
  full_name = EXCLUDED.full_name,
  username = EXCLUDED.username,
  updated_at = NOW();

-- Verify profile was created
SELECT id, email, role, full_name, username FROM public.profiles WHERE role = 'admin';
*/

-- ============================================================================
-- Notes:
--   - Run this AFTER hard-reset-auth.ts
--   - Run seed-admin-profile.ts if using TypeScript instead of SQL insert
--   - Verify results with: SELECT count(*) FROM <your_table>;
-- ============================================================================
