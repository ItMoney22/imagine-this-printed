-- Migration: 20260728_email_unmatched_inbound.sql
-- Catch-all for inbound Resend mail addressed to a recipient that doesn't
-- match any row in email_mailboxes (typo'd alias, deprovisioned mailbox,
-- stale forwarding address a customer replied to).
--
-- Previously this branch of POST /api/email/webhooks/resend only did
-- console.warn('[email-webhook] mail for unknown mailbox(es): ...') — the
-- message itself was discarded with no persistent record, so a legitimate
-- customer reply to a mistyped/retired address silently vanished. This table
-- gives it a durable landing spot so it can be triaged instead of lost.
--
-- RLS is enabled with NO policies: only the service-role backend writes this
-- table (same pattern as email_mailboxes / email_messages / email_suppressions).

CREATE TABLE IF NOT EXISTS email_unmatched_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Our-domain recipients on the message that matched no active mailbox.
  recipients TEXT[] NOT NULL,

  from_address TEXT,
  from_name TEXT,
  subject TEXT,

  -- Resend's email_id / RFC message-id, for correlation and dedupe.
  resend_id TEXT,
  message_id TEXT,

  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_unmatched_inbound_received_at
  ON email_unmatched_inbound (received_at DESC);

ALTER TABLE email_unmatched_inbound ENABLE ROW LEVEL SECURITY;
