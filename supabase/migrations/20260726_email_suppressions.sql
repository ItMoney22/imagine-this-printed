-- Migration: 20260726_email_suppressions.sql
-- Email suppression list — addresses we must STOP sending to.
--
-- Fed by the Resend delivery webhook (/api/email/webhooks/resend):
--   * email.complained            -> reason 'complaint'
--   * email.bounced (Permanent)   -> reason 'hard_bounce'
-- Transient/soft bounces are logged on email_logs but never suppressed: a full
-- mailbox or a temporary greylist is not a dead address.
--
-- RETENTION: hard bounces and complaints are PERMANENT (expires_at NULL).
-- Re-mailing a hard bounce or a complainer is exactly what burns a sending
-- domain, and the table is tiny, so nothing is purged on a timer. `expires_at`
-- exists so a future temporary/manual suppression can be time-boxed; the
-- lookup ignores rows whose expires_at is in the past.
--
-- RLS is enabled with NO policies: only the service-role backend reads/writes
-- this table (same pattern as email_mailboxes / email_messages). The admin UI
-- reads it through GET /api/email/suppressions, which does its own role check.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Normalized (trimmed + lowercased) recipient address.
  email TEXT NOT NULL,

  -- Why this address is suppressed.
  reason TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'manual')),

  -- Human-readable diagnostic (Resend bounce subType/message, complaint type).
  detail TEXT,

  -- Which system produced the suppressing event.
  source TEXT NOT NULL DEFAULT 'resend' CHECK (source IN ('resend', 'brevo', 'manual')),

  -- Provider ids for traceability back to the exact send / webhook event.
  provider_email_id TEXT,   -- Resend email id (matches email_logs.message_id)
  provider_event_id TEXT,   -- svix message id of the webhook delivery

  -- How many suppressing events this address has produced.
  event_count INTEGER NOT NULL DEFAULT 1,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NULL = permanent. A future dated value time-boxes the suppression.
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON email_suppressions (email);
CREATE INDEX IF NOT EXISTS idx_email_suppressions_last_seen
  ON email_suppressions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_suppressions_reason
  ON email_suppressions (reason);

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;

-- Atomic upsert used by the webhook. Doing this in one statement (instead of
-- read-then-write in Node) means two webhook deliveries for the same address
-- can't race into a unique-violation or lose an event_count increment.
--
-- Reason precedence: complaint > hard_bounce > manual. A complaint after a
-- bounce upgrades the row; a bounce after a complaint leaves it alone.
CREATE OR REPLACE FUNCTION record_email_suppression(
  p_email TEXT,
  p_reason TEXT,
  p_detail TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'resend',
  p_provider_email_id TEXT DEFAULT NULL,
  p_provider_event_id TEXT DEFAULT NULL
) RETURNS email_suppressions AS $$
DECLARE
  v_email TEXT := lower(btrim(p_email));
  v_row email_suppressions;
BEGIN
  IF v_email IS NULL OR v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'record_email_suppression: invalid email %', p_email;
  END IF;

  INSERT INTO email_suppressions (
    email, reason, detail, source, provider_email_id, provider_event_id
  )
  VALUES (
    v_email, p_reason, p_detail, COALESCE(p_source, 'resend'),
    p_provider_email_id, p_provider_event_id
  )
  ON CONFLICT (email) DO UPDATE SET
    reason = CASE
      WHEN EXCLUDED.reason = 'complaint' THEN 'complaint'
      WHEN email_suppressions.reason = 'complaint' THEN 'complaint'
      ELSE EXCLUDED.reason
    END,
    detail            = COALESCE(EXCLUDED.detail, email_suppressions.detail),
    source            = EXCLUDED.source,
    provider_email_id = COALESCE(EXCLUDED.provider_email_id, email_suppressions.provider_email_id),
    provider_event_id = COALESCE(EXCLUDED.provider_event_id, email_suppressions.provider_event_id),
    event_count       = email_suppressions.event_count + 1,
    last_seen_at      = now(),
    -- A fresh suppressing event re-arms a previously time-boxed row.
    expires_at        = NULL,
    updated_at        = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;
