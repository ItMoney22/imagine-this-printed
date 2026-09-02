// Inspiration — an optional card fronting the Idea step: upload or paste a
// reference image, Mrs. Imagine breaks it down (subject/style/palette/mood/
// …), flags anything she can't copy outright, and pitches keep-vs-change
// questions plus a suggested idea. David's ask, verbatim (2026-09-02): "i
// need a spot in the step flow in the beginning that we can add inspiration
// upload a photo of a design mrs imagine will anaylze it and ask what we
// like if we want the same just ours or if we want diff words diff subject
// she basically breaks down the whole design."
import React, { useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ImagePlus, RefreshCw, Sparkles, X } from 'lucide-react'
import { stepFlow } from '../../lib/api'
import type { InspirationBreakdown, InspirationChoices, InspirationQuestion, SelectedInspiration } from './types'
import { InlineError, SecondaryButton } from './shared'
import ProgressBar from './ProgressBar'

// design doc: "~6-12s" for the breakdown call.
const INSPIRATION_EXPECTED_MS = 10000

const MAX_BYTES = 8 * 1024 * 1024
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Sentinel stored in the per-question answer map for "keep as is" — chosen
 *  over `undefined` so an explicit keep survives alongside typed/chip
 *  answers in the same plain string record. */
const KEEP = 'KEEP' as const

type QuestionAnswers = Record<string, string>

interface Preset {
  id: string
  label: string
  /** Returns the change direction for a question key, or null to keep it. */
  change: (key: string) => string | null
}

const PRESETS: Preset[] = [
  {
    id: 'same-vibe',
    label: 'Same vibe, make it ours',
    change: (key) =>
      key === 'subject'
        ? 'a different, original subject — keep the overall vibe'
        : key === 'words'
          ? 'different, original wording — not the reference text'
          : null,
  },
  {
    id: 'same-subject-new-words',
    label: 'Same subject, new words',
    change: (key) => (key === 'words' ? 'different, original wording — not the reference text' : null),
  },
  {
    id: 'diff-subject-same-style',
    label: 'Different subject, same style',
    change: (key) => (key === 'subject' ? 'a different, original subject — same style' : null),
  },
]

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })

const buildChoices = (questions: InspirationQuestion[], answers: QuestionAnswers): InspirationChoices => {
  const keep: string[] = []
  const change: Record<string, string> = {}
  for (const q of questions) {
    const answer = answers[q.key]
    if (!answer || answer === KEEP) keep.push(q.key)
    else change[q.key] = answer
  }
  return { keep, change }
}

const isHexColor = (v: string) => /^#([0-9a-f]{3}){1,2}$/i.test(v.trim())

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
    <div className="text-sm text-text mt-0.5">{children}</div>
  </div>
)

const ChipList: React.FC<{ items: string[] }> = ({ items }) =>
  items.length === 0 ? (
    <span className="text-muted">—</span>
  ) : (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex items-center gap-1 text-[11px] text-text bg-card border border-border-subtle rounded-full px-2 py-0.5"
        >
          {isHexColor(item) && (
            <span className="w-3 h-3 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: item }} />
          )}
          {item}
        </span>
      ))}
    </div>
  )

const BreakdownView: React.FC<{ breakdown: InspirationBreakdown }> = ({ breakdown }) => (
  <div className="mt-3 space-y-2.5">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <Row label="Subject">{breakdown.subject}</Row>
      <Row label="Style">{breakdown.style}</Row>
      <Row label="Composition">{breakdown.composition}</Row>
      <Row label="Mood">{breakdown.mood}</Row>
      <Row label="Words">{breakdown.text ?? 'No text in the reference'}</Row>
      <Row label="Palette">
        <ChipList items={breakdown.palette} />
      </Row>
    </div>
    <Row label="Techniques">
      <ChipList items={breakdown.techniques} />
    </Row>
    <Row label="What works">
      <ChipList items={breakdown.whatWorks} />
    </Row>
    {breakdown.flags.length > 0 && (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200 space-y-0.5">
          {breakdown.flags.map((flag, i) => (
            <p key={i}>{flag}</p>
          ))}
        </div>
      </div>
    )}
  </div>
)

