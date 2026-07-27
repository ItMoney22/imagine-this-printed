import { describe, expect, it } from 'vitest'
import {
  FOUNDER_PERCENTAGE,
  calculateFounderShareCents,
  countByStatus,
  filterByPeriod,
  formatCents,
  groupEarningsByMonth,
  summarizeInvoices,
  topBilledItems
} from '../founder-earnings'
import type { FounderInvoice, FounderInvoiceStatus } from '../founder-earnings'

/**
 * The backend's arithmetic, copied verbatim from
 * `backend/routes/invoices.ts` (the canonical source). If these two ever
 * diverge, the "reconciled" claim is dead and this suite says so.
 */
const BACKEND_FOUNDER_PERCENTAGE = 35
const backendFounderEarningsCents = (subtotalCents: number) =>
  Math.floor(subtotalCents * (BACKEND_FOUNDER_PERCENTAGE / 100))

let seq = 0
function invoice(overrides: Partial<FounderInvoice> = {}): FounderInvoice {
  seq += 1
  const subtotal = overrides.subtotal_cents ?? 10_000
  const share = overrides.founder_earnings_cents ?? backendFounderEarningsCents(subtotal)
  return {
    id: `inv_${seq}`,
    client_email: `client${seq}@example.com`,
    client_name: `Client ${seq}`,
    subtotal_cents: subtotal,
    platform_fee_cents: subtotal - share,
    founder_earnings_cents: share,
    founder_percentage: BACKEND_FOUNDER_PERCENTAGE,
    status: 'paid' as FounderInvoiceStatus,
    line_items: [],
    memo: null,
    due_date: null,
    created_at: '2026-07-10T12:00:00Z',
    sent_at: null,
    paid_at: null,
    stripe_hosted_invoice_url: null,
    ...overrides
  }
}

describe('founder share reconciliation', () => {
  it('uses the same rate as the backend', () => {
    expect(FOUNDER_PERCENTAGE).toBe(BACKEND_FOUNDER_PERCENTAGE)
  })

  it('matches the backend cent-for-cent, including the floor', () => {
    const subtotals = [0, 1, 3, 7, 99, 100, 101, 999, 2_599, 5_000, 12_345, 99_999, 1_000_000]
    for (const subtotal of subtotals) {
      expect(calculateFounderShareCents(subtotal)).toBe(backendFounderEarningsCents(subtotal))
    }
  })

  it('floors rather than rounds (3 cents of a $0.09 invoice, not 3.15)', () => {
    expect(calculateFounderShareCents(9)).toBe(3)
    expect(calculateFounderShareCents(299)).toBe(104) // 104.65 -> 104
  })

  it('is a revenue share — COGS and processing fees never enter the math', () => {
    // Two invoices with identical subtotals owe the founder identical amounts,
    // no matter what they cost to fulfil.
    expect(calculateFounderShareCents(5_000)).toBe(calculateFounderShareCents(5_000))
    expect(calculateFounderShareCents(5_000)).toBe(1_750)
  })

  it('honours a per-invoice historical rate', () => {
    expect(calculateFounderShareCents(10_000, 20)).toBe(2_000)
  })

  it('never returns a negative or NaN share', () => {
    expect(calculateFounderShareCents(-500)).toBe(0)
    expect(calculateFounderShareCents(Number.NaN)).toBe(0)
    expect(calculateFounderShareCents(1_000, 0)).toBe(0)
  })
})

describe('summarizeInvoices', () => {
  const invoices: FounderInvoice[] = [
    invoice({ subtotal_cents: 10_000, status: 'paid' }),      // share 3500
    invoice({ subtotal_cents: 25_000, status: 'paid' }),      // share 8750
    invoice({ subtotal_cents: 4_000, status: 'sent' }),       // share 1400
    invoice({ subtotal_cents: 6_000, status: 'overdue' }),    // share 2100
    invoice({ subtotal_cents: 8_000, status: 'draft' }),      // share 2800
    invoice({ subtotal_cents: 50_000, status: 'void' }),      // ignored
    invoice({ subtotal_cents: 90_000, status: 'uncollectible' }) // ignored
  ]

  const summary = summarizeInvoices(invoices)

  it('excludes void and uncollectible invoices from every money total', () => {
    expect(summary.invoiceCount).toBe(5)
    expect(summary.billedCents).toBe(10_000 + 25_000 + 4_000 + 6_000 + 8_000)
  })

  it('counts only paid invoices as collected/earned', () => {
    expect(summary.collectedCents).toBe(35_000)
    expect(summary.earnedCents).toBe(3_500 + 8_750)
  })

  it('treats overdue as pending, not as a blind spot', () => {
    expect(summary.pendingCents).toBe(1_400 + 2_100)
  })

  it('keeps unsent drafts out of pending', () => {
    expect(summary.draftCents).toBe(2_800)
  })

  it('reports an effective share that lands on the headline rate', () => {
    expect(summary.effectiveSharePercent).toBeCloseTo(35, 5)
  })

  it('returns all zeroes for an empty ledger instead of throwing', () => {
    const empty = summarizeInvoices([])
    expect(empty).toMatchObject({
      invoiceCount: 0,
      billedCents: 0,
      collectedCents: 0,
      earnedCents: 0,
      pendingCents: 0,
      effectiveSharePercent: 0
    })
  })
})

