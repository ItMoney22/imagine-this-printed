// Step 4 — Mockups: product / hanger / model / details, then one shot per
// extra color. Every card needs its own approve before Listing unlocks;
// a failed shot can be skipped instead of blocking the flow forever.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react'
import { stepFlow } from '../../lib/api'
import { COLORS } from '../../../backend/shared/catalog-capability'
import { areMockupsResolved, getShots, type ShotKey, type ShotState, type StepFlowAction, type StepFlowState } from './stepFlowReducer'
import { ApproveButton, InlineError, SecondaryButton, StepCard } from './shared'

interface MockupStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const shotLabel = (key: ShotKey): string => {
  if (key === 'product') return 'Product shot'
  if (key === 'hanger') return 'On a hanger'
  if (key === 'model') return 'On a person'
  if (key === 'details') return 'Product details card'
  if (key.startsWith('color:')) {
    const id = key.slice('color:'.length)
    return `Extra color — ${COLORS[id as keyof typeof COLORS]?.label ?? id}`
  }
  return key
}

const STATUS_STYLE: Record<ShotState['status'], string> = {
  queued: 'bg-muted/20 text-muted',
  running: 'bg-blue-500/20 text-blue-400',
  done: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
}

const MockupStep: React.FC<MockupStepProps> = ({ state, dispatch, refresh }) => {
  const [firing, setFiring] = useState(false)
  const [busyKey, setBusyKey] = useState<ShotKey | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [skipped, setSkipped] = useState<Set<ShotKey>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const firedRef = useRef(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- getShots only reads these three fields
  const shots = useMemo(() => getShots(state), [state.stepFlow, state.assets, state.jobs])
  const entries = Object.entries(shots) as Array<[ShotKey, ShotState]>

  useEffect(() => {
    if (!state.productId || firedRef.current || entries.length > 0) return
    firedRef.current = true
    setFiring(true)
    stepFlow
      .shots(state.productId)
      .then(() => refresh())
      .catch((err: any) => setError(err?.message || 'Failed to start mockups'))
      .finally(() => setFiring(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.productId, entries.length])

  const handleApprove = async (key: ShotKey, shot: ShotState) => {
    if (!state.productId || !shot.assetId) return
    setBusyKey(key)
    setError(null)
    try {
      await stepFlow.approveShot(state.productId, key, true, shot.assetId)
      await refresh()
    } catch (err: any) {
      setError(err?.message || `Failed to approve ${shotLabel(key)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const handleRedo = async (key: ShotKey) => {
    if (!state.productId) return
    setBusyKey(key)
    setError(null)
    setSkipped((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    try {
      await stepFlow.redoShot(state.productId, key)
      await refresh()
    } catch (err: any) {
      setError(err?.message || `Failed to redo ${shotLabel(key)}`)
    } finally {
      setBusyKey(null)
    }
  }

  const handleApproveAll = async () => {
    if (!state.productId) return
    const pending = entries.filter(([, s]) => s.status === 'done' && !s.approved && s.assetId)
    if (pending.length === 0) return
    setApprovingAll(true)
    setError(null)
    try {
      await Promise.all(pending.map(([key, s]) => stepFlow.approveShot(state.productId!, key, true, s.assetId!)))
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to approve all shots')
    } finally {
      setApprovingAll(false)
    }
  }

  const canContinue = areMockupsResolved(state)

  return (
    <StepCard>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-xl font-bold text-text">Mockups</h2>
        {entries.some(([, s]) => s.status === 'done' && !s.approved) && (
          <SecondaryButton onClick={handleApproveAll} disabled={approvingAll}>
            {approvingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Approve all
          </SecondaryButton>
        )}
      </div>
      <p className="text-sm text-muted mb-4">Product shot, hanger, on-person, details card — and one per extra color.</p>

      {firing && entries.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Starting the mockup shoot…
        </div>
      )}

      {entries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map(([key, shot]) => {
            const busy = busyKey === key
            const isSkipped = skipped.has(key)
            return (
              <div key={key} className="rounded-xl border border-border-subtle overflow-hidden flex flex-col">
                <div className="aspect-square bg-card-elevated flex items-center justify-center">
                  {shot.url ? (
                    <img src={shot.url} alt={shotLabel(key)} className="w-full h-full object-contain" />
                  ) : shot.status === 'failed' ? (
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                  ) : (
                    <Loader2 className="w-6 h-6 text-muted animate-spin" />
                  )}
                </div>
                <div className="p-2.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text truncate">{shotLabel(key)}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLE[shot.status]}`}>
                      {shot.approved ? 'approved' : isSkipped ? 'skipped' : shot.status}
                    </span>
                  </div>
                  {shot.status === 'failed' && shot.error && <p className="text-[10px] text-red-400 truncate" title={shot.error}>{shot.error}</p>}
                  <div className="flex items-center gap-1.5">
                    {shot.status === 'done' && !shot.approved && (
                      <button
                        type="button"
                        onClick={() => handleApprove(key, shot)}
                        disabled={busy}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
                      </button>
                    )}
                    {(shot.status === 'done' || shot.status === 'failed') && (
                      <button
                        type="button"
                        onClick={() => handleRedo(key)}
                        disabled={busy}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-card border border-border-subtle text-text hover:bg-card-elevated disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Redo
                      </button>
                    )}
                    {shot.status === 'failed' && !isSkipped && (
                      <button
                        type="button"
                        onClick={() => setSkipped((prev) => new Set(prev).add(key))}
                        className="inline-flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg text-muted hover:text-text"
                        title="Move on without this shot"
                      >
                        <X className="w-3 h-3" /> Skip
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
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
