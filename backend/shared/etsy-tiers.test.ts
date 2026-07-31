import { describe, it, expect } from 'vitest'
import {
  ETSY_TIERS,
  DOWNLOAD_PRICE,
  TRANSFER_BASE_PRICE,
  TRANSFER_SHEET_SIZES,
  etsyTierConfig,
  isEtsyTier,
  tierCopy,
  tiersForCategory
} from './etsy-tiers.js'

// Pure module — no Supabase, no network, no env required beyond the optional
// price overrides, so it needs none of the dynamic-import dance the worker
// tests do.

const LIMITS = { maxTitleLen: 140, maxTags: 13 }

// Real titles the composer has produced for live ITP products — the transform
// has to survive the shapes it will actually be handed, not invented ones.
const REAL_TITLES = [
  'Graffiti Roaring Lion Face Streetwear T-Shirt | Unisex Graphic Tee',
  'LEVEL UP ACADEMY Retro Varsity T-Shirt | Unisex Graphic Tee',
  'Customizable School Icon Design Template Tee',
  'Golden Senior Sparkle Tee | Class of 2026 Graphic T-Shirt',
  'Simply Be You Retro Varsity T-Shirt | Unisex Graphic Tee',
  'Walk By Faith Christian Hoodie'
]

const packFor = (title: string) => ({
  title,
  description: 'A bold graffiti lion rendered in neon spray-paint style.',
  tags: ['graffiti lion', 'streetwear tee', 'neon graphic', 'urban art shirt', 'gift for him']
})

describe('tier eligibility', () => {
  it('offers all three tiers on pressable apparel categories', () => {
    for (const cat of ['shirts', 't-shirts', 'hoodies', 'dtf-transfers']) {
      expect(tiersForCategory(cat)).toEqual(['primary', 'transfer', 'download'])
    }
  })

  it('gives metal art the primary tier only — a wall panel has no press or press-ready file', () => {
    expect(tiersForCategory('metal-art')).toEqual(['primary'])
  })

  it('falls back to primary for unknown or missing categories rather than over-offering', () => {
    expect(tiersForCategory('3d-prints')).toEqual(['primary'])
    expect(tiersForCategory(null)).toEqual(['primary'])
  })
})

