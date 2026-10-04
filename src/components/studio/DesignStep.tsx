// Step 2 — Design: pick a take, approve it, watch it go transparent.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, ShieldAlert, Wand2 } from 'lucide-react'
import { useStudioLane } from './lane'
import { getDesignCandidates, getNobgAsset, type StepFlowAction, type StepFlowState } from './stepFlowReducer'
import { ApproveButton, BusyDot, Checkerboard, EngineLine, engineLabel, InlineError, SecondaryButton, StepCard } from './shared'
import ProgressBar from './ProgressBar'
import PrintPrepPanel from './PrintPrepPanel'
import AddWordsPanel from './AddWordsPanel'
import { isSensitivityRefusal, softenPrompt, SENSITIVITY_BODY, SENSITIVITY_HEADLINE } from './promptSafety'

// gpt-image-2 takes ~2-3 minutes; rembg is a quick Replicate call once the
// design is picked. Both are real timed waits David complained about.
const DESIGN_EXPECTED_MS = 150_000
const REMBG_EXPECTED_MS = 15_000

interface DesignStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const DesignStep: React.FC<DesignStepProps> = ({ state, dispatch, refresh }) => {
  const lane = useStudioLane()

  const [busyAssetId, setBusyAssetId] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [tweaking, setTweaking] = useState(false)
  const [tweakOpen, setTweakOpen] = useState(false)
  const [tweakPrompt, setTweakPrompt] = useState(state.stepFlow?.brief?.designPrompt ?? '')
  const [rephrasePrompt, setRephrasePrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Both selectors only read state.assets — state.assets is the exhaustive dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => getDesignCandidates(state), [state.assets])

  // The generation jobs, newest first and INCLUDING terminal ones. Reading
  // only queued/running (which is all this step used to do) meant a refused
  // or failed generation rendered as an empty step: the reason sat unread in
  // `ai_jobs.error` while the card said "No design on this product yet".
  const designJobs = useMemo(
    () =>
      [...state.jobs]
        .filter((j) => j.type === 'replicate_image' || j.type === 'replicate_image_v2')
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [state.jobs]
  )
  const designJob = designJobs.find((j) => j.status === 'queued' || j.status === 'running')
  const latestDesignJob = designJobs[0]
  const designFailed = !designJob && latestDesignJob?.status === 'failed'
  // A content refusal is not a technical failure and must not be offered the
  // same remedy: re-running the identical prompt gets refused again, and
  // rewording a prompt does nothing about a timeout.
  const refused = designFailed && isSensitivityRefusal(latestDesignJob?.error)

  // An empty Design step used to render as a bare heading — no takes, no
  // error, nothing to press. Whatever the cause (a product created outside
  // the flow, a failed adopt, a generation that never ran), saying so beats
  // a blank card.
  const nothingToShow = candidates.length === 0 && !state.loading && !state.error && !designFailed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nobgAsset = useMemo(() => getNobgAsset(state), [state.assets])
  const selectedAssetId = state.assets.find((a) => a.is_primary && a.kind === 'source')?.id ?? null

  // Metal prints (design doc §14): select-design never queues rembg — no
  // nobg asset will EVER exist — so the "locked in, no more tries" signal
  // has to be the design approval stamp itself (which the backend sets
  // synchronously at select-design time for metal) instead of nobgAsset.
  const isMetal = state.productKind === 'metal'
  const designLocked = isMetal ? !!state.stepFlow?.approvals?.design : !!nobgAsset

  // "Try another" is a paid re-render off the product's stored image_prompt —
  // exactly what POST /:id/regenerate-images requires. A draft that entered
  // the flow with an already-drawn design (the design library's /step/adopt)
  // has no prompt at all, so the button could only ever 400 there. Read the
  // same two fields the endpoint checks rather than guessing from the source.
  const canRegenerate = !!(state.product?.metadata?.ai_generated && state.product?.metadata?.image_prompt)
  const fromLibrary = state.product?.metadata?.import_source === 'design-library'

