# Admin Growth Pack — Design (2026-07-06)

**Status:** Design approved-pending-David. No code written yet.
**Owner request (David, 2026-07-06):** blank-shirt inventory with low-stock alerts in admin; full SEO hooks/backlinks/metadata per fully-approved design; add products to TikTok Shop; put Rico on posting to TikTok; stay on top of health and orders — with profitability as the guiding lens.

This design is grounded in a full codebase survey (4 parallel exploration passes, 2026-07-06). File:line references verified against the working tree that day.

---

## Profitability thesis (why this shape, this order)

1. **Revenue visibility is broken today.** `src/pages/AdminDashboard.tsx:422-427` computes revenue from `order.total_amount`, but the live column is `total` — the revenue tile likely reads $0. Can't steer profit blind. Fix ships first, free.
2. **Stockouts and blind reordering burn margin.** Inventory columns already exist in the DB (`products.stock_quantity`, `track_inventory`, `variation_options.stock_quantity`) but nothing surfaces or decrements them. Blanks are the COGS backbone — tracking cost-per-blank per sale unlocks true per-order margin.
3. **Every approved design is a free landing page we currently waste.** The site is a pure SPA with id-based URLs, zero per-product meta, no sitemap, no OG/JSON-LD (`index.html:8,15`, `server-static.mjs:44-52`, `vercel.json:2-4`). Organic search + link unfurls are a compounding, zero-marginal-cost sales channel.
4. **TikTok Shop is distribution; the plan already exists** (`docs/plans/2026-06-17-tiktok-shop-integration-plan.md`). Hard-blocked on David creating the Partner Center Custom app. Everything else composes with it (inventory decrement, order monitor, Rico content).
5. **Fulfillment health = platform health.** TikTok suspends shops that miss tracking SLA; stalled orders quietly refund. An hourly monitor is cheap insurance on every other workstream.

**All AI generation uses cheap models (OpenRouter / gpt-4o-mini class) per David's standing cost-first rule.** Existing services calling `gpt-4o` (`backend/services/ai-product.ts:99,164`) are reused where output already exists, not re-invoked wholesale.

---

## W1 — Blank-shirt inventory + low-stock alerts (admin)

Blanks are **supplies, not sellable products** — they get their own tables rather than overloading `products.stock_quantity`.

### Schema (new migration `supabase/migrations/2026xxxx_blank_inventory.sql`)
- `blank_inventory`: `id uuid pk`, `brand text`, `style_code text` (e.g. Gildan 5000), `color text`, `size text`, `qty_on_hand int`, `reorder_threshold int default 12`, `reorder_qty int`, `cost_per_unit numeric(10,2)`, `supplier text`, `notes text`, `last_alerted_at timestamptz`, timestamps. Unique on `(brand, style_code, color, size)`.
- `blank_inventory_movements`: `id`, `blank_id fk`, `delta int`, `reason text` check (`sale`,`received`,`adjustment`,`shrinkage`), `order_id uuid null`, `created_by uuid null`, `created_at`. Movement rows snapshot `cost_per_unit` → per-order COGS.

### Backend
- New `backend/routes/admin/inventory.ts` (guard `requireAuth, requireAdmin` — pattern `backend/middleware/requireAdmin.ts:4`): list/create/update, receive-stock, movement history, low-stock list. Mount at `/api/admin/inventory` (`backend/index.ts` ~line 207).
- **Decrement on sale:** paid-order handler in `backend/routes/stripe.ts` (~line 697, next to confirmation email) + `backend/routes/storefront.ts` (~line 247). For each shirt line item, match `(color, size)` → blank row; per-product override later via `products.metadata.blank_style`. Write movement + decrement atomically (RPC or single update with guard). TikTok orders (W3) flow through the same handler → same decrement.
- Note the **order_items schema drift**: production columns are `unit_price`/`subtotal`/`metadata`, not Prisma's `price`/`total` (documented `backend/routes/stripe.ts:52-64`). Read line items accordingly.

### Alerts
- Hourly sweep added to the existing worker cleanup interval (`backend/worker/ai-jobs-worker.ts:2307`, `startWorker`): rows with `qty_on_hand <= reorder_threshold` → insert `admin_notifications` (type `low_stock`; insert pattern `backend/routes/admin/support.ts:93-99` — surfaces in the existing `AdminNotificationBell`) + email via new `sendLowStockAlertEmail()` in `backend/utils/email.ts` (Resend). Dedupe: don't re-alert until restocked above threshold (`last_alerted_at` + qty check).

### Admin UI
- New `src/components/AdminInventoryManagement.tsx`, modeled on `AdminCouponManagement.tsx`. Register the `inventory` tab in `AdminDashboard.tsx`: union type (lines 28-29), tab array (line 1814), label ternary (line 1826), `{selectedTab === 'inventory' && ...}` body.
- Grid grouped by brand/style/color with size columns, inline qty edit, "Receive stock" modal, red low-stock badges, movement history drawer.

---

## W2 — SEO pack per fully-approved design

### Trigger point
`backend/routes/admin/user-product-approvals.ts` `POST /:id/approve` — fire **after** the successful `products` UPDATE (~line 227), **only when `generationStatus === 'active'`** (the two-tier gate at lines 100-117 means `active` = fully approved AND all generations exist). Async fire-and-forget so approval latency doesn't grow. Plus a backfill endpoint for already-active designs.

