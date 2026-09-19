// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePolling } from './usePolling'

// jsdom reports document.hidden === false and gives no way to change it, so the
// property is replaced with a getter these tests drive.
let hidden = false

function setHidden(next: boolean) {
  hidden = next
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('usePolling', () => {
  it('ticks on the interval while the tab is visible', () => {
    const cb = vi.fn()
    renderHook(() => usePolling(cb, 1000))

    expect(cb).not.toHaveBeenCalled() // no leading call — callers fetch on mount themselves
    act(() => { vi.advanceTimersByTime(3000) })
    expect(cb).toHaveBeenCalledTimes(3)
  })

  // The whole reason this hook exists: a backgrounded admin tab used to keep
  // spending Supabase egress on a panel nobody was looking at.
  it('stops ticking entirely while the tab is hidden', () => {
    const cb = vi.fn()
    renderHook(() => usePolling(cb, 1000))

    act(() => { vi.advanceTimersByTime(2000) })
    expect(cb).toHaveBeenCalledTimes(2)

    setHidden(true)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(cb).toHaveBeenCalledTimes(2) // a full minute hidden costs zero requests
  })

  it('catches up once and resumes when the tab becomes visible again', () => {
    const cb = vi.fn()
    renderHook(() => usePolling(cb, 1000))

    setHidden(true)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(cb).toHaveBeenCalledTimes(0)

    setHidden(false)
    expect(cb).toHaveBeenCalledTimes(1) // immediate refresh, so the panel is current

    act(() => { vi.advanceTimersByTime(2000) })
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('does not fire the catch-up refresh when refreshOnFocus is false', () => {
    const cb = vi.fn()
    renderHook(() => usePolling(cb, 1000, { refreshOnFocus: false }))

    setHidden(true)
    setHidden(false)
    expect(cb).toHaveBeenCalledTimes(0)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  // Callers gate on this instead of calling the hook conditionally.
  it('never polls when intervalMs is null', () => {
    const cb = vi.fn()
    renderHook(() => usePolling(cb, null))

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(cb).not.toHaveBeenCalled()
  })

  it('starts and stops as intervalMs flips between a number and null', () => {
    const cb = vi.fn()
    const { rerender } = renderHook(({ ms }: { ms: number | null }) => usePolling(cb, ms), {
      initialProps: { ms: null as number | null }
    })

    act(() => { vi.advanceTimersByTime(5000) })
    expect(cb).not.toHaveBeenCalled()

    rerender({ ms: 1000 })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(cb).toHaveBeenCalledTimes(2)

    rerender({ ms: null })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('always calls the latest callback without restarting the timer', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => usePolling(cb, 1000), {
      initialProps: { cb: first as () => void }
    })

    act(() => { vi.advanceTimersByTime(1000) })
    expect(first).toHaveBeenCalledTimes(1)

    rerender({ cb: second })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1) // not restarted, not double-firing
  })

  it('stops polling after unmount', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => usePolling(cb, 1000))

    act(() => { vi.advanceTimersByTime(1000) })
    expect(cb).toHaveBeenCalledTimes(1)

    unmount()
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
