import { describe, it, expect } from 'vitest'
import { describeFeaturedOffer, matchesOfferTheme, offerThemeOf, type FeaturedOfferRow } from './seasonal-offer'

const now = new Date('2026-10-15T12:00:00Z')
const row = (over: Partial<FeaturedOfferRow> = {}): FeaturedOfferRow => ({
  code: 'SPOOKY20',
  type: 'percentage',
  value: 20,
  is_active: true,
  expires_at: '2026-11-01T03:59:00Z',
  max_uses: null,
  current_uses: 0,
  min_order_amount: null,
  ...over
})

describe('describeFeaturedOffer', () => {
  it('describes a live percentage offer', () => {
    expect(describeFeaturedOffer(row(), now)).toEqual({
      code: 'SPOOKY20', percentOff: 20, endsAt: '2026-11-01T03:59:00.000Z', minOrderAmount: null, theme: 'halloween'
    })
  })
  it('reads the live zone-less expires_at as UTC, so the banner says October 31 in every browser', () => {
    const offer = describeFeaturedOffer(row({ expires_at: '2026-11-01T03:59:00' }), now)
    expect(offer?.endsAt).toBe('2026-11-01T03:59:00.000Z')
    const label = new Date(offer!.endsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' })
    expect(label).toBe('October 31')
    expect(describeFeaturedOffer(row({ expires_at: '2026-11-01T03:59:00' }), new Date('2026-11-01T04:00:00Z'))).toBeNull()
  })
  it('advertises nothing once the end date passes', () => {
    expect(describeFeaturedOffer(row(), new Date('2026-11-01T04:00:00Z'))).toBeNull()
  })
  it('advertises nothing without an end date, when inactive, used up, or not a percentage', () => {
    expect(describeFeaturedOffer(row({ expires_at: null }), now)).toBeNull()
    expect(describeFeaturedOffer(row({ is_active: false }), now)).toBeNull()
    expect(describeFeaturedOffer(row({ max_uses: 5, current_uses: 5 }), now)).toBeNull()
    expect(describeFeaturedOffer(row({ type: 'fixed' }), now)).toBeNull()
    expect(describeFeaturedOffer(null, now)).toBeNull()
  })
})

describe('SPOOKY20 is for Halloween designs only (David 2026-10-16)', () => {
  it('knows which codes are themed', () => {
    expect(offerThemeOf({ code: 'SPOOKY20' })).toBe('halloween')
    expect(offerThemeOf({ code: 'spooky20' })).toBe('halloween')
    expect(offerThemeOf({ code: 'THANKS10' })).toBeNull()
    expect(offerThemeOf({ code: 'ANY', metadata: { theme: 'Christmas' } })).toBe('christmas')
  })

  it('takes nothing off the Folgers racing tee', () => {
    expect(matchesOfferTheme({ name: 'Folgers Coffee Racing Legend T-Shirt', description: 'A red No. 25 stock car.' }, 'halloween')).toBe(false)
  })

  it('does not count an alien tee just for being spooky-adjacent', () => {
    expect(matchesOfferTheme({ name: 'Cosmic Encounter: Boy Meets Alien', description: 'A glowing UFO.' }, 'halloween')).toBe(false)
  })

  it('counts a Halloween collection, name, description, search keywords or listing tags', () => {
    expect(matchesOfferTheme({ name: 'Bad Witch Vibes', metadata: { collection: 'Halloween Vol3' } }, 'halloween')).toBe(true)
    expect(matchesOfferTheme({ name: 'Too Cute To Spook Ghost T-Shirt | Halloween Unisex Tee' }, 'halloween')).toBe(true)
    expect(matchesOfferTheme({ name: 'Moon', description: 'Perfect for Halloween night.' }, 'halloween')).toBe(true)
    expect(matchesOfferTheme({ name: 'Candle', search_keywords: ['gothic', 'halloween decor'] }, 'halloween')).toBe(true)
    expect(matchesOfferTheme({ name: 'Owl', metadata: { etsy_pack: { tags: ['halloween owl'] } } }, 'halloween')).toBe(true)
  })

  it('an unthemed code covers everything', () => {
    expect(matchesOfferTheme({ name: 'Folgers' }, null)).toBe(true)
  })
})