### Generation + persistence
- SEO fields: `meta_title`, `meta_description`, `search_keywords` — columns already in Prisma (`backend/prisma/schema.prisma:204-206`) but unused; **verify they exist in the live DB first**, otherwise one-line migration.
- Reuse before regenerate: `normalizeProduct()` already produces `seo_title`/`seo_description`/`tags` at submit time; the hook fills gaps with a cheap model (vision `describeDesignForProduct` only when no usable copy exists).
- Marketing hooks: 3-5 captions + hashtags + short/med ad copy per design (reuse the `/api/marketing/generate-content` prompt shape, `backend/routes/marketing.ts:19`) → enqueued to `social_outbox` (W4) with product URL, watermarked display image + mockups from `products.metadata.assets`.

### Crawlability layer (without this the metadata is invisible)
- **Slug URLs:** `products.slug` already generated (`backend/utils/slugify.ts`) but routing is id-based (`src/App.tsx:156`). Add `/product/:slug` resolution (keep `/product/:id` working), switch `ProductCard` links to slugs, emit canonical.
- **Sitemap + robots:** backend `GET /sitemap.xml` from active products + categories; `robots.txt`; `vercel.json` rewrite `/sitemap.xml` → API.
- **Meta injection:** Vercel serverless function for `/product/*` that injects title/description/OG/Twitter/JSON-LD (schema.org Product with price, image, availability) into the HTML shell; client-side head manager to match after hydration.
- **Internal backlinks:** related-designs block on `ProductPage` (shared tags/category), category hub links, and every W4 social post linking back to the product URL — that queue is the practical external-backlink engine.

---

## W3 — TikTok Shop sync

Execute the existing plan `docs/plans/2026-06-17-tiktok-shop-integration-plan.md` as written (OAuth → opt-in publish with the 🟢 AI copyright gate → order webhook → tracking sync-back; David's five locked decisions from 2026-06-17 stand).

- **Hard blocker (David):** create the TikTok Partner Center **Custom app** (App Key/Secret/scopes) + pick the small launch catalog. Env placeholders already stubbed (`backend/.env.example:257-265`).
- **Pre-buildable now without creds, behind `TIKTOK_ENABLED=false`:** `tiktok_*` tables migration, `copyright-check.ts` service + admin 🟢 tag, opt-in publish toggle in the approvals UI, webhook route scaffold (raw-body + HMAC registered before `express.json()` at `backend/index.ts:137-141`, mirroring the Stripe handler `backend/routes/webhooks.ts:226-311`).
- TikTok orders land in the same `orders` table with `source: 'tiktok'` (column exists, `001_initial_schema.sql:220`) → W1 decrements blanks, W5 watches SLA.

---

## W4 — Rico posting queue (TikTok content)

ITP side only (Rico himself lives in Watchtower, not this repo):

- New `social_outbox` table: `id`, `product_id`, `platform`, `caption`, `hashtags text[]`, `media_urls text[]`, `status` (`queued`/`claimed`/`posted`/`failed`), `post_url`, `engagement jsonb`, timestamps.
- Bearer-token API following the existing `PRINT_BRIDGE_TOKEN` pattern (`backend/routes/social.ts:216-272` ugc-inbound): `GET /api/social/outbox` (claim next), `POST /api/social/outbox/:id/result` (report `post_url` → auto-insert into `social_posts` via the existing embed generator so the on-site wall shows it).
- W2's approval hook enqueues each newly-approved design. Posting cadence throttled (1-3/day) to avoid platform spam flags.

---

## W5 — Health + order monitoring

- **Worker job** `monitorHealthAndOrders()` on the hourly loop (`ai-jobs-worker.ts:2307`, same slot as W1's sweep): stalled orders (`payment_status='paid'` + unfulfilled > 3 business days; `processing` untouched > 5 days), designs stuck `pending_approval` > 48h, `ai_jobs` failure spikes. Alerts → `admin_notifications` bell + email. Daily ~8am summary email: orders in/out, revenue, low-stock list, stalls.
- **New probes:** `/api/health/worker` (worker heartbeat row read by API — currently no way to know the worker died), alongside existing `/database`, `/email`, `/auth`, `/gcs` (`backend/routes/health.ts`).
- **UI:** revive the orphaned `src/components/SystemStatusWidget.tsx` (imported nowhere today; update its legacy AWS check to GCS, point at `/api/health/*`), add it + a stalled-orders panel to the AdminDashboard overview, and **fix the revenue bug** (`total_amount` → `total`, `AdminDashboard.tsx:422-427`).

---

## Build order + rough effort

| # | Workstream | Effort | Depends on |
|---|-----------|--------|------------|
| 1 | W1 inventory + alerts (incl. revenue-bug fix) | 1 session | — |
| 2 | W5 health/order monitor | 1 short session | — |
| 3 | W2 SEO pack + crawlability | 1-2 sessions | — |
| 4 | W4 Rico outbox (ITP side) | 0.5 session | W2 hook |
| 5 | W3 TikTok scaffold → live | scaffold now; live once David creates the Partner app | David |

## Risks / cautions

- **Working tree is dirty** with the uncommitted `print_locations` task (touches `backend/routes/user-products.ts`, `user-product-approvals.ts`, `prisma/schema.prisma`, `worker/ai-jobs-worker.ts` — files W1/W2 also touch). Verify + commit that work first, or build additively around it.
- `order_items` production schema drift (see W1) — never write via the Prisma model shape.
- Verify live existence of `meta_title`/`meta_description`/`search_keywords` columns before W2 relies on them.
- Health endpoints are unauthenticated; the new worker-heartbeat probe should stay read-only and leak nothing sensitive.

## Open decisions for David

1. Build order confirm (recommendation above).
2. Blank catalog granularity: track brand+style (Gildan 5000 / Bella 3001 …) or start color+size only?
3. Alert channels: admin bell + email default; add Zero voice-daemon ping for critical stalls?
4. The TikTok Partner Center app — still the blocker, unchanged since 2026-06-17.
