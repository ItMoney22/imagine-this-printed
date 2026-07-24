# Etsy Open API v3 — Research Report for ITP Product Posting

**Author:** Rico Fernandez (Watchtower task `0a675d4c-860a-40fa-b0fc-1149f031b095`)
**Date:** 2026-07-24
**Verified against:** developers.etsy.com documentation (Essentials → Authentication / Rate Limits, Tutorials → Quick Start / Listings), Etsy Help Center image requirements, and etsy/open-api GitHub discussions.

---

## 1. What API we use

Etsy **Open API v3** (`https://api.etsy.com/v3/...`) is the only supported API — v2 is dead.
There is **no sandbox environment**: all listings created via the API are real listings on a real
shop. The safe test path is to create listings in **`draft` state** (drafts are invisible to buyers
and incur no listing fee until published/activated).

## 2. App registration & access tiers

| Tier | What it can do | How you get it |
|------|----------------|----------------|
| **Provisional** (default on app creation) | Read public resources + full read/write **for the app owner's own account/shop** via OAuth | Instant — create an app at `etsy.com/developers/your-apps` |
| **Seller app** (personal/own-shop) | Same as provisional, formalized for running your own shop | "Create a seller app" in the Developer Portal — eligible sellers approved **within minutes**, no manual queue |
| **Commercial** | OAuth access to *any* seller who consents | Manual review by Etsy (needed only if we ever list on behalf of third parties) |

**For ITP we only need provisional/seller access** — we're posting to our own new Etsy store.
This means: David creates the Etsy shop + creates the app under the same Etsy account, and we're
unblocked the same day. No Etsy review gate for our use case.

Prerequisites that only the owner can do (blockers for live runs):
1. An **Etsy shop** on the account (Etsy charges a one-time shop setup fee — ~$15 USD — and $0.20 USD
   per published listing; drafts are free).
2. An **app** in the Developer Portal → gives us the **keystring** (API key / OAuth client_id).
3. **Callback/redirect URLs** registered on the app (exact-match required):
   - `http://localhost:3939/callback` (PoC script)
   - `https://api.imaginethisprinted.com/api/admin/etsy/callback` (production)

## 3. Authentication — OAuth 2.0 Authorization Code + PKCE

- **Authorize URL:** `https://www.etsy.com/oauth/connect`
  Query params: `response_type=code`, `client_id=<keystring>`, `redirect_uri`, `scope` (space-separated),
  `state` (CSRF token, required), `code_challenge` (BASE64URL(SHA256(verifier))), `code_challenge_method=S256`.
- **Code verifier:** 43–128 chars from `[A-Za-z0-9._~-]`. PKCE is **mandatory**; there is **no client
  secret** in the v3 token exchange (the keystring + verifier is the whole credential).
- **Token URL:** `POST https://api.etsy.com/v3/public/oauth/token` with **JSON body**:
  - Exchange: `{ "grant_type": "authorization_code", "client_id", "redirect_uri", "code", "code_verifier" }`
  - Refresh: `{ "grant_type": "refresh_token", "client_id", "refresh_token" }`
- **Token lifetimes:** access token **1 hour**; refresh token **90 days**. Every refresh returns a new
  refresh token — persist it each time. If we go 90 days without a refresh, the admin must reconnect
  through the consent screen (integration should surface this state, not silently fail).
- **Access token format:** `"<user_id>.<token>"` — the numeric Etsy user_id can be split off the front.
- **Required headers on every API call:** `x-api-key: <keystring>` plus, for authenticated endpoints,
  `Authorization: Bearer <access_token>`.
- **Scopes we need:** `listings_r listings_w shops_r` (add `shops_w` only if we later automate shop
  sections; `transactions_r` only if we later import Etsy orders).

## 4. Endpoints for the posting flow

| Step | Endpoint |
|------|----------|
| Identify user | `GET /v3/application/users/me` → `user_id` |
| Find shop | `GET /v3/application/users/{user_id}/shops` → `shop_id` |
| Browse categories | `GET /v3/application/seller-taxonomy/nodes` → pick `taxonomy_id` per product type |
| Shipping profiles | `GET /v3/application/shops/{shop_id}/shipping-profiles` → `shipping_profile_id` |
| Return policies | `GET /v3/application/shops/{shop_id}/policies/return` → `return_policy_id` (required to *activate* physical listings) |
| **Create listing** | `POST /v3/application/shops/{shop_id}/listings` (form-encoded/JSON fields below) |
| **Upload image** | `POST /v3/application/shops/{shop_id}/listings/{listing_id}/images` (multipart, field `image` = binary) |
| Publish | `PATCH /v3/application/shops/{shop_id}/listings/{listing_id}` with `state=active` |
| Update stock/price/variations | `PUT /v3/application/listings/{listing_id}/inventory` |
| Delete | `DELETE /v3/application/listings/{listing_id}` |

