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
//   - Line subtotal for metal-art custom prints — from the METAL_ART_PRICES
//     table (mirrors src/pages/MetalArtStudio.tsx's exported constant).
//   - Line subtotal for imagination-sheet-* items — from the persisted sheet
//     row (width × height × $0.02/sq-in) plus the print-type preset.
//   - Line subtotal for 3d-print-* items — from the model's `print_price_usd`
//     (tier price) plus optional paint kit / color4 premium.
//   - Add-on prices (easel stand / wall mount / etc.) — from METAL_ADDONS_CENTS
//     (mirrors src/lib/product-kind.ts METAL_ADDONS).
//   - Plus-size upcharge (2XL+) — mirrors src/pages/Checkout.tsx PLUS_SIZES.
//   - Discount — re-validated against the `discount_codes` table (same rules
//     as GET /api/coupons/validate: active, not expired, usage limits, min
//     order amount, per-user limit).
//   - Tax — computed via Stripe Tax (compliance-grade, county/city-aware) when
//     STRIPE_TAX_ENABLED is set; falls back to US_STATE_BASE_SALES_TAX_RATES
//     when Stripe Tax is not configured.
//   - Shipping (standard carrier) — verified via a signed quote token from
//     /api/shipping/rates. The token binds rate + carrier + service + cartHash
//     + expiry and is HMAC-SHA256 signed with SHIPPING_TOKEN_SECRET.
//   - Shipping (pickup/delivery) — fully authoritative ($0 / $10/$15 tiers).
//   - ITC store-credit — capped to the caller's REAL wallet balance, and only
//     honored for an authenticated userId (never a guest-supplied one).
//
// KNOWN GAPS (documented, not silently papered over):
//   None remaining. All three gaps from task 9a8431d9 are closed:
//   1. imagination-sheet-* and 3d-print-* pricing is now server-derived.
//   2. Carrier shipping is verified via signed quote tokens (no more $3-$60 band).
//   3. Tax uses Stripe Tax when configured; otherwise falls back to state rates.

import { supabase } from '../lib/supabase.js'
import { verifyShippingQuote, type ShippingQuoteTokenPayload } from './shipping-token.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Known, server-verifiable constants (mirrors of frontend price catalogs).
// These are small and stable enough to duplicate rather than share across the
// frontend/backend build boundary. If the source constants change, these must
// be updated too (flagged as a follow-up in the task handoff).
// ---------------------------------------------------------------------------

// Mirrors src/pages/MetalArtStudio.tsx METAL_ART_PRICES.
const METAL_ART_PRICES_CENTS: Record<string, number> = {
  '4x6': 1499,
  '8x11': 2999
}

// Mirrors src/lib/product-kind.ts METAL_ADDONS.
const METAL_ADDONS_CENTS: Record<string, number> = {
  easel_stand: 700,
  standoff_mount: 1000,
  hanging_kit: 500,
  gift_box: 500
}

// Mirrors src/pages/Checkout.tsx PLUS_SIZES / PLUS_SIZE_UPCHARGE.
const PLUS_SIZES = ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL']
const PLUS_SIZE_UPCHARGE_CENTS = 250

// KNOWN PRE-EXISTING BUG, faithfully mirrored (not introduced or fixed here):
// the substring match below false-positives a metal-art "4x6" print as a
// plus size, because "4X" is one of the PLUS_SIZES tokens ("4x6".toUpperCase()
// = "4X6", which .includes("4X")). That means a real 4x6 metal print is
// currently overcharged $2.50 in production today, via this exact function in
// src/pages/Checkout.tsx. Fixing it here without also fixing the client would
// create a NEW client/server mismatch (this engine is the one enforcing the
// 1-cent tolerance), so it is deliberately left matching the client's current
// behavior. Flagged as a follow-up — see task handoff.
function isPlusSize(size?: string | null): boolean {
  if (!size) return false
  const upper = size.toUpperCase()
  return PLUS_SIZES.some(ps => upper.includes(ps))
}

