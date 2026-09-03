// Step 6 — Etsy: queue invisible drafts for the tiers David wants to sell.
// Nothing here goes live — he still flips drafts active in Etsy Shop Manager.
//
// THE GATE (2026-09-03). POST /api/admin/etsy/queue/:id refuses with 422 until
// the design carries a passing or overridden design-QA stamp for the `etsy`
// channel (backend/routes/admin/etsy.ts -> checkGate). Nothing in the Step
// Flow ever submitted one, so every step-flow product arrived here as
// `never_reviewed` and the last step could NOT be completed — David, verbatim:
// "in the step flow it doesnt let me complete the etsy side it give me a error
// all the time". This step now RUNS the review itself and, when it fails,
// shows what to fix plus the admin override the gate was always designed to
// have. The gate stays binding — the only way to pass is still to be reviewed.
import React, { useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Send, ShieldCheck } from 'lucide-react'
import { designQa, etsy, type EtsyTier, type QaReview } from '../../lib/api'
import { tiersForCategory } from '../../../backend/shared/etsy-tiers'
import { METAL_ART_PRICES, STUDIO_SIZE_KEYS } from '../../../backend/shared/metal-art'
import type { StepFlowAction, StepFlowState } from './stepFlowReducer'
import { InlineError, SecondaryButton, StepCard } from './shared'
import ProgressBar from './ProgressBar'

// No live job to watch here — it's a synchronous write-a-draft call.
const QUEUE_EXPECTED_MS = 6000
// The review is two vision calls over the listing photos plus the SEO/pricing
// checks — measured at roughly 15-30s on a one-photo listing.
const REVIEW_EXPECTED_MS = 25_000

interface EtsyStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
}

// Mirrors AdminEtsyPanel.tsx's TIER_META — no shared frontend type module for
// this yet, so it's a deliberate small second copy rather than new coupling.
const GARMENT_TIER_META: Record<EtsyTier, { label: string; blurb: string; shown: string }> = {
  primary: { label: 'Shirt', blurb: 'The tee/hoodie itself, sizes S–3XL', shown: '$25 → $15' },
  transfer: { label: 'Transfer', blurb: 'Printed DTF film you mail — buyer presses it', shown: 'from $12 → $7.20' },
  download: { label: 'Download', blurb: 'The design file, delivered instantly by Etsy', shown: '$5 → $3' },
}
// Metal art only ever has the primary tier (backend/shared/etsy-tiers.ts
// tiersForCategory) — David 2026-09-02: "it came up as shirt transfer and
// download for a metal print".
const METAL_PRIMARY_META = {
  label: 'Metal print',
  blurb: 'Aluminum panel listing with a size variation',
  shown: STUDIO_SIZE_KEYS.map((k) => `${k} $${METAL_ART_PRICES[k].toFixed(2)}`).join(' · '),
}

type GateCode = 'never_reviewed' | 'stale' | 'failed' | (string & {})
interface GateRefusal {
  code: GateCode
  /** The gate's own sentence. Never the endpoint hint the API also returns —
   *  David reads these out loud; an API path is machinery, not a message. */
  reason: string
}

/** Gate states the step can clear on its own by running a fresh review. The
 *  recorded-failure case (`failed`) is NOT one of them: re-measuring an
 *  unchanged design just spends two more vision calls to print the same list,
 *  so that one waits for an explicit "Review it again". */
const AUTO_REVIEWABLE = new Set<GateCode>(['never_reviewed', 'stale'])

interface QueueResult {
  queued: string[]
  skipped: Array<{ tier: string; reason: string }>
}

