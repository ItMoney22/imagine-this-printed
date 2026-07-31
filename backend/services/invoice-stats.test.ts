import { describe, it, expect } from 'vitest'

// invoice-stats.ts is deliberately import-free (no express / stripe / supabase),
// so unlike most backend suites this one needs no env priming and can use a
// plain static import.
import {
  FOUNDER_PERCENTAGE,
  calculateFounderShareCents,
  buildInvoiceStats
} from './invoice-stats.js'

describe('the founder share is 35% of the invoice SUBTOTAL', () => {
  it('pins the rate — a change here restates money already billed', () => {
    expect(FOUNDER_PERCENTAGE).toBe(35)
  })

  it('splits a $100.00 invoice 35 / 65', () => {
    const subtotal = 10_000
    const founder = calculateFounderShareCents(subtotal)
    expect(founder).toBe(3_500)
    // The platform keeps the remainder — that is how invoices.ts derives
    // platform_fee_cents, so the two must always sum back to the subtotal.
    expect(subtotal - founder).toBe(6_500)
  })

  it('splits a real-world $47.99 invoice to the cent', () => {
    // 4799 * 0.35 = 1679.65 -> floored
    expect(calculateFounderShareCents(4_799)).toBe(1_679)
  })

  it('floors rather than rounds, so the founder is never over-credited', () => {
    // 3 * 0.35 = 1.05 -> 1, not 1.05 and not 2
    expect(calculateFounderShareCents(3)).toBe(1)
    // 1 * 0.35 = 0.35 -> 0
    expect(calculateFounderShareCents(1)).toBe(0)
    expect(Number.isInteger(calculateFounderShareCents(12_345))).toBe(true)
  })

  it('never exceeds the subtotal and never goes negative, across a wide sweep', () => {
    for (let subtotal = 0; subtotal <= 20_000; subtotal += 7) {
      const founder = calculateFounderShareCents(subtotal)
      expect(founder).toBeGreaterThanOrEqual(0)
      expect(founder).toBeLessThanOrEqual(subtotal)
      expect(subtotal - founder).toBeGreaterThanOrEqual(0)
    }
  })

  it('honours a per-invoice rate, so historical rows keep the rate they were issued under', () => {
    expect(calculateFounderShareCents(10_000, 50)).toBe(5_000)
    expect(calculateFounderShareCents(10_000, 0)).toBe(0) // e.g. an admin invoice
  })

  it('returns 0 for junk input instead of NaN-ing a money column', () => {
    expect(calculateFounderShareCents(0)).toBe(0)
    expect(calculateFounderShareCents(-100)).toBe(0)
    expect(calculateFounderShareCents(Number.NaN)).toBe(0)
    expect(calculateFounderShareCents(undefined as unknown as number)).toBe(0)
  })

  it('is NOT the admin control-panel formula — the two differ by ~14x', () => {
    // backend/routes/admin/control-panel.ts: platform fee (7%) x founder rate
    // (35%) = 2.45% of ORDER revenue. Same 35, different base. This assertion
    // exists so nobody "reconciles" them by making one call the other.
    const orderRevenueCents = 10_000
    const controlPanelFounderCents = orderRevenueCents * 0.07 * 0.35
    // toBeCloseTo, not toBe: the control-panel path is float dollar maths and
    // lands on 245.00000000000003. The invoice path is integer cents on
    // purpose, which is why it can be asserted exactly.
    expect(controlPanelFounderCents).toBeCloseTo(245, 6)
    expect(calculateFounderShareCents(orderRevenueCents)).toBe(3_500)
  })
})

describe('buildInvoiceStats rolls the shares up the same way', () => {
  it('counts paid invoices as earned and outstanding ones as pending', () => {
    const stats = buildInvoiceStats([
      { status: 'paid', subtotal_cents: 10_000, founder_earnings_cents: 3_500 },
      { status: 'sent', subtotal_cents: 20_000, founder_earnings_cents: 7_000 },
      { status: 'overdue', subtotal_cents: 5_000, founder_earnings_cents: 1_750 }
    ])

    expect(stats.total_collected_cents).toBe(10_000)
    expect(stats.total_earnings_cents).toBe(3_500)
    // Overdue is money still owed, not a blind spot.
    expect(stats.pending_earnings_cents).toBe(8_750)
    expect(stats.total_billed_cents).toBe(35_000)
    expect(stats.total_earnings).toBe(35)
  })

  it('excludes void and uncollectible rows from billed totals without NaN-ing a count', () => {
    const stats = buildInvoiceStats([
      { status: 'paid', subtotal_cents: 10_000, founder_earnings_cents: 3_500 },
      { status: 'void', subtotal_cents: 99_999, founder_earnings_cents: 34_999 },
      { status: 'uncollectible', subtotal_cents: 99_999, founder_earnings_cents: 34_999 }
    ])

    expect(stats.total_billed_cents).toBe(10_000)
    expect(stats.total_invoices).toBe(3)
    expect(Number.isNaN(stats.void)).toBe(false)
    expect(stats.void).toBe(1)
  })

  it('handles an empty ledger', () => {
    const stats = buildInvoiceStats([])
    expect(stats.total_invoices).toBe(0)
    expect(stats.total_earnings_cents).toBe(0)
  })
})
