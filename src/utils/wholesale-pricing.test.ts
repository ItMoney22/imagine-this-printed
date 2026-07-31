// Wholesale tier + bulk pricing. These numbers are what a B2B customer is
// actually invoiced, so every assertion here is a concrete dollar figure derived
// by hand from the rules in wholesale-pricing.ts — a wrong tier percentage, a
// wrong bulk break, or a free-shipping credit applied to the wrong tier is a
// real money bug, not a style nit.

import { describe, it, expect } from 'vitest'
import {
  WholesalePricingCalculator,
  PricingDisplayUtils,
  wholesalePricingCalculator
} from './wholesale-pricing'
import type { WholesaleProduct } from '../types'

const calc = new WholesalePricingCalculator()

// Retail $20. Tier prices deliberately differ per tier and each tier has its own
// MOQ so "below minimum" and "next tier" behaviour can be told apart.
function makeProduct(over: Partial<WholesaleProduct> = {}): WholesaleProduct {
  return {
    id: 'wp_1',
    name: 'DTF Transfer 11x17',
    description: 'test fixture',
    retailPrice: 20,
    wholesalePricing: [
      { tier: 'bronze', price: 17, minimumQuantity: 10 },
      { tier: 'silver', price: 15, minimumQuantity: 25 },
      { tier: 'gold', price: 13, minimumQuantity: 50 },
      { tier: 'platinum', price: 11, minimumQuantity: 100 }
    ],
    images: [],
    category: 'dtf-transfers',
    inStock: true,
    minimumOrderQuantity: 5,
    leadTime: 3,
    specifications: [],
    bulkDiscounts: [
      { minimumQuantity: 50, discountPercentage: 5, description: '5% off 50+' },
      { minimumQuantity: 100, discountPercentage: 12, description: '12% off 100+' }
    ],
    customizationOptions: [],
    ...over
  }
}

describe('tier catalog — the published wholesale terms', () => {
  it('carries the exact discount, payment terms and credit limit per tier', () => {
    // These four rows ARE the wholesale program. Changing one silently
    // re-prices every B2B account, so they are pinned.
    expect(calc.getTierInfo('bronze')).toMatchObject({
      minimumOrderValue: 500, discountPercentage: 0.15, paymentTerms: 15, creditLimit: 5000
    })
    expect(calc.getTierInfo('silver')).toMatchObject({
      minimumOrderValue: 1000, discountPercentage: 0.25, paymentTerms: 30, creditLimit: 15000
    })
    expect(calc.getTierInfo('gold')).toMatchObject({
      minimumOrderValue: 2500, discountPercentage: 0.35, paymentTerms: 45, creditLimit: 35000
    })
    expect(calc.getTierInfo('platinum')).toMatchObject({
      minimumOrderValue: 5000, discountPercentage: 0.45, paymentTerms: 60, creditLimit: 75000
    })
  })

  it('exposes exactly four tiers in ascending order of entry cost', () => {
    const tiers = calc.getAllTiers()
    expect(tiers.map(t => t.id)).toEqual(['bronze', 'silver', 'gold', 'platinum'])
    const mins = tiers.map(t => t.minimumOrderValue)
    expect([...mins].sort((a, b) => a - b)).toEqual(mins)
  })

  it('ships a ready-made singleton so callers share one tier table', () => {
    expect(wholesalePricingCalculator.getTierInfo('gold').discountPercentage).toBe(0.35)
  })
})

