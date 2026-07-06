-- Blank-shirt inventory (raw-material blanks, tracked separately from sellable
-- products) + movement ledger + low-stock alert support.
-- Granularity locked by David 2026-07-06: brand + style + color + size.
-- Also extends admin_notifications.type so inventory/monitoring alerts can use
-- the existing admin notification bell.

CREATE TABLE IF NOT EXISTS public.blank_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand TEXT NOT NULL,
  style_code TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_threshold INTEGER NOT NULL DEFAULT 12,
  reorder_qty INTEGER,
  cost_per_unit NUMERIC(10,2),
  supplier TEXT,
  notes TEXT,
  last_alerted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (brand, style_code, color, size)
);

CREATE TABLE IF NOT EXISTS public.blank_inventory_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  blank_id UUID NOT NULL REFERENCES public.blank_inventory(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale', 'received', 'adjustment', 'shrinkage')),
  order_id UUID,
  unit_cost NUMERIC(10,2),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One sale movement per (blank, order): makes the checkout decrement idempotent
-- across the two Stripe paid paths (routes/stripe.ts handleCheckoutOrderPayment
-- and routes/webhooks.ts payment_intent.succeeded fallback).
CREATE UNIQUE INDEX IF NOT EXISTS blank_movements_sale_once
  ON public.blank_inventory_movements (blank_id, order_id)
  WHERE reason = 'sale';

CREATE INDEX IF NOT EXISTS blank_movements_blank_idx
  ON public.blank_inventory_movements (blank_id, created_at DESC);

-- Atomic, idempotent sale decrement. Returns TRUE when the movement was newly
-- recorded (and qty decremented), FALSE when this (blank, order) sale already
-- existed. qty_on_hand may go negative — that surfaces overselling instead of
-- hiding it.
CREATE OR REPLACE FUNCTION public.record_blank_sale(
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
  INSERT INTO public.blank_inventory_movements (blank_id, delta, reason, order_id, unit_cost)
  SELECT bi.id, -p_qty, 'sale', p_order_id, bi.cost_per_unit
  FROM public.blank_inventory bi
  WHERE bi.id = p_blank_id
  ON CONFLICT (blank_id, order_id) WHERE reason = 'sale' DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    UPDATE public.blank_inventory
    SET qty_on_hand = qty_on_hand - p_qty,
        updated_at = NOW()
    WHERE id = p_blank_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Service-role only (backend + worker); no client-side policies.
ALTER TABLE public.blank_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blank_inventory_movements ENABLE ROW LEVEL SECURITY;

-- Extend the notification-type CHECK for inventory + monitoring alerts
-- ('order_stalled' / 'health_alert' land with the W5 monitor).
ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert'
  ));
