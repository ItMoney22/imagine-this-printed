// The size helpers are what keep "4x6 and 8x10 charge the same at checkout"
// (David 2026-09-02) from coming back: every reader of a metal product's
// size/price goes through these instead of a hand-rolled copy.
import { describe, it, expect } from 'vitest'
import {
  METAL_ART_PRICES_CENTS,
  STUDIO_SIZE_KEYS,
  normalizeMetalSizeKey,
  metalSizesFor,
  metalUnitPriceCents,
  metalStartingPriceCents,
  isMetalProductRow,
} from './metal-art.js'

describe('normalizeMetalSizeKey', () => {
  it('accepts the two studio sizes as-is', () => {
    expect(normalizeMetalSizeKey('4x6')).toBe('4x6')
    expect(normalizeMetalSizeKey('8x10')).toBe('8x10')
  })

  it('collapses the legacy 8x11 canvas size onto the 8x10 panel', () => {
    expect(normalizeMetalSizeKey('8x11')).toBe('8x10')
  })

  it('is tolerant of case, whitespace and an inch suffix', () => {
    expect(normalizeMetalSizeKey(' 8X10 ')).toBe('8x10')
    expect(normalizeMetalSizeKey('4x6"')).toBe('4x6')
    expect(normalizeMetalSizeKey('8x10in')).toBe('8x10')
  })

  it('returns null for anything that is not a metal panel size', () => {
    expect(normalizeMetalSizeKey('M')).toBeNull()
    expect(normalizeMetalSizeKey('poster')).toBeNull()
    expect(normalizeMetalSizeKey('')).toBeNull()
    expect(normalizeMetalSizeKey(undefined)).toBeNull()
    expect(normalizeMetalSizeKey(null)).toBeNull()
  })
})

describe('metalSizesFor', () => {
  it('reads the sizes column first, in studio order regardless of stored order', () => {
    expect(metalSizesFor({ sizes: ['8x10', '4x6'], metadata: { metal_sizes: ['4x6'] } })).toEqual(['4x6', '8x10'])
  })

  it('falls back to metadata.metal_sizes when the column is empty (a Step Flow row before the column was written)', () => {
    expect(metalSizesFor({ sizes: [], metadata: { metal_sizes: ['8x10'] } })).toEqual(['8x10'])
  })

  it('offers every studio size for a legacy row that recorded neither', () => {
    expect(metalSizesFor({ sizes: null, metadata: {} })).toEqual(STUDIO_SIZE_KEYS)
    expect(metalSizesFor(undefined)).toEqual(STUDIO_SIZE_KEYS)
  })

  it('de-dupes legacy 8x11 into 8x10 and drops non-metal junk', () => {
    expect(metalSizesFor({ sizes: ['4x6', '8x11', '8x10', 'M'] })).toEqual(['4x6', '8x10'])
  })

  it('never returns an empty list even when every recorded size is junk', () => {
    expect(metalSizesFor({ sizes: ['S', 'M'] })).toEqual(STUDIO_SIZE_KEYS)
  })
})

describe('prices', () => {
  it('unit price comes from the locked table (4x6 $8.95, 8x10 $16.95)', () => {
    expect(metalUnitPriceCents('4x6')).toBe(895)
    expect(metalUnitPriceCents('8x10')).toBe(1695)
    expect(metalUnitPriceCents('8x10')).toBe(METAL_ART_PRICES_CENTS['8x10'])
  })

  it('starting price is the smallest offered size', () => {
    expect(metalStartingPriceCents({ sizes: ['4x6', '8x10'] })).toBe(895)
    expect(metalStartingPriceCents({ sizes: ['8x10'] })).toBe(1695)
    expect(metalStartingPriceCents({})).toBe(895)
  })
})

describe('isMetalProductRow', () => {
  it('classifies from the category column first', () => {
    expect(isMetalProductRow({ category: 'metal-art' })).toBe(true)
    expect(isMetalProductRow({ category: 'shirts' })).toBe(false)
  })

  it('falls back to the metadata template/type when the column is null', () => {
    expect(isMetalProductRow({ category: null, metadata: { product_template: 'metal-art' } })).toBe(true)
    expect(isMetalProductRow({ category: null, metadata: { product_type: 'metal-art' } })).toBe(true)
    expect(isMetalProductRow({ category: null, metadata: { product_template: 'tshirt' } })).toBe(false)
  })
})
