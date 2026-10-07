import { describe, expect, it } from 'vitest'
import { REAL_REVIEWS } from '../data/realReviews'
import { featuredReviews, reviewsForProduct, summarize } from './real-reviews'

// Guard: nothing invented can ship. Each review must trace to a real Etsy
// review id or a documented buyer permission, and must not read as filler.
const FILLER = /lorem ipsum|placeholder|sample|test review|john d\b|jane d\b|\bTODO\b|\bTBD\b/i

describe('REAL_REVIEWS provenance guard', () => {
  it('every review has a source reference, valid rating, real date and verbatim text', () => {
    const seen = new Set<string>()
    for (const r of REAL_REVIEWS) {
      expect(r.sourceRef.trim(), 'sourceRef').not.toBe('')
      expect(seen.has(r.sourceRef), `duplicate ${r.sourceRef}`).toBe(false)
      seen.add(r.sourceRef)
      expect(['etsy', 'permissioned']).toContain(r.source)
      expect(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5).toBe(true)
      expect(Number.isNaN(Date.parse(r.reviewedAt)), 'reviewedAt').toBe(false)
      expect(r.etsyListingId).toBeGreaterThan(0)
      expect(r.quote.trim().length).toBeGreaterThan(0)
      expect(FILLER.test(r.quote), `filler text in ${r.sourceRef}`).toBe(false)
      expect(FILLER.test(r.buyerName), `filler name in ${r.sourceRef}`).toBe(false)
    }
  })

  it('every buyer photo documents permission', () => {
    for (const r of REAL_REVIEWS) {
      for (const p of r.photos) {
        expect(p.url).toMatch(/^https:\/\//)
        expect(p.permission.trim(), `photo permission in ${r.sourceRef}`).not.toBe('')
      }
    }
  })
})

describe('selectors', () => {
  const base = { source: 'etsy' as const, etsyListingId: 1, buyerName: 'Etsy buyer', photos: [] }
  const a = { ...base, sourceRef: 'a', productId: 'p1', rating: 5 as const, quote: 'x', reviewedAt: '2026-01-01' }
  const b = { ...base, sourceRef: 'b', productId: 'p2', rating: 4 as const, quote: 'y', reviewedAt: '2026-02-01' }

  it('summarizes an empty set as zero, not NaN', () => {
    expect(summarize([])).toEqual({ count: 0, average: 0 })
  })
  it('averages to one decimal', () => {
    expect(summarize([a, b])).toEqual({ count: 2, average: 4.5 })
  })
  it('matches reviews to their product only', () => {
    expect(reviewsForProduct('p1', [a, b])).toEqual([a])
    expect(reviewsForProduct('nope', [a, b])).toEqual([])
  })
  it('features photo reviews first, then newest', () => {
    const withPhoto = { ...a, sourceRef: 'c', photos: [{ url: 'https://x/y.jpg', permission: 'etsy' }] }
    expect(featuredReviews(2, [b, a, withPhoto]).map((r) => r.sourceRef)).toEqual(['c', 'b'])
  })
})
