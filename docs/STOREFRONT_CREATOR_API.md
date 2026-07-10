# Storefront Creator API (Merch Studio ⇄ ITP)

Phase 1 of the Merch Studio foundation (design approved 2026-07-10). External
creator storefronts (first: Darrell V2's `/admin/merch` Merch Studio) publish
products INTO ITP, ITP reviews/fulfills/pays, and the creator's public shop
lists only their own catalog.

All endpoints live under `/api/storefront/*` and use the same Bearer auth
(`Authorization: Bearer <key>`), server-to-server only.

## Keys & env (ITP backend)

| Env var | Purpose |
|---|---|
| `STOREFRONT_API_KEY` | Legacy single-tenant key (earth019). Full unscoped catalog; **cannot** create products. |
| `STOREFRONT_CREATOR_KEYS` | JSON map of creator storefronts: `{"darrell": {"key": "<secret>", "creatorUserId": "<ITP user uuid>"}}`. Each key's catalog is scoped to that user's products, and product-publish creates products AS that user. Pairs with the external site's `STOREFRONT_VENDOR`. |
| `STOREFRONT_PRIMARY_VENDOR` | Vendor slug for the legacy key (default `earth019`). |
| `STOREFRONT_BASE_COST_USD` | D1 base cost per shirt (default `10`). |
| `STOREFRONT_BACK_PRINT_UPCHARGE_USD` | Extra-location upcharge when a back print ships (default `5` — **confirm with David**). |
| `STOREFRONT_CREATOR_FEE_PERCENT` | Fee share deducted from creator margin, % of retail (default `3`). |

## GET /api/storefront/catalog

Sellable products only: `status='active' AND is_active=true` (reconciled gate —
`is_active` defaults true in the DB, so the old is_active-only filter leaked
drafts). Creator-mapped keys get only their own products plus a `vendor` echo;
the legacy key stays unscoped. Response items now also carry `colors` and
`printLocations` alongside the existing fields.

## POST /api/storefront/products  (creator keys only)

`multipart/form-data`:

| Field | Type | Notes |
|---|---|---|
| `front_print` | PNG file | **required** — print-ready front art (300 DPI at print size, transparent bg; studio enforces DPI pre-publish) |
| `back_print` | PNG file | optional — adds the back upcharge to `cost_price` |
| `mockups` | up to 10 images | png/jpg/webp composites for review + shop display |
| `name` | text | **required** |
| `retailPrice` | text | **required**, dollars (`"24.99"`); must exceed cost or 400 |
| `description` | text | optional |
| `colors`, `sizes` | text | JSON array or CSV |
| `placement` | text | optional JSON blob of designer transforms (stored verbatim) |
| `externalRef` | text | optional storefront draft id, echoed back in product metadata |

Effect: files stored in ITP GCS (`merch-studio/<vendor>/<batch>/…`); product
created with `created_by_user_id=<mapped creator>`, `is_user_generated=true`,
`status='pending_approval'`, `cost_price = base (+ back upcharge)`,
`print_locations` set, and it lands in the existing admin approval queue.
Approval flips `status='active'` + `is_active=true` → product appears on the
creator's scoped catalog. Rejection sets `status='rejected'` + `is_active=false`
(reason emailed + stored in `metadata.rejection_reason`).

Returns `201 { productId, slug, status, retailUsd, costUsd, files }`.

## POST /api/storefront/checkout (existing, hardened)

- Catalog items are only sellable when `status='active' AND is_active=true`.
- If the storefront omits `designUrl`, ITP defaults it from the product's
  `metadata.print_files.front`, and order-item metadata carries the full
  `print_files` (front + back) so the DTF queue gets both placements.
- `source` defaults to the authenticated key's vendor slug.

## Creator payout (paid webhook)

`backend/services/creator-margins.ts`, called from BOTH paid paths (stripe.ts
`handleCheckoutOrderPayment` + webhooks.ts fallback). For each user-generated
product on a paid order:

- `cost_price > 0` (Merch Studio) → **D1 margin**: `retail − cost_price − fee%`
  per unit → creator ITC wallet (1¢ = 1 ITC).
- no cost basis (legacy AI designs) → standing **15% royalty**.

Idempotent per (order, product): existence check + unique index
`uq_user_product_royalties_order_product`
(`supabase/migrations/20260710_merch_studio_storefront.sql`). Cashout stays the
existing Stripe Connect path ($50 min, 7% fee) — untouched.

## One-time setup for a new creator storefront

1. Pick/create the creator's ITP user (their `user_profiles.id`).
2. Mint a strong key; add to `STOREFRONT_CREATOR_KEYS` on the ITP backend.
3. On the external site set `ITP_STOREFRONT_BASE_URL`, `STOREFRONT_API_KEY`
   (the minted key), `STOREFRONT_VENDOR` (the slug).
4. Creator connects Stripe (existing Connect onboarding) to cash out.