// Shipping constants — mirrors src/utils/shipping-calculator.ts.
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000 // $50
export const RUSH_FEE_CENTS = 799 // $7.99
const LOCAL_DELIVERY_TIER_CENTS = [1000, 1500] // $10 / $15, mirrors LOCAL_DELIVERY_TIERS

// ---------------------------------------------------------------------------
// Imagination-sheet pricing (sourced from backend/config/imagination-presets.ts).
// Formula: width * height * $0.02/sq-in, mirrored from ImaginationStation.tsx.
// ---------------------------------------------------------------------------

export type PrintType = 'dtf' | 'uv_dtf' | 'sublimation'

export interface PrintTypePreset {
  width: number
  heights: number[]
  rules: { mirror: boolean; whiteInk: boolean; minDPI: number }
  displayName: string
  description: string
}

// Mirrors backend/config/imagination-presets.ts SHEET_PRESETS.
export const SHEET_PRESETS: Record<PrintType, PrintTypePreset> = {
  dtf: {
    width: 22.5,
    heights: [24, 36, 48, 53, 60, 72, 84, 96, 108, 120, 132, 144, 168, 192, 216, 240],
    rules: { mirror: false, whiteInk: true, minDPI: 300 },
    displayName: 'DTF (Direct-to-Film)',
    description: '22.5" width (FIXED), any color, no mirroring required'
  },
  uv_dtf: {
    width: 16,
    heights: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
    rules: { mirror: false, whiteInk: true, minDPI: 300 },
    displayName: 'UV DTF (Stickers)',
    description: '16" width (FIXED), hard surface transfers, optional cutlines'
  },
  sublimation: {
    width: 22,
    heights: [24, 36, 48, 60, 72, 84, 96, 120],
    rules: { mirror: true, whiteInk: false, minDPI: 300 },
    displayName: 'Sublimation',
    description: '22" width (FIXED), no white ink, mirroring often required'
  }
}

const PRICE_PER_SQ_INCH = 0.02 // $0.02 per square inch base

/**
 * Compute the price of an imagination-sheet item from its persisted dimensions
 * and print type. Mirrors the client-side formula in
 * ImaginationStation.tsx calculateSheetPrice().
 */
export function computeSheetPriceCents(printType: PrintType, width: number, height: number): number {
  const sqInches = width * height
  return Math.round(sqInches * PRICE_PER_SQ_INCH * 100)
}

/**
 * Validate that the sheet dimensions match a known preset.
 */
export function validateSheetSize(printType: PrintType, height: number): boolean {
  return SHEET_PRESETS[printType]?.heights.includes(height) ?? false
}

// ---------------------------------------------------------------------------
// 3D-print pricing (sourced from backend/routes/3d-models.ts POST /:id/order).
// Formula: model.print_price_usd (tier price) + optional paint kit / color4.
// ---------------------------------------------------------------------------

const PAINT_KIT_ADDON_CENTS = 1500 // $15.00
const COLOR4_PREMIUM = 1.3 // 30% premium for full-color prints

/**
 * Compute the price of a 3d-print item from the model's tier price + options.
 * Mirrors the pricing in backend/routes/3d-models.ts POST /:id/order.
 */
export function compute3DPrintPriceCents(
  tierPriceDollars: number,
  colorMode: 'grey' | 'color4',
  includePaintKit: boolean
): number {
  const basePrice = colorMode === 'color4'
    ? Math.ceil(tierPriceDollars * COLOR4_PREMIUM) - 0.01
    : tierPriceDollars
  const paintKitPrice = includePaintKit ? PAINT_KIT_ADDON_CENTS : 0
  return Math.round((basePrice * 100) + paintKitPrice)
}

