// Short share links: pure rules shared by the SPA, the bot renderer and the card function.
import { describe, it, expect } from 'vitest'
import {
  SHARE_ORIGIN,
  isPublishedProduct,
  lookupPlan,
  replacesEntriesFor,
  shareCardUrl,
  shareImageFor,
  shareImageVersion,
  shareLinkFor,
  shareName,
  sharePriceLabel,
  shareTitleFor,
  shareUrlFor,
  shortCodeFor,
  shortIdOf,
  shortIdRange
} from './share-link.mjs'

const GCS = 'https://storage.googleapis.com/imagine-this-printed-main'
// The live Folgers tee (2026-10-18): images[0] is the transparent print file,
// its slug is a UUID (the upload's file name) — the link David sent.
const FOLGERS = {
  id: '9c3b3d19-72b1-4fbb-9a0c-148e2a486298',
  slug: '1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77',
  name: 'Folgers Coffee Racing Legend T-Shirt | Vintage Stock Car Tee',
  price: 25,
  category: 'shirts',
  status: 'active',
  approved: true,
  images: [
    `${GCS}/print-ready/9c3b3d19/1792157483436-alpha-restored.png?GoogleAccessId=x&Signature=y`,
    `${GCS}/users/u1/mockups/etsy_shot_9c3b3d19_step-model_1.png?Signature=a`,
    `${GCS}/mockups/1d2b8a23/ghost_mannequin/1d2b8a23-ghost_mannequin-1792157570093.png?Signature=b`,
    `${GCS}/mockups/1d2b8a23/hanger/1d2b8a23-hanger-1.png?Signature=c`,
    `${GCS}/users/system/mockups/9c3b3d19-details-1.png?Signature=d`
  ],
  metadata: {}
}

describe('short codes', () => {
  it('builds a few readable words plus the id prefix, dropping the Etsy keyword tail', () => {
    expect(shortCodeFor(FOLGERS)).toBe('folgers-coffee-racing-9c3b3d19')
    expect(shareUrlFor(FOLGERS)).toBe('https://imaginethisprinted.com/p/folgers-coffee-racing-9c3b3d19')
    expect(SHARE_ORIGIN).toBe('https://imaginethisprinted.com')
  })

  it('keeps the link short: at most 3 words / 24 characters of name', () => {
    const code = shortCodeFor({ id: FOLGERS.id, name: 'Extraordinarily Magnificent Interplanetary Cowboy' })
    expect(code).toBe('extraordinarily-9c3b3d19')
    expect(shortCodeFor({ id: FOLGERS.id, name: 'Bad Witch Vibes Halloween Tee' })).toBe('bad-witch-vibes-9c3b3d19')
  })

  it('falls back to the id prefix alone when the name has no usable words', () => {
    expect(shortCodeFor({ id: FOLGERS.id, name: '★ ★ ★' })).toBe('9c3b3d19')
    expect(shortCodeFor({ id: FOLGERS.id })).toBe('9c3b3d19')
    expect(shortCodeFor({ id: 'not-a-uuid', name: 'Tee' })).toBeNull()
    expect(shareUrlFor({ name: 'Tee' })).toBeNull()
  })

  it('folds accents into plain letters', () => {
    expect(shortCodeFor({ id: FOLGERS.id, name: 'Café Racer' })).toBe('cafe-racer-9c3b3d19')
  })

  it('reads the id prefix back off a code, ignoring the words', () => {
    expect(shortIdOf('folgers-coffee-racing-9c3b3d19')).toBe('9c3b3d19')
    expect(shortIdOf('renamed-later-9c3b3d19')).toBe('9c3b3d19')
    expect(shortIdOf('9C3B3D19')).toBe('9c3b3d19')
    expect(shortIdOf('beam-me-up-retro-pop-art-sci-fi-tee')).toBeNull()
    expect(shortIdOf(FOLGERS.id)).toBeNull()
    expect(shortIdOf('')).toBeNull()
  })

  it('spans every uuid with the prefix', () => {
    expect(shortIdRange('9c3b3d19')).toEqual({
      lo: '9c3b3d19-0000-0000-0000-000000000000',
      hi: '9c3b3d19-ffff-ffff-ffff-ffffffffffff'
    })
  })
})

