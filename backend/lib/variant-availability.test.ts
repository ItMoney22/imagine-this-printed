// Tests for per-size/per-color availability math (Watchtower task
// cd19d3fb-cce5-437e-946c-8e271167d9b7, stock-review half).
//
// computeVariantAvailability is dependency-free — the whole point of putting it
// in lib/ is that "which size+color is fulfillable" is testable without a
// database. The query that loads blanks lives in the route.

import { describe, it, expect } from 'vitest'
import { computeVariantAvailability, variantStockLabel, type AvailabilityBlank } from './variant-availability.js'

function blank(overrides: Partial<AvailabilityBlank> = {}): AvailabilityBlank {
  return {
    color: 'black',
    size: 'm',
    style_code: 'G500',
    qty_on_hand: 10,
    ...overrides
  }
}

describe('computeVariantAvailability', () => {
  it('sums across matching blanks for each color::size', () => {
    const availability = computeVariantAvailability(
      [blank({ color: 'black', size: 'm', qty_on_hand: 5 }), blank({ color: 'black', size: 'm', qty_on_hand: 7, style_code: 'G5000' })],
      ['M'],
      ['Black'],
      null
    )
    expect(availability.blankBacked).toBe(true)
    expect(availability.byVariant['Black::M']).toBe(12)
  })

  it('filters to a single style when the product is pinned', () => {
    const availability = computeVariantAvailability(
      [blank({ style_code: 'G500', qty_on_hand: 3 }), blank({ style_code: 'G5000', qty_on_hand: 40 })],
      ['M'],
      ['Black'],
      'G500'
    )
    expect(availability.byVariant['Black::M']).toBe(3)
  })

  it('treats negative on-hand as zero, never a negative availability', () => {
    const availability = computeVariantAvailability(
      [blank({ qty_on_hand: -2 })],
      ['M'],
      ['Black'],
      'G500'
    )
    expect(availability.byVariant['Black::M']).toBe(0)
  })

  it('is not blank-backed when the product has no sizes or colors', () => {
    expect(computeVariantAvailability([blank()], [], [], null).blankBacked).toBe(false)
    expect(computeVariantAvailability([], ['M'], ['Black'], null).blankBacked).toBe(false)
  })

  it('matches color and size case-insensitively and whitespace-insensitively', () => {
    const availability = computeVariantAvailability(
      [blank({ color: ' HEATHER BLACK ', size: 'XL' })],
      ['xl'],
      ['heather black'],
      'G500'
    )
    expect(availability.byVariant['heather black::xl']).toBe(10)
  })
})

describe('variantStockLabel', () => {
  it('produces human-friendly labels', () => {
    expect(variantStockLabel(0)).toBe('Out of stock')
    expect(variantStockLabel(1)).toBe('Only 1 left')
    expect(variantStockLabel(4)).toBe('Only 4 left')
    expect(variantStockLabel(8)).toBe('In stock')
  })
})
