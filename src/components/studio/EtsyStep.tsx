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
//
// MRS. IMAGINE STEPS IN (2026-09-08). Reporting a failure well is not the same
// as clearing it, and David said so: "if theres something wrong then mrs
// imagine should step in and fix it so it can proccess". A failed review now
// goes straight into the repair pass (POST /design-qa/autofix) — rewrite the
// copy, re-shoot the photo the finding is about — and then RE-REVIEWS, up to
// MAX_FIX_ROUNDS times, before it ever asks David for anything. He only sees
// the panel below when she has genuinely run out of moves.
//
// Note what did NOT change: the gate. Autofix stamps nothing and passes
// nothing; every round still has to earn a fresh verdict on the same terms.
import React, { useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { designQa, etsy, stepFlow, type EtsyTier, type QaAutofix, type QaReview } from '../../lib/api'
import { tiersForCategory } from '../../../backend/shared/etsy-tiers'
import { METAL_ART_PRICES, STUDIO_SIZE_KEYS } from '../../../backend/shared/metal-art'
import type { ShotKey, StepFlowAction, StepFlowState } from './stepFlowReducer'
import { InlineError, SecondaryButton, StartAnotherButton, StepCard, WarnPanel, WARN_HEADING, WARN_TEXT } from './shared'
import ProgressBar from './ProgressBar'

// No live job to watch here — it's a synchronous write-a-draft call.
const QUEUE_EXPECTED_MS = 6000
// The review is two vision calls over the listing photos plus the SEO/pricing
// checks — measured at roughly 15-30s on a one-photo listing.
const REVIEW_EXPECTED_MS = 25_000
// One LLM call for the listing copy (etsy-seo-composer.ts), same call the
// Listing step makes.
const COMPOSE_EXPECTED_MS = 12_000
// The repair pass itself: at most one copy-rewrite call plus the writes that
// queue a re-shoot. The re-shoot's own render is timed separately below.
const FIX_EXPECTED_MS = 15_000
// A model shot, matching MockupStep's SHOT_EXPECTED_MS for the same key.
const RESHOOT_EXPECTED_MS = 45_000

/** How many times Mrs. Imagine may repair-and-resubmit before handing it back.
 *  Every round costs a review (two vision calls) and possibly a render, and a
 *  design that is still failing after two honest attempts has something wrong
 *  with it that David needs to see rather than pay to re-measure. */
const MAX_FIX_ROUNDS = 2
/** Ceiling on waiting for a re-shoot before giving up on it. A model shot runs
 *  ~45s; this is generous enough to survive a busy worker queue and short
 *  enough that the step never looks hung. */
const RESHOOT_TIMEOUT_MS = 4 * 60_000
const SHOT_POLL_MS = 3000

interface EtsyStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  /** Re-hydrates the builder from the server. Used after a re-shoot so the
   *  Mockups step shows the new photo instead of the one just replaced. */
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
  /** Clears the flow and the URL so David can start the next product without
   *  reloading. Optional so the step's own tests can render it bare. */
  onStartAnother?: () => void
}

// The anchors the composer stamps on a pack (etsy-seo-composer.ts:
// ETSY_ANCHOR_PRICE / ETSY_HOODIE_ANCHOR_PRICE, David 2026-09-07: "shirts are
// 25, hoodies 40"). Mirrored here only to LABEL the tier, and only as the
// server's defaults — the price that actually ships is composed server-side.
// The struck-through number is what Etsy shows after the standing 40% shop
// sale David runs in Shop Manager.
const TEE_ANCHOR = 25
const HOODIE_ANCHOR = 40
const SHOP_SALE = 0.4
const priceShown = (anchor: number) => `$${anchor} → $${Math.round(anchor * (1 - SHOP_SALE))}`

