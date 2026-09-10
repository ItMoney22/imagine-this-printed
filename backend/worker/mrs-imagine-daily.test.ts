import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for Mrs. Imagine's daily clock (backend/worker/mrs-imagine-daily.ts).
//
// The clock's job changed on 2026-09-09 (David: "mrs imagine is a scout ...
// she drops a list of her top 10 everyday"). It used to run her autonomous
// BATCH — real image spend, real Etsy drafts — which is why that had to be
// opt-in and stayed off. It now runs the SCOUT, which only reads the public
// Etsy API and writes a list, so it defaults ON.
//
// Two properties under test:
//   1. the scout arms by default and disarms only on the exact string "false",
//   2. the batch is unreachable — MRS_IMAGINE_DAILY=true must NOT bring back
//      unattended building, and the module must not even import the batch.
//
// setInterval/setTimeout are spied and stubbed rather than left running — this
// suite must never leave a live timer behind that could fire a real sweep
// after the test finishes.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          gte: () => Promise.resolve({ count: 0, error: null }),
        }),
      }),
    }),
  },
}))

const runAndRecordScout = vi.fn().mockResolvedValue({ id: 'run-1', status: 'succeeded', output: { picks: [] } })
vi.mock('../services/mrs-imagine-scout.js', () => ({
  runAndRecordScout: (...args: any[]) => runAndRecordScout(...args),
  SCOUT_JOB_TYPE: 'mrs_imagine_scout',
}))

// Deliberately NOT mocked: services/mrs-imagine.js. If the clock ever imports
// the batch again, this suite fails at import time on the real module's
// Supabase/OpenAI construction instead of silently passing.

const { startMrsImagineDaily, SCOUT_OFF_MESSAGE, BATCH_RETIRED_MESSAGE } = await import('./mrs-imagine-daily.js')

describe('startMrsImagineDaily', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let intervalSpy: ReturnType<typeof vi.spyOn>
  let timeoutSpy: ReturnType<typeof vi.spyOn>
  const originalScout = process.env.MRS_IMAGINE_SCOUT
  const originalDaily = process.env.MRS_IMAGINE_DAILY

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    intervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(0 as any)
    timeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue(0 as any)
    runAndRecordScout.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalScout === undefined) delete process.env.MRS_IMAGINE_SCOUT
    else process.env.MRS_IMAGINE_SCOUT = originalScout
    if (originalDaily === undefined) delete process.env.MRS_IMAGINE_DAILY
    else process.env.MRS_IMAGINE_DAILY = originalDaily
  })

  it('arms by default — David gets a list every day without setting anything', () => {
    delete process.env.MRS_IMAGINE_SCOUT

    startMrsImagineDaily()

    expect(intervalSpy).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('armed'))
  })

  it('disarms on the exact string "false", and logs why', () => {
    process.env.MRS_IMAGINE_SCOUT = 'false'

    startMrsImagineDaily()

    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(SCOUT_OFF_MESSAGE))
  })

  it('stays armed for any value that is not exactly "false"', () => {
    for (const value of ['0', 'no', 'FALSE', ' false', 'true']) {
      intervalSpy.mockClear()
      process.env.MRS_IMAGINE_SCOUT = value
      startMrsImagineDaily()
      expect(intervalSpy).toHaveBeenCalledTimes(1)
    }
  })

  it('does not resurrect the autonomous batch when the retired flag is still set on Render', () => {
    process.env.MRS_IMAGINE_DAILY = 'true'
    delete process.env.MRS_IMAGINE_SCOUT

    startMrsImagineDaily()

    // Armed, yes — but for the scout, and it says so out loud rather than
    // silently ignoring a flag someone thinks is still doing something.
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(BATCH_RETIRED_MESSAGE))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('scout sweep'))
  })

  it('the off-message names the flag that controls it', () => {
    expect(SCOUT_OFF_MESSAGE).toContain('MRS_IMAGINE_SCOUT=false')
  })
})
