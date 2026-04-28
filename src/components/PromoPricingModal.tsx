// Bulk promo-pricing modal for admins.
//
// Lets admin pick a list of products (filtered by category / search) and
// either (a) set them all to a flat promo price OR (b) clear active promos.
// The actual storage trick: backend overwrites `products.price` and stashes
// the original at `metadata.original_price`, so cart/checkout/payment-intent
// flows pick up the discount with zero plumbing changes. Frontend display
// reads `metadata.original_price` to render the strikethrough + percent-off
// badge (see src/utils/product-promo.ts).
import React, { useEffect, useMemo, useState } from 'react'
import { X, Tag, Check, Search, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Slim row shape — we only fetch what the modal renders, not the full
// `Product` type. Casting to `Product` would lie (description/inStock not
// included) and the strict tsc -b that Vercel runs catches that.
interface PromoProductRow {
  id: string
  name: string
  price: number
  category: string | null
  status: string | null
  is_active: boolean | null
  images: string[] | null
  metadata: Record<string, any> | null
}

interface PromoPricingModalProps {
  open: boolean
  onClose: () => void
  /** Called after a successful apply/clear so the parent can reload product list. */
  onApplied?: () => void
}

const MAX_BULK = 200
const DEFAULT_PROMO = 15

export const PromoPricingModal: React.FC<PromoPricingModalProps> = ({ open, onClose, onApplied }) => {
  const [products, setProducts] = useState<PromoProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [onlyActive, setOnlyActive] = useState(true) // skip drafts/disabled
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [promoPrice, setPromoPrice] = useState<number>(DEFAULT_PROMO)
  const [submitting, setSubmitting] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErrorMessage(null)
    setResultMessage(null)
    ;(async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, category, status, is_active, images, metadata')
        .order('created_at', { ascending: false })
        .limit(500)
      if (cancelled) return
      if (error) {
        setErrorMessage(error.message)
        setProducts([])
      } else {
        setProducts((data ?? []) as PromoProductRow[])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return ['all', ...Array.from(set).sort()]
  }, [products])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (onlyActive) {
        if (p.status === 'draft' || p.status === 'archived') return false
        if (p.is_active === false) return false
      }
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
      if (q && !p.name?.toLowerCase().includes(q)) return false
      return true
    })
  }, [products, search, categoryFilter, onlyActive])

  const onPromoCount = useMemo(
    () => visible.filter((p) => typeof p.metadata?.original_price === 'number' && (p.metadata.original_price as number) > p.price).length,
    [visible]
  )

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const p of visible) next.delete(p.id)
      } else {
        for (const p of visible) next.add(p.id)
      }
      return next
    })

  const submit = async (action: 'apply' | 'clear') => {
    setErrorMessage(null)
    setResultMessage(null)
    if (selected.size === 0) {
      setErrorMessage('Select at least one product first.')
      return
    }
    if (selected.size > MAX_BULK) {
      setErrorMessage(`Max ${MAX_BULK} products per bulk request — narrow the selection.`)
      return
    }
    if (action === 'apply' && (!Number.isFinite(promoPrice) || promoPrice <= 0)) {
      setErrorMessage('Promo price must be a positive number.')
      return
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const apiBase = (import.meta as any).env?.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/admin/products/ai/promo/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          productIds: Array.from(selected),
          ...(action === 'apply' ? { promoPrice } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Request failed')

      const summary =
        action === 'apply'
          ? `Set $${promoPrice.toFixed(2)} promo on ${data.applied} product${data.applied === 1 ? '' : 's'}` +
            (data.skipped > 0 ? ` (${data.skipped} already at this price)` : '') +
            (data.errors?.length ? ` — ${data.errors.length} failed` : '')
          : `Cleared promos on ${data.cleared} product${data.cleared === 1 ? '' : 's'}` +
            (data.skipped > 0 ? ` (${data.skipped} weren't on promo)` : '') +
            (data.errors?.length ? ` — ${data.errors.length} failed` : '')
      setResultMessage(summary)

      // Refresh the in-modal product list so the metadata badges reflect the
      // new state without a full page reload.
      const { data: refreshed } = await supabase
        .from('products')
        .select('id, name, price, category, status, is_active, images, metadata')
        .order('created_at', { ascending: false })
        .limit(500)
      setProducts((refreshed ?? []) as PromoProductRow[])
      setSelected(new Set())
      onApplied?.()
    } catch (err: any) {
      setErrorMessage(err?.message ?? 'Promo update failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => !submitting && onClose()}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col bg-card border border-amber-500/30 rounded-2xl shadow-[0_0_60px_rgba(245,158,11,0.3)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
              <Tag className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text">Promo Pricing</h2>
              <p className="text-xs text-muted">Set a flat promo price across selected products. % off renders automatically.</p>
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            aria-label="Close"
            className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-white/10 grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full pl-9 pr-3 py-2 bg-bg/60 border border-white/10 rounded-lg text-sm text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-bg/60 border border-white/10 rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-xs text-text px-3 py-2 bg-bg/60 border border-white/10 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
              className="rounded"
            />
            Active only
          </label>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2 border-b border-white/10 flex items-center justify-between text-xs">
          <div className="text-muted">
            {visible.length} match{visible.length === 1 ? '' : 'es'} · {selected.size} selected
            {onPromoCount > 0 && (
              <span className="ml-2 text-amber-400">
                · {onPromoCount} currently on promo
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={toggleAllVisible}
            disabled={visible.length === 0 || submitting}
            className="text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50"
          >
            {allVisibleSelected ? 'Deselect all visible' : `Select all ${visible.length} visible`}
          </button>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading products…
            </div>
          ) : visible.length === 0 ? (
            <p className="text-center text-muted text-sm py-6">No products match your filters.</p>
          ) : (
            <div className="space-y-1.5">
              {visible.map((p) => {
                const isSelected = selected.has(p.id)
                const original = p.metadata?.original_price as number | undefined
                const onPromo = typeof original === 'number' && original > p.price
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleOne(p.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
                      isSelected
                        ? 'bg-amber-500/10 border border-amber-500/40'
                        : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/10'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'bg-amber-500 border-amber-500' : 'border-white/30'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {p.images?.[0] && (
                      <img src={p.images[0]} alt={p.name} className="w-9 h-9 rounded object-cover bg-bg/40" loading="lazy" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">{p.name}</p>
                      <p className="text-[11px] text-muted">{p.category ?? 'uncategorized'}</p>
                    </div>
                    <div className="text-right text-xs">
                      {onPromo && (
                        <span className="text-muted line-through mr-1">${original!.toFixed(2)}</span>
                      )}
                      <span className={`font-bold ${onPromo ? 'text-amber-400' : 'text-text'}`}>
                        ${p.price.toFixed(2)}
                      </span>
                      {onPromo && (
                        <div className="text-[10px] text-amber-400 font-bold">
                          {Math.round((((original as number) - p.price) / (original as number)) * 100)}% OFF
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 space-y-3 shrink-0">
          {(resultMessage || errorMessage) && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                errorMessage
                  ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                  : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              }`}
            >
              {errorMessage ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{errorMessage ?? resultMessage}</span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted">Promo price</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={promoPrice}
                onChange={(e) => setPromoPrice(parseFloat(e.target.value))}
                disabled={submitting}
                className="w-24 pl-6 pr-2 py-2 bg-bg/60 border border-white/10 rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
            <button
              type="button"
              onClick={() => submit('apply')}
              disabled={submitting || selected.size === 0}
              className="ml-auto px-4 py-2 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:shadow-[0_0_20px_rgba(245,158,11,0.5)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
              Apply ${promoPrice.toFixed(2)} to {selected.size}
            </button>
            <button
              type="button"
              onClick={() => submit('clear')}
              disabled={submitting || selected.size === 0}
              className="px-3 py-2 rounded-xl font-semibold text-xs border border-white/10 text-muted hover:text-text hover:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Clear promos
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PromoPricingModal
