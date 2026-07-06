import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import confetti from 'canvas-confetti'
import {
  Sparkles,
  Shirt,
  Wand2,
  Scissors,
  ArrowRight,
  ArrowLeft,
  Loader2,
  History,
  Check,
  Download,
  Upload,
  X,
  TrendingUp,
  Search,
  AlertTriangle,
  ShoppingBag,
  ChevronDown,
} from 'lucide-react'
import { aiProducts, imageFlow } from '../lib/api'
import { buildProductGallery } from '../lib/product-gallery'
import type {
  AIProductCreationRequest,
  AIProductCreationResponse,
  AIJob,
  ProductTrendFamily,
  ProductTrendIdea,
  ProductTrendSource,
  SimpleWordPhrase,
  TshirtPrintLocation,
} from '../types'
import { supabase } from '../lib/supabase'

// Wizard polling fires 3-8 trace lines every 2-3s while a generation is in
// flight. Useful during development; pure noise in prod (and burns cycles in
// console-instrumented browsers). `import.meta.env.DEV` is statically false
// in `vite build`, so all callers below are dead-code-eliminated for prod.
const debugLog: typeof console.log = import.meta.env.DEV ? console.log.bind(console) : () => {}

// --- DTF settings selectors: real garment imagery + glass tile system -------
// Branded, transparent Mr. Imagine garment mockups stand in for the old emoji.
// The product-type tiles color-sync to the chosen shirt color; hoodie/tank have
// no gray asset, so the resolver falls back to the nearest available color.
const GARMENT_MOCKUPS: Record<'tshirt' | 'hoodie' | 'tank', Partial<Record<'black' | 'white' | 'gray', string>>> = {
  tshirt: {
    black: '/mr-imagine/mockups/mr-imagine-tshirt-black-front.png',
    white: '/mr-imagine/mockups/mr-imagine-tshirt-white-front.png',
    gray: '/mr-imagine/mockups/mr-imagine-tshirt-gray-front.png',
  },
  hoodie: {
    black: '/mr-imagine/mockups/mr-imagine-hoodie-black-front.png',
    white: '/mr-imagine/mockups/mr-imagine-hoodie-white-front.png',
    gray: '/mr-imagine/mockups/mr-imagine-hoodie-gray-front.png',
  },
  tank: {
    black: '/mr-imagine/mockups/mr-imagine-tank-black-front.png',
    white: '/mr-imagine/mockups/mr-imagine-tank-white-front.png',
    gray: '/mr-imagine/mockups/mr-imagine-tank-gray-front.png',
  },
}

function garmentImage(type: 'tshirt' | 'hoodie' | 'tank', color: 'black' | 'white' | 'gray'): string {
  const set = GARMENT_MOCKUPS[type] ?? GARMENT_MOCKUPS.tshirt
  return set[color] ?? set.black ?? set.white ?? GARMENT_MOCKUPS.tshirt.black!
}

// Shared frosted-glass tile shell used by all three DTF pickers so the product
// type, color, and placement selectors read as one cohesive control surface.
const glassTileBase =
  'group relative overflow-hidden rounded-2xl border backdrop-blur-md transition-all duration-300 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
const glassTileState = (active: boolean): string =>
  active
    ? 'border-primary/60 bg-primary/10 shadow-[0_12px_34px_-10px_rgba(168,85,247,0.6)] ring-1 ring-primary/30'
    : 'border-white/10 bg-white/[0.045] hover:border-white/25 hover:bg-white/[0.08] hover:-translate-y-0.5'

// Top sheen + selected-state check that every glass tile shares.
function TileChrome({ active }: { active: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent opacity-60"
      />
      {active && (
        <span className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow-[0_0_10px_rgba(168,85,247,0.7)]">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </>
  )
}

// Minimal print-placement glyph: a shirt silhouette with the active print zone
// lit in the theme's primary color. Replaces the old emoji placement icons.
function PlacementGlyph({
  kind,
  active,
}: {
  kind: 'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'
  active: boolean
}) {
  const shirt = 'M18 5 L10 10 L13 19 L17 17 L17 43 L31 43 L31 17 L35 19 L38 10 L30 5 C28 8 20 8 18 5 Z'
  const zoneOpacity = active ? 1 : 0.5
  return (
    <span className={active ? 'text-primary' : 'text-muted'}>
      <svg viewBox="0 0 48 48" className="mx-auto h-9 w-9" fill="none">
        <path
          d={shirt}
          fill="currentColor"
          fillOpacity={0.16}
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        {kind === 'front-center' && (
          <rect x="19" y="21" width="10" height="12" rx="1.5" fill="currentColor" fillOpacity={zoneOpacity} />
        )}
        {kind === 'left-pocket' && (
          <rect x="25.5" y="19" width="5" height="5" rx="1" fill="currentColor" fillOpacity={zoneOpacity} />
        )}
        {kind === 'back-only' && (
          <rect x="18" y="18" width="12" height="18" rx="1.5" fill="currentColor" fillOpacity={zoneOpacity} />
        )}
        {kind === 'pocket-front-back-full' && (
          <>
            <rect x="25.5" y="19" width="5" height="5" rx="1" fill="currentColor" fillOpacity={zoneOpacity} />
            <rect x="18" y="27" width="12" height="9" rx="1.5" fill="currentColor" fillOpacity={active ? 0.6 : 0.3} />
          </>
        )}
      </svg>
    </span>
  )
}

// T-shirt print placements a product can be offered with. Maps 1:1 to the
// products.print_locations TEXT[] column (front_image | back_image | pocket).
const PRINT_LOCATION_OPTIONS: { value: TshirtPrintLocation; label: string; hint: string }[] = [
  { value: 'front_image', label: 'Front Image', hint: 'Design on the chest / full front' },
  { value: 'back_image', label: 'Back Image', hint: 'Design on the back' },
  { value: 'pocket', label: 'Pocket', hint: 'Small left-chest pocket print' },
]

// Multi-select dropdown for the print placements a T-shirt is offered with.
// Pick one or more (front / back / pocket). At least one stays selected so the
// products.print_locations CHECK constraint (>= 1 for shirts) always holds.
function PrintLocationsDropdown({
  selected,
  onChange,
}: {
  selected: TshirtPrintLocation[]
  onChange: (next: TshirtPrintLocation[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = (value: TshirtPrintLocation) => {
    const has = selected.includes(value)
    // Keep at least one selected — shirts require >= 1 print location.
    if (has && selected.length === 1) return
    onChange(has ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const summary =
    selected.length === 0
      ? 'Select print locations'
      : PRINT_LOCATION_OPTIONS.filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(', ')

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected.length ? 'text-text' : 'text-muted'}>{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-2 w-full bg-card border border-white/10 rounded-xl shadow-xl overflow-hidden"
        >
          {PRINT_LOCATION_OPTIONS.map((o) => {
            const checked = selected.includes(o.value)
            const lockLast = checked && selected.length === 1
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(o.value)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                  lockLast ? 'cursor-default opacity-90' : 'cursor-pointer hover:bg-primary/10'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    checked ? 'bg-primary border-primary text-white' : 'border-white/20 text-transparent'
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-text">{o.label}</span>
                  <span className="text-xs text-muted">{o.hint}</span>
                </span>
              </button>
            )
          })}
          <p className="px-4 py-2 text-[11px] text-muted border-t border-white/5">
            Pick one or more — at least one stays selected.
          </p>
        </div>
      )}
    </div>
  )
}

type WizardStep = 'describe' | 'review' | 'generate' | 'select-image' | 'enhance-image' | 'success'
type ProductCategoryOption = 'dtf-transfers' | 'shirts' | 'hoodies' | 'tumblers'

// Draft autosave — losing a half-finished generation (paid AI output) to a
// refresh or crash was the top admin complaint. Versioned key so a future
// schema change can ignore stale drafts.
const WIZARD_DRAFT_KEY = 'itp-admin-wizard-draft-v1'

interface WizardDraft {
  savedAt: string
  currentStep: WizardStep
  prompt: string
  priceTarget: number
  mockupStyle: 'flat' | 'human'
  background: 'transparent' | 'studio'
  tone: 'professional' | 'playful' | 'minimal'
  imageStyle: 'realistic' | 'cartoon' | 'semi-realistic'
  category: ProductCategoryOption
  targetAudience: string
  primaryColors: string
  designStyle: string
  numImages: number
  uploadedImageUrl: string | null
  useSearch: boolean
  productType: 'tshirt' | 'hoodie' | 'tank'
  shirtColor: 'black' | 'white' | 'gray'
  printPlacement: 'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'
  printLocations: TshirtPrintLocation[]
  printStyle: 'clean' | 'halftone' | 'grunge'
  normalized: NormalizedProduct | null
  productId: string | null
  selectedImageId: string | null
}

function readWizardDraft(): WizardDraft | null {
  try {
    const raw = window.localStorage.getItem(WIZARD_DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as WizardDraft
    return d && (d.productId || d.prompt?.trim()) ? d : null
  } catch {
    return null
  }
}

function clearWizardDraft(): void {
  try {
    window.localStorage.removeItem(WIZARD_DRAFT_KEY)
  } catch {
    // ignore
  }
}

interface NormalizedProduct {
  title: string
  description: string
  category_slug: string
  category_name: string
  tags: string[]
  seo_title: string
  seo_description: string
  summary: string
  variants: Array<{
    name: string
    priceDeltaCents?: number
  }>
  suggested_price_cents: number
  mockup_style: 'flat' | 'human'
  background: 'transparent' | 'studio'
}

const TREND_SOURCE_OPTIONS: Array<{ value: ProductTrendSource; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'etsy', label: 'Etsy' },
  { value: 'amazon', label: 'Amazon' },
]

const TREND_FAMILY_OPTIONS: Array<{ value: ProductTrendFamily; label: string }> = [
  { value: 'all', label: 'All products' },
  { value: 'apparel', label: 'Apparel' },
  { value: 'dtf-transfers', label: 'DTF transfers' },
  { value: 'tumblers', label: 'Tumblers' },
  { value: 'stickers', label: 'Stickers' },
  { value: 'metal-art', label: 'Metal art' },
  { value: '3d-toys', label: '3D toys' },
]

const SIMPLE_WORD_STYLE_OPTIONS = [
  { value: 'bold', label: 'Bold block' },
  { value: 'retro', label: 'Retro varsity' },
  { value: 'minimal', label: 'Minimal clean' },
  { value: 'puff', label: 'Puff print' },
  { value: 'distressed', label: 'Distressed vintage' },
] as const

type SimpleWordStyle = typeof SIMPLE_WORD_STYLE_OPTIONS[number]['value']
type SimpleWordLayout = 'single' | 'stacked' | 'compact'

const SIMPLE_WORD_STYLE_PROMPTS: Record<SimpleWordStyle, string> = {
  bold: 'bold block lettering, heavy sans-serif, centered, high contrast, modern streetwear',
  retro: 'retro varsity lettering, athletic serif, slightly arched layout, classic collegiate feel',
  minimal: 'minimal clean typography, refined sans-serif, generous spacing, premium boutique feel',
  puff: 'raised puff-print style lettering, rounded bold shapes, soft 3D ink effect, playful streetwear',
  distressed: 'distressed vintage lettering, worn ink texture, old concert merch feel, bold readable type',
}

const SIMPLE_WORD_RENDER_STYLES: Record<SimpleWordStyle, {
  fontFamily: string
  fontWeight: number
  letterSpacing: number
  strokeWidth: number
}> = {
  bold: {
    fontFamily: 'Impact, Arial Black, Arial, sans-serif',
    fontWeight: 900,
    letterSpacing: 0,
    strokeWidth: 0,
  },
  retro: {
    fontFamily: 'Georgia, Times New Roman, serif',
    fontWeight: 900,
    letterSpacing: 8,
    strokeWidth: 18,
  },
  minimal: {
    fontFamily: 'Inter, Arial, sans-serif',
    fontWeight: 800,
    letterSpacing: 14,
    strokeWidth: 0,
  },
  puff: {
    fontFamily: 'Arial Rounded MT Bold, Arial Black, Arial, sans-serif',
    fontWeight: 900,
    letterSpacing: 2,
    strokeWidth: 12,
  },
  distressed: {
    fontFamily: 'Impact, Arial Black, Arial, sans-serif',
    fontWeight: 900,
    letterSpacing: 3,
    strokeWidth: 0,
  },
}

const SIMPLE_WORD_INK_OPTIONS = [
  { value: '#F9FAFB', label: 'White ink' },
  { value: '#111827', label: 'Black ink' },
  { value: '#F4E7C5', label: 'Cream ink' },
  { value: '#FF4FA3', label: 'Hot pink' },
  { value: '#31D0AA', label: 'Mint' },
  { value: '#FACC15', label: 'Gold' },
] as const

const SIMPLE_WORD_ACCENT_OPTIONS = [
  { value: 'none', label: 'No accent' },
  { value: '#111827', label: 'Black outline' },
  { value: '#F9FAFB', label: 'White outline' },
  { value: '#FF4FA3', label: 'Pink shadow' },
  { value: '#31D0AA', label: 'Mint shadow' },
] as const

const SIMPLE_WORD_LAYOUT_OPTIONS: Array<{ value: SimpleWordLayout; label: string }> = [
  { value: 'single', label: 'One line' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'compact', label: 'Compact' },
]

function trendSourceTone(source: ProductTrendIdea['source']): string {
  switch (source) {
    case 'TikTok':
      return 'bg-black text-white border-white/20'
    case 'Etsy':
      return 'bg-orange-500/15 text-orange-200 border-orange-400/20'
    case 'Amazon':
      return 'bg-yellow-500/15 text-yellow-200 border-yellow-400/20'
    default:
      return 'bg-blue-500/15 text-blue-200 border-blue-400/20'
  }
}

function saturationTone(saturation: ProductTrendIdea['saturation']): string {
  if (saturation === 'low') return 'text-emerald-300'
  if (saturation === 'high') return 'text-amber-300'
  return 'text-blue-300'
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function encodeSvg(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return window.btoa(binary)
}

function splitSimpleWords(phrase: string, layout: SimpleWordLayout): string[] {
  const words = phrase.trim().replace(/\s+/g, ' ').toUpperCase().split(' ').filter(Boolean)
  if (layout === 'single' || words.length <= 1) return [words.join(' ')]
  if (layout === 'compact') {
    const maxWordsPerLine = words.length <= 4 ? 2 : 3
    const lines: string[] = []
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      lines.push(words.slice(i, i + maxWordsPerLine).join(' '))
    }
    return lines.slice(0, 4)
  }

  const lineCount = words.length <= 3 ? words.length : Math.min(3, Math.ceil(words.length / 2))
  const lines = Array.from({ length: lineCount }, () => [] as string[])
  words.forEach((word, index) => lines[index % lineCount].push(word))
  return lines.map((line) => line.join(' ')).filter(Boolean)
}

function buildSimpleTextSvg(
  phrase: string,
  style: SimpleWordStyle,
  inkColor: string,
  accentColor: string,
  layout: SimpleWordLayout,
): string {
  const lines = splitSimpleWords(phrase, layout)
  const render = SIMPLE_WORD_RENDER_STYLES[style]
  const longest = Math.max(...lines.map((line) => line.length), 4)
  const lineCount = Math.max(lines.length, 1)
  const maxSize = layout === 'single' ? 250 : lineCount === 2 ? 230 : 190
  const estimatedCharWidth = style === 'minimal' ? 0.62 : style === 'retro' ? 0.58 : 0.48
  const fitSize = Math.floor(1760 / Math.max(longest * estimatedCharWidth, 6))
  const fontSize = Math.max(110, Math.min(maxSize, fitSize))
  const lineHeight = Math.floor(fontSize * 1.08)
  const totalHeight = lineHeight * lineCount
  const startY = 1024 - totalHeight / 2 + lineHeight / 2
  const accentIsOutline = accentColor !== 'none' && (style === 'retro' || style === 'puff' || accentColor === '#111827' || accentColor === '#F9FAFB')
  const accentIsShadow = accentColor !== 'none' && !accentIsOutline

  const textLines = lines.map((line, index) => {
    const y = startY + index * lineHeight
    const escapedLine = escapeXml(line)
    const baseAttrs = [
      'x="1024"',
      `y="${y}"`,
      'text-anchor="middle"',
      'dominant-baseline="middle"',
      `font-family="${escapeXml(render.fontFamily)}"`,
      `font-weight="${render.fontWeight}"`,
      `font-size="${fontSize}"`,
      `letter-spacing="${render.letterSpacing}"`,
    ].join(' ')

    return [
      accentIsShadow
        ? `<text ${baseAttrs} fill="${escapeXml(accentColor)}" opacity="0.95" transform="translate(28 28)">${escapedLine}</text>`
        : '',
      accentIsOutline
        ? `<text ${baseAttrs} fill="none" stroke="${escapeXml(accentColor)}" stroke-width="${render.strokeWidth || 18}" stroke-linejoin="round">${escapedLine}</text>`
        : '',
      `<text ${baseAttrs} fill="${escapeXml(inkColor)}">${escapedLine}</text>`,
    ].join('')
  }).join('')

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">',
    '<rect width="2048" height="2048" fill="none"/>',
    style === 'distressed'
      ? '<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="8"/><feDisplacementMap in="SourceGraphic" scale="5"/></filter>'
      : '',
    `<g${style === 'distressed' ? ' filter="url(#rough)"' : ''}>`,
    textLines,
    '</g>',
    '</svg>',
  ].join('')
}

function buildSimpleTextSvgDataUrl(
  phrase: string,
  style: SimpleWordStyle,
  inkColor: string,
  accentColor: string,
  layout: SimpleWordLayout,
): string {
  return `data:image/svg+xml;base64,${encodeSvg(buildSimpleTextSvg(phrase, style, inkColor, accentColor, layout))}`
}

function renderSimpleTextPngDataUrl(svgDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 2048
      canvas.height = 2048
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not render text design'))
        return
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('Could not preview text design'))
    image.src = svgDataUrl
  })
}

