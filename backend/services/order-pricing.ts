// Server-side authoritative pricing engine for checkout.
//
// WHY THIS EXISTS (Watchtower task 9a8431d9-a8d4-4adc-8e0d-81309df38547, CRITICAL):
// POST /api/stripe/checkout-payment-intent used to take the client-supplied
// `amount`, `tax`, `discount`, and `shippingCost` and hand them straight to
// Stripe. A buyer could submit `amount: 100` for a $500 cart and pay $1 — the
// real subtotal was computed but never compared against what was charged.
// Every dollar figure that reaches Stripe must now originate from THIS module.
// Nothing here trusts a client-supplied price, discount, or tax number.
//
// SCOPE OF WHAT IS FULLY RE-DERIVED (never trusts the client):
//   - Line subtotal for real catalog products — looked up from `products.price`.
//   - Line subtotal for metal-art custom prints — from METAL_ART_PRICES_CENTS
//     in backend/shared/metal-art.ts (the single source of truth also read by
//     src/pages/MetalArtStudio.tsx).
//   - Line subtotal for CATALOG metal prints (a UUID product whose row is
//     metal-art) — ALSO from METAL_ART_PRICES_CENTS, keyed by the panel size
//     the customer picked (fetchMetalProductIds tells this engine which ids
//     are metal). `products.price` on a metal row is only its entry price.
//   - Add-on prices (easel stand / wall mount / etc.) — from
//     METAL_ADDONS_CENTS, also from backend/shared/metal-art.ts (mirrors
//     src/lib/product-kind.ts METAL_ADDONS, which imports the same table).
//   - The "2 for $25" bundle deal — from backend/shared/promos.ts (the single
//     source of truth also read by src/context/CartContext.tsx), pooled
//     across every bundle-eligible line the same way the cart pools it. See
//     GAP 4 below — this closes Watchtower row 54405e88.
//   - Plus-size upcharge (2XL+) — mirrors src/pages/Checkout.tsx PLUS_SIZES.
//   - Discount — re-validated against the `discount_codes` table (same rules
//     as GET /api/coupons/validate: active, not expired, usage limits, min
//     order amount, per-user limit).
//   - Tax — a server-side US state base sales-tax rate table keyed off the
//     shipping state (see US_STATE_BASE_SALES_TAX_RATES below).
//   - ITC store-credit — capped to the caller's REAL wallet balance, and only
//     honored for an authenticated userId (never a guest-supplied one).
//
// GAPS CLOSED (Watchtower task 188ead33, follow-up to 9a8431d9):
//   1. Imagination-sheet (`imagination-sheet-*`) and 3D-print (`3d-print-*`)
//      custom line items now price from the SAME server rows the rest of the
//      app trusts: imagination_sheets.{print_type,sheet_height} through
//      backend/config/imagination-presets.ts getSheetPrice(), and
//      user_3d_models.print_price_usd through the same color4/paint-kit
//      formula POST /api/3d-models/:id/order already uses. See
//      fetchCustomItemPrices below. The client-declared unit price is no
//      longer consulted for either prefix — an item that can't be resolved
//      from the DB is a pricing error, not a clamped fallback.
//   2. Standard carrier shipping (USPS/UPS live quotes via Shippo) is
//      verified via a short-lived HMAC-signed quote token minted by POST
//      /api/shipping/rates (backend/services/shipping-quote.ts), not a
//      bounds-checked client number. The old $3-$60 sanity band is gone — a
//      legitimate quote of any size is honored; a missing/tampered/expired/
//      mismatched token is rejected outright. Local pickup (always $0) and
//      local delivery (fixed $10/$15 tiers) remain fully authoritative
//      without a token.
//   3. Tax can use Stripe Tax (compliance-grade, county/city/district aware)
//      via calculateTaxViaStripe below, behind the deps.calculateTax seam —
//      but it is OFF by default (STRIPE_TAX_ENABLED unset/false) because
//      Stripe Tax returns $0 tax for any jurisdiction with no configured
//      registration, and nothing is registered yet. Flipping it on without
//      that dashboard work would silently UNDER-collect tax everywhere,
//      which is a legal problem, not a rounding one — see NEEDS-DAVID in the
//      task handoff. US_STATE_BASE_SALES_TAX_RATES remains the active
//      fallback (and the only source) until David configures registrations +
//      product tax codes and sets STRIPE_TAX_ENABLED=true.
//   4. The "2 for $25" bundle deal (David 2026-09-02, changed from "3 for
//      $25") now has server-side pricing at all — before this, a
//      bundle-eligible cart was charged full price at checkout regardless of
//      what the cart/storefront advertised (Watchtower row 54405e88).
//      Eligibility and the bundle math both come from backend/shared/promos.ts,
//      the same module src/context/CartContext.tsx uses, so client and server
//      total agree. See PricingCartItem.isThreeForTwentyFive and
//      computeSubtotalCents below.

import { supabase } from '../lib/supabase.js'
import Stripe from 'stripe'
import { getSheetPrice, SHEET_PRESETS, type PrintType } from '../config/imagination-presets.js'
import { verifyShippingQuote, computeCartWeightLb } from './shipping-quote.js'
import { METAL_ART_PRICES_CENTS, METAL_ADDONS_CENTS, isMetalProductRow, normalizeMetalSizeKey } from '../shared/metal-art.js'
import { BUNDLE_DEAL, bundleTotalCents, isBundleEligible } from '../shared/promos.js'
import { blankUnitPriceDollars, blankPricingOf, isBlankGarmentMeta, type BlankPricing } from '../shared/blank-pricing.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Known, server-verifiable constants (mirrors of frontend price catalogs).
// METAL_ART_PRICES_CENTS / METAL_ADDONS_CENTS now come from
// backend/shared/metal-art.ts — the single source of truth also read by
// src/pages/MetalArtStudio.tsx and src/lib/product-kind.ts (no more
// hand-mirrored copies to drift apart). Everything below that's still local
// is small/stable enough that duplicating it across the frontend/backend
// build boundary remains the pragmatic call — if the source constants
// change, these must be updated too (flagged as a follow-up in the task
// handoff).
// ---------------------------------------------------------------------------

