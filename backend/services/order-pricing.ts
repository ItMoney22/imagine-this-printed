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
//   - Add-on prices (easel stand / wall mount / etc.) — from METAL_ADDONS_CENTS
//     (mirrors src/lib/product-kind.ts METAL_ADDONS).
//   - Plus-size upcharge (2XL+) — mirrors src/pages/Checkout.tsx PLUS_SIZES.
//   - Discount — re-validated against the `discount_codes` table (same rules
//     as GET /api/coupons/validate: active, not expired, usage limits, min
//     order amount, per-user limit).
//   - Tax — a server-side US state base sales-tax rate table keyed off the
//     shipping state (see US_STATE_BASE_SALES_TAX_RATES below).
//   - ITC store-credit — capped to the caller's REAL wallet balance, and only
//     honored for an authenticated userId (never a guest-supplied one).
//
// KNOWN GAPS (documented, not silently papered over — see AUDIT/FOLLOW-UPS in
// the task handoff):
//   1. Imagination-sheet (`imagination-sheet-*`) and 3D-print (`3d-print-*`)
//      custom line items have pricing formulas that live elsewhere (sheet
//      sq-inch pricing needs the persisted sheet width/height + print-type
//      presets; 3D-print pricing needs model volume/complexity) and are NOT
//      ported here. These fall back to the client-declared unit price,
//      clamped to UNVERIFIED_CUSTOM_ITEM_MAX_CENTS as a bounded stopgap —
//      tampering is capped, not eliminated. Follow-up: fetch the authoritative
//      sheet/model row server-side and price it for real.
//   2. Standard carrier shipping (USPS/UPS live quotes via Shippo) is not
//      independently re-quoted here — that would require calling Shippo from
//      this module. Instead the client-declared amount is bounds-checked
//      against MIN/MAX_CARRIER_SHIPPING_CENTS. Local pickup (always $0) and
//      local delivery (fixed $10/$15 tiers) ARE fully authoritative. Follow-up:
//      have /api/shipping/rates return a short-lived signed quote token this
//      engine can verify instead of trusting a bounded client number.
//   3. Tax uses STATE-level base rates only — no county/city surtax, no
//      nexus/registration awareness. This is an intentional interim measure;
//      wiring Stripe Tax needs David to configure tax registrations and
//      per-product tax codes in the Stripe dashboard (owner-gated), so it is
//      out of scope for this pass. The interface below is shaped so a real
//      tax provider can be dropped in later without changing callers.

import { supabase } from '../lib/supabase.js'

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

// Bounded fallback ceiling for custom line items whose real pricing formula
// isn't ported yet (see KNOWN GAP #1 above). Generous on purpose — this is an
// anti-abuse cap, not a price model.
const UNVERIFIED_CUSTOM_ITEM_MAX_CENTS = 30000 // $300/unit

// Shipping constants — mirrors src/utils/shipping-calculator.ts.
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000 // $50
export const RUSH_FEE_CENTS = 799 // $7.99
const LOCAL_DELIVERY_TIER_CENTS = [1000, 1500] // $10 / $15, mirrors LOCAL_DELIVERY_TIERS
// Standard carrier (USPS/UPS via Shippo) rates are live-quoted and not
// re-derived here (see KNOWN GAP #2) — bounded sanity band instead.
const MIN_CARRIER_SHIPPING_CENTS = 300 // $3 — below the cheapest known base rate, leaves slack
const MAX_CARRIER_SHIPPING_CENTS = 6000 // $60 — comfortably above the priciest known base rate + weight scaling

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingCartItem {
  productId: string | null | undefined
  quantity: number
  selectedSize?: string | null
  selectedAddonIds?: (string | null | undefined)[] | null
  // Only consulted for product lines whose authoritative formula isn't yet
  // ported server-side (imagination-sheet-*, 3d-print-*). See KNOWN GAP #1.
  clientUnitPriceDollars?: number | null
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
  } else if (id.startsWith('imagination-sheet-') || id.startsWith('3d-print-')) {
    // KNOWN GAP #1 — see module docstring. Bounded fallback to the
    // client-declared unit price so these product lines keep working.
    const clientDollars = Number(item.clientUnitPriceDollars)
    if (!Number.isFinite(clientDollars) || clientDollars < 0) {
      errors.push(`Missing/invalid client price for unverified item ${id}`)
    } else {
      const raw = Math.round(clientDollars * 100)
      unitCents = Math.min(raw, UNVERIFIED_CUSTOM_ITEM_MAX_CENTS)
      if (raw > UNVERIFIED_CUSTOM_ITEM_MAX_CENTS) {
        warnings.push(
          `Clamped unverified item ${id} price from $${clientDollars.toFixed(2)} to $${(UNVERIFIED_CUSTOM_ITEM_MAX_CENTS / 100).toFixed(2)}`
        )
      }
    }
  } else if (UUID_RE.test(id)) {
    errors.push(`Product ${id} not found`)
  } else {
    errors.push(`Unrecognized product id "${id}"`)
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
  clientAmountCents: number
  rush?: boolean
  /** Pre-discount product subtotal — used for the free-shipping threshold. */
  productSubtotalCents: number
  /** True when a free_shipping coupon applies (zeroes the base rate). */
  freeShippingOverride?: boolean
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
  if (input.productSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS && clientCents === 0) {
    return { shippingCents: rushFeeCents, rushFeeCents }
  }

  if (!Number.isFinite(clientCents) || clientCents < MIN_CARRIER_SHIPPING_CENTS || clientCents > MAX_CARRIER_SHIPPING_CENTS) {
    const got = Number.isFinite(clientCents) ? `$${(clientCents / 100).toFixed(2)}` : String(input.clientAmountCents)
    return {
      shippingCents: rushFeeCents,
      rushFeeCents,
      error: `Shipping cost ${got} is outside the expected carrier-rate range ($${(MIN_CARRIER_SHIPPING_CENTS / 100).toFixed(2)}-$${(MAX_CARRIER_SHIPPING_CENTS / 100).toFixed(2)})`
    }
  }

  return { shippingCents: clientCents + rushFeeCents, rushFeeCents }
}

export function computeTaxCents(taxableCents: number, state?: string | null): { taxCents: number; rate: number } {
  const code = (state || '').trim().toUpperCase()
  const rate = code in US_STATE_BASE_SALES_TAX_RATES ? US_STATE_BASE_SALES_TAX_RATES[code] : DEFAULT_TAX_RATE
  const taxCents = Math.round(Math.max(0, taxableCents) * rate)
  return { taxCents, rate }
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

  const catalogIds = Array.from(
    new Set(input.items.map(i => i.productId).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))
  )
  const productPriceMap = catalogIds.length > 0 ? await deps.fetchProductPrices(catalogIds) : new Map<string, number>()

  const subtotalResult = computeSubtotalCents(input.items, productPriceMap)
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
    clientAmountCents: input.shipping.clientAmountCents,
    rush: input.shipping.rush,
    productSubtotalCents: subtotalCents,
    freeShippingOverride: freeShipping
  })
  if (shippingResult.error) errors.push(shippingResult.error)

  // Tax — on the pre-discount product subtotal, matching the existing
  // business rule already in src/pages/Checkout.tsx (discount reduces the
  // total, not the taxable base). Shipping is not taxed, also matching
  // existing behavior. Not reassessed here for tax-compliance correctness.
  const { taxCents, rate: taxRate } = computeTaxCents(subtotalCents, input.shippingAddress?.state)

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
