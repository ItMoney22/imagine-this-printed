// Step 2 — Design: pick a take, approve it, watch it go transparent.
import React, { useMemo, useState } from 'react'
import { Check, Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { aiProducts, stepFlow } from '../../lib/api'
import { createStepFlowProduct } from './createStepFlowProduct'
import { getDesignCandidates, getNobgAsset, type StepFlowAction, type StepFlowState } from './stepFlowReducer'
import { ApproveButton, Checkerboard, InlineError, SecondaryButton, StepCard } from './shared'

interface DesignStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const DesignStep: React.FC<DesignStepProps> = ({ state, dispatch, refresh }) => {
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [tweaking, setTweaking] = useState(false)
  const [tweakOpen, setTweakOpen] = useState(false)
  const [tweakPrompt, setTweakPrompt] = useState(state.stepFlow?.brief?.designPrompt ?? '')
  const [error, setError] = useState<string | null>(null)

  // Both selectors only read state.assets — state.assets is the exhaustive dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => getDesignCandidates(state), [state.assets])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nobgAsset = useMemo(() => getNobgAsset(state), [state.assets])
  const selectedAssetId = state.assets.find((a) => a.is_primary && a.kind === 'source')?.id ?? null

  const isGenerating = state.jobs.some(
    (j) => (j.type === 'replicate_image' || j.type === 'replicate_image_v2') && (j.status === 'queued' || j.status === 'running')
  )
  const rembgJob = [...state.jobs]
    .filter((j) => j.type === 'replicate_rembg')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  const rembgInFlight = rembgJob && (rembgJob.status === 'queued' || rembgJob.status === 'running')

  const handleUseThis = async (assetId: string) => {
    if (!state.productId) return
    setError(null)
    setBusyAssetId(assetId)
    try {
      await stepFlow.selectDesign(state.productId, assetId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to select that design')
    } finally {
      setBusyAssetId(null)
    }
  }

  const handleTryAnother = async () => {
    if (!state.productId) return
    setError(null)
    setRegenerating(true)
    try {
      await aiProducts.regenerateImages(state.productId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to queue another take')
    } finally {
      setRegenerating(false)
    }
  }

  // regenerate-images can't take a new prompt today — a Tweak spins up a
  // fresh draft product with the edited prompt and swaps productId onto it,
  // per the plan's documented fallback. Unavailable when this draft has no
  // brief (e.g. it was opened via "Continue in Step Flow" from a
  // classic-wizard product) — there's no prompt to tweak from.
  const handleTweak = async () => {
    const flow = state.stepFlow
    const existingBrief = flow?.brief
    if (!flow || !existingBrief || !tweakPrompt.trim()) return
    setError(null)
    setTweaking(true)
    const oldProductId = state.productId
    // Only clean up the old draft if nothing was approved on it yet — once a
    // design was picked (nobg landed), it's a real draft in its own right,
    // not scratch work to discard.
    const oldHadApprovedDesign = getNobgAsset(state) !== null
    try {
      const brief = { ...existingBrief, designPrompt: tweakPrompt.trim() }
      const { productId } = await createStepFlowProduct(flow.idea, brief)
      dispatch({ type: 'PRODUCT_CREATED', productId })
      await refresh({ productId, advance: true })
      setTweakOpen(false)
      if (oldProductId && !oldHadApprovedDesign) {
        aiProducts.delete(oldProductId).catch(() => {
          // Best-effort cleanup — an orphaned draft is untidy, not harmful.
        })
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to start the tweaked design')
    } finally {
      setTweaking(false)
    }
  }

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">Pick your design</h2>
      <p className="text-sm text-muted mb-4">
        {state.stepFlow?.brief?.background
          ? `On a solid ${state.stepFlow.brief.background} background — the background is stripped once you approve.`
          : 'The background is stripped once you approve.'}
      </p>

      {isGenerating && candidates.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Generating your design…
        </div>
      )}

      {candidates.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {candidates.map((c) => {
            const isSelected = c.assetId === selectedAssetId
            const busy = busyAssetId === c.assetId
            return (
              <div
                key={c.assetId}
                className={`rounded-xl border overflow-hidden ${isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-border-subtle'}`}
              >
                <div className="aspect-square bg-card-elevated">
                  <img src={c.url} alt={c.label ?? 'Design take'} className="w-full h-full object-contain" />
                </div>
                <div className="p-2">
                  <button
                    type="button"
                    onClick={() => handleUseThis(c.assetId)}
                    disabled={busy || isSelected}
                    className={`w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50'
                    }`}
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {isSelected ? 'Selected' : 'Use this'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {candidates.length > 0 && !nobgAsset && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SecondaryButton onClick={handleTryAnother} disabled={regenerating}>
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Try another
          </SecondaryButton>
          <SecondaryButton
            onClick={() => setTweakOpen((v) => !v)}
            disabled={tweaking || !state.stepFlow?.brief}
          >
            <Wand2 className="w-3.5 h-3.5" /> Tweak
          </SecondaryButton>
        </div>
      )}
      {candidates.length > 0 && !nobgAsset && !state.stepFlow?.brief && (
        <p className="text-[11px] text-muted mt-1.5">
          Tweak isn't available for a draft opened outside the Idea step — there's no prompt to edit.
        </p>
      )}

      {tweakOpen && (
        <div className="mt-3 space-y-2">
          <textarea
            value={tweakPrompt}
            onChange={(e) => setTweakPrompt(e.target.value)}
            rows={3}
            className="w-full text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
          />
          <ApproveButton onClick={handleTweak} disabled={!tweakPrompt.trim() || tweaking} busy={tweaking}>
            {tweaking ? 'Starting…' : 'Generate tweaked design'}
          </ApproveButton>
          <p className="text-[11px] text-muted">This starts a fresh draft with the edited prompt — the current one stays untouched.</p>
        </div>
      )}

      {selectedAssetId && (
        <div className="mt-6 border-t border-border-subtle pt-4">
          {rembgInFlight ? (
            <div className="flex items-center gap-2 text-sm text-muted py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Removing the background…
            </div>
          ) : nobgAsset ? (
            <>
              <h3 className="text-sm font-semibold text-text mb-2">Transparent print file</h3>
              <div className="grid grid-cols-3 gap-3">
                <Checkerboard className="aspect-square">
                  <img src={nobgAsset.url ?? ''} alt="Transparent" className="w-full h-full object-contain" />
                </Checkerboard>
                <div className="aspect-square bg-white rounded-xl overflow-hidden">
                  <img src={nobgAsset.url ?? ''} alt="On white" className="w-full h-full object-contain" />
                </div>
                <div className="aspect-square bg-black rounded-xl overflow-hidden">
                  <img src={nobgAsset.url ?? ''} alt="On black" className="w-full h-full object-contain" />
                </div>
              </div>
              <div className="mt-4">
                <ApproveButton onClick={() => dispatch({ type: 'GO_TO_STEP', step: 'garments' })}>
                  Approve design
                </ApproveButton>
              </div>
            </>
          ) : null}
        </div>
      )}

      <InlineError message={error} />
    </StepCard>
  )
}

export default DesignStep
