-- Add orders.shipping_label_url (Watchtower task 1199ada7).
--
-- src/pages/OrderManagement.tsx and src/pages/CRM.tsx have read
-- `orders.shipping_label_url` since they were written, but no migration ever
-- created the column. Verified against the live project on 2026-07-27:
--   GET /rest/v1/orders?select=shipping_label_url
--   -> 400 {"code":"42703","message":"column orders.shipping_label_url does not exist"}
-- so the field was always undefined in the UI and the "Label" button never
-- appeared. The column is required for POST /api/orders/:orderId/shipping-label
-- to persist the purchased Shippo label.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;

COMMENT ON COLUMN orders.shipping_label_url IS
  'Carrier label PDF URL from the Shippo transaction. Written only by the backend service role via POST /api/orders/:orderId/shipping-label.';
