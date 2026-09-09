// Shared visual bits for the Step Flow builder — deliberately its OWN small
// copies of the hex/honeycomb language used by the Live Studio hex tracker in
// AdminAIProductBuilder.tsx, not an import of it (that file's BuildState is a
// different state machine entirely; Track C does not depend on it).
import React from 'react'
import { Check } from 'lucide-react'
import type { StepId } from './types'
import { STEP_LABELS, STEP_ORDER } from './types'

export const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'

/** Small non-spinning busy indicator for a quick inline button action
 *  (Approve, Redo, Skip, Use this…) — David doesn't want ANY spinning
 *  glyphs, but a click that resolves in well under a second is too
 *  short-lived to deserve its own progress bar (those live in
 *  ProgressBar.tsx, wired to the real multi-second/minute waits). */
export const BusyDot: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`inline-block rounded-full bg-current animate-pulse ${className ?? 'w-2.5 h-2.5'}`} />
)

/** Card shell every step renders inside — matches the page's glass/neon look. */
export const StepCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div
    className={`bg-card/60 backdrop-blur-md border border-border-subtle/60 rounded-3xl p-4 sm:p-6 md:p-8 shadow-soft-lg ${className ?? ''}`}
  >
    {children}
  </div>
)

/** Big, obvious "approve this step" button — every step ends with one of these. */
export const ApproveButton: React.FC<{
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  children: React.ReactNode
}> = ({ onClick, disabled, busy, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-base shadow-glow disabled:opacity-40 disabled:shadow-none hover:scale-[1.02] active:scale-[0.99] transition-all"
  >
    {busy ? <BusyDot className="w-3 h-3" /> : <Check className="w-5 h-5" />}
    {children}
  </button>
)

export const SecondaryButton: React.FC<{
  onClick: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}> = ({ onClick, disabled, className, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-card border border-border-subtle text-text text-sm font-medium hover:bg-card-elevated disabled:opacity-40 transition-colors ${className ?? ''}`}
  >
    {children}
  </button>
)

/** CSS checkerboard so a transparent PNG's alpha is obviously visible. */
export const Checkerboard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div
    className={`rounded-xl overflow-hidden ${className ?? ''}`}
    style={{
      backgroundImage:
        'linear-gradient(45deg, #80808022 25%, transparent 25%), linear-gradient(-45deg, #80808022 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #80808022 75%), linear-gradient(-45deg, transparent 75%, #80808022 75%)',
      backgroundSize: '20px 20px',
      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
    }}
  >
    {children}
  </div>
)

/**
 * The "something needs your attention" panel — one place, because this kept
 * being re-invented per step in DARK-THEME colours on a LIGHT-ONLY app.
 *
 * David, 2026-09-08, on the Etsy step's QA panel: "the color on this box is
 * way to hard for me to see". It was `text-amber-200` (#FDE68A) on
 * `bg-amber-500/10` over a white card: 1.16:1 measured, against a 4.5:1 floor
 * for body text — effectively invisible, and he was reading it on a screen he
 * can barely see as it is. Those are DARK-theme colours, and this app has no
 * dark theme to fall back to: ThemeProvider.tsx pins it to light mode and
 * src/index.css defines a single light `:root`, so pale amber has nothing
 * dark to sit on and never will.
 *
 * Measured on the amber-50 ground below: heading 8.75:1, body 14.4:1,
 * secondary text 9.9:1, the icon 4.8:1.
 *
 * WARN_TEXT / WARN_HEADING are exported for the places that need the colour
 * without the whole panel — do not reach for a raw amber utility instead.
 */
export const WARN_HEADING = 'text-amber-900'
export const WARN_TEXT = 'text-amber-950'
export const WARN_MUTED = 'text-stone-700'

export const WarnPanel: React.FC<{
  icon?: React.ReactNode
  title: React.ReactNode
  children?: React.ReactNode
  className?: string
}> = ({ icon, title, children, className }) => (
  <div className={`rounded-xl border border-amber-500/50 bg-amber-50 p-4 ${className ?? ''}`}>
    <div className="flex items-center gap-2 mb-1.5">
      {icon}
      <p className={`text-sm font-semibold ${WARN_HEADING}`}>{title}</p>
    </div>
    {children}
  </div>
)

export const InlineError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div className="text-sm text-red-800 bg-red-50 border border-red-500/40 rounded-xl px-4 py-2.5">{message}</div>
  ) : null

/** The hex step tracker, click-to-navigate to any already-reachable step.
 *  `labelOverrides` lets a caller rename a hex without touching the shared
 *  `STEP_LABELS` map — used for the Garments hex, which reads "Sizes" on a
 *  metal print (design doc §14) but "Garment & Color" everywhere else.
 *  `steps` is the lane's own order (see components/studio/lane.tsx): six for
 *  staff, five for a customer, who has no Etsy stop. */
export const HexTracker: React.FC<{
  step: StepId
  canReach: (step: StepId) => boolean
  onSelect: (step: StepId) => void
  labelOverrides?: Partial<Record<StepId, string>>
  steps?: StepId[]
}> = ({ step, canReach, onSelect, labelOverrides, steps }) => {
  const order = steps ?? STEP_ORDER
  const activeIndex = order.indexOf(step)
  const labelFor = (s: StepId) => labelOverrides?.[s] ?? STEP_LABELS[s]
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
      {order.map((s, i) => {
        const reachable = canReach(s)
        const done = i < activeIndex
        const isActive = s === step
        const clickable = reachable && s !== step
        return (
          <React.Fragment key={s}>
            {i > 0 && (
              <div
                className={`hidden sm:block w-6 md:w-10 h-0.5 rounded ${
                  i <= activeIndex ? 'bg-gradient-to-r from-primary to-secondary' : 'bg-muted/20'
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => clickable && onSelect(s)}
              disabled={!clickable}
              className="flex flex-col items-center gap-1.5 disabled:cursor-default"
              title={reachable ? labelFor(s) : `Finish the previous step to unlock ${labelFor(s)}`}
            >
              <div
                className={
                  done
                    ? 'w-12 h-12 md:w-14 md:h-14 flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-white'
                    : isActive
                      ? 'w-12 h-12 md:w-14 md:h-14 flex items-center justify-center bg-gradient-to-br from-primary/40 to-secondary/40 text-text animate-pulse'
                      : reachable
                        ? 'w-12 h-12 md:w-14 md:h-14 flex items-center justify-center bg-card/70 text-text border border-border-subtle'
                        : 'w-12 h-12 md:w-14 md:h-14 flex items-center justify-center bg-card/40 text-muted'
                }
                style={{ clipPath: HEX_CLIP }}
              >
                {done ? <Check className="w-5 h-5" /> : <span className="text-xs font-bold uppercase tracking-wide">{i + 1}</span>}
              </div>
              <span className={`text-[10px] md:text-xs uppercase tracking-widest text-center ${isActive ? 'text-primary font-bold' : done ? 'text-text' : 'text-muted'}`}>
                {labelFor(s)}
              </span>
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}
