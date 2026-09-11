import { describe, it, expect } from 'vitest'
import { couponBlockHtml } from './email-blocks.js'

describe('couponBlockHtml', () => {
  it('prints the code exactly as it was written to discount_codes', () => {
    const html = couponBlockHtml({ code: 'THANKS10-AB3K9Z', percent: 10, expiresAt: '2026-11-10T12:00:00.000Z' })
    expect(html).toContain('THANKS10-AB3K9Z')
    expect(html).toContain('10% off your next order')
    expect(html).toContain('Good through November 10, 2026')
  })

  it('drops the expiry line rather than printing a blank date', () => {
    const html = couponBlockHtml({ code: 'THANKS10-AB3K9Z', percent: 10 })
    expect(html).toContain('THANKS10-AB3K9Z')
    expect(html).not.toContain('Good through')
  })

  it('renders nothing when there is no coupon, so the email just omits the card', () => {
    expect(couponBlockHtml(null)).toBe('')
    expect(couponBlockHtml(undefined)).toBe('')
    expect(couponBlockHtml({ code: '', percent: 10 })).toBe('')
  })

  it('escapes a code so it can never inject markup into the email', () => {
    const html = couponBlockHtml({ code: '<script>alert(1)</script>', percent: 10 })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
