// Manager-facing cost + pricing maths. calculateProductCost drives the price a
// manager is told to charge, so the breakdown is asserted to the cent against
// figures worked out by hand from the formulas in cost-management.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CostVariables } from '../types'

type DbRow = Record<string, string | number | null>
type DbResult = { data: DbRow | null; error: { message: string } | null }
type DbListResult = { data: DbRow[] | null; error: { message: string } | null }
type UpsertPayload = Record<string, string | number | null>
type InsertPayload = Record<string, unknown>

interface FakeBuilder {
  select: (columns?: string, opts?: { count?: string }) => FakeBuilder
  eq: (column: string, value: unknown) => FakeBuilder
  order: (column: string, opts?: { ascending?: boolean }) => FakeBuilder
  limit: (n: number) => FakeBuilder
  gte: (column: string, value: unknown) => FakeBuilder
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
  then: (resolve: (v: DbListResult) => void) => void
  upsert: (
    payload: UpsertPayload,
    options: { onConflict?: string }
  ) => { select: () => { single: () => Promise<DbResult> } }
  insert: (payload: InsertPayload) => { select: () => { single: () => Promise<DbResult> } }
}

// Chainable stand-in for the supabase query builder. Each test sets what the
// terminal call (maybeSingle / single / the promise itself) resolves to and
// then inspects what the service actually sent.
const state: {
  readResult: DbResult
  writeResult: DbResult
  listResult: DbListResult
  insertResult: DbResult
  lastTable: string | null
  lastFilter: { column: string; value: unknown } | null
  lastUpsert: { payload: UpsertPayload; options: { onConflict?: string } } | null
  lastInsert: InsertPayload | null
} = {
  readResult: { data: null, error: null },
  writeResult: { data: null, error: null },
  listResult: { data: [], error: null },
  insertResult: { data: null, error: null },
  lastTable: null,
  lastFilter: null,
  lastUpsert: null,
  lastInsert: null
}

vi.mock('../lib/supabase', () => {
  const builder: FakeBuilder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      state.lastFilter = { column, value }
      return builder
    },
    order: () => builder,
    limit: () => builder,
    gte: () => builder,
    maybeSingle: async () => state.readResult,
    single: async () => state.writeResult,
    then: (resolve: (v: DbListResult) => void) => resolve(state.listResult),
    upsert: (payload: UpsertPayload, options: { onConflict?: string }) => {
      state.lastUpsert = { payload, options }
      return {
        select: () => ({ single: async () => state.writeResult })
      }
    },
    insert: (payload: InsertPayload) => {
      state.lastInsert = payload
      return {
        select: () => ({ single: async () => state.insertResult })
      }
    }
  }

  return {
    supabase: {
      from: (table: string) => {
        state.lastTable = table
        return builder
      }
    }
  }
})

const { CostManagementService, costManagementService, DEFAULT_COST_VARIABLES } = await import('./cost-management')

const svc = new CostManagementService()

const MANAGER_ID = '11111111-2222-3333-4444-555555555555'

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
  vi.spyOn(console, 'error').mockImplementation(() => {})
  state.readResult = { data: null, error: null }
  state.writeResult = { data: null, error: null }
  state.listResult = { data: [], error: null }
  state.insertResult = { data: null, error: null }
  state.lastTable = null
  state.lastFilter = null
  state.lastUpsert = null
  state.lastInsert = null
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

  it('matches the example questions the dashboard currently advertises', async () => {
    // These strings are shown to managers in the Keyword Assistant tab and in
    // the fallback reply. If a phrasing stops matching, the UI is promising
    // something the matcher will not deliver.
    const pricing = await svc.queryGPTAssistant('What price gives a 30% margin on a $15.00 cost?')
    expect(pricing).toContain('Selling Price')

    const printCost = await svc.queryGPTAssistant(
      'How much does a 2.5 hour print with 60g filament cost?',
      vars
    )
    expect(printCost).toContain('Cost Breakdown')
  })

  // --- Phrasings that still do NOT parse, even after the example text was
  // rewritten to match. Kept as a live regression pin on the matcher itself. --
  it('FAILS on a natural phrasing that puts the cost word before the number ("costs me $6.25")', async () => {
    // The cost regex is /\$?(\d+\.?\d*)\s*(?:cost|costs)/ — it needs the NUMBER
    // BEFORE the word "cost". This phrasing puts it after, so the assistant
    // silently returns the generic help instead of a price.
    const answer = await svc.queryGPTAssistant(
      'What should I price a product if it costs me $6.25 and I want 30% margin?'
    )
    expect(answer).toContain('Example Questions')
    expect(answer).not.toContain('Selling Price')
  })

  it('FAILS on a hyphenated duration ("3-hour")', async () => {
    // The hours regex is /(\d+\.?\d*)\s*hour/ — `\s*` does not match the hyphen
    // in "3-hour", so that phrasing never reaches the calculator.
    const answer = await svc.queryGPTAssistant(
      'How much does a 3-hour print with 80g filament cost at current rates?',
      vars
    )
    expect(answer).toContain('Example Questions')
    expect(answer).not.toContain('Cost Breakdown for')
  })
})

