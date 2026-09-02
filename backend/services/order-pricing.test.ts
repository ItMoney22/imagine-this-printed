// Tests for the server-side pricing engine that closes Watchtower task
// 9a8431d9-a8d4-4adc-8e0d-81309df38547 (client-tamperable checkout amount).
//
// The async orchestrator (`calculateOrderPricing`) takes its Supabase calls
// via injected `deps` so these tests never touch a real database.

import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load, so
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must exist BEFORE order-pricing.ts
// (which imports it) is evaluated. These tests never hit the real client —
// every case injects fake `deps` — so dummy values are fine here. A dynamic
// import after setting the env vars (rather than a static import, which ESM
// hoists ahead of any code in this file) is what makes the ordering work.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  calculateOrderPricing,
  computeDiscountFromCoupon,
  computeLineItemCents,
  computeSubtotalCents,
  computeTaxCents,
  evaluateCheckoutAmount,
  resolveShipping
} = await import('./order-pricing.js')
import type { PricingDependencies, PricingDiscountCodeRow } from './order-pricing.js'
import { signShippingQuote } from './shipping-quote.js'

const PRODUCT_A = '11111111-1111-1111-1111-111111111111'
const PRODUCT_B = '22222222-2222-2222-2222-222222222222'

function makeFakeDeps(overrides: Partial<PricingDependencies> = {}): PricingDependencies {
  return {
    fetchProductPrices: async () => new Map(),
    fetchDiscountCode: async () => null,
    countCouponUsageForUser: async () => 0,
    fetchWalletItcBalance: async () => 0,
    fetchWholesaleTier: async () => null,
    fetchCustomItemPrices: async () => new Map(),
    // Mirrors calculateTaxDefault with STRIPE_TAX_ENABLED off — the state
    // table — so every pre-existing tax-dependent assertion keeps working.
    calculateTax: async (taxableCents, address) => ({ ...computeTaxCents(taxableCents, address?.state), source: 'state_table' as const }),
    ...overrides
  }
}

