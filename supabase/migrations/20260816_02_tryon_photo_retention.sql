-- Migration: 20260816_02_tryon_photo_retention.sql
-- Watchtower task f3bf450c — automatic photo retention sweep for buyer-side
-- virtual try-on (follow-up to 3b362203 / 20260816_virtual_tryon.sql).
--
-- WHY
-- A try-on upload is a photograph of a customer's face and body. Until now it
-- lived in `tryon/<userId>/…` forever unless the shopper pressed Delete. The
-- worker sweep in backend/worker/tryon-retention-sweep.ts now deletes those
-- objects after TRYON_PHOTO_RETENTION_DAYS (default 30) and nulls the columns
-- that point at them.
--
-- WHAT THIS ADDS
--   photos_purged_at — the audit stamp. Being able to say WHEN a photo was
--   destroyed is most of the value of a retention policy; without it, a nulled
--   path is indistinguishable from a run that never had a photo.
--
-- The run ROW is deliberately never deleted by the sweep — cost_usd,
-- itc_charged, status and used_free_daily are the keep-or-kill conversion
-- report (GET /api/tryon/analytics). Only the image pointers are cleared.
--
-- Additive and idempotent: safe to apply before or after the base try-on
-- migration, and safe to re-run. The sweep also tolerates this migration being
-- absent (it retries the write without the stamp) — see isMissingColumnError()
-- in the worker, and the social_outbox.scheduled_for outage that taught us to
-- do that.

BEGIN;

ALTER TABLE virtual_tryon_runs
  ADD COLUMN IF NOT EXISTS photos_purged_at timestamptz;

COMMENT ON COLUMN virtual_tryon_runs.photos_purged_at IS
  'When the retention sweep deleted this run''s photo/result objects from GCS and nulled their paths. NULL = nothing has been purged yet. The row itself is retained for conversion analytics.';

-- The sweep's hot query is
--   WHERE created_at < cutoff
--     AND (model_photo_path IS NOT NULL OR result_url IS NOT NULL)
--   ORDER BY created_at
-- A partial index keeps that cheap forever: rows drop OUT of the index as they
-- are purged, so the index stays roughly the size of the retention window
-- rather than growing with all history.
CREATE INDEX IF NOT EXISTS idx_tryon_runs_retention
  ON virtual_tryon_runs (created_at)
  WHERE model_photo_path IS NOT NULL OR result_url IS NOT NULL;

COMMIT;
