-- Migration: 20260612_email_system.sql
-- Full in-app email system backed by Resend (send + receive).
-- Mailboxes are company addresses (@imaginethisprinted.com) assignable to
-- employees (user_profiles). Messages store both directions; inbound arrives
-- via the Resend email.received webhook, outbound goes out via the Resend API.
-- RLS is enabled with NO policies: only the backend (service role) touches
-- these tables; role checks happen in backend/routes/email.ts.

CREATE TABLE IF NOT EXISTS email_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES email_mailboxes(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  resend_id TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  from_address TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'sent', 'failed')),
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_mailbox
  ON email_messages (mailbox_id, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_unread
  ON email_messages (mailbox_id) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_email_mailboxes_user
  ON email_mailboxes (user_id);

-- Dedupe guard for webhook retries (svix redelivers on non-2xx / timeouts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_dedupe
  ON email_messages (mailbox_id, resend_id) WHERE resend_id IS NOT NULL;

ALTER TABLE email_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;

-- Seed the address the platform already uses as its public sender
INSERT INTO email_mailboxes (address, display_name)
VALUES ('wecare@imaginethisprinted.com', 'Customer Care')
ON CONFLICT (address) DO NOTHING;
