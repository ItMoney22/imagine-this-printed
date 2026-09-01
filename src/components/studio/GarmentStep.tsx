// Step 3 — Garments & Colors: only what ITP can actually make (tee/hoodie,
// DTF only), with contrast-aware color advice so a mostly-black design never
// gets pushed onto a black shirt by default.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { stepFlow } from '../../lib/api'
import { GARMENTS, colorsForGarment, type ColorId, type GarmentId } from '../../../backend/shared/catalog-capability'
import type { ColorAdvice, StepFlowAction, StepFlowState } from './stepFlowReducer'
import { ApproveButton, InlineError, StepCard } from './shared'

interface GarmentStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const GRADE_STYLE: Record<ColorAdvice['grade'], string> = {
  great: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ok: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  poor: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const GarmentStep: React.FC<GarmentStepProps> = ({ state, refresh }) => {
  const [garment, setGarment] = useState<GarmentId>(
    (state.stepFlow?.garment as GarmentId | undefined) ?? state.stepFlow?.brief.garmentHint ?? 'tshirt'
  )
  const [primaryColor, setPrimaryColor] = useState<ColorId | null>(state.stepFlow?.colors?.primary ?? null)
  const [extraColors, setExtraColors] = useState<ColorId[]>(state.stepFlow?.colors?.extras ?? [])
  const [loadingAdvice, setLoadingAdvice] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestedAdviceRef = useRef(false)

  const advice = useMemo(() => state.stepFlow?.advice ?? [], [state.stepFlow?.advice])

  useEffect(() => {
    if (!state.productId || requestedAdviceRef.current || advice.length > 0) return
    requestedAdviceRef.current = true
    setLoadingAdvice(true)
    stepFlow
      .colorAdvice(state.productId)
      .then(() => refresh())
      .catch((err: any) => setError(err?.message || 'Failed to score colors for this artwork'))
      .finally(() => setLoadingAdvice(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.productId])

  const rankedColors = useMemo(() => {
    const offered = colorsForGarment(garment)
    const byId = new Map(advice.map((a) => [a.id, a]))
    return offered
      .map((c) => ({ color: c, advice: byId.get(c.id) ?? null }))
      .sort((a, b) => (b.advice?.score ?? 0) - (a.advice?.score ?? 0))
  }, [garment, advice])

  // Once advice lands (or the garment changes), default primary to the
  // best-graded color if nothing is picked yet / the current pick isn't offered.
  useEffect(() => {
    if (rankedColors.length === 0) return
    const stillOffered = primaryColor && rankedColors.some((r) => r.color.id === primaryColor)
    if (!stillOffered) {
      setPrimaryColor(rankedColors[0].color.id)
      setExtraColors([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garment, rankedColors.length])

  const toggleExtra = (id: ColorId) => {
    if (id === primaryColor) return
    setExtraColors((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  const handleApprove = async () => {
    if (!state.productId || !primaryColor) return
    setError(null)
    setApproving(true)
    try {
      await stepFlow.garments(state.productId, { garment, primaryColor, extraColors })
      await refresh({ advance: true })
    } catch (err: any) {
      setError(err?.message || 'Failed to approve garment & colors')
    } finally {
      setApproving(false)
    }
  }

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">Garment & colors</h2>
      <p className="text-sm text-muted mb-4">Only what ITP can actually make — DTF on a tee or hoodie.</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {GARMENTS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGarment(g.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              garment === g.id
                ? 'bg-gradient-to-r from-primary to-secondary text-white border-transparent'
                : 'bg-card border-border-subtle text-text hover:border-primary/40'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {loadingAdvice && (
        <div className="flex items-center gap-2 text-sm text-muted py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Scoring colors against your artwork…
        </div>
      )}

      {!loadingAdvice && rankedColors.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {rankedColors.map(({ color, advice: a }) => {
            const isPrimary = primaryColor === color.id
            const isExtra = extraColors.includes(color.id)
            const poor = a?.grade === 'poor'
            return (
              <div
                key={color.id}
                title={a?.reason ?? ''}
                className={`rounded-xl border p-3 flex flex-col gap-2 ${
                  isPrimary ? 'border-primary ring-2 ring-primary/40' : 'border-border-subtle'
                } ${poor ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full border border-border-subtle shrink-0" style={{ backgroundColor: color.hex }} />
                  <span className="text-sm font-medium text-text truncate">{color.label}</span>
                  {a && (
                    <span className={`ml-auto text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${GRADE_STYLE[a.grade]}`}>
                      {a.grade}
                    </span>
                  )}
                </div>
                {a?.reason && <p className="text-[11px] text-muted leading-snug">{a.reason}</p>}
                <div className="flex items-center gap-3 mt-auto pt-1">
                  <label className="inline-flex items-center gap-1.5 text-xs text-text cursor-pointer">
                    <input
                      type="radio"
                      name="primary-color"
                      checked={isPrimary}
                      onChange={() => {
                        setPrimaryColor(color.id)
                        setExtraColors((prev) => prev.filter((c) => c !== color.id))
                      }}
                    />
                    Primary
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-text cursor-pointer">
                    <input type="checkbox" checked={isExtra} disabled={isPrimary} onChange={() => toggleExtra(color.id)} />
                    Extra
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <InlineError message={error} />

      <div className="mt-6">
        <ApproveButton onClick={handleApprove} disabled={!primaryColor || approving} busy={approving}>
          {approving ? 'Approving…' : 'Approve garment & colors'}
        </ApproveButton>
      </div>
    </StepCard>
  )
}

export default GarmentStep