describe('computeLineItemCents', () => {
  it('prices a real catalog item from the DB price map, never the client price', () => {
    const map = new Map([[PRODUCT_A, 25]]) // $25.00 in DB
    const { cents, errors } = computeLineItemCents(
      { productId: PRODUCT_A, quantity: 2, clientUnitPriceDollars: 1 }, // client claims $1
      map
    )
    expect(errors).toEqual([])
    expect(cents).toBe(5000) // 2 * $25.00, NOT 2 * $1
  })

  it('rejects a catalog-shaped id that is not found in the DB', () => {
    const { cents, errors } = computeLineItemCents({ productId: PRODUCT_A, quantity: 1 }, new Map())
    expect(cents).toBe(0)
    expect(errors[0]).toMatch(/not found/)
  })

  it('prices metal-art custom items from the known size table', () => {
    // '8x11' is a legacy alias for the real 8x10 panel (see
    // backend/shared/metal-art.ts) — still priced, at the 8x10 price.
    const { cents, errors } = computeLineItemCents(
      { productId: 'metal-art-custom-123', quantity: 1, selectedSize: '8x11', clientUnitPriceDollars: 0.01 },
      new Map()
    )
    expect(errors).toEqual([])
    expect(cents).toBe(1695) // $16.95 (David 2026-09-02), not the client's claimed penny
  })

  it('rejects an unrecognized metal-art size', () => {
    const { errors } = computeLineItemCents(
      { productId: 'metal-art-custom-123', quantity: 1, selectedSize: '99x99' },
      new Map()
    )
    expect(errors[0]).toMatch(/Unknown metal-art print size/)
  })

  it('prices known add-ons from the server catalog and rejects unknown ones', () => {
    // NOTE: '4x6' collides with the PLUS_SIZES substring match ('4X' is a
    // plus-size token) — a pre-existing bug this engine faithfully mirrors
    // for parity with the current client (see isPlusSize comment). Using
    // '8x11' here avoids that collision so this test is only about add-ons.
    const good = computeLineItemCents(
      { productId: 'metal-art-custom-1', quantity: 1, selectedSize: '8x11', selectedAddonIds: ['easel_stand'] },
      new Map()
    )
    expect(good.errors).toEqual([])
    expect(good.cents).toBe(1695 + 700) // $16.95 print + $7.00 addon

    const bad = computeLineItemCents(
      { productId: 'metal-art-custom-1', quantity: 1, selectedSize: '8x11', selectedAddonIds: ['made_up_addon'] },
      new Map()
    )
    expect(bad.errors[0]).toMatch(/Unrecognized add-on/)
  })

  it('KNOWN PRE-EXISTING BUG (mirrored for client/server parity, not introduced here): a 4x6 metal-art size false-positives the plus-size upcharge because "4X" is a PLUS_SIZES substring token', () => {
    const { cents } = computeLineItemCents({ productId: 'metal-art-custom-1', quantity: 1, selectedSize: '4x6' }, new Map())
    expect(cents).toBe(895 + 250) // matches src/pages/Checkout.tsx's current (buggy) isPlusSize behavior
  })

  it('applies the plus-size upcharge regardless of client price', () => {
    const map = new Map([[PRODUCT_A, 20]])
    const { cents } = computeLineItemCents({ productId: PRODUCT_A, quantity: 1, selectedSize: '2XL' }, map)
    expect(cents).toBe(2000 + 250)
  })

  describe('garment quality tiers (mirrors src/lib/garment-tiers.ts)', () => {
    it('adds the per-unit tier upcharge for a recognized tier', () => {
      const map = new Map([[PRODUCT_A, 20]])
      const { cents, errors } = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 2, selectedSize: 'M', selectedTier: 'premium' },
        map
      )
      expect(errors).toEqual([])
      expect(cents).toBe((2000 + 500) * 2) // $20 base + $5 Bella+Canvas, per unit
    })

    it('charges nothing extra for the standard tier and for no tier at all', () => {
      const map = new Map([[PRODUCT_A, 20]])
      const standard = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 1, selectedSize: 'M', selectedTier: 'standard' },
        map
      )
      const none = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 1, selectedSize: 'M' },
        map
      )
      expect(standard.cents).toBe(2000)
      expect(none.cents).toBe(2000)
    })

    it('hard-errors on an unrecognized tier instead of trusting it', () => {
      const map = new Map([[PRODUCT_A, 20]])
      const { errors } = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 1, selectedSize: 'M', selectedTier: 'diamond_deluxe' },
        map
      )
      expect(errors[0]).toMatch(/Unrecognized garment tier/)
    })

    it('stacks tier + plus-size upcharges per unit', () => {
      const map = new Map([[PRODUCT_A, 20]])
      const { cents } = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 1, selectedSize: '3XL', selectedTier: 'heavyweight' },
        map
      )
      expect(cents).toBe(2000 + 250 + 700) // base + plus size + Comfort Colors
    })
  })

  describe('toy add-ons (mirrors src/lib/product-kind.ts TOY_ADDONS)', () => {
    it('prices toy add-ons from the server catalog', () => {
      const map = new Map([[PRODUCT_A, 30]])
      const { cents, errors } = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 1, selectedSize: 'medium', selectedAddonIds: ['toy_paint_kit', 'toy_weapon_pack', 'toy_pet_companion', 'toy_magnet_pair'] },
        map
      )
      expect(errors).toEqual([])
      expect(cents).toBe(3000 + 1500 + 699 + 999 + 299)
    })

    it('still rejects an unknown add-on id after the toy catalog merge', () => {
      const map = new Map([[PRODUCT_A, 30]])
      const { errors } = computeLineItemCents(
        { productId: PRODUCT_A, quantity: 1, selectedSize: 'medium', selectedAddonIds: ['toy_rocket_launcher'] },
        map
      )
      expect(errors[0]).toMatch(/Unrecognized add-on/)
    })
  })

  describe('imagination-sheet / 3d-print pricing (Watchtower task 188ead33 GAP 1)', () => {
    it('prices an imagination sheet from the resolved server map, ignoring a lowball client price entirely', () => {
      const customMap = new Map([['imagination-sheet-abc', 12.34]])
      const { cents, errors } = computeLineItemCents(
        { productId: 'imagination-sheet-abc', quantity: 1, clientUnitPriceDollars: 0.01 },
        new Map(),
        customMap
      )
      expect(errors).toEqual([])
      expect(cents).toBe(1234) // $12.34 from the map, not the client's claimed penny
    })

    it('rejects an imagination sheet id that could not be resolved server-side instead of falling back to the client price', () => {
      const { cents, errors } = computeLineItemCents(
        { productId: 'imagination-sheet-does-not-exist', quantity: 1, clientUnitPriceDollars: 500 },
        new Map(),
        new Map() // resolver found nothing for this id
      )
      expect(cents).toBe(0)
      expect(errors[0]).toMatch(/could not be priced/)
    })

    it('prices a grey 3D print at the DB tier price with no premium/paint-kit', () => {
      const customMap = new Map([['3d-print-m1', 25]])
      const { cents, errors } = computeLineItemCents(
        { productId: '3d-print-m1', quantity: 1, clientUnitPriceDollars: 1 },
        new Map(),
        customMap
      )
      expect(errors).toEqual([])
      expect(cents).toBe(2500) // $25.00 from the DB tier price
    })

    it('applies the paint-kit add-on for grey mode', () => {
      const customMap = new Map([['3d-print-m1', 25]])
      const { cents } = computeLineItemCents(
        { productId: '3d-print-m1', quantity: 1, metadata: { include_paint_kit: true } },
        new Map(),
        customMap
      )
      expect(cents).toBe(2500 + 1500) // $25 base + $15 paint kit
    })

    it('applies the color4 30% premium (ceil, minus a cent) and drops the paint kit even if requested', () => {
      const customMap = new Map([['3d-print-m1', 25]])
      const { cents } = computeLineItemCents(
        { productId: '3d-print-m1', quantity: 1, metadata: { color_mode: 'color4', include_paint_kit: true } },
        new Map(),
        customMap
      )
      // Math.ceil(25 * 1.3) - 0.01 = 33 - 0.01 = $32.99 — mirrors
      // backend/routes/3d-models.ts POST /:id/order exactly. Paint kit only
      // applies to grey mode, so it's NOT added here even though requested.
      expect(cents).toBe(3299)
    })

    it('rejects a 3d-print id that could not be resolved (model not found / not ready)', () => {
      const { cents, errors } = computeLineItemCents(
        { productId: '3d-print-does-not-exist', quantity: 1, clientUnitPriceDollars: 500 },
        new Map(),
        new Map()
      )
      expect(cents).toBe(0)
      expect(errors[0]).toMatch(/not found, not ready, or could not be priced/)
    })
  })
})

