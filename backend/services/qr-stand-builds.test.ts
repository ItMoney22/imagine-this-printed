import { describe, it, expect } from 'vitest'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const { lineGrossCents } = await import('./qr-stand-builds.js')

describe('lineGrossCents — what a reseller\'s share is of', () => {
  it('is the line price times quantity with no discount', () => {
    expect(lineGrossCents(17.95, 2, 35.9, 0)).toBe(3590)
  })

  it('takes the line\'s share of an order-wide coupon off', () => {
    // 20% off a $35.90 subtotal: $7.18 off, the whole of it on this line.
    expect(lineGrossCents(17.95, 2, 35.9, 7.18)).toBe(2872)
    // Same coupon on a mixed cart: the stand line carries its share only.
    expect(lineGrossCents(17.95, 1, 42.95, 8.59)).toBe(1436)
  })

  it('never goes below zero, even if the discount is the whole order', () => {
    expect(lineGrossCents(17.95, 1, 17.95, 50)).toBe(0)
  })
})
