// Themed progress bar — the kit's ONLY waiting state. No spinners anywhere.
// David's feedback, verbatim: "i dont like spinning loading things i like like
// a dope progress bar." (2026-09-02, staring at a ~2-3 minute image wait.)
//
// Two progress sources, in priority order:
//   1. Real backend progress — `step`/`totalSteps` off a job row.
//   2. An elapsed-time ease toward ~92% when there is no real signal. It never
//      claims 100% on its own; only `done` snaps it there.
//
// Self-contained: React plus the six theme tokens. No config, no dependencies.
import React, { useEffect, useMemo, useState } from 'react'

export interface ProgressBarProps {
  /** Stage message shown on the left. */
  label: string
  /** Epoch ms this wait started. Ignored when `elapsedMs` is supplied. */
  startedAt?: number
  /** Elapsed ms, when the caller already tracks it instead of a start time. */
  elapsedMs?: number
  /** How long this stage is expected to take — drives the ease (default 8s). */
  expectedMs?: number
  /** Real progress reported by the backend. */
  step?: number
  totalSteps?: number
  /** True once the work has actually finished — snaps the bar to 100%. */
  done?: boolean
  /** True if the work failed — red track, error text instead of the shimmer. */
  failed?: boolean
  errorText?: string
  /** Taller bar for a headline wait; default for cards. */
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
/** Injects the keyframes once per page, so the kit needs no tailwind config. */
function ensureShimmerStyle() {
  if (shimmerStyleInjected || typeof document === 'undefined') return
  shimmerStyleInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-studio-kit-progress', 'true')
  el.textContent = `
@keyframes studio-kit-progress-shimmer {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(220%); }
}
.studio-kit-progress-shimmer {
  animation: studio-kit-progress-shimmer 1.6s ease-in-out infinite;
}
`
  document.head.appendChild(el)
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
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
  useEffect(() => { ensureShimmerStyle() }, [])

  // Only ticks a clock while we are deriving elapsed time ourselves.
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
        // Last reported step — ease the remainder toward 95% rather than
        // sitting frozen while the job wraps up server-side.
        const remainder = 0.95 - base
        const eased = remainder > 0 ? remainder * (1 - Math.exp(-elapsed / tau)) : 0
        return clamp((base + eased) * 100, 0, 95)
      }
      return clamp(base * 100, 0, 95)
    }
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
            failed ? 'bg-red-500/70' : 'bg-gradient-to-r from-primary to-secondary'
          }`}
          style={{ width: `${displayPct}%` }}
        >
          {!failed && (
            <div
              className="studio-kit-progress-shimmer absolute inset-y-0 left-0 w-1/2"
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