describe('computeSubtotalCents — "2 for $25" bundle (GAP 4, mirrors CartContext.calculateTotal)', () => {
  // A bundle-eligible product's own catalog price is irrelevant to the base
  // charge (see order-pricing.ts comment) — every case here uses a
  // deliberately weird price ($9.00) to prove that.
  const eligibleMap = new Map([[PRODUCT_A, 9], [PRODUCT_B, 9]])

  it('charges nothing extra for zero eligible items — a plain non-eligible cart prices as before', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 2 }],
      new Map([[PRODUCT_A, 20]])
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(4000)
  })

  it('charges a single eligible item the full $25, same as CartContext', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 1, isThreeForTwentyFive: true }],
      eligibleMap
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(2500)
  })

  it('charges exactly $25 for 2 eligible units', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 2, isThreeForTwentyFive: true }],
      eligibleMap
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(2500)
  })

  it('charges one bundle plus one full-price leftover for 3 eligible units', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 3, isThreeForTwentyFive: true }],
      eligibleMap
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(2500 + 2500)
  })

  it('charges two full bundles for 4 eligible units', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 4, isThreeForTwentyFive: true }],
      eligibleMap
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(5000)
  })

  it('pools eligible quantity ACROSS separate cart lines, not per line', () => {
    // 1 + 1 across two different products = 2 pooled units = one $25 bundle,
    // not two separate $25 singles ($50). This is the exact bug GAP 4 closes.
    const { subtotalCents, errors } = computeSubtotalCents(
      [
        { productId: PRODUCT_A, quantity: 1, isThreeForTwentyFive: true },
        { productId: PRODUCT_B, quantity: 1, metadata: { isThreeForTwentyFive: true } }
      ],
      eligibleMap
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(2500)
  })

  it('prices a mixed cart: bundle-eligible items pooled, non-eligible items priced normally', () => {
    const map = new Map([[PRODUCT_A, 9], [PRODUCT_B, 40]])
    const { subtotalCents, errors } = computeSubtotalCents(
      [
        { productId: PRODUCT_A, quantity: 3, isThreeForTwentyFive: true }, // pooled: $50
        { productId: PRODUCT_B, quantity: 1 } // normal: $40.00
      ],
      map
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(5000 + 4000)
  })

  it('still applies plus-size/tier/add-on extras per unit on top of the pooled bundle base', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 2, isThreeForTwentyFive: true, selectedSize: '2XL', selectedTier: 'premium' }],
      eligibleMap
    )
    expect(errors).toEqual([])
    // Base: 2 units = one $25 bundle. Extras: (plus-size $2.50 + tier $5.00) * 2 units.
    expect(subtotalCents).toBe(2500 + (250 + 500) * 2)
  })

  it('errors on a bundle-eligible id that does not resolve to a real catalog product', () => {
    const { errors } = computeSubtotalCents(
      [{ productId: 'not-a-real-id', quantity: 2, isThreeForTwentyFive: true }],
      new Map()
    )
    expect(errors[0]).toMatch(/Unrecognized product id/)
  })

  it('errors on a bundle-eligible UUID missing from the price map, same as a normal item', () => {
    const { errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 2, isThreeForTwentyFive: true }],
      new Map() // PRODUCT_A not in the map
    )
    expect(errors[0]).toMatch(/not found/)
  })

  it('is eligible via metadata.isThreeForTwentyFive alone, same as the top-level flag', () => {
    const { subtotalCents, errors } = computeSubtotalCents(
      [{ productId: PRODUCT_A, quantity: 2, metadata: { isThreeForTwentyFive: true } }],
      eligibleMap
    )
    expect(errors).toEqual([])
    expect(subtotalCents).toBe(2500)
  })
})

