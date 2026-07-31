// Product classification + the metal-art add-on catalog. Two things here are
// load-bearing for the storefront: a product must not render as a t-shirt just
// because its category column is null, and a halftone/DTF print file must NEVER
// escape into the public gallery — those are paid digital deliverables.

import { describe, it, expect } from 'vitest'
import {
  METAL_ADDONS,
  getAddonById,
  resolveProductAddons,
  addonsUnitTotal,
  addonsSignature,
  productKindOf,
  canonicalCategoryOf,
  defaultSizesFor,
  getProductAssets,
  hasDigitalDeliverables,
  getGalleryImages,
  getDeliverables
} from './product-kind'
import { STUDIO_SIZE_KEYS } from '../../backend/shared/metal-art'
import type { Product } from '../types'

const p = (over: Partial<Product>) => over as Product

describe('productKindOf', () => {
  it('classifies from the category column first', () => {
    expect(productKindOf(p({ category: 'metal-art' }))).toBe('metal')
    expect(productKindOf(p({ category: '3d-prints' }))).toBe('3d')
    expect(productKindOf(p({ category: 'shirts' }))).toBe('apparel')
    expect(productKindOf(p({ category: 'tumblers' }))).toBe('apparel')
  })

  it('falls back to metadata.product_template when the category column is null', () => {
    // The regression this fallback exists for: metal art approved before the
    // approve route started writing the category column would render as a
    // t-shirt without it.
    expect(productKindOf(p({ category: null as never, metadata: { product_template: 'metal-art' } }))).toBe('metal')
    expect(productKindOf(p({ metadata: { product_template: 'wall-art' } }))).toBe('metal')
    expect(productKindOf(p({ metadata: { category: '3d-prints' } }))).toBe('3d')
  })

  it('treats toys as 3D prints', () => {
    expect(productKindOf(p({ category: 'toys' as never }))).toBe('3d')
    expect(productKindOf(p({ metadata: { product_template: 'toy-figure' } }))).toBe('3d')
  })

  it('is case-insensitive', () => {
    expect(productKindOf(p({ category: 'Metal-Art' as never }))).toBe('metal')
  })

  it('defaults to apparel for an unclassifiable product rather than throwing', () => {
    expect(productKindOf(p({}))).toBe('apparel')
    expect(productKindOf(p({ category: undefined, metadata: {} }))).toBe('apparel')
  })

  it('prefers metal over 3d when a product mentions both', () => {
    // A 3D-printed metal wall piece must land in the metal-art catalog.
    expect(productKindOf(p({ category: '3d-prints', metadata: { product_template: 'metal-art' } }))).toBe('metal')
  })
})

describe('canonicalCategoryOf — the id the storefront filter uses', () => {
  it('normalises metal and 3D onto their canonical catalog ids', () => {
    expect(canonicalCategoryOf(p({ metadata: { product_template: 'metal-art' } }))).toBe('metal-art')
    expect(canonicalCategoryOf(p({ category: 'toys' as never }))).toBe('3d-prints')
  })

  it('keeps a real apparel category and only defaults to shirts when there is none', () => {
    expect(canonicalCategoryOf(p({ category: 'hoodies' }))).toBe('hoodies')
    expect(canonicalCategoryOf(p({}))).toBe('shirts')
  })
})

describe('defaultSizesFor', () => {
  it('offers print sizes for metal, tiers for 3D and garment sizes for apparel', () => {
    expect(defaultSizesFor('metal')).toEqual(STUDIO_SIZE_KEYS)
    expect(defaultSizesFor('3d')).toEqual(['mini', 'small', 'medium', 'large'])
    expect(defaultSizesFor('apparel')).toEqual(['S', 'M', 'L', 'XL', '2XL'])
  })

  it('never shows shirt sizes on a metal print', () => {
    expect(defaultSizesFor('metal')).not.toContain('XL')
  })
})

describe('metal-art add-on catalog', () => {
  it('holds the four add-ons at their published prices', () => {
    expect(METAL_ADDONS.map(a => [a.id, a.price])).toEqual([
      ['easel_stand', 7],
      ['standoff_mount', 10],
      ['hanging_kit', 5],
      ['gift_box', 5]
    ])
  })

  it('marks only the physical mounts as printed in-house', () => {
    expect(METAL_ADDONS.filter(a => a.printed).map(a => a.id))
      .toEqual(['easel_stand', 'standoff_mount', 'hanging_kit'])
    expect(getAddonById('gift_box')!.printed).toBe(false)
  })

  it('returns null for an unknown add-on id instead of undefined', () => {
    expect(getAddonById('nope')).toBeNull()
  })

  it('resolves stored ids into catalog entries and drops ids that no longer exist', () => {
    const resolved = resolveProductAddons(p({ metadata: { addons: ['gift_box', 'retired_addon', 'easel_stand'] } }))
    expect(resolved.map(a => a.id)).toEqual(['gift_box', 'easel_stand'])
  })

  it('returns nothing when metadata.addons is missing or not a list', () => {
    expect(resolveProductAddons(p({}))).toEqual([])
    expect(resolveProductAddons(p({ metadata: { addons: 'easel_stand' } }))).toEqual([])
  })
})

