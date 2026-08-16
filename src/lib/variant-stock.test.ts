// Covers the ProductPage stock-warning logic: reading a per-variant qty out
// of the /api/product-availability response and classifying it into the
// 'unknown' | 'in-stock' | 'low' | 'out' states the UI renders. The load-
// bearing behavior is the fallback: no blank-backed data must always read as
// 'unknown', never as 'out' — that's what keeps non-apparel products and
// unmapped apparel silently defaulting to the existing is_active behavior.

import { describe, it, expect } from 'vitest'
import { variantQtyFrom, variantStockStatus, LOW_STOCK_THRESHOLD, type ProductAvailability } from './variant-stock'

describe('variantQtyFrom', () => {
  const blankBacked: ProductAvailability = {
    mode: 'blank-inventory',
    available: true,
    stockQuantity: null,
    byVariant: { 'Black::XL': 2, 'Black::M': 0, 'White::M': 12 }
  }

  it('reads the qty for an exact color/size match', () => {
    expect(variantQtyFrom(blankBacked, 'Black', 'XL')).toBe(2)
    expect(variantQtyFrom(blankBacked, 'White', 'M')).toBe(12)
  })

  it('returns 0 (not null) for a mapped variant that is truly out of stock', () => {
    expect(variantQtyFrom(blankBacked, 'Black', 'M')).toBe(0)
  })

  it('returns null for a combo with no blank_inventory row at all', () => {
    expect(variantQtyFrom(blankBacked, 'Red', 'S')).toBeNull()
  })

  it('returns null when the product is product-level (non-apparel, or unmapped apparel)', () => {
    const productLevel: ProductAvailability = { mode: 'product-level', available: true, stockQuantity: null }
    expect(variantQtyFrom(productLevel, 'Black', 'XL')).toBeNull()
  })

  it('returns null when availability has not loaded yet', () => {
    expect(variantQtyFrom(null, 'Black', 'XL')).toBeNull()
    expect(variantQtyFrom(undefined, 'Black', 'XL')).toBeNull()
  })
})

describe('variantStockStatus', () => {
  it('maps null (no data) to unknown, never to out', () => {
    expect(variantStockStatus(null)).toBe('unknown')
  })

  it('maps 0 or negative to out', () => {
    expect(variantStockStatus(0)).toBe('out')
    expect(variantStockStatus(-1)).toBe('out')
  })

  it('maps 1..threshold to low', () => {
    expect(variantStockStatus(1)).toBe('low')
    expect(variantStockStatus(LOW_STOCK_THRESHOLD)).toBe('low')
  })

  it('maps anything above the threshold to in-stock', () => {
    expect(variantStockStatus(LOW_STOCK_THRESHOLD + 1)).toBe('in-stock')
    expect(variantStockStatus(999)).toBe('in-stock')
  })
})
