// Listing honesty (task 389defc8): the candle holder is home decor that still
// sells as a one-size 3D print, its photo's candle is called out as not
// included, and only figures that really carry magnets get the magnet warning.

import { describe, it, expect } from 'vitest'
import {
  productKindOf,
  canonicalCategoryOf,
  categoryValuesFor,
  listingOptionSets,
  sizeChoicesFor,
  notIncludedNote,
  hasMagnets,
  STOREFRONT_CATEGORIES,
} from './product-kind'

const candle: any = { category: 'home-decor', metadata: { not_included: ['Candle'], print3d: { enabled: true, magnet_sockets: 0 } }, sizes: [] }
const toy: any = { category: '3d-prints', metadata: { print3d: { enabled: true, magnet_sockets: 2 }, addons: ['toy_magnet_pair'] }, sizes: [] }

describe('home decor', () => {
  it('sells like a 3D print: one size, no shirt tools', () => {
    expect(productKindOf(candle)).toBe('3d')
    expect(sizeChoicesFor(candle)).toEqual([])
    const o = listingOptionSets(candle)
    expect(o.gangSheet).toBe(false)
    expect(o.upload).toBe(false)
    expect(o.tryOn).toBe(false)
  })

  it('keeps its own catalog tab instead of folding into 3D Prints', () => {
    expect(canonicalCategoryOf(candle)).toBe('home-decor')
    expect(categoryValuesFor('home-decor')).toEqual(['home-decor'])
    expect(STOREFRONT_CATEGORIES.map(c => c.id)).toContain('home-decor')
  })
})

describe('notIncludedNote', () => {
  it('names what the photo shows but the box does not hold', () => {
    expect(notIncludedNote(candle)).toBe('Candle not included')
    expect(notIncludedNote({ metadata: { not_included: ['Candle', 'Stand'] } } as any)).toBe('Candle and Stand not included')
  })

  it('says nothing when nothing is missing', () => {
    expect(notIncludedNote({ metadata: {} } as any)).toBeNull()
    expect(notIncludedNote({ metadata: { not_included: [' '] } } as any)).toBeNull()
    expect(notIncludedNote(null)).toBeNull()
  })
})

describe('hasMagnets', () => {
  it('is true for Toy Factory figures with magnet sockets', () => {
    expect(hasMagnets(toy)).toBe(true)
    expect(hasMagnets({ category: '3d-prints', metadata: { addons: ['toy_magnet_pair'] } } as any)).toBe(true)
  })

  it('is false for the candle holder and plain prints', () => {
    expect(hasMagnets(candle)).toBe(false)
    expect(hasMagnets({ category: '3d-prints', metadata: {} } as any)).toBe(false)
  })
})
