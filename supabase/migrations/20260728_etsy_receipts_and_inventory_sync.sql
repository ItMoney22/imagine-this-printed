-- Etsy receipt ingest + inventory sync (Watchtower task
-- 54da480e-8e7f-4abf-b0e5-c8a94bcb3ea8). Additive only.

-- 1) orders.etsy_receipt_id — the DB-level dedupe key for receipt ingestion.
--    A given Etsy receipt must produce exactly one ITP order no matter how
--    many times the poller re-fetches it. worker/etsy-receipt-ingest.ts
--    relies on THIS unique constraint rejecting a second INSERT for the same
--    receipt_id (Postgres 23505), not on an application-level
--    check-then-insert, which would race across overlapping poll ticks.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS etsy_receipt_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_etsy_receipt_id
  ON public.orders (etsy_receipt_id) WHERE etsy_receipt_id IS NOT NULL;

-- 2) etsy_connection.receipts_watermark — high-water mark (Etsy receipt
--    updated_timestamp, unix seconds) for the receipt poller, so it only
--    fetches receipts that changed since the last successful poll instead of
--    re-fetching the shop's whole receipt history every tick.
ALTER TABLE public.etsy_connection ADD COLUMN IF NOT EXISTS receipts_watermark bigint NOT NULL DEFAULT 0;