// Mirrors src/lib/product-kind.ts TOY_ADDONS — magnet-mount accessory parts
// and the matched paint kit for catalog 3D toys (David 2026-08-19: every
// character carries palm magnets, so extra weapons/pets are sellable parts).
const TOY_ADDONS_CENTS: Record<string, number> = {
  toy_paint_kit: 1500,
  toy_weapon_pack: 699,
  toy_pet_companion: 999,
  toy_magnet_pair: 299
}

// All server-verifiable per-unit add-ons, by id. Ids are globally unique
// across catalogs (metal vs toy) so one lookup table is safe.
const KNOWN_ADDONS_CENTS: Record<string, number> = {
  ...METAL_ADDONS_CENTS,
  ...TOY_ADDONS_CENTS
}

// Mirrors src/lib/garment-tiers.ts GARMENT_TIERS upcharges (dollars → cents).
// Shirt quality upsell: base catalog price = the standard blank; premium
// blanks add a fixed per-unit upcharge. Unrecognized tier = hard pricing
// error, same posture as add-ons.
const GARMENT_TIER_UPCHARGE_CENTS: Record<string, number> = {
  standard: 0,
  soft: 300,
  premium: 500,
  heavyweight: 700
}

// Mirrors src/pages/Checkout.tsx PLUS_SIZES / PLUS_SIZE_UPCHARGE.
const PLUS_SIZES = ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL']
const PLUS_SIZE_UPCHARGE_CENTS = 250

// Plus-size is an APPAREL upcharge. The substring match used to false-positive
// a metal-art "4x6" print as a plus size ("4x6".toUpperCase() = "4X6", which
// .includes("4X")) and overcharge it $2.50 — FIXED 2026-09-02 together with
// the client's copies (src/context/CartContext.tsx, src/pages/Checkout.tsx)
// so the 1-cent client/server tolerance still holds: a metal panel size is
// never a plus size.
function isPlusSize(size?: string | null): boolean {
  if (!size) return false
  if (normalizeMetalSizeKey(size)) return false
  const upper = size.toUpperCase()
  return PLUS_SIZES.some(ps => upper.includes(ps))
}

// Mirrors backend/routes/3d-models.ts PRINT_PRICING + the color4/paint-kit
// formula in its POST /:id/order handler. Duplicated rather than imported —
// that file has no exports for these — same convention as every other
// mirrored constant table in this module.
const PRINT_3D_BASE_PRICE_DOLLARS = 25
const PRINT_3D_PAINT_KIT_DOLLARS = 15
const PRINT_3D_COLOR4_PREMIUM_MULTIPLIER = 1.3

// Mirrors the discountPercentage values in
// src/utils/wholesale-pricing.ts WholesalePricingCalculator's tiers.
// Duplicated across the frontend/backend build boundary like the constants
// above — this is the flat "off retail" rate applied to REAL cart items,
// which don't carry the per-product wholesalePricing arrays that class's
// calculateProductPricing() expects (those exist only on the mocked
// WholesaleProduct catalog on the wholesale portal, not on src/types
// Product). Only this flat rate is reusable for real catalog products.
export const WHOLESALE_TIER_DISCOUNT_RATES: Record<string, number> = {
  bronze: 0.15,
  silver: 0.25,
  gold: 0.35,
  platinum: 0.45
}

// Shipping constants — mirrors src/utils/shipping-calculator.ts.
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000 // $50
export const RUSH_FEE_CENTS = 799 // $7.99
const LOCAL_DELIVERY_TIER_CENTS = [1000, 1500] // $10 / $15, mirrors LOCAL_DELIVERY_TIERS
// Standard carrier (USPS/UPS via Shippo) rates are live-quoted and verified
// via a signed quote token (see GAP 2 above) — no bounds band needed.

// ---------------------------------------------------------------------------
// US state base sales-tax rates (state-level only — no county/city surtax).
// Sourced from general published 2025/2026 state sales-tax references. This
// table is a simplification, not a compliance-grade jurisdiction lookup —
// NEEDS PERIODIC REVIEW, and is an explicit follow-up to replace with Stripe
// Tax once David configures registrations/product tax codes in the Stripe
// dashboard. Unknown/absent state codes default to DEFAULT_TAX_RATE.
// ---------------------------------------------------------------------------
export const US_STATE_BASE_SALES_TAX_RATES: Record<string, number> = {
  AL: 0.04, AK: 0.00, AZ: 0.056, AR: 0.065, CA: 0.0725, CO: 0.029, CT: 0.0635,
  DE: 0.00, DC: 0.06, FL: 0.06, GA: 0.04, HI: 0.04, ID: 0.06, IL: 0.0625,
  IN: 0.07, IA: 0.06, KS: 0.065, KY: 0.06, LA: 0.0445, ME: 0.055, MD: 0.06,
  MA: 0.0625, MI: 0.06, MN: 0.06875, MS: 0.07, MO: 0.04225, MT: 0.00,
  NE: 0.055, NV: 0.0685, NH: 0.00, NJ: 0.06625, NM: 0.05125, NY: 0.04,
  NC: 0.0475, ND: 0.05, OH: 0.0575, OK: 0.045, OR: 0.00, PA: 0.06, RI: 0.07,
  SC: 0.06, SD: 0.042, TN: 0.07, TX: 0.0625, UT: 0.0485, VT: 0.06, VA: 0.053,
  WA: 0.065, WV: 0.06, WI: 0.05, WY: 0.04,
  // Territories — lower confidence, review before relying on these.
  PR: 0.105, GU: 0.04, AS: 0.00, MP: 0.00, VI: 0.00
}
// Conservative default when the state is unknown/absent/non-US: undercharging
// tax is a margin problem the business can absorb; overcharging is a
// compliance and trust problem. See module docstring re: Stripe Tax follow-up.
export const DEFAULT_TAX_RATE = 0

