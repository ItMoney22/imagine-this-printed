// Step 4 — Mockups: product / hanger / model / details, then one shot per
// extra color. Every card needs its own approve before Listing unlocks;
// a failed shot can be skipped instead of blocking the flow forever.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Plus, RefreshCw, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import { type ShotSubject } from '../../lib/api'
import { useStudioLane } from './lane'
import { COLORS } from '../../../backend/shared/catalog-capability'
import {
  areMockupsResolved,
  getShots,
  type CastingDecision,
  type ShotKey,
  type ShotState,
  type StepFlowAction,
  type StepFlowJob,
  type StepFlowMeta,
  type StepFlowState,
} from './stepFlowReducer'
import { ApproveButton, BusyDot, EngineLine, InlineError, SecondaryButton, StepCard } from './shared'
import ProgressBar from './ProgressBar'

// Per-shot expected render time — used when the job hasn't reported real
// step/total_steps progress yet. Extra colors reuse the product/hanger
// (ghost-flat) mockup pipeline.
const SHOT_EXPECTED_MS: Partial<Record<ShotKey, number>> = {
  product: 35_000,
  hanger: 35_000,
  model: 45_000,
  details: 8_000,
}
const shotExpectedMs = (key: ShotKey): number => (key.startsWith('color:') ? 35_000 : SHOT_EXPECTED_MS[key] ?? 35_000)

// Firing is just the POST that queues the jobs, not a render — short by nature.
const FIRING_EXPECTED_MS = 4000

interface MockupStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const SCENE_LABEL: Record<string, string> = {
  '4x6': '4×6 on a desk',
  '8x10': '8×10 on the wall',
  '8x11': '8×11 on the wall',
}

/** Every shot key the approved garment/colors — or, for a metal print
 *  (design doc §14), the approved sizes — should have.
 *  Garment: product, hanger, model, details, plus one `color:<id>` per
 *  approved extra color.
 *  Metal: one `scene:<size>` per approved size, plus details — never
 *  product/hanger/model/color:* (no on-person shot, no garment colors).
 *  Used to compute what's still missing so a change after the first mockup
 *  shoot (back to Garments/Sizes, add/change a selection, re-approve) still
 *  gets its shot fired instead of silently never appearing. Exported (same
 *  pattern as IdeaStep's PhraseChips / PrintPrepPanel's RecommendationBadge)
 *  so the metal/garment key sets can be unit-tested directly. */
export function expectedShotKeys(stepFlow: StepFlowMeta | null, productKind: 'garment' | 'metal'): ShotKey[] {
  if (productKind === 'metal') {
    const sizes = stepFlow?.sizes ?? []
    const keys: ShotKey[] = sizes.map((size) => `scene:${size}` as ShotKey)
    keys.push('details')
    return keys
  }
  const keys: ShotKey[] = ['product', 'hanger', 'model', 'details']
  const extras = stepFlow?.colors?.extras ?? []
  for (const colorId of extras) keys.push(`color:${colorId}` as ShotKey)
  return keys
}

export const shotLabel = (key: ShotKey): string => {
  if (key === 'product') return 'Product shot'
  if (key === 'hanger') return 'On a hanger'
  if (key === 'model') return 'On a person'
  if (key.startsWith('model:')) return `On a person ${key.slice('model:'.length)}`
  if (key === 'details') return 'Product details card'
  if (key.startsWith('color:')) {
    const id = key.slice('color:'.length)
    return `Extra color — ${COLORS[id as keyof typeof COLORS]?.label ?? id}`
  }
  if (key.startsWith('scene:')) {
    const size = key.slice('scene:'.length)
    return SCENE_LABEL[size] ?? `Scene — ${size}`
  }
  return key
}

/**
 * Can "Retry with Flare" act on this card?
 *
 * Mirrors the server's supportsForcedEngine (services/step-flow/shots.ts): only
 * a garment mockup goes through the print-true path, because that path stages
 * an EMPTY garment and composites the real print onto it. An on-person shot, a
 * composed details card and a full-bleed metal panel are all a different shape
 * of problem, so the button stays off rather than offering a retry the server
 * would refuse.
 *
 * Hidden once a card already came from Flare — the point of the button is to
 * escape a flux render the admin does not like, not to re-buy the same one
 * (David 2026-09-11: "the mockups can still come from flux 2 pro it does good
 * enough if it doesnt i should have a button that says retry with flare").
 */