describe('calculateProductPricing — minimum order quantity gate', () => {
  it('charges full RETAIL below the tier minimum, with zero savings', () => {
    // Silver MOQ is 25. One unit short must NOT get the $15 silver price.
    const p = calc.calculateProductPricing(makeProduct(), 24, 'silver')
    expect(p.tierPrice).toBe(20)
    expect(p.finalPrice).toBe(20)
    expect(p.savingsAmount).toBe(0)
    expect(p.savingsPercentage).toBe(0)
    expect(p.bulkDiscountAmount).toBe(0)
  })

  it('tells the shopper the quantity and price that unlock the tier', () => {
    const p = calc.calculateProductPricing(makeProduct(), 24, 'silver')
    expect(p.minimumQuantity).toBe(25)
    expect(p.nextTierQuantity).toBe(25)
    expect(p.nextTierPrice).toBe(15)
  })

  it('applies the tier price at exactly the minimum, not one unit later', () => {
    const p = calc.calculateProductPricing(makeProduct(), 25, 'silver')
    expect(p.tierPrice).toBe(15)
    expect(p.finalPrice).toBe(15)
    expect(p.savingsAmount).toBe(5)
    expect(p.savingsPercentage).toBe(25)
  })

  it('falls back to the product MOQ and retail price when the tier has no price row', () => {
    const p = calc.calculateProductPricing(makeProduct({ wholesalePricing: [] }), 100, 'gold')
    expect(p.minimumQuantity).toBe(5) // product.minimumOrderQuantity
    expect(p.tierPrice).toBe(20)      // no tier row -> retail
    expect(p.nextTierQuantity).toBeUndefined()
  })
})

describe('calculateProductPricing — bulk breaks', () => {
  it('picks the BEST applicable bulk break, not the first one that matches', () => {
    // 120 units clears both the 50+ (5%) and 100+ (12%) breaks. 12% must win.
    const p = calc.calculateProductPricing(makeProduct(), 120, 'gold')
    expect(p.volumeDiscount?.discountPercentage).toBe(12)
    expect(p.bulkDiscountAmount).toBeCloseTo(1.56, 6) // 13 * 12%
    expect(p.finalPrice).toBeCloseTo(11.44, 6)
    expect(p.savingsAmount).toBeCloseTo(8.56, 6)
    expect(p.savingsPercentage).toBeCloseTo(42.8, 6)
  })

  it('ignores bulk breaks the order has not reached', () => {
    const p = calc.calculateProductPricing(makeProduct(), 30, 'silver')
    expect(p.volumeDiscount).toBeUndefined()
    expect(p.bulkDiscountAmount).toBe(0)
    expect(p.finalPrice).toBe(15)
  })

  it('reports the NEXT tier up so the buyer can see the upgrade, and nothing above platinum', () => {
    const gold = calc.calculateProductPricing(makeProduct(), 60, 'gold')
    expect(gold.nextTierQuantity).toBe(100)
    expect(gold.nextTierPrice).toBe(11)

    const platinum = calc.calculateProductPricing(makeProduct(), 120, 'platinum')
    expect(platinum.nextTierQuantity).toBeUndefined()
    expect(platinum.nextTierPrice).toBeUndefined()
  })
})

