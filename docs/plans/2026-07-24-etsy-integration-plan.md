# Etsy Product Posting — Integration Plan

**Author:** Rico Fernandez · **Watchtower task:** `0a675d4c-860a-40fa-b0fc-1149f031b095` · **Date:** 2026-07-24
**Companion docs:** `docs/ETSY_API_RESEARCH.md` (API research) · code in `backend/services/etsy.ts`,
`backend/routes/admin/etsy.ts`, `backend/scripts/etsy-poc.mjs`, `supabase/migrations/20260724_etsy_integration.sql`

## What is already built (this task)

| Piece | File | Status |
|-------|------|--------|
| API research report | `docs/ETSY_API_RESEARCH.md` | done |
| DB schema (states/tokens/sync ledger) | `supabase/migrations/20260724_etsy_integration.sql` | written, **not applied** |
| OAuth PKCE + token refresh + publisher service | `backend/services/etsy.ts` | done, typechecked |
| Admin routes (connect/callback/status/taxonomy/shipping/publish/listings) | `backend/routes/admin/etsy.ts` mounted at `/api/admin/etsy` | done, typechecked |
| Standalone PoC (auth + create listing + image) | `backend/scripts/etsy-poc.mjs` | done, **not yet run live** |
| Env contract | `backend/.env.example` `ETSY_*` block | done |

**Honesty ledger:** no live Etsy call has been made — there is no Etsy shop, no Etsy app, and no
`ETSY_KEYSTRING` anywhere in the vault. Everything below Phase 0 is code-complete but unproven
against the real API until David does Phase 1 (his account, ~$15 shop fee → approval filed).

## Phase 0 — done (this dispatch)
Everything in the table above. Integration ships dark behind `ETSY_ENABLED=false`; the mounted
routes fail gracefully (503 "not configured") until credentials exist.

## Phase 1 — owner setup (David, ~20 min, blocks everything)
1. Create the ITP Etsy shop on etsy.com (one-time ~$15 USD setup fee; shop name suggestion:
   `ImagineThisPrinted`). Set up **one shipping profile** and **one return policy** in shop settings.
2. Create an app at `etsy.com/developers/your-apps` (same Etsy account). Instant provisional access
   covers our own-shop use case — no Etsy review needed.
3. Register both redirect URIs on the app **exactly**:
   `http://localhost:3939/callback` and `https://api.imaginethisprinted.com/api/admin/etsy/callback`.
4. Put the keystring in the vault (`C:\Users\David\.secrets\keys.json` → `ETSY_KEYSTRING`) and in
   Render backend env (`ETSY_KEYSTRING`, keep `ETSY_ENABLED=false` until Phase 3).

## Phase 2 — PoC validation (any agent, ~15 min once Phase 1 lands)
1. `node backend/scripts/etsy-poc.mjs auth` → browser consent → tokens saved. **= Deliverable 2 proven.**
2. `node backend/scripts/etsy-poc.mjs whoami` → confirms user + shop id.
3. `node backend/scripts/etsy-poc.mjs taxonomy --q shirt` → pick real taxonomy ids; record the map.
4. `node backend/scripts/etsy-poc.mjs create-listing --title … --price … --taxonomy … --image …`
   → draft listing + image visible in Etsy Shop Manager. **= Deliverable 3 proven.** (Draft = free;
   add `--publish` only when we want it live.)

## Phase 3 — production enablement
1. Apply `supabase/migrations/20260724_etsy_integration.sql` (additive, 3 new RLS-locked tables).
2. Set Render env: `ETSY_ENABLED=true`, `ETSY_KEYSTRING`, `ETSY_TAXONOMY_MAP` (ids from Phase 2),
   `ETSY_SHIPPING_PROFILE_ID`, `ETSY_RETURN_POLICY_ID` (from `/api/admin/etsy/shipping-profiles` +
   `/return-policies`), leave `ETSY_AUTO_PUBLISH=false`.
3. Admin connects prod: `GET /api/admin/etsy/connect` → open returned URL → callback stores tokens.
4. Post one real product: `POST /api/admin/etsy/publish/:productId` → verify draft in Shop Manager →
   re-run with `{"publish": true}` to go live.

## Phase 4 — admin UI + scale-out (follow-up work, filed on the board)
- **Admin panel tab** (AdminDashboard): connect button, status, per-product "Post to Etsy" with
  taxonomy picker, listings ledger from `GET /api/admin/etsy/listings`. Backend is UI-ready.
- **Updates/dedupe:** `etsy_listings` already enforces one listing per product; add
  `updateListing`/`updateListingInventory` calls for price/stock edits (service has the client for it).
- **Image sync:** re-upload on product image change (compare `uploaded_image_count` + product
  `updated_at` vs `last_synced_at`).
- **Bulk/auto posting:** worker sweep (mirror `ai-jobs-worker` pattern) posting approved+active
  products in batches ≤50/day at ≤3 QPS — well inside the ~10k/day quota (≤13 calls/product).
- **Order import** (optional later): `transactions_r` scope + receipts endpoints → ITP orders table
  with `source: etsy` tag, mirroring the TikTok Shop plan's source-tag convention.

## Error handling & operational rules (implemented)
- Every publish attempt lands in `etsy_listings` (`state`: pending → draft → active, or `error` with
  `last_error`); failures never leave half-tracked listings — a created draft is recorded before
  images upload, so a mid-flight crash is recoverable and never double-lists (unique `product_id`).
- 429s honor `retry-after` once, then surface; token refresh persists the rotated refresh token
  atomically before returning; 90-day refresh expiry surfaces as "not connected" in `/status`
  (admin reconnects — one click, no data loss).
- Transparent-PNG DTF art renders black on Etsy → post mockup renders (products.images already
  holds mockups first), max 10 images, 10MB cap enforced pre-upload.

## Decisions & assumptions (per dispatch open questions)
1. **Field mapping:** `meta_title||name`→title (≤140), `description||meta_description`→description,
   `price` dollars→price (min $0.20), `search_keywords`→≤13 tags (sanitized), `images[]`→≤10 photos,
   `category`→taxonomy via `ETSY_TAXONOMY_MAP`; `who_made=i_did`, `when_made=made_to_order`,
   `type=physical`, quantity default 100 (`ETSY_DEFAULT_QUANTITY`). Sizes/colors variations deferred
   to Phase 4 (`updateListingInventory`).
2. **Volume:** assumed ≤ a few hundred listings, ad-hoc/manual at first (admin-triggered per product),
   batch sweep later — rate-limit budget confirmed fine for full-catalog scale.
3. **Images:** JPG/PNG/GIF ≤10MB, ≥2000px recommended, no transparency (renders black) — enforced/
   documented; ITP mockup URLs are used as-is, no resizing needed at current sizes.
4. **Credential storage:** keystring in the existing vault + Render env (same pattern as every other
   ITP secret); OAuth tokens server-side in `etsy_connection` under RLS-deny-all (service-role only).
   No secrets in the frontend — v3 has no client secret at all, so blast radius of a leaked keystring
   is low (PKCE + consent still required).
