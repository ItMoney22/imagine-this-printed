// Flare Lab — every GPT Image 2.5 Flare edit tool, with its guide beside it.
//
// Opens over Imagination Station on the active design (and inside Team Studio
// on the back art). Each run starts from `current`, and "Continue from this"
// moves `current` to a result, so edits chain the way the model works best:
// one change per run.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Sparkles,
  Wand2,
  Brush,
  Type,
  Layers,
  Copy,
  Scissors,
  Palette,
  Eraser,
  Paintbrush,
  ZoomIn,
  Check,
  Plus,
  ImagePlus,
  BookOpen,
  Info,
  Download,
  ArrowRight,
} from 'lucide-react'
import ProgressBar from '../../studio/ProgressBar'
import MaskPainter from './MaskPainter'
import { SpellingBadge } from './SpellingBadge'
import { FLARE_CAPABILITIES, FLARE_TOOLS, PROMPT_RULES, QUALITY_INFO, type FlareOp, type FlareQuality } from './flareGuide'
import { apiErrorMessage, flareApi, type FlareRunResult } from '../../../lib/api'

const TOOL_ICONS: Record<FlareOp, React.ComponentType<{ className?: string }>> = {
  edit: Wand2,
  inpaint: Brush,
  text: Type,
  blend: Layers,
  variations: Copy,
  transparent: Scissors,
  recolor: Palette,
  cleanup: Eraser,
  restyle: Paintbrush,
}

const QUALITIES: FlareQuality[] = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_PRICES: Record<FlareQuality, number> = { low: 10, medium: 20, high: 40, xhigh: 60, max: 90 }
const DEFAULT_SWATCHES = ['#7A1F2B', '#C9A96E', '#FFFFFF', '#000000']

export interface FlareLabProps {
  isOpen: boolean
  onClose: () => void
  imageUrl: string
  /** Admins run Flare free (house authoring). */
  isAdmin?: boolean
  initialOp?: FlareOp
  /** Replace the design being edited with a result. */
  onUse?: (url: string, label: string) => void
  /** Add results as new designs (variations). */
  onAddNew?: (urls: string[], label: string) => void
  /** Hand off to the station's print upscaler (recraft crisp upscale). */
  onUpscaleForPrint?: (url: string) => Promise<string | null>
  /** Limit the tool list (Team Studio shows only the art-prep tools). */
  tools?: FlareOp[]
  title?: string
}

interface RunState {
  startedAt: number
  expectedMs: number
  label: string
}

/** Shrink an uploaded reference so the request stays small. */
async function fileToDataUrl(file: File, maxEdge = 1536): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