describe('costManagementService cost variable persistence', () => {
  let service: InstanceType<typeof CostManagementService>

  // Postgres DECIMAL comes back as a string through PostgREST.
  const savedRow = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    manager_id: MANAGER_ID,
    location_id: null,
    filament_price_per_gram: '0.044',
    electricity_cost_per_hour: '0.15',
    average_packaging_cost: '3.25',
    monthly_rent: '4500',
    overhead_percentage: '20',
    default_margin_percentage: '35',
    labor_rate_per_hour: '30',
    last_updated: '2026-07-26T12:00:00.000Z',
    created_at: '2026-07-20T12:00:00.000Z'
  }

  beforeEach(() => {
    service = new CostManagementService()
  })

  describe('getCostVariables', () => {
    it('returns the saved row, keyed by manager id, with DECIMAL strings coerced to numbers', async () => {
      state.readResult = { data: savedRow, error: null }

      const result = await service.getCostVariables(MANAGER_ID)

      expect(state.lastTable).toBe('cost_variables')
      expect(state.lastFilter).toEqual({ column: 'manager_id', value: MANAGER_ID })
      expect(result?.source).toBe('database')
      expect(result?.filamentPricePerGram).toBe(0.044)
      expect(result?.monthlyRent).toBe(4500)
      expect(result?.defaultMarginPercentage).toBe(35)
      // The old bug: a reload silently reverted to these.
      expect(result?.filamentPricePerGram).not.toBe(DEFAULT_COST_VARIABLES.filamentPricePerGram)
      expect(result?.monthlyRent).not.toBe(DEFAULT_COST_VARIABLES.monthlyRent)
    })

    it('preserves a legitimate saved zero instead of falling back', async () => {
      state.readResult = { data: { ...savedRow, electricity_cost_per_hour: '0' }, error: null }

      const result = await service.getCostVariables(MANAGER_ID)

      expect(result?.electricityCostPerHour).toBe(0)
    })

    it('falls back to defaults marked as unsaved when the manager has no row', async () => {
      state.readResult = { data: null, error: null }

      const result = await service.getCostVariables(MANAGER_ID)

      expect(result?.source).toBe('defaults')
      expect(result?.loadError).toBeUndefined()
      expect(result?.filamentPricePerGram).toBe(DEFAULT_COST_VARIABLES.filamentPricePerGram)
      expect(result?.monthlyRent).toBe(DEFAULT_COST_VARIABLES.monthlyRent)
    })

    it('falls back to defaults and reports the reason when the read fails', async () => {
      state.readResult = { data: null, error: { message: 'permission denied for table cost_variables' } }

      const result = await service.getCostVariables(MANAGER_ID)

      expect(result?.source).toBe('defaults')
      expect(result?.loadError).toContain('permission denied')
    })
  })

  describe('saveCostVariables', () => {
    it('upserts on manager_id so a second save updates rather than duplicates', async () => {
      state.writeResult = { data: savedRow, error: null }

      const result = await service.saveCostVariables({
        managerId: MANAGER_ID,
        filamentPricePerGram: 0.044,
        electricityCostPerHour: 0.15,
        averagePackagingCost: 3.25,
        monthlyRent: 4500,
        overheadPercentage: 20,
        defaultMarginPercentage: 35,
        laborRatePerHour: 30
      })

      expect(state.lastTable).toBe('cost_variables')
      expect(state.lastUpsert?.options).toEqual({ onConflict: 'manager_id' })
      expect(state.lastUpsert?.payload.manager_id).toBe(MANAGER_ID)
      expect(state.lastUpsert?.payload.filament_price_per_gram).toBe(0.044)
      expect(state.lastUpsert?.payload.monthly_rent).toBe(4500)
      expect(result.source).toBe('database')
      expect(result.monthlyRent).toBe(4500)
    })

    it('throws when the database rejects the write, so callers cannot claim success', async () => {
      state.writeResult = { data: null, error: { message: 'new row violates row-level security policy' } }

      await expect(
        service.saveCostVariables({ managerId: MANAGER_ID, monthlyRent: 4500 })
      ).rejects.toThrow(/row-level security/)
    })

    it('throws when no row comes back, so callers cannot claim success', async () => {
      state.writeResult = { data: null, error: null }

      await expect(
        service.saveCostVariables({ managerId: MANAGER_ID, monthlyRent: 4500 })
      ).rejects.toThrow(/no row/)
    })

    it('refuses to save without a manager id instead of writing an orphan row', async () => {
      await expect(service.saveCostVariables({ monthlyRent: 4500 })).rejects.toThrow(/manager account id/)
      expect(state.lastUpsert).toBeNull()
    })
  })

  it('exposes a shared singleton', () => {
    expect(costManagementService.calculateMargin(75, 100)).toBeCloseTo(25, 6)
  })
})

