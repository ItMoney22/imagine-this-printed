import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for Mrs. Imagine's daily clock (backend/worker/mrs-imagine-daily.ts).
//
// Design doc §11, David 2026-09-02: "add Mrs Imagine to this step i dont want
// her creating designs on her own anymore." The clock used to default ON
// (opt OUT via MRS_IMAGINE_DAILY=false); it now must default OFF and require
// an explicit MRS_IMAGINE_DAILY=true to re-enable. The property under test:
// startMrsImagineDaily() never arms a timer unless the flag is EXACTLY the
// string "true", and logs the documented off-message otherwise.
//
// setInterval/setTimeout are spied and stubbed rather than left running —
// this suite must never leave a live timer behind that could fire a real
// (mocked, but still unwanted) batch after the test finishes.
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

const startMrsImagineBatch = vi.fn().mockResolvedValue({ batchId: 'batch-1' })
vi.mock('../services/mrs-imagine.js', () => ({
  startMrsImagineBatch: (...args: any[]) => startMrsImagineBatch(...args),
}))

const { startMrsImagineDaily, DAILY_OFF_MESSAGE } = await import('./mrs-imagine-daily.js')

describe('startMrsImagineDaily', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let intervalSpy: ReturnType<typeof vi.spyOn>
  let timeoutSpy: ReturnType<typeof vi.spyOn>
  const originalFlag = process.env.MRS_IMAGINE_DAILY

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    intervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(0 as any)
    timeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue(0 as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalFlag === undefined) delete process.env.MRS_IMAGINE_DAILY
    else process.env.MRS_IMAGINE_DAILY = originalFlag
  })

  it('stays off and logs the exact off-message when the flag is unset', () => {
    delete process.env.MRS_IMAGINE_DAILY

    startMrsImagineDaily()

    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(DAILY_OFF_MESSAGE))
  })

  it('the off-message matches the documented flag/rationale exactly', () => {
    expect(DAILY_OFF_MESSAGE).toBe(
      'Mrs. Imagine daily batch is OFF (David 2026-09-02) — she pitches inside the Step Flow now; set MRS_IMAGINE_DAILY=true to re-enable'
    )
  })

  it('stays off for the OLD opt-out value ("false") — the default flipped, this must not re-arm it', () => {
    process.env.MRS_IMAGINE_DAILY = 'false'

    startMrsImagineDaily()

    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('stays off for any value other than the exact string "true"', () => {
    for (const value of ['1', 'yes', 'TRUE', ' true', 'true ']) {
      intervalSpy.mockClear()
      process.env.MRS_IMAGINE_DAILY = value
      startMrsImagineDaily()
      expect(intervalSpy).not.toHaveBeenCalled()
    }
  })

  it('arms the clock (one interval + one boot-tick timeout) when MRS_IMAGINE_DAILY=true', () => {
    process.env.MRS_IMAGINE_DAILY = 'true'

    startMrsImagineDaily()

    expect(intervalSpy).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('armed'))
  })
})
