import { describe, it, expect } from 'vitest'
import {
  fileSlugBase,
  isUuidShapedSlug,
  planReslug,
  replacesEntriesFor,
  slugCameFromFile,
  slugFromName,
} from './product-slug.js'
import { replacesEntriesFor as sharedReplacesEntriesFor } from '../../../api/_seo/share-link.mjs'

const FOLGERS_SLUG = '1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77'
const FOLGERS_NAME = 'Folgers Coffee Racing Legend T-Shirt | Vintage Stock Car Tee'

describe('isUuidShapedSlug', () => {
  it('takes a strict uuid, with or without generateUniqueSlug\'s -N', () => {
    expect(isUuidShapedSlug(FOLGERS_SLUG)).toBe(true)
    expect(isUuidShapedSlug(FOLGERS_SLUG.toUpperCase())).toBe(true)
    expect(isUuidShapedSlug(`${FOLGERS_SLUG}-2`)).toBe(true)
  })

  it('leaves bare hex, hashes and words alone (conservative)', () => {
    expect(isUuidShapedSlug('1d2b8a230cdd4dd3b010ba2ce3a7bc77')).toBe(false)
    expect(isUuidShapedSlug('deadbeef')).toBe(false)
    expect(isUuidShapedSlug('folgers-coffee-racing-legend-t-shirt')).toBe(false)
    expect(isUuidShapedSlug(null)).toBe(false)
  })
})

describe('slugFromName', () => {
  it('drops the Etsy-style " | keywords" tail', () => {
    expect(slugFromName(FOLGERS_NAME)).toBe('folgers-coffee-racing-legend-t-shirt')
  })

  it('folds accents instead of dropping the letter', () => {
    expect(slugFromName('Café Racer Tee')).toBe('cafe-racer-tee')
  })

  it('caps a long name at a word boundary', () => {
    const slug = slugFromName('Word '.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('word')).toBe(true)
  })

  it('is empty when nothing usable is left', () => {
    expect(slugFromName('   ')).toBe('')
    expect(slugFromName(undefined)).toBe('')
    expect(slugFromName(FOLGERS_SLUG)).toBe('')
  })
})

describe('slugCameFromFile', () => {
  it('catches a uuid-shaped slug on any product', () => {
    expect(slugCameFromFile({ slug: FOLGERS_SLUG, metadata: {} })).toBe(true)
  })

  it('catches the upload stamp', () => {
    expect(slugCameFromFile({ slug: 'spartans-warrior-final', metadata: { import_source: 'upload', slug_source: 'filename' } })).toBe(true)
    expect(slugCameFromFile({ slug: 'my-typed-name', metadata: { import_source: 'upload', slug_source: 'typed' } })).toBe(false)
    expect(slugCameFromFile({ slug: 'folgers-coffee', metadata: { import_source: 'upload', slug_source: 'name' } })).toBe(false)
  })

  it('catches an unstamped upload whose slug is its file name slug, -N included', () => {
    const meta = { import_source: 'upload', original_filename: 'spartans-warrior_FINAL.png' }
    expect(slugCameFromFile({ slug: 'spartans-warrior-final', metadata: meta })).toBe(true)
    expect(slugCameFromFile({ slug: 'spartans-warrior-final-2', metadata: meta })).toBe(true)
    expect(slugCameFromFile({ slug: 'custom-design-3', metadata: { import_source: 'upload', original_filename: 'IMG_4821.JPG' } })).toBe(true)
    // A name David typed made this slug, not the file.
    expect(slugCameFromFile({ slug: 'greek-helmet', metadata: meta })).toBe(false)
  })

  it('never touches a non-upload product with a real slug', () => {
    expect(slugCameFromFile({ slug: 'custom-design', metadata: { import_source: 'design-library' } })).toBe(false)
    expect(slugCameFromFile({ slug: 'golden-gate-metal-print', metadata: null })).toBe(false)
    expect(slugCameFromFile({ slug: null, metadata: { slug_source: 'filename' } })).toBe(false)
  })
})

describe('fileSlugBase', () => {
  it('is what /step/upload slugs an unnamed draft to', () => {
    expect(fileSlugBase('spartans-warrior_FINAL.png')).toBe('spartans-warrior-final')
    expect(fileSlugBase(`${FOLGERS_SLUG}.png`)).toBe('custom-design')
    expect(fileSlugBase(null)).toBe('custom-design')
  })
})

describe('replacesEntriesFor', () => {
  it('matches api/_seo/share-link.mjs exactly (the lookup the SPA and bots walk)', () => {
    const rows = [
      { id: '9C3B3D19-72B1-4FBB-9A0C-148E2A486298', slug: FOLGERS_SLUG },
      { slug: FOLGERS_SLUG },
      { id: 'abc', slug: 'abc' },
      {},
      null,
    ]
    for (const row of rows) expect(replacesEntriesFor(row as any)).toEqual(sharedReplacesEntriesFor(row as any))
  })
})

describe('planReslug', () => {
  it('re-slugs the Folgers tee from its real name and keeps the uuid as a replaced key', () => {
    const plan = planReslug({ slug: FOLGERS_SLUG, metadata: { import_source: 'upload' } }, FOLGERS_NAME, [])
    expect(plan).toEqual({ slug: 'folgers-coffee-racing-legend-t-shirt', replaces: [FOLGERS_SLUG] })
  })

  it('takes the next free slug and keeps earlier replaces entries', () => {
    const plan = planReslug(
      { slug: 'custom-design-2', metadata: { slug_source: 'filename', replaces: ['old-key'] } },
      'Greek Helmet',
      ['greek-helmet', 'greek-helmet-1', 'custom-design-2']
    )
    expect(plan).toEqual({ slug: 'greek-helmet-2', replaces: ['old-key', 'custom-design-2'] })
  })

  it('does nothing to a proper name slug, a name with no slug, or a slug already of that name', () => {
    expect(planReslug({ slug: 'golden-gate', metadata: {} }, 'Golden Gate Bridge Print', [])).toBeNull()
    expect(planReslug({ slug: FOLGERS_SLUG, metadata: {} }, '', [])).toBeNull()
    expect(planReslug({ slug: 'custom-design-3', metadata: { slug_source: 'filename' } }, 'Custom Design', [])).toBeNull()
  })
})