describe('countByStatus', () => {
  it('counts every status bucket including void', () => {
    const counts = countByStatus([
      invoice({ status: 'paid' }),
      invoice({ status: 'paid' }),
      invoice({ status: 'draft' }),
      invoice({ status: 'void' })
    ])
    expect(counts.paid).toBe(2)
    expect(counts.draft).toBe(1)
    expect(counts.void).toBe(1)
    expect(counts.sent).toBe(0)
  })
})

describe('filterByPeriod', () => {
  const now = new Date('2026-07-26T00:00:00Z')
  const invoices = [
    invoice({ created_at: '2026-07-24T00:00:00Z' }), // 2 days ago
    invoice({ created_at: '2026-07-01T00:00:00Z' }), // 25 days ago
    invoice({ created_at: '2026-02-01T00:00:00Z' }), // ~6 months ago
    invoice({ created_at: '2024-01-01T00:00:00Z' }), // > 2 years ago
    invoice({ created_at: 'not-a-date' })
  ]

  it('scopes to the requested window', () => {
    expect(filterByPeriod(invoices, 'week', now)).toHaveLength(1)
    expect(filterByPeriod(invoices, 'month', now)).toHaveLength(2)
    expect(filterByPeriod(invoices, 'year', now)).toHaveLength(3)
  })

  it('returns everything for "all", unparseable dates included', () => {
    expect(filterByPeriod(invoices, 'all', now)).toHaveLength(5)
  })

  it('drops rows with an unparseable date from a bounded window', () => {
    expect(filterByPeriod(invoices, 'year', now).some(i => i.created_at === 'not-a-date')).toBe(false)
  })
})

describe('groupEarningsByMonth', () => {
  it('groups real rows, newest first, with no padded or projected months', () => {
    const months = groupEarningsByMonth([
      invoice({ created_at: '2026-05-04T10:00:00Z', subtotal_cents: 10_000, status: 'paid' }),
      invoice({ created_at: '2026-05-20T10:00:00Z', subtotal_cents: 20_000, status: 'sent' }),
      invoice({ created_at: '2026-07-02T10:00:00Z', subtotal_cents: 30_000, status: 'paid' }),
      invoice({ created_at: '2026-07-03T10:00:00Z', status: 'void', subtotal_cents: 99_000 })
    ])

    // May and July only — June is genuinely empty and is NOT invented.
    expect(months.map(m => m.month)).toEqual(['2026-07', '2026-05'])

    const july = months[0]
    expect(july.invoiceCount).toBe(1)
    expect(july.billedCents).toBe(30_000)
    expect(july.earnedCents).toBe(10_500)

    const may = months[1]
    expect(may.invoiceCount).toBe(2)
    expect(may.billedCents).toBe(30_000)
    expect(may.collectedCents).toBe(10_000)
    expect(may.earnedCents).toBe(3_500)
    expect(may.pendingCents).toBe(7_000)
  })

  it('returns an empty series for an empty ledger', () => {
    expect(groupEarningsByMonth([])).toEqual([])
  })
})

describe('topBilledItems', () => {
  it('aggregates real line items and pro-rates the founder share back to them', () => {
    const items = topBilledItems([
      invoice({
        subtotal_cents: 10_000,
        line_items: [
          { description: 'Custom Tee', amount_cents: 2_000, quantity: 3 }, // 6000
          { description: 'Setup fee', amount_cents: 4_000, quantity: 1 }   // 4000
        ]
      }),
      invoice({
        subtotal_cents: 4_000,
        line_items: [{ description: 'custom tee', amount_cents: 2_000, quantity: 2 }]
      })
    ])

    expect(items).toHaveLength(2)

    const tee = items.find(i => i.description.toLowerCase() === 'custom tee')!
    expect(tee.quantity).toBe(5)
    expect(tee.billedCents).toBe(10_000)
    expect(tee.invoiceCount).toBe(2)
    // 3500 * (6000/10000) + 1400 * (4000/4000)
    expect(tee.founderShareCents).toBe(2_100 + 1_400)

    const setup = items.find(i => i.description === 'Setup fee')!
    expect(setup.founderShareCents).toBe(1_400)

    // The pro-rata slices sum back to the invoices' persisted founder share.
    const totalShare = items.reduce((sum, i) => sum + i.founderShareCents, 0)
    expect(totalShare).toBe(3_500 + 1_400)
  })

  it('ignores void invoices and invoices with no line items', () => {
    expect(
      topBilledItems([
        invoice({ status: 'void', line_items: [{ description: 'X', amount_cents: 500, quantity: 1 }] }),
        invoice({ line_items: null })
      ])
    ).toEqual([])
  })
})

describe('formatCents', () => {
  it('renders cents as USD', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(3_500)).toBe('$35.00')
    expect(formatCents(123_456)).toBe('$1,234.56')
  })
})
