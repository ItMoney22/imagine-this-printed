import { describe, it, expect } from 'vitest'
import { aggregateSignals, listingSignal, type ActiveListing } from './etsy-market-research.js'

// Pure-aggregation tests — no network. Shapes mirror what
// GET /application/listings/active actually returns (amount/divisor money,
// epoch-seconds timestamps).

const NOW = Date.parse('2026-08-20T00:00:00Z')
const daysAgo = (d: number) => Math.floor(NOW / 1000) - d * 86_400

function listing(over: Partial<ActiveListing>): ActiveListing {
  return {
    listing_id: Math.floor(Math.random() * 1e9),
    title: 'Retro Bass Fishing Shirt Funny Fisherman Gift',
    tags: ['bass fishing', 'fishing gift', 'retro fishing'],
    price: { amount: 2499, divisor: 100, currency_code: 'USD' },
    num_favorers: 10,
    original_creation_timestamp: daysAgo(30),
    taxonomy_id: 1,
    url: 'https://etsy.com/listing/x',
    ...over,
  }
}

describe('listingSignal', () => {
  it('computes price from amount/divisor and age in days', () => {
    const s = listingSignal(listing({}), NOW)
    expect(s.priceUsd).toBe(24.99)
    expect(s.ageDays).toBe(30)
  })

  it('heat favors young momentum over stale popularity', () => {
    // 40 favorites in 10 days (young, 2x boost) vs 400 favorites over 4 years.
    const young = listingSignal(listing({ num_favorers: 40, original_creation_timestamp: daysAgo(10) }), NOW)
    const stale = listingSignal(listing({ num_favorers: 400, original_creation_timestamp: daysAgo(1460) }), NOW)
    expect(young.heat).toBeGreaterThan(stale.heat)
  })

  it('never divides by zero on a listing created today', () => {
    const s = listingSignal(listing({ original_creation_timestamp: Math.floor(NOW / 1000) }), NOW)
    expect(Number.isFinite(s.heat)).toBe(true)
  })
})

describe('aggregateSignals', () => {
  it('surfaces repeated tags and title phrases, drops singletons and stopwords', () => {
    const listings = [
      listing({ listing_id: 1, title: 'Bass Fishing Dad Shirt', tags: ['bass fishing', 'dad gift'] }),
      listing({ listing_id: 2, title: 'Bass Fishing Camp Tee', tags: ['bass fishing', 'lake life'] }),
      listing({ listing_id: 3, title: 'Cat Mom Shirt', tags: ['cat mom'] }),
    ]
    const sig = aggregateSignals('shirts', ['bass'], listings, NOW)
    expect(sig.sampled).toBe(3)
    expect(sig.topTags[0]).toEqual({ tag: 'bass fishing', count: 2 })
    // 'cat mom' appears once → filtered as noise.
    expect(sig.topTags.find((t) => t.tag === 'cat mom')).toBeUndefined()
    expect(sig.topPhrases[0].phrase).toBe('bass fishing')
    // 'shirt'/'tee' are catalog words, not signal.
    expect(sig.topPhrases.find((p) => p.phrase.includes('shirt'))).toBeUndefined()
  })

  it('reports price quartiles and the hottest listings first', () => {
    const listings = [
      listing({ listing_id: 1, price: { amount: 1500, divisor: 100, currency_code: 'USD' }, num_favorers: 2 }),
      listing({ listing_id: 2, price: { amount: 2500, divisor: 100, currency_code: 'USD' }, num_favorers: 90, original_creation_timestamp: daysAgo(9) }),
      listing({ listing_id: 3, price: { amount: 3500, divisor: 100, currency_code: 'USD' }, num_favorers: 5 }),
    ]
    const sig = aggregateSignals('shirts', ['q'], listings, NOW)
    expect(sig.priceUsd.median).toBe(25)
    expect(sig.hottest[0].favorers).toBe(90)
  })
})
