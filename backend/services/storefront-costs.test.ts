// Mugs on the creator storefront (David 2026-10-23: "We can print the shirt and we can print mugs"; a mug costs $8).
import { describe, it, expect } from 'vitest'
import { isMug, MUG_PRINT_AREA, productBaseCostUsd } from './storefront-costs.js'

describe('productBaseCostUsd', () => {
  it('a shirt keeps the shirt base; a mug is $8 unless its own env says otherwise', () => {
    expect(productBaseCostUsd(null, 10, {} as any)).toBe(10)
    expect(productBaseCostUsd('t-shirt', 10, {} as any)).toBe(10)
    expect(productBaseCostUsd('mug', 10, {} as any)).toBe(8)
    expect(productBaseCostUsd('Mug', 10, { STOREFRONT_MUG_BASE_COST_USD: '9.5' } as any)).toBe(9.5)
    expect(productBaseCostUsd('mug', 10, { STOREFRONT_MUG_BASE_COST_USD: 'nonsense' } as any)).toBe(8)
    expect(productBaseCostUsd('hoodie', 10, { STOREFRONT_HOODIE_BASE_COST_USD: '22' } as any)).toBe(22)
  })
  it('a mug prints one 8.5 x 3.5 in sublimation wrap', () => {
    expect(isMug('mug')).toBe(true); expect(isMug('t-shirt')).toBe(false); expect(isMug(null)).toBe(false)
    expect(MUG_PRINT_AREA).toEqual({ widthIn: 8.5, heightIn: 3.5, method: 'sublimation', locations: ['wrap'] })
  })
})
