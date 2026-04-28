// Bulk AI product generation modal.
//
// Same DTF-shirt 1-shot pipeline, fanned out across N prompts in parallel
// (concurrency-limited server-side to 5). Admin types one design idea per
// line, picks product type + shirt color, hits Generate. Results come back
// as a grid — each successful row has its own draft `products` entry the
// admin can keep or trash. Failed rows show the error so the admin can
// retry just those.
//
// Companion to OneShotProductModal (for single-prompt fast lane).
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Sparkles, Loader2, Wand2, Trash2, ExternalLink, AlertCircle, RefreshCw, Lightbulb, Plus, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PRODUCT_STYLE_OPTIONS } from '../utils/product-style-options'
import { BULK_DESIGN_SUGGESTIONS } from '../utils/bulk-design-suggestions'

const MAX_PROMPTS = 20
const ITC_PER_DESIGN = 1 // display estimate; backend handles actual cost

interface BulkProductModalProps {
  open: boolean
  onClose: () => void
}

interface BulkOk {
  ok: true
  prompt: string
  product: { id: string; name: string; slug: string; image_url: string }
}
interface BulkFail {
  ok: false
  prompt: string
  error: string
}
type BulkResult = BulkOk | BulkFail

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

export const BulkProductModal: React.FC<BulkProductModalProps> = ({ open, onClose }) => {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [productType, setProductType] = useState<typeof PRODUCT_TYPES[number]['id']>('tshirt')
  const [shirtColor, setShirtColor] = useState<typeof SHIRT_COLORS[number]['id']>('black')
  const [style, setStyle] = useState<string>('')
  // Default the suggestions panel open the first time — admins discover the
  // feature faster, and once they paste their own list they can collapse it.
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string>(BULK_DESIGN_SUGGESTIONS[0]?.id ?? 'animals')
  const [isGenerating, setIsGenerating] = useState(false)
  const [results, setResults] = useState<BulkResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  // Track which result rows the admin already deleted (deletes are server
  // calls but we hide them locally too so the grid updates immediately).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())

  // Parse the textarea — one prompt per line, ignore blanks, strip leading
  // dashes/numbers ("1. wolf design" → "wolf design") so paste-from-list
  // workflows feel natural.
  const parsedPrompts = useMemo(() => {
    return text
      .split('\n')
      .map((l) => l.replace(/^\s*[-*•]\s*|\s*\d+[.)]\s*/, '').trim())
      .filter((l) => l.length >= 3)
  }, [text])

  const overLimit = parsedPrompts.length > MAX_PROMPTS

  const handleGenerate = async () => {
    if (parsedPrompts.length === 0) {
      setError('Add at least one design idea (one per line).')
      return
    }
    if (overLimit) {
      setError(`Max ${MAX_PROMPTS} prompts per bulk run. Trim the list and try again.`)
      return
    }
    setError(null)
    setResults(null)
    setHiddenIds(new Set())
    setIsGenerating(true)

    const start = Date.now()
    setElapsed(0)
    const tick = window.setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/admin/products/ai/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompts: parsedPrompts, productType, shirtColor, style: style || undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Bulk generation failed')
      setResults(data.results as BulkResult[])
    } catch (err: any) {
      setError(err?.message ?? 'Bulk generation failed')
    } finally {
      window.clearInterval(tick)
      setIsGenerating(false)
    }
  }

  // Delete a draft product row. The backend already saved every successful
  // result as a `draft`, so "discard" is a real DELETE — not just a UI hide.
  const handleDiscard = async (productId: string) => {
    if (!confirm('Discard this design? This deletes the draft product.')) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const apiBase = import.meta.env.VITE_API_BASE || ''
      await fetch(`${apiBase}/api/admin/products/ai/${productId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
    } catch (err) {
      console.error('[BulkProductModal] discard failed:', err)
      // Still hide locally so the admin doesn't see it again
    }
    setHiddenIds((prev) => new Set(prev).add(productId))
  }

  const handleEdit = (productId: string) => {
    onClose()
    navigate(`/admin/dashboard?product=${productId}`)
  }

  const reset = () => {
    setText('')
    setResults(null)
    setError(null)
    setHiddenIds(new Set())
    setStyle('')
  }

  // Append a suggestion as a new line, deduplicating against what's already
  // in the textarea (case-insensitive). If the textarea is empty, no leading
  // newline; otherwise add one so prompts stack cleanly.
  const addSuggestion = (suggestion: string) => {
    const existing = text
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean)
    if (existing.includes(suggestion.toLowerCase())) return
    setText((prev) => (prev.trim().length === 0 ? suggestion : `${prev.replace(/\s+$/, '')}\n${suggestion}`))
  }

  const addAllInCategory = (categoryId: string) => {
    const cat = BULK_DESIGN_SUGGESTIONS.find((c) => c.id === categoryId)
    if (!cat) return
    // Dedup vs current contents AND cap at MAX_PROMPTS.
    const existing = new Set(
      text.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean)
    )
    const fresh = cat.prompts.filter((p) => !existing.has(p.toLowerCase()))
    const room = Math.max(0, MAX_PROMPTS - existing.size)
    const toAdd = fresh.slice(0, room)
    if (toAdd.length === 0) return
    const joined = toAdd.join('\n')
    setText((prev) => (prev.trim().length === 0 ? joined : `${prev.replace(/\s+$/, '')}\n${joined}`))
  }

  // Tracks which suggestions are already in the textarea — for the green
  // checkmark on the chip and to disable re-adds.
  const promptsAlreadyAdded = useMemo(() => {
    const set = new Set<string>()
    text.split('\n').forEach((l) => {
      const trimmed = l.trim().toLowerCase()
      if (trimmed) set.add(trimmed)
    })
    return set
  }, [text])

  const close = () => {
    if (isGenerating) return
    reset()
    onClose()
  }

  if (!open) return null

  const visibleSuccesses = results
    ? results.filter((r): r is BulkOk => r.ok && !hiddenIds.has(r.product.id))
    : []
  const failures = results ? results.filter((r): r is BulkFail => !r.ok) : []

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={close}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      <div
        className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col bg-card border border-primary/30 rounded-2xl shadow-[0_0_60px_rgba(168,85,247,0.4)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-primary/10 via-secondary/10 to-primary/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text">Bulk Product Generation</h2>
              <p className="text-xs text-muted">Imagen 4 Ultra · DTF · up to {MAX_PROMPTS} designs in parallel</p>
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
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!results && (
            <>
              <div>
                <label className="flex items-center justify-between text-sm font-semibold text-text mb-2">
                  <span>Design ideas — one per line</span>
                  <span className={`text-xs ${overLimit ? 'text-red-400' : 'text-muted'}`}>
                    {parsedPrompts.length} / {MAX_PROMPTS}
                  </span>
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={isGenerating}
                  rows={8}
                  placeholder={`A wolf howling at a neon moon, retro 80s synthwave\nA skull with roses, traditional tattoo style\nA vintage muscle car silhouette at sunset\nA cosmic astronaut riding a whale through stars\n...`}
                  className="w-full bg-bg/60 border border-white/10 rounded-xl px-4 py-3 text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all resize-y font-mono text-sm leading-relaxed disabled:opacity-60"
                />
                <p className="text-xs text-muted mt-1.5">
                  Numbers / dashes are stripped automatically — paste a list straight from a doc.
                </p>
              </div>

              {/* Suggestions panel — pre-built design ideas grouped by theme.
                  Click a chip to add it to the textarea (deduped) or "Add all"
                  to append the whole category. Capped at MAX_PROMPTS so a
                  one-click "Add all" can't blow past the limit. */}
              <div className="border border-white/10 rounded-xl bg-bg/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSuggestionsOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-text">
                    <Lightbulb className="w-4 h-4 text-amber-300" />
                    Browse design ideas
                    <span className="text-[10px] font-normal text-muted">
                      ({BULK_DESIGN_SUGGESTIONS.reduce((sum, c) => sum + c.prompts.length, 0)} prompts across {BULK_DESIGN_SUGGESTIONS.length} categories)
                    </span>
                  </span>
                  <span className="text-xs text-muted">{suggestionsOpen ? '−' : '+'}</span>
                </button>
                {suggestionsOpen && (
                  <div className="border-t border-white/10">
                    {/* Category tabs */}
                    <div className="flex flex-wrap gap-1 px-3 pt-3">
                      {BULK_DESIGN_SUGGESTIONS.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setActiveCategory(cat.id)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                            activeCategory === cat.id
                              ? 'bg-primary/20 text-text border border-primary/40'
                              : 'bg-white/5 text-muted border border-transparent hover:text-text hover:bg-white/10'
                          }`}
                        >
                          <span className="mr-1">{cat.emoji}</span>
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    {/* Active category prompts */}
                    {(() => {
                      const cat = BULK_DESIGN_SUGGESTIONS.find((c) => c.id === activeCategory)
                      if (!cat) return null
                      return (
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-muted">
                              {cat.prompts.length} ideas in {cat.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => addAllInCategory(cat.id)}
                              disabled={isGenerating}
                              className="text-[11px] font-semibold text-primary hover:text-text transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              <Plus className="w-3 h-3" />
                              Add all (caps at {MAX_PROMPTS})
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {cat.prompts.map((p) => {
                              const added = promptsAlreadyAdded.has(p.toLowerCase())
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => addSuggestion(p)}
                                  disabled={isGenerating || added}
                                  title={added ? 'Already in your list' : 'Click to add'}
                                  className={`text-left px-2.5 py-1.5 rounded-md text-[12px] leading-snug transition-colors flex items-start gap-1.5 ${
                                    added
                                      ? 'bg-emerald-500/10 text-emerald-200/90 border border-emerald-500/30'
                                      : 'bg-white/5 hover:bg-primary/10 hover:border-primary/40 text-text/90 border border-white/10 hover:text-text'
                                  } disabled:cursor-default`}
                                >
                                  {added ? <Check className="w-3 h-3 mt-0.5 shrink-0 text-emerald-300" /> : <Plus className="w-3 h-3 mt-0.5 shrink-0 text-muted" />}
                                  <span className="flex-1">{p}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Style picker — applied to ALL prompts in the bulk run. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-text">Art Style (applied to all)</label>
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
                <div className="flex flex-wrap gap-1.5">
                  {PRODUCT_STYLE_OPTIONS.map((s) => {
                    const isSelected = style === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyle(isSelected ? '' : s.id)}
                        disabled={isGenerating}
                        title={s.hint}
                        className={`px-2.5 py-1.5 rounded-lg border-2 text-[11px] font-semibold flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/15 text-text shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                            : 'border-white/10 bg-white/5 text-muted hover:border-primary/50 hover:text-text'
                        } disabled:opacity-50`}
                      >
                        <span>{s.emoji}</span>
                        {s.label}
                        {isSelected && <Check className="w-3 h-3" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text mb-2">Product Type (applied to all)</label>
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
                  <label className="block text-xs font-semibold text-text mb-2">Shirt Color (applied to all)</label>
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
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/5">
                <div className="text-xs text-muted">
                  Estimated:{' '}
                  <span className="text-text font-semibold">
                    {parsedPrompts.length} design{parsedPrompts.length === 1 ? '' : 's'}
                  </span>
                  {parsedPrompts.length > 0 && (
                    <> · ~{Math.ceil(parsedPrompts.length / 5) * 30}s wallclock</>
                  )}
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || parsedPrompts.length === 0 || overLimit}
                  className="py-2.5 px-6 rounded-xl font-bold text-white bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_25px_rgba(168,85,247,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating… {elapsed}s
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate {parsedPrompts.length || ''}
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {results && (
            <>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-text font-semibold">
                    {visibleSuccesses.length} succeeded
                  </span>
                  {failures.length > 0 && (
                    <span className="text-amber-400">
                      {failures.length} failed
                    </span>
                  )}
                </div>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  New batch
                </button>
              </div>

              {visibleSuccesses.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {visibleSuccesses.map((r) => (
                    <div
                      key={r.product.id}
                      className="group relative bg-bg/60 border border-white/10 rounded-xl overflow-hidden hover:border-primary/50 transition-all"
                    >
                      <img
                        src={r.product.image_url}
                        alt={r.product.name}
                        className="w-full aspect-square object-contain bg-bg/40"
                        loading="lazy"
                      />
                      <div className="p-2.5 space-y-2">
                        <p className="text-xs font-semibold text-text truncate" title={r.product.name}>
                          {r.product.name}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleEdit(r.product.id)}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-semibold transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDiscard(r.product.id)}
                            className="px-2 py-1.5 rounded-md bg-white/5 hover:bg-red-500/20 text-muted hover:text-red-300 transition-colors"
                            aria-label="Discard"
                            title="Delete this draft"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {failures.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Failed prompts (paste back into a fresh batch to retry)
                  </p>
                  {failures.map((r, i) => (
                    <div key={i} className="text-xs bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                      <p className="text-text/80 truncate">{r.prompt}</p>
                      <p className="text-amber-300/80 mt-0.5">{r.error}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default BulkProductModal
