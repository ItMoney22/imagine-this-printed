-- Align the LIVE support schema with the code that writes it.
--
-- Prod was built from the older backend/db/migrations/01_support_system.sql
-- shape (ticket_messages.content, no sender_type, no support_tickets.email).
-- Every writer in backend/routes/support.ts, routes/admin/support.ts and
-- routes/ai/chat.ts uses the 20251219_coupons_giftcards_support.sql shape
-- (email / message / sender_type). Since 1676724 (2026-08-15) started writing
-- support_tickets.email, the public contact form has returned
-- "Could not find the 'email' column" for every submission — the last ticket
-- on prod is from 2026-08-17.
--
-- Additive only: nothing is dropped or renamed; `content` stays for anything
-- still reading it. Rollback = drop the three added columns.
-- Watchtower 6ff6495c-3b23-4aac-a16d-ebe561d80440 (dr-dill, 2026-09-23).

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS sender_type TEXT DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ticket_messages'::regclass
      AND conname = 'ticket_messages_sender_type_check'
  ) THEN
    ALTER TABLE public.ticket_messages
      ADD CONSTRAINT ticket_messages_sender_type_check
      CHECK (sender_type IN ('user', 'agent', 'system', 'ai'));
  END IF;
END $$;

-- Carry any legacy rows across so readers of `message` see them.
UPDATE public.ticket_messages SET message = content
WHERE message IS NULL AND content IS NOT NULL;

NOTIFY pgrst, 'reload schema';