describe('shareLinkFor', () => {
  it('gives a published product its short link, with no tracking params', () => {
    const url = shareLinkFor({ id: FOLGERS.id, name: FOLGERS.name, published: true })
    expect(url).toBe('https://imaginethisprinted.com/p/folgers-coffee-racing-9c3b3d19')
    expect(url).not.toMatch(/utm_|\?/)
  })

  it('never hands out a link to an unpublished product', () => {
    expect(shareLinkFor({ id: FOLGERS.id, name: FOLGERS.name, published: false })).toBe(
      'https://imaginethisprinted.com/imagination-station'
    )
    expect(shareLinkFor({ name: 'My design', published: true })).toBe('https://imaginethisprinted.com/imagination-station')
  })
})

describe('isPublishedProduct', () => {
  it('matches the public read policy: active AND approved', () => {
    expect(isPublishedProduct(FOLGERS)).toBe(true)
    expect(isPublishedProduct({ status: 'active', approved: false })).toBe(false)
    expect(isPublishedProduct({ status: 'pending_approval', approved: true })).toBe(false)
    expect(isPublishedProduct({ status: 'draft' })).toBe(false)
    expect(isPublishedProduct(null)).toBe(false)
  })
})

describe('lookupPlan', () => {
  it('short link: id prefix, then slug, then replacements by key and by id prefix', () => {
    expect(lookupPlan('folgers-coffee-racing-9c3b3d19', { short: true })).toEqual([
      { kind: 'idRange', lo: '9c3b3d19-0000-0000-0000-000000000000', hi: '9c3b3d19-ffff-ffff-ffff-ffffffffffff' },
      { kind: 'slug', slug: 'folgers-coffee-racing-9c3b3d19' },
      { kind: 'replaces', value: 'folgers-coffee-racing-9c3b3d19' },
      { kind: 'replaces', value: '9c3b3d19' }
    ])
  })

  it('a UUID-shaped key tries the id AND the slug (the Folgers link)', () => {
    expect(lookupPlan(FOLGERS.slug).map((s) => s.kind)).toEqual(['id', 'slug', 'replaces'])
    expect(lookupPlan(FOLGERS.slug)[1]).toEqual({ kind: 'slug', slug: FOLGERS.slug })
  })

  it('a /product/ slug never reads as a short code', () => {
    expect(lookupPlan('coffee-cafebabe').map((s) => s.kind)).toEqual(['slug', 'replaces'])
    expect(lookupPlan('  ')).toEqual([])
  })

  it('replacement entries cover every link the old row ever had', () => {
    expect(replacesEntriesFor({ id: '1D2B8A23-0cdd-4dd3-b010-ba2ce3a7bc77', slug: 'old-tee' })).toEqual([
      '1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77',
      '1d2b8a23',
      'old-tee'
    ])
    expect(replacesEntriesFor({ id: '1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77' })).toHaveLength(2)
  })
})

describe('card content', () => {
  it('picks the main photo the page shows first, never the print file', () => {
    expect(shareImageFor(FOLGERS)).toContain('/ghost_mannequin/')
  })

  it('names the card without the keyword tail, with the price', () => {
    expect(shareName(FOLGERS.name)).toBe('Folgers Coffee Racing Legend T-Shirt')
    expect(shareTitleFor(FOLGERS)).toBe('Folgers Coffee Racing Legend T-Shirt — $25.00')
  })

  it('says "from" where the page shows a range, and drops a missing price', () => {
    expect(sharePriceLabel({ price: 8.95, category: 'metal-art' })).toBe('from $8.95')
    expect(sharePriceLabel({ price: 3.21, metadata: { garment: { blank: true } } })).toBe('from $3.21')
    expect(sharePriceLabel({ price: 0 })).toBeNull()
    expect(shareTitleFor({ name: 'Mystery Tee', price: null })).toBe('Mystery Tee')
  })

  it('tags the card url by photo, ignoring the expiring signature', () => {
    const v = shareImageVersion(`${GCS}/mockups/a/ghost_mannequin/a.png?Signature=1`)
    expect(v).toMatch(/^[0-9a-f]{8}$/)
    expect(shareImageVersion(`${GCS}/mockups/a/ghost_mannequin/a.png?Signature=2`)).toBe(v)
    expect(shareImageVersion(`${GCS}/mockups/b/ghost_mannequin/b.png`)).not.toBe(v)
    expect(shareCardUrl(FOLGERS, 'https://www.imaginethisprinted.com/')).toBe(
      `https://www.imaginethisprinted.com/api/share-card?id=${FOLGERS.id}&v=${shareImageVersion(shareImageFor(FOLGERS))}`
    )
    expect(shareCardUrl({ id: FOLGERS.id, images: [] }, 'https://x.test')).toBeNull()
  })
})