// GAP 3 (see module docstring): Stripe Tax is wired but OFF by default. David
// must configure tax registrations + per-product tax codes in the Stripe
// dashboard, THEN set STRIPE_TAX_ENABLED=true (backend env) to switch the
// authoritative source over from US_STATE_BASE_SALES_TAX_RATES.
const STRIPE_TAX_ENABLED = process.env.STRIPE_TAX_ENABLED === 'true'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingCartItem {
  productId: string | null | undefined
  quantity: number
  selectedSize?: string | null
  /** Colour NAME as chosen on the product page. Only consulted for blank
   *  garments, whose DB price table is keyed by size + colour group (see
   *  backend/shared/blank-pricing.ts). Never a trusted dollar amount. */
  selectedColor?: string | null
  /** Garment quality tier id (src/lib/garment-tiers.ts) — apparel only. */
  selectedTier?: string | null
  selectedAddonIds?: (string | null | undefined)[] | null
  // Only consulted for product lines whose authoritative formula isn't yet
  // ported server-side. Currently unused by imagination-sheet-*/3d-print-*
  // (GAP 1 closed — see fetchCustomItemPrices); kept for any future custom
  // line-item type that hasn't been ported yet.
  clientUnitPriceDollars?: number | null
  /**
   * Mirrors Product.isThreeForTwentyFive (top-level flag, distinct from
   * metadata.isThreeForTwentyFive on `metadata` below) — ADDED for GAP 4 so
   * this engine can decide bundle ("2 for $25") eligibility the same way
   * src/context/CartContext.tsx does: isThreeForTwentyFive ||
   * metadata?.isThreeForTwentyFive (see backend/shared/promos.ts
   * isBundleEligible). The caller (backend/routes/stripe.ts) must send this
   * from item.product.isThreeForTwentyFive — without it, a product whose
   * eligibility lives only in the top-level flag (not mirrored into
   * metadata) silently prices as non-eligible.
   */
  isThreeForTwentyFive?: boolean | null
  /** Parcel weight in lb — mirrors src/utils/shipping-calculator.ts's per-item
   *  weight, used only to verify a signed carrier shipping quote (GAP 2). */
  weight?: number | null
  /** Cart item metadata (e.g. 3d-print color_mode/include_paint_kit). These
   *  are OPTIONS, never trusted dollar amounts — pricing is still derived
   *  server-side from a formula applied to a DB-fetched base price. */
  metadata?: Record<string, any> | null
}

export interface PricingShippingAddress {
  state?: string | null
  postalCode?: string | null
  country?: string | null
}

export interface PricingShippingInput {
  type?: string | null // 'pickup' | 'delivery' | 'shipping'
  clientAmountCents: number
  rush?: boolean
  /** Signed quote from POST /api/shipping/rates — required for type
   *  'shipping' (standard carrier). See GAP 2 / shipping-quote.ts. */
  shippingQuoteToken?: string | null
}

export interface PricingDiscountCodeRow {
  id: string
  code: string
  type: 'percentage' | 'fixed' | 'free_shipping' | string
  value: number
  is_active: boolean
  expires_at: string | null
  max_uses: number | null
  current_uses: number | null
  min_order_amount: number | null
  max_discount_amount: number | null
  per_user_limit: number | null
}

export interface PricingDependencies {
  /** Returns a map of productId -> price in DOLLARS for known catalog ids. */
  fetchProductPrices: (ids: string[]) => Promise<Map<string, number>>
  /**
   * Returns productId -> per-size/colour price table for the subset of ids
   * that are BLANK garments (products.metadata.garment.blank = true with a
   * pricing table). Read from the DB row, never from the cart's copy of
   * metadata — the client's metadata is exactly as forgeable as its price.
   * A blank's unit price comes from this table INSTEAD of products.price,
   * and the flat plus-size + garment-tier upcharges are skipped for it.
   */
  fetchBlankPricing: (ids: string[]) => Promise<Map<string, BlankPricing>>
  /**
   * Returns the subset of catalog ids that are METAL PRINTS (category /
   * metadata template, judged by backend/shared/metal-art.ts
   * isMetalProductRow). A metal print's unit price is decided by the panel
   * size the customer picked (METAL_ART_PRICES_CENTS), never by the flat
   * `products.price` column — David 2026-09-02: 4x6 and 8x10 were charging
   * the same because nothing server-side knew the row was metal. Optional
   * so existing injected-deps callers/tests keep compiling; absent = no
   * metal-aware pricing (flat catalog price), same as before.
   */
  fetchMetalProductIds?: (ids: string[]) => Promise<Set<string>>
  fetchDiscountCode: (code: string) => Promise<PricingDiscountCodeRow | null>
  countCouponUsageForUser: (discountCodeId: string, userId: string) => Promise<number>
  /** Returns the user's real ITC wallet balance (units), 0 if none. */
  fetchWalletItcBalance: (userId: string) => Promise<number>
  /**
   * Returns the caller's wholesale tier ONLY when they have an approved
   * wholesale account (role === 'wholesale' AND wholesale_status ===
   * 'approved' in user_profiles) — null otherwise, including "applied but
   * still pending". Never resolves from a client-supplied tier/role.
   */
  fetchWholesaleTier: (userId: string) => Promise<'bronze' | 'silver' | 'gold' | 'platinum' | null>
  /**
   * Resolves the AUTHORITATIVE base price (in DOLLARS) for imagination-sheet-*
   * and 3d-print-* cart items, keyed by the item's full cart id (e.g.
   * `imagination-sheet-<uuid>`). For 3d-print-* this is the DB's
   * print_price_usd BEFORE the color4/paint-kit formula (applied in
   * computeLineItemCents via resolve3dPrintUnitCents) — never a client price.
   * An id missing from the map means "could not be priced" and becomes a
   * pricing error, not a fallback. See GAP 1.
   */
  fetchCustomItemPrices: (items: PricingCartItem[]) => Promise<Map<string, number>>
  /**
   * Tax calculation — swappable so tests never hit Stripe. The default
   * (calculateTaxDefault) uses Stripe Tax only when STRIPE_TAX_ENABLED=true,
   * else the state base-rate table. See GAP 3.
   */
  calculateTax: (
    taxableCents: number,
    address: PricingShippingAddress | null | undefined
  ) => Promise<{ taxCents: number; rate: number; source: 'stripe_tax' | 'state_table' }>
}