describe('calculateOrderPricing — invoice totals', () => {
  it('bills subtotal at retail and books tier + bulk savings separately', () => {
    // gold, 100 units: tier $13, best bulk 12% -> $1.56/unit -> final $11.44
    const order = calc.calculateOrderPricing([{ product: makeProduct(), quantity: 100 }], 'gold')
    expect(order.subtotal).toBe(2000)                    // 20 retail * 100
    expect(order.tierDiscount).toBe(700)                 // (20 - 13) * 100
    expect(order.bulkDiscount).toBeCloseTo(156, 6)       // 1.56 * 100
    expect(order.items[0].lineTotal).toBeCloseTo(1144, 6)
    expect(order.items[0].savings).toBeCloseTo(856, 6)
  })

  it('gives gold the $50 free-shipping credit only once the order clears $1000', () => {
    // 100 units -> order total 1144 -> credit applies
    const big = calc.calculateOrderPricing([{ product: makeProduct(), quantity: 100 }], 'gold')
    expect(big.shippingDiscount).toBe(50)
    expect(big.total).toBeCloseTo(1094, 6)
    expect(big.totalSavings).toBeCloseTo(906, 6)

    // 50 units -> tier 13, 5% bulk -> 12.35 -> order total 617.50 -> no credit
    const small = calc.calculateOrderPricing([{ product: makeProduct(), quantity: 50 }], 'gold')
    expect(small.shippingDiscount).toBe(0)
    expect(small.total).toBeCloseTo(617.5, 6)
  })

  it('gives platinum the credit unconditionally, even under $1000', () => {
    // platinum 100 units: tier 11, 12% bulk -> 9.68 -> order total 968 (< 1000)
    const order = calc.calculateOrderPricing([{ product: makeProduct(), quantity: 100 }], 'platinum')
    expect(order.shippingDiscount).toBe(50)
    expect(order.total).toBeCloseTo(918, 6)
  })

  it('never gives bronze or silver the credit, however large the order', () => {
    // bronze 100 units clears $1000 easily (order total 1496) — still no credit.
    const bronze = calc.calculateOrderPricing([{ product: makeProduct(), quantity: 100 }], 'bronze')
    expect(bronze.shippingDiscount).toBe(0)
    expect(bronze.total).toBeCloseTo(1496, 6)

    const silver = calc.calculateOrderPricing([{ product: makeProduct(), quantity: 100 }], 'silver')
    expect(silver.shippingDiscount).toBe(0)
  })

  it('sums multi-line orders per item', () => {
    const order = calc.calculateOrderPricing(
      [
        { product: makeProduct(), quantity: 100 },
        { product: makeProduct({ id: 'wp_2', retailPrice: 40, wholesalePricing: [{ tier: 'gold', price: 26, minimumQuantity: 10 }] }), quantity: 10 }
      ],
      'gold'
    )
    expect(order.items).toHaveLength(2)
    expect(order.items[1].productId).toBe('wp_2')
    expect(order.subtotal).toBe(2400)          // 2000 + 400
    expect(order.tierDiscount).toBe(840)       // 700 + (40-26)*10
  })
})

describe('tier upgrade + eligibility', () => {
  it('quantifies what bronze -> gold is actually worth per month', () => {
    const b = calc.calculateTierUpgradeBenefits('bronze', 'gold', 10000)
    expect(b.additionalSavingsPercentage).toBeCloseTo(20, 6) // 35% - 15%
    expect(b.additionalSavings).toBeCloseTo(2000, 6)         // 20% of $10k
    expect(b.improvedPaymentTerms).toBe(30)                  // 45 - 15 days
    expect(b.additionalCreditLimit).toBe(30000)              // 35k - 5k
    expect(b.newPerks).toContain('Free shipping on orders $1000+')
    expect(b.newPerks).not.toContain('15% off retail prices')
  })

  it('promotes to the HIGHEST tier the average order clears, not the next one up', () => {
    const e = calc.checkTierEligibility('bronze', 0, 3000)
    expect(e.qualifiesFor?.id).toBe('gold')   // 3000 >= 2500, short of platinum's 5000
    expect(e.nextTier?.id).toBe('silver')     // "next" is still the adjacent tier
    expect(e.progressToNext).toBe(100)        // 3000 vs silver's 1000, capped
  })

  it('reports partial progress and no promotion when the average order is short', () => {
    const e = calc.checkTierEligibility('bronze', 0, 600)
    expect(e.qualifiesFor).toBeUndefined()
    expect(e.progressToNext).toBeCloseTo(60, 6) // 600 / 1000
  })

  it('has nowhere to go from platinum', () => {
    const e = calc.checkTierEligibility('platinum', 999999, 999999)
    expect(e.nextTier).toBeUndefined()
    expect(e.progressToNext).toBe(100)
  })

  it('ignores lifetime spend entirely — eligibility is average-order-value only', () => {
    // The `_totalSpent` parameter is accepted and never read. Pinning that so a
    // future "use total spend" change has to update this test deliberately.
    const poor = calc.checkTierEligibility('bronze', 0, 3000)
    const rich = calc.checkTierEligibility('bronze', 1_000_000, 3000)
    expect(rich.qualifiesFor?.id).toBe(poor.qualifiesFor?.id)
  })
})