const EtsyStep: React.FC<EtsyStepProps> = ({ state, dispatch }) => {
  const category: string | null = (state.product as { category?: string } | null)?.category ?? null
  const isMetal = category === 'metal-art'
  const tierOrder: EtsyTier[] = tiersForCategory(category)
  const tierMeta = (t: EtsyTier) => (isMetal && t === 'primary' ? METAL_PRIMARY_META : GARMENT_TIER_META[t])
  const [tiers, setTiers] = useState<EtsyTier[]>(['primary'])
  const [skipped, setSkipped] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'reviewing' | 'queueing'>('idle')
  const [result, setResult] = useState<QueueResult | null>(null)
  const [gate, setGate] = useState<GateRefusal | null>(null)
  const [review, setReview] = useState<QaReview | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const startedAtRef = useRef<number | null>(null)

  const busy = phase !== 'idle'

  const toggleTier = (tier: EtsyTier) =>
    setTiers((prev) => (prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]))

  /** One attempt at the queue call. Returns the gate refusal instead of
   *  throwing it, so the caller can decide whether it is clearable. */
  const tryQueue = async (productId: string): Promise<GateRefusal | null> => {
    startedAtRef.current = Date.now()
    setPhase('queueing')
    try {
      const res = await etsy.queue(productId, tiers)
      setResult({ queued: res.queued ?? [], skipped: res.skipped ?? [] })
      setGate(null)
      return null
    } catch (err: any) {
      if (err?.status === 422) {
        const refusal: GateRefusal = {
          code: err?.body?.qa_gate?.code ?? 'failed',
          // Strip the route's "Presentation QA gate: " prefix — the panel
          // already says which gate this is.
          reason: String(err?.body?.error || 'This design has not passed the presentation review.').replace(
            /^Presentation QA gate:\s*/i,
            ''
          ),
        }
        setGate(refusal)
        return refusal
      }
      setError(err?.message || 'Failed to queue to Etsy')
      return null
    } finally {
      setPhase('idle')
    }
  }

  /** Run the review and record the verdict. Returns null only when the review
   *  itself could not run (auth, network, the vision model being down) — a
   *  FAILED verdict is a result, not an error. */
  const runReview = async (productId: string): Promise<QaReview | null> => {
    startedAtRef.current = Date.now()
    setPhase('reviewing')
    try {
      const verdict = await designQa.submit(productId, 'etsy')
      setReview(verdict)
      return verdict
    } catch (err: any) {
      setError(err?.message || 'Could not run the design review')
      return null
    } finally {
      setPhase('idle')
    }
  }

  const handleQueue = async () => {
    if (!state.productId || tiers.length === 0 || busy) return
    setError(null)
    setGate(null)

    const refusal = await tryQueue(state.productId)
    if (!refusal || !AUTO_REVIEWABLE.has(refusal.code)) return

    // Never reviewed (every fresh step-flow build) or stale after an edit —
    // run the review right here rather than dead-ending the flow.
    const verdict = await runReview(state.productId)
    if (!verdict || verdict.status === 'failed') return

    setGate(null)
    await tryQueue(state.productId)
  }

  const handleReviewAgain = async () => {
    if (!state.productId || busy) return
    setError(null)
    const verdict = await runReview(state.productId)
    if (!verdict || verdict.status === 'failed') return
    setGate(null)
    await tryQueue(state.productId)
  }

  const handleOverride = async () => {
    if (!state.productId || busy) return
    setError(null)
    startedAtRef.current = Date.now()
    setPhase('reviewing')
    try {
      await designQa.override(state.productId, overrideReason.trim(), 'etsy')
    } catch (err: any) {
      setError(err?.message || 'Could not record the override')
      setPhase('idle')
      return
    }
    setPhase('idle')
    setReview(null)
    setGate(null)
    setOverrideOpen(false)
    setOverrideReason('')
    await tryQueue(state.productId)
  }

  const blocking = (review?.rework ?? []).filter((r) => r.severity === 'block')
  const warnings = (review?.rework ?? []).filter((r) => r.severity !== 'block')
  const failedReview = review?.status === 'failed'
  const showGatePanel = !!gate || failedReview
  const overrideReady = overrideReason.trim().length >= 10

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">Queue to Etsy</h2>
      <p className="text-sm text-muted mb-4">
        Posts invisible drafts for review — nothing goes live until you flip it in Etsy Shop Manager.
      </p>

      {skipped ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
          <p className="text-sm font-semibold text-text mb-1">Done — published without Etsy.</p>
          <p className="text-sm text-muted mb-3">The product is live on the storefront. You can queue it to Etsy later from the Etsy panel or by reopening this flow.</p>
          <div className="flex flex-wrap gap-3">
            <a href={`/admin/ai/products/create?mode=steps`} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-bold">Start another</a>
            <SecondaryButton onClick={() => setSkipped(false)}>Back to Etsy</SecondaryButton>
          </div>
        </div>
      ) : result ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm mb-1">
            <Check className="w-4 h-4" /> Queued
          </div>
          <p className="text-xs text-text">
            {result.queued.length > 0 ? `Draft${result.queued.length > 1 ? 's' : ''} queued: ${result.queued.join(', ')}.` : 'Nothing new was queued.'}
          </p>
          {result.skipped.length > 0 && (
            <p className="text-xs text-muted mt-1">
              Skipped: {result.skipped.map((s) => `${s.tier} (${s.reason})`).join(', ')}
            </p>
          )}
          <a
            href="/admin"
            className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
          >
            View in the Etsy panel <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {tierOrder.map((t) => {
              const on = tiers.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTier(t)}
                  title={tierMeta(t).blurb}
                  className={`inline-flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-left transition-colors ${
                    on ? 'bg-primary/10 border-primary text-text' : 'bg-card border-border-subtle text-muted hover:border-primary/40'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    {on && <Check className="w-3.5 h-3.5 text-primary" />} {tierMeta(t).label}
                  </span>
                  <span className="text-[11px]">{tierMeta(t).shown}</span>
                </button>
              )
            })}
          </div>

          {review && !failedReview && !gate && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-sm text-text">
                Design review {review.status === 'overridden' ? 'overridden' : 'passed'} — score {review.score}
                {review.warnings > 0 ? `, ${review.warnings} suggestion${review.warnings > 1 ? 's' : ''} noted` : ''}.
              </p>
            </div>
          )}

          {showGatePanel && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                <p className="text-sm font-semibold text-amber-200">
                  {failedReview && review
                    ? `The design review failed — score ${review.score}, ${blocking.length} thing${blocking.length === 1 ? '' : 's'} to fix.`
                    : 'The design review is holding this listing.'}
                </p>
              </div>

              {failedReview ? (
                <>
                  <ul className="space-y-2 mb-3">
                    {blocking.map((item, i) => (
                      <li key={`${item.criterion}-${i}`} className="text-sm text-text">
                        <span className="text-amber-200">{item.issue}</span>
                        {item.fix && <span className="block text-xs text-muted mt-0.5">{item.fix}</span>}
                      </li>
                    ))}
                  </ul>
                  {warnings.length > 0 && (
                    <p className="text-xs text-muted mb-3">
                      Worth a look, but not blocking: {warnings.map((w) => w.issue).join(' ')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-amber-200 mb-3">{gate?.reason}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={handleReviewAgain} disabled={busy}>
                  Review it again
                </SecondaryButton>
                <SecondaryButton onClick={() => dispatch({ type: 'GO_TO_STEP', step: 'mockups' })} disabled={busy}>
                  Back to mockups
                </SecondaryButton>
                {!overrideOpen && (
                  <SecondaryButton onClick={() => setOverrideOpen(true)} disabled={busy}>
                    Post it anyway
                  </SecondaryButton>
                )}
              </div>

              {overrideOpen && (
                <div className="mt-3 pt-3 border-t border-amber-500/20">
                  <label className="block text-xs text-muted mb-1.5">
                    Why is this one going out despite the review? Recorded against the listing.
                  </label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Photo is a touch soft but the artwork is right and this drop is time-sensitive."
                    className="w-full rounded-lg bg-card border border-border-subtle text-text text-sm px-3 py-2 placeholder:text-muted/60"
                  />
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <SecondaryButton onClick={handleOverride} disabled={busy || !overrideReady}>
                      Override and queue
                    </SecondaryButton>
                    <SecondaryButton onClick={() => setOverrideOpen(false)} disabled={busy}>
                      Cancel
                    </SecondaryButton>
                    {!overrideReady && <span className="text-[11px] text-muted">A sentence or two is enough.</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          <InlineError message={error} />

          <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleQueue}
            disabled={busy || tiers.length === 0}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-base shadow-glow disabled:opacity-40 disabled:shadow-none hover:scale-[1.02] active:scale-[0.99] transition-all"
          >
            <Send className="w-5 h-5" />
            {phase === 'reviewing' ? 'Reviewing…' : phase === 'queueing' ? 'Queueing…' : `Queue ${tiers.length > 1 ? `${tiers.length} drafts` : 'draft'}`}
          </button>
          <SecondaryButton onClick={() => setSkipped(true)} disabled={busy}>
            Skip Etsy — finish here
          </SecondaryButton>
          </div>

          {busy && (
            <div className="mt-4">
              <ProgressBar
                label={phase === 'reviewing' ? 'Running the design review…' : 'Queueing to Etsy…'}
                startedAt={startedAtRef.current ?? Date.now()}
                expectedMs={phase === 'reviewing' ? REVIEW_EXPECTED_MS : QUEUE_EXPECTED_MS}
              />
            </div>
          )}
        </>
      )}
    </StepCard>
  )
}

export default EtsyStep
