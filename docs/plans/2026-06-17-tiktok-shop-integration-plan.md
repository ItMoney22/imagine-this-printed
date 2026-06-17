# TikTok Shop Integration — Build Plan

**Date:** 2026-06-17
**Owner:** David (via Zero/Earth)
**Status:** Plan only — no code written yet. Research done; awaiting go-ahead to scaffold.

## Goal

When a product is approved/published on ImagineThisPrinted, optionally **push it to our
TikTok Shop** as a live listing; when an order is placed on TikTok Shop, **pull it into
our system, alert us immediately (email + Zero voice), and sync tracking back** to TikTok
so shop-health stays clean. TikTok suspends accounts fast — so the plan is sandbox-first,
small original catalog, and never ship late.

## The critical mental model (read first)

TikTok Shop is a **marketplace**, not a feed of our site. Listings live on TikTok; **TikTok
collects the customer's payment**; the order comes to **us** to fulfill. We must ship and
push the **tracking number back to TikTok within their SLA** or our shop-health score drops.
So this is a **two-way sync**, not a one-way product export:

```
ITP product (approved)  ──push──>  TikTok listing
                                       │ customer buys on TikTok (TikTok takes payment)
ITP order + alerts  <──webhook──  TikTok order
ITP ships + tracking  ──update──>  TikTok (within SLA)  ──> shop-health stays green
```

## Prerequisites — Partner Center app click-path (David's side; seller account exists, dev app does NOT yet)

US seller (Rockmart GA) → use the **US** Partner Center. Exact steps:

1. Go to **https://partner.us.tiktokshop.com/** and sign in. Register as a **developer** when
   prompted — a seller developer's account is tied to your existing shop (that shop is the only
   one that can authorize apps you create — exactly what we want).
2. Left menu → **"Manage Apps"** / **"App & Service"** → **Create App**.
3. **App type: Custom app** (single seller / direct — NOT "Public app", which is the public App
   Store). If offered, pick **"Seller in-house developer"** and verify with your shop admin email
   for faster approval (~2–3 business days).
4. **Region/market: US** — ⚠️ cannot be changed later, get it right.
5. App basics: app name (e.g. "ImagineThisPrinted Sync"), logo, description.
6. **Redirect / Callback URL:** `https://api.imaginethisprinted.com/api/tiktok/oauth/callback`
7. **Webhook URL:** `https://api.imaginethisprinted.com/api/tiktok/webhook`
   *(Both URLs can be registered now; they just need to be live before we actually authorize/test.
   We can update them later if needed.)*
8. **Scopes / permissions:** select **product management, order management, inventory,
   logistics/fulfillment, finance (read)**. (Connector guides suggest selecting all available
   scopes to avoid permission gaps — fine for a Custom app.)
9. Submit for approval. After approval the app page shows **App Key** and **App Secret**.
10. **Authorization URL** (how we connect the shop later): `https://services.us.tiktokshop.com/open/authorize?service_id=<App ID>`.
   Our backend builds this; you click it once to authorize and TikTok redirects to our callback.

**Credentials handling:** App Key, App Secret, and the webhook secret go **straight into the
backend env** (`TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_WEBHOOK_SECRET`) — on Render and
local `.env` — **by David**. Never in the frontend, never pasted into chat; Claude never needs the
literal values, just confirmation they're set.

## Architecture (fits the existing stack)

- New backend router `backend/routes/tiktok.ts` mounted at `/api/tiktok` in `backend/index.ts`.
- New service `backend/services/tiktok/` — `client.ts` (signed request helper + token refresh),
  `products.ts` (publish flow), `orders.ts` (ingest + fulfill), `auth.ts` (OAuth).
- All TikTok calls are **server-side only** (App Secret + access token never touch the browser).
- Reuses: Supabase `orders`/`order_items`, the Brevo/Resend senders (`backend/services/email.ts`),
  and the Zero voice daemon (`POST http://localhost:7878/api/voice/summon-user`) for alerts.
- Feature-flagged (`TIKTOK_ENABLED`) so nothing activates until keys + testing are in.

### New Supabase tables (DDL to be run via migration — not by the patrol)

- `tiktok_shop_auth` — `id, shop_cipher, shop_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, scopes, connected_at, updated_at`. One row per connected shop. **Tokens encrypted at rest (confirmed)** — stored with app-level encryption (e.g. AES via a server-only key in env), decrypted only in memory on the backend when making a TikTok call.
- `tiktok_product_links` — `id, product_id (FK products), tiktok_product_id, status (draft|live|rejected|delisted), last_synced_at, last_error, created_at`. Maps our product → its TikTok listing.
- `tiktok_orders` — `id, tiktok_order_id, order_id (FK orders), order_status, raw_payload jsonb, received_at, fulfilled_at, tracking_number, tracking_carrier`. Idempotency key = `tiktok_order_id`.
- `tiktok_webhook_events` — `id, event_type, signature_ok, tiktok_order_id, payload jsonb, processed, received_at`. Audit + dedupe log.