describe('cart add-on pricing + line-item identity', () => {
  it('sums the per-unit add-on price', () => {
    expect(addonsUnitTotal([{ id: 'easel_stand', name: 'Easel', price: 7 }, { id: 'gift_box', name: 'Box', price: 5 }]))
      .toBe(12)
  })

  it('treats a missing or unparseable price as $0 rather than NaN-ing the cart', () => {
    expect(addonsUnitTotal([{ id: 'x', name: 'X', price: undefined as never }])).toBe(0)
    expect(addonsUnitTotal([{ id: 'x', name: 'X', price: 'abc' as never }, { id: 'y', name: 'Y', price: 5 }])).toBe(5)
    expect(addonsUnitTotal(null)).toBe(0)
    expect(addonsUnitTotal(undefined)).toBe(0)
  })

  it('signs the same add-on set identically regardless of selection order', () => {
    const a = addonsSignature([{ id: 'gift_box', name: '', price: 5 }, { id: 'easel_stand', name: '', price: 7 }])
    const b = addonsSignature([{ id: 'easel_stand', name: '', price: 7 }, { id: 'gift_box', name: '', price: 5 }])
    expect(a).toBe(b)
    expect(a).toBe('easel_stand,gift_box')
  })

  it('signs different add-on sets differently so the cart keeps them as separate lines', () => {
    expect(addonsSignature([{ id: 'gift_box', name: '', price: 5 }]))
      .not.toBe(addonsSignature([{ id: 'easel_stand', name: '', price: 7 }]))
  })

  it('signs "no add-ons" as an empty string', () => {
    expect(addonsSignature([])).toBe('')
    expect(addonsSignature(null)).toBe('')
  })
})

describe('gallery images — deliverables must never be shown', () => {
  const assets = {
    clean: 'https://cdn/clean.png',
    display: 'https://cdn/display.png',
    mockups: ['https://cdn/mockup-1.png', 'https://cdn/mockup-2.png'],
    halftone: 'https://cdn/halftone.png',
    dtf: 'https://cdn/dtf.png'
  }

  it('never lets a halftone or DTF file into the public gallery', () => {
    const images = getGalleryImages(p({ metadata: { assets }, images: [assets.halftone, assets.dtf] }))
    expect(images).not.toContain(assets.halftone)
    expect(images).not.toContain(assets.dtf)
  })

  it('leads with the watermarked display art, then the contextual mockups', () => {
    const images = getGalleryImages(p({ metadata: { assets }, images: [] }))
    expect(images[0]).toBe(assets.display)
    expect(images.slice(1, 3)).toEqual(assets.mockups)
  })

  it('gates the un-watermarked clean art out once a watermarked display exists', () => {
    const images = getGalleryImages(p({ metadata: { assets }, images: [assets.clean] }))
    expect(images).not.toContain(assets.clean)
  })

  it('does show the clean art when there is no watermarked variant', () => {
    const noDisplay = { clean: assets.clean, mockups: assets.mockups, halftone: assets.halftone, dtf: assets.dtf }
    const images = getGalleryImages(p({ metadata: { assets: noDisplay }, images: [] }))
    expect(images).toContain(assets.clean)
    expect(images).not.toContain(assets.halftone)
  })

  it('picks up the legacy single mockup_url and dedupes repeats', () => {
    const images = getGalleryImages(p({
      metadata: { assets: { mockups: ['https://cdn/m1.png'] }, mockup_url: 'https://cdn/m1.png' },
      images: ['https://cdn/m1.png', 'https://cdn/raw.png']
    }))
    expect(images).toEqual(['https://cdn/m1.png', 'https://cdn/raw.png'])
  })

  it('drops empty and non-string image entries', () => {
    const images = getGalleryImages(p({ metadata: {}, images: ['', null as never, 'https://cdn/ok.png'] }))
    expect(images).toEqual(['https://cdn/ok.png'])
  })

  it('returns an empty list for a product with no images at all', () => {
    expect(getGalleryImages(p({}))).toEqual([])
  })
})

describe('digital deliverables bundle', () => {
  it('lists design, halftone and DTF in that order', () => {
    const out = getDeliverables(p({ metadata: { assets: { dtf: 'd.png', clean: 'c.png', halftone: 'h.png' } } }))
    expect(out.map(d => d.kind)).toEqual(['design', 'halftone', 'dtf'])
    expect(out[0].url).toBe('c.png')
  })

  it('omits the files a product does not have', () => {
    const out = getDeliverables(p({ metadata: { assets: { halftone: 'h.png' } } }))
    expect(out.map(d => d.kind)).toEqual(['halftone'])
  })

  it('flags a product as having downloads only when a deliverable file exists', () => {
    expect(hasDigitalDeliverables(p({ metadata: { assets: { dtf: 'd.png' } } }))).toBe(true)
    expect(hasDigitalDeliverables(p({ metadata: { assets: { clean: 'c.png' } } }))).toBe(true)
    // A mockup or display image alone is not a purchasable download.
    expect(hasDigitalDeliverables(p({ metadata: { assets: { mockups: ['m.png'], display: 'd.png' } } }))).toBe(false)
    expect(hasDigitalDeliverables(p({}))).toBe(false)
  })

  it('tolerates a malformed assets blob', () => {
    expect(getProductAssets(p({ metadata: { assets: 'not-an-object' } }))).toEqual({})
    expect(getProductAssets(p({}))).toEqual({})
  })
})