describe('resolveShipping', () => {
  it('forces pickup to $0 even if the client claims a nonzero fee', () => {
    const result = resolveShipping({ type: 'pickup', clientAmountCents: 999, productSubtotalCents: 100 })
    expect(result.shippingCents).toBe(0)
  })

  it('rejects a spoofed $0 local-delivery fee', () => {
    const result = resolveShipping({ type: 'delivery', clientAmountCents: 0, productSubtotalCents: 100 })
    expect(result.error).toMatch(/Local delivery fee must be/)
  })

  it('accepts a local-delivery fee matching a known tier', () => {
    const result = resolveShipping({ type: 'delivery', clientAmountCents: 1000, productSubtotalCents: 100 })
    expect(result.error).toBeUndefined()
    expect(result.shippingCents).toBe(1000)
  })

  it('allows $0 standard shipping once the free-shipping threshold is met', () => {
    const result = resolveShipping({ type: 'shipping', clientAmountCents: 0, productSubtotalCents: 6000 })
    expect(result.error).toBeUndefined()
    expect(result.shippingCents).toBe(0)
  })

  it('allows free shipping regardless of a stale/tampered clientAmountCents once the threshold is met', () => {
    // Strictly more authoritative than before: the OLD code trusted a
    // client-sent 0 to grant free shipping and fell through to the bounds
    // check on anything else. The server-computed subtotal decides now.
    const result = resolveShipping({ type: 'shipping', clientAmountCents: 12345, productSubtotalCents: 6000 })
    expect(result.error).toBeUndefined()
    expect(result.shippingCents).toBe(0)
  })

  describe('signed carrier shipping quotes (Watchtower task 188ead33 GAP 2)', () => {
    const destinationZip = '30153'
    const cartWeightLb = 2

    function validToken(amountCents = 1299) {
      return signShippingQuote({ amountCents, carrier: 'USPS', service: 'Ground Advantage', weightLb: cartWeightLb, destinationZip })
    }

    it('charges the AMOUNT INSIDE A VALID TOKEN, ignoring whatever the client sent', () => {
      const result = resolveShipping({
        type: 'shipping',
        clientAmountCents: 1, // client lowballs — irrelevant, the token wins
        productSubtotalCents: 1000,
        shippingQuoteToken: validToken(1299),
        cartWeightLb,
        destinationZip
      })
      expect(result.error).toBeUndefined()
      expect(result.shippingCents).toBe(1299)
    })

    it('rejects standard shipping with no quote token instead of falling back to a bounds check', () => {
      const result = resolveShipping({ type: 'shipping', clientAmountCents: 1299, productSubtotalCents: 1000, cartWeightLb, destinationZip })
      expect(result.error).toMatch(/reselect a shipping option/i)
      expect(result.shippingCents).toBe(0)
    })

    it('THE DELIVERABLE: rejects a token whose amount was tampered with after signing', () => {
      const token = validToken(1299)
      const [payload, signature] = token.split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      // Attacker edits the amount down to a penny and re-encodes the payload,
      // but keeps the OLD signature — it no longer matches.
      const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, amountCents: 1 }), 'utf8').toString('base64url')
      const tamperedToken = `${tamperedPayload}.${signature}`

      const result = resolveShipping({
        type: 'shipping',
        clientAmountCents: 1,
        productSubtotalCents: 1000,
        shippingQuoteToken: tamperedToken,
        cartWeightLb,
        destinationZip
      })
      expect(result.error).toMatch(/signature invalid/i)
      expect(result.shippingCents).toBe(0) // rejected quote charges nothing — checkout must 400, never undercharge
    })

    it('rejects a quote reused against a materially heavier cart than it was minted for', () => {
      const token = signShippingQuote({ amountCents: 500, carrier: 'USPS', service: 'Ground', weightLb: 0.5, destinationZip })
      const result = resolveShipping({
        type: 'shipping', clientAmountCents: 500, productSubtotalCents: 1000,
        shippingQuoteToken: token, cartWeightLb: 20, destinationZip
      })
      expect(result.error).toMatch(/does not match the current cart/i)
    })

    it('rejects an expired quote', () => {
      const token = signShippingQuote({ amountCents: 500, carrier: 'USPS', service: 'Ground', weightLb: cartWeightLb, destinationZip }, -1)
      const result = resolveShipping({
        type: 'shipping', clientAmountCents: 500, productSubtotalCents: 1000,
        shippingQuoteToken: token, cartWeightLb, destinationZip
      })
      expect(result.error).toMatch(/expired/i)
    })

    it('no longer caps a legitimate high shipping quote at $60 — the old sanity band is gone', () => {
      const result = resolveShipping({
        type: 'shipping', clientAmountCents: 8500, productSubtotalCents: 1000,
        shippingQuoteToken: validToken(8500), cartWeightLb, destinationZip
      })
      expect(result.error).toBeUndefined()
      expect(result.shippingCents).toBe(8500) // $85 — would have hard-failed under the old $60 cap
    })
  })

  it('adds the fixed rush fee for pickup/delivery and ignores a client rush claim on standard shipping', () => {
    const pickupRush = resolveShipping({ type: 'pickup', clientAmountCents: 0, rush: true, productSubtotalCents: 100 })
    expect(pickupRush.shippingCents).toBe(799)

    const standardRush = resolveShipping({ type: 'shipping', clientAmountCents: 700, rush: true, productSubtotalCents: 100 })
    expect(standardRush.rushFeeCents).toBe(0) // not rush-eligible per business rule
  })
})