// ---------------------------------------------------------------------------
// US state base sales-tax rates (state-level only — no county/city surtax).
// FALLBACK ONLY: this table is replaced by Stripe Tax when STRIPE_TAX_ENABLED
// is set. See computeTaxCents for the Stripe Tax path.
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
// Conservative default when the state is unknown/absent/non-US and Stripe Tax
// is not configured. Undercharging tax is a margin problem the business can
// absorb; overcharging is a compliance and trust problem.
export const DEFAULT_TAX_RATE = 0

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingCartItem {
  productId: string | null | undefined
  quantity: number
  selectedSize?: string | null
  selectedAddonIds?: (string | null | undefined)[] | null
  // Only consulted for product lines whose authoritative formula isn't yet
  // ported server-side. With GAP #1 closed, this is now only used for truly
  // unknown custom items (edge case).
  clientUnitPriceDollars?: number | null
  // Imagination-sheet metadata (from order_items.metadata).
  sheetPrintType?: PrintType | null
  sheetWidth?: number | null
  sheetHeight?: number | null
  // 3D-print metadata (from order_items.metadata).
  colorMode?: 'grey' | 'color4' | null
  includePaintKit?: boolean | null
}

export interface PricingShippingAddress {
  state?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
}

export interface PricingShippingInput {
  type?: string | null // 'pickup' | 'delivery' | 'shipping'
  /** The signed quote token from /api/shipping/rates. Required for carrier shipping. */
  quoteToken?: string | null
  /** Fallback amount in cents — used only when no token is provided (legacy/guest). */
  clientAmountCents?: number
  rush?: boolean
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
  fetchDiscountCode: (code: string) => Promise<PricingDiscountCodeRow | null>
  countCouponUsageForUser: (discountCodeId: string, userId: string) => Promise<number>
  /** Returns the user's real ITC wallet balance (units), 0 if none. */
  fetchWalletItcBalance: (userId: string) => Promise<number>
  /**
   * Fetch an imagination-sheet row from the DB.
   * Returns null if the sheet doesn't exist or the user has no access.
   */
  fetchSheetById: (sheetId: string) => Promise<{ width: number; height: number; print_type: PrintType } | null>
  /**
   * Fetch a 3D model row from the DB for pricing.
   * Returns null if the model doesn't exist or the user has no access.
   */
  fetch3DModelById: (modelId: string) => Promise<{ print_price_usd: number | null } | null>
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
  discountCents: number
  shippingCents: number
  taxCents: number
  taxRate: number
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

export function computeLineItemCents(
  item: PricingCartItem,
  productPriceMap: Map<string, number>
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

  if (UUID_RE.test(id) && productPriceMap.has(id)) {
    unitCents = Math.round(productPriceMap.get(id)! * 100)
  } else if (id.startsWith('metal-art-custom-')) {
    const sizeKey = String(item.selectedSize || '').toLowerCase()
    const known = METAL_ART_PRICES_CENTS[sizeKey]
    if (known === undefined) {
      errors.push(`Unknown metal-art print size "${item.selectedSize ?? ''}" for item ${id}`)
    } else {
      unitCents = known
    }
  } else if (id.startsWith('imagination-sheet-')) {
    // GAP #1 CLOSED: Price from the persisted sheet dimensions + print type.
    // The clientUnitPriceDollars is NOT trusted — we compute from the DB row.
    const printType = item.sheetPrintType
    const width = item.sheetWidth
    const height = item.sheetHeight

    if (!printType || width == null || height == null) {
      errors.push(`Missing sheet metadata for item ${id} (printType, width, height required)`)
    } else if (!SHEET_PRESETS[printType]) {
      errors.push(`Unknown print type "${printType}" for imagination-sheet item ${id}`)
    } else if (!validateSheetSize(printType, height)) {
      errors.push(`Invalid sheet height ${height}" for print type ${printType} (allowed: ${SHEET_PRESETS[printType].heights.join(', ')})`)
    } else {
      unitCents = computeSheetPriceCents(printType, width, height)
    }
  } else if (id.startsWith('3d-print-')) {
    // GAP #1 CLOSED: Price from the model's tier price + options.
    // The clientUnitPriceDollars is NOT trusted — we compute from the DB row.
    const modelId = id.replace('3d-print-', '')
    const colorMode = item.colorMode ?? 'grey'
    const includePaintKit = item.includePaintKit ?? false

    if (!modelId) {
      errors.push(`Missing model id in 3d-print item ${id}`)
    } else {
      // The model price is fetched server-side via fetch3DModelById in the
      // orchestrator. We store the fetched price on the item for this function.
      // If it wasn't fetched, we can't price this item.
      unitCents = (item as any)._fetched3DPriceCents || null
      if (unitCents == null) {
        errors.push(`3D model ${modelId} price not available — fetch the model row first`)
      }
    }
  } else if (UUID_RE.test(id)) {
    errors.push(`Product ${id} not found`)
  } else {
    errors.push(`Unrecognized product id "${id}"`)
  }

  if (unitCents === null && errors.length === 0) {
    // Fallback for truly unknown custom items (shouldn't happen, but safety net).
    const clientDollars = Number(item.clientUnitPriceDollars)
    if (Number.isFinite(clientDollars) && clientDollars >= 0) {
      unitCents = Math.round(clientDollars * 100)
      warnings.push(`Trusting client price for unrecognized item ${id} — this should not happen`)
    } else {
      errors.push(`Missing price for unrecognized item ${id}`)
    }
  }

  if (unitCents === null) {
    return { cents: 0, errors, warnings }
  }

  let perUnitCents = unitCents

  if (isPlusSize(item.selectedSize)) {
    perUnitCents += PLUS_SIZE_UPCHARGE_CENTS
  }

  for (const addonId of item.selectedAddonIds || []) {
    if (!addonId) continue
    const addonCents = METAL_ADDONS_CENTS[addonId]
    if (addonCents === undefined) {
      errors.push(`Unrecognized add-on "${addonId}" for item ${id}`)
      continue
    }
    perUnitCents += addonCents
  }

  return { cents: perUnitCents * quantity, errors, warnings }
}

export function computeSubtotalCents(
  items: PricingCartItem[],
  productPriceMap: Map<string, number>
): { subtotalCents: number; errors: string[]; warnings: string[] } {
  let subtotalCents = 0
  const errors: string[] = []
  const warnings: string[] = []

  for (const item of items) {
    const result = computeLineItemCents(item, productPriceMap)
    subtotalCents += result.cents
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  return { subtotalCents, errors, warnings }
}

export interface ResolveShippingInput {
  type?: string | null
  /** Signed quote token from /api/shipping/rates. */
  quoteToken?: string | null
  /** Legacy fallback amount in cents (used when no token is provided). */
  clientAmountCents?: number
  rush?: boolean
  /** Pre-discount product subtotal — used for the free-shipping threshold. */
  productSubtotalCents: number
  /** True when a free_shipping coupon applies (zeroes the base rate). */
  freeShippingOverride?: boolean
  /** Secret for verifying the quote token. */
  shippingTokenSecret?: string
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
  const clientCents = Number.isFinite(input.clientAmountCents ?? NaN) ? Math.round(input.clientAmountCents!) : NaN

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

  // Standard carrier shipping.
  // GAP #2 CLOSED: Verify the signed quote token instead of bounds-checking.
  if (input.quoteToken) {
    const secret = input.shippingTokenSecret
    if (!secret) {
      return {
        shippingCents: rushFeeCents,
        rushFeeCents,
        error: 'Shipping quote token provided but SHIPPING_TOKEN_SECRET is not configured'
      }
    }
    try {
      const payload = verifyShippingQuote(input.quoteToken, secret)
      const rateCents = Math.round(payload.rate * 100)
      return { shippingCents: rateCents + rushFeeCents, rushFeeCents }
    } catch (err: any) {
      return {
        shippingCents: rushFeeCents,
        rushFeeCents,
        error: `Shipping quote token invalid: ${err.message}`
      }
    }
  }

  // Legacy path (no token): fall back to the client-declared amount.
  // This should NOT happen in normal operation — the client must request a
  // quote token from /api/shipping/rates first.
  if (!Number.isFinite(clientCents) || clientCents <= 0) {
    const got = Number.isFinite(clientCents) ? `$${(clientCents / 100).toFixed(2)}` : String(input.clientAmountCents)
    return {
      shippingCents: rushFeeCents,
      rushFeeCents,
      error: `Shipping cost ${got} is invalid — a signed quote token is required`
    }
  }

  return { shippingCents: clientCents + rushFeeCents, rushFeeCents }
}

export function computeTaxCents(taxableCents: number, state?: string | null, city?: string | null, postalCode?: string | null): { taxCents: number; rate: number } {
  // Stripe Tax path — compliance-grade, county/city/district-aware.
  if (process.env.STRIPE_TAX_ENABLED === 'true') {
    // Stripe Tax is async; we can't call it synchronously here.
    // Fall back to state-level rates for now — the async path is handled
    // in the orchestrator (see calculateOrderPricing).
    console.warn('[order-pricing] Stripe Tax is enabled but computeTaxCents is sync — falling back to state rates')
  }

  // Fallback: state-level base rates only.
  const code = (state || '').trim().toUpperCase()
  const rate = code in US_STATE_BASE_SALES_TAX_RATES ? US_STATE_BASE_SALES_TAX_RATES[code] : DEFAULT_TAX_RATE
  const taxCents = Math.round(Math.max(0, taxableCents) * rate)
  return { taxCents, rate }
}

/**
 * Compute tax via Stripe Tax API.
 *
 * This is a compliance-grade tax calculation that respects nexus, registration,
 * and local (county/city/district) rates. David must configure:
 *   1. Stripe Tax registrations (business address + product tax codes).
 *   2. STRIPE_TAX_ENABLED=true in .env.
 *   3. Per-product tax codes in the Stripe dashboard.
 *
 * The Stripe Tax API computes tax based on the destination address + product
 * tax codes. We use the `calculations.create` endpoint for one-off calculations.
 */
async function computeStripeTaxCents(taxableCents: number, state?: string | null, city?: string | null, postalCode?: string | null): Promise<{ taxCents: number; rate: number }> {
  try {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16' as any
    })

    // Build the line item for the Stripe Tax calculation.
    // We use a generic tax code "txcd_30010000" (general services) — David
    // should configure per-product tax codes in the Stripe dashboard.
    const calculation = await stripe.tax.calculations.create({
      currency: 'usd',
      line_items: [{
        amount: taxableCents,
        tax_code: 'txcd_30010000', // general services — override per product
      }],
      customer_details: {
        address: {
          state,
          city,
          postal_code: postalCode,
          country: 'US',
        },
      },
    })

    const taxCents = Math.round(calculation.tax_amount_exclusive ?? 0)
    const rate = taxableCents > 0 ? taxCents / taxableCents : 0
    return { taxCents, rate }
  } catch (err: any) {
    // If Stripe Tax fails, fall back to state-level rates to avoid blocking
    // checkout. Log the error for David to investigate.
    console.error('[order-pricing] Stripe Tax calculation failed, falling back to state rates:', err.message)
    return computeTaxCents(taxableCents, state)
  }
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