export function canRetryWithFlare(
  key: ShotKey,
  productKind: 'garment' | 'metal',
  engine?: string
): boolean {
  if (productKind !== 'garment') return false
  if (isModelShot(key) || key === 'details' || key.startsWith('scene:')) return false
  if (key !== 'product' && key !== 'hanger' && !key.startsWith('color:')) return false
  return !engine?.startsWith('print-true/')
}

/** 'model' and every added `model:<n>` — all the on-person slots. */
export const isModelShot = (key: ShotKey): boolean => key === 'model' || key.startsWith('model:')

/** How the cast chips are grouped. A family/couple is its own row: grouping it
 *  by `audience` would file the family under "Kids" (it carries the youth band
 *  so the child-safety rules apply), which reads as a lie to whoever's picking. */
const CAST_BANDS = [
  { id: 'group', label: 'Together', match: (s: ShotSubject) => s.group === true },
  { id: 'youth', label: 'Kids', match: (s: ShotSubject) => !s.group && s.audience === 'youth' },
  { id: 'adult', label: 'Adults', match: (s: ShotSubject) => !s.group && s.audience === 'adult' },
] as const

/**
 * The cast chips, grouped. Used by BOTH pickers — the per-shot "Who?" recast
 * and the "add another person" panel — so the two can't drift apart.
 */
