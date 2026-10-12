import { describe, it, expect } from 'vitest'
import {
  HOUSE_MARKUP_PCT,
  MIN_DECORATION_COST,
  retailFromCost,
  deriveDecorationCost,
  normaliseBand,
  buildVariantPricing,
  variantPricingOf,
  hasVariantPricing,
  variantUnitPriceDollars,
  variantFromPriceDollars,
  variantTierIds
} from './variant-pricing.js'

// Real Jiffy costs, pulled live 2026-09-22 from the public PDP grid. These are
// the numbers the whole feature exists for -- if they drift, the test should
// fail loudly rather than the storefront quietly selling under water.
const G500 = { S: 2.99, M: 2.99, L: 2.99, XL: 2.99, '2XL': 6.93, '3XL': 8.6, '4XL': 9.53, '5XL': 9.53 }
const G500_WHITE = { S: 1.82, M: 2.79, L: 2.79, XL: 2.79, '2XL': 5.38, '3XL': 7.17, '4XL': 7.5, '5XL': 7.5 }
const C1717 = { S: 5.33, M: 7.53, L: 7.53, XL: 7.53, '2XL': 11.65, '3XL': 13.98, '4XL': 16.62 }
const G185 = { S: 15.09, M: 15.09, L: 15.09, XL: 15.09, '2XL': 20.36, '3XL': 23.71 }

describe('retailFromCost', () => {
  it('is cost x 1.20 + decoration, to the cent', () => {
    expect(retailFromCost(2.99, 21.41)).toBe(25) // 3.588 + 21.41 = 24.998
    expect(retailFromCost(6.93, 21.41)).toBe(29.73) // 8.316 + 21.41
    expect(retailFromCost(9.53, 21.41)).toBe(32.85) // 11.436 + 21.41
  })

  it('honours a non-default markup', () => {
    expect(retailFromCost(10, 5, 0)).toBe(15)
    expect(retailFromCost(10, 5, 50)).toBe(20)
  })

  it('is NaN for garbage so a bad sync cannot stamp $0', () => {
    expect(Number.isNaN(retailFromCost(NaN, 5))).toBe(true)
    expect(Number.isNaN(retailFromCost(5, NaN))).toBe(true)
    expect(Number.isNaN(retailFromCost(5, 5, NaN))).toBe(true)
  })
})

describe('deriveDecorationCost', () => {
  it('round-trips: the base variant keeps the price it already had', () => {
    const { decorationCost, underwater } = deriveDecorationCost(25, 2.99)
    expect(underwater).toBe(false)
    expect(retailFromCost(2.99, decorationCost)).toBe(25)
  })

  it('flags the $15 hoodie against its $15.09 blank and floors the stamp', () => {
    // The real live listing: America's 250th Anniversary Hoodie at $15 while a
    // Gildan 18500 costs $15.09 before markup, ink, labour or shipping.
    const { decorationCost, underwater } = deriveDecorationCost(15, G185.S)
    expect(underwater).toBe(true)
    expect(decorationCost).toBe(MIN_DECORATION_COST)
  })

  it('treats unusable input as underwater rather than guessing', () => {
    expect(deriveDecorationCost(NaN, 3).underwater).toBe(true)
    expect(deriveDecorationCost(25, NaN).underwater).toBe(true)
  })
})

describe('normaliseBand', () => {
  it('lifts a one-size promo up to the band price', () => {
    // Jiffy had G500 White S at $1.82 while M-XL sat at $2.79. A promo that
    // expires next week must never become the customer's price.
    const out = normaliseBand(G500_WHITE, ['XS', 'S', 'M', 'L', 'XL'])
    expect(out.S).toBe(2.79)
    expect(out.M).toBe(2.79)
    // Sizes outside the band are untouched.
    expect(out['3XL']).toBe(7.17)
  })

  it('leaves a table with no band sizes alone', () => {
    expect(normaliseBand({ '2XL': 5 }, ['S', 'M'])).toEqual({ '2XL': 5 })
  })
})

