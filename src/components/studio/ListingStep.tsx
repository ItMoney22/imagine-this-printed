// Step 5 — Listing: SEO copy from the composer, editable, next to a
// storefront-style preview built from the approved mockups.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { etsy, stepFlow } from '../../lib/api'
import { getShots, type ShotKey, type StepFlowAction, type StepFlowState } from './stepFlowReducer'
import { listingDraftFromPack, type EtsyComposePack, type ListingDraft } from './types'
import { ApproveButton, InlineError, SecondaryButton, StepCard } from './shared'

interface ListingStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

// Reading order for the preview gallery — mirrors product-gallery.ts's
// storefront ROLE_ORDER intent (hero mockup first, design last), built from
// the shots this admin actually approved rather than product_assets rows.
const PREVIEW_ORDER: (key: ShotKey) => number = (key) => {
  if (key === 'product') return 0
  if (key === 'hanger') return 1
  if (key === 'model') return 2
  if (key === 'details') return 3
  return 4 // color:<id> shots, in whatever order they come back
}

const ListingStep: React.FC<ListingStepProps> = ({ state, refresh }) => {
  const [draft, setDraft] = useState<ListingDraft | null>(null)
  const [tagsText, setTagsText] = useState('')
  const [composing, setComposing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const composedRef = useRef(false)

  const applyPack = (pack: EtsyComposePack) => {
    const d = listingDraftFromPack(pack)
    setDraft(d)
    setTagsText(d.tags.join(', '))
  }

  // `etsy.compose` is a paid LLM call — re-running it on every mount would
  // both cost money and wipe any hand-edits the admin already made. Seed
  // from the product's saved pack when one exists (e.g. resuming a draft, or
  // returning from a later step); only call the composer when there's
  // nothing to seed from. `Re-compose` below is the explicit escape hatch.
  useEffect(() => {
    if (!state.productId || composedRef.current) return
    composedRef.current = true
    const existingPack = state.product?.metadata?.etsy_pack as EtsyComposePack | undefined
    if (existingPack) {
      applyPack(existingPack)
      return
    }
    setComposing(true)
    etsy
      .compose(state.productId)
      .then(({ pack }) => applyPack(pack))
      .catch((err: any) => setError(err?.message || 'Failed to compose listing copy'))
      .finally(() => setComposing(false))
    // composedRef guards this to a single run; state.product is only read
    // once, at that first run, same pattern as the rest of this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.productId])

  const handleRecompose = async () => {
    if (!state.productId) return
    setError(null)
    setComposing(true)
    try {
      const { pack } = await etsy.compose(state.productId)
      applyPack(pack)
    } catch (err: any) {
      setError(err?.message || 'Failed to compose listing copy')
    } finally {
      setComposing(false)
    }
  }

  const previewImages = useMemo(() => {
    const shots = getShots(state)
    return (Object.entries(shots) as Array<[ShotKey, (typeof shots)[ShotKey]]>)
      .filter(([, s]) => s?.approved && s?.url)
      .sort((a, b) => PREVIEW_ORDER(a[0]) - PREVIEW_ORDER(b[0]))
      .map(([, s]) => s!.url as string)
    // Deliberately keyed on the three fields the merge actually reads, not
    // the whole `state` object — that would recompute on every idea/brief
    // keystroke too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stepFlow, state.assets, state.jobs])

  const handlePublish = async () => {
    if (!state.productId || !draft) return
    setError(null)
    setPublishing(true)
    try {
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      await stepFlow.publish(state.productId, { ...draft, tags })
      await refresh({ advance: true })
    } catch (err: any) {
      setError(err?.message || 'Failed to publish the listing')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <StepCard>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-xl font-bold text-text">Listing</h2>
        {draft && (
          <SecondaryButton onClick={handleRecompose} disabled={composing}>
            {composing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Re-compose
          </SecondaryButton>
        )}
      </div>
      <p className="text-sm text-muted mb-4">SEO copy is generated, then it's yours to edit before it goes live.</p>

      {composing && (
        <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Composing listing copy…
        </div>
      )}

      {draft && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted">
                Title <span className={draft.title.length > 140 ? 'text-red-400' : ''}>({draft.title.length}/140)</span>
              </label>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted">Tags, comma separated</label>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="w-full text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted">Description</label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={7}
                className="w-full text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted">Price $</label>
              <input
                type="number"
                step="0.01"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                className="w-28 text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted block mb-2">Storefront preview</label>
            {previewImages.length === 0 ? (
              <p className="text-xs text-muted">No approved mockups yet — go back to Mockups to approve at least one.</p>
            ) : (
              <div className="space-y-2">
                <div className="aspect-square bg-card-elevated rounded-xl overflow-hidden">
                  <img src={previewImages[0]} alt="Hero" className="w-full h-full object-contain" />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {previewImages.slice(1).map((url, i) => (
                    <div key={`${url}-${i}`} className="aspect-square bg-card-elevated rounded-lg overflow-hidden">
                      <img src={url} alt="" className="w-full h-full object-contain" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <InlineError message={error} />

      <div className="mt-6">
        <ApproveButton onClick={handlePublish} disabled={!draft || publishing} busy={publishing}>
          {publishing ? 'Publishing…' : 'Approve & publish'}
        </ApproveButton>
      </div>
    </StepCard>
  )
}

export default ListingStep
