-- Guests can be handed to a person in the site chat (Zero Nine, 2026-10-07).
--
-- The migration that made chat_sessions (20251219_coupons_giftcards_support.sql) left user_id nullable, but the
-- live table has it NOT NULL. Every handoff for a shopper without an account (most of them) failed on this
-- constraint inside an upsert nobody checked, so the chat window never had a live session to show
-- Christina's reply in. Guests are identified by the ticket, not by a user row.
ALTER TABLE public.chat_sessions ALTER COLUMN user_id DROP NOT NULL;
