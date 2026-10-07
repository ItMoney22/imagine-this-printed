import { describe, it, expect } from 'vitest'
import { ETSY_BAG, cameFromEtsyBagQr, summarizeEtsyBagWeeks, usedEtsyBagCode, weekStartUtc, type EtsyBagOrderRow } from './etsy-bag.js'

const QR = { utm_source: 'etsy', utm_medium: 'insert', utm_campaign: 'bag', landed_at: '2026-10-07T12:00:00Z' }

function order(over: Partial<EtsyBagOrderRow>): EtsyBagOrderRow {
  return {
    id: Math.random().toString(36).slice(2),
    created_at: '2026-10-07T15:00:00Z',
    payment_status: 'paid',
    discount_codes: [],
    discount_amount: 0,
    total: 0,
    attribution: null,
    ...over
  }
}

describe('ETSY_BAG facts', () => {
  it('the QR link is exactly the tracked URL David asked for', () => {
    expect(ETSY_BAG.url).toBe('https://imaginethisprinted.com/?utm_source=etsy&utm_medium=insert&utm_campaign=bag')
    const params = new URL(ETSY_BAG.url).searchParams
    expect(Object.fromEntries(params)).toEqual(ETSY_BAG.utm)
  })
})

describe('weekStartUtc', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartUtc(new Date('2026-10-07T23:59:00Z'))).toBe('2026-10-05') // Wednesday
    expect(weekStartUtc(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05') // Monday
    expect(weekStartUtc(new Date('2026-10-11T22:00:00Z'))).toBe('2026-10-05') // Sunday
  })
})

describe('summarizeEtsyBagWeeks', () => {
  const now = new Date('2026-10-07T18:00:00Z')

  it('counts a paid ETSYBAG order as a redemption, with its sales and discount', () => {
    const weeks = summarizeEtsyBagWeeks(
      [order({ discount_codes: ['ETSYBAG'], discount_amount: 3, total: 18.5, attribution: QR })],
      { weeks: 2, now }
    )
    expect(weeks[0]).toEqual({ weekStart: '2026-10-05', redemptions: 1, sales: 18.5, discountGiven: 3, qrOrders: 1, unpaidCheckouts: 0 })
    expect(weeks[1]).toMatchObject({ weekStart: '2026-09-28', redemptions: 0 })
  })

  it('keeps an abandoned checkout out of the redemption count', () => {
    const [week] = summarizeEtsyBagWeeks([order({ payment_status: 'pending', discount_codes: ['ETSYBAG'], total: 20 })], { weeks: 1, now })
    expect(week).toMatchObject({ redemptions: 0, sales: 0, unpaidCheckouts: 1 })
  })

  it('counts a QR visitor who paid without the code as a QR order, not a redemption', () => {
    const [week] = summarizeEtsyBagWeeks([order({ attribution: QR, total: 40 })], { weeks: 1, now })
    expect(week).toMatchObject({ redemptions: 0, qrOrders: 1 })
  })

  it('ignores other campaigns and other codes, and orders outside the window', () => {
    const weeks = summarizeEtsyBagWeeks(
      [
        order({ discount_codes: ['TRINIDAD'] }),
        order({ attribution: { utm_source: 'etsy', utm_medium: 'social', utm_campaign: 'bag' } }),
        order({ discount_codes: ['ETSYBAG'], created_at: '2026-01-01T00:00:00Z' })
      ],
      { weeks: 4, now }
    )
    expect(weeks).toHaveLength(4)
    expect(weeks.every(w => w.redemptions === 0 && w.qrOrders === 0 && w.unpaidCheckouts === 0)).toBe(true)
  })

  it('counts a refunded redemption (money was taken, then returned) as redeemed', () => {
    const [week] = summarizeEtsyBagWeeks([order({ payment_status: 'refunded', discount_codes: ['etsybag'], total: 10 })], { weeks: 1, now })
    expect(week.redemptions).toBe(1)
  })
})

describe('matchers', () => {
  it('usedEtsyBagCode is case-insensitive and null-safe', () => {
    expect(usedEtsyBagCode({ discount_codes: ['etsyBag'] })).toBe(true)
    expect(usedEtsyBagCode({ discount_codes: null })).toBe(false)
  })
  it('cameFromEtsyBagQr needs all three UTM values', () => {
    expect(cameFromEtsyBagQr({ attribution: QR })).toBe(true)
    expect(cameFromEtsyBagQr({ attribution: { utm_source: 'etsy' } })).toBe(false)
    expect(cameFromEtsyBagQr({ attribution: null })).toBe(false)
  })
})
