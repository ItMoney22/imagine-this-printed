-- ============================================================================
-- crm_notes + crm_tags: admin/manager-only, full CRUD, updated_at
-- Dane Marsh · Watchtower cab1aebf-d956-48a6-bcaf-a03e1c28fb36 · 2026-10-12
-- ============================================================================
--
-- WHY
-- The CRM customer modal (src/pages/CRM.tsx) writes notes to crm_notes and
-- tags to crm_tags. Task 582e38ea (2026-09-22) found neither table in
-- production. By 2026-10-12 both exist live (from
-- 20260728_messaging_crm_tables.sql, 0 rows each), but the shape is not what
-- the CRM needs:
--   * policies admit 'founder', while the /crm and /admin/crm routes admit
--     only admin + manager;
--   * no UPDATE policy on either table, no DELETE policy on crm_notes;
--   * no updated_at column;
--   * anon and authenticated hold every table privilege, TRUNCATE included
--     (TRUNCATE is not subject to RLS).
--
-- WHAT
--   1. CREATE TABLE IF NOT EXISTS with the full shape, so a fresh database
--      gets everything from this file alone.
--   2. Bring the live tables up to that shape: updated_at, NOT NULL
--      timestamps, FKs pointing at user_profiles (the CRM's customer list),
--      text sanity checks.
--   3. Drop every old policy and create SELECT / INSERT / UPDATE / DELETE for
--      admin + manager only, TO authenticated, through
--      public.get_user_role() (SECURITY DEFINER, so it does not depend on
--      user_profiles' own SELECT policies; fixed live by
--      20260728_fix_get_user_role_ambiguity.sql).
--   4. Revoke all privileges from anon and PUBLIC; authenticated keeps only
--      SELECT / INSERT / UPDATE / DELETE (RLS still decides which rows).
--   5. updated_at triggers on public.update_updated_at_column().
--
-- SAFE TO RE-RUN: every step is IF [NOT] EXISTS / DROP ... IF EXISTS.
-- Both live tables held 0 rows on 2026-10-12, so the NOT NULL and CHECK
-- additions cannot fail on existing data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables (fresh databases)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  note_type   VARCHAR(20) NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('general', 'order', 'complaint', 'follow_up')),
  created_by  UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  created_by  UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, tag)
);

-- ---------------------------------------------------------------------------
-- 2. Bring the live (2026-07-28) tables up to the same shape
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.crm_tags  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.crm_notes SET created_at = NOW() WHERE created_at IS NULL;
UPDATE public.crm_tags  SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE public.crm_notes ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.crm_tags  ALTER COLUMN created_at SET NOT NULL;

-- A note or tag outlives the staff account that wrote it.
ALTER TABLE public.crm_notes ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.crm_tags  ALTER COLUMN created_by DROP NOT NULL;

-- Point both FKs at user_profiles: that is the list the CRM shows, and
-- user_profiles.id itself cascades from auth.users(id).
ALTER TABLE public.crm_notes DROP CONSTRAINT IF EXISTS crm_notes_customer_id_fkey;
ALTER TABLE public.crm_notes ADD CONSTRAINT crm_notes_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.crm_notes DROP CONSTRAINT IF EXISTS crm_notes_created_by_fkey;
ALTER TABLE public.crm_notes ADD CONSTRAINT crm_notes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.crm_tags DROP CONSTRAINT IF EXISTS crm_tags_customer_id_fkey;
ALTER TABLE public.crm_tags ADD CONSTRAINT crm_tags_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.crm_tags DROP CONSTRAINT IF EXISTS crm_tags_created_by_fkey;
ALTER TABLE public.crm_tags ADD CONSTRAINT crm_tags_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- No blank notes; tags are short, trimmed labels.
ALTER TABLE public.crm_notes DROP CONSTRAINT IF EXISTS crm_notes_content_not_blank;
ALTER TABLE public.crm_notes ADD CONSTRAINT crm_notes_content_not_blank
  CHECK (char_length(btrim(content)) > 0);
