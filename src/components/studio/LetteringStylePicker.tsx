// "How should the words look?" — design doc §16. David, verbatim: "when in
// the step flow and i ask for a phrase can there be examples of how i want
// the font to look because it only generates plain font." Shown once a
// phrase is chosen (a Mrs. Imagine chip, or typed by hand): a grid of tiles,
// each rendering the ACTUAL phrase text in a real web font — instant, no
// image generation — plus a "Let Mrs. Imagine pick" tile. The pick becomes
// `phrase.style`, which rides into the exact-text render instruction
// (backend/shared/lettering-styles.ts's `prompt` descriptor) so GPT Image 2
// draws that lettering itself.
import React, { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { LETTERING_STYLES, type LetteringStyle } from '../../../backend/shared/lettering-styles'
import type { LetteringStyleId } from './types'

let fontsInjected = false

/** Builds the one Google Fonts css2 URL covering every style's preview
 *  family, requesting `display=swap` so text paints immediately in a
 *  fallback font and swaps in place once the real face loads — that's the
 *  "fallback to the label if the font hasn't loaded yet" behavior: the tile
 *  never sits blank, it just briefly renders in a system font. Computed once
 *  — `LETTERING_STYLES` is a fixed module-level list, not runtime data. */
function buildGoogleFontsHref(styles: LetteringStyle[]): string {
  const params = styles.map((s) => {
    const family = s.preview.googleFamily.trim().replace(/\s+/g, '+')
    if (s.preview.weight && s.preview.italic) return `family=${family}:ital,wght@1,${s.preview.weight}`
    if (s.preview.weight) return `family=${family}:wght@${s.preview.weight}`
    if (s.preview.italic) return `family=${family}:ital@1`
    return `family=${family}`
  })
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`
}

const GOOGLE_FONTS_HREF = buildGoogleFontsHref(LETTERING_STYLES)

/** Injects the stylesheet link into <head> once per page load — guards both
 *  a module-level flag (cheap, the common case) and a DOM query (survives a
 *  hot-reload/remount that reset the module but left the old <link> in
 *  place), same belt-and-suspenders pattern as ProgressBar's shimmer style. */
function ensureLetteringFontsLoaded() {
  if (typeof document === 'undefined') return
  if (fontsInjected) return
  fontsInjected = true
  if (document.head.querySelector('link[data-itp-lettering-fonts]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = GOOGLE_FONTS_HREF
  link.setAttribute('data-itp-lettering-fonts', 'true')
  document.head.appendChild(link)
}

/** Turns a style's raw `css` string ("text-shadow: 0 0 6px #f0f; color: #fff;")
 *  into a React inline-style object — only the two declaration shapes the
 *  shared module actually uses (semicolon-separated `prop: value` pairs). */
function parseInlineCss(css?: string): React.CSSProperties {
  if (!css) return {}
  const out: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (!prop || !value) continue
    const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    out[camel] = value
  }
  return out as React.CSSProperties
}

function tileTextStyle(style: LetteringStyle): React.CSSProperties {
  const { preview } = style
  return {
    fontFamily: `'${preview.googleFamily}', sans-serif`,
    fontWeight: preview.weight,
    fontStyle: preview.italic ? 'italic' : undefined,
    letterSpacing: preview.letterSpacing,
    textTransform: preview.uppercase ? 'uppercase' : undefined,
    ...parseInlineCss(preview.css),
  }
}

interface LetteringStylePickerProps {
  /** The phrase text to render in each style — always present, since this
   *  panel only ever shows once a phrase has been chosen. */
  phraseText: string
  selected: LetteringStyleId | 'auto'
  onSelect: (style: LetteringStyleId | 'auto') => void
}

const LetteringStylePicker: React.FC<LetteringStylePickerProps> = ({ phraseText, selected, onSelect }) => {
  useEffect(() => {
    ensureLetteringFontsLoaded()
  }, [])

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {LETTERING_STYLES.map((style) => {
        const isSelected = selected === style.id
        return (
          <button
            key={style.id}
            type="button"
            onClick={() => onSelect(style.id)}
            aria-pressed={isSelected}
            className={`rounded-xl border p-3 text-left transition-colors ${
              isSelected ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : 'border-border-subtle bg-card hover:border-primary/40'
            }`}
          >
            <div className="text-base leading-snug break-words line-clamp-2" style={tileTextStyle(style)}>
              {phraseText || style.label}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted mt-1.5">{style.label}</div>
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => onSelect('auto')}
        aria-pressed={selected === 'auto'}
        className={`rounded-xl border p-3 text-left flex flex-col items-start justify-center gap-1.5 min-h-[64px] transition-colors ${
          selected === 'auto' ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : 'border-border-subtle bg-card hover:border-primary/40'
        }`}
      >
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-text">Let Mrs. Imagine pick</span>
      </button>
    </div>
  )
}

export default LetteringStylePicker
