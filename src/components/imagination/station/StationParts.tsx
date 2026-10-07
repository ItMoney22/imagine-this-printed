/**
 * Imagination Station redo, built to the mock David approved on 2026-10-07
 * (page_mockup_approvals c591c12d): a steps strip, tool rows with before/after
 * pictures and a price chip, a welcome scene with Mr. Imagine, and Add Words.
 */
import React, { useRef, useState } from 'react'
import { ArrowRight, Loader2, Sparkles, Type, Upload, Wand2, X } from 'lucide-react'
import '../../../styles/station.css'
import { IDEAS_TO_TRY } from './stationIdeas'

const ART = '/station'

/* ---------------- Steps ---------------- */

export type StationStep = 1 | 2 | 3 | 4
const STEPS: { n: StationStep; label: string }[] = [
  { n: 1, label: 'Make' },
  { n: 2, label: 'Polish' },
  { n: 3, label: 'Place on sheet' },
  { n: 4, label: 'Add to cart' },
]

export const StationSteps: React.FC<{ step: StationStep; onStep: (n: StationStep) => void }> = ({ step, onStep }) => (
  <nav aria-label="Steps" className="h-11 shrink-0 bg-card border-b st-divider flex items-center justify-center px-3">
    <ol className="flex items-center gap-1 sm:gap-2 w-full max-w-3xl">
      {STEPS.map((s, i) => {
        const done = s.n < step
        const current = s.n === step
        return (
          <li key={s.n} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-none min-w-0">
            <button
              type="button"
              onClick={() => onStep(s.n)}
              className="flex items-center gap-2 shrink-0 rounded-full pr-1 hover:opacity-90"
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  current ? 'bg-primary text-white st-pulse' : done ? 'st-step-done' : 'st-step-idle text-muted'
                }`}
              >
                {s.n}
              </span>
              <span className={`text-xs sm:text-sm font-semibold whitespace-nowrap ${current ? 'text-primary' : done ? 'text-text' : 'text-muted'} ${current ? '' : 'hidden md:inline'}`}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className={`h-0.5 flex-1 rounded-full min-w-[12px] ${s.n < step ? 'st-line-done' : 'st-line'}`} />
            )}
          </li>
        )
      })}
    </ol>
  </nav>
)

/* ---------------- Tool rows ---------------- */

export const ToolGroup: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="p-2 md:p-3 border-b st-divider">
    <p className="hidden md:flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-wider mb-2 px-1">
      {icon}
      {title}
    </p>
    <div className="flex flex-col gap-1.5">{children}</div>
  </section>
)

export interface ToolRowProps {
  label: string
  /** Picture pair under public/station/tools/<art>-before|after.webp */
  art?: string
  /** Used instead of a picture pair. */
  icon?: React.ReactNode
  /** Shown as the "before" when only the after is a picture (Upload). */
  beforeIcon?: React.ReactNode
  afterSrc?: string
  price: string
  note?: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  title?: string
  highlight?: boolean
}

export const ToolRow: React.FC<ToolRowProps> = ({ label, art, icon, beforeIcon, afterSrc, price, note, onClick, disabled, busy, title, highlight }) => {
  const free = /free/i.test(price)
  const after = afterSrc ?? (art ? `${ART}/tools/${art}-after.webp` : undefined)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title ?? label}
      className={`st-tool w-full flex flex-col md:flex-row items-center gap-1 md:gap-2.5 p-1.5 md:px-2 md:py-2 rounded-xl text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        highlight ? 'st-row-hi' : 'st-row'
      }`}
    >
      <span className="relative flex items-center gap-1 shrink-0">
        {art && (
          <img src={`${ART}/tools/${art}-before.webp`} alt="" loading="lazy" className="hidden md:block w-9 h-9 rounded-lg object-cover bg-white st-ring" />
        )}
        {!art && beforeIcon && (
          <span className="hidden md:flex w-9 h-9 rounded-lg items-center justify-center st-soft">{beforeIcon}</span>
        )}
        {(art || beforeIcon) && <ArrowRight className="hidden md:block w-3 h-3 text-muted" />}
        {after ? (
          <img src={after} alt="" loading="lazy" className="st-after w-9 h-9 rounded-lg object-cover bg-white st-ring-primary" />
        ) : (
          <span className="st-after w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-sm">{icon}</span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-lg st-busy">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          </span>
        )}
      </span>
      <span className="hidden md:flex flex-col min-w-0 gap-1">
        <span className="text-sm font-semibold text-text leading-tight">{label}</span>
        <span className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`inline-flex items-center rounded-full px-2 py-px text-[10px] font-semibold ${
              free ? 'st-chip-free' : 'st-chip'
            }`}
          >
            {price}
          </span>
          {note && <span className="text-[10px] text-muted leading-tight">{note}</span>}
        </span>
      </span>
    </button>
  )
}

/* ---------------- Welcome scene ---------------- */

export interface StationWelcomeProps {
  onImagine: (prompt: string) => void
  onSurprise: () => Promise<string | null>
  onFiles: (files: File[]) => void
  onBrowse: () => void
  imaginePrice: string
  uploading?: boolean
}

export const StationWelcome: React.FC<StationWelcomeProps> = ({ onImagine, onSurprise, onFiles, onBrowse, imaginePrice, uploading }) => {
  const [idea, setIdea] = useState('')
  const [thinking, setThinking] = useState(false)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const surprise = async () => {
    setThinking(true)
    try {
      const next = await onSurprise()
      if (next) {
        setIdea(next)
        inputRef.current?.focus()
      }
    } finally {
      setThinking(false)
    }
  }

  const drop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'))
    if (files.length) onFiles(files)
  }

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-5 py-2">
      {/* Hero: the studio scene, the real Mr. Imagine floating on the right */}
      <section className="st-hero st-rise relative overflow-hidden rounded-3xl shadow-soft-lg min-h-[340px]">
        <img src={`${ART}/hero.webp`} alt="" className="st-hero-art absolute inset-0 w-full h-full object-cover object-right" />
        <div className="st-hero-fade absolute inset-0" />
        <div className="hidden sm:block absolute right-[-10px] bottom-[-14px] h-[92%] st-float pointer-events-none">
          <img src="/station/mr-imagine.webp" alt="" className="st-mr h-full w-auto" />
        </div>

        <div className="relative z-10 p-6 sm:p-8 max-w-[560px]">
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-[#5b4a7a] mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 st-pulse" />
            Ready to create
          </p>
          <h1 className="font-body font-black uppercase tracking-tight leading-[0.95] text-4xl sm:text-5xl">
            <span className="st-hero-word">Imagine</span> your
            <br />
            first design
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#4a3d63] max-w-md">
            Type your idea and Mr. Imagine draws it, or upload your own art. Polish it, place it on your sheet, and we print it.
          </p>

          <form
            className="mt-5 flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              onImagine(idea.trim())
            }}
          >
            <input
              ref={inputRef}
              value={idea}
              onChange={(e) => setIdea(e.target.value.slice(0, 500))}
              placeholder="Describe your idea… a tiger in sunglasses"
              className="flex-1 min-w-0 rounded-2xl bg-white/95 border border-[#d9ccf3] px-4 py-3 text-sm text-[#1d1530] placeholder:text-[#8a7aa8] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#9b30ff]/50"
              aria-label="Describe your idea"
            />
            <button
              type="submit"
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white bg-gradient-to-r from-[#9b30ff] to-[#e0218a] shadow-[0_10px_24px_-10px_rgba(155,48,255,0.8)] hover:brightness-110 transition"
            >
              <Sparkles className="w-4 h-4" />
              Imagine
            </button>
          </form>
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={surprise}
              disabled={thinking}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/90 border border-[#d9ccf3] px-3 py-1.5 text-xs font-semibold text-[#7a22d6] hover:bg-white transition disabled:opacity-60"
            >
              {thinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {thinking ? 'Thinking…' : 'Surprise me'}
            </button>
            <span className="text-xs text-[#6b5a8a]">{imaginePrice}</span>
          </div>
        </div>
      </section>

      {/* Upload */}
      <button
        type="button"
        onClick={onBrowse}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        data-over={over}
        className="st-drop st-rise w-full rounded-3xl bg-card px-6 py-7 flex flex-col items-center gap-1.5 text-center transition-colors"
        style={{ animationDelay: '80ms' }}
      >
        {uploading ? <Loader2 className="w-7 h-7 text-primary animate-spin" /> : <Upload className="w-7 h-7 text-primary" />}
        <span className="text-base font-bold text-text">Upload your art</span>
        <span className="text-sm text-muted">Drag and drop your file here, or click to browse. PNG with a clear background prints best.</span>
      </button>

      {/* Ideas to try */}
      <section className="st-rise" style={{ animationDelay: '160ms' }}>
        <h2 className="font-body text-lg font-bold text-text mb-3">Ideas to try</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {IDEAS_TO_TRY.map((idea) => (
            <button
              key={idea.slug}
              type="button"
              onClick={() => onImagine(idea.prompt)}
              className="st-idea group rounded-2xl bg-card p-2 text-left"
              title={idea.prompt}
            >
              <img src={`${ART}/ideas/${idea.slug}.webp`} alt="" loading="lazy" className="w-full aspect-square object-contain rounded-xl bg-white" />
              <span className="block mt-1.5 text-xs font-semibold text-text truncate">{idea.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/* ---------------- Add Words ---------------- */

const LETTER_STYLES = [
  { id: 'bubble', label: 'Bubble', prompt: 'puffy, glossy, colorful retro bubble letters with tiny sparkles' },
  { id: 'retro', label: 'Retro', prompt: 'a 70s retro groovy lettering style with warm sunset stripes' },
  { id: 'varsity', label: 'Varsity', prompt: 'bold athletic varsity college lettering with an outline' },
  { id: 'graffiti', label: 'Graffiti', prompt: 'colorful street graffiti lettering with drips and highlights' },
  { id: 'script', label: 'Script', prompt: 'an elegant flowing brush script with a soft shadow' },
  { id: 'neon', label: 'Neon', prompt: 'glowing neon sign lettering in pink and blue' },
]

export const AddWordsModal: React.FC<{ isOpen: boolean; onClose: () => void; onCreate: (prompt: string) => void }> = ({ isOpen, onClose, onCreate }) => {
  const [words, setWords] = useState('')
  const [style, setStyle] = useState(LETTER_STYLES[0].id)
  if (!isOpen) return null
  const picked = LETTER_STYLES.find((s) => s.id === style) ?? LETTER_STYLES[0]
  const text = words.trim()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="st-rise w-full max-w-md rounded-3xl bg-card text-text shadow-soft-xl st-ring overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b st-divider">
          <img src={`${ART}/tools/words-after.webp`} alt="" className="w-10 h-10 rounded-xl object-cover bg-white st-ring-primary" />
          <div className="flex-1">
            <h2 className="text-lg font-bold">Add Words</h2>
            <p className="text-xs text-muted">Type your words, pick a style, and Mr. Imagine letters it.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg st-link" aria-label="Close">
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>
        <form
          className="p-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text) return
            onCreate(`Lettering design that reads exactly "${text}" in ${picked.prompt}. Spell it exactly as written, with no other words.`)
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Your words</span>
            <input
              autoFocus
              value={words}
              onChange={(e) => setWords(e.target.value.slice(0, 40))}
              placeholder="Good Vibes Only"
              className="rounded-xl bg-bg st-input px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#9333ea]/40"
            />
            <span className="text-[11px] text-muted">{words.length}/40</span>
          </label>
          <div>
            <span className="text-sm font-semibold">Style</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {LETTER_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  className={`rounded-xl px-2 py-2 text-sm font-semibold transition-colors ${
                    style === s.id ? 'bg-primary text-white' : 'bg-bg st-toggle'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={!text}
            className="inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white bg-gradient-to-r from-[#9b30ff] to-[#e0218a] disabled:opacity-50"
          >
            <Type className="w-4 h-4" />
            Letter it with Mr. Imagine
          </button>
        </form>
      </div>
    </div>
  )
}
