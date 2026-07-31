// Tests for Watchtower task b714d855: "Enforce print-type minDPI on
// Imagination Station backend cart/order". These exercise the pure guard
// logic directly (no Supabase, no Express) — the same dependency-free
// pattern as imagination-layer-save.test.ts.

import { describe, it, expect } from 'vitest'
import {
  resolveLayerDpi,
  extractImaginationCartItems,
  findDpiViolations,
  DEFAULT_MIN_DPI,
  type CartLayer,
  type DpiGuardCartItem,
} from './imagination-dpi-guard.js'

describe('resolveLayerDpi', () => {
  it('prefers the already-graded metadata.dpiInfo.dpi when present', () => {
    const layer: CartLayer = { layer_type: 'image', width: 4, height: 4, metadata: { dpiInfo: { dpi: 320 } } }
    expect(resolveLayerDpi(layer)).toBe(320)
  })

  it('recomputes from originalWidth/Height (px) against width/height (in) when dpiInfo is missing', () => {
    // 1200px wide source placed at 4in -> 300 DPI
    const layer: CartLayer = {
      layer_type: 'image',
      width: 4,
      height: 4,
      metadata: { originalWidth: 1200, originalHeight: 1200 },
    }
    expect(resolveLayerDpi(layer)).toBe(300)
  })

  it('uses the worse (lower) of the two axes, matching the client-side calculator', () => {
    // width axis -> 300 DPI, height axis -> 100 DPI (worse) -> 100
    const layer: CartLayer = {
      layer_type: 'image',
      width: 4,
      height: 12,
      metadata: { originalWidth: 1200, originalHeight: 1200 },
    }
    expect(resolveLayerDpi(layer)).toBe(100)
  })

  it('returns null (undeterminable) when neither dpiInfo nor recomputable dimensions are available', () => {
    expect(resolveLayerDpi({ layer_type: 'image' })).toBeNull()
    expect(resolveLayerDpi({ layer_type: 'image', width: 4, height: 4, metadata: {} })).toBeNull()
    expect(resolveLayerDpi({ layer_type: 'image', width: 0, height: 4, metadata: { originalWidth: 1200, originalHeight: 1200 } })).toBeNull()
  })
})

describe('extractImaginationCartItems', () => {
  const dtfImage: CartLayer = { layer_type: 'image', width: 4, height: 4, metadata: { dpiInfo: { dpi: 300 } } }

  it('picks up an item with a known print type and at least one image/ai_generated layer', () => {
    const items: DpiGuardCartItem[] = [
      { product: { metadata: { printType: 'dtf' } }, designData: { elements: [dtfImage] } },
    ]
    const result = extractImaginationCartItems(items)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ itemIndex: 0, printType: 'dtf' })
    expect(result[0].layers).toHaveLength(1)
  })

  it('ignores a plain apparel/metal/3D item that has no printType', () => {
    const items: DpiGuardCartItem[] = [
      { product: { metadata: {} } },
      { product: { metadata: { printType: undefined } }, designData: { elements: [dtfImage] } },
    ]
    expect(extractImaginationCartItems(items)).toEqual([])
  })

  it('ignores a text/shape-only sheet (no image/ai_generated layers)', () => {
    const textLayer: CartLayer = { layer_type: 'text', width: 4, height: 1 }
    const items: DpiGuardCartItem[] = [
      { product: { metadata: { printType: 'dtf' } }, designData: { elements: [textLayer] } },
    ]
    expect(extractImaginationCartItems(items)).toEqual([])
  })

  it('ignores an item with no designData at all', () => {
    const items: DpiGuardCartItem[] = [{ product: { metadata: { printType: 'dtf' } } }]
    expect(extractImaginationCartItems(items)).toEqual([])
  })

  it('preserves the original cart index so violations can be traced back to the right line item', () => {
    const items: DpiGuardCartItem[] = [
      { product: { metadata: {} } }, // index 0, not an imagination item
      { product: { metadata: { printType: 'uv_dtf' } }, designData: { elements: [dtfImage] } }, // index 1
    ]
    const result = extractImaginationCartItems(items)
    expect(result).toHaveLength(1)
    expect(result[0].itemIndex).toBe(1)
  })

  it('handles a missing/non-array items list without throwing', () => {
    expect(extractImaginationCartItems(null)).toEqual([])
    expect(extractImaginationCartItems(undefined)).toEqual([])
  })
})

describe('findDpiViolations', () => {
  it('passes every layer at or above the print type minDPI', () => {
    const goodLayer: CartLayer = { layer_type: 'image', metadata: { dpiInfo: { dpi: 300 } } }
    const violations = findDpiViolations(
      [{ itemIndex: 0, printType: 'dtf', layers: [goodLayer] }],
      { dtf: 300 }
    )
    expect(violations).toEqual([])
  })

  it('flags a layer below the print type minDPI (the exact 160-DPI-on-300-DTF regression from 2ec9eeff)', () => {
    const badLayer: CartLayer = { layer_type: 'image', metadata: { dpiInfo: { dpi: 160 }, name: 'logo.png' } }
    const violations = findDpiViolations(
      [{ itemIndex: 0, printType: 'dtf', layers: [badLayer] }],
      { dtf: 300 }
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ itemIndex: 0, printType: 'dtf', layerName: 'logo.png', dpi: 160, minDPI: 300 })
  })

  it('flags an undeterminable layer (no dpiInfo, no recomputable dimensions) rather than letting it silently pass', () => {
    const unknownLayer: CartLayer = { layer_type: 'image' }
    const violations = findDpiViolations(
      [{ itemIndex: 2, printType: 'sublimation', layers: [unknownLayer] }],
      { sublimation: 300 }
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].dpi).toBeNull()
  })

  it('falls back to DEFAULT_MIN_DPI when the print type is missing from the resolved map', () => {
    const layer: CartLayer = { layer_type: 'image', metadata: { dpiInfo: { dpi: 250 } } }
    const violations = findDpiViolations(
      [{ itemIndex: 0, printType: 'dtf', layers: [layer] }],
      {} // caller failed to resolve dtf's minDPI
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].minDPI).toBe(DEFAULT_MIN_DPI)
  })

  it('checks every layer independently across multiple items', () => {
    const good: CartLayer = { layer_type: 'image', metadata: { dpiInfo: { dpi: 300 } } }
    const bad: CartLayer = { layer_type: 'image', metadata: { dpiInfo: { dpi: 50 }, name: 'small.png' } }
    const violations = findDpiViolations(
      [
        { itemIndex: 0, printType: 'dtf', layers: [good, bad] },
        { itemIndex: 1, printType: 'uv_dtf', layers: [good] },
      ],
      { dtf: 300, uv_dtf: 300 }
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ itemIndex: 0, layerName: 'small.png' })
  })
})
