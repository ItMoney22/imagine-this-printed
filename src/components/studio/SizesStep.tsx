// Step 3 (metal) — Sizes: the metal-print analogue of Garment & Colors.
// Design doc §14: "Garments step becomes Sizes for metal: two big tiles 4x6
// and 8x10 both on by default, prices from the shared module." Approving
// calls POST /:id/step/sizes, which stamps approvals.garments — the same
// approval string the garment flow's Garments step stamps, so the rest of
// the reducer's gating (canReachStep('mockups')) needs no metal branch.
import React, { useState } from 'react'
import { stepFlow } from '../../lib/api'
import { METAL_ADDONS, METAL_ART_PRICES, STUDIO_SIZE_KEYS, type MetalArtSizeKey } from '../../../backend/shared/metal-art'
import type { StepFlowAction, StepFlowState } from './stepFlowReducer'
import { ApproveButton, InlineError, StepCard } from './shared'

const SIZE_LABEL: Record<MetalArtSizeKey, string> = {
  '4x6': '4 × 6"',
  '8x10': '8 × 10"',
  '8x11': '8 × 11"',
}

const SIZE_BLURB: Record<MetalArtSizeKey, string> = {
  '4x6': 'Postcard-sized — a small desk or shelf accent.',
  '8x10': 'Letter-paper-sized — shelf piece or a small wall accent.',
  '8x11': 'Letter-paper-sized — shelf piece or a small wall accent.',
}

const ADDON_NOTE = `Add-ons (${Object.values(METAL_ADDONS)
  .map((a) => a.label)
  .join(', ')}) are offered at checkout.`

interface SizesStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const SizesStep: React.FC<SizesStepProps> = ({ state, refresh }) => {
  const [sizes, setSizes] = useState<MetalArtSizeKey[]>(
    (state.stepFlow?.sizes as MetalArtSizeKey[] | undefined)?.length
      ? (state.stepFlow!.sizes as MetalArtSizeKey[])
      : [...STUDIO_SIZE_KEYS]
  )
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleSize = (key: MetalArtSizeKey) => {
    setSizes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const handleApprove = async () => {
    if (!state.productId || sizes.length === 0) return
    setError(null)
    setApproving(true)
    try {
      await stepFlow.sizes(state.productId, sizes)
      await refresh({ advance: true })
    } catch (err: any) {
      setError(err?.message || 'Failed to approve sizes')
    } finally {
      setApproving(false)
    }
  }

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">Sizes</h2>
      <p className="text-sm text-muted mb-4">Pick the sizes this metal print ships in — at least one is required.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {STUDIO_SIZE_KEYS.map((key) => {
          const selected = sizes.includes(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleSize(key)}
              aria-pressed={selected}
              className={`text-left rounded-2xl border p-5 transition-colors ${
                selected
                  ? 'border-primary ring-2 ring-primary/40 bg-primary/5'
                  : 'border-border-subtle bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold text-text">{SIZE_LABEL[key]}</span>
                <span className="text-base font-semibold text-primary">${METAL_ART_PRICES[key].toFixed(2)}</span>
              </div>
              <p className="text-xs text-muted mt-1">{SIZE_BLURB[key]}</p>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-muted mt-4">{ADDON_NOTE}</p>

      <InlineError message={error} />

      <div className="mt-6">
        <ApproveButton onClick={handleApprove} disabled={sizes.length === 0 || approving} busy={approving}>
          {approving ? 'Approving…' : 'Approve sizes'}
        </ApproveButton>
      </div>
    </StepCard>
  )
}

export default SizesStep
