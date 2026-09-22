// Tests for the ITP catalog capability boundary — the one list of what ITP can
// physically make (David 2026-09-01: "we have a lot of products that we can't
// even post to Etsy because we don't even do embroidery"). Every consumer
// (Mrs. Imagine, the Step Flow builder, etsy-model-shots, the step-flow
// routes) trusts this module to keep polo/tank/embroidery/sublimation out —
// so the boundary itself needs a direct test, not just downstream coverage.
import { describe, it, expect, afterEach } from 'vitest'
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
  isPlusSize,
  PLUS_SIZE_UPCHARGE_CENTS,
  audienceForGarment,
  isYouthGarment,
  MANUFACTURING_METHODS,
  methodForLine,
  decorationPhraseForCategory,
  lineForCategory,
  isLineOnHold,
  isCategoryOnHold,
  holdReasonFor,
  heldLines,
  BANNED_DECORATION_TERMS,
  findBannedDecorationTerms,
  scanListingCopy,
  assertCopyIsFulfillable,
  bannedVocabularyRule,
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

describe('isPlusSize — one definition, formerly copy-pasted into four files', () => {
  it('charges 2XL and up', () => {
    for (const sz of ['2XL', 'XXL', '3XL', '4XL', '5XL']) expect(isPlusSize(sz)).toBe(true)
  })

  it('leaves S-XL alone', () => {
    for (const sz of ['S', 'M', 'L', 'XL']) expect(isPlusSize(sz)).toBe(false)
  })

  it('never treats a metal-art panel size as a plus size', () => {
    // '4x6'.toUpperCase() contains the '4X' token. This false positive
    // overcharged metal prints $2.50 until it was fixed in three separate
    // copies on 2026-09-02 — the reason the rule now lives in one place.
    expect(isPlusSize('4x6')).toBe(false)
    expect(isPlusSize('8x10')).toBe(false)
  })

  it('never charges a parent the plus-size upcharge on a youth shirt', () => {
    for (const sz of ['YXL', 'Youth XL', 'YM']) expect(isPlusSize(sz)).toBe(false)
  })

  it('handles empty input', () => {
    for (const sz of ['', null, undefined]) expect(isPlusSize(sz as any)).toBe(false)
  })

  it('the two rails cannot both fire on the same size', () => {
    for (const g of GARMENTS) {
      for (const sz of sizesForGarment(g.id)) {
        expect(isPlusSize(sz) && isYouthSize(sz), `${sz} matched both rails`).toBe(false)
      }
    }
  })

  it('keeps the upcharge and the discount at the values the storefront shows', () => {
    expect(PLUS_SIZE_UPCHARGE_CENTS).toBe(250)
    expect(YOUTH_SIZE_DISCOUNT_CENTS).toBe(300)
  })
})


// ---------------------------------------------------------------------------
// Manufacturing methods, product-line holds, and the banned decoration
// vocabulary (Watchtower 72adcc9c). David 2026-09-01: Mrs. Imagine kept
// shipping listings that claimed embroidery and polos — 18 live products said
// "embroidered", 23 said "polo". These are the rails that make that
// impossible rather than unlikely.
// ---------------------------------------------------------------------------
describe('manufacturing methods', () => {
  it('offers DTF on apparel and sublimation on metal — and never the reverse', () => {
    const dtf = MANUFACTURING_METHODS.find(m => m.id === 'dtf')!
    const sub = MANUFACTURING_METHODS.find(m => m.id === 'sublimation')!
    expect(dtf.lines).toEqual(['apparel'])
    // The whole point of the split: sublimation is real HERE but never on a
    // garment (David 2026-08-24, task 9ff3919c).
    expect(sub.lines).toContain('metal-art')
    expect(sub.lines).toContain('tumblers')
    expect(sub.lines).not.toContain('apparel')
  })

  it('never lists embroidery, screen print or vinyl as a method', () => {
    const ids = MANUFACTURING_METHODS.map(m => m.id as string)
    for (const cannot of ['embroidery', 'screen-print', 'vinyl', 'htv']) {
      expect(ids).not.toContain(cannot)
    }
  })

  it('hands apparel copy a DTF phrase to quote verbatim', () => {
    expect(methodForLine('apparel')!.copyPhrase).toMatch(/DTF/i)
    expect(decorationPhraseForCategory('t-shirts')).toMatch(/DTF/i)
    expect(decorationPhraseForCategory('hoodies')).toMatch(/DTF/i)
    expect(decorationPhraseForCategory('metal-art')).toMatch(/sublimat/i)
  })
})

