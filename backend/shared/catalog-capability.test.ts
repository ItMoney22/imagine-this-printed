// Tests for the ITP catalog capability boundary — the one list of what ITP can
// physically make (David 2026-09-01: "we have a lot of products that we can't
// even post to Etsy because we don't even do embroidery"). Every consumer
// (Mrs. Imagine, the Step Flow builder, etsy-model-shots, the step-flow
// routes) trusts this module to keep polo/tank/embroidery/sublimation out —
// so the boundary itself needs a direct test, not just downstream coverage.
import { describe, it, expect } from 'vitest'
import {
  GARMENTS,
  GARMENT_IDS,
  COLORS,
  NOT_OFFERED,
  getGarment,
  isOfferedGarment,
  colorsForGarment,
  isColorOfferedOn,
  assertOffered,
  normalizeGarment,
  normalizeColor,
  sizesForGarment,
  adultSizesForGarment,
  youthSizesForGarment,
  isYouthSize,
  youthDiscountCents,
  blankForSize,
  printWidthForSize,
  YOUTH_SIZE_DISCOUNT_CENTS,
  audienceForGarment,
  isYouthGarment,
} from './catalog-capability.js'

// Pure module — no Supabase, no network.

describe('normalizeGarment — legacy/loose strings collapse to the offered set', () => {
  it('rejects polo — ITP does not make polos', () => {
    expect(normalizeGarment('polo')).toBeNull()
  })

  it('rejects tank and other not-offered garments', () => {
    expect(normalizeGarment('tank')).toBeNull()
    expect(normalizeGarment('embroidery')).toBeNull()
  })

  it('maps common tee spellings to tshirt', () => {
    for (const v of ['tshirt', 't-shirt', 'tee', 't-shirts', 'shirts', 'shirt', 'TSHIRT', ' Tee ']) {
      expect(normalizeGarment(v), `"${v}" should normalize to tshirt`).toBe('tshirt')
    }
  })

  it('maps hoodie spellings to hoodie', () => {
    for (const v of ['hoodie', 'hoodies', 'hooded sweatshirt']) {
      expect(normalizeGarment(v)).toBe('hoodie')
    }
  })

  it('is null for empty/unknown input', () => {
    expect(normalizeGarment('')).toBeNull()
    expect(normalizeGarment(null)).toBeNull()
    expect(normalizeGarment(undefined)).toBeNull()
    expect(normalizeGarment('spaceship')).toBeNull()
  })
})

describe('assertOffered — the hard gate downstream code relies on', () => {
  it('passes a garment/color combo ITP actually offers', () => {
    expect(() => assertOffered('tshirt', 'royal-blue')).not.toThrow()
  })

  it('throws for a color not offered on that garment (hoodie has no royal-blue)', () => {
    expect(() => assertOffered('hoodie', 'royal-blue')).toThrow()
  })

  it('throws for a garment ITP does not make at all', () => {
    expect(() => assertOffered('polo')).toThrow()
    expect(() => assertOffered('tank', 'black')).toThrow()
  })

  it('passes with no color argument when the garment alone is offered', () => {
    expect(() => assertOffered('hoodie')).not.toThrow()
  })
})

describe('NOT_OFFERED — the explicit deny list', () => {
  it('contains polo and embroidery', () => {
    expect(NOT_OFFERED).toContain('polo')
    expect(NOT_OFFERED).toContain('embroidery')
  })

  it('contains tank and sublimation-garment too', () => {
    expect(NOT_OFFERED).toContain('tank')
    expect(NOT_OFFERED).toContain('sublimation-garment')
  })

  it('never overlaps with what GARMENTS actually offers', () => {
    for (const id of GARMENT_IDS) {
      expect((NOT_OFFERED as readonly string[]).includes(id)).toBe(false)
    }
  })
})

