// Promotions section for the Listing step — two independent promo mechanisms
// that already exist elsewhere in the app, surfaced here so an admin doesn't
// have to leave the step flow to run them:
//
//  1. Bundle deal (BUNDLE_DEAL, e.g. "2 for $25") — eligibility is a flag,
//     `metadata.isThreeForTwentyFive` (see CartContext.tsx's calculateTotal,
//     which reads `product.isThreeForTwentyFive || product.metadata?.isThreeForTwentyFive`
//     to decide which cart lines get bundle pricing at checkout). There is no
//     dedicated API route for this single flag — AdminDashboard's product
//     list toggles it with a direct `products` table update, so this does
//     the same thing.
//  2. Flat sale price (strike-through badge) — POST
//     /api/admin/products/ai/promo/bulk, which stashes the pre-promo price at
//     `metadata.original_price` and overwrites `price`. Display everywhere
//     else reads that back via `src/utils/product-promo.ts`'s `getPromoBadge`.
import React, { useState } from 'react'
import { Percent, Tag } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getPromoBadge } from '../../utils/product-promo'
import { BUNDLE_DEAL, isBundleEligible } from '../../../backend/shared/promos'
import type { StepFlowProductSnapshot } from '../../lib/api'
import { BusyDot, InlineError, SecondaryButton } from './shared'

interface PromoPickerProps {
  product: StepFlowProductSnapshot
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const PromoPicker: React.FC<PromoPickerProps> = ({ product, refresh }) => {
  const [bundleBusy, setBundleBusy] = useState(false)
  const [salePrice, setSalePrice] = useState('')
  const [applying, setApplying] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bundleOn = isBundleEligible(product)
  // getPromoBadge wants { price: number; metadata? }, but the step-flow
  // product snapshot only guarantees `price` via its index signature — pull
  // it out explicitly rather than widening the whole prop with `as any`.
  const badge = getPromoBadge({ price: typeof product.price === 'number' ? product.price : 0, metadata: product.metadata })
  // The price a new sale should be discounted from — the true pre-promo
  // price when one is already active, otherwise the live price.
  const baselinePrice = badge?.originalPrice ?? (typeof product.price === 'number' ? product.price : 0)

  const parsedSale = Number(salePrice)
  const hasValidSale = salePrice.trim() !== '' && Number.isFinite(parsedSale) && parsedSale > 0
  const previewPercentOff =
    hasValidSale && baselinePrice > 0 && parsedSale < baselinePrice
      ? Math.round(((baselinePrice - parsedSale) / baselinePrice) * 100)
      : null

  const authedPromoRequest = async (body: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const apiBase = (import.meta as any).env?.VITE_API_BASE || ''
    const response = await fetch(`${apiBase}/api/admin/products/ai/promo/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error((json as any)?.error || `HTTP ${response.status}`)
    return json
  }

  const toggleBundle = async () => {
    setError(null)
    setBundleBusy(true)
    try {
      const nextMetadata = { ...(product.metadata || {}), isThreeForTwentyFive: !bundleOn }
      const { error: updateError } = await supabase
        .from('products')
        .update({ metadata: nextMetadata })
        .eq('id', product.id)
      if (updateError) throw updateError
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to update the bundle deal')
    } finally {
      setBundleBusy(false)
    }
  }

  const applySale = async () => {
    setError(null)
    if (!hasValidSale) {
      setError('Enter a positive sale price.')
      return
    }
    setApplying(true)
    try {
      await authedPromoRequest({ action: 'apply', productIds: [product.id], promoPrice: parsedSale })
      setSalePrice('')
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to apply the sale price')
    } finally {
      setApplying(false)
    }
  }

  const clearSale = async () => {
    setError(null)
    setClearing(true)
    try {
      await authedPromoRequest({ action: 'clear', productIds: [product.id] })
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to clear the sale price')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="border-t border-border-subtle pt-3 space-y-2.5">
      <label className="text-[10px] uppercase tracking-wide text-muted block">Promotions</label>

      <div className="flex items-center justify-between gap-3 bg-card-elevated rounded-lg px-3 py-2.5">
        <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
          <input
            type="checkbox"
            checked={bundleOn}
            onChange={toggleBundle}
            disabled={bundleBusy}
            className="w-4 h-4 accent-primary"
          />
          Include in {BUNDLE_DEAL.label}
        </label>
        {bundleBusy && <BusyDot className="w-2 h-2 text-primary" />}
      </div>

      <div className="bg-card-elevated rounded-lg px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-1.5 text-sm text-text">
          <Tag className="w-3.5 h-3.5 text-muted shrink-0" />
          <span>Sale price</span>
          {badge && (
            <span className="text-[11px] text-primary font-semibold ml-auto">
              -{badge.percentOff}% · was ${badge.originalPrice.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-[100px]">
            <label className="text-[10px] uppercase tracking-wide text-muted">Price $</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={baselinePrice > 0 ? baselinePrice.toFixed(2) : '0.00'}
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              className="w-full text-sm border border-border-subtle rounded-lg px-3 py-1.5 bg-bg text-text"
            />
          </div>
          <SecondaryButton onClick={applySale} disabled={applying || !hasValidSale}>
            {applying && <BusyDot className="w-2 h-2" />}
            Apply
          </SecondaryButton>
          <SecondaryButton onClick={clearSale} disabled={clearing || !badge}>
            {clearing && <BusyDot className="w-2 h-2" />}
            Clear
          </SecondaryButton>
        </div>
        {previewPercentOff != null && (
          <p className="text-[11px] text-muted flex items-center gap-1">
            <Percent className="w-3 h-3" />
            {previewPercentOff}% off preview — ${parsedSale.toFixed(2)}
          </p>
        )}
      </div>

      <InlineError message={error} />
    </div>
  )
}

export default PromoPicker
