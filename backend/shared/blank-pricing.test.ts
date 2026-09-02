import { describe, it, expect } from 'vitest'
import {
  markupPrice,
  buildBlankPricing,
  blankUnitPriceDollars,
  blankFromPriceDollars,
  blankPricingOf,
  isBlankGarmentMeta
} from './blank-pricing.js'

describe('markupPrice', () => {
  it('adds the markup and rounds to whole cents', () => {
    expect(markupPrice(2.99, 10)).toBe(3.29) // 3.289
    expect(markupPrice(7.53, 10)).toBe(8.28) // 8.283
    expect(markupPrice(9.53, 10)).toBe(10.48) // 10.483
    expect(markupPrice(5.9, 10)).toBe(6.49)
  })
  it('is NaN for garbage so a bad seed cannot write $0', () => {
    expect(Number.isNaN(markupPrice(NaN, 10))).toBe(true)
    expect(Number.isNaN(markupPrice(1, NaN))).toBe(true)
  })
})

describe('buildBlankPricing', () => {
  const cost = {
    default: { S: 2.99, M: 2.99, '2XL': 6.93 },
    white: { S: 2.79, M: 2.79, '2XL': 5.38 }
  }
  it('marks up every size in both tables and keys white overrides by colour name', () => {
    const p = buildBlankPricing(cost, ['White'], 10)
    expect(p.default).toEqual({ S: 3.29, M: 3.29, '2XL': 7.62 })
    expect(p.by_color).toEqual({ White: { S: 3.07, M: 3.07, '2XL': 5.92 } })
  })
  it('omits by_color when there is no white table', () => {
    const p = buildBlankPricing({ default: cost.default }, ['White'], 10)
    expect(p.by_color).toBeUndefined()
  })
})

describe('blankUnitPriceDollars', () => {
  const pricing = buildBlankPricing(
    { default: { S: 2.99, XL: 2.99, '2XL': 6.93, '3XL': 8.6 }, white: { S: 2.79, XL: 2.79, '2XL': 5.38, '3XL': 7.17 } },
    ['White'],
    10
  )
  it('uses the default table for any non-white colour', () => {
    expect(blankUnitPriceDollars(pricing, 'S', 'Black')).toBe(3.29)
    expect(blankUnitPriceDollars(pricing, '3XL', 'Navy')).toBe(9.46)
  })
  it('uses the white override, case-insensitively', () => {
    expect(blankUnitPriceDollars(pricing, 'S', 'White')).toBe(3.07)
    expect(blankUnitPriceDollars(pricing, '2XL', 'white')).toBe(5.92)
  })
  it('tolerates size case drift but refuses unknown sizes', () => {
    expect(blankUnitPriceDollars(pricing, '2xl', 'Black')).toBe(7.62)
    expect(blankUnitPriceDollars(pricing, '6XL', 'Black')).toBeNull()
    expect(blankUnitPriceDollars(pricing, '', 'Black')).toBeNull()
    expect(blankUnitPriceDollars(null, 'S', 'Black')).toBeNull()
  })
  it('never applies the flat plus-size rule — 2XL is exactly the table price', () => {
    expect(blankUnitPriceDollars(pricing, '2XL', 'Black')).toBe(7.62)
  })
})

describe('blankFromPriceDollars / metadata readers', () => {
  const meta = {
    garment: {
      blank: true,
      pricing: { default: { S: 3.29, '2XL': 7.62 }, by_color: { White: { S: 3.07, '2XL': 5.92 } } }
    }
  }
  it('reads the table off metadata and reports the lowest price as "from"', () => {
    expect(isBlankGarmentMeta(meta)).toBe(true)
    expect(isBlankGarmentMeta({ blank_only: true })).toBe(true)
    expect(isBlankGarmentMeta({})).toBe(false)
    expect(blankPricingOf(meta)?.default.S).toBe(3.29)
    expect(blankPricingOf({ garment: { blank: true } })).toBeNull()
    expect(blankFromPriceDollars(blankPricingOf(meta))).toBe(3.07)
    expect(blankFromPriceDollars(null)).toBeNull()
  })
})
