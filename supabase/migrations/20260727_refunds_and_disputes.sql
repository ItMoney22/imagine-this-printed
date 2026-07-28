-- Refund + dispute support (Watchtower task c1b0182f-453b-448f-ac1b-49f0a176900a).
--
-- Backs the admin refund endpoint (POST /api/stripe/orders/:orderId/refund),
-- the charge.refunded webhook, and the charge.dispute.* webhooks in
-- backend/routes/stripe.ts, plus the reversal service
-- backend/services/order-refunds.ts.
--
-- EVERY object here is optional-but-preferred: backend/services/order-refunds.ts
-- detects each one at runtime and falls back to a non-atomic (but still
-- idempotent and correct) path when it is missing, so a database that has not
-- applied this file still refunds correctly. Applying it upgrades the inventory
-- restock to an atomic RPC and lets reversed royalty rows say so honestly.
--
-- Idempotent / re-runnable: every statement is IF EXISTS / IF NOT EXISTS or
-- CREATE OR REPLACE.

BEGIN;

-- 1) blank_inventory_movements: allow a 'refund' movement reason and make one
--    refund movement per (blank, order) — the mirror image of the
--    blank_movements_sale_once index from 20260706_blank_inventory.sql, which
--    is what makes the sale decrement idempotent.
ALTER TABLE public.blank_inventory_movements
  DROP CONSTRAINT IF EXISTS blank_inventory_movements_reason_check;
ALTER TABLE public.blank_inventory_movements
  ADD CONSTRAINT blank_inventory_movements_reason_check
  CHECK (reason IN ('sale', 'received', 'adjustment', 'shrinkage', 'refund'));

CREATE UNIQUE INDEX IF NOT EXISTS blank_movements_refund_once
  ON public.blank_inventory_movements (blank_id, order_id)
  WHERE reason = 'refund';

-- 2) Atomic, idempotent restock — the exact inverse of record_blank_sale().
--    Returns TRUE when the movement was newly recorded (and qty restocked),
--    FALSE when this (blank, order) refund already existed.
CREATE OR REPLACE FUNCTION public.reverse_blank_sale(
  p_blank_id UUID,
  p_order_id UUID,
  p_qty INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.blank_inventory_movements (blank_id, delta, reason, order_id, unit_cost, note)
  SELECT bi.id, p_qty, 'refund', p_order_id, bi.cost_per_unit,
         'Refund reversal for order ' || p_order_id::text
  FROM public.blank_inventory bi
  WHERE bi.id = p_blank_id
  ON CONFLICT (blank_id, order_id) WHERE reason = 'refund' DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    UPDATE public.blank_inventory
    SET qty_on_hand = qty_on_hand + p_qty,
        updated_at = NOW()
    WHERE id = p_blank_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- 3) user_product_royalties: a clawed-back creator accrual is neither 'failed'
--    (it succeeded, then the order was refunded) nor still 'credited'.
ALTER TABLE public.user_product_royalties
  DROP CONSTRAINT IF EXISTS user_product_royalties_status_check;
ALTER TABLE public.user_product_royalties
  ADD CONSTRAINT user_product_royalties_status_check
  CHECK (status IN ('pending', 'credited', 'failed', 'reversed'));

-- 4) admin_notifications: chargebacks need to reach the admin bell. Extends the
--    type list last set by 20260706_blank_inventory.sql.
ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert', 'payment_dispute'
  ));

-- 5) charge.refunded / charge.dispute.* resolve a Stripe object back to an ITP
--    order through orders.payment_intent_id (and charge_id as a fallback).
--    Both were unindexed.
CREATE INDEX IF NOT EXISTS idx_orders_payment_intent_id
  ON public.orders (payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_charge_id
  ON public.orders (charge_id) WHERE charge_id IS NOT NULL;

COMMIT;