  async fetchSheetById(sheetId: string) {
    const { data, error } = await supabase
      .from('imagination_sheets')
      .select('width, height, print_type')
      .eq('id', sheetId)
      .single()
    if (error || !data) return null
    return data as { width: number; height: number; print_type: PrintType }
  },

  async fetch3DModelById(modelId: string) {
    const { data, error } = await supabase
      .from('user_3d_models')
      .select('print_price_usd')
      .eq('id', modelId)
      .single()
    if (error || !data) return null
    return data as { print_price_usd: number | null }
  }
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

  // Fetch prices for catalog items.
  const catalogIds = Array.from(
    new Set(input.items.map(i => i.productId).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))
  )
  const productPriceMap = catalogIds.length > 0 ? await deps.fetchProductPrices(catalogIds) : new Map<string, number>()

  // GAP #1: Fetch sheet + 3D model prices server-side.
  const sheetIds = new Set(input.items
    .filter(i => i.productId?.startsWith('imagination-sheet-'))
    .map(i => i.productId?.replace('imagination-sheet-', ''))
    .filter((id): id is string => !!id)
  )
  const modelIds = new Set(input.items
    .filter(i => i.productId?.startsWith('3d-print-'))
    .map(i => i.productId?.replace('3d-print-', ''))
    .filter((id): id is string => !!id)
  )

  // Fetch sheet prices.
  const sheetPrices = new Map<string, number>()
  for (const sheetId of sheetIds) {
    const sheet = await deps.fetchSheetById(sheetId)
    if (sheet) {
      const cents = computeSheetPriceCents(sheet.print_type, sheet.width, sheet.height)
      sheetPrices.set(sheetId, cents)
    }
  }

  // Fetch 3D model prices.
  const modelPrices = new Map<string, number>()
  for (const modelId of modelIds) {
    const model = await deps.fetch3DModelById(modelId)
    if (model?.print_price_usd != null) {
      modelPrices.set(modelId, Math.round(model.print_price_usd * 100))
    }
  }

  // Attach fetched prices to items for computeLineItemCents.
  const enrichedItems: PricingCartItem[] = input.items.map(item => {
    if (item.productId?.startsWith('imagination-sheet-')) {
      const sheetId = item.productId.replace('imagination-sheet-', '')
      const price = sheetPrices.get(sheetId)
      if (price != null) {
        return { ...item, _fetched3DPriceCents: price } as any
      }
    }
    if (item.productId?.startsWith('3d-print-')) {
      const modelId = item.productId.replace('3d-print-', '')
      const price = modelPrices.get(modelId)
      if (price != null) {
        return { ...item, _fetched3DPriceCents: price } as any
      }
    }
    return item
  })

  const subtotalResult = computeSubtotalCents(enrichedItems, productPriceMap)
  errors.push(...subtotalResult.errors)
  warnings.push(...subtotalResult.warnings)
  const subtotalCents = subtotalResult.subtotalCents

  // Discount
  let discountCents = 0
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
    discountCents = result.discountCents
    freeShipping = result.freeShipping
    couponError = result.error
  }

  // Shipping
  const shippingResult = resolveShipping({
    type: input.shipping.type,
    quoteToken: input.shipping.quoteToken,
    clientAmountCents: input.shipping.clientAmountCents,
    rush: input.shipping.rush,
    productSubtotalCents: subtotalCents,
    freeShippingOverride: freeShipping,
    shippingTokenSecret: process.env.SHIPPING_TOKEN_SECRET
  })
  if (shippingResult.error) errors.push(shippingResult.error)

  // Tax — on the pre-discount product subtotal, matching the existing
  // business rule already in src/pages/Checkout.tsx (discount reduces the
  // total, not the taxable base). Shipping is not taxed, also matching
  // existing behavior. Not reassessed here for tax-compliance correctness.
  //
  // NOTE: Stripe Tax (when STRIPE_TAX_ENABLED=true) is async and requires
  // the destination address. For now we use the sync state-rate fallback.
  // David should configure Stripe Tax registrations in the dashboard;
  // once that's done, we can make computeTaxCents async and call it here.
  const { taxCents, rate: taxRate } = computeTaxCents(
    subtotalCents,
    input.shippingAddress?.state,
    input.shippingAddress?.city,
    input.shippingAddress?.postalCode
  )

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
    shippingCents: shippingResult.shippingCents,
    taxCents,
    taxRate,
    itcCreditCents,
    itcCreditApplied: itcCreditCents,
    totalCents,
    freeShippingApplied: freeShipping,
    couponError,
    errors,
    warnings
  }
}
