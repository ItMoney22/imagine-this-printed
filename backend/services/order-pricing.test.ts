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
  computeTaxCents,
  evaluateCheckoutAmount,
  resolveShipping
} = await import('./order-pricing.js')
import type { PricingDependencies, PricingDiscountCodeRow } from './order-pricing.js'

const PRODUCT_A = '11111111-1111-1111-1111-111111111111'
const PRODUCT_B = '22222222-2222-2222-2222-222222222222'

function makeFakeDeps(overrides: Partial<PricingDependencies> = {}): PricingDependencies {
  return {
    fetchProductPrices: async () => new Map(),
    fetchDiscountCode: async () => null,
    countCouponUsageForUser: async () => 0,
    fetchWalletItcBalance: async () => 0,
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
    const { cents, errors } = computeLineItemCents(
      { productId: 'metal-art-custom-123', quantity: 1, selectedSize: '8x11', clientUnitPriceDollars: 0.01 },
      new Map()
    )
    expect(errors).toEqual([])
    expect(cents).toBe(2999) // $29.99, not the client's claimed penny
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
    expect(good.cents).toBe(2999 + 700) // $29.99 print + $7.00 addon

    const bad = computeLineItemCents(
      { productId: 'metal-art-custom-1', quantity: 1, selectedSize: '8x11', selectedAddonIds: ['made_up_addon'] },
      new Map()
    )
    expect(bad.errors[0]).toMatch(/Unrecognized add-on/)
  })

  it('KNOWN PRE-EXISTING BUG (mirrored for client/server parity, not introduced here): a 4x6 metal-art size false-positives the plus-size upcharge because "4X" is a PLUS_SIZES substring token', () => {
    const { cents } = computeLineItemCents({ productId: 'metal-art-custom-1', quantity: 1, selectedSize: '4x6' }, new Map())
    expect(cents).toBe(1499 + 250) // matches src/pages/Checkout.tsx's current (buggy) isPlusSize behavior
  })

  it('applies the plus-size upcharge regardless of client price', () => {
    const map = new Map([[PRODUCT_A, 20]])
    const { cents } = computeLineItemCents({ productId: PRODUCT_A, quantity: 1, selectedSize: '2XL' }, map)
    expect(cents).toBe(2000 + 250)
  })

  it('clamps unverified custom-item (imagination-sheet / 3d-print) prices to the safety ceiling', () => {
    const { cents, warnings, errors } = computeLineItemCents(
      { productId: 'imagination-sheet-abc', quantity: 1, clientUnitPriceDollars: 99999 },
      new Map()
    )
    expect(errors).toEqual([])
    expect(cents).toBe(30000) // clamped to $300
    expect(warnings[0]).toMatch(/Clamped/)
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

  it('rejects standard shipping outside the plausible carrier-rate band', () => {
    const tooLow = resolveShipping({ type: 'shipping', clientAmountCents: 0, productSubtotalCents: 1000 })
    expect(tooLow.error).toMatch(/outside the expected carrier-rate range/)

    const tooHigh = resolveShipping({ type: 'shipping', clientAmountCents: 99999, productSubtotalCents: 1000 })
    expect(tooHigh.error).toMatch(/outside the expected carrier-rate range/)
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