describe('pricing', () => {
  it('puts the download at $3 after the standing 40% shop sale (David locked $3)', () => {
    expect(DOWNLOAD_PRICE * 0.6).toBeCloseTo(3, 5)
  })

  it('anchors the transfer listing at its cheapest sheet so it reads "from"', () => {
    expect(TRANSFER_BASE_PRICE).toBe(Math.min(...TRANSFER_SHEET_SIZES.map(s => s.price)))
  })

  it('ladders the sheet prices upward with size', () => {
    const prices = TRANSFER_SHEET_SIZES.map(s => s.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(new Set(prices).size).toBe(prices.length)
  })

  it('clears Etsy fixed per-sale costs (~$0.45) with margin left at the sale price', () => {
    for (const p of [DOWNLOAD_PRICE, ...TRANSFER_SHEET_SIZES.map(s => s.price)]) {
      const shown = p * 0.6
      const net = shown - (0.25 + 0.2) - shown * 0.095 // processing+listing, then 6.5% txn + 3% processing
      expect(net).toBeGreaterThan(0)
    }
  })
})

describe('listing shape', () => {
  it('makes only the download tier a digital listing, and only it demand a file', () => {
    expect(etsyTierConfig('download').listingType).toBe('download')
    expect(etsyTierConfig('download').requiresSourceFile).toBe(true)
    for (const t of ['primary', 'transfer'] as const) {
      expect(etsyTierConfig(t).listingType).toBe('physical')
      expect(etsyTierConfig(t).requiresSourceFile).toBe(false)
    }
  })

  it('uses the taxonomy nodes resolved against the live Etsy API', () => {
    expect(etsyTierConfig('transfer').taxonomyId).toBe(6617) // Image Transfers
    expect(etsyTierConfig('download').taxonomyId).toBe(6844) // Clip Art & Image Files
  })

  it('leaves the primary tier deferring to the ITP category map', () => {
    expect(etsyTierConfig('primary').taxonomyId).toBeNull()
    expect(etsyTierConfig('primary').price).toBeNull()
  })
})

describe('tier copy', () => {
  it('passes the primary tier through completely untouched', () => {
    for (const title of REAL_TITLES) {
      const pack = packFor(title)
      expect(tierCopy('primary', pack, LIMITS)).toEqual(pack)
    }
  })

  // The pack title was written for a tee. Selling a FILE called "...T-Shirt" is
  // a false promise about what ships, and Etsy treats that as a mis-listing.
  it.each(['transfer', 'download'] as const)('strips garment words out of %s titles', tier => {
    for (const title of REAL_TITLES) {
      const out = tierCopy(tier, packFor(title), LIMITS)
      expect(out.title, `leaked in: ${out.title}`).not.toMatch(/\b(t-?shirts?|tees?|hoodies?|sweatshirts?|apparel)\b/i)
    }
  })

  it.each(['transfer', 'download'] as const)('keeps %s titles substantive and inside Etsy limits', tier => {
    for (const title of REAL_TITLES) {
      const out = tierCopy(tier, packFor(title), LIMITS)
      expect(out.title.length).toBeLessThanOrEqual(LIMITS.maxTitleLen)
      // Guards the strip regex eating the whole title on a title that is
      // nothing but garment words.
      expect(out.title.trim().length).toBeGreaterThan(10)
      expect(out.title).not.toMatch(/\|\s*$/)
      expect(out.title).not.toMatch(/\s{2,}/)
    }
  })

  it.each(['transfer', 'download'] as const)('returns deduped, capped tags for %s', tier => {
    const out = tierCopy(tier, packFor(REAL_TITLES[0]), LIMITS)
    expect(out.tags.length).toBeLessThanOrEqual(LIMITS.maxTags)
    expect(new Set(out.tags.map(t => t.toLowerCase())).size).toBe(out.tags.length)
    // Tier-defining phrases lead, so the listing is findable as what it is.
    expect(out.tags[0]).toMatch(tier === 'transfer' ? /dtf transfer/i : /digital download/i)
  })

  it('states the personal-use license and that nothing ships, on every download', () => {
    for (const title of REAL_TITLES) {
      const d = tierCopy('download', packFor(title), LIMITS).description
      expect(d).toMatch(/PERSONAL USE ONLY/)
      expect(d).toMatch(/may NOT resell/i)
      expect(d).toMatch(/not a physical item/i)
      expect(d).toMatch(/300 DPI PNG/)
    }
  })

  it('sets press expectations and lists sheet sizes on every transfer', () => {
    for (const title of REAL_TITLES) {
      const d = tierCopy('transfer', packFor(title), LIMITS).description
      expect(d).toMatch(/no garment is included/i)
      expect(d).toMatch(/heat press/i)
      for (const s of TRANSFER_SHEET_SIZES) expect(d).toContain(s.key)
    }
  })

  it('carries the design description into the tier copy so the artwork is still described', () => {
    const pack = packFor(REAL_TITLES[0])
    for (const tier of ['transfer', 'download'] as const) {
      expect(tierCopy(tier, pack, LIMITS).description).toContain(pack.description)
    }
  })

  it('survives a title made only of garment words without collapsing', () => {
    const out = tierCopy('download', packFor('T-Shirt Tee Hoodie'), LIMITS)
    expect(out.title.trim().length).toBeGreaterThan(10)
  })
})

describe('isEtsyTier', () => {
  it('accepts exactly the known tiers and rejects everything else', () => {
    for (const t of ETSY_TIERS) expect(isEtsyTier(t)).toBe(true)
    for (const v of ['shirt', 'PRIMARY', '', null, undefined, 42, {}]) {
      expect(isEtsyTier(v)).toBe(false)
    }
  })
})
