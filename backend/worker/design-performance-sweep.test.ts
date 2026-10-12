import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))

import { runDesignPerformanceSweep } from './design-performance-sweep'

describe('runDesignPerformanceSweep', () => {
  it('scores the last 30 days and stores the verdicts', async () => {
    const report: any = { variants: [{ flag: 'prune' }, { flag: 'healthy' }, { flag: 'refresh' }] }
    const load = vi.fn().mockResolvedValue(report)
    const persist = vi.fn().mockResolvedValue(2)
    expect(await runDesignPerformanceSweep({ load, persist })).toEqual({ variants: 3, changed: 2, flagged: 2 })
    expect(load).toHaveBeenCalledWith(30)
    expect(persist).toHaveBeenCalledWith(report)
  })

  it('logs and survives a failed read', async () => {
    const load = vi.fn().mockRejectedValue(new Error('db down'))
    const persist = vi.fn()
    expect(await runDesignPerformanceSweep({ load, persist })).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })
})