describe('generatePricingTable / calculateBulkROI', () => {
  it('prices every tier at each quantity break', () => {
    const table = calc.generatePricingTable(makeProduct(), [10, 100])
    expect(table.map(r => r.quantity)).toEqual([10, 100])
    expect(Object.keys(table[0].pricing)).toEqual(['bronze', 'silver', 'gold', 'platinum'])
    // At qty 10 only bronze has cleared its MOQ; everyone else pays retail.
    expect(table[0].pricing.bronze.finalPrice).toBe(17)
    expect(table[0].pricing.gold.finalPrice).toBe(20)
  })

  it('computes ROI against a 70%-of-retail resale assumption', () => {
    // platinum, base 50 -> below platinum MOQ(100) so baseCost is retail 20*50.
    // bulk 100 -> tier 11 less 12% = 9.68 -> bulkCost 968.
    // resale 20*0.7 = 14; revenue 14 * 100 * 1.0 = 1400.
    const r = calc.calculateBulkROI(makeProduct(), 50, 100, 'platinum', 1.0)
    expect(r.baseCost).toBe(1000)
    expect(r.bulkCost).toBeCloseTo(968, 6)
    expect(r.potentialRevenue).toBeCloseTo(1400, 6)
    expect(r.roi).toBeCloseTo(44.628099, 4)
    expect(r.paybackPeriod).toBeCloseTo(2.074286, 4) // bulkCost / (revenue/3)
    expect(r.riskAssessment).toBe('medium')          // roi < 50, qty increase 1x
  })

  it('flags a >5x quantity jump as high risk even when the ROI looks great', () => {
    // base 10 -> bulk 100 is a 9x increase. Sell-through 3.0 forces a huge ROI
    // so the quantity rule is the only thing that can be producing "high".
    const r = calc.calculateBulkROI(makeProduct(), 10, 100, 'platinum', 3.0)
    expect(r.roi).toBeGreaterThan(50)
    expect(r.riskAssessment).toBe('high')
  })

  it('calls a modest, well-margined bulk buy low risk', () => {
    // retail 30 -> resale 21; platinum 100 units at 9.68 -> cost 968,
    // revenue 2100 -> ROI ~117%, quantity increase 1x.
    const r = calc.calculateBulkROI(makeProduct({ retailPrice: 30 }), 50, 100, 'platinum', 1.0)
    expect(r.roi).toBeGreaterThan(50)
    expect(r.riskAssessment).toBe('low')
  })
})

describe('PricingDisplayUtils', () => {
  it('formats money and savings for display', () => {
    expect(PricingDisplayUtils.formatPrice(11.4)).toBe('$11.40')
    expect(PricingDisplayUtils.formatSavings(8.56, 42.8)).toBe('$8.56 (42.8% off)')
  })

  it('pluralises the minimum-order copy', () => {
    expect(PricingDisplayUtils.formatMinimumOrder(1)).toBe('1 unit minimum')
    expect(PricingDisplayUtils.formatMinimumOrder(25)).toBe('25 units minimum')
    expect(PricingDisplayUtils.formatMinimumOrder(12, 'sheet')).toBe('12 sheets minimum')
  })

  it('nudges a shopper who is short of the tier minimum', () => {
    const pricing = calc.calculateProductPricing(makeProduct(), 24, 'silver')
    expect(PricingDisplayUtils.generatePriceBreakSummary(pricing, 24))
      .toBe('Order 1 more to unlock wholesale pricing')
  })

  it('quantifies the saving from reaching the next tier', () => {
    // gold @60: final 12.35, next tier (platinum) price 11 at qty 100.
    // (12.35 - 11) * 60 = $81.00, and 100 - 60 = 40 more units.
    const pricing = calc.calculateProductPricing(makeProduct(), 60, 'gold')
    expect(PricingDisplayUtils.generatePriceBreakSummary(pricing, 60))
      .toBe('Order 40 more to save an additional $81.00')
  })

  it('says so when there is no better tier left', () => {
    const pricing = calc.calculateProductPricing(makeProduct(), 120, 'platinum')
    expect(PricingDisplayUtils.generatePriceBreakSummary(pricing, 120))
      .toBe('Maximum discount tier reached')
  })
})