const SubjectChips: React.FC<{
  subjects: ShotSubject[]
  onPick: (subjectId: string) => void
  disabled?: boolean
  /** Highlighted as the current cast, when this picker is recasting a shot. */
  selectedId?: string
}> = ({ subjects, onPick, disabled, selectedId }) => (
  <>
    {CAST_BANDS.map((band) => {
      const inBand = subjects.filter(band.match)
      if (!inBand.length) return null
      return (
        <div key={band.id} className="mb-1.5 last:mb-0">
          {/* One band on offer (the youth tee) makes the header noise. */}
          {CAST_BANDS.filter((b) => subjects.some(b.match)).length > 1 && (
            <p className="text-[9px] uppercase tracking-wide text-muted mb-1">{band.label}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {inBand.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.persona}
                disabled={disabled}
                onClick={() => onPick(s.id)}
                className={`text-[10px] px-2 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                  selectedId === s.id
                    ? 'bg-primary border-primary text-white'
                    : 'bg-card border-border-subtle text-text hover:border-primary/50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )
    })}
  </>
)

const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-muted/20 text-muted',
  running: 'bg-blue-500/20 text-blue-400',
  done: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  // Distinct from `failed` — a skipped shot is a settled, deliberate choice,
  // not an error the admin still needs to look at.
  skipped: 'bg-amber-500/20 text-amber-400',
  blocked: 'bg-red-500/20 text-red-400',
}

/**
 * Who was cast for the on-person shot, and why (David 2026-09-03: a cute kids'
 * ghost tee came back modelled by a bearded man). Two jobs:
 *  1. Make the casting decision VISIBLE — before this, the model was a silent
 *     random draw, so a wrong-looking person had no explanation and no lever.
 *  2. Surface the mismatch nudge on the one case that is still a dead end —
 *     a kids' design on a listing that sells no youth size at all. A shirt or
 *     hoodie sells a youth cut on the same listing, so it just casts the kid
 *     and this stays quiet; the lever for changing that pick is the "Who?"
 *     picker on the shot card itself, not a trip back to the Garments step.
 */
export const CastingNote: React.FC<{
  casting?: CastingDecision
  productKind: 'garment' | 'metal'
}> = ({ casting, productKind }) => {
  if (!casting || productKind === 'metal') return null
  return (
    <div className="mb-4 rounded-xl border border-border-subtle bg-card-elevated p-3">
      <div className="flex items-start gap-2">
        <UserRound className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs text-text">
            <span className="font-semibold">Cast: {casting.label}</span>
            {casting.audience === 'youth' && <span className="text-muted"> (kids)</span>}
            <span className="text-muted"> — {casting.reason}</span>
          </p>
          {casting.source !== 'mrs-imagine' && (
            <p className="text-[10px] text-muted mt-0.5">
              {casting.source === 'keywords'
                ? "Matched on the listing wording — Mrs. Imagine couldn't read the artwork this time."
                : casting.source === 'manual'
                  ? 'You picked this model for the shot.'
                  : 'No strong signal in the design, so this is the everyday default.'}
            </p>
          )}
        </div>
      </div>
      {casting.mismatch && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 p-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-300">{casting.mismatch}</p>
        </div>
      )}
    </div>
  )
}

const MockupStep: React.FC<MockupStepProps> = ({ state, dispatch, refresh }) => {
  const lane = useStudioLane()

  const [firing, setFiring] = useState(false)
  const [busyKey, setBusyKey] = useState<ShotKey | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Who can model the on-person shot for the approved garment (David
  // 2026-09-08: "I should be able to say who I want the mock up to be") —
  // fetched once the garment is known; empty until then or on a metal print.
  const [subjects, setSubjects] = useState<ShotSubject[]>([])
  // Which on-person card has its "who's in this photo" picker expanded.
  const [pickerKey, setPickerKey] = useState<ShotKey | null>(null)
  // The "add another person" picker at the bottom of the grid, and its busy flag.
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [addingModel, setAddingModel] = useState(false)
  // Keys we've already asked the server to queue this session — guards
  // against both React StrictMode's double-invoke and re-firing a key whose
  // shot just hasn't landed in `shots` yet (the async request is in flight).
  const requestedKeysRef = useRef<Set<ShotKey>>(new Set())
  const firingStartedAtRef = useRef<number | null>(null)
  // `details` has no job row of its own (rendered synchronously server-side
  // once `product` lands an asset — see hasNonTerminalWork's comment), so
  // there's no `created_at` to clock its wait against. Track the first time
  // each such shot is observed in flight instead, so its card still gets an
  // honest elapsed clock.
  const shotFirstSeenRef = useRef<Partial<Record<ShotKey, number>>>({})

  // eslint-disable-next-line react-hooks/exhaustive-deps -- getShots only reads these three fields
  const shots = useMemo(() => getShots(state), [state.stepFlow, state.assets, state.jobs])
  const entries = Object.entries(shots) as Array<[ShotKey, ShotState]>

  // Fire whatever expected keys are missing from `shots` — on first entry
  // (nothing fired yet) that's every key; if the admin goes back to
  // Garments, adds an extra color, and re-approves, it's just the new
  // `color:<id>`.
  useEffect(() => {
    if (!state.productId) return
    const expected = expectedShotKeys(state.stepFlow, state.productKind)
    const present = new Set(Object.keys(shots) as ShotKey[])
    const missing = expected.filter((key) => !present.has(key) && !requestedKeysRef.current.has(key))
    if (missing.length === 0) return
    missing.forEach((key) => requestedKeysRef.current.add(key))
    firingStartedAtRef.current = Date.now()
    setFiring(true)
    lane.api
      .shots(state.productId, missing)
      // The server may come back with `jobs: []` when every requested key is
      // already queued/running/done (idempotent no-op) — that's not an
      // error, just nothing new to do; `refresh()` picks up whatever state
      // the shots are already in.
      .then(() => refresh())
      .catch((err: any) => {
        setError(err?.message || 'Failed to start mockups')
        // Allow a retry on the next render instead of getting stuck silent.
        missing.forEach((key) => requestedKeysRef.current.delete(key))
      })
      .finally(() => setFiring(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.productId, state.productKind, state.stepFlow?.colors, state.stepFlow?.sizes, shots])

  // Load the castable subjects for the approved garment so the picker below
  // only ever offers people who are actually valid for this listing (a youth
  // archetype on an adult tee, or vice versa, is rejected server-side).
  const garment = state.stepFlow?.garment
  useEffect(() => {
    if (state.productKind !== 'garment' || !garment) {
      setSubjects([])
      return
    }
    let cancelled = false
    lane.api
      .shotSubjects(garment)
      .then((res) => {
        if (!cancelled) setSubjects(res.subjects || [])
      })
      .catch(() => {
        // The picker just doesn't offer anything — Redo without a pick still
        // works via automatic casting.
        if (!cancelled) setSubjects([])
      })
    return () => {
      cancelled = true
    }
  }, [state.productKind, garment])

  /** Add ANOTHER person, keeping every shot already taken. `subjectId` picks
   *  who; omitting it lets Mrs. Imagine cast from the artwork. */
  const handleAddModel = async (subjectId?: string) => {
    if (!state.productId) return
    setAddingModel(true)
    setError(null)
    try {
      await lane.api.addModelShot(state.productId, subjectId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to add another person')
    } finally {
      setAddingModel(false)
      setAddPickerOpen(false)
    }
  }

  /** Drop an added person. The first on-person shot can only be redone. */
  const handleRemoveModel = async (key: ShotKey) => {
    if (!state.productId) return
    setBusyKey(key)
    setError(null)
    try {
      await lane.api.removeShot(state.productId, key)
      await refresh()
    } catch (err: any) {
      setError(err?.message || `Failed to remove ${shotLabel(key)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const handleApprove = async (key: ShotKey, shot: ShotState) => {
    if (!state.productId || !shot.assetId) return
    setBusyKey(key)
    setError(null)
    try {
      await lane.api.approveShot(state.productId, key, true, shot.assetId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || `Failed to approve ${shotLabel(key)}`)
    } finally {
      setBusyKey(null)
    }
  }

  /** `subjectId` (model shot only) picks exactly who's in the photo instead
   *  of leaving it to Mrs. Imagine's automatic re-cast. */
  const handleRedo = async (key: ShotKey, subjectId?: string, engine?: 'print-true') => {
    if (!state.productId) return
    setBusyKey(key)
    setError(null)
    try {
      await lane.api.redoShot(state.productId, key, subjectId, engine)
      await refresh()
    } catch (err: any) {
      setError(err?.message || `Failed to redo ${shotLabel(key)}`)
    } finally {
      setBusyKey(null)
      setPickerKey(null)
    }
  }

  /** A failed shot (or an orphaned `details` card) the admin chooses not to
   *  redo — persisted server-side via ShotState.skipped so it survives a
   *  refresh/resume instead of living only in component state. */
  const handleSkip = async (key: ShotKey, shot: ShotState) => {
    if (!state.productId) return
    setBusyKey(key)
    setError(null)
    try {
      await lane.api.approveShot(state.productId, key, false, shot.assetId, true)
      await refresh()
    } catch (err: any) {
      setError(err?.message || `Failed to skip ${shotLabel(key)}`)
    } finally {
      setBusyKey(null)
    }
  }

  // One batch call instead of N parallel per-key approves — those used to
  // race each other's read-modify-write of the same step_flow.shots object.
  const handleApproveAll = async () => {
    if (!state.productId) return
    const pending = entries.filter(([, s]) => s.status === 'done' && !s.approved && s.assetId)
    if (pending.length === 0) return
    setApprovingAll(true)
    setError(null)
    try {
      await lane.api.approveShots(state.productId, pending.map(([key]) => key), true)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to approve all shots')
    } finally {
      setApprovingAll(false)
    }
  }

  // `product` failing leaves `details` orphaned — it's rendered synchronously
  // by the server once `product` lands an asset, so with no `product` asset
  // it stays `queued` forever and never reaches `failed` on its own.
  const productFailed = shots.product?.status === 'failed'
  const isOrphanedDetails = (key: ShotKey, shot: ShotState) => key === 'details' && productFailed && !shot.approved

  // Every fired shot must be explicitly resolved before Continue enables —
  // approved, or skipped (the server-persisted ShotState.skipped flag). A
  // failed (or orphaned-details) shot no longer counts as auto-resolved just
  // by virtue of having failed; the admin has to hit Skip so nothing
  // silently ships without that shot.
  const canContinue = areMockupsResolved(state)

  /** The job row backing a shot (when it has one — `details` doesn't), for
   *  reading real `output.step`/`total_steps` progress and a `created_at` to
   *  clock the wait against. */
  const jobForShot = (shot: ShotState): StepFlowJob | undefined =>
    shot.jobId ? state.jobs.find((j) => j.id === shot.jobId) : undefined

  /** Epoch ms this shot's current wait started — from its job's `created_at`
   *  when it has one, otherwise the first time this component observed it
   *  in flight (see shotFirstSeenRef above). */
  const shotStartedAt = (key: ShotKey, shot: ShotState, job: StepFlowJob | undefined): number | undefined => {
    if (job?.created_at) return new Date(job.created_at).getTime()
    if (shot.status === 'queued' || shot.status === 'running') {
      const existing = shotFirstSeenRef.current[key]
      if (existing) return existing
      const now = Date.now()
      shotFirstSeenRef.current[key] = now
      return now
    }
    return shotFirstSeenRef.current[key]
  }

  return (
    <StepCard>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-xl font-bold text-text">Mockups</h2>
        {entries.some(([, s]) => s.status === 'done' && !s.approved) && (
          <SecondaryButton onClick={handleApproveAll} disabled={approvingAll}>
            {approvingAll ? <BusyDot className="w-2 h-2" /> : <Check className="w-3.5 h-3.5" />}
            Approve all
          </SecondaryButton>
        )}
      </div>
      <p className="text-sm text-muted mb-4">
        {state.productKind === 'metal'
          ? 'A true-to-scale scene for each size, plus a details card.'
          : 'Product shot, hanger, on-person, details card — and one per extra color.'}
      </p>

      <CastingNote casting={state.stepFlow?.casting} productKind={state.productKind} />

      {firing && entries.length === 0 && (
        <div className="py-8 px-2 sm:px-8">
          <ProgressBar
            label="Starting the mockup shoot…"
            startedAt={firingStartedAtRef.current ?? Date.now()}
            expectedMs={FIRING_EXPECTED_MS}
          />
        </div>
      )}

      {entries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map(([key, shot]) => {
            const busy = busyKey === key
            const orphaned = isOrphanedDetails(key, shot)
            // A shot can carry `skipped:true` from before a redo — if it's
            // back in flight (queued/running), that in-progress status wins
            // over the stale skip flag so the card doesn't read "skipped"
            // while a fresh render is on the way.
            const inFlight = shot.status === 'queued' || shot.status === 'running'
            const isSkipped = !!shot.skipped && !inFlight
            const canSkip = (shot.status === 'failed' || orphaned) && !isSkipped && !shot.approved
            const badgeLabel = shot.approved ? 'approved' : isSkipped ? 'skipped' : orphaned ? 'blocked' : shot.status
            const job = jobForShot(shot)
            const failedVisual = shot.status === 'failed' || orphaned
            return (
              <div key={key} className="rounded-xl border border-border-subtle overflow-hidden flex flex-col">
                <div className="aspect-square bg-card-elevated flex items-center justify-center p-3">
                  {shot.url ? (
                    <img src={shot.url} alt={shotLabel(key)} className="w-full h-full object-contain" />
                  ) : failedVisual ? (
                    <div className="w-full flex flex-col items-center gap-2">
                      <AlertTriangle className="w-6 h-6 text-red-400" />
                      <ProgressBar label={shotLabel(key)} failed />
                    </div>
                  ) : (
                    <ProgressBar
                      label={shotLabel(key)}
                      startedAt={shotStartedAt(key, shot, job)}
                      expectedMs={shotExpectedMs(key)}
                      step={job?.output?.step}
                      totalSteps={job?.output?.total_steps}
                    />
                  )}
                </div>
                <div className="p-2.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text truncate">{shotLabel(key)}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLE[badgeLabel] ?? STATUS_STYLE.queued}`}>
                      {badgeLabel}
                    </span>
                  </div>
                  {/* Who is in THIS photo — each on-person slot carries its own cast. */}
                  {isModelShot(key) && shot.casting && (
                    <p className="text-[10px] text-muted truncate" title={shot.casting.reason}>
                      <UserRound className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
                      {shot.casting.label}
                      {shot.casting.audience === 'youth' && ' (kid)'}
                    </p>
                  )}
                  {/* What actually rendered this card, read off the finished asset. */}
                  <EngineLine engine={shot.engine} />
                  {shot.status === 'failed' && shot.error && <p className="text-[10px] text-red-400 truncate" title={shot.error}>{shot.error}</p>}
                  {shot.note && shot.status !== 'failed' && (
                    <p className="text-[10px] text-amber-400 line-clamp-2" title={shot.note}>{shot.note}</p>
                  )}
                  {orphaned && (
                    <p className="text-[10px] text-red-400 truncate" title="The product shot failed, so the details card can't be rendered.">
                      Blocked — the product shot failed
                    </p>
                  )}
                  <div className="flex items-center gap-1.5">
                    {shot.status === 'done' && !shot.approved && (
                      <button
                        type="button"
                        onClick={() => handleApprove(key, shot)}
                        disabled={busy}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {busy ? <BusyDot className="w-1.5 h-1.5" /> : <Check className="w-3 h-3" />} Approve
                      </button>
                    )}
                    {(shot.status === 'done' || shot.status === 'failed') && (
                      <button
                        type="button"
                        onClick={() => handleRedo(key)}
                        disabled={busy}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-card border border-border-subtle text-text hover:bg-card-elevated disabled:opacity-50"
                      >
                        {busy ? <BusyDot className="w-1.5 h-1.5" /> : <RefreshCw className="w-3 h-3" />} Redo
                      </button>
                    )}
                    {/* Escape hatch from a flux render the admin doesn't like.
                        Plain "Redo" re-rolls the same engine; this one names the
                        engine it wants and gets an error back if it can't have
                        it, rather than another flux shot wearing a Flare label. */}
                    {(shot.status === 'done' || shot.status === 'failed') &&
                      canRetryWithFlare(key, state.productKind, (shot as { engine?: string }).engine) && (
                        <button
                          type="button"
                          onClick={() => handleRedo(key, undefined, 'print-true')}
                          disabled={busy}
                          title="Re-render this shot with Flare: the garment is generated empty and your real print file is composited on, so the artwork is never redrawn."
                          className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-card border border-border-subtle text-text hover:bg-card-elevated disabled:opacity-50"
                        >
                          {busy ? <BusyDot className="w-1.5 h-1.5" /> : <Sparkles className="w-3 h-3" />} Retry with Flare
                        </button>
                      )}
                    {isModelShot(key) && subjects.length > 0 && (shot.status === 'done' || shot.status === 'failed') && (
                      <button
                        type="button"
                        onClick={() => setPickerKey(pickerKey === key ? null : key)}
                        disabled={busy}
                        title="Pick who models this shot"
                        className={`inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg border disabled:opacity-50 ${
                          pickerKey === key
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-card border-border-subtle text-text hover:bg-card-elevated'
                        }`}
                      >
                        <UserRound className="w-3 h-3" /> Who?
                      </button>
                    )}
                    {/* Only an ADDED person can be dropped — the first on-person
                        shot is part of every listing and is redone, not removed. */}
                    {isModelShot(key) && key !== 'model' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(key)}
                        disabled={busy}
                        title="Remove this person from the listing"
                        className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg text-muted hover:text-red-400 disabled:opacity-50"
                      >
                        {busy ? <BusyDot className="w-1.5 h-1.5" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    )}
                    {canSkip && (
                      <button
                        type="button"
                        onClick={() => handleSkip(key, shot)}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg text-muted hover:text-text disabled:opacity-50"
                        title="Move on without this shot"
                      >
                        {busy ? <BusyDot className="w-1.5 h-1.5" /> : <X className="w-3 h-3" />} Skip
                      </button>
                    )}
                  </div>
                  {isModelShot(key) && pickerKey === key && (
                    <div className="rounded-lg border border-border-subtle bg-card-elevated p-2">
                      <p className="text-[10px] text-muted mb-1.5">Redo as:</p>
                      {/* `key`, never a hardcoded 'model' — on an added shot this
                          has to recast THAT photo, not the first one. */}
                      <SubjectChips
                        subjects={subjects}
                        disabled={busy}
                        selectedId={shot.casting?.subjectId}
                        onPick={(subjectId) => handleRedo(key, subjectId)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add another person. David 2026-09-08: "keep the adult and add a kid...
          or even what if i want a family all wearing the shirts". Each pick
          becomes its own listing photo alongside the ones already shot. */}
      {state.productKind === 'garment' && subjects.length > 0 && entries.length > 0 && (
        <div className="mt-4">
          {!addPickerOpen ? (
            <button
              type="button"
              onClick={() => setAddPickerOpen(true)}
              disabled={addingModel}
              className="inline-flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-card border border-border-subtle text-text hover:bg-card-elevated disabled:opacity-50"
            >
              {addingModel ? <BusyDot className="w-2 h-2" /> : <Plus className="w-3.5 h-3.5" />}
              Add another person
            </button>
          ) : (
            <div className="rounded-xl border border-border-subtle bg-card-elevated p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-text">Who else is wearing it?</p>
                <button
                  type="button"
                  onClick={() => setAddPickerOpen(false)}
                  className="text-muted hover:text-text"
                  aria-label="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted mb-2">
                This adds a new photo — everything you've already shot stays.
              </p>
              <SubjectChips subjects={subjects} disabled={addingModel} onPick={handleAddModel} />
              <button
                type="button"
                onClick={() => handleAddModel()}
                disabled={addingModel}
                className="mt-1 text-[11px] text-muted hover:text-text underline disabled:opacity-50"
              >
                Let Mrs. Imagine pick
              </button>
            </div>
          )}
        </div>
      )}

      <InlineError message={error} />

      <div className="mt-6">
        <ApproveButton onClick={() => dispatch({ type: 'GO_TO_STEP', step: 'listing' })} disabled={!canContinue}>
          Continue to listing
        </ApproveButton>
        {!canContinue && entries.length > 0 && (
          <p className="text-[11px] text-muted mt-2">Approve (or skip) every shot above to continue.</p>
        )}
      </div>
    </StepCard>
  )
}

export default MockupStep