// Mirrors AdminEtsyPanel.tsx's TIER_META — no shared frontend type module for
// this yet, so it's a deliberate small second copy rather than new coupling.
const GARMENT_TIER_META: Record<EtsyTier, { label: string; blurb: string; shown: string }> = {
  primary: { label: 'Shirt', blurb: 'The tee/hoodie itself, sizes S–3XL', shown: priceShown(TEE_ANCHOR) },
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

const shotWord = (key: string): string =>
  key === 'model' ? 'the on-person photo' : key === 'product' ? 'the product photo' : key === 'hanger' ? 'the hanger photo' : `the ${key} photo`

const EtsyStep: React.FC<EtsyStepProps> = ({ state, dispatch, refresh, onStartAnother }) => {
  const category: string | null = (state.product as { category?: string } | null)?.category ?? null
  const isMetal = category === 'metal-art'
  const tierOrder: EtsyTier[] = tiersForCategory(category)
  // A hoodie is not a tee and must not be priced like one on the label either
  // — same rule isHoodieProduct() applies server-side.
  const garment = String(
    (state.product as { metadata?: { step_flow?: { garment?: string }; garment?: string } } | null)?.metadata?.step_flow
      ?.garment ??
      (state.product as { metadata?: { garment?: string } } | null)?.metadata?.garment ??
      ''
  )
  const isHoodie =
    category === 'hoodies' ||
    /hoodie|sweatshirt/i.test(garment) ||
    /\bhoodie\b|\bsweatshirt\b/i.test(String((state.product as { name?: string } | null)?.name ?? ''))
  const tierMeta = (t: EtsyTier) =>
    isMetal && t === 'primary'
      ? METAL_PRIMARY_META
      : t === 'primary' && isHoodie
        ? { ...GARMENT_TIER_META.primary, label: 'Hoodie', shown: priceShown(HOODIE_ANCHOR) }
        : GARMENT_TIER_META[t]
  const [tiers, setTiers] = useState<EtsyTier[]>(['primary'])
  const [skipped, setSkipped] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'composing' | 'reviewing' | 'queueing' | 'fixing' | 'reshooting'>('idle')
  const [result, setResult] = useState<QueueResult | null>(null)
  const [gate, setGate] = useState<GateRefusal | null>(null)
  const [review, setReview] = useState<QaReview | null>(null)
  const [autofix, setAutofix] = useState<QaAutofix | null>(null)
  /** True once Mrs. Imagine has stopped trying — either she ran out of rounds
   *  or the remaining findings are ones nothing automatic should touch. Only
   *  then does the manual panel appear. */
  const [handedBack, setHandedBack] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [composeNote, setComposeNote] = useState<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  // `etsy.compose` is a paid LLM call, so it happens at most once per visit to
  // this step — same discipline as ListingStep's composedRef.
  const packEnsuredRef = useRef(false)
  // Rounds already spent, across every attempt on this product this visit —
  // deliberately NOT reset by "Review it again", so a stuck design cannot be
  // walked into an unbounded spend by clicking.
  const fixRoundsRef = useRef(0)

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

  /** Make sure the product carries a composed Etsy pack before anything grades
   *  or publishes it.
   *
   *  Without a pack, BOTH the gate and services/etsy.ts fall back to the
   *  website's `search_keywords` — which is a listing, but a mechanical one:
   *  10 tags of the 13 Etsy allows, none of them echoed in the title or
   *  description. That is exactly the review David got on 2026-09-07, and his
   *  read of it was the right one — the flow should hand Etsy a listing
   *  written for Etsy, not the storefront's SEO fields reshaped.
   *
   *  Reaching this step without a pack means the Listing step was skipped or
   *  its compose call failed, so this is a backstop, not the normal path. A
   *  compose failure is deliberately NOT fatal: the fallback is legal copy
   *  (etsy.ts and the gate both run it through toEtsyTags), just weaker — and
   *  since 2026-09-08 the repair pass rewrites it deterministically anyway. */
  const ensurePack = async (productId: string): Promise<void> => {
    if (packEnsuredRef.current) return
    const existing = (state.product as { metadata?: { etsy_pack?: unknown } } | null)?.metadata?.etsy_pack
    if (existing) {
      packEnsuredRef.current = true
      return
    }
    startedAtRef.current = Date.now()
    setPhase('composing')
    try {
      await etsy.compose(productId)
      packEnsuredRef.current = true
      setComposeNote(null)
    } catch (err: any) {
      // Say so plainly rather than letting the weaker copy look intentional.
      setComposeNote(
        `Could not write Etsy-native listing copy (${err?.message || 'compose failed'}) — ` +
        'reviewing the catalogue keywords instead. "Re-compose" on the Listing step is the retry.'
      )
    } finally {
      setPhase('idle')
    }
  }

  /** Run the review and record the verdict. Returns null only when the review
   *  itself could not run (auth, network, the vision model being down) — a
   *  FAILED verdict is a result, not an error. */
  const runReview = async (productId: string): Promise<QaReview | null> => {
    await ensurePack(productId)
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

  /** Wait for re-queued shots to land. The review has to grade the NEW photo,
   *  so resubmitting before the render finishes would just measure the one
   *  being replaced and fail for the same reason. Resolves on the timeout too
   *  — a stuck render is reported by the next review, not by hanging here. */
  const waitForShots = async (keys: ShotKey[]): Promise<void> => {
    if (!state.productId || keys.length === 0) return
    startedAtRef.current = Date.now()
    setPhase('reshooting')
    const deadline = Date.now() + RESHOOT_TIMEOUT_MS
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SHOT_POLL_MS))
        let shots: Partial<Record<ShotKey, { status?: string }>> = {}
        try {
          const response = await stepFlow.get(state.productId)
          shots = response.step_flow?.shots ?? {}
        } catch {
          // A transient read failure is not a reason to abandon a render that
          // is already paid for — keep waiting until the deadline.
          continue
        }
        const settled = keys.every((k) => {
          const status = shots[k]?.status
          return !status || status === 'done' || status === 'failed'
        })
        if (settled) break
      }
      // Pull the new photo into the builder so the Mockups step shows what
      // actually shipped rather than the shot it replaced.
      await refresh()
    } finally {
      setPhase('idle')
    }
  }

  /**
   * The repair loop. Runs only on a FAILED verdict, and stops the moment it
   * stops making progress:
   *   - the server had nothing to repair, or repaired nothing  -> hand back
   *   - the review itself could not run                        -> hand back
   *   - MAX_FIX_ROUNDS spent                                   -> hand back
   * Returns true when the design ended up passing.
   */
  const runRepairLoop = async (productId: string, failed: QaReview): Promise<boolean> => {
    let verdict: QaReview = failed
    while (verdict.status === 'failed' && fixRoundsRef.current < MAX_FIX_ROUNDS) {
      fixRoundsRef.current += 1

      startedAtRef.current = Date.now()
      setPhase('fixing')
      let report: QaAutofix
      try {
        report = await designQa.autofix(productId, 'etsy')
      } catch (err: any) {
        setError(err?.message || 'Mrs. Imagine could not run her repair pass')
        setHandedBack(true)
        return false
      } finally {
        setPhase('idle')
      }
      setAutofix(report)

      if (!report.attempted || !report.changed) {
        setHandedBack(true)
        return false
      }

      const keys = report.photos.redone.map((r) => r.key as ShotKey)
      if (keys.length) await waitForShots(keys)

      const next = await runReview(productId)
      if (!next) {
        setHandedBack(true)
        return false
      }
      verdict = next
    }

    if (verdict.status === 'failed') {
      setHandedBack(true)
      return false
    }
    return true
  }

  /** Failed review -> repair -> re-review -> queue, without David clicking. */
  const repairThenQueue = async (productId: string, failed: QaReview): Promise<void> => {
    const passed = await runRepairLoop(productId, failed)
    if (!passed) return
    setGate(null)
    await tryQueue(productId)
  }

  const handleQueue = async () => {
    if (!state.productId || tiers.length === 0 || busy) return
    setError(null)
    setGate(null)
    setHandedBack(false)

    const refusal = await tryQueue(state.productId)
    if (!refusal || !AUTO_REVIEWABLE.has(refusal.code)) {
      // A recorded failure the gate is still holding: go straight to repair
      // rather than re-measuring an unchanged design first.
      if (refusal && review?.status === 'failed') await repairThenQueue(state.productId, review)
      else if (refusal) setHandedBack(true)
      return
    }

    // Never reviewed (every fresh step-flow build) or stale after an edit —
    // run the review right here rather than dead-ending the flow.
    const verdict = await runReview(state.productId)
    if (!verdict) return
    if (verdict.status === 'failed') {
      await repairThenQueue(state.productId, verdict)
      return
    }

    setGate(null)
    await tryQueue(state.productId)
  }

  const handleReviewAgain = async () => {
    if (!state.productId || busy) return
    setError(null)
    setHandedBack(false)
    const verdict = await runReview(state.productId)
    if (!verdict) return
    if (verdict.status === 'failed') {
      await repairThenQueue(state.productId, verdict)
      return
    }
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
    setHandedBack(false)
    setOverrideOpen(false)
    setOverrideReason('')
    await tryQueue(state.productId)
  }

  const blocking = (review?.rework ?? []).filter((r) => r.severity === 'block')
  const warnings = (review?.rework ?? []).filter((r) => r.severity !== 'block')
  const failedReview = review?.status === 'failed'
  // The panel is David's cue to act, so it appears only once Mrs. Imagine has
  // finished trying. Mid-loop, the progress bar below is the whole story.
  const showGatePanel = handedBack && (!!gate || failedReview)
  const overrideReady = overrideReason.trim().length >= 10
  const fixedThings = [
    ...(autofix?.copy.repaired ? autofix.copy.changes : []),
    ...(autofix?.price.repaired && autofix.price.to != null ? [`Reset the listing price to $${autofix.price.to}.`] : []),
    ...(autofix?.photos.redone ?? []).map((r) => `Re-shot ${shotWord(r.key)}.`),
  ]

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
            {onStartAnother && <StartAnotherButton onClick={onStartAnother} />}
            <SecondaryButton onClick={() => setSkipped(false)}>Back to Etsy</SecondaryButton>
          </div>
        </div>
      ) : result ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm mb-1">
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
          {/* What Mrs. Imagine changed on the way through. Worth carrying onto
              the success screen: the draft that went out is not quite the one
              David last looked at, and that is easier to know now than to
              discover in Shop Manager. */}
          {fixedThings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-emerald-500/20">
              <p className="text-xs font-semibold text-text mb-0.5">Mrs. Imagine fixed this first:</p>
              <ul className="text-xs text-muted space-y-0.5">
                {fixedThings.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {/* Carried onto the success screen on purpose: a draft that went out
              on the mechanical fallback copy still went out, and that is worth
              knowing while it is still a free invisible draft. */}
          {composeNote && <p className="text-xs text-muted mt-1">{composeNote}</p>}
          <a
            href="/admin"
            className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
          >
            View in the Etsy panel <ExternalLink className="w-3 h-3" />
          </a>
          {/* The end of the flow, and until now a dead end: the draft was
              queued and there was no way on to the next product but reloading
              the page. */}
          {onStartAnother && (
            <div className="mt-4 pt-3 border-t border-emerald-500/20">
              <StartAnotherButton onClick={onStartAnother} />
              <p className="text-xs text-muted mt-2">Clears this build and opens a fresh Idea step. The queued draft stays in Etsy.</p>
            </div>
          )}
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
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <p className="text-sm text-text">
                Design review {review.status === 'overridden' ? 'overridden' : 'passed'} — score {review.score}
                {review.warnings > 0 ? `, ${review.warnings} suggestion${review.warnings > 1 ? 's' : ''} noted` : ''}.
              </p>
            </div>
          )}

          {showGatePanel && (
            <WarnPanel
              className="mb-4"
              icon={<AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />}
              title={
                failedReview && review
                  ? `The design review failed — score ${review.score}, ${blocking.length} thing${blocking.length === 1 ? '' : 's'} to fix.`
                  : 'The design review is holding this listing.'
              }
            >
              {/* What she already tried, first — otherwise the same list of
                  findings reads as if nothing happened. */}
              {fixedThings.length > 0 && (
                <div className="mb-3 rounded-lg bg-amber-100/60 px-3 py-2">
                  <p className={`text-xs font-semibold ${WARN_HEADING} mb-0.5 inline-flex items-center gap-1.5`}>
                    <Sparkles className="w-3.5 h-3.5" /> Mrs. Imagine already tried this:
                  </p>
                  <ul className={`text-xs ${WARN_TEXT} space-y-0.5`}>
                    {fixedThings.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {autofix && !autofix.changed && (
                <p className={`text-sm ${WARN_TEXT} mb-3`}>{autofix.summary}</p>
              )}

              {failedReview ? (
                <>
                  <ul className="space-y-2 mb-3">
                    {blocking.map((item, i) => (
                      <li key={`${item.criterion}-${i}`} className="text-sm">
                        <span className={`font-medium ${WARN_TEXT}`}>{item.issue}</span>
                        {item.fix && <span className="block text-xs text-stone-700 mt-0.5">{item.fix}</span>}
                      </li>
                    ))}
                  </ul>
                  {warnings.length > 0 && (
                    <p className="text-xs text-stone-700 mb-3">
                      Worth a look, but not blocking: {warnings.map((w) => w.issue).join(' ')}
                    </p>
                  )}
                </>
              ) : (
                <p className={`text-sm ${WARN_TEXT} mb-3`}>{gate?.reason}</p>
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
                <div className="mt-3 pt-3 border-t border-amber-500/30">
                  <label className="block text-xs text-stone-700 mb-1.5">
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
                    {!overrideReady && <span className="text-[11px] text-stone-700">A sentence or two is enough.</span>}
                  </div>
                </div>
              )}
            </WarnPanel>
          )}

          <InlineError message={error} />
          {composeNote && <p className="text-sm text-muted mb-3">{composeNote}</p>}

          <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleQueue}
            disabled={busy || tiers.length === 0}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-base shadow-glow disabled:opacity-40 disabled:shadow-none hover:scale-[1.02] active:scale-[0.99] transition-all"
          >
            <Send className="w-5 h-5" />
            {phase === 'composing'
              ? 'Writing copy…'
              : phase === 'reviewing'
                ? 'Reviewing…'
                : phase === 'fixing'
                  ? 'Fixing…'
                  : phase === 'reshooting'
                    ? 'Re-shooting…'
                    : phase === 'queueing'
                      ? 'Queueing…'
                      : `Queue ${tiers.length > 1 ? `${tiers.length} drafts` : 'draft'}`}
          </button>
          <SecondaryButton onClick={() => setSkipped(true)} disabled={busy}>
            Skip Etsy — finish here
          </SecondaryButton>
          </div>

          {busy && (
            <div className="mt-4">
              <ProgressBar
                label={
                  phase === 'composing'
                    ? 'Writing the Etsy listing copy…'
                    : phase === 'reviewing'
                      ? 'Running the design review…'
                      : phase === 'fixing'
                        ? 'Mrs. Imagine is fixing what the review flagged…'
                        : phase === 'reshooting'
                          ? 'Re-shooting the photo the review flagged…'
                          : 'Queueing to Etsy…'
                }
                startedAt={startedAtRef.current ?? Date.now()}
                expectedMs={
                  phase === 'composing'
                    ? COMPOSE_EXPECTED_MS
                    : phase === 'reviewing'
                      ? REVIEW_EXPECTED_MS
                      : phase === 'fixing'
                        ? FIX_EXPECTED_MS
                        : phase === 'reshooting'
                          ? RESHOOT_EXPECTED_MS
                          : QUEUE_EXPECTED_MS
                }
              />
            </div>
          )}
        </>
      )}
    </StepCard>
  )
}

export default EtsyStep
