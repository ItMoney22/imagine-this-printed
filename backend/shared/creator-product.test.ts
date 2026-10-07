import { describe, it, expect } from 'vitest'
import {
  isCreatorProductMeta,
  creatorIdOf,
  creatorNameOf,
  creatorGarmentColor,
  isFaithListing,
  recommendationLane,
  fitsRecommendationLane,
  type RecCandidate
} from './creator-product.js'

const DARRELL = '41c6873c-68a5-4365-8f6f-3ce3f1c6ae9e'

// The live "Walk By Faith" row (e387149e), trimmed to the fields that matter.
const walkByFaith: RecCandidate = {
  id: 'e387149e-ae76-4a61-877d-8005896a8c99',
  name: 'Walk By Faith',
  search_keywords: 'walk by faith shirt, custom faith t-shirt, inspirational shirts',
  created_by_user_id: DARRELL,
  metadata: {
    source: 'merch-studio',
    creator_id: DARRELL,
    creator_name: 'Darrell McCutchen',
    placement: { colorName: 'Maroon', color: '#5b2333' },
    etsy_pack: { tags: ['walk by faith', 'christian apparel'] }
  }
}
const frogs: RecCandidate = { id: 'frogs', name: 'Man I Love Frogs', metadata: { source: 'step-flow' } }
const leftovers: RecCandidate = { id: 'left', name: 'Leftovers Are for Quitters', metadata: {} }
const blessed: RecCandidate = { id: 'bless', name: 'Blessed Mama Sunflower Tee', metadata: {} }
const userDesign: RecCandidate = { id: 'u1', name: 'Neon Dragon', metadata: { creator_id: 'someone' } }

describe('isCreatorProductMeta', () => {
  it('is the merch-studio publish lane only', () => {
    expect(isCreatorProductMeta(walkByFaith.metadata)).toBe(true)
    // A user design / Step Flow row carries creator_id too, but is not creator apparel.
    expect(isCreatorProductMeta(userDesign.metadata)).toBe(false)
    expect(isCreatorProductMeta(null)).toBe(false)
  })
})

describe('creator identity', () => {
  it('reads the creator id and the public credit name', () => {
    expect(creatorIdOf(walkByFaith)).toBe(DARRELL)
    expect(creatorNameOf(walkByFaith)).toBe('Darrell McCutchen')
  })
  it('falls back to created_by_user_id when metadata has no creator_id', () => {
    expect(creatorIdOf({ created_by_user_id: DARRELL, metadata: { source: 'merch-studio' } })).toBe(DARRELL)
  })
  it('never credits or ids a non-creator product', () => {
    expect(creatorIdOf(userDesign)).toBeNull()
    expect(creatorNameOf({ metadata: { creator_name: 'X' } })).toBeNull()
    expect(creatorNameOf({ metadata: { source: 'merch-studio', creator_name: '  ' } })).toBeNull()
  })
})

describe('creatorGarmentColor', () => {
  it('is the colour the creator placed the art on', () => {
    expect(creatorGarmentColor(walkByFaith.metadata)).toEqual({ name: 'Maroon', hex: '#5b2333' })
  })
  it('drops a malformed hex but keeps the name', () => {
    expect(creatorGarmentColor({ source: 'merch-studio', placement: { colorName: 'Maroon', color: 'red' } })).toEqual({ name: 'Maroon', hex: null })
  })
  it('is null off the creator lane or without a name', () => {
    expect(creatorGarmentColor({ placement: { colorName: 'Maroon' } })).toBeNull()
    expect(creatorGarmentColor({ source: 'merch-studio', placement: {} })).toBeNull()
  })
})

describe('isFaithListing', () => {
  it('reads name, keywords and tags as whole words', () => {
    expect(isFaithListing(walkByFaith)).toBe(true)
    expect(isFaithListing(blessed)).toBe(true)
    expect(isFaithListing({ name: 'Sunset Tee', metadata: { etsy_pack: { tags: ['christian apparel'] } } })).toBe(true)
  })
  it('does not fire on look-alike words', () => {
    expect(isFaithListing(frogs)).toBe(false)
    expect(isFaithListing(leftovers)).toBe(false)
    expect(isFaithListing({ name: 'Good Vibes CrossFit Tee' })).toBe(false)
    expect(isFaithListing({ name: 'Holy Guacamole Taco Tee' })).toBe(false)
    expect(isFaithListing(null)).toBe(false)
  })
})

describe('recommendation lanes', () => {
  const pool: RecCandidate[] = [
    frogs,
    leftovers,
    blessed,
    userDesign,
    { id: 'd2', name: 'Faith Over Fear', metadata: { source: 'merch-studio', creator_id: DARRELL } },
    { id: 'other-creator', name: 'Skate Club', metadata: { source: 'merch-studio', creator_id: 'other' } }
  ]
  const ids = (lane: ReturnType<typeof recommendationLane>) =>
    pool.filter(c => fitsRecommendationLane(lane, c)).map(c => c.id)

  it("a creator product's row shows only that creator's own work", () => {
    const lane = recommendationLane(walkByFaith)
    expect(lane).toEqual({ kind: 'creator', creatorId: DARRELL })
    expect(ids(lane)).toEqual(['d2'])
  })

  it('a faith product (not a creator one) sits only beside other faith products', () => {
    const lane = recommendationLane(blessed)
    expect(lane.kind).toBe('faith')
    expect(ids(lane)).toEqual(['bless'])
  })

  it('a generic row carries no creator and no faith products', () => {
    const lane = recommendationLane(frogs)
    expect(lane.kind).toBe('generic')
    expect(ids(lane)).toEqual(['frogs', 'left', 'u1'])
    expect(recommendationLane(null).kind).toBe('generic')
  })

  it('a creator product with no recorded creator shows no row at all', () => {
    const lane = recommendationLane({ name: 'Mystery', metadata: { source: 'merch-studio' } })
    expect(ids(lane)).toEqual([])
  })
})