  const isGenerating = !!designJob
  // Name the model the job was actually dispatched with instead of the
  // hardcoded "GPT Image 2" this used to claim - that line kept saying
  // gpt-image-2 no matter which engine the router had picked, which is
  // exactly the kind of confident-and-wrong caption David called out.
  const designEngine = engineLabel(
    typeof designJob?.input?.modelId === 'string' ? designJob.input.modelId : undefined
  )
  const rembgJob = [...state.jobs]
    .filter((j) => j.type === 'replicate_rembg')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  const rembgInFlight = rembgJob && (rembgJob.status === 'queued' || rembgJob.status === 'running')

  // Takes that were individually REFUSED on a job that still delivered
  // something. Worth one honest line — the admin is picking from fewer takes
  // than they paid for and deserves to know why, but there is nothing to fix.
  const refusedTakes: string[] = useMemo(() => {
    const results = latestDesignJob?.output?.results
    if (!Array.isArray(results)) return []
    return results
      .filter((r: any) => r?.status === 'failed' && isSensitivityRefusal(r?.error))
      .map((r: any) => String(r?.modelLabel || r?.modelId || 'a take'))
  }, [latestDesignJob])

  // The rephrase suggestion, and the swaps it made. Derived from the brief's
  // own prompt so it is the exact text a retry would send.
  const briefPrompt = state.stepFlow?.brief?.designPrompt ?? ''
  const softened = useMemo(() => softenPrompt(briefPrompt), [briefPrompt])
  // Seeded ONCE per brief so the admin's own edits are never overwritten by a
  // background poll (this step re-renders every few seconds while polling).
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!refused || !briefPrompt || seededFor.current === briefPrompt) return
    seededFor.current = briefPrompt
    setRephrasePrompt(softened.prompt || briefPrompt)
  }, [refused, briefPrompt, softened.prompt])

  const handleUseThis = async (assetId: string) => {
    if (!state.productId) return
    setError(null)
    setBusyAssetId(assetId)
    try {
      await lane.api.selectDesign(state.productId, assetId)
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
      await lane.regenerateTakes?.(state.productId)
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
  // Shared by Tweak and by the refusal panel's Rephrase: both are "start a
  // fresh draft from this edited prompt", and a second copy of the
  // create/swap/discard dance would be a second place to get it wrong.
  const startFreshDraft = async (nextPrompt: string) => {
    const flow = state.stepFlow
    const existingBrief = flow?.brief
    if (!flow || !existingBrief || !nextPrompt.trim()) return
    setError(null)
    setTweaking(true)
    const oldProductId = state.productId
    // Only clean up the old draft if nothing was approved on it yet — once a
    // design was picked (nobg landed), it's a real draft in its own right,
    // not scratch work to discard.
    const oldHadApprovedDesign = getNobgAsset(state) !== null
    try {
      const brief = { ...existingBrief, designPrompt: nextPrompt.trim() }
      const { productId } = await lane.createProduct(flow.idea, brief)
      dispatch({ type: 'PRODUCT_CREATED', productId })
      await refresh({ productId, advance: true })
      setTweakOpen(false)
      if (oldProductId && !oldHadApprovedDesign) {
        lane.discardDraft(oldProductId).catch(() => {
          // Best-effort cleanup — an orphaned draft is untidy, not harmful.
        })
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to start the tweaked design')
    } finally {
      setTweaking(false)
    }
  }

  const handleTweak = () => startFreshDraft(tweakPrompt)
  const handleRephrase = () => startFreshDraft(rephrasePrompt)

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">Pick your design</h2>
      <p className="text-sm text-muted mb-4">
        {isMetal
          ? 'Fills the whole panel edge to edge.'
          : fromLibrary
            ? 'Brought in from your design library. Check the print file below — that transparent version is what gets pressed.'
            : state.stepFlow?.brief?.background
              ? `On a solid ${state.stepFlow.brief.background} background — the background is stripped once you approve.`
              : 'The background is stripped once you approve.'}
      </p>

      {nothingToShow && !isGenerating && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold text-text mb-1">No design on this product yet</p>
          <p className="text-muted">
            Nothing has been drawn or brought into the flow for it. If it was made in the
            product editor, open it in the design library and press Step Flow there — that
            promotes its artwork into a real take. Nothing on this step will work until then.
          </p>
        </div>
      )}

      {/* A REFUSED prompt (Replicate E005, OpenAI's safety system, Imagen's
          filter). The old behaviour was the generic "no design yet" card,
          which read as "nothing ran" — so the actual reason, and the only
          thing that fixes it, were both invisible. */}
      {refused && candidates.length === 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm space-y-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text">{SENSITIVITY_HEADLINE}</p>
              <p className="text-muted mt-1">{SENSITIVITY_BODY}</p>
            </div>
          </div>

          {/* The engine's own words, so nobody has to go digging in the job row. */}
          {latestDesignJob?.error && (
            <p className="text-[11px] text-muted font-mono break-words bg-card rounded-lg px-2.5 py-2">
              {latestDesignJob.error}
            </p>
          )}

          {briefPrompt ? (
            <>
              {softened.changes.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-text">Suggested rewording:</p>
                  <ul className="text-[11px] text-muted space-y-0.5">
                    {softened.changes.map((c) => (
                      <li key={c.from}>
                        <span className="line-through">{c.from}</span>
                        {' → '}
                        <span className="text-text font-medium">{c.to || '(removed)'}</span>
                        <span className="text-muted"> — {c.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[11px] text-muted">
                  Nothing in the prompt matched a wording we know trips these filters, so there's no
                  automatic suggestion here — reword whatever you think it objected to and try again.
                </p>
              )}

              <textarea
                value={rephrasePrompt}
                onChange={(e) => setRephrasePrompt(e.target.value)}
                rows={4}
                aria-label="Reworded design prompt"
                className="w-full text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
              />
              <div className="flex flex-wrap items-center gap-2">
                <ApproveButton
                  onClick={handleRephrase}
                  disabled={!rephrasePrompt.trim() || tweaking}
                  busy={tweaking}
                >
                  {tweaking ? 'Starting…' : 'Generate rephrased design'}
                </ApproveButton>
                <SecondaryButton
                  onClick={() => setRephrasePrompt(briefPrompt)}
                  disabled={tweaking || rephrasePrompt === briefPrompt}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Restore my original wording
                </SecondaryButton>
              </div>
              <p className="text-[11px] text-muted">
                This starts a fresh draft with the reworded prompt. Rewording is not a guarantee —
                the filter may still refuse it.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">
              This draft has no brief to reword (it was opened outside the Idea step), so there's
              nothing to retry from here. Start it again from the Idea step with softer wording.
            </p>
          )}
        </div>
      )}

      {/* A TECHNICAL failure. Deliberately not offered a rephrase: rewording
          does nothing about a timeout or a 502, and pretending otherwise
          sends the admin down a dead end. */}
      {designFailed && !refused && candidates.length === 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text">The design generation failed</p>
              <p className="text-muted mt-1">
                Not a content refusal — something in the pipeline broke. Try it again; if it keeps
                failing, the error below is what to chase.
              </p>
            </div>
          </div>
          {latestDesignJob?.error && (
            <p className="text-[11px] text-muted font-mono break-words bg-card rounded-lg px-2.5 py-2">
              {latestDesignJob.error}
            </p>
          )}
          {lane.regenerateTakes && canRegenerate && (
            <SecondaryButton onClick={handleTryAnother} disabled={regenerating}>
              {regenerating ? <BusyDot className="w-2 h-2" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Try again
            </SecondaryButton>
          )}
        </div>
      )}

      {/* Some takes landed, some were refused — nothing to fix, but the admin
          is choosing from fewer takes than they paid for. */}
      {candidates.length > 0 && refusedTakes.length > 0 && (
        <p className="mb-3 text-[11px] text-amber-400">
          {refusedTakes.length} of the takes {refusedTakes.length === 1 ? 'was' : 'were'} refused as
          sensitive ({refusedTakes.join(', ')}). The ones below came through.
        </p>
      )}

      {isGenerating && candidates.length === 0 && (
        <div className="py-8 px-2 sm:px-8">
          <ProgressBar
            size="lg"
            label={
              designJob?.output?.message ||
              (designEngine ? `Painting your design with ${designEngine}` : 'Painting your design')
            }
            startedAt={designJob?.created_at ? new Date(designJob.created_at).getTime() : Date.now()}
            expectedMs={DESIGN_EXPECTED_MS}
            step={designJob?.output?.step}
            totalSteps={designJob?.output?.total_steps}
          />
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
                <div className={`${isMetal ? 'aspect-[3/4]' : 'aspect-square'} bg-card-elevated`}>
                  <img src={c.url} alt={c.label ?? 'Design take'} className="w-full h-full object-contain" />
                </div>
                <div className="p-2 space-y-1.5">
                  {/* Which model drew THIS take, read off the asset itself. */}
                  <EngineLine engine={c.engine} />
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
                    {busy ? <BusyDot className="w-2 h-2" /> : <Check className="w-3.5 h-3.5" />}
                    {isSelected ? 'Selected' : 'Use this'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {candidates.length > 0 && !designLocked && canRegenerate && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* "Try another" re-runs generation on the same draft through an
              unmetered staff route. A customer's retry is Tweak, which starts
              a fresh, ITC-charged draft — so this only exists where the house
              is the one paying (lane.regenerateTakes, components/studio/lane.tsx). */}
          {lane.regenerateTakes && (
            <SecondaryButton onClick={handleTryAnother} disabled={regenerating}>
              {regenerating ? <BusyDot className="w-2 h-2" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Try another
            </SecondaryButton>
          )}
          <SecondaryButton
            onClick={() => setTweakOpen((v) => !v)}
            disabled={tweaking || !state.stepFlow?.brief}
          >
            <Wand2 className="w-3.5 h-3.5" /> Tweak
          </SecondaryButton>
        </div>
      )}
      {candidates.length > 0 && !designLocked && canRegenerate && !state.stepFlow?.brief && (
        <p className="text-[11px] text-muted mt-1.5">
          Tweak isn't available for a draft opened outside the Idea step — there's no prompt to edit.
        </p>
      )}

      {/* Words go on HERE, not on the Idea step, because this is the first
          moment in the flow where there is a picture for them to match
          (David 2026-09-09). Offered while the design is still open: once a
          take is approved and the background is stripped, lettering it would
          mean redoing that work. Unlike Tweak, it needs no brief — a design
          adopted from the library can be lettered too. */}
      {candidates.length > 0 && !designLocked && state.productId && (
        <AddWordsPanel
          productId={state.productId}
          assetId={selectedAssetId ?? candidates[candidates.length - 1]?.assetId ?? null}
          refresh={refresh}
        />
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

      {selectedAssetId && isMetal && designLocked && (
        <div className="mt-6 border-t border-border-subtle pt-4">
          <ApproveButton onClick={() => dispatch({ type: 'GO_TO_STEP', step: 'garments' })}>
            Approve design
          </ApproveButton>
        </div>
      )}

      {selectedAssetId && !isMetal && (
        <div className="mt-6 border-t border-border-subtle pt-4">
          {rembgInFlight ? (
            <div className="py-6 px-2 sm:px-6">
              <ProgressBar
                label="Stripping the background"
                startedAt={rembgJob?.created_at ? new Date(rembgJob.created_at).getTime() : Date.now()}
                expectedMs={REMBG_EXPECTED_MS}
                step={rembgJob?.output?.step}
                totalSteps={rembgJob?.output?.total_steps}
              />
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
              {/* Halftone/print-file prep is production tooling — the shop's job,
                  not the customer's. */}
              {lane.showTeamTools && <PrintPrepPanel state={state} refresh={refresh} />}
            </>
          ) : null}
        </div>
      )}

      <InlineError message={error} />
    </StepCard>
  )
}

export default DesignStep
