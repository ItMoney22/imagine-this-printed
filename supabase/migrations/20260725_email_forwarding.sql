-- Per-mailbox auto-forwarding.
-- imaginethisprinted.com has no IMAP/POP server — inbound mail lands via the
-- Resend email.received webhook and lives only in the in-app inbox, so a phone
-- mail app has nothing to connect to. When forward_to is set, the inbound
-- webhook in backend/routes/email.ts also re-sends a copy of every received
-- message to that address (Reply-To = the original sender), which is what makes
-- a mailbox readable from Gmail/Outlook on a phone. Nullable + additive; the
-- in-app inbox keeps the authoritative copy either way.
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS forward_to text;

-- Christina reads her ITP mail on her phone via Gmail (idempotent — only when unset).
UPDATE email_mailboxes
   SET forward_to = 'christina.trinidad22@gmail.com'
 WHERE lower(address) = 'christina@imaginethisprinted.com'
   AND (forward_to IS NULL OR forward_to = '');
