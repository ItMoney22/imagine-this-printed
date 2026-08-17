# Buyer-side Virtual Try-On

**Watchtower task:** `3b362203-e296-4230-bd7e-5f40b489462a`
**Status:** built, **not live** — needs a `FASHN_API_KEY` and the migration applied.
**Owner:** Zero Saturn

A shopper on an apparel product page uploads a photo of themselves and sees the
garment rendered on them before buying. First one each day is free; after that
it is priced in ITC. Every step is instrumented so the feature can be killed on
data rather than opinion.

---

## 1. Why this exists, and where it must NOT be used

FASHN's `tryon-v1.6` bills **1 credit per successful output** — $0.075 on-demand,
$0.0488 at commitment tier III (verified 2026-07-26, help.fashn.ai). That is
about **2.5x a gpt-image-2 1K render**, which makes it the wrong tool for
catalog work: `backend/services/etsy-model-shots.ts` already produces on-model
listing photography for less, and nothing in this feature touches it.

The only case where $0.075 can pay for itself is **buyer-facing**, where one
render might convert a browse into a cart. Section 6 is how we find out whether
it actually does.

---

## 2. Shape

```
src/components/VirtualTryOn.tsx      the product-page card
src/pages/ProductPage.tsx            mounts it (apparel only) + emits add_to_cart
src/lib/api.ts                       tryonApi client
backend/routes/tryon.ts              endpoints
backend/services/fashn-tryon.ts      FASHN transport (submit + poll)
backend/services/virtual-tryon.ts    daily cap, ITC pricing, funnel maths
backend/worker/tryon-retention-sweep.ts  automatic photo expiry (§7.1)
supabase/migrations/20260816_virtual_tryon.sql
supabase/migrations/20260816_02_tryon_photo_retention.sql
```

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/tryon/enabled` | public | Is the feature switched on? The card needs this before sign-in. |
| GET | `/api/tryon/config` | user | Free-remaining today, ITC balance, tier prices. |
| POST | `/api/tryon/generate` | user | multipart `photo` + `productId` + `tier` + `garmentImageIndex`. |
| POST | `/api/tryon/events` | user | `tryon_card_viewed` / `add_to_cart`. |
| GET | `/api/tryon/history` | user | Last 20 completed try-ons whose images haven't been swept (§7.1). |
| DELETE | `/api/tryon/:id` | user | Deletes the row **and the stored image bytes**. |
| GET | `/api/tryon/analytics` | admin | The keep-or-kill report. |

### Tables

- `virtual_tryon_runs` — one row per FASHN call: tier, mode, status, credits,
  `cost_usd`, `itc_charged`, `used_free_daily`, latency, GCS paths.
- `virtual_tryon_daily_usage` — `UNIQUE(user_id, usage_date)`; this constraint
  *is* the free-try-on lock.
- `virtual_tryon_events` — the funnel.
- `virtual_tryon_conversion` (view) — cohort add-to-cart rates straight from SQL.

---

## 3. FASHN integration

```
POST https://api.fashn.ai/v1/run          { model_name: "tryon-v1.6", inputs: {...} }  -> { id }
GET  https://api.fashn.ai/v1/status/{id}                                               -> { status, output[], error }
Authorization: Bearer $FASHN_API_KEY
statuses: starting | in_queue | processing | completed | failed
```

Inputs we send: `model_image` (a 60-minute signed URL to the shopper's photo),
`garment_image` (the product mockup), `category` (inferred from the product's
own category text), `mode`, `num_samples`, `garment_photo_type: flat-lay`,
`moderation_level: conservative`, `output_format: jpeg`.

Three things worth knowing:

1. **Failed predictions are not billed by FASHN**, so `runTryOn` reports
   `creditsUsed: 0` on any non-`completed` outcome, and the route refunds off
   that. `runTryOn` never throws for an API failure — only for a missing key.
2. **A 5xx while polling is not a dead prediction.** The poller keeps going to
   the deadline rather than throwing away a render we may already be paying for.
3. **Credits are counted from outputs returned, not samples requested.**

### The garment image is resolved server-side

The client sends a `productId` and an *index*, never a URL. The server rebuilds
the gallery from the `products` row using the same preference order as
`src/lib/product-kind.ts` and clamps the index into it. A client-supplied
garment URL would let anyone spend our FASHN credits on arbitrary images.

---

## 4. Pricing

1 ITC = $0.01 (`backend/config/itc-pricing.ts` is authoritative). Prices live in
`imagination_pricing`, so the existing admin panel retunes them without a deploy
— same pattern as every other AI spend in the app.

| Tier | FASHN mode | Samples | Cost to us | Charged |
|---|---|---|---|---|
| `tryon_standard` | balanced | 1 | $0.075 | 10 ITC ($0.10) |
| `tryon_premium` | quality | 2 | $0.150 | 25 ITC ($0.25) |
| daily free | performance | 1 | $0.075 | 0 |

`is_free_trial` is **false** on both rows on purpose. `imagination_free_trials`
is a *lifetime* counter; the free allowance for this feature is the *daily* one
below. Turning both on would hand out two different free grants for one feature.

Deduction uses the optimistic-lock pattern from
`routes/imagination-station.ts` (`.eq('itc_balance', expected)`) with one
re-read retry — never read-then-write.

---

## 5. The daily free cap

One free try-on per **signed-in user** per **store-local calendar day**
(`America/New_York`, so it resets at local midnight rather than at 8pm ET the way
a naive UTC date would).

The claim is an `INSERT` against `UNIQUE(user_id, usage_date)`. Two concurrent
requests race on the constraint and exactly one comes back with a row — that one
is free, the other is priced. A read-then-write check would give a
double-clicking shopper two free renders.

Three rules the tests pin down (`backend/services/virtual-tryon.test.ts`):

- The free slot is claimed **before** any ITC is touched, so a loaded wallet
  still spends the free render first.
- The free render always runs the **cheapest** FASHN configuration. The UI
  hides the tier picker while the free render is available and says so, rather
  than offering a "free Premium" that the server will never produce.
- **Nobody pays for a failure.** On a failed render the ITC is refunded with a
  `virtual_tryon_refund:*` ledger row and the free slot is released so the
  shopper can retry the same day.

Identity is the Supabase `user.id` from the verified JWT, enforced server-side.
There is no anonymous try-on — the cap is only enforceable against an account,
and an IP- or cookie-keyed cap is one incognito window from being free forever.

On top of the daily cap, `/generate` carries its own per-user rate limit
(`TRYON_LIMIT_PER_MIN`, default 6/min) because the daily cap only bounds the
*free* run — someone with ITC could otherwise hammer the endpoint.

---

## 6. Instrumentation — the kill decision

`GET /api/tryon/analytics?days=30` returns the whole picture. The maths is a
pure function (`summarizeConversion`) so it is unit-tested without a database.

**Cohorts are matched on "saw the try-on card on this product":**

- **used** — saw the card and completed at least one try-on on that product
- **not used** — saw the card and never ran one

Comparing try-on users against all site traffic would be selection bias dressed
up as a lift number. `tryon_card_viewed` fires from an `IntersectionObserver` at
40% visibility, so "rendered in the DOM" doesn't count as "seen".

The `add_to_cart` event is emitted by **ProductPage**, not by the try-on card,
so it fires for both buttons. If only the card reported it, the control cohort
would show a 0% add-to-cart rate and every lift figure would be a lie.

**Tracked:** `tryon_card_viewed`, `tryon_started`, `tryon_completed`,
`tryon_failed`, `add_to_cart` (with `attributed_to_tryon` and
`seconds_since_tryon`), `purchase`. Per-run: cost in USD, ITC charged, FASHN
latency, free-vs-paid.

**Derived:** add-to-cart rate per cohort, lift in percentage points, incremental
carts, FASHN spend, ITC recovered, net USD, cost per completed run, cost per
incremental add-to-cart.

### The verdict

The brief's rule — kill it if the lift doesn't cover $0.075 per click —
translates to a rate:

```
breakeven incremental carts per 100 runs = (BREAKEVEN_USD / VALUE_PER_ADD_TO_CART) * 100
                                         = (0.075 / 4.00) * 100  =  1.88
