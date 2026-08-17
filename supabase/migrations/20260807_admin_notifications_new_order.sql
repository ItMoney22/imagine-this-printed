-- ---------------------------------------------------------------------------
-- Allow a 'new_order' admin notification.
--
-- Why: until 2026-08-07 nothing in ITP told the team an order had been paid.
-- The only team-facing order signals were the stalled-order alert (which waits
-- ORDER_STALL_DAYS = 3 days) and the 8am daily digest, so ITP's first real
-- customer order (ITP-MSJK1K3I-8GDG, $26) landed and no one on staff was
-- notified. services/order-payment.ts now inserts a 'new_order' row the moment
-- an order is marked paid, alongside the immediate crew email.
--
-- This was caught by actually firing the new alert against the live order:
-- the email sent, and the bell insert came back
--   new row for relation "admin_notifications" violates check constraint
--   "admin_notifications_type_check"
-- because the type whitelist had never heard of 'new_order'.
--
-- Same DROP/ADD extension pattern this constraint has already been widened with
-- three times (20260706 blank_inventory -> low_stock/order_stalled/health_alert,
-- 20260727 refunds_and_disputes, 20260728 wholesale_applications). The full list
-- is restated here because CHECK constraints cannot be extended in place.
--
-- Idempotent and additive: DROP IF EXISTS then ADD, no data is touched, and no
-- previously-legal value is removed. Until this is applied the insert simply
-- fails and is logged — notifyTeamOfPaidOrder wraps it in its own try/catch, so
-- an unapplied migration costs the bell row but never the crew email and never
-- the paid order itself.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- SUPERSEDED 2026-08-16 — DO NOT APPLY THIS FILE (Watchtower task ae9c62ac).
--
-- The list below was NOT additive after all. It was written against the
-- wholesale branch's view of the world and never had 'payment_dispute', which
-- 20260727_refunds_and_disputes.sql had meanwhile put live for chargeback
-- alerts. Applying this file as originally written would have DROPPED
-- 'payment_dispute' and silently killed every chargeback alert — a missed
-- chargeback deadline is an automatic loss.
--
-- 'new_order' now reaches production through
-- `20260816_admin_notifications_type_union.sql`, which computes the union of
-- the required list, the live constraint, and the values already in the table,
-- so it cannot drop anything.
--
-- The list here has been widened to that same union so that a cold re-run of
-- this file is no longer destructive. It is still redundant — apply the
-- 20260816 union migration instead.
-- ===========================================================================
ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert',
    'payment_dispute',
    'wholesale_application',
    'new_order'
  ));