interface InspirationPanelProps {
  /** Current idea textarea value, only used to decide whether to warn before overwriting. */
  idea: string
  /** The pinned inspiration from reducer state — non-null collapses the panel to a removable chip. */
  inspiration: SelectedInspiration | null
  /** Fills the Idea textarea (IdeaStep's `SET_IDEA`). */
  onIdeaChange: (idea: string) => void
  /** Pins/clears the inspiration on reducer state (`SET_INSPIRATION`). */
  onSetInspiration: (inspiration: SelectedInspiration | null) => void
}

const InspirationPanel: React.FC<InspirationPanelProps> = ({ inspiration, onIdeaChange, onSetInspiration }) => {
  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [result, setResult] = useState<{ intro: string; imageUrl: string; breakdown: InspirationBreakdown; questions: InspirationQuestion[]; suggestedIdea: string } | null>(null)
  const analyzeStartedAtRef = useRef<number | null>(null)

  const [answers, setAnswers] = useState<QuestionAnswers>({})
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({})
  const [activePreset, setActivePreset] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const analyze = async (imageSrc: string) => {
    setInputError(null)
    setImagePreview(imageSrc)
    setAnalyzeError(null)
    setResult(null)
    setAnswers({})
    setOtherInputs({})
    setActivePreset(null)
    analyzeStartedAtRef.current = Date.now()
    setAnalyzing(true)
    try {
      const res = await stepFlow.inspiration(imageSrc)
      setResult({
        intro: res.intro,
        imageUrl: res.inspiration.imageUrl,
        breakdown: res.inspiration.breakdown,
        questions: res.inspiration.questions,
        suggestedIdea: res.inspiration.suggestedIdea,
      })
    } catch (err: any) {
      setAnalyzeError(err?.message || "Mrs. Imagine couldn't study that image — try again or use a different one.")
    } finally {
      setAnalyzing(false)
    }
  }

  const handleFile = async (file: File) => {
    setInputError(null)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setInputError('Please use a PNG, JPG, or WEBP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setInputError('That image is over 8MB — try a smaller file.')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      await analyze(dataUrl)
    } catch {
      setInputError("Couldn't read that file — try again.")
    }
  }

  const handleUrlSubmit = () => {
    const url = urlInput.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      setInputError('That doesn\'t look like an image URL.')
      return
    }
    setUrlInput('')
    analyze(url)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const setAnswer = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setActivePreset(null)
  }

  const commitOther = (key: string) => {
    const val = (otherInputs[key] ?? '').trim()
    if (!val) return
    setAnswer(key, val)
  }

  const applyPreset = (preset: Preset) => {
    if (!result) return
    const next: QuestionAnswers = {}
    for (const q of result.questions) {
      next[q.key] = preset.change(q.key) ?? KEEP
    }
    setAnswers(next)
    setActivePreset(preset.id)
  }

  const handleUseAsIdea = () => {
    if (!result) return
    onIdeaChange(result.suggestedIdea)
    onSetInspiration({
      imageUrl: result.imageUrl,
      breakdown: result.breakdown,
      choices: buildChoices(result.questions, answers),
    })
  }

  const handleTryDifferent = () => {
    setImagePreview(null)
    setResult(null)
    setAnalyzeError(null)
    setInputError(null)
    setAnswers({})
    setOtherInputs({})
    setActivePreset(null)
  }

  // Pinned — collapse to a small removable "Inspired by" chip next to the idea.
  if (inspiration) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-text">
        <img
          src={inspiration.imageUrl}
          alt="Inspiration reference"
          className="w-6 h-6 rounded object-cover shrink-0 border border-border-subtle"
        />
        <span className="font-semibold">Inspired by:</span> {inspiration.breakdown.subject}
        <button
          type="button"
          onClick={() => onSetInspiration(null)}
          aria-label="Remove inspiration"
          className="text-muted hover:text-red-400"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 w-full flex items-center gap-3 rounded-2xl border border-dashed border-border-subtle bg-card/40 p-3 text-left hover:border-primary/40 transition-colors"
      >
        <img
          src="/mrs-imagine/mrs-imagine-head.png"
          alt="Mrs. Imagine"
          className="w-8 h-8 rounded-full object-cover shrink-0 border border-border-subtle"
        />
        <span className="text-sm text-text font-medium flex-1">
          Start from inspiration — upload a design and Mrs. Imagine will break it down.
        </span>
        <ChevronDown className="w-4 h-4 text-muted shrink-0" />
      </button>
    )
  }

  return (
    <div className="mb-4 rounded-2xl border border-border-subtle bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <img
          src="/mrs-imagine/mrs-imagine-head.png"
          alt="Mrs. Imagine"
          className="w-10 h-10 rounded-full object-cover shrink-0 border border-border-subtle"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-primary font-bold">Start from inspiration</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Collapse inspiration panel" className="text-muted hover:text-text">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>

          {!result && !analyzing && (
            <div className="mt-2">
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-5 cursor-pointer transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-border-subtle hover:border-primary/40'
                }`}
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="Reference preview" className="w-16 h-16 rounded-lg object-cover border border-border-subtle" />
                ) : (
                  <ImagePlus className="w-6 h-6 text-muted" />
                )}
                <p className="text-xs text-muted text-center">
                  Drop a design photo, or <span className="text-primary font-medium">click to choose a file</span>
                </p>
                <p className="text-[10px] text-muted">PNG, JPG, or WEBP — up to 8MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ''
                }}
              />

              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleUrlSubmit()
                    }
                  }}
                  placeholder="or paste an image URL…"
                  className="flex-1 text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text placeholder:text-muted"
                />
                <SecondaryButton onClick={handleUrlSubmit} disabled={!urlInput.trim()}>
                  Use this
                </SecondaryButton>
              </div>
              <InlineError message={inputError} />
            </div>
          )}

          {analyzing && (
            <div className="mt-3">
              {imagePreview && (
                <img src={imagePreview} alt="Reference preview" className="w-16 h-16 rounded-lg object-cover border border-border-subtle mb-2" />
              )}
              <ProgressBar
                label="Mrs. Imagine is studying it"
                startedAt={analyzeStartedAtRef.current ?? Date.now()}
                expectedMs={INSPIRATION_EXPECTED_MS}
              />
            </div>
          )}

          <InlineError message={analyzeError} />

          {result && !analyzing && (
            <div className="mt-3">
              <p className="text-sm text-text font-medium">{result.intro}</p>

              {imagePreview && (
                <img src={imagePreview} alt="Reference preview" className="w-16 h-16 rounded-lg object-cover border border-border-subtle mt-2" />
              )}

              <BreakdownView breakdown={result.breakdown} />

              {result.questions.length > 0 && (
                <div className="mt-4 border-t border-border-subtle pt-3">
                  <span className="text-[10px] uppercase tracking-wide text-muted">Quick answers</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                          activePreset === preset.id
                            ? 'bg-primary text-white border-primary'
                            : 'bg-card border-border-subtle text-text hover:border-primary/50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {result.questions.map((q) => (
                    <div key={q.key} className="mt-3">
                      <p className="text-xs font-medium text-text">{q.prompt}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAnswer(q.key, KEEP)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                            answers[q.key] === KEEP || !answers[q.key]
                              ? 'bg-primary/15 border-primary/40 text-primary font-semibold'
                              : 'bg-card border-border-subtle text-muted hover:text-text'
                          }`}
                        >
                          Keep as is
                        </button>
                        {q.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setAnswer(q.key, opt)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                              answers[q.key] === opt
                                ? 'bg-primary/15 border-primary/40 text-primary font-semibold'
                                : 'bg-card border-border-subtle text-muted hover:text-text'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                        <input
                          type="text"
                          value={otherInputs[q.key] ?? ''}
                          onChange={(e) => setOtherInputs((prev) => ({ ...prev, [q.key]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitOther(q.key)
                            }
                          }}
                          onBlur={() => commitOther(q.key)}
                          placeholder="other…"
                          className="text-[11px] border border-border-subtle rounded-full px-2.5 py-1 bg-bg text-text placeholder:text-muted w-24"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={handleUseAsIdea} className="!bg-gradient-to-r !from-primary !to-secondary !text-white !border-0">
                  <Sparkles className="w-3.5 h-3.5" /> Use this as my idea
                </SecondaryButton>
                <SecondaryButton onClick={handleTryDifferent}>
                  <RefreshCw className="w-3.5 h-3.5" /> Try a different image
                </SecondaryButton>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted italic mt-3">
        We never copy a design. Mrs. Imagine keeps what works and makes it original.
      </p>
    </div>
  )
}

export default InspirationPanel
