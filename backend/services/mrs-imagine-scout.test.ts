// Tests for Mrs. Imagine's scout (services/mrs-imagine-scout.ts).
//
// The feature's whole promise is "these are SELLING", so the tests that matter
// are the ones that prove an unproven listing cannot reach the board: a failed
// lookup, a zero-sale listing, or a theme the model cited out of thin air.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The scout imports the real Supabase client for its ai_jobs bookkeeping, and
// that client throws at construction without SUPABASE_URL/SERVICE_ROLE_KEY.
// Everything under test here is pure, so the module graph just needs to import
// cleanly — same stub-mock pattern as mrs-imagine.test.ts.
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({}) } }))

// The Etsy surface is mocked so runScout can be exercised without network or
// an ETSY_KEYSTRING (the real key lives only on Render).
const searchActiveListings = vi.fn()
const verifySalesBatch = vi.fn()
const fetchShopStats = vi.fn()
vi.mock('./etsy-market-research.js', () => ({
  isEtsyResearchConfigured: () => true,
  searchActiveListings: (...a: any[]) => searchActiveListings(...a),
  verifySalesBatch: (...a: any[]) => verifySalesBatch(...a),
  fetchShopStats: (...a: any[]) => fetchShopStats(...a),
}))

import {
  runScout,
  rankProven,
  scoreProven,
  coercePicks,
  fallbackPicks,
  medianPrice,
  leadTag,
  SALES_WINDOW_DAYS,
  type ProvenListing,
} from './mrs-imagine-scout.js'
import type { SalesProof } from './etsy-market-research.js'

const NOW = Date.parse('2026-09-09T12:00:00.000Z')

const candidate = (over: Partial<Omit<ProvenListing, 'score' | 'salesPerMonth' | 'verifiedSales' | 'verifiedSalesAllTime' | 'lastSaleAt'>> = {}) => ({
  listingId: 1,
  shopId: 100,
  kind: 'tshirt' as const,
  title: 'Overstimulated Mom Shirt',
  tags: ['overstimulated mom', 'mom life', 'funny'],
  url: 'https://etsy.com/listing/1',
  priceUsd: 24,
  favorers: 50,
  ageDays: 60,
  ...over,
})