```

`verdict` is `kill` if lift is zero or negative, or if the actual incremental
carts per 100 runs falls under that bar; `keep` if it clears it;
`insufficient-data` under 50 matched shoppers.

> **Assumption, and the only unmeasured number in the report:**
> `TRYON_VALUE_PER_ADD_TO_CART_USD = 4` — roughly $26 AOV x ~50% gross margin x
> ~30% cart-to-purchase. Retune it once real cart-to-purchase data exists for
> this cohort; the `purchases` counts in the report are there so that day comes.

---

## 7. Privacy

- Photos land in a **private** GCS prefix (`tryon/<userId>/…`). Public access is
  blocked at the org level on this bucket anyway.
- No long-lived URL to a shopper's own photo is ever stored. Only the object
  path is persisted; a **60-minute** signed URL is minted when FASHN needs to
  read it. (`virtual_tryon_runs` deliberately has no `model_photo_url` column.)
- `DELETE /api/tryon/:id` removes the photo **and** every result object from
  GCS, not just the row. The card promises this in copy, so it has to be true.
- Failed renders delete the uploaded photo immediately.
- `moderation_level: conservative` — the strictest setting FASHN offers.

### 7.1 Automatic retention sweep

Shopper photos expire on a timer whether or not anyone presses Delete
(`backend/worker/tryon-retention-sweep.ts`, Watchtower task `f3bf450c`).

| Knob | Default | What it does |
|---|---|---|
| `TRYON_PHOTO_RETENTION_DAYS` | `30` | How long an uploaded photo may live. |
| `TRYON_RETENTION_SWEEP_HOURS` | `24` | Sweep cadence. Daily — the window is measured in weeks, so a faster tick only buys query load. |
| `TRYON_RETENTION_KEEP_RESULTS` | `false` | `true` keeps the rendered results past the window and expires only the source photo. |
| `TRYON_RETENTION_BATCH` | `200` | Rows per tick, so a backlog drains over days instead of hanging the worker. |
| `TRYON_RETENTION_ENABLED` | *(on)* | `false` switches the sweep off entirely. |

What one tick does:

1. Selects `virtual_tryon_runs` older than the window that still hold an image
   pointer, oldest first.
2. Deletes `model_photo_path` — and, unless `TRYON_RETENTION_KEEP_RESULTS=true`,
   every `result_paths` object — from GCS.
3. Nulls `model_photo_path` (and `result_paths` / `result_url` / `result_urls`)
   and stamps `photos_purged_at`.

Four things it deliberately does **not** do:

- **It never deletes the run row.** `cost_usd`, `itc_charged`, `status` and
  `used_free_daily` are the keep-or-kill conversion report in §6 — dropping the
  row to delete a photo would quietly destroy the data the feature is judged on.
  Only the image pointers are cleared.
- **It never nulls a path whose bytes are still there.** The path is the only
  pointer we hold; nulling it after a failed delete would orphan a customer's
  photo in the bucket, unreachable even by their own Delete button. A failed
  delete leaves the row untouched and the next sweep retries it. An object
  that's already gone (404) counts as success.
- **It does nothing at all when GCS is unconfigured**, for the same reason —
  nulling pointers we can't act on is strictly worse than waiting.
- **It doesn't need its migration to work.** `photos_purged_at` ships in
  `20260816_02_tryon_photo_retention.sql`; if that hasn't been applied, the
  purge write is retried without the stamp. (This repo has already taken one
  production outage from deployed code querying an unapplied column.)

Why results expire with the photo by default: a FASHN result is not an
anonymous mockup, it's the shopper's own body wearing the garment, generated
from their photo. It is at least as identifying as the input, so deleting the
upload while keeping the render would be privacy theatre. `GET /api/tryon/history`
filters out runs whose results have been swept, so an expired try-on drops out
of the shopper's gallery instead of rendering a broken tile.

The card states the window to the shopper in its own copy, read from
`GET /api/tryon/enabled` rather than hardcoded — retuning
`TRYON_PHOTO_RETENTION_DAYS` changes the promise on screen with it.

Running it on several worker replicas at once is safe: deleting an object twice
yields `missing` and nulling an already-null column is a no-op, so there is
nothing to claim or lock.

---

## 8. Turning it on

1. Create a FASHN account at <https://fashn.ai>, buy credits, copy the API key
   from Settings → API.
2. Apply `supabase/migrations/20260816_virtual_tryon.sql`, then
   `supabase/migrations/20260816_02_tryon_photo_retention.sql`, to production.
3. Set on the Render backend service: `FASHN_API_KEY`, `TRYON_ENABLED=true`, and
   `FASHN_COST_PER_CREDIT_USD` to whatever tier you actually bought. The
   retention sweep runs in the **worker** service and needs no new key — but it
   does need the worker's GCS credentials (`GCS_PROJECT_ID` / `GCS_CREDENTIALS`),
   or it logs a warning and declines to run rather than nulling paths it can't
   act on. Watch for `[tryon-retention]` in the worker log.
4. Deploy. The card appears on apparel product pages on its own — it reads
   `GET /api/tryon/enabled` and renders to `null` until that says yes.
5. Watch `GET /api/tryon/analytics?days=14`. Kill with `TRYON_ENABLED=false` (no
   deploy needed) if the verdict comes back `kill`.

**Rollback** is `TRYON_ENABLED=false`. The card disappears, `/generate` 503s, and
nothing else on the product page changes.
