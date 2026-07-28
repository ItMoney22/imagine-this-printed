-- Migration: 20260728140100_abandoned_cart_reminders.sql
-- Watchtower task cd19d3fb-cce5-437e-946c-8e271167d9b7 (abandoned-cart half).
--
-- WHY THERE IS NO cart_snapshots TABLE HERE
--
-- The task asked for "a backend service to capture and persist abandoned cart
-- snapshots". That work is already done and has been for a long time — it just
-- isn't called that. backend/routes/stripe.ts:399-434 inserts an `orders` row
-- at PAYMENT-INTENT creation time, before any money moves:
--
--     status: 'pending', payment_status: 'pending',
--     customer_email, shipping_address, metadata.items  <-- the cart snapshot
--
-- A row that stays pending is, by definition, a customer who reached checkout
-- and did not pay. Adding a parallel snapshot table would mean writing to the
-- cart/checkout path (owned by other agents, and CartContext.tsx is settled)
-- to capture data the database already has.
--
-- Caveat this buys us: detection starts at CHECKOUT abandonment, not at
-- add-to-cart abandonment. Someone who fills a cart and never opens checkout is
-- invisible. That is the honest trade — it covers the highest-intent, highest-
-- value segment with zero new write paths.
--
-- This migration therefore adds only the one thing the orders table cannot
-- provide: a record of which reminder has already been sent, so the job is
-- idempotent and a customer is never mailed the same nudge twice.

CREATE TABLE IF NOT EXISTS public.abandoned_cart_reminders (
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- Which nudge in the sequence. Two stages only; see backend/lib/abandoned-cart.ts
  -- for why the schedule stops there.
  stage TEXT NOT NULL CHECK (stage IN ('first', 'second')),

  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Resend message id, for tracing a complaint back to the exact send.
  provider_email_id TEXT,

  -- The dedupe key IS the primary key. An idempotency guarantee that lives in
  -- application code is not a guarantee: two overlapping cron ticks would both
  -- pass a check-then-send and the customer gets mailed twice. The sender must
  -- INSERT this row and treat a unique violation as "someone else already sent
  -- it", not query first.
  PRIMARY KEY (order_id, stage)
);

-- The detection query's anti-join ("orders with no reminder row for this
-- stage") walks this index.
CREATE INDEX IF NOT EXISTS idx_abandoned_cart_reminders_sent_at
  ON public.abandoned_cart_reminders (sent_at DESC);

ALTER TABLE public.abandoned_cart_reminders ENABLE ROW LEVEL SECURITY;

-- Internal bookkeeping — no customer or storefront read path. Service role only.
DROP POLICY IF EXISTS "Service role full access to abandoned cart reminders"
  ON public.abandoned_cart_reminders;
CREATE POLICY "Service role full access to abandoned cart reminders"
  ON public.abandoned_cart_reminders
  FOR ALL USING (auth.role() = 'service_role');
