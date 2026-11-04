// What is this product? — the one decision the Etsy pipeline now shares
// (task 28ab467c). These pin the order of authority David set on 2026-09-23:
// the admin's pick unconditionally, then Jev only when sure and consistent,
// then the old heuristics as the floor — and never a silent "shirts".
import { describe, it, expect } from 'vitest'
import {
  PRODUCT_KINDS,
  PRODUCT_KIND_CRITERIA,
  PRODUCT_KIND_MIN_CONFIDENCE,
  KIND_CATEGORY,
  adminKindOf,
  categoryForKind,
  decideProductKind,
  floorKindOf,
  kindForCategory,
  kindForGarmentValue,
  readKindStamp,
  resolvedKindOf,
  toKindStamp,
  type ProductKind,
} from './product-kind.js'

const jev = (choice: ProductKind, confidence: number) => ({ choice, confidence })

describe('the eight kinds Jev chooses between', () => {
  it('is the multi-option menu from the brief, each with a written description', () => {
    expect([...PRODUCT_KINDS]).toEqual(['hoodie', 'tee', 'youth_tee', 'metal', 'transfer', '3d', 'tumbler', 'other'])
    for (const k of PRODUCT_KINDS) {
      // A bare key reads as mush to Jev; every option says what it is AND what only looks like it.
      expect(PRODUCT_KIND_CRITERIA[k].length).toBeGreaterThan(80)
    }
    expect(PRODUCT_KIND_CRITERIA.hoodie).toMatch(/hooded figure is NOT a hoodie/)
    expect(PRODUCT_KIND_CRITERIA.tumbler).toMatch(/shows a mug or a cup is NOT this/)
  })

  it('maps every kind to the category it files under, and back', () => {
    expect(KIND_CATEGORY).toEqual({
      hoodie: 'hoodies', tee: 'shirts', youth_tee: 'shirts', metal: 'metal-art',
      transfer: 'dtf-transfers', '3d': '3d-prints', tumbler: 'tumblers', other: null,
    })
    expect(kindForCategory('t-shirts')).toBe('tee')
    expect(kindForCategory('templates')).toBeNull()
    expect(categoryForKind(null)).toBeNull()
  })

  it('reads youth before tee, the trap normalizeGarment also avoids', () => {
    expect(kindForGarmentValue('youth-tshirt')).toBe('youth_tee')
    expect(kindForGarmentValue('tshirt')).toBe('tee')
    expect(kindForGarmentValue('hoodie')).toBe('hoodie')
    expect(kindForGarmentValue('polo')).toBe('other')
    expect(kindForGarmentValue({ variant_pricing: {} })).toBeNull()
  })
})

describe('floorKindOf — the old heuristics, kept as the fallback', () => {
  it('follows the old category → garment → hoodie-name order', () => {
    expect(floorKindOf({ category: 'metal-art', name: 'Tree of Life' }).kind).toBe('metal')
    expect(floorKindOf({ category: 'dtf-transfers', name: 'Badge' }).kind).toBe('transfer')
    expect(floorKindOf({ category: 'hoodies', name: 'Moon' }).kind).toBe('hoodie')
    expect(floorKindOf({ category: '3d-prints', name: 'Toy: Robo Rascal' }).kind).toBe('3d')
    expect(floorKindOf({ category: 'shirts', name: 'Cozy Ghost Hoodie' }).kind).toBe('hoodie')
    expect(floorKindOf({ category: 'shirts', name: 'Hooded Reaper Tee', metadata: { garment: 'tshirt' } }).kind).toBe('tee')
    expect(floorKindOf({ category: 'shirts', metadata: { step_flow: { garment: 'youth-tshirt' } } }).kind).toBe('youth_tee')
    expect(floorKindOf({ category: null, metadata: { product_template: 'metal-art' } }).kind).toBe('metal')
    expect(floorKindOf({ category: null, metadata: { category: 'toys' } }).kind).toBe('3d')
  })

  it('no longer lets a hoodie NAME re-file a non-apparel category', () => {
    expect(floorKindOf({ category: '3d-prints', name: 'Hoodie Bear Figurine' }).kind).toBe('3d')
  })

  it('returns null — not shirts — when nothing says what the product is', () => {
    const floor = floorKindOf({ category: null, name: 'Camper Apology', metadata: { product_template: 'mystery' } })
    expect(floor.kind).toBeNull()
    expect(floor.basis).toMatch(/nothing/)
  })

  it('flags a row whose own fields disagree (a polo filed under shirts)', () => {
    const polo = floorKindOf({ category: 'shirts', name: 'Golf Dad Polo', metadata: { product_type: 'polo' } })
    expect(polo.kind).toBe('tee')
    expect(polo.conflict).toBe(true)
  })

  it("treats the wizard's 'tshirt' request default and a defaulted category as weak", () => {
    // product_type 'tshirt' is written on every wizard row, metal and transfer included.
    expect(floorKindOf({ category: 'dtf-transfers', metadata: { product_type: 'tshirt' } }).conflict).toBe(false)
    const defaulted = floorKindOf({ category: 'shirts', metadata: { category_source: 'default' } })
    expect(defaulted.kind).toBe('tee')
    expect(defaulted.categoryKind).toBeNull()
  })
})