export interface CalculateOrderPricingInput {
  items: PricingCartItem[]
  shippingAddress?: PricingShippingAddress | null
  shipping: PricingShippingInput
  couponCode?: string | null
  /** Authenticated user id ONLY (e.g. req.user.sub). Pass null for guests —
   *  guests can never apply ITC credit or per-user coupon limits. */
  userId?: string | null
  itcCreditRequested?: number
}

export interface OrderPricingResult {
  productSubtotalCents: number
  /** Combined coupon + wholesale discount, capped to the subtotal. */
  discountCents: number
  couponDiscountCents: number
  wholesaleDiscountCents: number
  wholesaleTier: 'bronze' | 'silver' | 'gold' | 'platinum' | null
  shippingCents: number
  /** The rush surcharge inside shippingCents, server-decided (0 when the
   *  chosen method isn't rush-eligible or rush wasn't asked for). Surfaced so
   *  the order row can record what the customer actually bought without the
   *  route re-deriving the rule. */
  rushFeeCents: number
  taxCents: number
  taxRate: number
  /** Which tax source produced taxCents/taxRate — ops visibility for GAP 3. */
  taxSource: 'stripe_tax' | 'state_table'
  itcCreditCents: number
  itcCreditApplied: number
  totalCents: number
  freeShippingApplied: boolean
  couponError?: string
  /** Non-empty means the order could not be safely priced — caller must 400. */
  errors: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O) — directly unit-testable.
// ---------------------------------------------------------------------------

// Applies the SAME color4/paint-kit formula backend/routes/3d-models.ts POST
// /:id/order uses, to the DB-fetched base tier price (never a client price).
// color_mode/include_paint_kit are OPTIONS read from cart-item metadata —
// they select which formula branch runs, they don't supply a dollar amount.
function resolve3dPrintUnitCents(tierPrintPriceDollars: number, item: PricingCartItem): number {
  const colorMode: 'grey' | 'color4' = item.metadata?.color_mode === 'color4' ? 'color4' : 'grey'
  const basePriceDollars =
    colorMode === 'color4'
      ? Math.ceil(tierPrintPriceDollars * PRINT_3D_COLOR4_PREMIUM_MULTIPLIER) - 0.01
      : tierPrintPriceDollars
  const includePaintKit = colorMode === 'grey' && Boolean(item.metadata?.include_paint_kit)
  const paintKitDollars = includePaintKit ? PRINT_3D_PAINT_KIT_DOLLARS : 0
  return Math.round((basePriceDollars + paintKitDollars) * 100)
}

// Per-unit extras that apply on top of an item's base price regardless of
// whether that base price came from a flat catalog lookup or the pooled
// bundle formula: plus-size upcharge, garment tier upcharge, add-ons. Shared
// by computeLineItemCents (non-bundle items) and computeSubtotalCents's
// bundle-eligible branch so the two paths can never compute "extras"
// differently.
function computeExtrasCentsPerUnit(
  item: PricingCartItem,
  id: string,
  errors: string[],
  opts: { blank?: boolean } = {}
): number {
  let extraCents = 0

  // Blank garments price per size + colour straight off their DB table
  // (backend/shared/blank-pricing.ts) — that table already carries Jiffy's
  // real 2XL-5XL upcharges, and a blank IS its tier, so neither flat
  // upcharge applies. Mirrors src/context/CartContext.tsx calculateTotal.
  if (!opts.blank && isPlusSize(item.selectedSize)) {
    extraCents += PLUS_SIZE_UPCHARGE_CENTS
  }

  if (!opts.blank && item.selectedTier) {
    const tierCents = GARMENT_TIER_UPCHARGE_CENTS[item.selectedTier]
    if (tierCents === undefined) {
      errors.push(`Unrecognized garment tier "${item.selectedTier}" for item ${id}`)
    } else {
      extraCents += tierCents
    }
  }

  for (const addonId of item.selectedAddonIds || []) {
    if (!addonId) continue
    const addonCents = KNOWN_ADDONS_CENTS[addonId]
    if (addonCents === undefined) {
      errors.push(`Unrecognized add-on "${addonId}" for item ${id}`)
      continue
    }
    extraCents += addonCents
  }

  return extraCents
}