### createDraftListing — required fields
- `quantity` (int)
- `title` (≤140 chars; Etsy blocks some punctuation runs)
- `description`
- `price` (float, in the shop's currency — **dollars, not cents**, on create; inventory endpoints use `{amount, divisor}` money objects)
- `who_made` — `i_did` | `someone_else` | `collective` (ITP = `i_did`)
- `when_made` — `made_to_order` for our POD flow
- `taxonomy_id` — Etsy category node (from seller-taxonomy; **do not hardcode blind** — fetch and map once per ITP category)
- For physical listings: `shipping_profile_id` (required to activate; recommended at create), `type=physical`
- Listing is created in **`state=draft`** — activation is a separate PATCH and requires ≥1 image + shipping profile + return policy.

Useful optional fields: `tags` (≤13, each ≤20 chars, letters/numbers/spaces/hyphens only), `materials` (≤13),
`is_personalizable`, `personalization_instructions`, `styles`, `item_weight`/`item_dimensions` (for calculated shipping).

## 5. Images

- Upload endpoint takes **multipart/form-data** with `image` = binary file (JPG/PNG/GIF).
- **Max 10 MB** per file, up to **10 images** (+1 video) per listing; a listing cannot be activated with zero images.
- Etsy recommends ≥2000 px on the shortest side; **transparent PNG areas render black** — for DTF
  transfer art (transparent PNGs) we must flatten onto a white/colored background or, better, use the
  ITP mockup renders as the Etsy photos.
- Upload order = display order; `rank=1` is the hero image. Re-uploading the same `listing_image_id`
  can reorder without re-transferring bytes.

## 6. Rate limits

- Communicated per-app in the Developer Portal and on every response via headers:
  `x-limit-per-second` / `x-remaining-this-second` / `x-limit-per-day` / `x-remaining-today`.
- Default for new apps is effectively **10,000 requests per rolling 24 h / ~10 QPS** (confirm ours in
  the portal once the app exists — Etsy stopped printing the numbers in the docs and says "see portal").
- The daily window is a **sliding 24 h window**, not midnight reset. 429 responses include `retry-after`.
- Budget per product post: 1 createDraftListing + N image uploads (≤10) + 1 activate + occasional
  taxonomy/profile lookups ≈ **≤13 calls/product** → even a 500-product catalog sync is ~6.5k calls,
  inside a day's quota, but we should still throttle to ~2–3 QPS and honor `retry-after`.

## 7. Constraints & gotchas that shape the design

1. **No sandbox** → integration must default to `draft` state; publishing (`active`) is an explicit,
   fee-incurring action ($0.20/listing) behind an admin toggle.
2. **Refresh token churn** → every refresh returns a *new* refresh token; store atomically or the
   connection bricks after the old one is invalidated.
3. **taxonomy_id is required** and Etsy's taxonomy is Etsy-specific — needs a one-time admin mapping
   from ITP categories (shirts, tumblers, hoodies, dtf-transfers, metal-art, 3d-prints) to Etsy nodes.
4. **Shipping profile must exist in the shop** before any listing can activate — one-time manual setup
   in Etsy (or via `createShopShippingProfile`), then referenced by id.
5. **Made-to-order POD is allowed** (`when_made=made_to_order`, `who_made=i_did`), but Etsy's 2022+
   policy requires disclosing production partners for outsourced printing. ITP prints in-house
   (Rockmart, GA per TikTok Shop notes) → we're the maker; no partner disclosure needed.
6. **Digital products** (`type=download`) are a different flow (file upload endpoint, no shipping) —
   out of scope for v1; ITP 3D-model files could use it later.
7. Etsy listing fees: $0.20 per published listing, 6.5% transaction fee + payment processing on sale.
   Auto-renew ($0.20 every 4 months or on sale) is on by default.

## 8. Recommendation

Build a thin, dependency-free client on Node 18+ `fetch`/`FormData` (no SDK needed — official Node SDK
is unmaintained), OAuth PKCE connect flow in the admin dashboard, tokens in a Supabase table (service-role
only), and a `publishProductToEtsy(productId)` service that: maps ITP product → draft listing → uploads
`products.images[]` → optionally activates. Ship behind `ETSY_ENABLED=false` until credentials exist.
This is implemented in `backend/services/etsy.ts` + `backend/routes/admin/etsy.ts` +
`backend/scripts/etsy-poc.mjs`; full rollout steps in `docs/plans/2026-07-24-etsy-integration-plan.md`.

**Sources:**
- [Etsy Open API v3 — Authentication](https://developers.etsy.com/documentation/essentials/authentication)
- [Etsy Open API v3 — Rate Limits](https://developers.etsy.com/documentation/essentials/rate-limits)
- [Etsy Open API v3 — Listings tutorial](https://developers.etsy.com/documentation/tutorials/listings)
- [Etsy Open API v3 — Quick Start](https://developers.etsy.com/documentation/tutorials/quickstart)
- [Etsy App Approval — etsy/open-api discussion #1361](https://github.com/etsy/open-api/discussions/1361)
- [Etsy Help — Requirements and Best Practices for Images](https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop)
