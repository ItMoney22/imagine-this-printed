-- ---------------------------------------------------------------------------
-- Allow an 'order_completed' admin notification.
--
-- Why: the team was told when an order was PAID (20260807, type 'new_order')
-- but never when one was finished. David, 2026-09-07: "we need to be alerted
-- when an order is coming in and when they're completed so we can ship".
-- services/order-alerts.ts now rings the bell on shipped/delivered/completed.
--
-- Same DROP/ADD extension pattern this constraint has already been widened with
-- four times (20260706 low_stock/order_stalled/health_alert, 20260727
-- refunds_and_disputes, 20260728 wholesale_applications, 20260807 new_order).
-- The full list is restated because CHECK constraints cannot be extended in
-- place.
--
-- Idempotent and additive: DROP IF EXISTS then ADD, no data is touched, and no
-- previously-legal value is removed. Until this is applied the insert simply
-- fails and is logged — notifyTeamOfOrderClosed wraps it in its own try/catch,
-- so an unapplied migration costs the bell row but never the crew email and
-- never the status change itself.
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert',
    'wholesale_application',
    'new_order',
    'order_completed'
  ));