describe('product cost breakdown persistence', () => {
  let service: InstanceType<typeof CostManagementService>

  beforeEach(() => {
    service = new CostManagementService()
  })

  const breakdown = {
    id: 'breakdown-1',
    productId: 'product-1',
    managerId: MANAGER_ID,
    printTimeHours: 3.5,
    materialUsageGrams: 85,
    materialCost: 2.13,
    electricityCost: 0.42,
    laborCost: 87.5,
    packagingCost: 2.5,
    overheadCost: 13.86,
    totalCost: 106.41,
    suggestedMargin: 25,
    suggestedPrice: 141.88,
    finalPrice: 139.99,
    lastUpdated: '2026-08-16T00:00:00.000Z',
    createdAt: '2026-08-16T00:00:00.000Z'
  }

  it('upserts a breakdown keyed on (manager_id, product_id) so recalculating a product updates in place', async () => {
    state.writeResult = {
      data: {
        id: 'row-1',
        product_id: 'product-1',
        manager_id: MANAGER_ID,
        print_time_hours: '3.5',
        material_usage_grams: '85',
        material_cost: '2.13',
        electricity_cost: '0.42',
        labor_cost: '87.5',
        packaging_cost: '2.5',
        overhead_cost: '13.86',
        total_cost: '106.41',
        suggested_margin: '25',
        suggested_price: '141.88',
        final_price: '139.99',
        last_updated: '2026-08-16T00:00:00.000Z',
        created_at: '2026-08-16T00:00:00.000Z'
      },
      error: null
    }

    await service.saveProductCostBreakdown(breakdown)

    expect(state.lastTable).toBe('product_cost_breakdowns')
    expect(state.lastUpsert?.options).toEqual({ onConflict: 'manager_id,product_id' })
    expect(state.lastUpsert?.payload.product_id).toBe('product-1')
    expect(state.lastUpsert?.payload.total_cost).toBe(106.41)
  })

  it('throws when the write fails, so the UI cannot claim a breakdown was saved', async () => {
    state.writeResult = { data: null, error: { message: 'permission denied' } }

    await expect(service.saveProductCostBreakdown(breakdown)).rejects.toThrow(/permission denied/)
  })

  it('reads breakdowns back scoped to the manager, coercing DECIMAL strings', async () => {
    state.listResult = {
      data: [
        {
          id: 'row-1',
          product_id: 'product-1',
          manager_id: MANAGER_ID,
          print_time_hours: '3.5',
          material_usage_grams: '85',
          material_cost: '2.13',
          electricity_cost: '0.42',
          labor_cost: '87.5',
          packaging_cost: '2.5',
          overhead_cost: '13.86',
          total_cost: '106.41',
          suggested_margin: '25',
          suggested_price: '141.88',
          final_price: '139.99',
          last_updated: '2026-08-16T00:00:00.000Z',
          created_at: '2026-08-16T00:00:00.000Z'
        }
      ],
      error: null
    }

    const rows = await service.getCostBreakdowns(MANAGER_ID)

    expect(state.lastTable).toBe('product_cost_breakdowns')
    expect(state.lastFilter).toEqual({ column: 'manager_id', value: MANAGER_ID })
    expect(rows).toHaveLength(1)
    expect(rows[0].totalCost).toBe(106.41)
    expect(rows[0].finalPrice).toBe(139.99)
  })

  it('returns an empty list rather than throwing when the read fails', async () => {
    state.listResult = { data: null, error: { message: 'relation does not exist' } }

    const rows = await service.getCostBreakdowns(MANAGER_ID)
    expect(rows).toEqual([])
  })
})

