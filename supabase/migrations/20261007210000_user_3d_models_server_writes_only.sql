-- user_3d_models: only the API writes it (Daisy Carter, 2026-10-07, Watchtower task 1417e863).
--
-- The paid 3D files (model.stl / model.glb) moved to the private bucket, and the row now stores a
-- gs:// reference that the license route signs. But the 2025-12-24 policies let any signed-in user
-- INSERT, UPDATE and DELETE their own rows straight through PostgREST with the public anon key:
--   - UPDATE purchased_licenses = '{commercial}'  -> the 500 ITC download license for free;
--   - UPDATE print_price_usd = 0.01               -> checkout prices a 3d-print-<id> line from this
--                                                    column (services/order-pricing.ts), a $0.01 toy;
--   - INSERT a row with status 'ready'            -> skips the ITC charge for generation.
-- (anon also held every table grant; RLS was the only thing between it and the table.)
--
-- Nothing in the website writes this table with a user token: every insert/update/delete goes
-- through backend/routes/3d-models.ts or the worker with the service role. So users keep SELECT on
-- their own rows and lose every write.
--
-- Rollback: re-create the three policies from 20251224000000_user_3d_models.sql and
-- GRANT INSERT, UPDATE, DELETE ON public.user_3d_models TO authenticated.

DROP POLICY IF EXISTS "Users can insert own 3d models" ON public.user_3d_models;
DROP POLICY IF EXISTS "Users can update own 3d models" ON public.user_3d_models;
DROP POLICY IF EXISTS "Users can delete own 3d models" ON public.user_3d_models;

REVOKE ALL ON public.user_3d_models FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_3d_models FROM authenticated;
GRANT SELECT ON public.user_3d_models TO authenticated;

COMMENT ON COLUMN public.user_3d_models.glb_url IS
  'gs:// reference to the private mesh (services/model-files.ts). Signed per request; never a public URL.';
COMMENT ON COLUMN public.user_3d_models.stl_url IS
  'gs:// reference to the private print mesh (services/model-files.ts). Signed per request; never a public URL.';

NOTIFY pgrst, 'reload schema';
