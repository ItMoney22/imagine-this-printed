# Checkout Shipping Overhaul — Design

**Date:** 2026-06-15
**Owner:** David (via Zero/Earth)

## Problem (reported)
At checkout, shipping is pulled from Shippo (GoShippo) but:
1. Prices "seem off."
2. Need better carrier options (UPS + USPS).
3. Pickup should be **3 business days** standard.
4. **Rush** = extra **$7.99** for **next-business-day** pickup *or* delivery, only if the
   order is placed **before 2 PM** (warehouse Eastern Time).
5. For shipping, the customer must **enter their address first** before rates are shown.

## Root causes found
- **Shippo runs in the browser** (`src/utils/shippo.ts`) via `VITE_SHIPPO_API_TOKEN`.
  If that token isn't set in the frontend build it silently returns **mock FedEx/USPS
  rates** (`9.99 / 14.99 / 24.99`, no UPS). Token is also exposed to the browser.
- **Parcel weight is hardcoded to 1 lb / 10×8×4** in `shippo.ts` `createShipment` — it
  ignores the real cart weight the calculator computes, so rates never match the order.
- A **default Los Angeles address** is used when the form is empty
  (`Checkout.tsx` `calculateShipping`), so rates show *before* any address is entered.
- Orders **≥ $50 short-circuit to only "Free Shipping"** (`shipping-calculator.ts`),
  hiding pickup, local delivery, and all carriers — which would hide every new option
  below for most real orders.

## Decisions (confirmed with David)
1. **Move Shippo rate fetching to the backend** — real cart weight, server-side token,
   live USPS + UPS.
2. **Rush = checkbox add-on** shown under the selected Pickup / Local Delivery option.
3. **After 2 PM ET**, show rush **greyed-out** with reason ("Order before 2 PM ET for
   next-day").
4. **Keep the 5% markup**, applied to accurate real-weight rates.

## Design

### Backend — `POST /api/shipping/rates` (`backend/routes/shipping.ts`)
- Body: `{ addressTo, items: [{ weight, quantity }], subtotal }`.
- Compute total weight from items; build parcel `{10×8×4, weight}`.
- If `SHIPPO_API_TOKEN` present + destination zip: call Shippo `/shipments`, filter for
  **USPS** (Ground Advantage / Priority / Priority Express) and **UPS** (Ground / 2nd Day
  Air / Next Day Air Saver), apply **5% markup**, return mapped rates (`source: 'shippo'`).
- Otherwise (or on Shippo error / empty): return **weight-aware USPS + UPS estimates**
  (base + per-lb), 5% markup applied (`source: 'estimate'`). Always returns sane USPS+UPS
  options so the UI is never empty or FedEx-only.
- Add `SHIPPO_API_TOKEN` to `backend/.env.example` with a note that live rates also need
  USPS/UPS carrier accounts connected in the Shippo dashboard.

### Calculator — `src/utils/shipping-calculator.ts`
- Replace the in-browser Shippo call with a `fetch('/api/shipping/rates')` call; client
  keeps a local estimate fallback only if the backend itself is unreachable.
- **Pickup → 3 business days** (was 1); **Local delivery → 3 business days** (was 2).
- Mark pickup + delivery rates `rushEligible: true` (new optional field on `ShippingRate`).
- Add rush config + helpers (exported): `RUSH_FEE = 7.99`, `RUSH_CUTOFF_HOUR = 14`,
  `RUSH_TIMEZONE = 'America/New_York'`, `isRushAvailable()` (current ET hour < 14),
  `getRushUnavailableReason()`.
- **Free shipping refactor:** stop short-circuiting. Build the full option list, then if
  `subtotal ≥ threshold` zero out the cheapest `type:'shipping'` rate and label it
  "Free Standard Shipping". Pickup, delivery, rush, and paid expedited upgrades still show.

### Checkout — `src/pages/Checkout.tsx`
- **Address-first:** remove the default-LA fallback. When address (street/city/state/zip)
  is incomplete, don't compute; render a placeholder card: "Enter your shipping address
  above to see pickup, delivery, and live shipping rates." Spinner while loading, options
  once loaded.
- **Rush checkbox** under the selected Pickup / Local Delivery option:
  "⚡ Rush — ready/delivered next business day (+$7.99)". Disabled (greyed) with reason
  when `!isRushAvailable()`. Selecting a different rate resets the rush toggle.
- Effective shipping cost = base rate + ($7.99 if rush checked & eligible & available).
  Feeds the order total and the Stripe payment intent (`shippingCost`, and a
  "— Rush (Next Day)" suffix on `shippingMethod`).

## Files touched
- `backend/routes/shipping.ts` (add `/rates`)
- `backend/.env.example` (add `SHIPPO_API_TOKEN`)
- `src/utils/shipping-calculator.ts` (backend call, timing, rush, free-shipping refactor)
- `src/pages/Checkout.tsx` (address-first gating, rush UI + total/payment wiring)
- `src/types/index.ts` (optional `rushEligible` on shipping rate — calculator-local type,
  no change needed if kept in calculator)

## Out of scope / notes
- Admin label creation (`OrderManagement` via `shippo.ts` `createLabel`) is unchanged.
- Live carrier rates require `SHIPPO_API_TOKEN` set in Railway **and** USPS/UPS accounts
  connected in Shippo; until then the weight-aware estimates are served.