describe('buildVariantPricing', () => {
  const pricing = buildVariantPricing({
    costs: { standard: G500, heavyweight: C1717 },
    costsByColor: { White: { standard: G500_WHITE } },
    decorationCost: 21.41,
    styles: { standard: 'G500', heavyweight: 'C1717' },
    syncedAt: '2026-09-22T00:00:00.000Z',
    normalise: true
  })

  it('prices every tier and size off its own cost', () => {
    expect(pricing.default.standard.M).toBe(25)
    expect(pricing.default.standard['2XL']).toBe(29.73)
    expect(pricing.default.standard['5XL']).toBe(32.85)
    // Top Line 5XL used to collect $2.50 + $7.00 on a blank that costs
    // $12.62 more than the base. It now collects the real thing.
    expect(pricing.default.heavyweight['4XL']).toBe(41.35) // 16.62*1.2 + 21.41
  })

  it('normalises the promo size inside the band', () => {
    expect(pricing.by_color?.White.standard.S).toBe(pricing.by_color?.White.standard.M)
  })

  it('keeps a colour override only when it actually differs', () => {
    expect(pricing.by_color?.White).toBeDefined()
    const same = buildVariantPricing({
      costs: { standard: G500 },
      costsByColor: { Black: { standard: G500 } },
      decorationCost: 10
    })
    expect(same.by_color).toBeUndefined()
  })

  it('records the markup, the decoration split and the sync stamp', () => {
    expect(pricing.markup_pct).toBe(HOUSE_MARKUP_PCT)
    expect(pricing.decoration_cost).toBe(21.41)
    expect(pricing.synced_at).toBe('2026-09-22T00:00:00.000Z')
    expect(pricing.styles).toEqual({ standard: 'G500', heavyweight: 'C1717' })
    expect(pricing.priced_at).toBeTruthy()
  })
})

describe('variantUnitPriceDollars', () => {
  const pricing = buildVariantPricing({
    costs: { standard: G500, heavyweight: C1717 },
    costsByColor: { White: { standard: G500_WHITE, heavyweight: C1717 } },
    decorationCost: 21.41,
    normalise: true
  })

  it('prices by size, colour and tier together', () => {
    expect(variantUnitPriceDollars(pricing, 'M', 'Black', 'standard')).toBe(25)
    expect(variantUnitPriceDollars(pricing, 'M', 'White', 'standard')).toBe(24.76) // 2.79*1.2+21.41
    expect(variantUnitPriceDollars(pricing, '3XL', 'Black', 'heavyweight')).toBe(38.19)
  })

  it('defaults to the standard tier when none was picked', () => {
    expect(variantUnitPriceDollars(pricing, 'M', 'Black')).toBe(25)
  })

  it('tolerates case and whitespace drift from an old cart row', () => {
    expect(variantUnitPriceDollars(pricing, ' 2xl ', 'black', 'STANDARD')).toBe(29.73)
  })

  it('returns null for a tier this garment does not have, never a cheaper guess', () => {
    const hoodie = buildVariantPricing({ costs: { standard: G185 }, decorationCost: 20 })
    expect(variantUnitPriceDollars(hoodie, 'M', null, 'premium')).toBeNull()
    expect(variantUnitPriceDollars(hoodie, 'M', null, 'standard')).toBe(38.11)
  })

  it('returns null for an unknown size and for a missing table', () => {
    expect(variantUnitPriceDollars(pricing, '9XL', null, 'standard')).toBeNull()
    expect(variantUnitPriceDollars(null, 'M')).toBeNull()
    expect(variantUnitPriceDollars(pricing, null)).toBeNull()
  })

  it('falls back to the default table for a colour with no override', () => {
    expect(variantUnitPriceDollars(pricing, 'M', 'Navy', 'standard')).toBe(25)
  })
})

describe('variantPricingOf / hasVariantPricing', () => {
  it('reads the stamp off product metadata', () => {
    const meta = { garment: { variant_pricing: { markup_pct: 20, decoration_cost: 20, default: { standard: { M: 44 } } } } }
    expect(hasVariantPricing(meta)).toBe(true)
    expect(variantUnitPriceDollars(variantPricingOf(meta), 'M')).toBe(44)
  })

  it('rejects a malformed stamp instead of pricing off it', () => {
    expect(hasVariantPricing(null)).toBe(false)
    expect(hasVariantPricing({ garment: {} })).toBe(false)
    expect(hasVariantPricing({ garment: { variant_pricing: { default: { standard: { M: 1 } } } } })).toBe(false)
    expect(hasVariantPricing({ garment: { variant_pricing: { decoration_cost: 5 } } })).toBe(false)
  })
})

describe('variantFromPriceDollars / variantTierIds', () => {
  const pricing = buildVariantPricing({
    costs: { standard: G500, heavyweight: C1717 },
    costsByColor: { White: { standard: G500_WHITE } },
    decorationCost: 21.41,
    normalise: true
  })

  it('reports the cheapest variant anywhere in the table', () => {
    expect(variantFromPriceDollars(pricing)).toBe(24.76)
  })

  it('lists the tiers the product can actually be sold in', () => {
    expect(variantTierIds(pricing).sort()).toEqual(['heavyweight', 'standard'])
    expect(variantTierIds(null)).toEqual([])
  })
})