describe('adminKindOf — the admin\'s pick is authoritative', () => {
  it('reads the wizard stamp, the Step Flow garment and the metal brief', () => {
    expect(adminKindOf({ category: 'hoodies', metadata: { category_source: 'admin' } })?.kind).toBe('hoodie')
    expect(adminKindOf({ category: 'shirts', metadata: { step_flow: { garment: 'hoodie', approvals: { garments: '2026-10-01' } } } })?.kind).toBe('hoodie')
    expect(adminKindOf({ category: 'shirts', metadata: { step_flow: { brief: { productKind: 'metal' } } } })?.kind).toBe('metal')
    expect(adminKindOf({ category: 'shirts', metadata: { category_source: 'admin', step_flow: { garment: 'youth-tshirt' } } })?.kind).toBe('youth_tee')
  })

  it('does not count an unapproved garment or a default as the admin speaking', () => {
    expect(adminKindOf({ category: 'shirts', metadata: { step_flow: { garment: 'hoodie' } } })).toBeNull()
    expect(adminKindOf({ category: 'shirts', metadata: { category_source: 'default' } })).toBeNull()
  })
})

describe('decideProductKind', () => {
  const tee = { category: 'shirts', name: 'Neon Koi Galaxy T-Shirt' }

  it('keeps an admin-set category unconditionally, even against a certain Jev', () => {
    const product = { category: 'shirts', name: 'Cozy Hoodie Vibes', metadata: { category_source: 'admin' } }
    for (const mode of ['on', 'shadow', 'off'] as const) {
      const d = decideProductKind(product, jev('hoodie', 0.99), mode)
      expect(d).toMatchObject({ kind: 'tee', source: 'admin', needsReview: false })
      expect(d.jev.status).toBe('not-asked')
    }
  })

  it('changes nothing in shadow mode — Jev is measured, the floor decides', () => {
    const d = decideProductKind(tee, jev('transfer', 0.97), 'shadow')
    expect(d).toMatchObject({ kind: 'tee', source: 'floor', needsReview: false })
    expect(d.jev).toMatchObject({ status: 'disagrees', choice: 'transfer', confidence: 0.97 })
  })

  it('sends a product with no signal to a human in EVERY mode instead of defaulting to shirts', () => {
    const blank = { category: null, name: 'Camper Apology' }
    for (const mode of ['off', 'shadow'] as const) {
      expect(decideProductKind(blank, undefined, mode)).toMatchObject({ kind: null, source: 'none', needsReview: true })
    }
    expect(decideProductKind(blank, jev('tee', 0.5), 'on')).toMatchObject({ kind: null, needsReview: true })
  })

  describe("with PRODUCT_KIND_JEV=on", () => {
    it('lets a sure Jev that agrees with the category decide', () => {
      expect(decideProductKind(tee, jev('tee', 0.99), 'on')).toMatchObject({ kind: 'tee', source: 'jev', needsReview: false })
    })

    it('reads a youth tee under the shirts category as agreeing', () => {
      expect(decideProductKind(tee, jev('youth_tee', 0.9), 'on')).toMatchObject({ kind: 'youth_tee', source: 'jev' })
    })

    it('never re-files against the category — a sure contradiction goes to a human, floor held', () => {
      const d = decideProductKind(tee, jev('transfer', 0.95), 'on')
      expect(d).toMatchObject({ kind: 'tee', source: 'floor', needsReview: true })
      expect(d.note).toMatch(/transfer \(95% sure\) but the category says tee/)
    })

    it('fixes the hoodie-NAME guess when Jev and the category agree it is a tee', () => {
      const d = decideProductKind({ category: 'shirts', name: 'Grim Reaper Hoodie Art Tee' }, jev('tee', 0.95), 'on')
      expect(d).toMatchObject({ kind: 'tee', source: 'jev', needsReview: false })
    })

    it('fills in a product with no category from a sure Jev', () => {
      expect(decideProductKind({ category: null, name: 'Toy: Robo Rascal' }, jev('3d', 0.97), 'on')).toMatchObject({ kind: '3d', source: 'jev' })
    })

    it('keeps a clean floor when Jev is unsure — that is the product\'s own data, not a guess', () => {
      expect(decideProductKind(tee, jev('other', 0.55), 'on')).toMatchObject({ kind: 'tee', source: 'floor', needsReview: false })
    })

    it('flags an ambiguous row when Jev is unsure', () => {
      const polo = { category: 'shirts', name: 'Golf Dad Polo', metadata: { product_type: 'polo' } }
      expect(decideProductKind(polo, jev('other', 0.6), 'on')).toMatchObject({ kind: 'tee', needsReview: true })
      const defaulted = { category: 'shirts', name: 'Abstract Waves', metadata: { category_source: 'default' } }
      expect(decideProductKind(defaulted, jev('tee', 0.6), 'on')).toMatchObject({ needsReview: true })
    })

    it('lets a sure Jev settle a defaulted category only among what the fields suggest', () => {
      const defaulted = { category: 'shirts', name: 'Abstract Waves', metadata: { category_source: 'default' } }
      expect(decideProductKind(defaulted, jev('tee', 0.95), 'on')).toMatchObject({ kind: 'tee', source: 'jev' })
      expect(decideProductKind(defaulted, jev('metal', 0.95), 'on')).toMatchObject({ kind: 'tee', needsReview: true })
    })

    it('fails OPEN on a Jev outage: the floor decides exactly as before', () => {
      const polo = { category: 'shirts', name: 'Golf Dad Polo', metadata: { product_type: 'polo' } }
      expect(decideProductKind(polo, null, 'on')).toMatchObject({ kind: 'tee', source: 'floor', needsReview: false })
      expect(decideProductKind(polo, null, 'on').jev.status).toBe('unavailable')
    })

    it('gates on the bar exactly', () => {
      expect(PRODUCT_KIND_MIN_CONFIDENCE).toBe(0.85)
      const blank = { category: null, name: 'Thing' }
      expect(decideProductKind(blank, jev('tumbler', 0.85), 'on')).toMatchObject({ kind: 'tumbler', needsReview: false })
      expect(decideProductKind(blank, jev('tumbler', 0.849), 'on')).toMatchObject({ kind: null, needsReview: true })
      expect(decideProductKind(blank, jev('tumbler', 0.7), 'on', 0.6)).toMatchObject({ kind: 'tumbler' })
    })
  })
})

