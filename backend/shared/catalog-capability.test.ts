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
  it('gives the youth tee its own range, not the adult one', () => {
    expect(sizesForGarment('youth-tshirt')).toEqual(['YXS', 'YS', 'YM', 'YL', 'YXL'])
    expect(sizesForGarment('tshirt')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL'])
  })

  it('falls back to the adult tee range for an unknown garment (the historical default)', () => {
    expect(sizesForGarment('polo')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL'])
    expect(sizesForGarment(null)).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL'])
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
