// Step 6 — Etsy: queue invisible drafts for the tiers David wants to sell.
// Nothing here goes live — he still flips drafts active in Etsy Shop Manager.
import React, { useState } from 'react'
import { Check, ExternalLink, Loader2, Send } from 'lucide-react'
import { etsy, type EtsyTier } from '../../lib/api'
import type { StepFlowAction, StepFlowState } from './stepFlowReducer'
import { InlineError, SecondaryButton, StepCard } from './shared'

interface EtsyStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
}

// Mirrors AdminEtsyPanel.tsx's TIER_META — no shared frontend type module for
// this yet, so it's a deliberate small second copy rather than new coupling.
const TIER_META: Record<EtsyTier, { label: string; blurb: string; shown: string }> = {
  primary: { label: 'Shirt', blurb: 'The tee/hoodie itself, sizes S–3XL', shown: '$25 → $15' },
  transfer: { label: 'Transfer', blurb: 'Printed DTF film you mail — buyer presses it', shown: 'from $12 → $7.20' },
  download: { label: 'Download', blurb: 'The design file, delivered instantly by Etsy', shown: '$5 → $3' },
}
const TIER_ORDER: EtsyTier[] = ['primary', 'transfer', 'download']

const EtsyStep: React.FC<EtsyStepProps> = ({ state, dispatch }) => {
  const [tiers, setTiers] = useState<EtsyTier[]>(['primary'])
  const [queueing, setQueueing] = useState(false)
  const [result, setResult] = useState<{ queued: string[]; skipped: Array<{ tier: string; reason: string }> } | null>(null)
  const [gateReason, setGateReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleTier = (tier: EtsyTier) =>
    setTiers((prev) => (prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]))

  const handleQueue = async () => {
    if (!state.productId || tiers.length === 0) return
    setError(null)
    setGateReason(null)
    setQueueing(true)
    try {
      const res = await etsy.queue(state.productId, tiers)
      setResult({ queued: res.queued ?? [], skipped: res.skipped ?? [] })
    } catch (err: any) {
      if (err?.status === 422) {
        const base = err?.body?.error || 'This design failed the presentation QA gate.'
        const code = err?.body?.qa_gate?.code
        const nextStep = err?.body?.next_step
        setGateReason([base, code ? `Code: ${code}.` : null, nextStep ? `Next: ${nextStep}.` : null].filter(Boolean).join(' '))
      } else {
        setError(err?.message || 'Failed to queue to Etsy')
      }
    } finally {
      setQueueing(false)
    }
  }

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">Queue to Etsy</h2>
      <p className="text-sm text-muted mb-4">
        Posts invisible drafts for review — nothing goes live until you flip it in Etsy Shop Manager.
      </p>

      {result ? (
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
            {TIER_ORDER.map((t) => {
              const on = tiers.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTier(t)}
                  title={TIER_META[t].blurb}
                  className={`inline-flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-left transition-colors ${
                    on ? 'bg-primary/10 border-primary text-text' : 'bg-card border-border-subtle text-muted hover:border-primary/40'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    {on && <Check className="w-3.5 h-3.5 text-primary" />} {TIER_META[t].label}
                  </span>
                  <span className="text-[11px]">{TIER_META[t].shown}</span>
                </button>
              )
            })}
          </div>

          {gateReason && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 mb-4">
              <p className="text-sm text-amber-300">{gateReason}</p>
              <SecondaryButton onClick={() => dispatch({ type: 'GO_TO_STEP', step: 'mockups' })} className="mt-2">
                Back to mockups
              </SecondaryButton>
            </div>
          )}

          <InlineError message={error} />

          <button
            type="button"
            onClick={handleQueue}
            disabled={queueing || tiers.length === 0}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-bold text-base shadow-glow disabled:opacity-40 disabled:shadow-none hover:scale-[1.02] active:scale-[0.99] transition-all"
          >
            {queueing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            {queueing ? 'Queueing…' : `Queue ${tiers.length > 1 ? `${tiers.length} drafts` : 'draft'}`}
          </button>
        </>
      )}
    </StepCard>
  )
}

export default EtsyStep