describe('GARMENTS / colorsForGarment — the offered catalog shape', () => {
  it('offers exactly the adult tee, the hoodie and the youth tee', () => {
    expect(GARMENT_IDS.sort()).toEqual(['hoodie', 'tshirt', 'youth-tshirt'])
  })

  it('getGarment resolves a real id and rejects an unoffered one', () => {
    expect(getGarment('tshirt')?.label).toBe('T-Shirt')
    expect(getGarment('polo')).toBeNull()
    expect(getGarment(null)).toBeNull()
  })

  it('isOfferedGarment narrows correctly', () => {
    expect(isOfferedGarment('hoodie')).toBe(true)
    expect(isOfferedGarment('polo')).toBe(false)
  })

  it('colorsForGarment only returns colors that garment actually offers', () => {
    const hoodieColors = colorsForGarment('hoodie').map((c) => c.id)
    expect(hoodieColors).not.toContain('royal-blue')
    expect(hoodieColors).toContain('black')
  })

  it('isColorOfferedOn agrees with colorsForGarment', () => {
    expect(isColorOfferedOn('tshirt', 'royal-blue')).toBe(true)
    expect(isColorOfferedOn('hoodie', 'royal-blue')).toBe(false)
  })

  it('every garment color id resolves in COLORS', () => {
    for (const g of GARMENTS) {
      for (const c of g.colors) {
        expect(COLORS[c], `${g.id} lists color "${c}" which is missing from COLORS`).toBeDefined()
      }
    }
  })
})

describe('normalizeColor — loose color strings → capability ids', () => {
  it('passes through an already-valid id', () => {
    expect(normalizeColor('black')).toBe('black')
  })

  it('maps common aliases', () => {
    expect(normalizeColor('gray')).toBe('heather-grey')
    expect(normalizeColor('Heather Gray')).toBe('heather-grey')
    expect(normalizeColor('green')).toBe('forest-green')
    expect(normalizeColor('blue')).toBe('royal-blue')
  })

  it('resolves by hex value', () => {
    expect(normalizeColor('#000000')).toBe('black')
  })

  it('is null for unknown colors', () => {
    expect(normalizeColor('mauve')).toBeNull()
    expect(normalizeColor('')).toBeNull()
  })
})

// David 2026-09-03: the youth tee was added so a kids' design could be
// photographed on a kid AND still be a listing we can fulfil. The audience
// flag is what every downstream surface reads to decide who may appear in a
// photo, so it is the boundary that matters most here.
describe('audience — who physically wears a garment', () => {
  it('marks the youth tee youth and everything else adult', () => {
    expect(audienceForGarment('youth-tshirt')).toBe('youth')
    expect(isYouthGarment('youth-tshirt')).toBe(true)
    expect(audienceForGarment('tshirt')).toBe('adult')
    expect(audienceForGarment('hoodie')).toBe('adult')
  })

  it('treats an unknown or missing garment as ADULT — the answer that never puts a child in a photo by accident', () => {
    expect(audienceForGarment('polo')).toBe('adult')
    expect(audienceForGarment(null)).toBe('adult')
    expect(audienceForGarment(undefined)).toBe('adult')
    expect(isYouthGarment('something-new')).toBe(false)
  })

  it('normalizes youth strings to the youth tee, never to the adult one', () => {
    for (const v of ['youth-tshirt', 'Youth T-Shirt', 'kids tee', 'YOUTH TEE']) {
      expect(normalizeGarment(v)).toBe('youth-tshirt')
    }
    // The adult aliases must not have been captured by the youth match.
    expect(normalizeGarment('tshirt')).toBe('tshirt')
    expect(normalizeGarment('tee')).toBe('tshirt')
  })
})

