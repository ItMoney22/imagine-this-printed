import { describe, it, expect, vi } from 'vitest'

// The gate module builds a Supabase client at import time. Most of the logic
// under test is pure, but buildPresentationInput reads the product row, so the
// stub is a chainable query object whose rows the tests below set.
const rows: { products: any; product_assets: any[] } = { products: null, product_assets: [] }
vi.mock('../lib/supabase.js', () => {
  const chain = (result: any): any => {
    const c: any = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
    c.maybeSingle = async () => result
    c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej)
    return c
  }
  return {
    supabase: {
      from: (table: string) =>
        chain(table === 'products' ? { data: rows.products, error: null } : { data: rows.product_assets, error: null }),
      rpc: async () => ({ data: 1 })
    }
  }
})

const { evaluateGate, partitionByQa, fingerprintPresentation, buildPresentationInput } = await import('./design-qa-gate.js')
import type { PresentationInput } from './presentation-qa.js'

// ---------------------------------------------------------------------------
// Enforcement. The gate's whole value is that it cannot be talked around, so
// these tests are mostly about the ways it could be:
//
//   1. Never reviewed is NOT the same as passed. A design nobody looked at must
//      not go live just because there is no failure on file.
//   2. A pass is bound to the presentation that earned it. "Pass QA, then edit
//      the price to $2" has to be caught, or the gate protects nothing.
//   3. An admin override is honoured, because a gate with no human escape hatch
//      gets switched off the first time it is wrong.
// ---------------------------------------------------------------------------

const stamp = (over: Record<string, unknown> = {}) => ({
  status: 'passed',
  channel: 'storefront',
  submission_no: 1,
  review_id: 'r1',
  score: 96,
  fingerprint: 'abc123',
  blocking: 0,
  warnings: 0,
  at: '2026-08-17T00:00:00.000Z',
  by: 'daily-designer',
  failures: [],
  ...over
})

const meta = (over: Record<string, unknown> = {}) => ({ qa_gate: { storefront: stamp(over) } })

describe('evaluateGate', () => {
  it('refuses a design that has never been reviewed', () => {
    const verdict = evaluateGate({}, 'storefront')
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('never_reviewed')
  })

  it('refuses a design whose latest review failed, and says which finding', () => {
    const verdict = evaluateGate(meta({ status: 'failed', failures: ['image_sharpness: photo is blurry'] }), 'storefront')
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('failed')
    expect(verdict.reason).toContain('blurry')
  })

  it('allows a passing design', () => {
    expect(evaluateGate(meta(), 'storefront').allowed).toBe(true)
  })

  it('allows an admin override', () => {
    const verdict = evaluateGate(meta({ status: 'overridden', by: 'david@example.com' }), 'storefront')
    expect(verdict.allowed).toBe(true)
    expect(verdict.code).toBe('overridden')
  })

  it('goes stale when the listing changed after passing', () => {
    const verdict = evaluateGate(meta(), 'storefront', 'a-different-fingerprint')
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('stale')
  })

  it('keeps the pass when the presentation is unchanged', () => {
    expect(evaluateGate(meta(), 'storefront', 'abc123').allowed).toBe(true)
  })

  it('grades each channel separately — passing on the storefront is not passing on Etsy', () => {
    expect(evaluateGate(meta(), 'storefront').allowed).toBe(true)
    expect(evaluateGate(meta(), 'etsy').allowed).toBe(false)
  })
})

describe('partitionByQa', () => {
  it('splits candidates and keeps the reason with each blocked row', () => {
    const { allowed, blocked } = partitionByQa(
      [
        { id: 'ok', name: 'Passed', metadata: meta() },
        { id: 'never', name: 'Unreviewed', metadata: {} },
        { id: 'bad', name: 'Failed', metadata: meta({ status: 'failed', failures: ['seo: title is stuffed'] }) }
      ],
      'storefront'
    )
    expect(allowed.map(a => a.id)).toEqual(['ok'])
    expect(blocked.map(b => b.id).sort()).toEqual(['bad', 'never'])
    expect(blocked.find(b => b.id === 'bad')?.reason).toContain('stuffed')
  })
})