describe('product line holds', () => {
  const ORIGINAL = process.env.ITP_METAL_ART_HOLD
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ITP_METAL_ART_HOLD
    else process.env.ITP_METAL_ART_HOLD = ORIGINAL
  })

  it('holds metal art by default — the hold survives a deploy with no env set', () => {
    delete process.env.ITP_METAL_ART_HOLD
    expect(isLineOnHold('metal-art')).toBe(true)
    expect(isCategoryOnHold('metal-art')).toBe(true)
    expect(holdReasonFor('metal-art')).toMatch(/c11af937/)
    expect(heldLines().map(l => l.id)).toContain('metal-art')
  })

  it('lets the env var lift the hold without a code change', () => {
    process.env.ITP_METAL_ART_HOLD = 'false'
    expect(isLineOnHold('metal-art')).toBe(false)
    expect(holdReasonFor('metal-art')).toBeNull()
    expect(heldLines().map(l => l.id)).not.toContain('metal-art')
  })

  it('leaves apparel running', () => {
    expect(isLineOnHold('apparel')).toBe(false)
    expect(isCategoryOnHold('t-shirts')).toBe(false)
    expect(isCategoryOnHold('hoodies')).toBe(false)
  })

  it('treats a category it has never heard of as NOT held', () => {
    // '3d-prints' is a real live lane this module does not model. Blocking it
    // on ignorance would take a working line off the shelf.
    expect(isCategoryOnHold('3d-prints')).toBe(false)
    expect(isCategoryOnHold(null)).toBe(false)
    expect(lineForCategory('3d-prints')).toBeNull()
  })
})

describe('banned decoration vocabulary', () => {
  it('catches every term the acceptance criteria name', () => {
    const cases: Array<[string, string]> = [
      ['Hand embroidered patch design', 'embroidery'],
      ['Carefully stitched lettering', 'stitching'],
      ['Classic screen print look', 'screen printing'],
      ['Durable vinyl decal', 'vinyl / HTV'],
      ['Laser engraved aluminium', 'engraving'],
      ['Soft knit cotton blend', 'knitting'],
      ['Tightly woven fabric', 'weaving'],
    ]
    for (const [text, label] of cases) {
      const hits = findBannedDecorationTerms(text)
      expect(hits.map(h => h.label), `"${text}" must be caught`).toContain(label)
    }
  })

  it('catches the NOT_OFFERED garments as copy claims too', () => {
    expect(findBannedDecorationTerms('Retro Polo Shirt for Dad').map(h => h.label)).toContain('polo shirt')
    expect(findBannedDecorationTerms('Summer tank top').map(h => h.label)).toContain('tank top')
    expect(findBannedDecorationTerms('Summer tanktop').map(h => h.label)).toContain('tank top')
  })

  it('is case-insensitive and catches word variants', () => {
    for (const v of ['EMBROIDERED', 'Embroidery', 'embroidering', 'Screen-Printed', 'silk screened', 'HTV']) {
      expect(findBannedDecorationTerms(v).length, `"${v}" must be caught`).toBeGreaterThan(0)
    }
  })

  it('is STATELESS — the same text scans identically every time', () => {
    // A shared /g RegExp carries lastIndex between calls and skips matches on
    // every second scan. The batch runner calls this in a loop, so a stateful
    // filter would let every other listing through.
    const text = 'Embroidered polo with vinyl accents'
    const first = findBannedDecorationTerms(text)
    for (let i = 0; i < 5; i++) {
      expect(findBannedDecorationTerms(text)).toEqual(first)
    }
    expect(first.length).toBe(3)
  })

  it('leaves honest DTF copy alone', () => {
    const clean =
      'A bold retro sunset emblem printed with a DTF transfer, heat-pressed onto a soft ' +
      'cotton t-shirt. Made to order in Georgia, machine washable, and built to last wash after wash.'
    expect(findBannedDecorationTerms(clean)).toEqual([])
    expect(scanListingCopy({ title: 'Retro Sunset Emblem Tee', description: clean, tags: ['retro sunset tee', 'dtf print'] })).toEqual([])
  })

  it('reports which FIELD the claim came from', () => {
    const hits = scanListingCopy({
      title: 'Clean Title Here',
      description: 'A lovely embroidered crest.',
      tags: ['polo shirt', 'gift'],
    })
    expect(hits.find(h => h.label === 'embroidery')!.field).toBe('description')
    expect(hits.find(h => h.label === 'polo shirt')!.field).toBe('tags')
  })

  it('assertCopyIsFulfillable throws on a dirty listing and names the words', () => {
    expect(() =>
      assertCopyIsFulfillable({ title: 'Embroidered Eagle Polo', description: 'x', tags: [] }, 'test copy')
    ).toThrow(/embroider/i)
    expect(() => assertCopyIsFulfillable({ title: 'Clean Eagle Tee', description: 'x', tags: ['eagle tee'] })).not.toThrow()
  })

  it('puts every banned word into the prompt rule, so prompt and filter cannot drift', () => {
    const rule = bannedVocabularyRule()
    for (const term of BANNED_DECORATION_TERMS) {
      expect(rule.toLowerCase(), `rule must mention "${term.label}"`).toContain(term.label.split(' ')[0].toLowerCase())
    }
  })
})
