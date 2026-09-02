// Themed progress bar — replaces every spinner-style waiting state in the
// Step Flow builder. David's feedback, verbatim: "i dont like spinning
// loading things i like like a dope progress bar." (2026-09-02, the Design
// step's ~2-3 minute gpt-image-2 wait is what he was staring at.)
//
// Two progress sources, in priority order:
//   1. Real backend progress — `step`/`totalSteps`, read off an ai_jobs row's
//      `output: { message, step, total_steps, updated_at }`.
//   2. An elapsed-time ease toward ~92%, when there's no real signal — never
//      claims 100% on its own; only `done: true` snaps it there.
import React, { useEffect, useMemo, useState } from 'react'

export interface ProgressBarProps {
  /** Stage message shown on the left — e.g. the job's live `output.message`. */
  label: string
  /** Epoch ms this wait started. Ignored when `elapsedMs` is supplied directly. */
  startedAt?: number
  /** Elapsed time in ms, when the caller already tracks it instead of a start time. */
  elapsedMs?: number
  /** How long this stage is expected to take — drives the time-based ease (default 8s). */
  expectedMs?: number
  /** Real progress reported by the backend (ai_jobs.output.step / total_steps). */
  step?: number
  totalSteps?: number
  /** True once the underlying work has actually finished — snaps the bar to 100%. */
  done?: boolean
  /** True if the underlying work failed — red track, error text instead of the shimmer. */
  failed?: boolean
  /** Shown under the track when `failed` is true. */
  errorText?: string
  /** Taller bar (~16px) for the big Design-step wait; default (~10-12px) for cards. */
  size?: 'sm' | 'lg'
  className?: string
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

let shimmerStyleInjected = false
/** Injects the shimmer keyframes into <head> once per page — cheaper than a
 *  <style> tag per instance (Mockups renders several bars at once), and keeps
 *  this component fully self-contained (no tailwind.config.js edit needed). */
function ensureShimmerStyle() {
  if (shimmerStyleInjected || typeof document === 'undefined') return
  shimmerStyleInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-itp-progress-bar', 'true')
  el.textContent = `
@keyframes itp-progress-shimmer {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(220%); }
}
.itp-progress-shimmer {
  animation: itp-progress-shimmer 1.6s ease-in-out infinite;
}
`
  document.head.appendChild(el)
}

/** Dope progress bar. Themed to the page: gradient fill, glass track, glow, shimmer sweep. */
const ProgressBar: React.FC<ProgressBarProps> = ({
  label,
  startedAt,
  elapsedMs,
  expectedMs = 8000,
  step,
  totalSteps,
  done = false,
  failed = false,
  errorText,
  size = 'sm',
  className,
}) => {
  useEffect(() => {
    ensureShimmerStyle()
  }, [])

  // Only ticks a clock when we're deriving elapsed time ourselves from
  // `startedAt` — a caller-supplied `elapsedMs` is assumed to already update
  // on its own cadence, and there's nothing to tick once settled.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (done || failed || elapsedMs != null || startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [done, failed, elapsedMs, startedAt])

  const elapsed = elapsedMs != null ? elapsedMs : startedAt != null ? Math.max(0, now - startedAt) : 0

  const pct = useMemo(() => {
    if (done) return 100
    const tau = Math.max(expectedMs, 1) / 3
    if (step != null && totalSteps && totalSteps > 0) {
      const base = clamp(step / totalSteps, 0, 1)
      if (step >= totalSteps) {
        // Last reported step — ease the remainder toward 95% instead of
        // sitting frozen while the job wraps up server-side.
        const remainder = 0.95 - base
        const eased = remainder > 0 ? remainder * (1 - Math.exp(-elapsed / tau)) : 0
        return clamp((base + eased) * 100, 0, 95)
      }
      return clamp(base * 100, 0, 95)
    }
    // No real progress signal — ease toward 92% over `expectedMs`.
    const eased = 0.92 * (1 - Math.exp(-elapsed / tau))
    return clamp(eased * 100, 0, 92)
  }, [done, step, totalSteps, elapsed, expectedMs])

  const displayPct = failed ? 100 : pct
  const barHeight = size === 'lg' ? 'h-4' : 'h-2.5'
  const stepLabel = step != null && totalSteps ? `step ${Math.min(step, totalSteps)} of ${totalSteps}` : null

  return (
    <div className={`w-full ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
        <span className={`truncate ${failed ? 'text-red-400 font-medium' : 'text-muted'}`}>{label}</span>
        <span className="flex items-center gap-2 shrink-0 text-muted tabular-nums">
          {stepLabel && <span className="uppercase tracking-wide text-[10px]">{stepLabel}</span>}
          <span>{formatElapsed(elapsed)}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(displayPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={`relative w-full rounded-full overflow-hidden bg-card/60 backdrop-blur-sm border border-white/10 ${barHeight}`}
      >
        <div
          className={`h-full rounded-full relative overflow-hidden transition-[width] duration-700 ease-out ${
            failed ? 'bg-red-500/70' : 'bg-gradient-to-r from-primary to-secondary shadow-glow-sm'
          }`}
          style={{ width: `${displayPct}%` }}
        >
          {!failed && (
            <div
              className="itp-progress-shimmer absolute inset-y-0 left-0 w-1/2"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}
            />
          )}
        </div>
      </div>
      {failed && errorText && <p className="text-[11px] text-red-400 mt-1.5">{errorText}</p>}
    </div>
  )
}

export default ProgressBar
