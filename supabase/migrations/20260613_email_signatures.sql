-- Per-mailbox email signature title (e.g. "CEO & Co-Founder").
-- Rendered into a branded signature block appended to every outgoing message
-- in backend/routes/email.ts (renderSignature). Nullable + additive.
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS signature_title text;

-- Seed the known founders' signatures (idempotent — only when unset).
UPDATE email_mailboxes
   SET signature_title = 'CEO & Co-Founder'
 WHERE lower(address) = 'davidt@imaginethisprinted.com'
   AND (signature_title IS NULL OR signature_title = '');

UPDATE email_mailboxes
   SET signature_title = 'Co-Founder'
 WHERE lower(address) = 'christina@imaginethisprinted.com'
   AND (signature_title IS NULL OR signature_title = '');
