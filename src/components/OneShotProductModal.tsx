// One-shot AI product generation modal.
//
// Opens from the AdminAIProductBuilder page as a fast lane: type a prompt,
// click Generate, get a single GPT Image 2 design wrapped with the DTF-shirt
// system constraints. Skips the multi-model fan-out, SerpAPI search, and
// GPT prompt normalization that the main wizard uses — designed for "I know
// what I want, just make it" cases.
//
// On success, creates a draft `products` row and returns the new product id +
// image URL. Admin can either jump straight to editing the product or keep
// generating more 1-shots in the same session.
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Sparkles, Loader2, ArrowRight, Wand2, RefreshCw, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PRODUCT_STYLE_OPTIONS } from '../utils/product-style-options'

interface OneShotProductModalProps {
  open: boolean
  onClose: () => void
}

interface OneShotResult {
  id: string
  name: string
  slug: string
  image_url: string
}

const PRODUCT_TYPES = [
  { id: 'tshirt', label: 'T-Shirt' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'longsleeve', label: 'Long Sleeve' },
  { id: 'tank', label: 'Tank Top' },
] as const

const SHIRT_COLORS = [
  { id: 'black', label: 'Black', hex: '#000000' },
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'navy', label: 'Navy', hex: '#1E3A5F' },
  { id: 'grey', label: 'Heather Grey', hex: '#9CA3AF' },
] as const

export const OneShotProductModal: React.FC<OneShotProductModalProps> = ({ open, onClose }) => {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [productType, setProductType] = useState<typeof PRODUCT_TYPES[number]['id']>('tshirt')
  const [shirtColor, setShirtColor] = useState<typeof SHIRT_COLORS[number]['id']>('black')
  // No default style — empty means base DTF constraints only.
  const [style, setStyle] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<OneShotResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const handleGenerate = async () => {
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError('Describe your design in at least a few words.')
      return
    }
    setError(null)
    setResult(null)
    setIsGenerating(true)

    // Tick a "elapsed" counter so the spinner shows progress feedback.
    const start = Date.now()
    setElapsed(0)
    const tick = window.setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/admin/products/ai/one-shot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompt: prompt.trim(), productType, shirtColor, style: style || undefined }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Generation failed')
      setResult(data.product)
    } catch (err: any) {
      setError(err?.message ?? 'Generation failed')
    } finally {
      window.clearInterval(tick)
      setIsGenerating(false)
    }
  }

  const handleEditProduct = () => {
    if (!result) return
    onClose()
    navigate(`/admin/dashboard?product=${result.id}`)
  }

  const handleAnother = () => {
    setResult(null)
    setError(null)
    setPrompt('')
  }

  const close = () => {
    if (isGenerating) return
    setPrompt('')
    setResult(null)
    setError(null)
    setStyle('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={close}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-2xl bg-card border border-primary/30 rounded-2xl shadow-[0_0_60px_rgba(168,85,247,0.4)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-primary/10 via-secondary/10 to-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text">1-Shot Product</h2>
              <p className="text-xs text-muted">GPT Image 2 (OpenAI direct) · DTF print-ready</p>
            </div>
          </div>
          <button
            onClick={close}
            disabled={isGenerating}
            aria-label="Close"
            className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {!result && (
            <>
              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Describe your design
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isGenerating}
                  rows={3}
                  placeholder="A wolf howling at a neon moon, retro 80s synthwave style..."
                  className="w-full bg-bg/60 border border-white/10 rounded-xl px-4 py-3 text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all resize-none disabled:opacity-60"
                />
                <p className="text-xs text-muted mt-1.5">
                  Tip: skip "on a t-shirt" — the system already knows. Describe the design itself.
                </p>
              </div>

              {/* Style picker. "None" leaves base DTF constraints only; the
                  rest add a style suffix to the system prompt. Image previews
                  reuse the cached Flux samples so the picker shows EXACTLY
                  what each style looks like in production. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-text">Art Style</label>
                  {style && (
                    <button
                      type="button"
                      onClick={() => setStyle('')}
                      className="text-[11px] text-muted hover:text-text underline-offset-2 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PRODUCT_STYLE_OPTIONS.map((s) => {
                    const isSelected = style === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyle(isSelected ? '' : s.id)}
                        disabled={isGenerating}
                        title={s.hint}
                        aria-label={`${s.label} — ${s.hint}`}
                        className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-primary ring-2 ring-primary/40 shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                            : 'border-white/10 hover:border-primary/50'
                        } disabled:opacity-50`}
                      >
                        {s.previewUrl ? (
                          <img
                            src={s.previewUrl}
                            alt={`${s.label} preview`}
                            loading="lazy"
                            className="w-full aspect-square object-cover"
                          />
                        ) : (
                          <div className="w-full aspect-square bg-gradient-to-br from-white/5 to-white/10 flex items-center justify-center text-2xl">
                            {s.emoji}
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-1.5 py-1 flex items-center gap-1">
                          <span className="text-xs">{s.emoji}</span>
                          <span className="text-[10px] font-semibold text-white truncate">{s.label}</span>
                        </div>
                        {isSelected && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow-lg">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text mb-2">Product Type</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PRODUCT_TYPES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setProductType(t.id)}
                        disabled={isGenerating}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                          productType === t.id
                            ? 'border-primary bg-primary/15 text-text'
                            : 'border-white/10 bg-white/5 text-muted hover:border-primary/50 hover:text-text'
                        } disabled:opacity-50`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text mb-2">Shirt Color (contrast hint)</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SHIRT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setShirtColor(c.id)}
                        disabled={isGenerating}
                        title={c.label}
                        aria-label={c.label}
                        className={`h-9 rounded-lg border-2 transition-all ${
                          shirtColor === c.id
                            ? 'border-primary ring-2 ring-primary/30'
                            : 'border-white/10 hover:border-primary/50'
                        } disabled:opacity-50`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={isGenerating || prompt.trim().length < 3}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_25px_rgba(168,85,247,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating… {elapsed}s
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate 1-Shot
                  </>
                )}
              </button>
              <p className="text-[11px] text-center text-muted">
                One image, ~15–30s, no fan-out. Admin can edit the saved draft afterward.
              </p>
            </>
          )}

          {result && (
            <>
              <div className="aspect-square w-full rounded-xl overflow-hidden bg-bg/60 border border-white/10">
                <img
                  src={result.image_url}
                  alt={result.name}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-text truncate">{result.name}</p>
                <p className="text-xs text-muted">Saved as draft · /products/{result.slug}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleAnother}
                  className="py-2.5 rounded-xl font-semibold text-sm border border-white/10 bg-white/5 text-text hover:border-primary/50 transition-all flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  Generate another
                </button>
                <button
                  onClick={handleEditProduct}
                  className="py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] transition-all flex items-center justify-center gap-1.5"
                >
                  Edit product
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default OneShotProductModal