describe('sizesForGarment — the one place sizes are declared', () => {
  it('sells the adult band AND the youth band on the same shirt listing', () => {
    expect(sizesForGarment('tshirt')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', 'YXS', 'YS', 'YM', 'YL', 'YXL'])
  })

  it('sells the youth band on hoodies too — David 2026-09-07, "shirts AND hoodies"', () => {
    expect(sizesForGarment('hoodie')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', 'YXS', 'YS', 'YM', 'YL', 'YXL'])
  })

  it('never lists a youth size twice on the garment that already IS a youth cut', () => {
    expect(sizesForGarment('youth-tshirt')).toEqual(['YXS', 'YS', 'YM', 'YL', 'YXL'])
  })

  it('separates the adult band from the youth band', () => {
    expect(adultSizesForGarment('tshirt')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL'])
    expect(youthSizesForGarment('tshirt')).toEqual(['YXS', 'YS', 'YM', 'YL', 'YXL'])
    expect(youthSizesForGarment('youth-tshirt')).toEqual([])
  })

  it('falls back to the adult tee range plus youth for an unknown garment', () => {
    expect(sizesForGarment('polo')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', 'YXS', 'YS', 'YM', 'YL', 'YXL'])
    expect(sizesForGarment(null)).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', 'YXS', 'YS', 'YM', 'YL', 'YXL'])
  })

  it('pulls the YOUTH blank for a youth size and the adult blank otherwise', () => {
    // A 'YM' line on a t-shirt listing is a Gildan 5000B, not a small 5000 —
    // this is the fact fulfilment reads off the order.
    expect(blankForSize('tshirt', 'YM')).toBe('Gildan 5000B Heavy Cotton Youth')
    expect(blankForSize('tshirt', 'M')).toBe('Gildan 5000 Heavy Cotton')
    expect(blankForSize('hoodie', 'YL')).toBe('Gildan 18500B Heavy Blend Youth')
    expect(blankForSize('hoodie', 'L')).toBe('Gildan 18500 Heavy Blend')
  })

  it('narrows the print for a youth size on an adult listing', () => {
    // An 11-inch adult print is wider than a youth medium's whole body.
    expect(printWidthForSize('tshirt', 'YM')).toBe(8)
    expect(printWidthForSize('tshirt', 'M')).toBe(11)
    expect(printWidthForSize('hoodie', 'YM')).toBe(8)
  })

  it('returns a copy, so a caller cannot mutate the catalog', () => {
    const sizes = sizesForGarment('youth-tshirt')
    sizes.push('4XL')
    expect(sizesForGarment('youth-tshirt')).not.toContain('4XL')
  })

  it('prints the youth tee smaller than the adult one', () => {
    expect(getGarment('youth-tshirt')!.printWidthInches).toBeLessThan(getGarment('tshirt')!.printWidthInches)
  })
})

describe('isYouthSize / youthDiscountCents — the youth price rail', () => {
  it('recognises the canonical codes', () => {
    for (const sz of ['YXS', 'YS', 'YM', 'YL', 'YXL']) expect(isYouthSize(sz)).toBe(true)
  })

  it('recognises the spelled-out Etsy variation label', () => {
    // The Etsy axis lists "Youth M", not "YM" — an order coming back from Etsy
    // must still earn the discount, or the two channels disagree on price.
    expect(isYouthSize('Youth M')).toBe(true)
    expect(isYouthSize('youth xl')).toBe(true)
    expect(isYouthSize(' Youth S ')).toBe(true)
  })

  it('never matches an adult size, a metal panel size, or junk', () => {
    for (const sz of ['S', 'M', 'L', 'XL', '2XL', '3XL', '4x6', '8x10', '', null, undefined]) {
      expect(isYouthSize(sz as any)).toBe(false)
    }
  })

  it('does not match a bare Y or a size that merely starts with one', () => {
    expect(isYouthSize('Y')).toBe(false)
    expect(isYouthSize('YXXL')).toBe(false)
  })

  it('discounts youth sizes only', () => {
    expect(youthDiscountCents('YM')).toBe(YOUTH_SIZE_DISCOUNT_CENTS)
    expect(youthDiscountCents('M')).toBe(0)
  })

  it('every youth size in the catalog is recognised by the price rail', () => {
    // The bug this guards: adding a size to a garment's youth band without
    // teaching isYouthSize about it would sell it at the adult price.
    for (const g of GARMENTS) {
      for (const sz of youthSizesForGarment(g.id)) expect(isYouthSize(sz)).toBe(true)
    }
  })

  it('no adult size anywhere in the catalog is mistaken for a youth size', () => {
    for (const g of GARMENTS) {
      if (g.audience === 'youth') continue
      for (const sz of adultSizesForGarment(g.id)) expect(isYouthSize(sz)).toBe(false)
    }
  })
})