export function computeLineItemCents(
  item: PricingCartItem,
  productPriceMap: Map<string, number>,
  customItemPriceMap: Map<string, number> = new Map(),
  blankPricingMap: Map<string, BlankPricing> = new Map(),
  metalProductIds: Set<string> = new Set()
): { cents: number; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const id = String(item.productId ?? '')
  const quantity = Number.isFinite(item.quantity) ? Math.floor(item.quantity) : 0

  if (!id || quantity <= 0) {
    errors.push(`Invalid cart item (productId=${item.productId ?? 'null'}, quantity=${item.quantity})`)
    return { cents: 0, errors, warnings }
  }

  let unitCents: number | null = null
  const isBlank = UUID_RE.test(id) && blankPricingMap.has(id)

  if (isBlank) {
    // Blank garment: the DB-fetched size × colour table IS the price.
    // products.price is only the "from" figure shown on cards. An unknown
    // size is a pricing error, never a fallback to the base price.
    const unitDollars = blankUnitPriceDollars(blankPricingMap.get(id)!, item.selectedSize, item.selectedColor)
    if (unitDollars === null) {
      errors.push(`Blank garment ${id} has no price for size "${item.selectedSize ?? ''}"`)
    } else {
      unitCents = Math.round(unitDollars * 100)
    }
  } else if (UUID_RE.test(id) && productPriceMap.has(id)) {
    if (metalProductIds.has(id)) {
      // Catalog METAL PRINT: priced by the panel size picked, from the same
      // locked table the storefront picker and the studio use — the flat
      // `products.price` column is only the listing's entry price (its
      // smallest size) and must not be charged for an 8x10. Legacy '8x11'
      // rows normalize onto the 8x10 panel. A size that isn't a panel size
      // at all is a hard error (same posture as the studio line below); a
      // MISSING size falls back to the column price with a warning so a
      // pre-existing cart line (or a quick-add with no size) still prices.
      const sizeKey = normalizeMetalSizeKey(item.selectedSize)
      const rawSize = String(item.selectedSize ?? '').trim()
      if (sizeKey) {
        unitCents = METAL_ART_PRICES_CENTS[sizeKey]
      } else if (rawSize) {
        errors.push(`Unknown metal-art print size "${rawSize}" for item ${id}`)
      } else {
        warnings.push(`Metal print ${id} has no size selected — charged at its listing price`)
        unitCents = Math.round(productPriceMap.get(id)! * 100)
      }
    } else {
      unitCents = Math.round(productPriceMap.get(id)! * 100)
    }
  } else if (id.startsWith('metal-art-custom-')) {
    const sizeKey = String(item.selectedSize || '').toLowerCase()
    // METAL_ART_PRICES_CENTS is keyed by the closed MetalArtSizeKey union
    // (backend/shared/metal-art.ts) — an arbitrary lowercased client string
    // isn't assignable to it, so look it up via the widened index signature.
    const known = (METAL_ART_PRICES_CENTS as Record<string, number>)[sizeKey]
    if (known === undefined) {
      errors.push(`Unknown metal-art print size "${item.selectedSize ?? ''}" for item ${id}`)
    } else {
      unitCents = known
    }
  } else if (id.startsWith('imagination-sheet-')) {
    // GAP 1 CLOSED: priced from imagination_sheets.{print_type,sheet_height}
    // via getSheetPrice() — see fetchCustomItemPrices. Never the client price.
    const sheetPriceDollars = customItemPriceMap.get(id)
    if (sheetPriceDollars === undefined) {
      errors.push(`Imagination sheet not found or could not be priced: ${id}`)
    } else {
      unitCents = Math.round(sheetPriceDollars * 100)
    }
  } else if (id.startsWith('3d-print-')) {
    // GAP 1 CLOSED: priced from user_3d_models.print_price_usd via the same
    // color4/paint-kit formula the order route uses — see fetchCustomItemPrices.
    const tierPriceDollars = customItemPriceMap.get(id)
    if (tierPriceDollars === undefined) {
      errors.push(`3D print model not found, not ready, or could not be priced: ${id}`)
    } else {
      unitCents = resolve3dPrintUnitCents(tierPriceDollars, item)
    }
  } else if (UUID_RE.test(id)) {
    errors.push(`Product ${id} not found`)
  } else {
    errors.push(`Unrecognized product id "${id}"`)
  }

  if (unitCents === null) {
    return { cents: 0, errors, warnings }
  }

  const perUnitCents = unitCents + computeExtrasCentsPerUnit(item, id, errors, { blank: isBlank })

  return { cents: perUnitCents * quantity, errors, warnings }
}

export function computeSubtotalCents(
  items: PricingCartItem[],
  productPriceMap: Map<string, number>,
  customItemPriceMap: Map<string, number> = new Map(),
  blankPricingMap: Map<string, BlankPricing> = new Map(),
  metalProductIds: Set<string> = new Set()
): { subtotalCents: number; errors: string[]; warnings: string[] } {
  let subtotalCents = 0
  const errors: string[] = []
  const warnings: string[] = []

  // GAP 4: bundle-eligible items ("2 for $25" — backend/shared/promos.ts)
  // are priced together. Their per-unit extras (plus-size/tier/add-ons)
  // still apply per line, exactly like every other item — only the BASE
  // price is decided differently: eligible quantity is pooled ACROSS every
  // eligible line, then run through bundleTotalCents ONCE for the whole
  // order. This mirrors src/context/CartContext.tsx's calculateTotal
  // exactly, including that a bundle-eligible item's own catalog price is
  // never consulted for the base amount — only used here to confirm the id
  // resolves to a real product (data-integrity check, same posture as every
  // other line type).
  let totalEligibleQty = 0

  for (const item of items) {
    const itemId = String(item.productId ?? '')
    // A blank garment is never bundle-eligible, whatever the cart's copy of
    // metadata claims — its price is its DB size/colour table, full stop.
    const eligible =
      !blankPricingMap.has(itemId) &&
      isBundleEligible({
        isThreeForTwentyFive: item.isThreeForTwentyFive,
        metadata: item.metadata
      })

    if (!eligible) {
      const result = computeLineItemCents(item, productPriceMap, customItemPriceMap, blankPricingMap, metalProductIds)
      subtotalCents += result.cents
      errors.push(...result.errors)
      warnings.push(...result.warnings)
      continue
    }

    const id = String(item.productId ?? '')
    const quantity = Number.isFinite(item.quantity) ? Math.floor(item.quantity) : 0

    if (!id || quantity <= 0) {
      errors.push(`Invalid cart item (productId=${item.productId ?? 'null'}, quantity=${item.quantity})`)
      continue
    }
    if (!UUID_RE.test(id)) {
      errors.push(`Unrecognized product id "${id}"`)
      continue
    }
    if (!productPriceMap.has(id)) {
      errors.push(`Product ${id} not found`)
      continue
    }

    totalEligibleQty += quantity
    subtotalCents += computeExtrasCentsPerUnit(item, id, errors) * quantity
  }

  subtotalCents += bundleTotalCents(totalEligibleQty, BUNDLE_DEAL.priceCents)

  return { subtotalCents, errors, warnings }
}

export interface ResolveShippingInput {
  type?: string | null
  clientAmountCents: number
  rush?: boolean
  /** Pre-discount product subtotal — used for the free-shipping threshold. */
  productSubtotalCents: number
  /** True when a free_shipping coupon applies (zeroes the base rate). */
  freeShippingOverride?: boolean
  /** Signed carrier quote from POST /api/shipping/rates. REQUIRED for type
   *  'shipping' (see GAP 2) — ignored for pickup/delivery, which are already
   *  fully server-derived without one. */
  shippingQuoteToken?: string | null
  /** Current cart's parcel weight, computed the same way POST
   *  /api/shipping/rates computed it (see computeCartWeightLb) — must match
   *  the token's embedded weight or the quote is rejected as stale/reused
   *  against a different cart. */
  cartWeightLb?: number
  /** Current checkout's destination zip — must match the token's. */
  destinationZip?: string | null
}

export interface ResolveShippingResult {
  shippingCents: number
  rushFeeCents: number
  error?: string
}