const proof = (over: Partial<SalesProof> = {}): SalesProof => ({
  listingId: 1,
  verifiedSales: 10,
  verifiedSalesAllTime: 40,
  lastSaleAt: new Date(NOW - 3 * 86_400_000).toISOString(),
  windowDays: SALES_WINDOW_DAYS,
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('rankProven — nothing unproven survives', () => {
  it('drops a listing whose sales lookup failed, rather than assuming it sells', () => {
    // The listing is missing from the proofs map entirely — that is what
    // verifySalesBatch does when Etsy errors on it.
    const ranked = rankProven([candidate({ listingId: 7 })], new Map())
    expect(ranked).toEqual([])
  })

  it('drops a listing with zero verified sales in the window, however popular', () => {
    const proofs = new Map([[1, proof({ verifiedSales: 0, verifiedSalesAllTime: 900 })]])
    const ranked = rankProven([candidate({ favorers: 25_000 })], proofs)
    expect(ranked).toEqual([])
  })

  it('keeps a listing with a single proven sale', () => {
    const proofs = new Map([[1, proof({ verifiedSales: 1, verifiedSalesAllTime: 1 })]])
    expect(rankProven([candidate()], proofs)).toHaveLength(1)
  })

  it('ranks proven sales above favourites', () => {
    const proofs = new Map<number, SalesProof>([
      [1, proof({ listingId: 1, verifiedSales: 2 })],
      [2, proof({ listingId: 2, verifiedSales: 30 })],
    ])
    const ranked = rankProven(
      [candidate({ listingId: 1, favorers: 9_000 }), candidate({ listingId: 2, favorers: 10 })],
      proofs
    )
    expect(ranked.map((r) => r.listingId)).toEqual([2, 1])
  })
})

describe('scoreProven', () => {
  it('normalises to a month, so a young listing beats an old one on the same count', () => {
    const young = scoreProven({ ...candidate({ ageDays: 14 }), verifiedSales: 9, verifiedSalesAllTime: 9, lastSaleAt: proof().lastSaleAt })
    const old = scoreProven({ ...candidate({ ageDays: 900 }), verifiedSales: 9, verifiedSalesAllTime: 400, lastSaleAt: proof().lastSaleAt })
    expect(young.salesPerMonth).toBeGreaterThan(old.salesPerMonth)
    expect(young.score).toBeGreaterThan(old.score)
  })

  it('caps the observation window at 90 days, so an old listing is not penalised for its age twice', () => {
    // 12 sales in the last 90 days is 4/month whether the listing is 6 months
    // or 6 years old — the window is what was observed, not the listing's life.
    const a = scoreProven({ ...candidate({ ageDays: 180, favorers: 0 }), verifiedSales: 12, verifiedSalesAllTime: 50, lastSaleAt: proof().lastSaleAt })
    const b = scoreProven({ ...candidate({ ageDays: 2000, favorers: 0 }), verifiedSales: 12, verifiedSalesAllTime: 50, lastSaleAt: proof().lastSaleAt })
    expect(a.salesPerMonth).toBe(b.salesPerMonth)
  })

  it('marks down a listing whose last sale is going cold', () => {
    const hot = scoreProven({ ...candidate(), verifiedSales: 10, verifiedSalesAllTime: 10, lastSaleAt: new Date(NOW - 2 * 86_400_000).toISOString() })
    const cold = scoreProven({ ...candidate(), verifiedSales: 10, verifiedSalesAllTime: 10, lastSaleAt: new Date(NOW - 80 * 86_400_000).toISOString() })
    expect(hot.score).toBeGreaterThan(cold.score)
  })
})

const provenFixture = (over: Partial<ProvenListing> = {}): ProvenListing => ({
  ...candidate(),
  verifiedSales: 12,
  verifiedSalesAllTime: 40,
  lastSaleAt: proof().lastSaleAt,
  salesPerMonth: 6,
  score: 7.2,
  ...over,
})

describe('coercePicks — the model names themes, it does not invent evidence', () => {
  const proven = [
    provenFixture({ listingId: 1, priceUsd: 22, verifiedSales: 12 }),
    provenFixture({ listingId: 2, priceUsd: 28, verifiedSales: 8, kind: 'hoodie' }),
  ]

  it('drops a theme that cites no real listing', () => {
    const picks = coercePicks({ themes: [{ theme: 'Made up', idea: 'Something', sources: [] }] }, proven)
    expect(picks).toEqual([])
  })

  it('drops a theme citing an out-of-range index instead of trusting it', () => {
    const picks = coercePicks({ themes: [{ theme: 'Ghost', idea: 'Something', sources: [99] }] }, proven)
    expect(picks).toEqual([])
  })

  it('attaches the real receipts and totals to a valid theme', () => {
    const picks = coercePicks(
      { themes: [{ theme: 'Tired Moms', idea: 'An original iced-coffee mom design', kind: 'tshirt', angle: 'Selling all quarter', sources: [0, 1] }] },
      proven
    )
    expect(picks).toHaveLength(1)
    expect(picks[0].verifiedSales).toBe(20)
    expect(picks[0].medianPriceUsd).toBe(25)
    expect(picks[0].evidence.map((e) => e.url)).toEqual([
      'https://etsy.com/listing/1',
      'https://etsy.com/listing/1',
    ])
  })

  it('runs the copyright gate before a pick can reach the board', () => {
    const picks = coercePicks(
      { themes: [{ theme: 'Disney Castle Tee', idea: 'A Disney castle design', sources: [0] }] },
      proven
    )
    expect(picks[0].gate.pass).toBe(false)
    expect(picks[0].gate.reasons.join(' ').toLowerCase()).toContain('disney')
  })

  it('fills in a missing angle from the real numbers rather than leaving it blank', () => {
    const picks = coercePicks({ themes: [{ theme: 'Tired Moms', idea: 'An original design', sources: [0] }] }, proven)
    expect(picks[0].angle).toContain('12 verified sales')
  })

  it('does not return the same theme twice', () => {
    const picks = coercePicks(
      {
        themes: [
          { theme: 'Tired Moms', idea: 'One', sources: [0] },
          { theme: 'tired moms', idea: 'Two', sources: [1] },
        ],
      },
      proven
    )
    expect(picks).toHaveLength(1)
  })
})

describe('fallbackPicks — a dead writing brain still yields a proven list', () => {
  it('builds one theme per distinct lead tag, each carrying its receipts', () => {
    const picks = fallbackPicks([
      provenFixture({ listingId: 1, tags: ['overstimulated mom', 'mom life'] }),
      provenFixture({ listingId: 2, tags: ['golf dad', 'fathers day'] }),
    ])
    expect(picks).toHaveLength(2)
    expect(picks[0].theme).toBe('Overstimulated Mom')
    expect(picks[0].evidence[0].verifiedSales).toBe(12)
    expect(picks[1].theme).toBe('Golf Dad')
  })

  it('does not repeat a theme when two listings share a lead tag', () => {
    const picks = fallbackPicks([
      provenFixture({ listingId: 1, tags: ['mom life shirt'] }),
      provenFixture({ listingId: 2, tags: ['mom life shirt'] }),
    ])
    expect(picks).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('leadTag skips generic tags', () => {
    expect(leadTag(['funny shirt', 'gift for her', 'overstimulated mom'])).toBe('overstimulated mom')
  })

  it('leadTag returns null when every tag is generic', () => {
    expect(leadTag(['tee', 'gift', 'custom'])).toBeNull()
  })

  it('medianPrice ignores zero prices', () => {
    expect(medianPrice([0, 20, 30])).toBe(25)
    expect(medianPrice([])).toBe(0)
  })
})

describe('runScout — a broken lookup is not a quiet market', () => {
  const listing = (id: number) => ({
    listing_id: id,
    shop_id: 500,
    title: `Overstimulated Mom Shirt ${id}`,
    tags: ['overstimulated mom', 'mom life'],
    price: { amount: 2400, divisor: 100, currency_code: 'USD' },
    num_favorers: 120,
    original_creation_timestamp: Math.floor((NOW - 40 * 86_400_000) / 1000),
    taxonomy_id: 1,
    url: `https://etsy.com/listing/${id}`,
  })

  beforeEach(() => {
    // gatherCandidates paces its seed searches with a 120ms sleep, which never
    // resolves under the frozen clock the scoring tests need. shouldAdvanceTime
    // keeps Date.now pinned for scoring while letting real timers fire.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    searchActiveListings.mockReset()
    verifySalesBatch.mockReset()
    fetchShopStats.mockReset()
    searchActiveListings.mockResolvedValue([listing(1), listing(2), listing(3), listing(4)])
    fetchShopStats.mockResolvedValue({ shopId: 500, shopName: 'TestShop', soldCount: 4200, reviewAverage: 4.9, activeListings: 80 })
  })

  it('reports the API failure rather than claiming nothing is selling', async () => {
    verifySalesBatch.mockResolvedValue({
      proofs: new Map(),
      failed: 4,
      firstError: 'Etsy public API 403 on /application/listings/1/reviews',
    })

    await expect(runScout()).rejects.toThrow(/Could not verify sales.*403/s)
  }, 20_000)

  it('says nothing is selling only when the lookups actually worked', async () => {
    verifySalesBatch.mockResolvedValue({
      proofs: new Map([[1, proof({ verifiedSales: 0 })]]),
      failed: 0,
      firstError: null,
    })

    await expect(runScout()).rejects.toThrow(/showed a sale in the last 90 days/)
  }, 20_000)

  it('returns proven picks with their evidence when Etsy answers', async () => {
    verifySalesBatch.mockResolvedValue({
      proofs: new Map([
        [1, proof({ listingId: 1, verifiedSales: 14 })],
        [2, proof({ listingId: 2, verifiedSales: 3 })],
      ]),
      failed: 0,
      firstError: null,
    })

    // No OPENAI/OPENROUTER key in a bare test run, so the writing brain throws
    // and the deterministic tag fallback produces the list — which is exactly
    // the guarantee worth testing: the board still fills with proven rows.
    const result = await runScout()

    expect(result.proven).toBe(2)
    expect(result.picks.length).toBeGreaterThan(0)
    expect(result.picks[0].verifiedSales).toBeGreaterThan(0)
    expect(result.picks[0].evidence[0].shopSoldCount).toBe(4200)
  }, 20_000)
})