describe('the stamp synchronous readers use', () => {
  const product = { category: 'shirts', name: 'Golf Dad Polo', metadata: { product_type: 'polo' } as any }

  it('round-trips, and goes stale the moment the category changes', () => {
    const d = decideProductKind(product, jev('other', 0.98), 'on')
    const stamp = toKindStamp(d, product, new Date('2026-10-12T00:00:00Z'))
    expect(stamp).toMatchObject({ kind: 'tee', needs_review: true, category: 'shirts', jev_choice: 'other', jev_confidence: 0.98 })
    const stamped = { ...product, metadata: { ...product.metadata, product_kind: stamp } }
    expect(readKindStamp(stamped)?.needs_review).toBe(true)
    // An admin re-filing it clears the review by itself.
    expect(readKindStamp({ ...stamped, category: 'hoodies' })).toBeNull()
  })

  it('resolvedKindOf prefers the admin, then a live stamp, then the floor', () => {
    const jevStamp = { kind: 'hoodie', source: 'jev', needs_review: false, category: 'shirts' }
    expect(resolvedKindOf({ category: 'shirts', name: 'Art', metadata: { product_kind: jevStamp } })).toBe('hoodie')
    expect(resolvedKindOf({ category: 'shirts', name: 'Art', metadata: { product_kind: { ...jevStamp, category: 'hoodies' } } })).toBe('tee')
    expect(resolvedKindOf({ category: 'shirts', name: 'Art', metadata: { category_source: 'admin', product_kind: jevStamp } })).toBe('tee')
    expect(resolvedKindOf({ category: null, name: 'Art' })).toBeNull()
  })
})
