import { describe, it, expect, beforeEach, vi } from 'vitest'

type DbRow = Record<string, string | number | null>
type DbResult = { data: DbRow | null; error: { message: string } | null }
type UpsertPayload = Record<string, string | number | null>

interface FakeBuilder {
  select: () => FakeBuilder
  eq: (column: string, value: unknown) => FakeBuilder
  order: () => FakeBuilder
  limit: () => FakeBuilder
  maybeSingle: () => Promise<DbResult>
  upsert: (
    payload: UpsertPayload,
    options: { onConflict?: string }
  ) => { select: () => { single: () => Promise<DbResult> } }
}

// Chainable stand-in for the supabase query builder. Each test sets what the
// terminal call (maybeSingle / single) resolves to and then inspects what the
// service actually sent.
const state: {
  readResult: DbResult
  writeResult: DbResult
  lastTable: string | null
  lastFilter: { column: string; value: unknown } | null
  lastUpsert: { payload: UpsertPayload; options: { onConflict?: string } } | null
} = {
  readResult: { data: null, error: null },
  writeResult: { data: null, error: null },
  lastTable: null,
  lastFilter: null,
  lastUpsert: null
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
    maybeSingle: async () => state.readResult,
    upsert: (payload: UpsertPayload, options: { onConflict?: string }) => {
      state.lastUpsert = { payload, options }
      return {
        select: () => ({ single: async () => state.writeResult })
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

const { CostManagementService, DEFAULT_COST_VARIABLES } = await import('./cost-management')

const MANAGER_ID = '11111111-2222-3333-4444-555555555555'

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

describe('costManagementService cost variable persistence', () => {
  let service: InstanceType<typeof CostManagementService>

  beforeEach(() => {
    service = new CostManagementService()
    state.readResult = { data: null, error: null }
    state.writeResult = { data: null, error: null }
    state.lastTable = null
    state.lastFilter = null
    state.lastUpsert = null
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

  describe('queryGPTAssistant (keyword matcher — no LLM)', () => {
    it('answers a matched pricing question without any network/LLM call', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const response = await service.queryGPTAssistant(
        'What price gives a 30% margin on a $6.25 cost?'
      )

      expect(response).toContain('$8.93') // 6.25 / (1 - 0.30)
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })

    it('matches the example questions the dashboard advertises', async () => {
      // These strings are shown to managers in the Keyword Assistant tab and in
      // the fallback reply. If a phrasing stops matching, the UI is promising
      // something the matcher will not deliver.
      const pricing = await service.queryGPTAssistant('What price gives a 30% margin on a $15.00 cost?')
      expect(pricing).toContain('Selling Price')

      const margins = await service.queryGPTAssistant('What margin do you recommend for premium products?')
      expect(margins).toContain('Recommended Margin Strategy')

      const printCost = await service.queryGPTAssistant(
        'How much does a 2.5 hour print with 60g filament cost?',
        {
          id: 'x',
          managerId: MANAGER_ID,
          filamentPricePerGram: 0.025,
          electricityCostPerHour: 0.12,
          averagePackagingCost: 2.5,
          monthlyRent: 3500,
          overheadPercentage: 15,
          defaultMarginPercentage: 25,
          laborRatePerHour: 25,
          lastUpdated: '2026-07-26T12:00:00.000Z',
          createdAt: '2026-07-26T12:00:00.000Z'
        }
      )
      expect(printCost).toContain('Cost Breakdown')
    })

    it('falls back to the help text when nothing matches', async () => {
      const response = await service.queryGPTAssistant('tell me a joke')
      expect(response).toContain('Example Questions')
    })
  })
})