const FlareLab: React.FC<FlareLabProps> = ({
  isOpen,
  onClose,
  imageUrl,
  isAdmin,
  initialOp = 'edit',
  onUse,
  onAddNew,
  onUpscaleForPrint,
  tools,
  title = 'Imagination Lab',
}) => {
  const toolList = useMemo(() => FLARE_TOOLS.filter((t) => !tools || tools.includes(t.op)), [tools])
  const [op, setOp] = useState<FlareOp>(initialOp)
  const guide = toolList.find((t) => t.op === op) ?? toolList[0]

  const [current, setCurrent] = useState(imageUrl)
  const [prompt, setPrompt] = useState('')
  const [textFrom, setTextFrom] = useState('')
  const [textTo, setTextTo] = useState('')
  const [colors, setColors] = useState<string[]>(DEFAULT_SWATCHES.slice(0, 2))
  const [refs, setRefs] = useState<string[]>([])
  const [mask, setMask] = useState<string | null>(null)
  const [quality, setQuality] = useState<FlareQuality>(guide?.defaultQuality ?? 'high')
  const [size, setSize] = useState<'standard' | 'large'>('standard')
  const [variations, setVariations] = useState(1)
  const [transparent, setTransparent] = useState(false)
  const [prices, setPrices] = useState<Record<string, number>>(DEFAULT_PRICES)
  const [run, setRun] = useState<RunState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<FlareRunResult | null>(null)
  const [showOverview, setShowOverview] = useState(false)
  const [upscaling, setUpscaling] = useState<RunState | null>(null)
  const refInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setCurrent(imageUrl)
    setResults(null)
    setError(null)
    flareApi
      .pricing()
      .then((p) => p?.perImage && setPrices(p.perImage))
      .catch(() => {})
  }, [isOpen, imageUrl])

  // Each tool starts from its own sensible defaults.
  useEffect(() => {
    if (!guide) return
    setQuality(guide.defaultQuality)
    setVariations(guide.op === 'variations' ? 3 : 1)
    setError(null)
  }, [guide])

  if (!isOpen || !guide) return null

  const cost = isAdmin ? 0 : Math.ceil((prices[quality] ?? DEFAULT_PRICES[quality]) * (size === 'large' ? 1.5 : 1) * variations)

  const needsPrompt = op === 'edit' || op === 'inpaint' || op === 'blend' || op === 'restyle'
  const ready =
    !run &&
    (!needsPrompt || prompt.trim().length > 0) &&
    (op !== 'inpaint' || !!mask) &&
    (op !== 'blend' || refs.length > 0) &&
    (op !== 'text' || !!(textFrom.trim() || textTo.trim())) &&
    (op !== 'recolor' || colors.length > 0)

  const go = async () => {
    setError(null)
    setResults(null)
    const expectedMs = QUALITY_INFO[quality].expectedMs * (size === 'large' ? 1.4 : 1) + (variations - 1) * 8000
    setRun({ startedAt: Date.now(), expectedMs, label: `${guide.name} · ${QUALITY_INFO[quality].label} quality on Imagination 5` })
    try {
      const out = await flareApi.run({
        op,
        imageUrl: current,
        prompt,
        refUrls: op === 'blend' ? refs : [],
        maskDataUrl: op === 'inpaint' ? mask : null,
        textFrom,
        textTo,
        colors,
        quality,
        size,
        variations,
        transparent,
      })
      setResults(out)
    } catch (err) {
      setError(apiErrorMessage(err, 'Imagination could not finish that'))
    } finally {
      setRun(null)
    }
  }

  const upscale = async (url: string) => {
    if (!onUpscaleForPrint) return
    setUpscaling({ startedAt: Date.now(), expectedMs: 30000, label: 'Upscaling for print (crisp upscale, alpha kept)' })
    try {
      const out = await onUpscaleForPrint(url)
      if (out) setCurrent(out)
    } finally {
      setUpscaling(null)
    }
  }

  const addRefs = async (files: FileList | null) => {
    if (!files) return
    const next = await Promise.all(Array.from(files).slice(0, 6 - refs.length).map((f) => fileToDataUrl(f)))
    setRefs((r) => [...r, ...next].slice(0, 6))
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-stretch justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-bg text-text w-full max-w-7xl sm:rounded-2xl border border-text/10 shadow-2xl flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-text/10 bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 via-fuchsia-500 to-violet-600 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg leading-tight truncate">{title}</h2>
              <p className="text-xs text-muted truncate">Imagination 5 · edits, masks, references, real text, true transparency</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOverview((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-text/10 text-sm hover:border-primary/40"
            >
              <BookOpen className="w-4 h-4" /> What Imagination can do
            </button>
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-text/5" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {showOverview && (
          <div className="px-4 sm:px-6 py-4 border-b border-text/10 bg-card/60">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {FLARE_CAPABILITIES.map((c) => (
                <div key={c.title} className="rounded-xl border border-text/10 bg-bg p-3">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="text-xs text-muted mt-1">{c.body}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted mt-3">
              <span className="font-semibold text-text">Golden rules:</span> {PROMPT_RULES.join(' · ')}
            </p>
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_1fr_360px] overflow-y-auto lg:overflow-hidden">
          {/* tools */}
          <nav className="border-b lg:border-b-0 lg:border-r border-text/10 p-2 lg:overflow-y-auto flex lg:flex-col gap-1 overflow-x-auto">
            {toolList.map((t) => {
              const Icon = TOOL_ICONS[t.op]
              const active = t.op === op
              return (
                <button
                  key={t.op}
                  type="button"
                  onClick={() => setOp(t.op)}
                  className={`shrink-0 text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition ${
                    active ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-text/5'
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-muted'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="hidden lg:block text-[11px] text-muted leading-snug">{t.tagline}</span>
                  </span>
                </button>
              )
            })}
            {onUpscaleForPrint && (
              <button
                type="button"
                onClick={() => upscale(current)}
                disabled={!!upscaling || !!run}
                className="shrink-0 text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-text/15 hover:border-primary/40 disabled:opacity-50"
              >
                <ZoomIn className="w-4 h-4 mt-0.5 shrink-0 text-muted" />
                <span>
                  <span className="block text-sm font-medium">Upscale for Print</span>
                  <span className="hidden lg:block text-[11px] text-muted leading-snug">Crisp upscale toward 300 DPI</span>
                </span>
              </button>
            )}
          </nav>

          {/* canvas + results */}
          <section className="p-4 lg:overflow-y-auto space-y-4">
            {op === 'inpaint' ? (
              <MaskPainter imageUrl={current} onChange={setMask} checkerboard />
            ) : (
              <div
                className="rounded-xl overflow-hidden border border-text/10 flex items-center justify-center"
                style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '20px 20px' }}
              >
                <img src={current} alt="Design being edited" className="max-h-[52vh] w-auto object-contain" />
              </div>
            )}
            {current !== imageUrl && (
              <p className="text-xs text-muted flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Working from a result — the next run edits this version.
                <button type="button" className="underline hover:text-text" onClick={() => setCurrent(imageUrl)}>
                  Back to the original
                </button>
              </p>
            )}

            {upscaling && <ProgressBar label={upscaling.label} startedAt={upscaling.startedAt} expectedMs={upscaling.expectedMs} />}

            {run && <ProgressBar size="lg" label={run.label} startedAt={run.startedAt} expectedMs={run.expectedMs} />}
            {error && <p className="text-sm text-red-400 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">{error}</p>}

            {results && results.images.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>
                    {results.images.length} result{results.images.length > 1 ? 's' : ''} · {results.size} · via {results.images[0].modelId.replace('openai/', '')}
                  </span>
                  <span>{results.cost > 0 ? `${results.cost} ITC` : 'free'}</span>
                </div>
                <div className={`grid gap-3 ${results.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {results.images.map((img, i) => (
                    <div key={img.url} className="rounded-xl border border-text/10 overflow-hidden bg-card">
                      <div
                        className="flex items-center justify-center"
                        style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}
                      >
                        <img src={img.url} alt={`Result ${i + 1}`} className="max-h-[40vh] w-auto object-contain" />
                      </div>
                      {results.op === 'text' && textTo && (
                        <div className="px-2 pt-2">
                          <SpellingBadge verdict={img.lettering} expected={[textTo]} />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 p-2">
                        {onUse && (
                          <button
                            type="button"
                            onClick={() => onUse(img.url, guide.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold"
                          >
                            <Check className="w-3.5 h-3.5" /> Use this
                          </button>
                        )}
                        {onAddNew && (
                          <button
                            type="button"
                            onClick={() => onAddNew([img.url], guide.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-text/15 text-xs"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add as new design
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setCurrent(img.url)
                            setResults(null)
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-text/15 text-xs"
                        >
                          <ArrowRight className="w-3.5 h-3.5" /> Continue from this
                        </button>
                        <a href={img.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-text/15 text-xs">
                          <Download className="w-3.5 h-3.5" /> Open
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
                {onAddNew && results.images.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onAddNew(results.images.map((i) => i.url), guide.name)}
                    className="text-xs underline text-muted hover:text-text"
                  >
                    Add all {results.images.length} as new designs
                  </button>
                )}
              </div>
            )}
          </section>

          {/* controls + guide */}
          <aside className="border-t lg:border-t-0 lg:border-l border-text/10 p-4 lg:overflow-y-auto space-y-4 bg-card/40">
            <div>
              <h3 className="font-semibold">{guide.name}</h3>
              <p className="text-xs text-muted mt-0.5">{guide.useWhen}</p>
            </div>

            <ol className="space-y-1.5">
              {guide.steps.map((s, i) => (
                <li key={s} className="flex gap-2 text-xs">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">{i + 1}</span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>

            {op === 'text' && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted">
                  Text on the design now
                  <input value={textFrom} onChange={(e) => setTextFrom(e.target.value)} placeholder="BEAR" className="mt-1 w-full px-3 py-2 rounded-lg bg-bg border border-text/15 text-text text-sm" />
                </label>
                <label className="text-xs text-muted">
                  Should read
                  <input value={textTo} onChange={(e) => setTextTo(e.target.value)} placeholder="SMITH" className="mt-1 w-full px-3 py-2 rounded-lg bg-bg border border-text/15 text-text text-sm" />
                </label>
              </div>
            )}

            {op === 'recolor' && (
              <div>
                <p className="text-xs text-muted mb-1.5">Palette (main colour first)</p>
                <div className="flex flex-wrap items-center gap-2">
                  {colors.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <input
                        type="color"
                        value={c}
                        onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                        className="w-9 h-9 rounded-lg border border-text/15 bg-transparent"
                        aria-label={`Colour ${i + 1}`}
                      />
                      <button type="button" onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))} className="text-muted hover:text-text" aria-label="Remove colour">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {colors.length < 8 && (
                    <button type="button" onClick={() => setColors((cs) => [...cs, DEFAULT_SWATCHES[cs.length % DEFAULT_SWATCHES.length]])} className="w-9 h-9 rounded-lg border border-dashed border-text/20 flex items-center justify-center" aria-label="Add colour">
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {op === 'blend' && (
              <div>
                <p className="text-xs text-muted mb-1.5">References (image 2, 3, …)</p>
                <div className="flex flex-wrap gap-2">
                  {refs.map((r, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-text/15">
                      <img src={r} alt={`Reference ${i + 2}`} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 text-[10px] bg-black/60 text-white px-1">#{i + 2}</span>
                      <button type="button" onClick={() => setRefs((rs) => rs.filter((_, j) => j !== i))} className="absolute top-0 right-0 bg-black/60 text-white p-0.5" aria-label="Remove reference">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {refs.length < 6 && (
                    <button type="button" onClick={() => refInput.current?.click()} className="w-16 h-16 rounded-lg border border-dashed border-text/20 flex flex-col items-center justify-center text-[10px] text-muted">
                      <ImagePlus className="w-4 h-4" /> Add
                    </button>
                  )}
                </div>
                <input ref={refInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addRefs(e.target.files)} />
              </div>
            )}

            <div>
              <label className="text-xs text-muted" htmlFor="flare-prompt">
                {needsPrompt ? 'Describe the change' : 'Extra direction (optional)'}
              </label>
              <textarea
                id="flare-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={guide.examples[0]}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-bg border border-text/15 text-sm resize-y"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {guide.examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      if (op === 'text' && ex.includes('→')) {
                        const [a, b] = ex.split('→').map((s) => s.trim())
                        setTextFrom(a)
                        setTextTo(b)
                      } else setPrompt(ex)
                    }}
                    className="text-[11px] px-2 py-1 rounded-full border border-text/10 text-muted hover:text-text hover:border-primary/40"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {/* model knobs */}
            <div className="space-y-3 rounded-xl border border-text/10 p-3 bg-bg">
              <div>
                <p className="text-xs text-muted mb-1.5">Quality</p>
                <div className="grid grid-cols-5 gap-1">
                  {QUALITIES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuality(q)}
                      title={QUALITY_INFO[q].note}
                      className={`px-1 py-1.5 rounded-lg text-[11px] border ${quality === q ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-text/10 text-muted'}`}
                    >
                      {QUALITY_INFO[q].label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-1">{QUALITY_INFO[quality].note}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1.5">Canvas</p>
                <div className="grid grid-cols-2 gap-1">
                  {(['standard', 'large'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setSize(s)} className={`py-1.5 rounded-lg text-[11px] border ${size === s ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-text/10 text-muted'}`}>
                      {s === 'standard' ? '1536' : '2560'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-muted flex items-center gap-2">
                  Takes
                  <select value={variations} onChange={(e) => setVariations(Number(e.target.value))} className="px-2 py-1 rounded-lg bg-bg border border-text/15 text-text text-xs">
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                {op !== 'transparent' && (
                  <label className="text-xs text-muted flex items-center gap-1.5">
                    <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
                    Transparent background
                  </label>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {guide.knobs.map((k) => (
                  <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-text/5 text-muted font-mono">
                    {k}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={go}
              disabled={!ready}
              className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-orange-500 via-fuchsia-500 to-violet-600 disabled:opacity-40 shadow-glow-sm"
            >
              Run {guide.name} · {cost > 0 ? `${cost} ITC` : 'free'}
            </button>

            <div className="rounded-xl border border-text/10 p-3">
              <p className="text-xs font-semibold mb-1.5">Tips for {guide.name}</p>
              <ul className="space-y-1">
                {guide.tips.map((t) => (
                  <li key={t} className="text-[11px] text-muted">
                    • {t}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default FlareLab