describe('getCostAnalytics — computed from real breakdown rows', () => {
  let service: InstanceType<typeof CostManagementService>

  beforeEach(() => {
    service = new CostManagementService()
  })

  it('computes totals, averages and low-margin products from the manager\'s saved breakdowns', async () => {
    state.listResult = {
      data: [
        {
          id: 'row-1', product_id: 'Budget Phone Case', manager_id: MANAGER_ID,
          print_time_hours: '1', material_usage_grams: '20',
          material_cost: '0.5', electricity_cost: '0.12', labor_cost: '25', packaging_cost: '2.5',
          overhead_cost: '4.22', total_cost: '32.34',
          suggested_margin: '25', suggested_price: '43.12', final_price: '37',
          last_updated: '2026-08-01T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z'
        },
        {
          id: 'row-2', product_id: 'Premium Vase', manager_id: MANAGER_ID,
          print_time_hours: '4', material_usage_grams: '150',
          material_cost: '3.75', electricity_cost: '0.48', labor_cost: '100', packaging_cost: '2.5',
          overhead_cost: '16', total_cost: '122.73',
          suggested_margin: '30', suggested_price: '175.33', final_price: '170',
          last_updated: '2026-08-02T00:00:00.000Z', created_at: '2026-08-02T00:00:00.000Z'
        }
      ],
      error: null
    }

    const analytics = await service.getCostAnalytics(MANAGER_ID, 'month')

    expect(state.lastTable).toBe('product_cost_breakdowns')
    expect(analytics.period).toBe('Last month')
    expect(analytics.totalProducts).toBe(2)
    // averageCost = (32.34 + 122.73) / 2 = 77.535, rounded to the cent
    expect(analytics.averageCost).toBeCloseTo(77.54, 2)
    // margin on final_price: (37-32.34)/37=12.59%%, (170-122.73)/170=27.81%
    expect(analytics.lowMarginProducts.some(p => p.productId === 'Budget Phone Case')).toBe(true)
    expect(analytics.profitableProducts).toBeGreaterThan(0)
  })

  it('returns a zeroed analytics object instead of inventing numbers when there is no data yet', async () => {
    state.listResult = { data: [], error: null }

    const analytics = await service.getCostAnalytics(MANAGER_ID, 'month')

    expect(analytics.totalProducts).toBe(0)
    expect(analytics.averageCost).toBe(0)
    expect(analytics.averageMargin).toBe(0)
    expect(analytics.lowMarginProducts).toEqual([])
    expect(analytics.costTrends).toEqual([])
  })
})

describe('saveGPTQuery — persisted assistant history', () => {
  let service: InstanceType<typeof CostManagementService>

  beforeEach(() => {
    service = new CostManagementService()
  })

  it('inserts the query/response pair for the asking user', async () => {
    state.insertResult = {
      data: {
        id: 'q1', user_id: MANAGER_ID, query: 'test', response: 'answer',
        context: null, created_at: '2026-08-16T00:00:00.000Z'
      },
      error: null
    }

    await service.saveGPTQuery({
      id: 'ignored-client-id',
      userId: MANAGER_ID,
      query: 'What price gives a 30% margin on a $10 cost?',
      response: 'Price at **$14.29**',
      context: {},
      timestamp: '2026-08-16T00:00:00.000Z'
    })

    expect(state.lastTable).toBe('gpt_cost_queries')
    expect(state.lastInsert?.user_id).toBe(MANAGER_ID)
    expect(state.lastInsert?.query).toBe('What price gives a 30% margin on a $10 cost?')
  })

  it('does not throw when the insert fails — history is best-effort, never blocking', async () => {
    state.insertResult = { data: null, error: { message: 'permission denied' } }

    await expect(
      service.saveGPTQuery({
        id: 'x', userId: MANAGER_ID, query: 'q', response: 'r', context: {}, timestamp: '2026-08-16T00:00:00.000Z'
      })
    ).resolves.toBeUndefined()
  })
})
