import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FounderEarningsService, founderEarningsService } from './founder-earnings'

describe('FounderEarningsService', () => {
  let service: FounderEarningsService

  beforeEach(() => {
    service = new FounderEarningsService()
    // The service console.logs on every save; keep the reporter readable.
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  describe('calculateEarningsBreakdown', () => {
    it('applies the 3.5% Stripe fee and the 35% founder share', () => {
      const r = service.calculateEarningsBreakdown(100, 40)

      expect(r.saleAmount).toBe(100)
      expect(r.costOfGoods).toBe(40)
      expect(r.stripeFee).toBeCloseTo(3.5, 10)
      expect(r.grossProfit).toBeCloseTo(56.5, 10)
      expect(r.founderPercentage).toBe(0.35)
      expect(r.founderEarnings).toBeCloseTo(19.775, 10)
    })

    it('keeps the founder percentage at 35 — must stay in sync with the backend', () => {
      // backend/routes/invoices.ts hardcodes FOUNDER_PERCENTAGE = 35. A silent
      // drift here would mean the dashboard and the invoice disagree on payout.
      const r = service.calculateEarningsBreakdown(1000, 0, 0)
      expect(r.founderPercentage).toBe(0.35)
      expect(r.founderEarnings).toBeCloseTo(350, 10)
    })

    it('mirrors the top-level figures into breakdown', () => {
      const r = service.calculateEarningsBreakdown(200, 75)

      expect(r.breakdown.revenue).toBe(r.saleAmount)
      expect(r.breakdown.cogs).toBe(r.costOfGoods)
      expect(r.breakdown.processingFees).toBe(r.stripeFee)
      expect(r.breakdown.netProfit).toBe(r.grossProfit)
      expect(r.breakdown.founderShare).toBe(r.founderEarnings)
    })

    it('splits gross profit exactly between founder and retained earnings', () => {
      for (const [sale, cogs] of [[100, 40], [89.99, 31], [245, 110.25], [19.5, 0]]) {
        const r = service.calculateEarningsBreakdown(sale, cogs)
        expect(r.breakdown.founderShare + r.breakdown.retainedEarnings).toBeCloseTo(
          r.grossProfit,
          10,
        )
      }
    })

    it('honours a caller-supplied Stripe fee rate', () => {
      const r = service.calculateEarningsBreakdown(100, 0, 0.029)
      expect(r.stripeFee).toBeCloseTo(2.9, 10)
      expect(r.grossProfit).toBeCloseTo(97.1, 10)
      expect(r.founderEarnings).toBeCloseTo(33.985, 10)
    })

    it('charges no processing fee at a 0% rate (ITC-paid orders)', () => {
      const r = service.calculateEarningsBreakdown(50, 20, 0)
      expect(r.stripeFee).toBe(0)
      expect(r.grossProfit).toBe(30)
      expect(r.founderEarnings).toBeCloseTo(10.5, 10)
    })

    it('produces a zero split when the sale exactly covers COGS + fees', () => {
      const sale = 100
      const cogs = 100 - sale * 0.035
      const r = service.calculateEarningsBreakdown(sale, cogs)
      expect(r.grossProfit).toBeCloseTo(0, 10)
      expect(r.founderEarnings).toBeCloseTo(0, 10)
      expect(r.breakdown.retainedEarnings).toBeCloseTo(0, 10)
    })

    it('propagates a loss to the founder share rather than clamping at zero', () => {
      // Documents CURRENT behaviour: an underwater order hands the founder a
      // negative share. Whether payouts should floor at 0 is a product call —
      // if that rule changes, this assertion is the one to flip.
      const r = service.calculateEarningsBreakdown(10, 20)
      expect(r.grossProfit).toBeCloseTo(-10.35, 10)
      expect(r.founderEarnings).toBeLessThan(0)
      expect(r.founderEarnings).toBeCloseTo(-3.6225, 10)
    })

    it('handles a zero-dollar order', () => {
      const r = service.calculateEarningsBreakdown(0, 0)
      expect(r.stripeFee).toBe(0)
      expect(r.grossProfit).toBe(0)
      expect(r.founderEarnings).toBe(0)
      expect(r.breakdown.retainedEarnings).toBe(0)
    })
  })

  describe('calculateFounderEarnings', () => {
    it('multiplies per-unit COGS by line quantity before splitting profit', () => {
      // The mock order is $89.99 for 2 x product_1, whose COGS is $15.50/unit.
      // If the quantity multiplier were dropped, COGS would be 15.50 not 31.00
      // and the founder would be over-paid by ~$5.43.
      return service.calculateFounderEarnings('order_test_1').then(earnings => {
        expect(earnings.orderId).toBe('order_test_1')
        expect(earnings.saleAmount).toBeCloseTo(89.99, 10)
        expect(earnings.costOfGoods).toBeCloseTo(31.0, 10)
        expect(earnings.stripeFee).toBeCloseTo(3.14965, 10)
        expect(earnings.grossProfit).toBeCloseTo(55.84035, 10)
        expect(earnings.founderEarnings).toBeCloseTo(19.5441225, 10)
        expect(earnings.status).toBe('calculated')
        expect(Date.parse(earnings.calculatedAt)).not.toBeNaN()
      })
    })
  })

  describe('getFounderEarnings', () => {
    it('returns every mock row when unfiltered', async () => {
      const rows = await service.getFounderEarnings('founder_1')
      expect(rows).toHaveLength(3)
      expect(rows.every(r => r.founderId === 'founder_1')).toBe(true)
    })

    it('filters by status', async () => {
      const paid = await service.getFounderEarnings('founder_1', { status: 'paid' })
      expect(paid).toHaveLength(1)
      expect(paid[0].id).toBe('earnings_1')
    })

    it('filters by date window', async () => {
      const rows = await service.getFounderEarnings('founder_1', {
        startDate: '2025-01-12T00:00:00Z',
      })
      expect(rows.map(r => r.id)).toEqual(['earnings_2', 'earnings_3'])
    })

    it('paginates with offset + limit', async () => {
      const page = await service.getFounderEarnings('founder_1', { offset: 1, limit: 1 })
      expect(page.map(r => r.id)).toEqual(['earnings_2'])
    })
  })

  describe('generateEarningsReport', () => {
    it('sums the period rows and derives the average margin', async () => {
      const report = await service.generateEarningsReport('founder_1', {
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T00:00:00Z',
        type: 'yearly',
      })

      expect(report.totalRevenue).toBeCloseTo(89.99 + 156.5 + 245.0, 10)
      expect(report.totalCOGS).toBeCloseTo(35.6 + 78.25 + 110.25, 10)
      expect(report.totalStripeFees).toBeCloseTo(3.15 + 5.48 + 8.58, 10)
      expect(report.grossProfit).toBeCloseTo(51.24 + 72.77 + 126.17, 10)
      expect(report.founderEarnings).toBeCloseTo(17.93 + 25.47 + 44.16, 10)
      expect(report.retainedEarnings).toBeCloseTo(
        report.grossProfit - report.founderEarnings,
        10,
      )
      expect(report.averageMargin).toBeCloseTo(
        (report.grossProfit / report.totalRevenue) * 100,
        10,
      )
    })

    it('reports a 0% margin instead of NaN when the period is empty', async () => {
      const report = await service.generateEarningsReport('founder_1', {
        startDate: '2030-01-01T00:00:00Z',
        endDate: '2030-12-31T00:00:00Z',
        type: 'yearly',
      })

      expect(report.totalRevenue).toBe(0)
      expect(report.averageMargin).toBe(0)
      expect(report.founderEarnings).toBe(0)
    })
  })

  describe('processFounderPayout', () => {
    beforeEach(() => {
      // The service console.errors before rethrowing; the rejection below is
      // the assertion, so keep the reporter clean.
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('rejects a payout larger than the pending balance', async () => {
      await expect(service.processFounderPayout('founder_1', 1_000_000)).rejects.toThrow(
        'Failed to process founder payout',
      )
    })

    it('accepts a payout within the pending balance', async () => {
      await expect(service.processFounderPayout('founder_1', 1)).resolves.toBeUndefined()
    })
  })

  describe('calculateMargin', () => {
    it('returns margin as a percentage of revenue', () => {
      expect(service.calculateMargin(100, 40)).toBeCloseTo(60, 10)
      expect(service.calculateMargin(25, 25)).toBe(0)
    })

    it('guards against divide-by-zero on a $0 revenue line', () => {
      expect(service.calculateMargin(0, 10)).toBe(0)
    })

    it('goes negative when COGS exceeds revenue', () => {
      expect(service.calculateMargin(10, 20)).toBeCloseTo(-100, 10)
    })
  })

  describe('formatters', () => {
    it('formats USD to two decimals', () => {
      expect(service.formatCurrency(19.775)).toBe('$19.78')
      expect(service.formatCurrency(0)).toBe('$0.00')
      expect(service.formatCurrency(-3.5)).toBe('-$3.50')
    })

    it('formats percentages to one decimal', () => {
      expect(service.formatPercentage(35)).toBe('35.0%')
      expect(service.formatPercentage(44.44)).toBe('44.4%')
    })
  })

  describe('exported singleton', () => {
    it('is a ready-to-use FounderEarningsService', () => {
      expect(founderEarningsService).toBeInstanceOf(FounderEarningsService)
      expect(founderEarningsService.calculateEarningsBreakdown(100, 40).founderEarnings)
        .toBeCloseTo(19.775, 10)
    })
  })
})