describe('fingerprintPresentation', () => {
  const base: PresentationInput = {
    productId: 'p1',
    name: 'Tee',
    channel: 'etsy',
    category: 'shirts',
    designUrl: 'https://x/art.png',
    mockupUrls: ['https://x/1.png', 'https://x/2.png'],
    placement: 'front-center',
    printSizeInches: 11,
    title: 'A Title',
    description: 'A description',
    tags: ['one tag', 'two tag'],
    price: 25
  }

  it('is stable for the same presentation', () => {
    expect(fingerprintPresentation(base)).toBe(fingerprintPresentation({ ...base }))
  })

  it('ignores tag ORDER but not tag CONTENT', () => {
    expect(fingerprintPresentation({ ...base, tags: ['two tag', 'one tag'] })).toBe(fingerprintPresentation(base))
    expect(fingerprintPresentation({ ...base, tags: ['one tag', 'three tag'] })).not.toBe(fingerprintPresentation(base))
  })

  it('changes when any reviewed field changes', () => {
    const original = fingerprintPresentation(base)
    expect(fingerprintPresentation({ ...base, price: 2 })).not.toBe(original)
    expect(fingerprintPresentation({ ...base, title: 'Another Title' })).not.toBe(original)
    expect(fingerprintPresentation({ ...base, description: 'Rewritten' })).not.toBe(original)
    // A re-render swaps the URL, and a re-render is exactly what must be
    // re-reviewed — this is the case a title/price-only fingerprint would miss.
    expect(fingerprintPresentation({ ...base, mockupUrls: ['https://x/1.png', 'https://x/3.png'] })).not.toBe(original)
  })

  it('does not change for fields the review never looked at', () => {
    expect(fingerprintPresentation({ ...base, name: 'Renamed internally' })).toBe(fingerprintPresentation(base))
  })
})

// ---------------------------------------------------------------------------
// What the gate actually grades.
//
// David, 2026-09-07, on a gnome/alien tee the Step Flow had just built: the
// review failed with "7 tags exceed Etsy's 20-character limit", listing
// website-SEO phrases like "alien spaceship tractor beam shirt" (34 chars).
// Nothing was wrong with the listing — services/etsy.ts publishes those same
// keywords through toEtsyTags(), which trims each to <=20 chars on whole
// words. Only the gate read them raw, so it blocked a listing that would have
// gone out legal. A gate that fails a good listing is worse than no gate: it
// teaches you to override it.
// ---------------------------------------------------------------------------
const productRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Gnome Abduction Tee',
  description: 'A gnome, abducted.',
  price: 25,
  images: [],
  category: 't-shirts',
  status: 'draft',
  meta_title: 'Gnome Abduction Tee',
  meta_description: 'A gnome, abducted.',
  search_keywords:
    'funny gnome abduction t-shirt, sci-fi gnome alien tee, unisex alien graphic shirt, ' +
    'alien spaceship tractor beam shirt, quirky graphic tee unisex, comic style gnome shirt, ' +
    'interstellar travel funny tee',
  metadata: {},
  ...over
})

describe('buildPresentationInput — Etsy is graded as it would be published', () => {
  it('trims raw website keywords to legal tags instead of blocking on them', async () => {
    rows.products = productRow()
    rows.product_assets = []

    const input = await buildPresentationInput('p1', 'etsy')

    expect(input.tags.length).toBeGreaterThan(0)
    for (const tag of input.tags) expect(tag.length).toBeLessThanOrEqual(20)
    // Trimmed on whole words, not sliced mid-word.
    expect(input.tags).toContain('sci-fi gnome alien')
    expect(input.tags.some(t => t.endsWith(' '))).toBe(false)
  })

  it('re-sanitizes a hand-edited pack, exactly as the publisher does', async () => {
    rows.products = productRow({
      metadata: {
        etsy_pack: {
          title: 'Gnome Abduction Tee',
          description: 'A gnome, abducted.',
          price: 25,
          // A pack edited straight in the DB, past the composer's sanitizer.
          tags: ['alien spaceship tractor beam shirt', 'gnome tee', 'gnome tee']
        }
      }
    })
    rows.product_assets = []

    const input = await buildPresentationInput('p1', 'etsy')

    for (const tag of input.tags) expect(tag.length).toBeLessThanOrEqual(20)
    // Deduped, like etsy.ts's packTags loop.
    expect(input.tags.filter(t => t === 'gnome tee')).toHaveLength(1)
  })

  it('leaves the storefront channel on the catalogue fields, untrimmed', async () => {
    rows.products = productRow()
    rows.product_assets = []

    const input = await buildPresentationInput('p1', 'storefront')

    // The storefront has no 20-char rule; trimming there would be a lie about
    // what the shopper sees. DESIGN_QA_GATE.md: "a 27-character storefront
    // keyword is fine."
    expect(input.tags).toContain('alien spaceship tractor beam shirt')
  })
})
