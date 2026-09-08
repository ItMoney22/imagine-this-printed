import { describe, it, expect, beforeEach, vi } from 'vitest'

// The repair module persists through Supabase, but everything that decides
// WHAT to write is pure. The stub exists so the one persisting function can be
// exercised too; `repairCopy` itself never touches it.
const db: { product: any; updates: any[] } = { product: null, updates: [] }
vi.mock('../lib/supabase.js', () => {
  const chain = (): any => {
    const c: any = {}
    c.select = () => c
    c.eq = () => c
    c.update = (patch: any) => {
      db.updates.push(patch)
      return { eq: async () => ({ error: null }) }
    }
    c.maybeSingle = async () => ({ data: db.product, error: null })
    return c
  }
  return { supabase: { from: () => chain() } }
})

const { repairCopy, repairEtsyPack, subjectPhrases, kindOf } = await import('./etsy-copy-repair.js')
const { checkSeo, DESCRIPTION_MIN_CHARS, SEO_RULES } = await import('./presentation-qa.js')
const { MAX_TAGS, MAX_TAG_LEN } = await import('./etsy-listing-fields.js')

const blockingOf = (title: string, tags: string[], description: string) =>
  checkSeo({ channel: 'etsy', title, description, tags }).findings.filter(f => f.severity === 'block')

const base = {
  channel: 'etsy' as const,
  name: 'Stoic Samurai Cherry Blossom',
  category: 'shirts' as string | null,
  garment: 'tshirt',
  keywords: null as string | null,
  title: 'Stoic Samurai Cherry Blossom',
  description: '',
  tags: [] as string[],
}

// ---------------------------------------------------------------------------
// The case that started this: David's 2026-09-08 screenshot. A 32-character
// title, ZERO tags, a thin description — the mechanical fallback firing with no
// model and no keywords. If the deterministic repair cannot clear THIS, the
// Step Flow still dead-ends for the exact reason it already did.
// ---------------------------------------------------------------------------
describe('repairCopy — the no-model floor', () => {
  it('clears every blocking SEO finding on the mechanical-fallback listing', () => {
    const before = blockingOf(base.title, base.tags, base.description)
    expect(before.length).toBeGreaterThan(0)

    const fixed = repairCopy(base)
    expect(blockingOf(fixed.title, fixed.tags, fixed.description)).toEqual([])
  })

  it('grows the title into the ideal band rather than merely over the minimum', () => {
    const fixed = repairCopy(base)
    expect(fixed.title.length).toBeGreaterThanOrEqual(SEO_RULES.etsy.titleIdeal[0])
    expect(fixed.title.length).toBeLessThanOrEqual(SEO_RULES.etsy.titleIdeal[1])
    // The design's own identity survives — a repair that renames the product
    // is not a repair.
    expect(fixed.title).toContain('Stoic Samurai Cherry Blossom')
  })

  it('fills all 13 tag slots with legal, non-filler, non-duplicate phrases', () => {
    const { tags } = repairCopy(base)
    expect(tags).toHaveLength(MAX_TAGS)
    for (const t of tags) expect(t.length).toBeLessThanOrEqual(MAX_TAG_LEN)
    expect(new Set(tags.map(t => t.toLowerCase())).size).toBe(tags.length)
    // Tags about THIS design, not just category boilerplate.
    expect(tags.some(t => /samurai|cherry|blossom|stoic/i.test(t))).toBe(true)
  })

  it('writes a description over the gate minimum with a standalone hook', () => {
    const { description } = repairCopy(base)
    expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN_CHARS)
    expect(description.split('\n')[0].length).toBeLessThanOrEqual(155)
    expect(description).toMatch(/Rockmart, Georgia/)
  })

  it('reports what it changed in plain sentences', () => {
    const { changes } = repairCopy(base)
    expect(changes.length).toBeGreaterThan(0)
    for (const c of changes) expect(c).not.toMatch(/undefined|NaN|\[object/)
  })
})

describe('repairCopy — title defects', () => {
  it('rewrites a comma-stacked keyword title as a readable phrase', () => {
    const fixed = repairCopy({
      ...base,
      title: 'Samurai Shirt, Samurai Tee, Japanese Shirt, Cherry Blossom Tee, Warrior Shirt',
    })
    expect((fixed.title.match(/,/g) || []).length).toBeLessThanOrEqual(2)
    expect(blockingOf(fixed.title, fixed.tags, fixed.description)).toEqual([])
  })

  it('strips emoji, which Etsy does not index', () => {
    const fixed = repairCopy({ ...base, title: 'Stoic Samurai Cherry Blossom 🌸 Tee' })
    expect(fixed.title).not.toMatch(/🌸/u)
  })

  it('cuts an over-long title on a word boundary', () => {
    const fixed = repairCopy({ ...base, title: `${'Cherry Blossom Samurai Warrior Graphic '.repeat(6)}Tee` })
    expect(fixed.title.length).toBeLessThanOrEqual(SEO_RULES.etsy.titleMax)
    expect(fixed.title.endsWith(' ')).toBe(false)
    expect(blockingOf(fixed.title, fixed.tags, fixed.description)).toEqual([])
  })
})

describe('repairCopy — tag defects', () => {
  it('drops filler, duplicates and over-length tags and backfills the slots', () => {
    const fixed = repairCopy({
      ...base,
      tags: ['shirt', 'Shirt', 'gift', 'a really long keyword phrase that no tag can hold', 'samurai tee'],
    })
    expect(fixed.tags.map(t => t.toLowerCase())).not.toContain('shirt')
    expect(fixed.tags.map(t => t.toLowerCase())).not.toContain('gift')
    expect(fixed.tags).toContain('samurai tee')
    expect(fixed.tags).toHaveLength(MAX_TAGS)
    expect(blockingOf(fixed.title, fixed.tags, fixed.description)).toEqual([])
  })

  it('prefers the catalogue keywords over generic bank phrases', () => {
    const fixed = repairCopy({ ...base, keywords: 'bushido art tee, sakura graphic, ronin apparel' })
    expect(fixed.tags).toContain('bushido art tee')
    expect(fixed.tags).toContain('sakura graphic')
  })
})

