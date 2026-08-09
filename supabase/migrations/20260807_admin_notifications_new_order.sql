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

ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert',
    'wholesale_application',
    'new_order'
  ));
