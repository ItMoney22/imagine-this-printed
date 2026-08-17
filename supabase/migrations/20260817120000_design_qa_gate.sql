-- Migration: 20260817120000_design_qa_gate.sql
-- Watchtower task 9ec9444a-c7a0-47aa-bec5-e28923cc450e — the presentation QA
-- gate every design must clear before it can go live on the storefront or Etsy.
--
-- WHY THIS SHAPE
-- Two QA checks already existed and both are single-purpose:
--   services/design-library-quality.ts  → can the ARTWORK print? (pixels vs DPI)
--   services/mockup-qa.ts               → is this ONE render the right art at
--                                          the right size? (vision, per shot)
-- Neither of them looks at the thing a shopper actually judges: the whole
-- PRESENTATION — the photo set, the copy, the tags, the price, all at once.
-- David's read on why the store underperforms is presentation quality, so the
-- gate has to grade the package, not the parts.
--
-- One table, not a boolean column, because the requirement is an AUDIT TRAIL:
-- "show the history of a design's submissions and outcomes". A column would
-- keep only the current answer and lose every rework round, which is exactly
-- the data that tells us whether the designer agent is getting better.
--
-- submission_no is per (product_id, channel) and starts at 1. It is assigned in
-- the INSERT by next_design_qa_submission_no() rather than by the caller, so two
-- concurrent submissions (admin panel + designer agent) cannot both claim #3.
--
-- The verdict is ALSO mirrored onto products.metadata.qa_gate by the service
-- layer. That mirror is a convenience for the product grids (one read, no join)
-- and is deliberately NOT the source of truth — this table is.

BEGIN;

-- ---------------------------------------------------------------------------
-- One row per QA submission. Never updated after insert except by the override
-- path, which writes a NEW row rather than editing the failure it overrides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS design_qa_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Where this presentation is headed. The same design is graded separately for
  -- the storefront and for Etsy because the copy rules genuinely differ (Etsy
  -- wants exactly 13 tags; the storefront does not).
  channel        text NOT NULL DEFAULT 'storefront'
                 CHECK (channel IN ('storefront', 'etsy')),
  submission_no  integer NOT NULL CHECK (submission_no > 0),
  status         text NOT NULL CHECK (status IN ('passed', 'failed', 'overridden', 'error')),
  -- 0-100. Not a pass/fail input — the gate fails on any blocking criterion
  -- regardless of score. It exists so "getting better" is measurable across
  -- rework rounds even when a design keeps failing.
  score          integer CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  -- Per-criterion verdicts, keyed by criterion id (mockup_quality,
  -- design_placement, typography, seo, pricing, image_sharpness). Each value:
  -- { ok, severity, summary, detail, measured }.
  criteria       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Actionable rework instructions for the responsible agent — the feedback
  -- loop payload. Array of { criterion, severity, issue, fix, evidence }.
  rework         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Who asked for the review: an agent id ('daily-designer', 'etsy-scout'),
  -- an admin email, or 'etsy-worker'.
  submitted_by   text NOT NULL DEFAULT 'unknown',
  -- Vision model used for the judged criteria, or 'deterministic-only' when no
  -- key was configured and only the measured checks ran.
  model          text,
  duration_ms    integer,
  -- Set only on status='overridden': an admin knowingly shipped a failure.
  override_reason text,
  override_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The rework queue reads "latest review per product, failed" constantly.
CREATE INDEX IF NOT EXISTS idx_design_qa_reviews_product
  ON design_qa_reviews (product_id, channel, submission_no DESC);
CREATE INDEX IF NOT EXISTS idx_design_qa_reviews_status
  ON design_qa_reviews (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Submission numbering. SECURITY DEFINER so the service role and an admin JWT
-- both get the same answer, and so the read of MAX() happens under the same
-- privileges that do the INSERT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_design_qa_submission_no(p_product_id uuid, p_channel text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(submission_no), 0) + 1
  FROM design_qa_reviews
  WHERE product_id = p_product_id AND channel = p_channel;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Reviews are internal QA data: staff read, service role writes.
-- No customer-facing path reads this table.
-- ---------------------------------------------------------------------------
ALTER TABLE design_qa_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design_qa_reviews staff read" ON design_qa_reviews;
CREATE POLICY "design_qa_reviews staff read" ON design_qa_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = auth.uid() AND up.role IN ('admin', 'manager')
    )
  );

-- Writes go through the backend service role only. No INSERT/UPDATE/DELETE
-- policy for `authenticated` is intentional: an admin submits a review by
-- calling the API, which runs the actual checks. Letting a browser INSERT a
-- row directly would let anyone with an admin token forge a pass.
REVOKE INSERT, UPDATE, DELETE ON design_qa_reviews FROM authenticated, anon;
GRANT SELECT ON design_qa_reviews TO authenticated;

COMMIT;