export function resolveShipping(input: ResolveShippingInput): ResolveShippingResult {
  const type = (input.type || 'shipping').toLowerCase()
  const rushEligible = type === 'pickup' || type === 'delivery'
  const rushFeeCents = input.rush && rushEligible ? RUSH_FEE_CENTS : 0
  const clientCents = Number.isFinite(input.clientAmountCents) ? Math.round(input.clientAmountCents) : NaN

  if (input.freeShippingOverride) {
    return { shippingCents: rushFeeCents, rushFeeCents }
  }

  if (type === 'pickup') {
    // Pickup is always free — no legitimate case where it costs money.
    return { shippingCents: rushFeeCents, rushFeeCents }
  }

  if (type === 'delivery') {
    if (!LOCAL_DELIVERY_TIER_CENTS.includes(clientCents)) {
      const tiers = LOCAL_DELIVERY_TIER_CENTS.map(c => `$${(c / 100).toFixed(2)}`).join(' or ')
      const got = Number.isFinite(clientCents) ? `$${(clientCents / 100).toFixed(2)}` : String(input.clientAmountCents)
      return {
        shippingCents: rushFeeCents,
        rushFeeCents,
        error: `Local delivery fee must be ${tiers}, got ${got}`
      }
    }
    return { shippingCents: clientCents + rushFeeCents, rushFeeCents }
  }

  // Standard carrier shipping — free once the order clears the threshold.
  // Decided purely by the server-computed subtotal now (not by whether the
  // client happened to send 0) — strictly more authoritative than before.
  if (input.productSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) {
    return { shippingCents: rushFeeCents, rushFeeCents }
  }

  // GAP 2 CLOSED: verified against a short-lived HMAC-signed quote minted by
  // POST /api/shipping/rates instead of a $3-$60 bounds check. The amount
  // charged comes from INSIDE the token, never from clientAmountCents.
  const verified = verifyShippingQuote({
    token: input.shippingQuoteToken,
    destinationZip: input.destinationZip || '',
    weightLb: input.cartWeightLb ?? 0
  })
  if (!verified.ok) {
    return { shippingCents: rushFeeCents, rushFeeCents, error: verified.error }
  }

  return { shippingCents: verified.amountCents! + rushFeeCents, rushFeeCents }
}

export function computeTaxCents(taxableCents: number, state?: string | null): { taxCents: number; rate: number } {
  const code = (state || '').trim().toUpperCase()
  const rate = code in US_STATE_BASE_SALES_TAX_RATES ? US_STATE_BASE_SALES_TAX_RATES[code] : DEFAULT_TAX_RATE
  const taxCents = Math.round(Math.max(0, taxableCents) * rate)
  return { taxCents, rate }
}

// ---------------------------------------------------------------------------
// GAP 3 — Stripe Tax (compliance-grade, county/city/district aware).
//
// Lazily-constructed client: order-pricing.test.ts sets only
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, not STRIPE_SECRET_KEY, and `new
// Stripe(undefined)` throws immediately — constructing at module scope would
// break every test. Constructing on first use means tests that never flip
// STRIPE_TAX_ENABLED never touch this at all.
// ---------------------------------------------------------------------------
let stripeTaxClient: Stripe | null | undefined
function getStripeTaxClient(): Stripe | null {
  if (stripeTaxClient !== undefined) return stripeTaxClient
  const key = process.env.STRIPE_SECRET_KEY
  stripeTaxClient = key ? new Stripe(key, { apiVersion: '2025-02-24.acacia' }) : null
  return stripeTaxClient
}

/**
 * Calls Stripe Tax for a compliance-grade rate (state + county/city/district,
 * nexus-aware). Returns null on ANY failure — missing key, no address, no
 * registration for the jurisdiction returning an unusable result, or a
 * network/API error — so the caller can fall back to the state-rate table.
 * Tax must never block checkout because the tax provider had a bad day.
 *
 * Uses a single generic "tangible personal property" tax code (txcd_99999999)
 * because per-product tax codes aren't configured yet — see NEEDS-DAVID in
 * the task handoff. This is a safe generic default per Stripe's own docs,
 * not an invented rate; the RATE still comes entirely from Stripe Tax.
 */
export async function calculateTaxViaStripe(
  taxableCents: number,
  address: PricingShippingAddress | null | undefined
): Promise<{ taxCents: number; rate: number; source: 'stripe_tax' } | null> {
  if (taxableCents <= 0 || !address?.postalCode || !address?.state) return null
  const client = getStripeTaxClient()
  if (!client) return null
  try {
    const calculation = await client.tax.calculations.create({
      currency: 'usd',
      line_items: [
        {
          amount: Math.round(taxableCents),
          reference: 'order_subtotal',
          tax_code: 'txcd_99999999'
        }
      ],
      customer_details: {
        address: {
          country: (address.country || 'US').toUpperCase(),
          state: address.state,
          postal_code: address.postalCode
        },
        address_source: 'shipping'
      }
    })
    const taxCents = Math.round(calculation.tax_amount_exclusive ?? 0)
    return { taxCents, rate: taxableCents > 0 ? taxCents / taxableCents : 0, source: 'stripe_tax' }
  } catch (err) {
    console.error('[order-pricing] Stripe Tax calculation failed — falling back to the state-rate table:', err)
    return null
  }
}

/** Default tax resolver — see PricingDependencies.calculateTax. */
async function calculateTaxDefault(
  taxableCents: number,
  address: PricingShippingAddress | null | undefined
): Promise<{ taxCents: number; rate: number; source: 'stripe_tax' | 'state_table' }> {
  if (STRIPE_TAX_ENABLED) {
    const stripeResult = await calculateTaxViaStripe(taxableCents, address)
    if (stripeResult) return stripeResult
    // Falls through to the state table on any Stripe Tax failure.
  }
  const { taxCents, rate } = computeTaxCents(taxableCents, address?.state)
  return { taxCents, rate, source: 'state_table' }
}

