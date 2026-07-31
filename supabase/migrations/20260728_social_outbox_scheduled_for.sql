-- Scheduled release for the social outbox.
--
-- Approving a post used to mean "post it on the next bridge poll". A nullable
-- scheduled_for lets a week of content be approved in one sitting and released
-- on its own timetable: GET /api/social-outbox/bridge/next only returns rows
-- where scheduled_for IS NULL or has already passed.
--
-- NULL keeps the existing behaviour, so every row that exists today is
-- unaffected and nothing needs backfilling.

ALTER TABLE public.social_outbox
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP WITH TIME ZONE;

-- The bridge claim query is (status, scheduled_for) ordered by due time.
-- Partial index: only approved rows are ever claimable.
CREATE INDEX IF NOT EXISTS social_outbox_due_idx
  ON public.social_outbox (scheduled_for NULLS FIRST, created_at)
  WHERE status = 'approved';

COMMENT ON COLUMN public.social_outbox.scheduled_for IS
  'When an approved item becomes claimable by the bridge. NULL = release immediately.';