describe('computeTaxCents', () => {
  it('varies by shipping state', () => {
    expect(computeTaxCents(10000, 'CA').taxCents).toBe(725) // 7.25%
    expect(computeTaxCents(10000, 'OR').taxCents).toBe(0) // Oregon has no sales tax
    expect(computeTaxCents(10000, 'TX').taxCents).toBe(625) // 6.25%
  })

  it('defaults to 0 for an unknown or missing state', () => {
    expect(computeTaxCents(10000, undefined).taxCents).toBe(0)
    expect(computeTaxCents(10000, 'ZZ').taxCents).toBe(0)
  })
})

describe('computeDiscountFromCoupon', () => {
  const baseCoupon: PricingDiscountCodeRow = {
    id: 'coupon-1',
    code: 'SAVE10',
    type: 'percentage',
    value: 10,
    is_active: true,
    expires_at: null,
    max_uses: null,
    current_uses: null,
    min_order_amount: null,
    max_discount_amount: null,
    per_user_limit: null
  }

  it('computes a percentage discount and never trusts a client-supplied number', () => {
    const result = computeDiscountFromCoupon(baseCoupon, 6000, 0)
    expect(result.discountCents).toBe(600)
  })

  it('caps a percentage discount at max_discount_amount', () => {
    const result = computeDiscountFromCoupon({ ...baseCoupon, value: 50, max_discount_amount: 5 }, 6000, 0)
    expect(result.discountCents).toBe(500)
  })

  it('rejects an expired coupon', () => {
    const result = computeDiscountFromCoupon({ ...baseCoupon, expires_at: '2020-01-01' }, 6000, 0)
    expect(result.discountCents).toBe(0)
    expect(result.error).toMatch(/expired/)
  })

  it('rejects a coupon below its minimum order amount', () => {
    const result = computeDiscountFromCoupon({ ...baseCoupon, min_order_amount: 100 }, 5000, 0)
    expect(result.error).toMatch(/Minimum order amount/)
  })

  it('rejects when the per-user limit is already reached', () => {
    const result = computeDiscountFromCoupon({ ...baseCoupon, per_user_limit: 1 }, 6000, 1)
    expect(result.error).toMatch(/already used/)
  })

  it('flags free_shipping coupons without a cash discount', () => {
    const result = computeDiscountFromCoupon({ ...baseCoupon, type: 'free_shipping', value: 0 }, 6000, 0)
    expect(result.discountCents).toBe(0)
    expect(result.freeShipping).toBe(true)
  })

  it('treats an invalid/unknown code as no discount', () => {
    const result = computeDiscountFromCoupon(null, 6000, 0)
    expect(result.discountCents).toBe(0)
    expect(result.error).toMatch(/Invalid coupon/)
  })
})