export function computeDiscountFromCoupon(
  coupon: PricingDiscountCodeRow | null,
  subtotalCents: number,
  usageCountForUser: number,
  now: Date = new Date()
): { discountCents: number; freeShipping: boolean; error?: string } {
  if (!coupon || !coupon.is_active) {
    return { discountCents: 0, freeShipping: false, error: 'Invalid coupon code' }
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return { discountCents: 0, freeShipping: false, error: 'Coupon has expired' }
  }
  if (coupon.max_uses != null && (coupon.current_uses ?? 0) >= coupon.max_uses) {
    return { discountCents: 0, freeShipping: false, error: 'Coupon usage limit reached' }
  }
  if (coupon.min_order_amount != null && subtotalCents < Math.round(coupon.min_order_amount * 100)) {
    return {
      discountCents: 0,
      freeShipping: false,
      error: `Minimum order amount of $${coupon.min_order_amount.toFixed(2)} required`
    }
  }
  if (coupon.per_user_limit != null && usageCountForUser >= coupon.per_user_limit) {
    return { discountCents: 0, freeShipping: false, error: 'You have already used this coupon' }
  }

  if (coupon.type === 'free_shipping') {
    return { discountCents: 0, freeShipping: true }
  }
  if (coupon.type === 'percentage') {
    let discountCents = Math.round((subtotalCents * coupon.value) / 100)
    if (coupon.max_discount_amount != null) {
      discountCents = Math.min(discountCents, Math.round(coupon.max_discount_amount * 100))
    }
    return { discountCents: Math.min(discountCents, subtotalCents), freeShipping: false }
  }
  if (coupon.type === 'fixed') {
    return { discountCents: Math.min(Math.round(coupon.value * 100), subtotalCents), freeShipping: false }
  }
  return { discountCents: 0, freeShipping: false, error: 'Unknown coupon type' }
}

/**
 * The anti-tampering gate: the server total is ALWAYS what gets charged, but
 * a client total that drifts from it by more than the rounding tolerance
 * means something was tampered with (or is stale) and checkout must stop.
 */
