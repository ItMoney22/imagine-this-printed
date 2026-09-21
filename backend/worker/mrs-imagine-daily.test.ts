import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Tests for Mrs. Imagine's daily clock (backend/worker/mrs-imagine-daily.ts).
//
// The clock is RETIRED as of 2026-09-21 — David: "stop mrs image from doing
// daily scouts i want that on my push of the button only."
//
// These tests exist to stop it coming back by accident. This clock's default
// has already flipped three times (batch ON, batch OFF, scout ON), so "someone
// re-arms it without noticing" is a demonstrated failure mode in this file
// specifically, not a hypothetical one.
//
// Three properties under test:
//   1. starting the worker schedules NOTHING — no interval, no timeout,
//   2. that holds even with the old env flags set, because a stale value left
//      on the Render dashboard must not resurrect the sweep,
//   3. the module does not import the scout service at all. A timer can be
//      re-added by mistake; an import of the thing that reads Etsy and writes
//      rows cannot be re-added by mistake.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

// Deliberately NOT mocked: services/mrs-imagine-scout.js and
// services/mrs-imagine.js. If this module ever imports either again, the suite
// fails at import time on the real module's Supabase/OpenAI construction
// instead of silently passing.

const { startMrsImagineDaily, SCOUT_CLOCK_RETIRED_MESSAGE } = await import('./mrs-imagine-daily.js')

const MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mrs-imagine-daily.ts')

describe('startMrsImagineDaily — the clock is retired', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let intervalSpy: ReturnType<typeof vi.spyOn>
  let timeoutSpy: ReturnType<typeof vi.spyOn>
  const originalScout = process.env.MRS_IMAGINE_SCOUT
  const originalDaily = process.env.MRS_IMAGINE_DAILY

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    intervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(0 as any)
    timeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue(0 as any)
  })

  afterEach(() => {
    logSpy.mockRestore()
    intervalSpy.mockRestore()
    timeoutSpy.mockRestore()
    if (originalScout === undefined) delete process.env.MRS_IMAGINE_SCOUT
    else process.env.MRS_IMAGINE_SCOUT = originalScout
    if (originalDaily === undefined) delete process.env.MRS_IMAGINE_DAILY
    else process.env.MRS_IMAGINE_DAILY = originalDaily
  })

  it('schedules nothing at all', () => {
    startMrsImagineDaily()
    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
  })

  it('schedules nothing even with the old flags turned on', () => {
    process.env.MRS_IMAGINE_SCOUT = 'true'
    process.env.MRS_IMAGINE_DAILY = 'true'
    startMrsImagineDaily()
    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
  })

  it('says so in the boot log, where someone hunting the missing list will look', () => {
    startMrsImagineDaily()
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('RETIRED')
    expect(logged).toContain('button')
  })

  it('names both dead env vars, so a stale flag on Render is explainable', () => {
    expect(SCOUT_CLOCK_RETIRED_MESSAGE).toContain('MRS_IMAGINE_SCOUT')
    expect(SCOUT_CLOCK_RETIRED_MESSAGE).toContain('MRS_IMAGINE_DAILY')
  })

  it('does not import the scout service — the structural half of the guarantee', async () => {
    const src = await readFile(MODULE_PATH, 'utf8')
    expect(src).not.toMatch(/^import .*mrs-imagine-scout/m)
    expect(src).not.toMatch(/^import .*mrs-imagine\.js/m)
    expect(src).not.toMatch(/runAndRecordScout/)
  })
})