describe('evaluateCheckoutAmount', () => {
  it('rejects a tampered low amount ($1 for a $500 cart)', () => {
    const result = evaluateCheckoutAmount(100, 50000)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/expected \$500\.00/)
    expect(result.error).toMatch(/got \$1\.00/)
  })

  it('accepts an honest amount within the 1-cent rounding tolerance', () => {
    expect(evaluateCheckoutAmount(5835, 5835).ok).toBe(true)
    expect(evaluateCheckoutAmount(5834, 5835).ok).toBe(true) // 1 cent of rounding slack
  })

  it('rejects anything more than 1 cent off', () => {
    expect(evaluateCheckoutAmount(5833, 5835).ok).toBe(false)
  })
})

describe('calculateOrderPricing (end-to-end, injected deps)', () => {
  it('prices a legitimate cart correctly end-to-end', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () =>
        new Map([
          [PRODUCT_A, 25], // $25.00
          [PRODUCT_B, 10] // $10.00
        ]),
      fetchDiscountCode: async code =>
        code === 'SAVE10'
          ? {
              id: 'coupon-1',
              code: 'SAVE10',
              type: 'percentage',
              value: 10,
              is_active: true,
              expires_at: null,
              max_uses: null,
              current_uses: null,
              min_order_amount: null,
              max_discount_amount: null,
              per_user_limit: null
            }
          : null
    })

    const result = await calculateOrderPricing(
      {
        items: [
          { productId: PRODUCT_A, quantity: 2 }, // $50.00
          { productId: PRODUCT_B, quantity: 1 } // $10.00
        ],
        shippingAddress: { state: 'CA' },
        shipping: { type: 'shipping', clientAmountCents: 0 }, // subtotal clears free-shipping threshold
        couponCode: 'SAVE10',
        userId: null
      },
      deps
    )

    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(6000)
    expect(result.discountCents).toBe(600)
    expect(result.shippingCents).toBe(0)
    expect(result.taxCents).toBe(435) // 7.25% of the $60 pre-discount subtotal
    expect(result.taxRate).toBeCloseTo(0.0725)
    expect(result.totalCents).toBe(5835)

    // An honest client whose own math landed on the same total sails through.
    expect(evaluateCheckoutAmount(5835, result.totalCents).ok).toBe(true)
  })

  it('rejects a tampered low `amount` for a real cart (the reported exploit)', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 500]]) // $500.00 item
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' }, // 0% tax, keeps the math simple
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )

    expect(result.errors).toEqual([])
    expect(result.totalCents).toBe(50000) // $500.00, from the DB — not the client

    // Buyer submits amount: 100 ($1.00) — the exact scenario from the audit.
    const check = evaluateCheckoutAmount(100, result.totalCents)
    expect(check.ok).toBe(false)
    expect(check.error).toMatch(/\$500\.00/)
  })

  it('ignores a client-claimed discount for an invalid coupon code', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]),
      fetchDiscountCode: async () => null // no such coupon on the server
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        couponCode: 'TOTALLY-MADE-UP',
        userId: null
      },
      deps
    )

    expect(result.discountCents).toBe(0)
    expect(result.couponError).toMatch(/Invalid coupon/)
    expect(result.totalCents).toBe(10000) // full $100, no discount applied
  })

  it('caps ITC store credit to the real wallet balance and ignores guest requests', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]),
      fetchWalletItcBalance: async () => 500 // real balance: 500 ITC = $5.00
    })

    const authed = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: 'user-1',
        itcCreditRequested: 999999 // claims far more than the real balance
      },
      deps
    )
    expect(authed.itcCreditApplied).toBe(500) // capped to the real balance, not the claim
    expect(authed.totalCents).toBe(10000 - 500)

    const guest = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null, // unauthenticated
        itcCreditRequested: 999999
      },
      deps
    )
    expect(guest.itcCreditApplied).toBe(0)
    expect(guest.totalCents).toBe(10000)
  })

  it('surfaces pricing errors for unrecognized products instead of silently trusting the client', async () => {
    const deps = makeFakeDeps({ fetchProductPrices: async () => new Map() })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: 'not-a-real-id', quantity: 1, clientUnitPriceDollars: 500 }],
        shipping: { type: 'shipping', clientAmountCents: 700 },
        userId: null
      },
      deps
    )

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/Unrecognized product id/)
  })
})