export function evaluateCheckoutAmount(
  clientAmountCents: number,
  serverAmountCents: number,
  toleranceCents = 1
): { ok: boolean; error?: string } {
  if (!Number.isFinite(clientAmountCents)) {
    return { ok: false, error: 'Invalid amount' }
  }
  const diff = Math.abs(Math.round(clientAmountCents) - Math.round(serverAmountCents))
  if (diff > toleranceCents) {
    return {
      ok: false,
      error: `Order total does not match what was calculated on the server (expected $${(serverAmountCents / 100).toFixed(2)}, got $${(clientAmountCents / 100).toFixed(2)}).`
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Default (real) dependencies — Supabase-backed.
// ---------------------------------------------------------------------------

const defaultDependencies: PricingDependencies = {
  async fetchProductPrices(ids: string[]) {
    const map = new Map<string, number>()
    if (ids.length === 0) return map
    const { data, error } = await supabase.from('products').select('id, price').in('id', ids)
    if (error) {
      throw new Error(`Failed to load product prices: ${error.message}`)
    }
    for (const row of data || []) {
      if (row?.id != null && row?.price != null) map.set(String(row.id), Number(row.price))
    }
    return map
  },

  async fetchBlankPricing(ids: string[]) {
    const map = new Map<string, BlankPricing>()
    if (ids.length === 0) return map
    const { data, error } = await supabase
      .from('products')
      .select('id, metadata')
      .in('id', ids)
      .eq('metadata->garment->>blank', 'true')
    if (error) {
      throw new Error(`Failed to load blank garment pricing: ${error.message}`)
    }
    for (const row of data || []) {
      if (row?.id == null || !isBlankGarmentMeta(row.metadata)) continue
      const pricing = blankPricingOf(row.metadata)
      if (pricing) map.set(String(row.id), pricing)
    }
    return map
  },

  async fetchMetalProductIds(ids: string[]) {
    const metal = new Set<string>()
    if (ids.length === 0) return metal
    const { data, error } = await supabase.from('products').select('id, category, metadata').in('id', ids)
    if (error) {
      throw new Error(`Failed to load product kinds: ${error.message}`)
    }
    for (const row of data || []) {
      if (row?.id != null && isMetalProductRow(row)) metal.add(String(row.id))
    }
    return metal
  },

  async fetchDiscountCode(code: string) {
    const { data, error } = await supabase
      .from('discount_codes')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .single()
    if (error || !data) return null
    return data as PricingDiscountCodeRow
  },

  async countCouponUsageForUser(discountCodeId: string, userId: string) {
    const { count, error } = await supabase
      .from('coupon_usage')
      .select('*', { count: 'exact', head: true })
      .eq('discount_code_id', discountCodeId)
      .eq('user_id', userId)
    if (error || count == null) return 0
    return count
  },

  async fetchWalletItcBalance(userId: string) {
    const { data, error } = await supabase.from('user_wallets').select('itc_balance').eq('user_id', userId).single()
    if (error || !data) return 0
    return Number(data.itc_balance) || 0
  },

  async fetchWholesaleTier(userId: string) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('role, wholesale_status, wholesale_tier')
      .eq('id', userId)
      .single()
    if (error || !data) return null
    if (data.role !== 'wholesale' || data.wholesale_status !== 'approved') return null
    const tier = String(data.wholesale_tier || 'bronze')
    return (tier in WHOLESALE_TIER_DISCOUNT_RATES ? tier : 'bronze') as 'bronze' | 'silver' | 'gold' | 'platinum'
  },

  async fetchCustomItemPrices(items: PricingCartItem[]) {
    const map = new Map<string, number>()
    const sheetIds: string[] = []
    const modelIds: string[] = []
    for (const item of items) {
      const id = String(item.productId ?? '')
      if (id.startsWith('imagination-sheet-')) sheetIds.push(id.slice('imagination-sheet-'.length))
      else if (id.startsWith('3d-print-')) modelIds.push(id.slice('3d-print-'.length))
    }

    if (sheetIds.length > 0) {
      const { data, error } = await supabase
        .from('imagination_sheets')
        .select('id, print_type, sheet_height')
        .in('id', sheetIds)
      if (error) {
        console.error('[order-pricing] Failed to load imagination_sheets for pricing:', error.message)
      } else {
        for (const row of data || []) {
          const printType = row.print_type as PrintType
          if (!(printType in SHEET_PRESETS) || row.sheet_height == null) continue
          map.set(`imagination-sheet-${row.id}`, getSheetPrice(printType, Number(row.sheet_height)))
        }
      }
    }

    if (modelIds.length > 0) {
      const { data, error } = await supabase
        .from('user_3d_models')
        .select('id, print_price_usd')
        .in('id', modelIds)
      if (error) {
        console.error('[order-pricing] Failed to load user_3d_models for pricing:', error.message)
      } else {
        for (const row of data || []) {
          const tierPrice = row.print_price_usd != null ? Number(row.print_price_usd) : PRINT_3D_BASE_PRICE_DOLLARS
          map.set(`3d-print-${row.id}`, tierPrice)
        }
      }
    }

    return map
  },

  calculateTax: calculateTaxDefault
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function calculateOrderPricing(
  input: CalculateOrderPricingInput,
  deps: PricingDependencies = defaultDependencies
): Promise<OrderPricingResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const catalogIds = Array.from(
    new Set(input.items.map(i => i.productId).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))
  )
  const productPriceMap = catalogIds.length > 0 ? await deps.fetchProductPrices(catalogIds) : new Map<string, number>()
  // Blank garments (metadata.garment.blank) price off their own DB size ×
  // colour table — see fetchBlankPricing / backend/shared/blank-pricing.ts.
  const blankPricingMap = catalogIds.length > 0 ? await deps.fetchBlankPricing(catalogIds) : new Map<string, BlankPricing>()
  const metalProductIds =
    catalogIds.length > 0 && deps.fetchMetalProductIds ? await deps.fetchMetalProductIds(catalogIds) : new Set<string>()

  const customItems = input.items.filter(i => {
    const id = String(i.productId ?? '')
    return id.startsWith('imagination-sheet-') || id.startsWith('3d-print-')
  })
  const customItemPriceMap = customItems.length > 0 ? await deps.fetchCustomItemPrices(customItems) : new Map<string, number>()

  const subtotalResult = computeSubtotalCents(input.items, productPriceMap, customItemPriceMap, blankPricingMap, metalProductIds)
  errors.push(...subtotalResult.errors)
  warnings.push(...subtotalResult.warnings)
  const subtotalCents = subtotalResult.subtotalCents

  // Coupon discount
  let couponDiscountCents = 0
  let freeShipping = false
  let couponError: string | undefined
  const code = (input.couponCode || '').trim().toUpperCase()
  if (code) {
    const row = await deps.fetchDiscountCode(code)
    let usageCount = 0
    if (row && input.userId) {
      usageCount = await deps.countCouponUsageForUser(row.id, input.userId)
    }
    const result = computeDiscountFromCoupon(row, subtotalCents, usageCount)
    couponDiscountCents = result.discountCents
    freeShipping = result.freeShipping
    couponError = result.error
  }

  // Wholesale tier discount — resolved from the server-trusted account
  // record (see fetchWholesaleTier), never a client-supplied tier/role.
  // Stacks with a coupon (both are discounts off the same subtotal); the
  // combined total is capped to the subtotal below.
  let wholesaleTier: 'bronze' | 'silver' | 'gold' | 'platinum' | null = null
  let wholesaleDiscountCents = 0
  if (input.userId) {
    wholesaleTier = await deps.fetchWholesaleTier(input.userId)
    if (wholesaleTier) {
      wholesaleDiscountCents = Math.round(subtotalCents * (WHOLESALE_TIER_DISCOUNT_RATES[wholesaleTier] ?? 0))
    }
  }

  const discountCents = Math.min(subtotalCents, couponDiscountCents + wholesaleDiscountCents)

  // Shipping
  const cartWeightLb = computeCartWeightLb(input.items.map(i => ({ weight: i.weight, quantity: i.quantity })))
  const destinationZip = (input.shippingAddress?.postalCode || '').trim()
  const shippingResult = resolveShipping({
    type: input.shipping.type,
    clientAmountCents: input.shipping.clientAmountCents,
    rush: input.shipping.rush,
    productSubtotalCents: subtotalCents,
    freeShippingOverride: freeShipping,
    shippingQuoteToken: input.shipping.shippingQuoteToken ?? null,
    cartWeightLb,
    destinationZip
  })
  if (shippingResult.error) errors.push(shippingResult.error)

  // Tax — on the pre-discount product subtotal, matching the existing
  // business rule already in src/pages/Checkout.tsx (discount reduces the
  // total, not the taxable base). Shipping is not taxed, also matching
  // existing behavior. Source (Stripe Tax vs the state table) is decided by
  // deps.calculateTax — see GAP 3.
  const taxResult = await deps.calculateTax(subtotalCents, input.shippingAddress ?? null)
  const taxCents = taxResult.taxCents
  const taxRate = taxResult.rate

  // ITC store credit — authenticated users only, capped to real balance.
  let itcCreditApplied = 0
  const requested = Math.max(0, Math.floor(input.itcCreditRequested || 0))
  if (requested > 0) {
    if (input.userId) {
      const balance = await deps.fetchWalletItcBalance(input.userId)
      itcCreditApplied = Math.min(requested, Math.max(0, Math.floor(balance)))
    } else {
      warnings.push('ITC credit requested by an unauthenticated caller — ignored')
    }
  }

  const preCreditTotalCents = Math.max(0, subtotalCents - discountCents + shippingResult.shippingCents + taxCents)
  // 1 ITC = $0.01 = 1 cent.
  const itcCreditCents = Math.min(itcCreditApplied, preCreditTotalCents)
  const totalCents = Math.max(0, preCreditTotalCents - itcCreditCents)

  return {
    productSubtotalCents: subtotalCents,
    discountCents,
    couponDiscountCents,
    wholesaleDiscountCents,
    wholesaleTier,
    shippingCents: shippingResult.shippingCents,
    rushFeeCents: shippingResult.rushFeeCents,
    taxCents,
    taxRate,
    taxSource: taxResult.source,
    itcCreditCents,
    itcCreditApplied: itcCreditCents,
    totalCents,
    freeShippingApplied: freeShipping,
    couponError,
    errors,
    warnings
  }
}