export default function AdminCreateProductWizard() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState<WizardStep>('describe')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 1: Describe
  const [prompt, setPrompt] = useState('')
  const [priceTarget, setPriceTarget] = useState(25)
  const [mockupStyle, setMockupStyle] = useState<'flat' | 'human'>('flat')
  const [background, setBackground] = useState<'transparent' | 'studio'>('studio')
  const [tone, setTone] = useState<'professional' | 'playful' | 'minimal'>('professional')
  const [imageStyle, setImageStyle] = useState<'realistic' | 'cartoon' | 'semi-realistic'>('semi-realistic')
  const [category, setCategory] = useState<ProductCategoryOption>('shirts')
  const [targetAudience, setTargetAudience] = useState('')
  const [primaryColors, setPrimaryColors] = useState('')
  const [designStyle, setDesignStyle] = useState('')
  const [numImages, setNumImages] = useState(1)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [useSearch, setUseSearch] = useState(false) // Default OFF - only enable for pop culture/trending topics
  const [trendSource, setTrendSource] = useState<ProductTrendSource>('all')
  const [trendFamily, setTrendFamily] = useState<ProductTrendFamily>('all')
  const [trendSeed, setTrendSeed] = useState('')
  const [trendIdeas, setTrendIdeas] = useState<ProductTrendIdea[]>([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendError, setTrendError] = useState<string | null>(null)
  const [selectedTrendId, setSelectedTrendId] = useState<string | null>(null)
  const [trendNote, setTrendNote] = useState<string | null>(null)
  const [simpleWords, setSimpleWords] = useState('')
  const [simpleWordStyle, setSimpleWordStyle] = useState<SimpleWordStyle>('bold')
  const [simpleWordLayout, setSimpleWordLayout] = useState<SimpleWordLayout>('stacked')
  const [simpleWordInkColor, setSimpleWordInkColor] = useState('#F9FAFB')
  const [simpleWordAccentColor, setSimpleWordAccentColor] = useState('none')
  const [simpleTextMode, setSimpleTextMode] = useState(false)
  const [phraseIdeas, setPhraseIdeas] = useState<SimpleWordPhrase[]>([])
  const [phraseLoading, setPhraseLoading] = useState(false)
  const [phraseError, setPhraseError] = useState<string | null>(null)
  const [phraseNote, setPhraseNote] = useState<string | null>(null)
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null)
  const [simpleWordsLoadedMessage, setSimpleWordsLoadedMessage] = useState<string | null>(null)

  // DTF Print Optimization Settings
  const [productType, setProductType] = useState<'tshirt' | 'hoodie' | 'tank'>('tshirt')
  const [shirtColor, setShirtColor] = useState<'black' | 'white' | 'gray'>('black')
  const [printPlacement, setPrintPlacement] = useState<'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'>('front-center')
  // Multi-select print placements offered for T-shirts → products.print_locations.
  const [printLocations, setPrintLocations] = useState<TshirtPrintLocation[]>(['front_image'])
  const [printStyle, setPrintStyle] = useState<'clean' | 'halftone' | 'grunge'>('clean')

  // Note: Generation, edits, and all 3 mockup variants run through openai/gpt-image-2 (Replicate)

  // Step 2: Review (normalized product from GPT)
  const [normalized, setNormalized] = useState<NormalizedProduct | null>(null)

  // Step 3: Generate (product ID and job status)
  const [productId, setProductId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<AIJob[]>([])
  const [removingBackground, setRemovingBackground] = useState(false)
  const [creatingMockups, setCreatingMockups] = useState(false)

  // Step 3.5: Select Image (for multi-model)
  const [sourceImages, setSourceImages] = useState<any[]>([])
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [imageWaitCount, setImageWaitCount] = useState(0) // Track polling cycles while waiting for 3rd image
  const mockupsTriggeredRef = useRef(false) // Prevent duplicate mockup API calls

  // Prompt-edit (gpt-image-2 by default; user can switch to gemini-3 in the studio)
  const [editPrompt, setEditPrompt] = useState('')
  const [editing, setEditing] = useState(false)
  const [editModel, setEditModel] = useState<'openai/gpt-image-2' | 'google/nano-banana'>('openai/gpt-image-2')
  // Design lock: strict-fidelity edits — only the requested change, nothing added/removed
  const [strictEdit, setStrictEdit] = useState(true)
  // Edit progress (elapsed-time based; the upstream API gives no progress events)
  const [editElapsed, setEditElapsed] = useState(0)
  // Hold-to-compare against the previous version in the refine studio
  const [comparingPrev, setComparingPrev] = useState(false)

  useEffect(() => {
    if (!editing) { setEditElapsed(0); return }
    const startedAt = Date.now()
    const tick = setInterval(() => setEditElapsed((Date.now() - startedAt) / 1000), 200)
    return () => clearInterval(tick)
  }, [editing])
  const [upscaling, setUpscaling] = useState(false)

  const [retryingJobId, setRetryingJobId] = useState<string | null>(null)

  // Unfinished draft found in localStorage — offered as a resume banner on the
  // describe step until the admin resumes or discards it.
  const [resumableDraft, setResumableDraft] = useState<WizardDraft | null>(() => readWizardDraft())

  // Describe step: secondary options live behind one "Advanced settings"
  // toggle so the default path is prompt → category → DTF settings → Next.
  const [showAdvanced, setShowAdvanced] = useState(false)

  // DTF halftone (local dot-screen engine — free)
  const [halftoning, setHalftoning] = useState(false)
  const [showHalftoneOptions, setShowHalftoneOptions] = useState(false)
  const [halftoneFrequency, setHalftoneFrequency] = useState(35)
  const [halftoneShape, setHalftoneShape] = useState<'round' | 'line'>('round')
  const [halftoneMethod, setHalftoneMethod] = useState<'halftone' | 'diffusion'>('halftone')
  const [halftoneInvert, setHalftoneInvert] = useState(false)

  // Step 4: Success
  const [finalProduct, setFinalProduct] = useState<any>(null)
  const [productAssets, setProductAssets] = useState<any[]>([])
  const [approving, setApproving] = useState(false)

  // Poll job status every 2 seconds during generation
  useEffect(() => {
    if (currentStep === 'generate' && productId) {
      debugLog('[Wizard] 🔄 Starting polling for product:', productId, 'selectedImageId:', selectedImageId)

      const interval = setInterval(async () => {
        try {
          debugLog('[Wizard] 📡 Polling status for product:', productId)
          const response = await aiProducts.getStatus(productId)
          debugLog('[Wizard] 📊 Status response:', response)

          const jobs = response.jobs || []
          debugLog('[Wizard] 📋 Jobs:', jobs.map((j: any) => ({ id: j.id, type: j.type, status: j.status })))
          setJobs(jobs)

          // Update product and assets in real-time (for image previews)
          setFinalProduct(response.product)
          setProductAssets(response.assets || [])

          // Check if image generation is complete with multiple source images
          const imageJob = jobs.find((j: any) => (j.type === 'replicate_image' || j.type === 'replicate_image_v2'))
          const mockupJob = jobs.find((j: any) => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2'))
          const sourceAssets = (response.assets || []).filter((a: any) => a.kind === 'source')

          debugLog('[Wizard] 📸 Source assets count:', sourceAssets.length, 'Image job status:', imageJob?.status, 'Mockup job status:', mockupJob?.status, 'Selected:', selectedImageId)

          // CASE 1: Mockups already triggered - wait for ALL mockup jobs to complete
          if (mockupsTriggeredRef.current || selectedImageId) {
            debugLog('[Wizard] 🎯 Mockups triggered, monitoring mockup progress...')

            // Find all mockup jobs (replicate_mockup and ghost_mannequin)
            const mockupJobs = jobs.filter((j: any) =>
              (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2') || j.type === 'ghost_mannequin'
            )

            if (mockupJobs.length > 0) {
              const completedMockups = mockupJobs.filter((j: any) =>
                j.status === 'succeeded' || j.status === 'failed' || j.status === 'skipped'
              )
              const failedMockups = mockupJobs.filter((j: any) => j.status === 'failed')

              debugLog('[Wizard] 📊 Mockup progress:', completedMockups.length, '/', mockupJobs.length, 'complete')

              // All mockups done
              if (completedMockups.length === mockupJobs.length) {
                if (failedMockups.length === mockupJobs.length) {
                  // All failed
                  console.error('[Wizard] ❌ All mockup jobs failed')
                  setError('Mockup generation failed. Please try again.')
                } else {
                  // At least one succeeded
                  debugLog('[Wizard] ✅ All mockups complete, transitioning to success')
                  setCurrentStep('success')
                }
              }
            }
            return // Don't run other checks
          }

          // CASE 2: Source images ready
          if (imageJob?.status === 'succeeded' && sourceAssets.length >= 1 && !mockupsTriggeredRef.current) {
            const isMulti = imageJob?.input?.multiModel === true || imageJob?.output?.multiModel === true
            debugLog('[Wizard] 🎨 Source images ready:', sourceAssets.length, 'multiModel:', isMulti)
            setImageWaitCount(0)
            setSourceImages(sourceAssets)

            if (isMulti && sourceAssets.length > 1) {
              // Multi-model fan-out: send user to selection step to pick the best variant
              debugLog('[Wizard] 🎯 Multi-model — routing to select-image step')
              setCurrentStep('select-image')
            } else if (isMulti && sourceAssets.length === 1) {
              // Multi-model but only one model succeeded — still let user confirm
              debugLog('[Wizard] 🎯 Multi-model with single survivor — routing to select-image step')
              setCurrentStep('select-image')
            } else {
              // Single-model path: auto-select and trigger mockups
              mockupsTriggeredRef.current = true
              const singleImage = sourceAssets[0]
              debugLog('[Wizard] 🎯 Single-model — auto-selecting:', singleImage.id)
              setSelectedImageId(singleImage.id)
              try {
                const response = await aiProducts.selectImage(productId, singleImage.id)
                debugLog('[Wizard] ✅ Auto-triggered mockup generation:', response.mockupJobs?.length, 'jobs')
              } catch (err: any) {
                console.error('[Wizard] ❌ Error auto-triggering mockups:', err)
                setError(err.message || 'Failed to auto-trigger mockups')
                mockupsTriggeredRef.current = false
              }
            }
          }
        } catch (err: any) {
          console.error('[Wizard] ❌ Error polling status:', err)
        }
      }, 2000)

      return () => clearInterval(interval)
    }
  }, [currentStep, productId, selectedImageId])

  // Autosave the wizard draft on every meaningful change. Cleared on Approve
  // and Start Over. Success step is terminal — nothing left worth resuming.
  useEffect(() => {
    if (currentStep === 'success') return
    if (!prompt.trim() && !productId) return
    const draft: WizardDraft = {
      savedAt: new Date().toISOString(),
      currentStep, prompt, priceTarget, mockupStyle, background, tone, imageStyle,
      category, targetAudience, primaryColors, designStyle, numImages,
      uploadedImageUrl, useSearch, productType, shirtColor, printPlacement,
      printLocations, printStyle, normalized, productId, selectedImageId,
    }
    try {
      window.localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // quota exceeded — non-fatal
    }
  }, [currentStep, prompt, priceTarget, mockupStyle, background, tone, imageStyle,
    category, targetAudience, primaryColors, designStyle, numImages, uploadedImageUrl,
    useSearch, productType, shirtColor, printPlacement, printLocations, printStyle, normalized,
    productId, selectedImageId])

  const handleDiscardDraft = () => {
    clearWizardDraft()
    setResumableDraft(null)
  }

  const handleResumeDraft = async () => {
    const d = resumableDraft
    if (!d) return
    setResumableDraft(null)
    setError(null)

    // Restore describe-step fields
    setPrompt(d.prompt)
    setPriceTarget(d.priceTarget)
    setMockupStyle(d.mockupStyle)
    setBackground(d.background)
    setTone(d.tone)
    setImageStyle(d.imageStyle)
    setCategory(d.category)
    setTargetAudience(d.targetAudience)
    setPrimaryColors(d.primaryColors)
    setDesignStyle(d.designStyle)
    setNumImages(d.numImages)
    setUploadedImageUrl(d.uploadedImageUrl)
    setUseSearch(d.useSearch)
    setProductType(d.productType)
    setShirtColor(d.shirtColor)
    setPrintPlacement(d.printPlacement)
    setPrintLocations(d.printLocations?.length ? d.printLocations : ['front_image'])
    setPrintStyle(d.printStyle)
    setNormalized(d.normalized)

    if (!d.productId) {
      setCurrentStep(d.currentStep === 'review' && d.normalized ? 'review' : 'describe')
      return
    }

    // Generation had started — rebuild live state from the server (source of
    // truth) and land on the right step.
    setProductId(d.productId)
    setLoading(true)
    try {
      const response = await aiProducts.getStatus(d.productId)
      const liveJobs = response.jobs || []
      const liveAssets = response.assets || []
      setJobs(liveJobs)
      setFinalProduct(response.product)
      setProductAssets(liveAssets)
      const sourceAssets = liveAssets.filter((a: any) => a.kind === 'source')
      setSourceImages(sourceAssets)

      const mockupJobs = liveJobs.filter((j: any) =>
        j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2' || j.type === 'ghost_mannequin')
      const selectedStillExists = !!d.selectedImageId && sourceAssets.some((a: any) => a.id === d.selectedImageId)
      if (selectedStillExists) setSelectedImageId(d.selectedImageId)

      if (mockupJobs.length > 0) {
        // Mockups were already kicked off — monitor them (polling lands on
        // success once they're all complete).
        mockupsTriggeredRef.current = true
        setCurrentStep('generate')
      } else if (selectedStillExists && d.currentStep === 'enhance-image') {
        setCurrentStep('enhance-image')
      } else {
        mockupsTriggeredRef.current = false
        setSelectedImageId(null)
        setCurrentStep('generate') // polling routes to select-image when sources are ready
      }
    } catch (e: any) {
      console.error('[Wizard] ❌ Resume failed:', e)
      setError(e.message || 'Failed to resume draft')
      setCurrentStep(d.normalized ? 'review' : 'describe')
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error("Please sign in to upload images.")
      }

      const formData = new FormData()
      formData.append("image", file)
      formData.append("folder", "products")

      const apiBase = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:4000" : "")
      const response = await fetch(`${apiBase}/api/admin/upload-product-image`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        },
        body: formData
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || "Failed to upload image")
      }

      const data = await response.json()
      setUploadedImageUrl(data.url)
      
      if (!prompt.trim()) {
        setPrompt(file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "))
      }
    } catch (err: any) {
      console.error("[Wizard] Upload error:", err)
      setError(err.message || "Failed to upload image")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }


  const handleFindTrends = async () => {
    setTrendLoading(true)
    setTrendError(null)
    setTrendNote(null)

    try {
      const response = await aiProducts.trends({
        source: trendSource,
        family: trendFamily,
        seed: trendSeed,
        limit: 6,
      })
      setTrendIdeas(response.ideas)
      setTrendNote(response.note)
    } catch (err: any) {
      setTrendError(err.message || 'Failed to find product trends')
    } finally {
      setTrendLoading(false)
    }
  }

  const handleUseTrend = (idea: ProductTrendIdea) => {
    setSelectedTrendId(idea.id)
    setSelectedPhraseId(null)
    setSimpleWordsLoadedMessage(null)
    setSimpleTextMode(false)
    setPrompt(idea.prompt)
    setCategory(idea.category)
    setTargetAudience(idea.targetAudience)
    setPrimaryColors(idea.primaryColors)
    setDesignStyle(idea.designStyle)
    setPriceTarget(idea.priceTarget)
    setImageStyle(idea.imageStyle)
    setProductType(idea.productType)
    setShirtColor(idea.shirtColor)
    setPrintPlacement(idea.printPlacement)
    setPrintStyle(idea.printStyle)
    setUseSearch(true)
    setShowAdvanced(true)
    setError(null)
  }

  const loadSimpleWordsPhrase = (rawPhrase: string, phraseId?: string) => {
    const phrase = rawPhrase.trim().replace(/\s+/g, ' ')
    if (!phrase) {
      setPhraseError('Enter or randomize the words you want on the front first.')
      return
    }

    setSelectedTrendId(null)
    setSelectedPhraseId(phraseId ?? null)
    setSimpleTextMode(true)
    setSimpleWords(phrase)
    setPrompt(`Text-only front print: "${phrase}"`)
    setCategory('shirts')
    setTargetAudience('trend buyers, gift shoppers, casual streetwear customers')
    setPrimaryColors('white ink with one accent color')
    setDesignStyle(SIMPLE_WORD_STYLE_PROMPTS[simpleWordStyle])
    setPriceTarget(25)
    setImageStyle('semi-realistic')
    setProductType('tshirt')
    setShirtColor('black')
    setPrintPlacement('front-center')
    setPrintLocations(['front_image'])
    setPrintStyle(simpleWordStyle === 'distressed' ? 'grunge' : 'clean')
    setUseSearch(false)
    setShowAdvanced(true)
    setSimpleWordsLoadedMessage(`"${phrase}" is ready as a plain text design. Pick the font/colors, then click Create Text Product to make the transparent front-print asset and mockups.`)
    setPhraseError(null)
    setTrendError(null)
    setError(null)
  }

  const handleUseSimpleWords = () => {
    loadSimpleWordsPhrase(simpleWords)
  }

  const handleRandomPhrases = async () => {
    setPhraseLoading(true)
    setPhraseError(null)
    setPhraseNote(null)
    setSimpleWordsLoadedMessage(null)

    try {
      const response = await aiProducts.phrases({
        source: trendSource,
        seed: trendSeed,
        limit: 10,
      })
      setPhraseIdeas(response.phrases)
      setPhraseNote(response.note)
    } catch (err: any) {
      setPhraseError(err.message || 'Failed to generate phrase ideas')
    } finally {
      setPhraseLoading(false)
    }
  }

  const handleDescribe = async () => {
    if (!prompt.trim()) {
      setError('Please describe your product idea')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Enrich prompt with additional details
      let enrichedPrompt = prompt
      if (targetAudience) enrichedPrompt += `\nTarget Audience: ${targetAudience}`
      if (primaryColors) enrichedPrompt += `\nPrimary Colors: ${primaryColors}`
      if (designStyle) enrichedPrompt += `\nDesign Style: ${designStyle}`
      enrichedPrompt += `\nProduct Category: ${category}`
      const simplePhrase = simpleWords.trim().replace(/\s+/g, ' ')
      const simpleTextSvgDataUrl = simpleTextMode && simplePhrase
        ? buildSimpleTextSvgDataUrl(simplePhrase, simpleWordStyle, simpleWordInkColor, simpleWordAccentColor, simpleWordLayout)
        : null
      const simpleTextPngDataUrl = simpleTextSvgDataUrl
        ? await renderSimpleTextPngDataUrl(simpleTextSvgDataUrl)
        : undefined

      const request: AIProductCreationRequest = {
        prompt: enrichedPrompt,
        priceTarget,
        mockupStyle,
        background,
        tone,
        imageStyle,
        category,
        numImages,
        useSearch,
        // DTF Print Settings
        productType,
        shirtColor,
        printPlacement,
        // T-shirt multi-select placements → products.print_locations (shirts only).
        print_locations: category === 'shirts' ? printLocations : undefined,
        printStyle,
        skipImageGeneration: Boolean(simpleTextPngDataUrl),
        sourceImageDataUrl: simpleTextPngDataUrl,
        sourceImageMime: simpleTextPngDataUrl ? 'image/png' : undefined,
        deterministicTextDesign: simpleTextPngDataUrl
          ? {
              phrase: simplePhrase,
              style: simpleWordStyle,
              layout: simpleWordLayout,
              inkColor: simpleWordInkColor,
              accentColor: simpleWordAccentColor,
            }
          : undefined,
      }

      const response: AIProductCreationResponse = await aiProducts.create(request)

      // Backend returns { productId, product: { ...product, normalized }, jobs }
      setNormalized(response.product.normalized)
      setProductId(response.productId)
      setCurrentStep('review')
    } catch (err: any) {
      setError(err.message || 'Failed to create product')
    } finally {
      setLoading(false)
    }
  }

  const handleReview = () => {
    setCurrentStep('generate')
  }

  const simpleTextPreviewUrl = simpleTextMode && simpleWords.trim()
    ? buildSimpleTextSvgDataUrl(
        simpleWords.trim().replace(/\s+/g, ' '),
        simpleWordStyle,
        simpleWordInkColor,
        simpleWordAccentColor,
        simpleWordLayout,
      )
    : null

  const handleStartOver = () => {
    clearWizardDraft()
    setResumableDraft(null)
    setCurrentStep('describe')
    setPrompt('')
    setNormalized(null)
    setProductId(null)
    setJobs([])
    setFinalProduct(null)
    setProductAssets([])
    setError(null)
    setSourceImages([])
    setSelectedImageId(null)
    setImageWaitCount(0)
    mockupsTriggeredRef.current = false // Reset mockup trigger flag
  }

  const handleApprove = async () => {
    if (!finalProduct) return

    setApproving(true)
    try {
      // Gallery contract: ghost mannequin → flat lay → ONE Mr Imagine → watermarked design.
      // Raw (un-watermarked) design never ships to the storefront.
      const imageUrls = buildProductGallery(productAssets)

      const { error } = await supabase
        .from('products')
        .update({
          status: 'active',
          is_active: true,
          images: imageUrls,
        })
        .eq('id', finalProduct.id)

      if (error) throw error

      clearWizardDraft()

      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.5 }
      })

      // Navigate to admin dashboard Products tab after short delay
      setTimeout(() => {
        navigate('/admin?tab=products')
      }, 1500)
    } catch (error: any) {
      console.error('[Wizard] ❌ Approve failed:', error)
      setError(error.message || 'Failed to approve product')
      setApproving(false)
    }
  }

  const handleRemoveBackground = async () => {
    if (!productId) return

    setRemovingBackground(true)
    setError(null)

    try {
      debugLog('[Wizard] 🔄 Triggering background removal for product:', productId)
      await aiProducts.removeBackground(productId)
      debugLog('[Wizard] ✅ Background removal job created')
      setRemovingBackground(false)
    } catch (error: any) {
      console.error('[Wizard] ❌ Error creating background removal job:', error)
      setError(error.message || 'Failed to start background removal')
      setRemovingBackground(false)
    }
  }

  const handleCreateMockups = async () => {
    if (!productId) return

    setCreatingMockups(true)
    setError(null)

    try {
      debugLog('[Wizard] 🔄 Triggering mockup creation for product:', productId, 'with selected image:', selectedImageId)
      // Pass the selected image ID so mockups use the correct image
      await aiProducts.createMockups(productId, selectedImageId || undefined)
      debugLog('[Wizard] ✅ Mockup jobs created')
      setCreatingMockups(false)
    } catch (error: any) {
      console.error('[Wizard] ❌ Error creating mockup jobs:', error)
      setError(error.message || 'Failed to start mockup creation')
      setCreatingMockups(false)
    }
  }

  const handleViewProduct = () => {
    // Trigger confetti animation
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    })

    setCurrentStep('success')
  }

  const handleSelectImage = async (imageId: string) => {
    if (!productId) return

    debugLog('[Wizard] 🎯 Selecting image:', imageId, 'for product:', productId)

    // Just store the selection and go to enhance-image step
    // DON'T trigger mockup yet - let user choose Remove BG / Upscale first
    setSelectedImageId(imageId)
    setCurrentStep('enhance-image')
  }

  // Called when user clicks "Generate Mockups" from enhance-image step
  const handleGenerateMockups = async () => {
    if (!productId || !selectedImageId) return

    setLoading(true)
    setError(null)
    try {
      debugLog('[Wizard] 🎭 Generating mockups for image:', selectedImageId)

      // Call the backend API to select image and trigger mockup generation
      const response = await aiProducts.selectImage(productId, selectedImageId)

      debugLog('[Wizard] ✅ Mockup job created:', response.mockupJob?.id)

      setCurrentStep('generate') // Go back to generation step to monitor mockup progress
    } catch (error: any) {
      console.error('[Wizard] ❌ Error generating mockups:', error)
      setError(error.message || 'Failed to generate mockups')
    } finally {
      setLoading(false)
    }
  }

  // Called when user clicks "Remove Background" from enhance-image step
  const handleEnhanceRemoveBackground = async () => {
    if (!productId || !selectedImageId) return

    setRemovingBackground(true)
    setError(null)
    try {
      debugLog('[Wizard] ✂️ Removing background for image:', selectedImageId)

      // Call the backend API to remove background for the selected asset
      await aiProducts.removeBackground(productId, selectedImageId)

      debugLog('[Wizard] ✅ Background removal job created')

      // Go back to generate step to monitor progress
      setCurrentStep('generate')
    } catch (error: any) {
      console.error('[Wizard] ❌ Error removing background:', error)
      setError(error.message || 'Failed to remove background')
    } finally {
      setRemovingBackground(false)
    }
  }

  const handleEditWithPrompt = async () => {
    if (!productId || !selectedImageId || !editPrompt.trim()) return

    setEditing(true)
    setError(null)
    try {
      const modelLabel = editModel === 'openai/gpt-image-2' ? 'GPT Image 2' : 'Gemini (Nano Banana)'
      debugLog('[Wizard] 🖌️ Editing image with', modelLabel, ':', selectedImageId, '→', editPrompt)
      const result = await imageFlow.edit({
        parentAssetId: selectedImageId,
        prompt: editPrompt,
        forceModel: editModel,
        preserveDesign: strictEdit, // design lock: apply ONLY the requested change
        confirmedCost: true, // both edit models (gpt-image-2, nano-banana) are cheap Replicate calls — no cost gate
      })
      debugLog('[Wizard] ✅ Edited:', result.assetId, result.url)

      // Append edited image to source list and select it
      if (result.assetId) {
        setSourceImages((prev) => [
          ...prev,
          {
            id: result.assetId,
            url: result.url,
            width: 1024,
            height: 1024,
            metadata: { model_name: `${modelLabel} (edit)` },
          },
        ])
        setSelectedImageId(result.assetId)
      }
      setEditPrompt('')
    } catch (error: any) {
      console.error('[Wizard] ❌ Edit failed:', error)
      setError(error.message || 'Failed to edit image')
    } finally {
      setEditing(false)
    }
  }

  const handleUpscale = async () => {
    if (!productId || !selectedImageId) return
    setUpscaling(true)
    setError(null)
    try {
      const result = await imageFlow.upscale({ parentAssetId: selectedImageId })
      if (result.assetId) {
        setSourceImages((prev) => [
          ...prev,
          {
            id: result.assetId,
            url: result.url,
            width: 2048,
            height: 2048,
            metadata: { model_name: 'Recraft Crisp Upscale (2x)' },
          },
        ])
        setSelectedImageId(result.assetId)
      }
    } catch (e: any) {
      console.error('[Wizard] ❌ Upscale failed:', e)
      setError(e.message || 'Failed to upscale')
    } finally {
      setUpscaling(false)
    }
  }

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId)
    setError(null)
    try {
      await aiProducts.retryJob(jobId)
      // Optimistic flip to queued — polling takes over within 2s.
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'queued', error: undefined } : j)))
    } catch (e: any) {
      console.error('[Wizard] ❌ Retry failed:', e)
      setError(e.message || 'Failed to retry job')
    } finally {
      setRetryingJobId(null)
    }
  }

  const handleHalftone = async () => {
    if (!productId || !selectedImageId) return
    setHalftoning(true)
    setError(null)
    try {
      const result = await imageFlow.halftone({
        parentAssetId: selectedImageId,
        method: halftoneMethod,
        frequency: halftoneFrequency,
        shape: halftoneShape,
        invertDark: halftoneInvert,
      })
      if (result.assetId) {
        setSourceImages((prev) => [
          ...prev,
          {
            id: result.assetId,
            url: result.url,
            width: result.width,
            height: result.height,
            metadata: { model_name: `DTF Halftone (${halftoneFrequency} LPI ${halftoneShape})` },
          },
        ])
        setSelectedImageId(result.assetId)
        setShowHalftoneOptions(false)
      }
    } catch (e: any) {
      console.error('[Wizard] ❌ Halftone failed:', e)
      setError(e.message || 'Failed to apply halftone')
    } finally {
      setHalftoning(false)
    }
  }

  const handleBgRemoveFlow = async () => {
    if (!productId || !selectedImageId) return
    setRemovingBackground(true)
    setError(null)
    try {
      const result = await imageFlow.bgRemove({ parentAssetId: selectedImageId })
      if (result.assetId) {
        setSourceImages((prev) => [
          ...prev,
          {
            id: result.assetId,
            url: result.url,
            width: 1024,
            height: 1024,
            metadata: { model_name: 'Bria BG Remove (transparent)' },
          },
        ])
        setSelectedImageId(result.assetId)
      }
    } catch (e: any) {
      console.error('[Wizard] ❌ BG remove failed:', e)
      setError(e.message || 'Failed to remove background')
    } finally {
      setRemovingBackground(false)
    }
  }

  const handleDownloadImage = async (imageUrl: string, imageName: string) => {
    try {
      debugLog('[Wizard] 📥 Downloading image:', imageName)
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = imageName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      debugLog('[Wizard] ✅ Image downloaded successfully')
    } catch (error: any) {
      console.error('[Wizard] ❌ Error downloading image:', error)
      setError('Failed to download image')
    }
  }

  const getJobStatusIcon = (status: string) => {
    switch (status) {
      case 'queued':
        return '⏳'
      case 'running':
        return '🔄'
      case 'succeeded':
        return '✅'
      case 'failed':
        return '❌'
      case 'skipped':
        return '⏭️'
      default:
        return '❓'
    }
  }

  const getJobStatusColor = (status: string) => {
    switch (status) {
      case 'queued':
        return 'bg-gray-100 text-gray-800'
      case 'running':
        return 'bg-blue-100 text-blue-800'
      case 'succeeded':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'skipped':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Progress Steps - Premium Design */}
      <div className="mb-12">
        <div className="relative bg-card/40 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl overflow-hidden">
          {/* Glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent blur-sm" />

          <div className="flex items-center justify-between relative z-10">
            {['describe', 'review', 'generate', 'success'].map((step, index) => (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center z-10 group">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-lg shadow-lg transition-all duration-500 ${currentStep === step
                      ? 'bg-gradient-to-br from-primary to-secondary text-white scale-110 shadow-[0_0_20px_rgba(168,85,247,0.5)] ring-2 ring-white/20'
                      : index < ['describe', 'review', 'generate', 'success'].indexOf(currentStep)
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                        : 'bg-card border border-white/10 text-muted group-hover:border-primary/50 group-hover:text-primary/80'
                      }`}
                  >
                    {index < ['describe', 'review', 'generate', 'success'].indexOf(currentStep) ? (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="font-display">{index + 1}</span>
                    )}
                  </div>
                  <span className={`text-sm mt-4 font-medium capitalize transition-colors duration-300 ${currentStep === step ? 'text-primary drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'text-muted'
                    }`}>{step}</span>
                </div>
                {index < 3 && (
                  <div className="flex-1 h-1 mx-4 rounded-full overflow-hidden bg-white/5 relative">
                    <div
                      className={`absolute inset-0 h-full rounded-full transition-all duration-700 ease-out ${index < ['describe', 'review', 'generate', 'success'].indexOf(currentStep)
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 w-full shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                        : 'w-0'
                        }`}
                    />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-8 bg-red-500/10 border border-red-500/30 rounded-2xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.2)] backdrop-blur-sm animate-shake">
          <div className="flex items-start space-x-3">
            <svg className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-200 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Step 1: Describe */}
      {currentStep === 'describe' && resumableDraft && (
        <div className="mb-6 bg-amber-500/10 border border-amber-400/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <History className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-text">Unfinished product draft found</p>
              <p className="text-sm text-muted truncate">
                {resumableDraft.prompt ? `“${resumableDraft.prompt.slice(0, 90)}${resumableDraft.prompt.length > 90 ? '…' : ''}”` : 'Generation in progress'}
                {' · saved '}{new Date(resumableDraft.savedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleResumeDraft}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-sm font-bold rounded-xl transition-all"
            >
              Resume draft
            </button>
            <button
              onClick={handleDiscardDraft}
              className="px-4 py-2 bg-bg/60 border border-white/10 text-muted hover:text-text text-sm font-semibold rounded-xl transition-all"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {currentStep === 'describe' && (
        <div className="bg-card/30 rounded-3xl shadow-2xl p-8 border border-white/10 backdrop-blur-sm">
          <div className="mb-8">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-3 drop-shadow-[0_0_10px_rgba(168,85,247,0.3)]">
              Describe Your Product
            </h2>
            <p className="text-muted text-lg">
              Describe your product idea in natural language. Our AI will interpret it and generate everything you need.
            </p>
          </div>

          <div className="space-y-8">
            <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 via-cyan-500/10 to-purple-500/10 p-6 shadow-xl backdrop-blur-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30">
                      <TrendingUp className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-xl font-bold text-text">Trend Scout</h3>
                      <p className="text-sm text-muted">Market-backed ideas for staff to turn into products.</p>
                    </div>
                  </div>
                </div>

                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-auto lg:grid-cols-[150px_170px_220px_auto]">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Source</span>
                    <select
                      value={trendSource}
                      onChange={(e) => setTrendSource(e.target.value as ProductTrendSource)}
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-2.5 text-sm text-text outline-none transition-all focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                    >
                      {TREND_SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Product</span>
                    <select
                      value={trendFamily}
                      onChange={(e) => setTrendFamily(e.target.value as ProductTrendFamily)}
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-2.5 text-sm text-text outline-none transition-all focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                    >
                      {TREND_FAMILY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block sm:col-span-2 lg:col-span-1">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Optional focus</span>
                    <input
                      type="text"
                      value={trendSeed}
                      onChange={(e) => setTrendSeed(e.target.value)}
                      placeholder="school, local pride, funny moms"
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-2.5 text-sm text-text outline-none transition-all placeholder:text-muted/50 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleFindTrends}
                    disabled={trendLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {trendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Find trends
                  </button>
                </div>
              </div>

              {trendError && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{trendError}</span>
                </div>
              )}

              {trendIdeas.length > 0 && (
                <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {trendIdeas.map((idea) => (
                    <article
                      key={idea.id}
                      className={`rounded-2xl border bg-bg/45 p-4 transition-all ${
                        selectedTrendId === idea.id
                          ? 'border-emerald-400/60 shadow-[0_0_0_1px_rgba(52,211,153,0.25),0_16px_40px_-24px_rgba(52,211,153,0.8)]'
                          : 'border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${trendSourceTone(idea.source)}`}>
                              {idea.source}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
                              {idea.productFamily}
                            </span>
                            <span className={`text-[11px] font-bold ${saturationTone(idea.saturation)}`}>
                              {idea.saturation} saturation
                            </span>
                          </div>
                          <h4 className="text-base font-bold text-text">{idea.title}</h4>
                        </div>
                        <ShoppingBag className="h-5 w-5 flex-shrink-0 text-emerald-300" />
                      </div>

                      <p className="mb-3 text-sm leading-relaxed text-muted">{idea.whyItMaySell}</p>

                      <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
                          <p className="font-semibold text-text">Execute as</p>
                          <p className="text-muted">{idea.category} - ${idea.priceTarget.toFixed(2)}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
                          <p className="font-semibold text-text">Style</p>
                          <p className="text-muted">{idea.designStyle || idea.imageStyle}</p>
                        </div>
                      </div>

                      {idea.evidence.length > 0 && (
                        <div className="mb-3">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Signals</p>
                          <ul className="space-y-1 text-xs text-muted">
                            {idea.evidence.slice(0, 2).map((item, index) => (
                              <li key={`${idea.id}-evidence-${index}`} className="line-clamp-2">- {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {idea.riskFlags.length > 0 && (
                        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          <span>{idea.riskFlags.slice(0, 2).join(' - ')}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleUseTrend(idea)}
                        className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold text-text transition-all hover:bg-emerald-500 hover:text-white"
                      >
                        {selectedTrendId === idea.id ? 'Idea loaded' : 'Use this idea'}
                      </button>
                    </article>
                  ))}
                </div>
              )}

              {trendNote && (
                <p className="mt-4 text-xs text-muted">{trendNote}</p>
              )}
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl backdrop-blur-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-text">Simple words front print</h3>
                  <p className="text-sm text-muted">
                    Fast lane for text-only shirt trends. Pick or type words, choose the font and ink, then create mockups from the exact text.
                  </p>
                </div>
                {simpleTextMode && (
                  <span className="rounded-full border border-emerald-400 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-950 shadow-sm dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                    Plain text renderer
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Words</span>
                  <input
                    type="text"
                    value={simpleWords}
                    onChange={(e) => {
                      const value = e.target.value
                      setSimpleWords(value)
                      if (simpleTextMode) setPrompt(`Text-only front print: "${value.trim().replace(/\s+/g, ' ')}"`)
                    }}
                    placeholder="GOOD THINGS TAKE TIME"
                    className="w-full rounded-xl border border-white/10 bg-bg/60 px-4 py-4 text-base font-semibold text-text outline-none transition-all placeholder:text-muted/50 focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[170px_150px_150px_150px_auto]">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Look</span>
                    <select
                      value={simpleWordStyle}
                      onChange={(e) => {
                        const value = e.target.value as SimpleWordStyle
                        setSimpleWordStyle(value)
                        setDesignStyle(SIMPLE_WORD_STYLE_PROMPTS[value])
                        setPrintStyle(value === 'distressed' ? 'grunge' : 'clean')
                      }}
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-3 text-sm text-text outline-none transition-all focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20"
                    >
                      {SIMPLE_WORD_STYLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Layout</span>
                    <select
                      value={simpleWordLayout}
                      onChange={(e) => setSimpleWordLayout(e.target.value as SimpleWordLayout)}
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-3 text-sm text-text outline-none transition-all focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20"
                    >
                      {SIMPLE_WORD_LAYOUT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Ink</span>
                    <select
                      value={simpleWordInkColor}
                      onChange={(e) => setSimpleWordInkColor(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-3 text-sm text-text outline-none transition-all focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20"
                    >
                      {SIMPLE_WORD_INK_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Accent</span>
                    <select
                      value={simpleWordAccentColor}
                      onChange={(e) => setSimpleWordAccentColor(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-bg/60 px-3 py-3 text-sm text-text outline-none transition-all focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20"
                    >
                      {SIMPLE_WORD_ACCENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={handleUseSimpleWords}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition-all hover:bg-purple-500 xl:self-end"
                  >
                    <Wand2 className="h-4 w-4" />
                    Use these words
                  </button>
                </div>
              </div>

              {simpleWordsLoadedMessage && (
                <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                  {simpleWordsLoadedMessage}
                </div>
              )}

              {simpleTextPreviewUrl && (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr] lg:items-center">
                  <div
                    className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-white/10 p-4 shadow-inner"
                    style={{
                      backgroundColor: '#f8fafc',
                      backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                      backgroundSize: '24px 24px',
                      backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
                    }}
                  >
                    <img src={simpleTextPreviewUrl} alt="Text design preview" className="h-[118%] w-[118%] max-w-none object-contain" />
                  </div>
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium leading-relaxed text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100">
                    This preview is the source artwork. The app saves it as a transparent PNG first, then uses that exact file for mockups. No AI image model rewrites the letters.
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted">
                  No phrase yet? Generate a batch of short, generic phrases from current marketplace signals.
                </p>
                <button
                  type="button"
                  onClick={handleRandomPhrases}
                  disabled={phraseLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-bold text-text transition-all hover:border-purple-400/40 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {phraseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-purple-200" />}
                  Random phrases
                </button>
              </div>

              {phraseError && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{phraseError}</span>
                </div>
              )}

              {phraseIdeas.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {phraseIdeas.map((idea) => (
                    <article
                      key={idea.id}
                      className={`rounded-2xl border bg-bg/45 p-4 transition-all ${
                        selectedPhraseId === idea.id
                          ? 'border-purple-400/60 shadow-[0_0_0_1px_rgba(192,132,252,0.25)]'
                          : 'border-white/10 hover:border-white/25'
                      }`}
                    >
                      <p className="mb-2 text-lg font-black uppercase tracking-wide text-text">{idea.phrase}</p>
                      <p className="mb-3 text-xs leading-relaxed text-muted">{idea.whyItMaySell}</p>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
                          {idea.audience}
                        </span>
                        <span className="rounded-full border border-purple-400/20 bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-200">
                          {idea.vibe}
                        </span>
                      </div>
                      {idea.riskFlags.length > 0 && (
                        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          <span>{idea.riskFlags.slice(0, 2).join(' - ')}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => loadSimpleWordsPhrase(idea.phrase, idea.id)}
                        className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold text-text transition-all hover:bg-purple-600 hover:text-white"
                      >
                        {selectedPhraseId === idea.id ? 'Loaded in form' : 'Fill form with phrase'}
                      </button>
                    </article>
                  ))}
                </div>
              )}

              {phraseNote && (
                <p className="mt-4 text-xs text-muted">{phraseNote}</p>
              )}

              <p className="mt-3 text-xs text-muted">
                Best for simple word shirts where spelling and readable typography matter more than AI illustration.
              </p>
            </section>

            <div>
              <label className="block text-sm font-semibold text-text mb-3 flex items-center">
                <svg className="w-5 h-5 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {simpleTextMode ? 'Product Idea *' : 'Product Description *'}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="w-full bg-bg/50 border border-white/10 rounded-xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all shadow-inner text-text placeholder:text-muted/50"
                placeholder="Example: A t-shirt with a futuristic cyberpunk cityscape, neon lights reflecting off rain-soaked streets, featuring a lone figure in a hoodie..."
              />
              <p className="text-xs text-muted mt-2 ml-1">
                {simpleTextMode
                  ? 'This stays clean for staff review. The text design comes from the preview above, not an AI image prompt.'
                  : 'Be as detailed as you want. Mention style, colors, themes, target audience, etc.'}
              </p>
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-text hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {uploadedImageUrl ? "Change Design Image" : "Upload Design Image"}
                  </button>
                  {uploadedImageUrl && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Image uploaded
                    </span>
                  )}
                </div>

                {uploadedImageUrl && (
                  <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-white/10 shadow-lg">
                    <img src={uploadedImageUrl} alt="Uploaded" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setUploadedImageUrl(null)}
                      className="absolute top-1 right-1 bg-red-500/80 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Product Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="dtf-transfers">DTF Transfers</option>
                  <option value="shirts">T-Shirts</option>
                  <option value="hoodies">Hoodies</option>
                  <option value="tumblers">Tumblers</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Target Price ($)
                </label>
                <input
                  type="number"
                  value={priceTarget}
                  onChange={(e) => setPriceTarget(parseFloat(e.target.value))}
                  step="0.01"
                  min="0"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text"
                />
              </div>

            </div>

            {/* Advanced settings — everything inside has sane defaults; most
                products ship without touching any of it. Keeping it collapsed
                turns the page into: idea → category/price → DTF settings → Next. */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl bg-bg/40 border border-white/10 hover:border-white/20 transition-all"
            >
              <span className="text-sm font-semibold text-text flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-primary" />
                Advanced settings
                <span className="text-xs font-normal text-muted hidden sm:inline">
                  audience · art style · scene · web search — all optional
                </span>
              </span>
              <span className="text-muted text-xl leading-none">{showAdvanced ? '−' : '+'}</span>
            </button>

            {showAdvanced && (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Target Audience
                </label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g., gamers, fitness enthusiasts"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text placeholder:text-muted/50"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Primary Colors
                </label>
                <input
                  type="text"
                  value={primaryColors}
                  onChange={(e) => setPrimaryColors(e.target.value)}
                  placeholder="e.g., neon blue, hot pink, black"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text placeholder:text-muted/50"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Design Style/Aesthetic
                </label>
                <input
                  type="text"
                  value={designStyle}
                  onChange={(e) => setDesignStyle(e.target.value)}
                  placeholder="e.g., cyberpunk, minimalist, retro"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text placeholder:text-muted/50"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Mockup Style
                </label>
                <select
                  value={mockupStyle}
                  onChange={(e) => setMockupStyle(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="casual">Casual Wear</option>
                  <option value="lifestyle">Lifestyle Shot</option>
                  <option value="product">Product Focus</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Background Style
                </label>
                <select
                  value={background}
                  onChange={(e) => setBackground(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="studio">Studio / White</option>
                  <option value="lifestyle">Lifestyle Scene</option>
                  <option value="urban">Urban Environment</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Brand Tone
                </label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="professional">Professional</option>
                  <option value="playful">Playful</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>
            </div>

            {/* Web Search Toggle */}
            <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-2xl p-6 border border-blue-500/20 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="block text-lg font-bold text-text mb-2 flex items-center">
                    <svg className="w-6 h-6 mr-2 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Web Search Enhancement
                  </label>
                  <p className="text-sm text-muted">
                    Uses Google to gather accurate, real-time context about your product topic. Recommended for pop culture, games, movies, and trending topics.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseSearch(!useSearch)}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${useSearch
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-gray-600 border-gray-600'
                    }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${useSearch ? 'translate-x-6' : 'translate-x-0'
                      }`}
                  />
                </button>
              </div>
            </div>

            {/* Image Style Selection - Prominent Feature */}
            <div className="bg-gradient-to-br from-purple-500/10 via-indigo-500/10 to-blue-500/10 rounded-2xl p-8 border border-purple-500/20 shadow-xl backdrop-blur-sm">
              <label className="block text-xl font-bold text-text mb-2 flex items-center">
                <svg className="w-6 h-6 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                Image Art Style *
              </label>
              <p className="text-sm text-muted mb-6">
                Choose the artistic style for your product image. This affects how the AI generates the visual artwork.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <button
                  type="button"
                  onClick={() => setImageStyle('realistic')}
                  className={`p-6 rounded-2xl border transition-all duration-300 transform hover:scale-105 ${imageStyle === 'realistic'
                    ? 'border-primary bg-primary/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] ring-1 ring-primary/50'
                    : 'border-white/10 bg-card/50 hover:border-primary/50 hover:shadow-lg'
                    }`}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">📸</div>
                    <h4 className="font-bold text-text mb-2 text-lg">Realistic</h4>
                    <p className="text-sm text-muted">Photo-realistic, detailed, lifelike imagery</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setImageStyle('semi-realistic')}
                  className={`p-6 rounded-2xl border transition-all duration-300 transform hover:scale-105 ${imageStyle === 'semi-realistic'
                    ? 'border-primary bg-primary/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] ring-1 ring-primary/50'
                    : 'border-white/10 bg-card/50 hover:border-primary/50 hover:shadow-lg'
                    }`}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">🎭</div>
                    <h4 className="font-bold text-text mb-2 text-lg">Semi-Realistic</h4>
                    <p className="text-sm text-muted">Balanced blend of realism and artistic style</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setImageStyle('cartoon')}
                  className={`p-6 rounded-2xl border transition-all duration-300 transform hover:scale-105 ${imageStyle === 'cartoon'
                    ? 'border-primary bg-primary/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] ring-1 ring-primary/50'
                    : 'border-white/10 bg-card/50 hover:border-primary/50 hover:shadow-lg'
                    }`}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">🎨</div>
                    <h4 className="font-bold text-text mb-2 text-lg">Cartoon</h4>
                    <p className="text-sm text-muted">Illustrated, stylized, playful artwork</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Process card — GPT Image 2 pipeline */}
            <div className="bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 rounded-2xl p-6 border border-cyan-500/20 shadow-xl backdrop-blur-sm">
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-text mb-2 flex items-center">
                    Multi-model generation pipeline
                    <span className="ml-2 px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-[10px] font-semibold rounded-full uppercase tracking-wider">4 models in parallel</span>
                  </h3>
                  <p className="text-muted text-sm mb-4">
                    Four image models race in parallel — you pick the best result. Edits and mockups run on a separate dedicated edit model (your choice in the next step).
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                    <div className="flex items-center space-x-2 bg-card/30 rounded-lg px-3 py-2 border border-white/5">
                      <span className="text-base">🎨</span>
                      <div className="text-xs">
                        <p className="font-semibold text-text leading-tight">Recraft V4</p>
                        <p className="text-muted leading-tight">design-first, print-ready</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 bg-card/30 rounded-lg px-3 py-2 border border-white/5">
                      <span className="text-base">🌀</span>
                      <div className="text-xs">
                        <p className="font-semibold text-text leading-tight">Grok Imagine</p>
                        <p className="text-muted leading-tight">stylized, fast</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 bg-card/30 rounded-lg px-3 py-2 border border-white/5">
                      <span className="text-base">🌟</span>
                      <div className="text-xs">
                        <p className="font-semibold text-text leading-tight">Imagen 4 Ultra</p>
                        <p className="text-muted leading-tight">photoreal</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 bg-card/30 rounded-lg px-3 py-2 border border-white/5">
                      <span className="text-base">🔬</span>
                      <div className="text-xs">
                        <p className="font-semibold text-text leading-tight">Wan 2.7 Pro</p>
                        <p className="text-muted leading-tight">4K, reasoning</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-muted text-xs">
                    For shirt/hoodie/tank categories the prompt is auto-wrapped with DTF rules: transparent background, isolated artwork, no clothing in the design.
                  </p>
                </div>
              </div>
            </div>
            </>
            )}

            {/* DTF Print Optimization Settings */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] dark:bg-white/[0.025] backdrop-blur-2xl p-6 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
              {/* Atmospheric glass orbs + hairline top highlight */}
              <span aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-purple-500/20 blur-3xl" />
              <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-20 h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              <div className="relative">
              <h3 className="text-xl font-bold text-text mb-2 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-[0_8px_22px_-6px_rgba(99,102,241,0.7)] ring-1 ring-white/20">
                  <Shirt className="h-5 w-5" />
                </span>
                <span>DTF Print Settings</span>
              </h3>
              <p className="text-muted text-sm mb-6">
                These settings tune the prompt for DTF print quality and shape the three generated mockups.
              </p>

              {/* Product Type Selection */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-text mb-3">
                  Product Type
                </label>
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  {([
                    { type: 'tshirt', label: 'T-Shirt' },
                    { type: 'hoodie', label: 'Hoodie' },
                    { type: 'tank', label: 'Tank Top' },
                  ] as const).map(({ type, label }) => {
                    const active = productType === type
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setProductType(type)}
                        className={`${glassTileBase} ${glassTileState(active)} p-3 sm:p-4`}
                      >
                        <TileChrome active={active} />
                        <div className="relative flex flex-col items-center">
                          <div className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-white/[0.08] to-black/20 ring-1 ring-inset ring-white/10">
                            <span
                              aria-hidden
                              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.18),transparent_70%)]"
                            />
                            <img
                              src={garmentImage(type, shirtColor)}
                              alt={`${label} preview`}
                              loading="lazy"
                              draggable={false}
                              className="relative h-[5.5rem] w-auto object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-[1.06]"
                            />
                          </div>
                          <p className="mt-2.5 text-sm font-semibold text-text">{label}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Color Selection */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-text mb-3">
                  {productType === 'tshirt' ? 'Shirt' : productType === 'hoodie' ? 'Hoodie' : 'Tank'} Color
                </label>
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  {([
                    { value: 'black', label: 'Black', hint: 'Vibrant colors', sw: 'bg-gray-900 ring-white/25' },
                    { value: 'white', label: 'White', hint: 'High contrast', sw: 'bg-white ring-gray-300' },
                    { value: 'gray', label: 'Gray', hint: 'Bold saturated', sw: 'bg-gray-500 ring-gray-400' },
                  ] as const).map(({ value, label, hint, sw }) => {
                    const active = shirtColor === value
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setShirtColor(value)}
                        className={`${glassTileBase} ${glassTileState(active)} p-4`}
                      >
                        <TileChrome active={active} />
                        <div className="relative flex flex-col items-center">
                          <span
                            className={`h-10 w-10 rounded-full ring-2 ${sw} shadow-[0_4px_12px_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:scale-110`}
                          />
                          <p className="mt-2 text-sm font-semibold text-text">{label}</p>
                          <p className="text-xs text-muted">{hint}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Print Placement Selection */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-text mb-3">
                  Print Placement
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  {([
                    { value: 'front-center', label: 'Front Center', hint: 'Classic placement' },
                    { value: 'left-pocket', label: 'Left Pocket', hint: 'Small logo/icon' },
                    { value: 'back-only', label: 'Back Only', hint: 'Full back print' },
                    { value: 'pocket-front-back-full', label: 'Pocket + Back', hint: 'Front pocket + back' },
                  ] as const).map(({ value, label, hint }) => {
                    const active = printPlacement === value
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPrintPlacement(value)}
                        className={`${glassTileBase} ${glassTileState(active)} p-4`}
                      >
                        <TileChrome active={active} />
                        <div className="relative flex flex-col items-center">
                          <PlacementGlyph kind={value} active={active} />
                          <p className="mt-1.5 text-sm font-semibold text-text">{label}</p>
                          <p className="text-xs text-muted">{hint}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Print Locations (T-shirt multi-select) — persisted to products.print_locations */}
              {category === 'shirts' && (
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-text mb-2">
                    Print Locations
                  </label>
                  <PrintLocationsDropdown selected={printLocations} onChange={setPrintLocations} />
                  <p className="text-xs text-muted mt-2">
                    Which placements this T-shirt is offered with. Pick multiples — front image, back image, and/or pocket.
                  </p>
                </div>
              )}

              {/* Print Style */}
              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Print Style
                </label>
                <select
                  value={printStyle}
                  onChange={(e) => setPrintStyle(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="clean">Clean (modern, sharp edges)</option>
                  <option value="halftone">Halftone (vintage, comic-book dots)</option>
                  <option value="grunge">Grunge (distressed, worn texture)</option>
                </select>
                <p className="text-xs text-muted mt-2">
                  Professional effects applied during optimization.
                </p>
              </div>

              {/* Mockup preview note — 3 variants from the same design */}
              <div className="mt-6 bg-primary/10 border border-primary/30 rounded-xl p-4">
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">🖼️</span>
                  <div className="flex-1">
                    <p className="font-semibold text-text">Three mockups, one click</p>
                    <p className="text-sm text-muted mb-3">
                      A {shirtColor} {productType} with the design at the {printPlacement.replace(/-/g, ' ')} position will be rendered as:
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-bg/40 rounded-lg px-2 py-1.5 border border-white/5 text-center">
                        <p className="text-xs font-semibold text-text">👻 Ghost mannequin</p>
                        <p className="text-[10px] text-muted">primary image</p>
                      </div>
                      <div className="bg-bg/40 rounded-lg px-2 py-1.5 border border-white/5 text-center">
                        <p className="text-xs font-semibold text-text">📸 Flat lay</p>
                        <p className="text-[10px] text-muted">studio shot</p>
                      </div>
                      <div className="bg-bg/40 rounded-lg px-2 py-1.5 border border-white/5 text-center">
                        <p className="text-xs font-semibold text-text">🎭 Mr. Imagine</p>
                        <p className="text-[10px] text-muted">lifestyle</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={handleDescribe}
                disabled={loading}
                className="group relative bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold px-10 py-4 rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-2xl hover:shadow-purple-500/50 transform hover:scale-105"
              >
                <span className="flex items-center space-x-2">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <span>{simpleTextMode ? 'Create Text Product' : 'Create Product'}</span>
                      <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {currentStep === 'review' && normalized && (
        <div className="bg-gradient-to-br from-white to-purple-50/30 dark:from-gray-900 dark:to-purple-950/20 rounded-3xl shadow-2xl p-8 border border-purple-200/50 dark:border-purple-800/50 backdrop-blur-sm">
          <div className="mb-8">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent mb-3">
              Review AI Interpretation
            </h2>
            <p className="text-muted text-lg">
              Here's how our AI interpreted your product. You can proceed with generation or start over to make changes.
            </p>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/30 dark:to-indigo-900/30 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-3 text-lg flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Product Title
              </h3>
              <p className="text-text text-xl font-semibold">{normalized.title}</p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-3 text-lg flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                Description
              </h3>
              <p className="text-text leading-relaxed">{normalized.description}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
                <h3 className="font-bold text-text mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  Category
                </h3>
                <p className="text-text capitalize text-lg font-semibold">{normalized.category_slug}</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
                <h3 className="font-bold text-text mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Suggested Price
                </h3>
                <p className="text-text text-2xl font-bold text-green-600">${(normalized.suggested_price_cents / 100).toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Tags
              </h3>
              <div className="flex flex-wrap gap-3">
                {normalized.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-4 py-2 bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/50 dark:to-indigo-900/50 text-purple-800 dark:text-purple-200 rounded-full text-sm font-semibold shadow-md"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                Variants
              </h3>
              <div className="space-y-3">
                {normalized.variants.map((variant, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-700"
                  >
                    <span className="text-text font-semibold">
                      {variant.name}
                    </span>
                    <span className="font-bold text-text px-3 py-1 bg-white dark:bg-gray-700 rounded-lg shadow">
                      {variant.priceDeltaCents
                        ? `+$${(variant.priceDeltaCents / 100).toFixed(2)}`
                        : 'Base price'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <button
                onClick={handleStartOver}
                className="group bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                <span className="flex items-center space-x-2">
                  <svg className="w-5 h-5 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                  </svg>
                  <span>Start Over</span>
                </span>
              </button>
              <button
                onClick={handleReview}
                className="group bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-purple-500/50 transform hover:scale-105"
              >
                <span className="flex items-center space-x-2">
                  <span>Generate Assets</span>
                  <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Generate */}
      {currentStep === 'generate' && (() => {
        // Live progress: derive from job statuses + per-job step/total_steps
        const imageJob = jobs.find(j => (j.type === 'replicate_image' || j.type === 'replicate_image_v2'))
        const mockupJobs = jobs.filter(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2') || j.type === 'ghost_mannequin')
        const stages = [
          { key: 'image', label: 'Generating designs', weight: 50, job: imageJob },
          { key: 'mockup', label: 'Rendering mockups', weight: 50, jobs: mockupJobs },
        ]
        let percent = 0
        // Image stage (50%)
        if (imageJob) {
          if (imageJob.status === 'succeeded') {
            percent += 50
          } else if (imageJob.status === 'running') {
            const step = imageJob.output?.step ?? 0
            const total = imageJob.output?.total_steps ?? 3
            percent += Math.min(50, (step / total) * 50)
          }
        }
        // Mockup stage (50%) — proportional to completed
        if (mockupJobs.length > 0) {
          const done = mockupJobs.filter(j => j.status === 'succeeded' || j.status === 'failed' || j.status === 'skipped').length
          percent += (done / mockupJobs.length) * 50
        }
        const progressMessage =
          imageJob?.status === 'running' && imageJob.output?.message
            ? imageJob.output.message
            : mockupJobs.some(j => j.status === 'running')
              ? mockupJobs.find(j => j.status === 'running')?.output?.message ?? 'Rendering mockups…'
              : imageJob?.status === 'queued'
                ? 'Queued — waiting for worker…'
                : 'Working…'
        return (
        <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/10 ring-1 ring-white/5">
          <div className="mb-8">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary via-purple-400 to-secondary bg-clip-text text-transparent mb-3 flex items-center drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              <svg className="w-8 h-8 mr-3 text-primary animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Generating Assets
            </h2>
            <p className="text-muted text-lg">
              4 models race in parallel for the design (~30–60s), you pick a favorite, then 3 mockups render (~30s).
            </p>
          </div>

          {/* Live progress bar — driven by job.output.step / total_steps + mockup completion */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-text">{progressMessage}</span>
              <span className="text-xs text-muted font-mono">{Math.round(percent)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-bg/60 border border-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary via-purple-400 to-secondary transition-all duration-500 ease-out shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
              />
            </div>
          </div>

          {/* Progress Timeline */}
          <div className="mb-10 bg-bg/40 backdrop-blur-sm rounded-2xl p-8 border border-white/10 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
            <h3 className="font-semibold text-text mb-6 flex items-center text-lg">
              <svg className="w-5 h-5 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI Generation Process
            </h3>
            <div className="space-y-6 relative">
              {/* Vertical Line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-white/10"></div>

              <div className="flex items-start space-x-4 relative z-10">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold shadow-[0_0_10px_rgba(34,197,94,0.5)]">✓</div>
                <div>
                  <p className="font-medium text-text">Step 1: Search & Context Gathering</p>
                  <p className="text-muted text-sm mt-1">Using SerpAPI to gather accurate, current information about your product topic</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold shadow-[0_0_10px_rgba(34,197,94,0.5)]">✓</div>
                <div>
                  <p className="font-medium text-text">Step 2: AI Product Analysis</p>
                  <p className="text-muted text-sm mt-1">GPT analyzes context and generates detailed product metadata and image descriptions</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ${jobs.some(j => (j.type === 'replicate_image' || j.type === 'replicate_image_v2') && j.status === 'running') ? 'bg-primary animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.6)]' : jobs.some(j => (j.type === 'replicate_image' || j.type === 'replicate_image_v2') && j.status === 'succeeded') ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-white/10 border border-white/20'}`}>
                  {jobs.some(j => (j.type === 'replicate_image' || j.type === 'replicate_image_v2') && j.status === 'succeeded') ? '✓' : '3'}
                </div>
                <div>
                  <p className={`font-medium transition-colors ${jobs.some(j => (j.type === 'replicate_image' || j.type === 'replicate_image_v2') && j.status === 'running') ? 'text-primary' : 'text-text'}`}>Step 3: Generate the design</p>
                  <p className="text-muted text-sm mt-1">GPT Image 2 renders the design from the GPT-enhanced prompt (~10 seconds)</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold bg-white/10 border border-white/20">3.5</div>
                <div>
                  <p className="font-medium text-text">Step 3.5: Refine <span className="text-xs text-muted font-normal">(optional)</span></p>
                  <p className="text-muted text-sm mt-1">Iterate on the design with prompt edits, then continue when you're happy</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                {(() => {
                  const mockupSucceededCount = jobs.filter(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2') && j.status === 'succeeded').length
                  const mockupTotal = jobs.filter(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2')).length
                  const allDone = mockupTotal > 0 && mockupSucceededCount === mockupTotal
                  const running = jobs.some(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2') && j.status === 'running')
                  return (
                    <>
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ${running ? 'bg-primary animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.6)]' : allDone ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-white/10 border border-white/20'}`}>
                        {allDone ? '✓' : '4'}
                      </div>
                      <div>
                        <p className={`font-medium transition-colors ${running ? 'text-primary' : 'text-text'}`}>
                          Step 4: Generate mockups
                          {mockupTotal > 0 && (
                            <span className="ml-2 text-xs text-muted font-normal">({mockupSucceededCount}/{mockupTotal})</span>
                          )}
                        </p>
                        <p className="text-muted text-sm mt-1">GPT Image 2 composites the design onto a ghost mannequin, flat lay, and Mr. Imagine — in parallel</p>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* Job Status Cards */}
          <div className="space-y-5">
            {jobs.length === 0 ? (
              <div className="text-center py-12 bg-card/20 backdrop-blur-sm rounded-2xl border border-white/10 shadow-xl">
                <div className="relative w-20 h-20 mx-auto mb-6">
                  <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin shadow-[0_0_15px_rgba(168,85,247,0.4)]"></div>
                </div>
                <p className="text-muted text-lg font-semibold">Initializing AI jobs...</p>
              </div>
            ) : (
              jobs.map((job, index) => (
                <div
                  key={job.id}
                  className={`relative overflow-hidden flex items-center justify-between p-6 rounded-2xl border transition-all duration-500 shadow-lg ${job.status === 'running'
                    ? 'bg-card/60 border-primary/50 shadow-[0_0_20px_rgba(168,85,247,0.15)] ring-1 ring-primary/30'
                    : job.status === 'succeeded'
                      ? 'bg-card/40 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]'
                      : job.status === 'failed'
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-card/20 border-white/5'
                    }`}
                >
                  {job.status === 'running' && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer" style={{ backgroundSize: '200% 100%' }}></div>
                  )}

                  <div className="flex items-center space-x-5 relative z-10">
                    <div className={`text-4xl transition-transform duration-500 ${job.status === 'running' ? 'animate-pulse scale-110' : ''}`}>
                      {getJobStatusIcon(job.status)}
                    </div>
                    <div>
                      <p className="font-bold text-text text-xl mb-1">
                        {(job.type === 'replicate_image' || job.type === 'replicate_image_v2') && '🎨 Product Image Generation'}
                        {job.type === 'replicate_rembg' && '✂️ Background Removal'}
                        {job.type === 'ghost_mannequin' && '👻 Ghost Mannequin Mockup'}
                        {(job.type === 'replicate_mockup' || job.type === 'replicate_mockup_v2') && job.input?.template === 'flat_lay' && '🖼️ Flat Lay Mockup'}
                        {(job.type === 'replicate_mockup' || job.type === 'replicate_mockup_v2') && job.input?.template === 'mr_imagine' && '🎭 Mr. Imagine Mockup'}
                        {(job.type === 'replicate_mockup' || job.type === 'replicate_mockup_v2') && !job.input?.template && '🖼️ Mockup Generation'}
                      </p>
                      <p className="text-sm text-muted font-medium">
                        {/* Show real-time progress message from worker if available */}
                        {job.status === 'running' && job.output?.message ? (
                          <span className="flex items-center gap-2">
                            <span className="animate-pulse">{job.output.message}</span>
                            {job.output.step && job.output.total_steps && (
                              <span className="text-xs text-primary">
                                ({job.output.step}/{job.output.total_steps})
                              </span>
                            )}
                          </span>
                        ) : (
                          <>
                            {job.status === 'queued' && (job.type === 'replicate_image' || job.type === 'replicate_image_v2') && 'Waiting to start generation...'}
                            {job.status === 'queued' && job.type === 'replicate_rembg' && 'Waiting for source image...'}
                            {job.status === 'queued' && (job.type === 'replicate_mockup' || job.type === 'replicate_mockup_v2') && 'Waiting for background removal...'}
                            {job.status === 'queued' && job.type === 'ghost_mannequin' && 'Waiting for design image...'}
                            {job.status === 'running' && (job.type === 'replicate_image' || job.type === 'replicate_image_v2') && 'Generating with GPT Image 2...'}
                            {job.status === 'running' && job.type === 'replicate_rembg' && 'Removing background with AI...'}
                            {job.status === 'running' && (job.type === 'replicate_mockup' || job.type === 'replicate_mockup_v2') && 'Applying design to mockup...'}
                            {job.status === 'running' && job.type === 'ghost_mannequin' && 'Creating ghost mannequin mockup...'}
                            {job.status === 'succeeded' && 'Complete! Image ready.'}
                            {job.status === 'skipped' && 'Skipped (not applicable)'}
                            {job.status === 'failed' && 'Generation failed. Please try again.'}
                          </>
                        )}
                      </p>
                      {job.error && (
                        <p className="text-sm text-red-400 mt-2 font-bold bg-red-950/50 border border-red-500/30 px-3 py-1 rounded-lg inline-block">
                          Error: {job.error}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 relative z-10">
                    {job.status === 'failed' && (
                      <button
                        onClick={() => handleRetryJob(job.id)}
                        disabled={retryingJobId === job.id}
                        className="px-5 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-400 hover:to-orange-400 text-white shadow-md disabled:opacity-50 transition-all flex items-center"
                      >
                        {retryingJobId === job.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Retrying…
                          </>
                        ) : (
                          'Retry'
                        )}
                      </button>
                    )}
                    <span
                      className={`px-5 py-2 rounded-xl text-sm font-bold uppercase shadow-md backdrop-blur-md border ${getJobStatusColor(
                        job.status
                      )}`}
                    >
                      {job.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Manual Workflow: Source Image Preview + Remove Background OR Skip Button */}
          {productAssets.some(asset => asset.kind === 'source') && !jobs.some(j => j.type === 'replicate_rembg') && !jobs.some(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2')) && (
            <div className="mt-10 bg-card/30 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
              <h3 className="font-bold text-text text-2xl mb-4 text-center">Source Image Generated!</h3>
              <div className="bg-bg/50 rounded-xl p-6 mb-6 border border-white/5">
                <img
                  src={productAssets.find(asset => asset.kind === 'source')?.url}
                  alt="Source product image"
                  className="w-full max-w-md mx-auto rounded-lg shadow-lg"
                />
              </div>
              <div className="text-center">
                <p className="text-muted mb-4">Next step: Remove the background for better mockup quality, or skip to mockups</p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={handleRemoveBackground}
                    disabled={removingBackground || creatingMockups}
                    className="group bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-primary/50 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center space-x-2 text-lg">
                      <span>{removingBackground ? 'Starting...' : 'Remove Background'}</span>
                      <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </span>
                  </button>
                  <button
                    onClick={handleCreateMockups}
                    disabled={removingBackground || creatingMockups}
                    className="group bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-green-500/50 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center space-x-2 text-lg">
                      <span>{creatingMockups ? 'Starting...' : 'Skip to Mockups'}</span>
                      <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Manual Workflow: Background Removed Preview + Create Mockups Button */}
          {productAssets.some(asset => asset.kind === 'nobg') && !jobs.some(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2')) && (
            <div className="mt-10 bg-card/30 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
              <h3 className="font-bold text-text text-2xl mb-4 text-center">Background Removed!</h3>
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="bg-bg/50 rounded-xl p-4 border border-white/5">
                  <p className="text-sm text-muted text-center mb-2">With Background</p>
                  <img
                    src={selectedImageId
                      ? productAssets.find(asset => asset.id === selectedImageId)?.url
                      : productAssets.find(asset => asset.kind === 'source')?.url}
                    alt="Source product image"
                    className="w-full rounded-lg shadow-lg"
                  />
                </div>
                <div className="bg-bg/50 rounded-xl p-4 border border-white/5">
                  <p className="text-sm text-muted text-center mb-2">Without Background</p>
                  <img
                    src={productAssets.find(asset => asset.kind === 'nobg')?.url}
                    alt="Product without background"
                    className="w-full rounded-lg shadow-lg"
                  />
                </div>
              </div>
              <div className="text-center">
                <p className="text-muted mb-4">Next step: Generate mockups with the clean product image</p>
                <button
                  onClick={handleCreateMockups}
                  disabled={creatingMockups}
                  className="group bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-primary/50 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center space-x-2 text-lg">
                    <span>{creatingMockups ? 'Starting...' : 'Create Mockups'}</span>
                    <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Manual Workflow: Mockups Complete + View Product Button */}
          {jobs.filter(j => (j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2') && j.status === 'succeeded').length === 2 && (
            <div className="mt-10 text-center bg-card/30 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
              <svg className="w-16 h-16 mx-auto mb-4 text-green-500 animate-bounce drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="font-bold text-text text-2xl mb-4">All Mockups Generated!</h3>
              <div className="grid grid-cols-2 gap-6 mb-6">
                {productAssets.filter(asset => asset.kind === 'mockup').map((asset, index) => (
                  <div key={asset.id} className="bg-bg/50 rounded-xl p-4 border border-white/5">
                    <p className="text-sm text-muted text-center mb-2">Mockup #{index + 1}</p>
                    <img
                      src={asset.url}
                      alt={`Product mockup ${index + 1}`}
                      className="w-full rounded-lg shadow-lg"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={handleViewProduct}
                className="group bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-primary/50 transform hover:scale-105"
              >
                <span className="flex items-center space-x-2 text-lg">
                  <span>View Product</span>
                  <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </button>
            </div>
          )}
        </div>
        )
      })()}

      {/* Step 3.5: Confirm generated design — pick from 4-model fan-out */}
      {currentStep === 'select-image' && (() => {
        const imageJob = jobs.find(j => (j.type === 'replicate_image' || j.type === 'replicate_image_v2'))
        const allModelResults: Array<{ modelId: string; modelLabel: string; status: string; error?: string | null }> =
          imageJob?.output?.results ?? []
        const failed = allModelResults.filter(r => r.status === 'failed')
        const totalAttempted = allModelResults.length || sourceImages.length
        return (
        <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/10 ring-1 ring-white/5">
          <div className="mb-6">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary via-purple-400 to-secondary bg-clip-text text-transparent mb-3 flex items-center drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              <Sparkles className="w-8 h-8 mr-3 text-primary" />
              Pick your favorite
            </h2>
            <p className="text-muted">
              {sourceImages.length} of {totalAttempted} models delivered. Pick one to refine — your edits will use GPT Image 2 from there.
            </p>
          </div>

          {failed.length > 0 && (
            <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm">
              <p className="text-amber-300 font-semibold mb-1">
                {failed.length} model{failed.length > 1 ? 's' : ''} declined or timed out
              </p>
              <ul className="text-amber-200/80 text-xs space-y-0.5">
                {failed.map(f => (
                  <li key={f.modelId}>
                    <span className="font-mono text-amber-300/90">{f.modelLabel}</span>
                    {f.error ? <span className="text-amber-200/60"> — {f.error.slice(0, 120)}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="text-amber-200/70 text-xs mt-2">
                Common causes: content moderation flagged the prompt, or the model was overloaded. Try rewording or proceed with the survivors below.
              </p>
            </div>
          )}

          <div className={`grid gap-6 mb-8 ${sourceImages.length === 1 ? 'grid-cols-1 max-w-lg mx-auto' : sourceImages.length === 2 ? 'grid-cols-1 md:grid-cols-2' : sourceImages.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
            {sourceImages.map((image, index) => {
              const isSelected = selectedImageId === image.id
              const modelLabel = image.metadata?.model_name ?? 'AI Generated'
              return (
                <div
                  key={image.id}
                  className={`relative bg-bg/40 backdrop-blur-sm rounded-2xl border transition-all duration-300 overflow-hidden animate-fade-in hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(168,85,247,0.25)] ${
                    isSelected
                      ? 'border-primary/70 ring-2 ring-primary/50 shadow-[0_0_30px_rgba(168,85,247,0.3)]'
                      : 'border-white/10 hover:border-primary/40'
                  }`}
                  style={{ animationDelay: `${index * 140}ms`, animationFillMode: 'backwards' }}
                >
                  <div className="aspect-square bg-bg/60 overflow-hidden">
                    <img
                      src={image.url}
                      alt={`Generated design ${index + 1}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-primary truncate" title={modelLabel}>{modelLabel}</span>
                      <span className="text-[11px] text-text/70 flex-shrink-0">{image.width}×{image.height}</span>
                    </div>
                    {image.metadata?.tailored_prompt && (
                      <p
                        className="text-[11px] text-muted/80 mb-3 line-clamp-2 italic"
                        title={image.metadata.tailored_prompt}
                      >
                        Prompt tuned for this model: “{image.metadata.tailored_prompt}”
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSelectImage(image.id)}
                        disabled={loading}
                        className="flex-1 bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold px-4 py-2.5 rounded-xl shadow-lg shadow-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center"
                      >
                        Refine this
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </button>
                      <button
                        onClick={() => handleDownloadImage(image.url, `design-v${index + 1}-${image.id}.png`)}
                        disabled={loading}
                        className="bg-bg/60 hover:bg-bg/80 border border-white/10 hover:border-white/20 text-text/80 hover:text-text px-3 py-2.5 rounded-xl transition-all"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 backdrop-blur-sm flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-muted text-sm">
              Click <span className="text-text font-semibold">Refine this</span> to open the studio editor. You can iterate with prompts there — every edit becomes a new version you can flip back to.
            </p>
          </div>

          {error && (
            <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400">{error}</p>
            </div>
          )}
        </div>
        )
      })()}

      {/* Step 3.5: Refine — studio layout with prompt-based editing */}
      {currentStep === 'enhance-image' && selectedImageId && (() => {
        const currentImage = sourceImages.find(img => img.id === selectedImageId)
        const versions = sourceImages
        const currentVersionIdx = versions.findIndex(v => v.id === selectedImageId)
        const prevVersion = currentVersionIdx > 0 ? versions[currentVersionIdx - 1] : null
        const QUICK_EDITS = [
          { label: 'Bolder colors', prompt: 'Boost color saturation and contrast for a punchier look. Keep the design composition exactly the same.' },
          { label: 'Cleaner lines', prompt: 'Sharpen and clean up the line work. Keep the design composition, colors, and subject identical.' },
          { label: 'Halftone style', prompt: 'Apply a halftone print style with visible dot patterns. Keep all subjects and colors the same.' },
          { label: 'Vintage / retro', prompt: 'Apply a vintage retro screen-print aesthetic with slight texture and faded colors. Preserve the subject.' },
          { label: 'Brighter highlights', prompt: 'Brighten the highlights and add a subtle glow. Keep all colors and composition the same.' },
        ]
        return (
          <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl border border-white/10 ring-1 ring-white/5 overflow-hidden">
            {/* Header */}
            <div className="px-8 pt-8 pb-6 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-primary via-purple-400 to-secondary bg-clip-text text-transparent mb-2 flex items-center drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
                    <Sparkles className="w-8 h-8 mr-3 text-primary" />
                    Refine Your Design
                  </h2>
                  <p className="text-muted">
                    Iterate with GPT Image 2 — describe a change in plain English. Each edit becomes a new version.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Step 3 of 4</p>
                  <p className="text-text/70 text-sm">Powered by GPT Image 2</p>
                </div>
              </div>
            </div>

            {/* Studio: preview (left) + actions (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
              {/* Preview pane */}
              <div className="lg:col-span-3 p-8 border-r border-white/10">
                <div className="relative aspect-square bg-gradient-to-br from-bg/60 via-bg/40 to-bg/60 rounded-2xl overflow-hidden border border-white/10 shadow-inner">
                  {currentImage ? (
                    <>
                      <img
                        src={comparingPrev && prevVersion ? prevVersion.url : currentImage.url}
                        alt="Current design"
                        className="w-full h-full object-contain"
                      />
                      {comparingPrev && prevVersion && (
                        <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-bg/80 backdrop-blur-md border border-white/20 text-xs text-text font-medium">
                          Previous version (v{currentVersionIdx})
                        </div>
                      )}
                      {editing && (() => {
                        // No progress events from the API — drive a believable bar off
                        // elapsed time vs the model's typical duration, asymptotic to 94%.
                        const isGpt = editModel === 'openai/gpt-image-2'
                        const expected = isGpt ? 25 : 8
                        const pct = Math.min(94, Math.round(100 * (1 - Math.exp(-editElapsed / (expected * 0.85)))))
                        const stage = pct < 18
                          ? 'Sending your design…'
                          : pct < 72
                            ? `${isGpt ? 'GPT Image 2' : 'Gemini (Nano Banana)'} is repainting…`
                            : 'Polishing & saving…'
                        return (
                          <div className="absolute inset-0 bg-bg/85 backdrop-blur-sm flex flex-col items-center justify-center px-10">
                            <img
                              src="/mr-imagine/mr-imagine-waving.png"
                              alt=""
                              className="w-16 h-16 object-contain mb-3 animate-bounce"
                              style={{ animationDuration: '2s' }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                            <p className="text-text font-semibold">{stage}</p>
                            <p className="text-muted text-xs mt-1 mb-4">
                              {Math.floor(editElapsed)}s elapsed · usually ~{expected}s
                            </p>
                            <div className="w-full max-w-xs h-2.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary via-purple-400 to-secondary rounded-full transition-[width] duration-300 ease-out shadow-[0_0_12px_rgba(168,85,247,0.6)]"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-muted/80 text-[11px] mt-2">{pct}%</p>
                            {strictEdit && (
                              <div className="mt-3 flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 border border-primary/40">
                                <Check className="w-3 h-3 text-primary" />
                                <span className="text-[11px] text-text/90 font-medium">Design lock on — only your change</span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      {removingBackground && (
                        <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm flex flex-col items-center justify-center">
                          <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                          <p className="text-text font-medium">Removing background…</p>
                        </div>
                      )}
                      {/* Floating download */}
                      <button
                        onClick={() => handleDownloadImage(currentImage.url, `design-${currentImage.id}.png`)}
                        className="absolute top-3 right-3 w-10 h-10 rounded-full bg-bg/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-text/70 hover:text-text hover:bg-bg/90 transition-all"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {/* Hold to compare with the previous version */}
                      {prevVersion && !editing && (
                        <button
                          onPointerDown={() => setComparingPrev(true)}
                          onPointerUp={() => setComparingPrev(false)}
                          onPointerLeave={() => setComparingPrev(false)}
                          onContextMenu={(e) => e.preventDefault()}
                          className="absolute bottom-3 left-3 px-3.5 py-2 rounded-full bg-bg/70 backdrop-blur-md border border-white/10 flex items-center gap-2 text-xs text-text/80 hover:text-text hover:bg-bg/90 transition-all select-none"
                          title="Press and hold to see the version before this edit"
                        >
                          <History className="w-3.5 h-3.5" />
                          Hold to compare
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted">Loading…</div>
                  )}
                </div>

                {/* Version history strip */}
                {versions.length > 1 && (
                  <div className="mt-6">
                    <div className="flex items-center text-xs uppercase tracking-wider text-muted mb-3">
                      <History className="w-3.5 h-3.5 mr-1.5" />
                      Versions ({versions.length})
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                      {versions.map((v, i) => {
                        const isActive = v.id === selectedImageId
                        return (
                          <button
                            key={v.id}
                            onClick={() => setSelectedImageId(v.id)}
                            className={`relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${
                              isActive
                                ? 'border-primary shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                                : 'border-white/10 hover:border-white/30'
                            }`}
                            title={v.metadata?.model_name || `Version ${i + 1}`}
                          >
                            <img src={v.url} alt={`Version ${i + 1}`} className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-bg/90 to-transparent px-1 py-0.5">
                              <p className="text-[10px] text-text font-medium truncate">v{i + 1}</p>
                            </div>
                            {isActive && (
                              <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Action panel */}
              <div className="lg:col-span-2 p-8 bg-bg/20 flex flex-col">
                {/* Edit-model picker */}
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-wider text-muted mb-2">Edit model</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setEditModel('openai/gpt-image-2')}
                      disabled={editing}
                      className={`px-3 py-2 rounded-lg text-left text-xs transition-all border ${
                        editModel === 'openai/gpt-image-2'
                          ? 'bg-primary/15 border-primary/50 text-text shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                          : 'bg-bg/40 border-white/10 text-text/70 hover:text-text hover:border-white/20'
                      } disabled:opacity-40`}
                    >
                      <p className="font-semibold">GPT Image 2</p>
                      <p className="text-[10px] text-muted/80 mt-0.5">~25s Â· $0.04</p>
                    </button>
                    <button
                      onClick={() => setEditModel('google/nano-banana')}
                      disabled={editing}
                      className={`px-3 py-2 rounded-lg text-left text-xs transition-all border ${
                        editModel === 'google/nano-banana'
                          ? 'bg-primary/15 border-primary/50 text-text shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                          : 'bg-bg/40 border-white/10 text-text/70 hover:text-text hover:border-white/20'
                      } disabled:opacity-40`}
                    >
                      <p className="font-semibold">Gemini (Nano Banana)</p>
                      <p className="text-[10px] text-muted/80 mt-0.5">~8s · $0.04</p>
                    </button>
                  </div>
                </div>

                {/* Design lock — strict-fidelity edits */}
                <div className="mb-4">
                  <button
                    onClick={() => setStrictEdit(s => !s)}
                    disabled={editing}
                    className={`w-full px-3.5 py-3 rounded-xl text-left transition-all border flex items-center gap-3 ${
                      strictEdit
                        ? 'bg-primary/10 border-primary/40'
                        : 'bg-bg/40 border-white/10 hover:border-white/20'
                    } disabled:opacity-40`}
                    title="When on, the model is instructed to change ONLY what you ask for — nothing added, removed, or redrawn"
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                        strictEdit ? 'bg-primary' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          strictEdit ? 'translate-x-[18px]' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text">Stay true to the design</span>
                      <span className="block text-[11px] text-muted mt-0.5">
                        Locks subject, composition, colors & style — applies only your requested change. Turn off for big reimaginings.
                      </span>
                    </span>
                  </button>
                </div>

                {/* Prompt-edit (primary) */}
                <div className="mb-6">
                  <label className="flex items-center text-sm font-semibold text-text mb-2">
                    <Wand2 className="w-4 h-4 mr-2 text-primary" />
                    Describe an edit
                  </label>
                  <p className="text-muted text-xs mb-3">
                    Say what changes <span className="text-text/80">and</span> what stays the same.
                  </p>
                  <textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="e.g., Recolor the lettering to neon teal, keep everything else the same"
                    className="w-full bg-bg/60 border border-white/10 rounded-xl p-3.5 text-text placeholder-muted/60 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/40 transition-all text-sm"
                    rows={4}
                    disabled={editing}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        if (editPrompt.trim() && !editing) handleEditWithPrompt()
                      }
                    }}
                  />
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[11px] text-muted/70">⌘/Ctrl + Enter to apply</p>
                    <button
                      onClick={handleEditWithPrompt}
                      disabled={editing || !editPrompt.trim()}
                      className="bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold px-5 py-2 rounded-xl shadow-lg shadow-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center"
                    >
                      {editing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Editing
                        </>
                      ) : (
                        <>
                          Apply edit
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Quick edits */}
                <div className="mb-6">
                  <p className="text-xs uppercase tracking-wider text-muted mb-2">Quick edits</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_EDITS.map((q) => (
                      <button
                        key={q.label}
                        onClick={() => setEditPrompt(q.prompt)}
                        disabled={editing}
                        className="text-xs px-3 py-1.5 rounded-full bg-bg/60 border border-white/10 text-text/80 hover:text-text hover:bg-primary/10 hover:border-primary/40 disabled:opacity-40 transition-all"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="flex items-center my-2">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="px-3 text-xs uppercase tracking-wider text-muted/60">Other tools</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                {/* Remove BG */}
                <button
                  onClick={handleBgRemoveFlow}
                  disabled={removingBackground || upscaling || loading || editing}
                  className="w-full bg-bg/40 hover:bg-bg/60 border border-white/10 hover:border-white/20 rounded-xl p-4 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between mt-4"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-purple-400/30 flex items-center justify-center mr-3">
                      <Scissors className="w-5 h-5 text-purple-300" />
                    </div>
                    <div>
                      <p className="font-semibold text-text text-sm">Remove background</p>
                      <p className="text-muted text-xs">Clean transparent PNG (Bria) — $0.018</p>
                    </div>
                  </div>
                  {removingBackground ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-muted" />
                  )}
                </button>

                {/* Upscale */}
                <button
                  onClick={handleUpscale}
                  disabled={upscaling || removingBackground || loading || editing}
                  className="w-full bg-bg/40 hover:bg-bg/60 border border-white/10 hover:border-white/20 rounded-xl p-4 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between mt-3"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/30 border border-cyan-400/30 flex items-center justify-center mr-3">
                      <svg className="w-5 h-5 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-text text-sm">Upscale 2x</p>
                      <p className="text-muted text-xs">Recraft Crisp Upscale — $0.006</p>
                    </div>
                  </div>
                  {upscaling ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-muted" />
                  )}
                </button>

                {/* DTF Halftone */}
                <button
                  onClick={() => setShowHalftoneOptions((v) => !v)}
                  disabled={halftoning || upscaling || removingBackground || loading || editing}
                  className="w-full bg-bg/40 hover:bg-bg/60 border border-white/10 hover:border-white/20 rounded-xl p-4 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between mt-3"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/30 border border-amber-400/30 flex items-center justify-center mr-3">
                      <svg className="w-5 h-5 text-amber-300" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="5" cy="5" r="2.4" /><circle cx="12" cy="5" r="1.8" /><circle cx="19" cy="5" r="1.2" />
                        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="0.9" />
                        <circle cx="5" cy="19" r="1.2" /><circle cx="12" cy="19" r="0.9" /><circle cx="19" cy="19" r="0.6" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-text text-sm">DTF Halftone</p>
                      <p className="text-muted text-xs">Real dot-screen for breathable prints — free</p>
                    </div>
                  </div>
                  {halftoning ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <ArrowRight className={`w-4 h-4 text-muted transition-transform ${showHalftoneOptions ? 'rotate-90' : ''}`} />
                  )}
                </button>

                {showHalftoneOptions && (
                  <div className="mt-2 bg-bg/60 border border-amber-400/20 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted block mb-1">Dot frequency (LPI)</label>
                        <select
                          value={halftoneFrequency}
                          onChange={(e) => setHalftoneFrequency(Number(e.target.value))}
                          className="w-full bg-bg/80 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-text"
                        >
                          <option value={25}>25 — chunky retro</option>
                          <option value={35}>35 — classic DTF</option>
                          <option value={45}>45 — fine detail</option>
                          <option value={60}>60 — extra fine</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted block mb-1">Style</label>
                        <select
                          value={halftoneMethod === 'diffusion' ? 'diffusion' : halftoneShape}
                          onChange={(e) => {
                            const v = e.target.value
                            if (v === 'diffusion') { setHalftoneMethod('diffusion') }
                            else { setHalftoneMethod('halftone'); setHalftoneShape(v as 'round' | 'line') }
                          }}
                          className="w-full bg-bg/80 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-text"
                        >
                          <option value="round">Round dots</option>
                          <option value="line">Line screen</option>
                          <option value="diffusion">Grain (diffusion)</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center text-sm text-text/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={halftoneInvert}
                        onChange={(e) => setHalftoneInvert(e.target.checked)}
                        className="mr-2 accent-amber-400"
                      />
                      Invert for dark shirts
                    </label>
                    <button
                      onClick={handleHalftone}
                      disabled={halftoning}
                      className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-semibold py-2.5 rounded-lg disabled:opacity-40 transition-all flex items-center justify-center text-sm"
                    >
                      {halftoning ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Screening…
                        </>
                      ) : (
                        'Apply halftone'
                      )}
                    </button>
                  </div>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Continue CTA */}
                <button
                  onClick={handleGenerateMockups}
                  disabled={loading || editing || removingBackground}
                  className="mt-6 w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Starting mockups…
                    </>
                  ) : (
                    <>
                      Continue to mockups
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Footer: back link + error */}
            <div className="px-8 py-5 border-t border-white/10 bg-bg/20">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCurrentStep('select-image')}
                  className="text-muted hover:text-text transition-colors flex items-center text-sm"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to image selection
                </button>
                <p className="text-xs text-muted">
                  Edits are non-destructive — switch versions any time
                </p>
              </div>
              {error && (
                <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 flex items-start">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Step 4: Success */}
      {currentStep === 'success' && finalProduct && (
        <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl p-10 border border-white/10 ring-1 ring-white/5">
          {/* Success Header */}
          <div className="text-center mb-10">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full animate-pulse shadow-[0_0_30px_rgba(52,211,153,0.5)]"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-14 h-14 text-white animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent mb-3 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]">
              Product Created Successfully!
            </h2>
            <p className="text-muted text-xl">
              Your AI-generated product is ready for review
            </p>
          </div>

          {/* Product Details Card */}
          <div className="bg-bg/40 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-white/10 shadow-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted mb-1">Product Name</p>
                <p className="font-semibold text-text text-lg">{finalProduct.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Status</p>
                <span className="inline-block px-3 py-1 bg-yellow-500/20 text-yellow-200 border border-yellow-500/30 rounded-full text-sm font-semibold">
                  Draft
                </span>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Price</p>
                <p className="font-semibold text-text text-lg">${finalProduct.price}</p>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Product ID</p>
                <p className="font-mono text-sm text-muted">{finalProduct.id.substring(0, 8)}...</p>
              </div>
            </div>
          </div>

          {/* Generated Assets Gallery - Display only primary design + mockups */}
          <div className="mb-6">
            <h3 className="font-semibold text-text mb-4 text-lg flex items-center">
              <svg className="w-5 h-5 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Product Images
            </h3>

            {(() => {
              // Filter for display assets: primary design + mockups only.
              // Dedupe by asset_role — keep the LATEST per role (defensive against prod-orphan duplicates).
              const filtered = productAssets
                .filter((a: any) => a.is_primary || a.asset_role?.startsWith('mockup_'))
              const seen = new Set<string>()
              const displayAssets = filtered
                .slice()
                .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                .filter((a: any) => {
                  const key = a.asset_role ?? a.kind
                  if (seen.has(key)) return false
                  seen.add(key)
                  return true
                })
                .sort((a: any, b: any) => (a.display_order || 99) - (b.display_order || 99))

              // Helper to get display label for asset
              const getAssetLabel = (asset: any) => {
                if (asset.is_primary || asset.asset_role === 'design') return 'Selected Design'
                if (asset.asset_role === 'mockup_flat_lay') return 'Flat Lay Mockup'
                if (asset.asset_role === 'mockup_mr_imagine') return 'Mr. Imagine Mockup'
                if (asset.kind === 'mockup') return 'Mockup'
                return asset.kind
              }

              if (displayAssets.length === 0) {
                return (
                  <div className="text-center py-8 bg-bg/30 rounded-lg border border-white/5">
                    <p className="text-muted">No images generated yet. Assets may still be processing.</p>
                  </div>
                )
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {displayAssets.map((asset: any) => (
                    <div key={asset.id} className="border border-white/10 rounded-xl overflow-hidden group hover:shadow-xl hover:shadow-primary/20 transition-all duration-300">
                      <div className="relative">
                        <img
                          src={asset.url}
                          alt={getAssetLabel(asset)}
                          className="w-full h-64 object-cover"
                        />
                        {asset.is_primary && (
                          <div className="absolute top-2 left-2 bg-primary/90 text-white text-xs px-2 py-1 rounded-full font-semibold">
                            Primary
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center backdrop-blur-sm">
                          <a
                            href={asset.url}
                            download
                            className="bg-white text-gray-900 px-4 py-2 rounded-lg font-bold hover:bg-gray-100 transition-all flex items-center space-x-2 transform translate-y-4 group-hover:translate-y-0 duration-300"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            <span>Download</span>
                          </a>
                        </div>
                      </div>
                      <div className="p-3 bg-card/50 backdrop-blur-sm">
                        <p className="text-sm font-medium text-text">{getAssetLabel(asset)}</p>
                        <p className="text-xs text-muted">{asset.width} x {asset.height}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-8 border-t border-white/10">
            <button
              onClick={handleStartOver}
              className="group w-full md:w-auto bg-white/5 hover:bg-white/10 text-text font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-105 border border-white/10"
            >
              <span className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5 transition-transform group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Create Another Product</span>
              </span>
            </button>
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <button
                onClick={() => navigate('/admin?tab=products')}
                className="group text-center bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-105 border border-white/10"
              >
                <span className="flex items-center justify-center space-x-2">
                  <svg className="w-5 h-5 transition-transform group-hover:rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Edit in Products Tab</span>
                </span>
              </button>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="group bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold px-10 py-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-2xl hover:shadow-emerald-500/50 transform hover:scale-105"
              >
                <span className="flex items-center justify-center space-x-2">
                  {approving ? (
                    <>
                      <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Approving...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-6 h-6 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Approve & Publish</span>
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}




