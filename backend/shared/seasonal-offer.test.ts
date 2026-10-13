import { describe, it, expect } from 'vitest'
import { describeFeaturedOffer, type FeaturedOfferRow } from './seasonal-offer'

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
      code: 'SPOOKY20', percentOff: 20, endsAt: '2026-11-01T03:59:00Z', minOrderAmount: null
    })
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