> Schema must be **live-verified** against the DB before code reads/writes it (per the
> standing patrol rule — migrations in this repo drift). All columns above are proposed,
> not yet created.

## Phase 1 — OAuth connect (1 shop)

- `GET /api/tiktok/oauth/start` (admin-only) → build the TikTok authorization URL from
  `TIKTOK_APP_KEY`, redirect David to authorize.
- `GET /api/tiktok/oauth/callback` → receive `auth_code`, **exchange** (POST to TikTok token
  endpoint with App Key + App Secret + code) → store **access token + refresh token + shop
  cipher** in `tiktok_shop_auth`.
- Background **token refresh** before expiry (access tokens are short-lived; refresh tokens
  longer). A small scheduled check or refresh-on-401 wrapper in `client.ts`.
- Admin UI: a "Connect TikTok Shop" button + connection status in the admin dashboard.

## Phase 2 — Product publish (tie into the approval flow we already built)

The create sequence ([Create Product API](https://partner.tiktokshop.com/docv2/page/6502fc8da57708028b42b18a)):

1. **Get Categories** → resolve our `product-kind` → a TikTok category (apparel → T-shirts, etc.).
2. **Get Attributes** for that category → discover *required* attributes (varies by category).
3. **Upload Image** (one call per image; TikTok returns image IDs — URLs aren't accepted) —
   feed it our display/mockup assets from `metadata.assets` (NOT halftone/DTF).
4. **Create Product** → title, description, image IDs, price, **SKUs/variants** (map our
   `sizes` × `colors`), category, attributes, **warehouse**, **shipping template**.
   - Missing required field → TikTok creates a **draft** + returns the missing fields. We
     store `status='draft'` + `last_error` and surface it in admin rather than failing silently.
- **Hook point:** `backend/routes/admin/user-product-approvals.ts` approve route — after a
  product goes `active`, if `TIKTOK_ENABLED` and admin opted in, enqueue a publish. Keep it
  **opt-in per product** (a "Publish to TikTok" toggle), not automatic, so we control the catalog.
- **IP gate (suspension defense):** the **Publish to TikTok** action is gated on the AI
  copyright check (the new feature above) — only a 🟢 "Good for TikTok" (`clear`) product can
  publish; `risky` needs an explicit admin override; `blocked` cannot publish.

## Phase 3 — Order webhook → alerts (David's #1 ask)

- `POST /api/tiktok/webhook` (public, **no auth middleware** — it's TikTok calling us) that:
  1. **Verifies the signature** with `TIKTOK_WEBHOOK_SECRET` (reject if bad → log to
     `tiktok_webhook_events` with `signature_ok=false`). Mirrors how `webhooks.ts` already
     verifies Resend/Brevo.
  2. **Dedupes** on `tiktok_order_id` (TikTok re-sends; idempotent insert).
  3. On **new order**: insert into `tiktok_orders` + create a row in our `orders`/`order_items`
     (reusing the live schema — add-ons/metadata pattern) **tagged `source: 'tiktok'`** (live
     `orders.source` column already exists) so it lands in the same fulfillment queue with a
     visible "from TikTok" badge, then **fire alerts**:
     - email me via the existing Brevo/Resend sender,
     - ping the **Zero voice daemon** ("New TikTok order — 1 shirt, ship by <date>"),
     - show it in admin order management.
  4. On **status change / return / listing approved-rejected / inventory**: update the
     relevant row + alert on the ones that matter (rejection, return).
- Events to handle: **new order, order status change, listing approved/rejected, inventory
  change, return initiated** ([Order status change event](https://partner.tiktokshop.com/docv2/page/1-order-status-change)).
- Always return 200 fast (process async) so TikTok doesn't retry-storm us.

## Phase 4 — Fulfillment + tracking sync back (shop-health critical)

- When we ship (existing fulfillment flow / Shippo tracking), call TikTok's **fulfillment/
  ship-package** API to push the **tracking number + carrier** back, well inside their SLA.
- Surface "ship by" deadlines from the order in admin + the voice alert so nothing slips.
- Late/no tracking = shop-health hit = suspension risk. This phase is **not optional**.

## Phase 5 — Sandbox testing checklist (do ALL of this before live)

TikTok Partner Center has a **Sandbox** ("Development kits"). Run the full loop there first:

- [ ] OAuth connect succeeds; tokens stored; refresh works (force a 401, confirm auto-refresh).
- [ ] Publish a test product → appears as **live** (not stuck draft) with correct category,
      variants, price, images.
- [ ] Simulate a **new order** webhook → row created, **email alert** received, **voice alert**
      plays, admin shows it.
- [ ] Bad-signature webhook → rejected + logged, no order created.
- [ ] Duplicate webhook (same `tiktok_order_id`) → no double order (idempotency holds).
- [ ] Push **tracking** back → TikTok reflects shipped status.
- [ ] Simulate **return** + **listing rejected** → correct alerts.
- [ ] Only after all green: connect the **live** shop, publish **one** real original product,
      place one real test buy, confirm the whole loop, then scale the catalog slowly.

## Account-suspension de-risking (why TikTok nukes shops)

Sources: [Seller Enforcement Policy](https://seller-us.tiktok.com/university/essay?knowledge_id=2380042836166443&lang=en),
[why sellers get suspended](https://www.tabcut.com/blog/post/why-tiktok-shop-is-suspending-so-many-sellers-now),
[37M listings blocked](https://www.aol.com/tiktok-blocks-37-million-suspicious-130000763.html).

1. **IP / counterfeit / copyright — our #1 risk.** AI designs can echo trademarked
   characters/brands. **Mitigation:** the AI copyright check + "Good for TikTok" gate (only
   `clear` designs publish; `blocked` can't) + start with a small clearly-original catalog.
2. **Late shipping / poor fulfillment** → Phase 4 tracking automation + deadline alerts.
3. **Missing compliance docs** for restricted categories → stick to apparel/metal art first.
4. **Inaccurate info** → business, tax, warehouse details must match exactly.
5. **Suspicious activity** (chargebacks, fake reviews, account sharing) → don't.
- Appeals (if it happens): Shop Health → Violation Records → Appeal (2 attempts max).

## Build vs. buy

- **Custom integration (recommended):** Express routes against the TTS API directly. Full
  control, no monthly fee, reuses ~70% of existing backend/Supabase/alerts. Cost = build +
  maintenance + passing TikTok's app review.
- **Middleware** (Pipe17 / Productsup / ShopSync): faster, but recurring fee, less control,
  another account that can break. Not recommended given we already have the backend.

## Confirmed decisions (2026-06-17, from David)

1. **Warehouse + processing time** — Warehouse: **640 Goodyear Ave, Rockmart, GA**. Processing
   time registered on the TikTok shipping template: **3–5 business days** (can tighten later if
   we ship faster). This is the SLA we must beat on every order to protect shop-health.
2. **Opt-in confirmed** — products are published to TikTok per-product on demand, never
   auto-published on approval.
3. **AI copyright check is a gate (new feature — see below)** — before a design can be listed
   on TikTok, an AI reviews it for copyright/trademark risk. Pass → admin shows a green
   **"Good for TikTok"** tag and the Publish button unlocks. Flagged → blocked + reasons shown.
4. **Encrypt tokens at rest — yes.** *(Plain-English: the TikTok access/refresh tokens are the
   "keys" to our shop. We store them scrambled in the database so that even if someone got a
   peek at the DB, the keys would be unreadable/unusable. We decrypt them only in memory, on
   the server, when making a TikTok call. Standard practice; no downside to you.)*
5. **Same fulfillment queue, tagged** — TikTok orders flow into the existing fulfillment queue;
   each carries a **"source: TikTok"** tag/badge so we can tell at a glance where it came from.

## NEW FEATURE — AI copyright check + "Good for TikTok" tag (decision #3)

This is our #1 suspension defense (TikTok blocked 37M suspicious listings; AI art is the risk).

- **When:** runs on demand from the admin product editor (and re-runs if the design/name/desc
  changes). NOT at customer-design time — only as a pre-TikTok gate.
- **What it checks:** the design image + product name + description for recognizable
  **trademarked characters, brand logos, celebrity likeness, copyrighted art/franchises**.
- **How:** a vision-capable model (reuse our existing AI stack — GPT-4o-class vision or Claude
  vision) via a new `backend/services/tiktok/copyright-check.ts`. Returns a structured verdict:
  `{ status: 'clear' | 'risky' | 'blocked', confidence, reasons[], checked_at }`.
- **Stored on:** `products.metadata.tiktok_copyright_check` (jsonb — no new column needed).
- **Admin UX:** in the edit modal / product list, show a tag:
  - 🟢 **"Good for TikTok"** when `status='clear'`,
  - 🟡 **"Review needed"** (risky) with the reasons,
  - 🔴 **"Not for TikTok"** (blocked) with the reasons.
- **Gate:** the **Publish to TikTok** action is disabled unless status is `clear` (admin can
  override `risky` with an explicit confirm; `blocked` cannot be published).
- This is advisory automation, not legal advice — final call stays with the admin.

## Catalog scope for launch (still open — David to pick)

Which handful of clearly-original designs go up first for the live smoke-test? (Needed only
at go-live, after Sandbox passes — not blocking the build.)

## References

- [TikTok Shop developer guide](https://partner.tiktokshop.com/docv2/page/tts-developer-guide)
- [API concepts overview](https://partner.tiktokshop.com/docv2/page/tts-api-concepts-overview)
- [Create Product API](https://partner.tiktokshop.com/docv2/page/6502fc8da57708028b42b18a)
- [Order API overview](https://partner.tiktokshop.com/docv2/page/650b1b4bbace3e02b76d1011)
- [Order status change webhook](https://partner.tiktokshop.com/docv2/page/1-order-status-change)
- [Integration guide (keyapi)](https://www.keyapi.ai/blog/tiktok-shop-api-integration-guide-sellers/)
- [Seller Enforcement Policy](https://seller-us.tiktok.com/university/essay?knowledge_id=2380042836166443&lang=en)