// Watchtower task 0af32316 — wholesale tiered pricing must be server-
// authoritative, same precedent as the checkout hardening above: the tier is
// resolved from fetchWholesaleTier (a stand-in for the real user_profiles
// lookup), never a client-supplied tier or role.
describe('wholesale tier discount', () => {
  it('applies the tier discount rate to the product subtotal for an approved wholesale account', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]), // $100
      fetchWholesaleTier: async () => 'gold' // 35% off, see WHOLESALE_TIER_DISCOUNT_RATES
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' }, // 0% tax
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: 'wholesale-user-1'
      },
      deps
    )

    expect(result.wholesaleTier).toBe('gold')
    expect(result.wholesaleDiscountCents).toBe(3500) // 35% of $100.00
    expect(result.discountCents).toBe(3500)
    expect(result.totalCents).toBe(6500) // $65.00
  })

  it('never resolves a wholesale tier for a guest, no matter what the client claims', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]),
      // If this were ever called for a guest, the test should fail loudly —
      // fetchWholesaleTier must only be reachable via a real userId.
      fetchWholesaleTier: async () => 'platinum'
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null // guest
      },
      deps
    )

    expect(result.wholesaleTier).toBeNull()
    expect(result.wholesaleDiscountCents).toBe(0)
    expect(result.totalCents).toBe(10000) // full $100, no discount
  })

  it('stacks a coupon and a wholesale discount but caps the combined total at the subtotal', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]),
      fetchWholesaleTier: async () => 'platinum', // 45% off = $45
      fetchDiscountCode: async () => ({
        id: 'coupon-1',
        code: 'HUGE',
        type: 'percentage',
        value: 90, // 90% off = $90 — combined with wholesale this would exceed the subtotal
        is_active: true,
        expires_at: null,
        max_uses: null,
        current_uses: null,
        min_order_amount: null,
        max_discount_amount: null,
        per_user_limit: null
      } as PricingDiscountCodeRow)
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        couponCode: 'HUGE',
        userId: 'wholesale-user-1'
      },
      deps
    )

    expect(result.couponDiscountCents).toBe(9000)
    expect(result.wholesaleDiscountCents).toBe(4500)
    expect(result.discountCents).toBe(10000) // capped to the $100 subtotal, not $135
    expect(result.totalCents).toBe(0)
  })

  it('does not discount a wholesale-role user whose application is still pending', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]),
      // fetchWholesaleTier's real implementation returns null unless
      // wholesale_status === 'approved' — a pending applicant gets no
      // discount, which this fake stands in for.
      fetchWholesaleTier: async () => null
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: 'pending-applicant-1'
      },
      deps
    )

    expect(result.wholesaleTier).toBeNull()
    expect(result.totalCents).toBe(10000)
  })
})

