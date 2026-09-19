import { useEffect, useRef } from 'react'

type PollOptions = {
  /**
   * Fire once the moment the tab becomes visible again, so a panel that was
   * backgrounded mid-job repaints immediately instead of showing stale state
   * for up to a full interval.
   */
  refreshOnFocus?: boolean
}

/**
 * A setInterval that does NOT tick while the browser tab is hidden.
 *
 * Why this exists: on 2026-09-18 the whole Supabase project was cut off with
 * `HTTP 402 exceed_egress_quota` — the free tier's 5 GB/month of egress was
 * spent on JSON rows, not on files (the project stores nothing in Supabase
 * Storage). A plain `setInterval` keeps firing forever in a background tab, so
 * one admin tab left open overnight kept billing egress against a dashboard
 * nobody was looking at. Pausing on `document.hidden` is the single biggest
 * reduction available, and it costs the admin nothing: `refreshOnFocus` means
 * the panel is up to date by the time they have actually looked at it.
 *
 * Pass `intervalMs: null` to express "not polling right now" — that keeps the
 * hook call unconditional (Rules of Hooks) while letting the caller gate it on
 * whether a job is actually in flight.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number | null,
  { refreshOnFocus = true }: PollOptions = {}
): void {
  // Held in a ref so a re-rendered closure does not tear down and restart the
  // timer on every render — the tick always reads the latest callback.
  const savedCallback = useRef(callback)
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (intervalMs === null) return

    let timer: number | null = null
    const run = () => { void savedCallback.current() }

    const start = () => {
      if (timer === null) timer = window.setInterval(run, intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
      } else {
        if (refreshOnFocus) run()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs, refreshOnFocus])
}
