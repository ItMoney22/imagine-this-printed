// Manager-facing cost + pricing maths. calculateProductCost drives the price a
// manager is told to charge, so the breakdown is asserted to the cent against
// figures worked out by hand from the formulas in cost-management.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CostManagementService, costManagementService } from './cost-management'
import type { CostVariables } from '../types'

const svc = new CostManagementService()

const vars: CostVariables = {
  id: 'cost_mgr1',
  managerId: 'mgr1',
  filamentPricePerGram: 0.025,
  electricityCostPerHour: 0.12,
  averagePackagingCost: 2.5,
  monthlyRent: 3500,
  overheadPercentage: 15,
  defaultMarginPercentage: 25,
  laborRatePerHour: 25,
  lastUpdated: '2026-07-28T00:00:00Z',
  createdAt: '2025-01-01T00:00:00Z'
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('calculateProductCost — the number a manager quotes from', () => {
  // 2h print, 100g filament:
  //   material    100g * $0.025 = $2.50
  //   electricity   2h * $0.12  = $0.24
  //   labour        2h * $25.00 = $50.00
  //   packaging                 = $2.50
  //   direct                    = $55.24
  //   overhead      15% of direct = $8.286
  //   total                      = $63.526
  //   price at 25% MARGIN  63.526 / 0.75 = $84.7013...
  it('adds material, electricity, labour and packaging, then overhead on top of all four', () => {
    const b = svc.calculateProductCost(vars, 2, 100)
    expect(b.materialCost).toBeCloseTo(2.5, 6)
    expect(b.electricityCost).toBeCloseTo(0.24, 6)
    expect(b.laborCost).toBeCloseTo(50, 6)
    expect(b.packagingCost).toBe(2.5)
    expect(b.overheadCost).toBeCloseTo(8.286, 6)
    expect(b.totalCost).toBeCloseTo(63.526, 6)
  })

  it('charges overhead on packaging too, not just on the machine time', () => {
    // If overhead were applied to material+electricity+labour only it would be
    // 15% of 52.74 = 7.911. It is 8.286 because packaging is inside the base.
    const b = svc.calculateProductCost(vars, 2, 100)
    expect(b.overheadCost).not.toBeCloseTo(7.911, 3)
    expect(b.overheadCost).toBeCloseTo(8.286, 6)
  })

  it('suggests a price by MARGIN (divide), never by markup (multiply)', () => {
    const b = svc.calculateProductCost(vars, 2, 100)
    expect(b.suggestedMargin).toBe(25)
    expect(b.suggestedPrice).toBeCloseTo(84.701333, 4) // 63.526 / (1 - 0.25)
    // A 25% markup would only be 79.4075 — that would quietly under-price every
    // product by ~6%.
    expect(b.suggestedPrice).not.toBeCloseTo(63.526 * 1.25, 2)
  })

  it('bills custom labour hours instead of print hours when supplied', () => {
    // 0.5h labour: 2.5 + 0.24 + 12.5 + 2.5 = 17.74 direct, +15% = 20.401
    const b = svc.calculateProductCost(vars, 2, 100, 0.5)
    expect(b.laborCost).toBeCloseTo(12.5, 6)
    expect(b.totalCost).toBeCloseTo(20.401, 6)
  })

  it('treats ZERO custom labour hours as "not supplied" and bills the full print time', () => {
    // `customLaborHours || printTimeHours` — 0 is falsy, so an unattended print
    // logged as 0 labour hours is still charged 2h of labour. Pinned as a known
    // behaviour; see the handoff finding.
    const b = svc.calculateProductCost(vars, 2, 100, 0)
    expect(b.laborCost).toBeCloseTo(50, 6)
  })

  it('carries the manager id and the inputs onto the breakdown', () => {
    const b = svc.calculateProductCost(vars, 3.5, 85)
    expect(b.managerId).toBe('mgr1')
    expect(b.printTimeHours).toBe(3.5)
    expect(b.materialUsageGrams).toBe(85)
  })
})

describe('margin maths', () => {
  it('calculateMargin is margin-on-PRICE, not markup-on-cost', () => {
    expect(svc.calculateMargin(75, 100)).toBeCloseTo(25, 6)
    expect(svc.calculateMargin(50, 100)).toBeCloseTo(50, 6) // markup would say 100%
  })

  it('reports a negative margin when a product is sold below cost', () => {
    expect(svc.calculateMargin(120, 100)).toBeCloseTo(-20, 6)
  })

  it('calculatePriceFromMargin round-trips with calculateMargin', () => {
    for (const margin of [10, 25, 33.5, 60]) {
      const price = svc.calculatePriceFromMargin(80, margin)
      expect(svc.calculateMargin(80, price)).toBeCloseTo(margin, 6)
    }
  })

  it('blows up to Infinity at a 100% margin — which validateCostInputs still allows', () => {
    // Documented gap: the validator accepts defaultMarginPercentage === 100 but
    // the pricing formula divides by zero. See the handoff finding.
    expect(svc.validateCostInputs({ ...vars, defaultMarginPercentage: 100 })).toEqual([])
    expect(svc.calculatePriceFromMargin(50, 100)).toBe(Infinity)
  })

  it('formats currency as US dollars with thousands separators', () => {
    expect(svc.formatCurrency(1234.5)).toBe('$1,234.50')
    expect(svc.formatCurrency(0)).toBe('$0.00')
  })
})

describe('validateCostInputs', () => {
  it('demands filament, electricity and labour rates', () => {
    expect(svc.validateCostInputs({})).toEqual([
      'Filament price per gram must be greater than 0',
      'Electricity cost per hour must be greater than 0',
      'Labor rate per hour must be greater than 0'
    ])
  })

  it('rejects zero and negative rates, not just missing ones', () => {
    const errors = svc.validateCostInputs({ ...vars, filamentPricePerGram: 0, laborRatePerHour: -5 })
    expect(errors).toContain('Filament price per gram must be greater than 0')
    expect(errors).toContain('Labor rate per hour must be greater than 0')
    expect(errors).not.toContain('Electricity cost per hour must be greater than 0')
  })

  it('bounds the percentages to 0-100', () => {
    expect(svc.validateCostInputs({ ...vars, overheadPercentage: 101 }))
      .toContain('Overhead percentage must be between 0 and 100')
    expect(svc.validateCostInputs({ ...vars, overheadPercentage: -1 }))
      .toContain('Overhead percentage must be between 0 and 100')
    expect(svc.validateCostInputs({ ...vars, defaultMarginPercentage: 150 }))
      .toContain('Default margin percentage must be between 0 and 100')
  })

  it('accepts a 0% overhead shop', () => {
    expect(svc.validateCostInputs({ ...vars, overheadPercentage: 0 })).toEqual([])
  })

  it('passes a fully populated set', () => {
    expect(svc.validateCostInputs(vars)).toEqual([])
  })
})

describe('queryGPTAssistant — the canned cost assistant', () => {
  it('prices a product from a cost + margin question', async () => {
    const answer = await svc.queryGPTAssistant('Price a $6.25 cost item at 30% margin')
    expect(answer).toContain('**$8.93**')       // 6.25 / 0.70
    expect(answer).toContain('Desired Margin: 30%')
    expect(answer).toContain('Profit: $2.68')
  })

  it('breaks down a print from hours + grams when cost variables are loaded', async () => {
    // 3h / 80g: 2.00 + 0.36 + 75.00 + 2.50 = 79.86, +15% = 91.839,
    // suggested at 25% margin = 122.452
    const answer = await svc.queryGPTAssistant('Cost for a 3 hour print using 80g of filament', vars)
    expect(answer).toContain('Total Cost:** $91.84')
    expect(answer).toContain('$122.45')
    expect(answer).toContain('Material (80g): $2.00')
  })

  it('cannot price a print without the manager cost variables', async () => {
    const answer = await svc.queryGPTAssistant('Cost for a 3 hour print using 80g of filament')
    expect(answer).toContain('Example Questions')
  })

  it('answers margin strategy questions', async () => {
    const answer = await svc.queryGPTAssistant('What margin do you recommend for premium work?')
    expect(answer).toContain('Premium/Custom Products:** 35-50% margin')
  })

  it('falls back to the help text for anything it does not recognise', async () => {
    expect(await svc.queryGPTAssistant('hello')).toContain('I can help you with cost and pricing calculations')
  })

  // --- The two questions the module itself advertises do NOT parse. ---------
  it('FAILS to answer its own advertised pricing example ("costs me $6.25")', async () => {
    // The cost regex is /\$?(\d+\.?\d*)\s*(?:cost|costs)/ — it needs the NUMBER
    // BEFORE the word "cost". The suggested phrasing puts it after, so the
    // assistant silently returns the generic help instead of a price.
    const answer = await svc.queryGPTAssistant(
      'What should I price a product if it costs me $6.25 and I want 30% margin?'
    )
    expect(answer).toContain('Example Questions')
    expect(answer).not.toContain('Selling Price')
  })

  it('FAILS to answer its own advertised print example ("3-hour")', async () => {
    // The hours regex is /(\d+\.?\d*)\s*hour/ — `\s*` does not match the hyphen
    // in "3-hour", so the advertised phrasing never reaches the calculator.
    const answer = await svc.queryGPTAssistant(
      'How much does a 3-hour print with 80g filament cost at current rates?',
      vars
    )
    expect(answer).toContain('Example Questions')
    expect(answer).not.toContain('Cost Breakdown for')
  })
})

describe('persistence stubs (mock data until Prisma is wired)', () => {
  it('scopes the seeded cost variables to the manager and keeps the documented rates', async () => {
    const v = await svc.getCostVariables('mgr9')
    expect(v?.id).toBe('cost_mgr9')
    expect(v?.managerId).toBe('mgr9')
    expect(v?.filamentPricePerGram).toBe(0.025)
    expect(v?.laborRatePerHour).toBe(25)
    expect(v?.defaultMarginPercentage).toBe(25)
  })

  it('defaults the margin to 25% on save and zeroes the unset rates', async () => {
    const saved = await svc.saveCostVariables({ managerId: 'mgr1', createdAt: '2025-01-01T00:00:00Z' })
    expect(saved.defaultMarginPercentage).toBe(25)
    expect(saved.filamentPricePerGram).toBe(0)
    expect(saved.createdAt).toBe('2025-01-01T00:00:00Z')
    expect(saved.id).toMatch(/^cost_\d+$/)
  })

  it('turns an explicit 0% margin back into 25% on save', async () => {
    // Same `|| 25` falsy-zero trap as the labour hours above.
    const saved = await svc.saveCostVariables({ managerId: 'mgr1', defaultMarginPercentage: 0 })
    expect(saved.defaultMarginPercentage).toBe(25)
  })

  it('returns the manager scoped breakdown list and analytics period', async () => {
    const rows = await svc.getCostBreakdowns('mgr1')
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.managerId === 'mgr1')).toBe(true)

    const analytics = await svc.getCostAnalytics('mgr1')
    expect(analytics.period).toBe('Last month')
    expect(analytics.lowMarginProducts.every(p => p.currentMargin < p.suggestedMargin)).toBe(true)
  })

  it('exposes a shared singleton', () => {
    expect(costManagementService.calculateMargin(75, 100)).toBeCloseTo(25, 6)
  })
})