ALTER TABLE public.crm_tags DROP CONSTRAINT IF EXISTS crm_tags_tag_shape;
ALTER TABLE public.crm_tags ADD CONSTRAINT crm_tags_tag_shape
  CHECK (tag = btrim(tag) AND char_length(tag) BETWEEN 1 AND 40);

CREATE INDEX IF NOT EXISTS idx_crm_notes_customer_id ON public.crm_notes (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tags_customer_id  ON public.crm_tags (customer_id);

-- ---------------------------------------------------------------------------
-- 3. RLS: admin + manager only, all four operations
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tags  ENABLE ROW LEVEL SECURITY;

-- The 2026-07-28 policies (admin/manager/founder, no UPDATE, no note DELETE).
DROP POLICY IF EXISTS "Staff can view crm notes"   ON public.crm_notes;
DROP POLICY IF EXISTS "Staff can create crm notes" ON public.crm_notes;
DROP POLICY IF EXISTS "Staff can view crm tags"    ON public.crm_tags;
DROP POLICY IF EXISTS "Staff can create crm tags"  ON public.crm_tags;
DROP POLICY IF EXISTS "Staff can delete crm tags"  ON public.crm_tags;

-- crm_notes
DROP POLICY IF EXISTS "CRM staff can read notes" ON public.crm_notes;
CREATE POLICY "CRM staff can read notes" ON public.crm_notes
  FOR SELECT TO authenticated
  USING (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "CRM staff can add notes" ON public.crm_notes;
CREATE POLICY "CRM staff can add notes" ON public.crm_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS "CRM staff can edit notes" ON public.crm_notes;
CREATE POLICY "CRM staff can edit notes" ON public.crm_notes
  FOR UPDATE TO authenticated
  USING (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'))
  WITH CHECK (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "CRM staff can delete notes" ON public.crm_notes;
CREATE POLICY "CRM staff can delete notes" ON public.crm_notes
  FOR DELETE TO authenticated
  USING (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'));

-- crm_tags
DROP POLICY IF EXISTS "CRM staff can read tags" ON public.crm_tags;
CREATE POLICY "CRM staff can read tags" ON public.crm_tags
  FOR SELECT TO authenticated
  USING (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "CRM staff can add tags" ON public.crm_tags;
CREATE POLICY "CRM staff can add tags" ON public.crm_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS "CRM staff can edit tags" ON public.crm_tags;
CREATE POLICY "CRM staff can edit tags" ON public.crm_tags
  FOR UPDATE TO authenticated
  USING (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'))
  WITH CHECK (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'));

DROP POLICY IF EXISTS "CRM staff can delete tags" ON public.crm_tags;
CREATE POLICY "CRM staff can delete tags" ON public.crm_tags
  FOR DELETE TO authenticated
  USING (public.get_user_role((SELECT auth.uid())) IN ('admin', 'manager'));

-- ---------------------------------------------------------------------------
-- 4. Grants: nothing for anon; authenticated gets row DML only
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.crm_notes, public.crm_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_notes, public.crm_tags TO authenticated;
GRANT ALL ON public.crm_notes, public.crm_tags TO service_role;

-- ---------------------------------------------------------------------------
-- 5. updated_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS crm_notes_set_updated_at ON public.crm_notes;
CREATE TRIGGER crm_notes_set_updated_at
  BEFORE UPDATE ON public.crm_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS crm_tags_set_updated_at ON public.crm_tags;
CREATE TRIGGER crm_tags_set_updated_at
  BEFORE UPDATE ON public.crm_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.crm_notes IS 'Internal staff notes on a customer, shown in the admin CRM customer modal. Admin + manager only (RLS).';
COMMENT ON TABLE public.crm_tags  IS 'Staff-assigned labels on a customer, shown in the admin CRM. Not the customer''s role. Admin + manager only (RLS).';