describe('repairCopy — description defects', () => {
  it('trims an over-long opening line but keeps the rest of the copy', () => {
    const longHook = `${'A very long opening sentence about this design that keeps going. '.repeat(4)}`
    const fixed = repairCopy({ ...base, description: `${longHook}\n\nSecond paragraph worth keeping.` })
    expect(fixed.description.split('\n')[0].length).toBeLessThanOrEqual(155)
    expect(fixed.description).toContain('Second paragraph worth keeping.')
  })

  it('leaves a description that already passes completely alone', () => {
    const good = [
      'A soft unisex tee with a stoic samurai standing under falling cherry blossoms.',
      '',
      'The design is printed with vivid DTF ink so it stays bright wash after wash, and the shirt itself is a',
      'soft unisex tee with a classic fit. Size up if you want it oversized. Every shirt is printed by hand in',
      'Rockmart, Georgia once you order. Machine wash cold, inside out, and tumble dry low.',
    ].join('\n')
    const fixed = repairCopy({ ...base, description: good })
    expect(fixed.description).toBe(good)
  })
})

describe('repairCopy — product kinds', () => {
  it('writes hoodie copy for a hoodie, not tee copy', () => {
    const fixed = repairCopy({ ...base, category: 'hoodies', garment: 'hoodie' })
    expect(fixed.description).toMatch(/hoodie/i)
    expect(fixed.description).not.toMatch(/soft unisex tee/i)
    expect(fixed.tags.some(t => /hoodie|sweatshirt/i.test(t))).toBe(true)
  })

  it('writes wall-art copy for a metal print and never claims a garment', () => {
    const fixed = repairCopy({ ...base, category: 'metal-art', garment: null, name: 'Neon Koi Pond' })
    expect(fixed.description).toMatch(/wall|panel/i)
    expect(fixed.description).not.toMatch(/machine wash/i)
    expect(fixed.tags.some(t => /wall art/i.test(t))).toBe(true)
    expect(blockingOf(fixed.title, fixed.tags, fixed.description)).toEqual([])
  })

  it('classifies a hoodie by name even when the category says shirts', () => {
    expect(kindOf({ category: 'shirts', garment: null, name: 'Cozy Ghost Hoodie' })).toBe('hoodie')
    // ...but a hooded FIGURE on a tee is still a tee.
    expect(kindOf({ category: 'shirts', garment: 'tshirt', name: 'Hooded Reaper Tee' })).toBe('tee')
  })
})

describe('subjectPhrases', () => {
  it('builds phrases from the design name and skips stopwords', () => {
    const phrases = subjectPhrases('The Ghost of Old Town', 'tee')
    expect(phrases.some(p => p.includes('ghost'))).toBe(true)
    expect(phrases.every(p => !/^the /.test(p))).toBe(true)
  })

  it('returns nothing for a name with no usable words', () => {
    expect(subjectPhrases('a of to', 'tee')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The persisting wrapper. No model key is set in the test env, so this is the
// deterministic path end to end — which is exactly the path that has to work
// on a backend whose composer wallet is empty.
// ---------------------------------------------------------------------------
describe('repairEtsyPack', () => {
  beforeEach(() => {
    db.updates = []
    db.product = {
      id: 'p1',
      name: 'Stoic Samurai Cherry Blossom',
      description: 'A samurai tee.',
      category: 'shirts',
      price: 25,
      meta_title: null,
      meta_description: null,
      search_keywords: null,
      metadata: {
        etsy_pack: { title: 'Stoic Samurai Cherry Blossom', tags: [], description: 'A samurai tee.', price: 25, colors: ['Black'], composed_at: 'x', model: 'mechanical' },
      },
    }
  })

  it('repairs and persists the pack without a model', async () => {
    const result = await repairEtsyPack('p1', ['Title is 32 characters; the minimum is 40.', 'Only 0 tag(s); at least 10 are required and Etsy allows 13.'])
    expect(result.repaired).toBe(true)
    expect(result.usedModel).toBe(false)
    expect(result.stillBlocking).toEqual([])

    expect(db.updates).toHaveLength(1)
    const pack = db.updates[0].metadata.etsy_pack
    expect(pack.tags).toHaveLength(MAX_TAGS)
    expect(pack.title.length).toBeGreaterThanOrEqual(SEO_RULES.etsy.titleMin)
    expect(pack.model).toBe('deterministic-repair')
    // Fields the repair has no business touching survive.
    expect(pack.price).toBe(25)
    expect(pack.colors).toEqual(['Black'])
  })

  it('writes nothing when the copy is already clean', async () => {
    const clean = repairCopy(base)
    db.product.metadata.etsy_pack = { ...db.product.metadata.etsy_pack, ...clean }
    const result = await repairEtsyPack('p1', [])
    expect(result.repaired).toBe(false)
    expect(db.updates).toHaveLength(0)
  })

  it('falls back to the catalogue fields when no pack has been composed', async () => {
    db.product.metadata = {}
    db.product.search_keywords = 'samurai tee, sakura graphic'
    const result = await repairEtsyPack('p1', ['Only 0 tag(s); at least 10 are required and Etsy allows 13.'])
    expect(result.repaired).toBe(true)
    expect(db.updates[0].metadata.etsy_pack.tags).toContain('samurai tee')
  })
})
