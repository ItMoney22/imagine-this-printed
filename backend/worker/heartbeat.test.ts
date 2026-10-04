// Heartbeat tests.
//
// The point of the heartbeat is to make a PARKED Fly machine visible, and the
// property that does that is uptime + tick counters in the line — not the fact
// that a line is printed. So that is what these assert.
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.resetModules()
})

async function freshModule() {
  // Uptime is measured from module load, so each test needs its own instance.
  vi.resetModules()
  return await import('./heartbeat.js')
}

describe('worker heartbeat', () => {
  it('reports uptime and per-job tick counts', async () => {
    vi.useFakeTimers()
    const { startHeartbeat, noteTick } = await freshModule()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const timer = startHeartbeat({ intervalSeconds: 60 })
    noteTick('ai-poll')
    noteTick('ai-poll')
    noteTick('etsy-poll')

    vi.advanceTimersByTime(60_000)
    clearInterval(timer)

    const beat = log.mock.calls.map(c => String(c[0])).find(l => l.includes('alive'))
    expect(beat).toBeDefined()
    expect(beat).toContain('uptime=')
    expect(beat).toContain('ai-poll=2')
    expect(beat).toContain('etsy-poll=1')
  })

  it('uptime climbs across beats — a value that resets means the machine restarted', async () => {
    vi.useFakeTimers()
    const { startHeartbeat } = await freshModule()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const timer = startHeartbeat({ intervalSeconds: 60 })
    vi.advanceTimersByTime(60_000)
    vi.advanceTimersByTime(60_000)
    clearInterval(timer)

    const beats = log.mock.calls.map(c => String(c[0])).filter(l => l.includes('alive'))
    expect(beats).toHaveLength(2)
    expect(beats[0]).toContain('uptime=1m0s')
    expect(beats[1]).toContain('uptime=2m0s')
  })

  it('warns when a beat lands late — the only signal a suspended machine leaves', async () => {
    vi.useFakeTimers()
    const { startHeartbeat } = await freshModule()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const timer = startHeartbeat({ intervalSeconds: 60 })
    // First beat on time, then a gap far longer than the interval: the shape a
    // suspend/resume leaves behind, where the process clock keeps running so
    // uptime alone would look perfectly healthy.
    vi.advanceTimersByTime(60_000)
    vi.setSystemTime(Date.now() + 10 * 60_000)
    vi.advanceTimersByTime(60_000)
    clearInterval(timer)

    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toContain('heartbeat gap')
  })

  it('never keeps the process alive on its own', async () => {
    const { startHeartbeat } = await freshModule()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const timer = startHeartbeat({ intervalSeconds: 60 })
    // If every real poll loop died, the worker must be allowed to exit so the
    // platform restarts it — rather than idle forever printing "alive".
    expect((timer as unknown as { hasRef?: () => boolean }).hasRef?.()).toBe(false)
    clearInterval(timer)
  })
})
