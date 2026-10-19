import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shareImageFor } from '../../api/_seo/share-link.mjs'
import { getGalleryImages } from './product-kind'
import { findProductByKey } from './product-link'

// A fake supabase query builder that records each lookup's filters and
// answers from `db.answer`.
const db = vi.hoisted(() => ({
  lookups: [] as string[][],
  answer: (() => []) as (filters: string[]) => unknown[],
  error: null as unknown
}))
vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const filters: string[] = []
      const q = {
        select: () => q,
        gte: (c: string, v: string) => (filters.push(`${c}>=${v}`), q),
        lte: (c: string, v: string) => (filters.push(`${c}<=${v}`), q),
        eq: (c: string, v: string) => (filters.push(`${c}=${v}`), q),
        contains: (c: string, v: unknown) => (filters.push(`${c}@>${JSON.stringify(v)}`), q),
        order: () => q,
        limit: async () => {
          db.lookups.push(filters)
          return { data: db.error ? null : db.answer(filters), error: db.error }
        }
      }
      return q
    }
  }
}))

const FOLGERS = { id: '9c3b3d19-72b1-4fbb-9a0c-148e2a486298', slug: '1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77', status: 'active' }

beforeEach(() => {
  db.lookups = []
  db.answer = () => []
  db.error = null
})

describe('findProductByKey', () => {
  it('opens a short link by its id prefix', async () => {
    db.answer = (f) => (f[0] === 'id>=9c3b3d19-0000-0000-0000-000000000000' ? [FOLGERS] : [])
    const found = await findProductByKey('folgers-coffee-racing-9c3b3d19', { short: true })
    expect(found).toEqual({ row: FOLGERS, replaced: false })
    expect(db.lookups).toEqual([['id>=9c3b3d19-0000-0000-0000-000000000000', 'id<=9c3b3d19-ffff-ffff-ffff-ffffffffffff']])
  })

  it('opens the Folgers link David sent (UUID-shaped slug) instead of "Product Not Found"', async () => {
    db.answer = (f) => (f[0] === `slug=${FOLGERS.slug}` ? [FOLGERS] : [])
    const found = await findProductByKey(FOLGERS.slug, { short: false })
    expect(found?.row.id).toBe(FOLGERS.id)
    expect(db.lookups.map((f) => f[0])).toEqual([`id=${FOLGERS.slug}`, `slug=${FOLGERS.slug}`])
  })

  it('flags a replacement, and only accepts a live one', async () => {
    db.answer = (f) => (f[0].startsWith('metadata@>') ? [FOLGERS] : [])
    const found = await findProductByKey('old-folgers-tee', { short: false })
    expect(found).toEqual({ row: FOLGERS, replaced: true })
    expect(db.lookups.at(-1)).toEqual(['metadata@>{"replaces":["old-folgers-tee"]}', 'status=active'])
  })

  it('returns null for a dead link, and throws on a failed read', async () => {
    expect(await findProductByKey('gone-tee-deadbeef', { short: true })).toBeNull()
    db.error = new Error('network down')
    await expect(findProductByKey('anything', { short: false })).rejects.toThrow('network down')
  })
})

// The bot card (api/_seo/share-link.mjs) mirrors the page's hero ordering in
// plain JS. These rows pin the two together: if getGalleryImages changes,
// shareImageFor has to follow, or a link would unfurl with a different photo.
describe('share card photo = the product page hero', () => {
  const G = 'https://storage.googleapis.com/imagine-this-printed-main'
  const rows = [
    {
      name: 'step-flow tee: print file first in images[]',
      images: [`${G}/print-ready/a/art.png`, `${G}/users/u/mockups/etsy_shot_a_1.png`, `${G}/mockups/a/hanger/a.png`, `${G}/mockups/a/ghost_mannequin/a.png`],
      metadata: {}
    },
    {
      name: 'watermarked display + mockups, no garment shot',
      images: [`${G}/products/clean.png`],
      metadata: { assets: { display: `${G}/products/display.png`, clean: `${G}/products/clean.png`, mockups: [`${G}/m/room.png`] } }
    },
    {
      name: 'halftone deliverable sitting in images[0]',
      images: [`${G}/products/halftone.png`, `${G}/products/art.png`],
      metadata: { assets: { halftone: `${G}/products/halftone.png` } }
    },
    { name: 'legacy single mockup', images: [`${G}/products/art.png`], metadata: { mockup_url: `${G}/m/legacy.png` } },
    {
      name: 'creator apparel hides its print file',
      images: [`${G}/merch-studio/d/print.png`, `${G}/merch-studio/d/mockup-1.png`],
      metadata: { source: 'merch-studio', assets: { clean: `${G}/merch-studio/d/print.png` } }
    },
    { name: 'blank with a relative photo', images: ['/blanks/classic-heavy-cotton-tee.webp'], metadata: {} },
    { name: 'nothing to show', images: [], metadata: {} }
  ]

  for (const row of rows) {
    it(row.name, () => {
      expect(shareImageFor(row)).toBe(getGalleryImages(row as never)[0] ?? null)
    })
  }
})