// Watchtower task 188ead33 — end-to-end proof that the checkout orchestrator
// actually wires the signed shipping quote and the custom-item price
// resolver through, not just the unit-level pure functions above.
describe('calculateOrderPricing — GAP 1 + GAP 2 end-to-end', () => {
  it('prices a cart with a real product AND an imagination sheet, and charges the signed shipping quote — never any client-declared number', async () => {
    const zip = '30153'
    const token = signShippingQuote({ amountCents: 999, carrier: 'USPS', service: 'Ground Advantage', weightLb: 1, destinationZip: zip })
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 20]]), // $20
      fetchCustomItemPrices: async () => new Map([['imagination-sheet-s1', 9.5]]) // $9.50
    })

    const result = await calculateOrderPricing(
      {
        items: [
          { productId: PRODUCT_A, quantity: 1, clientUnitPriceDollars: 20, weight: 0.5 },
          { productId: 'imagination-sheet-s1', quantity: 1, clientUnitPriceDollars: 0.01, weight: 0.5 } // client lowballs its own custom item
        ],
        shippingAddress: { state: 'OR', postalCode: zip }, // 0% tax, keeps the math simple
        shipping: { type: 'shipping', clientAmountCents: 1, shippingQuoteToken: token }, // client also lowballs shipping
        userId: null
      },
      deps
    )

    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(2000 + 950) // real DB price + real sheet price, not the client's pennies
    expect(result.shippingCents).toBe(999) // from the signed token, not clientAmountCents: 1
    expect(result.totalCents).toBe(2000 + 950 + 999)
  })

  it('400s (via a non-empty errors array) when the shipping quote token is missing for standard carrier shipping', async () => {
    const deps = makeFakeDeps({ fetchProductPrices: async () => new Map([[PRODUCT_A, 20]]) })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'OR', postalCode: '30153' },
        shipping: { type: 'shipping', clientAmountCents: 999 }, // no shippingQuoteToken
        userId: null
      },
      deps
    )

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/reselect a shipping option/i)
  })

  it('honors whatever deps.calculateTax returns (proves the Stripe Tax seam is wired, without calling Stripe)', async () => {
    const deps = makeFakeDeps({
      fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]),
      calculateTax: async () => ({ taxCents: 777, rate: 0.0777, source: 'stripe_tax' as const })
    })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'CA' }, // would be 725 via the state table — proves the override, not the table, won
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )

    expect(result.taxCents).toBe(777)
    expect(result.taxSource).toBe('stripe_tax')
    expect(result.totalCents).toBe(10000 + 777)
  })

  it('defaults to the state-rate table (taxSource state_table) when Stripe Tax is not enabled', async () => {
    const deps = makeFakeDeps({ fetchProductPrices: async () => new Map([[PRODUCT_A, 100]]) })

    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        shippingAddress: { state: 'CA' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )

    expect(result.taxSource).toBe('state_table')
    expect(result.taxCents).toBe(725)
  })
})

describe('calculateOrderPricing — "2 for $25" bundle end-to-end (GAP 4, Watchtower row 54405e88)', () => {
  // Before this, calculateOrderPricing had NO bundle logic at all — a
  // bundle-eligible cart was charged full price at checkout regardless of
  // what CartContext.tsx advertised. These prove the server total now
  // matches what the cart itself would compute for the same cart, for the
  // full 1/2/3/4-eligible + mixed matrix.
  const deps = makeFakeDeps({ fetchProductPrices: async () => new Map([[PRODUCT_A, 9], [PRODUCT_B, 40]]) })

  it('1 eligible tee: full $25, matches CartContext', async () => {
    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 1, isThreeForTwentyFive: true }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )
    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(2500)
  })

  it('2 eligible tees: one bundle, $25 total', async () => {
    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 2, isThreeForTwentyFive: true }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )
    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(2500)
  })

  it('3 eligible tees: one bundle + one full-price single, $50 total', async () => {
    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 3, isThreeForTwentyFive: true }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )
    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(5000)
  })

  it('4 eligible tees: two bundles, $50 total', async () => {
    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 4, isThreeForTwentyFive: true }],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )
    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(5000)
  })

  it('mixed cart: 2 eligible tees bundled ($25) + 1 non-eligible item at its real catalog price ($40)', async () => {
    const result = await calculateOrderPricing(
      {
        items: [
          { productId: PRODUCT_A, quantity: 2, isThreeForTwentyFive: true },
          { productId: PRODUCT_B, quantity: 1 }
        ],
        shippingAddress: { state: 'OR' },
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )
    expect(result.errors).toEqual([])
    expect(result.productSubtotalCents).toBe(2500 + 4000)
    expect(result.totalCents).toBe(6500)
  })

  it('the anti-tampering gate still catches a client total that ignores the bundle discount', async () => {
    const result = await calculateOrderPricing(
      {
        items: [{ productId: PRODUCT_A, quantity: 2, isThreeForTwentyFive: true }],
        shippingAddress: { state: 'OR' }, // 0% tax, keeps the math simple
        shipping: { type: 'pickup', clientAmountCents: 0 },
        userId: null
      },
      deps
    )
    expect(result.totalCents).toBe(2500)

    // Client naively sent 2 * $9.00 = $18.00, ignoring the $25 bundle floor —
    // still rejected by evaluateCheckoutAmount even though it's LESS than
    // the server total, same posture as any other mismatch.
    const check = evaluateCheckoutAmount(1800, result.totalCents)
    expect(check.ok).toBe(false)
  })
})
