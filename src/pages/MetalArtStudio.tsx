// src/pages/MetalArtStudio.tsx
//
// Metal Art Studio — Displate-style premium metal print designer.
//
// Price constants are exported so admin catalog items can reference them
// when building their own metal-art product entries.
// eslint-disable-next-line react-refresh/only-export-components
export const METAL_ART_PRICES: Record<string, number> = {
  '4x6': 14.99,
  '8x11': 29.99,
}

// Physical dimensions (portrait orientation) in pixels at ~72 dpi equivalent
const PLATE_DIMS: Record<string, { w: number; h: number; labelIn: string }> = {
  '4x6':  { w: 240, h: 360,  labelIn: '4 × 6"' },
  '8x11': { w: 330, h: 454,  labelIn: '8 × 11"' },
}

// Wall-scene plate position/size as % of container (left%, top%, w%)
const SCENE_PLATE: Record<string, { left: string; top: string; width: string }> = {
  living: { left: '34%', top: '18%', width: '28%' },
  office: { left: '38%', top: '20%', width: '25%' },
}

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ChangeEvent,
} from 'react'
import { Link } from 'react-router-dom'
import {
  Upload,
  Sparkles,
  Layers,
  ShoppingCart,
  Star,
  ChevronRight,
  Minus,
  Plus,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react'

import { apiFetch, imaginationApi } from '../lib/api'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { usdToItcLabel } from '../lib/itc-pricing'
import type { Product } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SizeKey   = '4x6' | '8x11'
type Finish    = 'matte' | 'glossy'
type Scene     = 'studio' | 'living' | 'office'
type ArtTab    = 'upload' | 'generate'

interface GeneratedImage {
  url: string
  modelId: string
  modelLabel: string
  prompt?: string
}

// ---------------------------------------------------------------------------
// Style starters
// ---------------------------------------------------------------------------
// Each starter is a STYLE the user picks as a framework. `framework` is the
// aesthetic only (no subject) — it wraps whatever the user types so e.g.
// "a lion" + Anime style = an anime lion, not the showcase scene. `showcase`
// is the full demo prompt used only when the user picks a style but types
// nothing (and is what generated the thumbnail).
const METAL_STARTERS: { slug: string; label: string; framework: string; showcase: string }[] = [
  {
    slug: 'cosmic',
    label: 'Cosmic',
    framework: 'rendered as cosmic deep-space art: swirling nebula clouds of magenta, teal and gold, brilliant stars, glowing light, ultra-detailed astrophotography look, vivid saturated color, dramatic depth, gallery wall-art poster, 2K, no text',
    showcase: 'A breathtaking cosmic nebula in deep space, swirling clouds of magenta, teal and gold, brilliant stars and a glowing galaxy core, ultra-detailed astrophotography, dramatic depth, vivid saturated color, gallery wall-art poster, high dynamic range, 2K, no text',
  },
  {
    slug: 'fluid',
    label: 'Fluid Art',
    framework: 'rendered as abstract fluid art: marbled swirls with metallic gold and jewel tones, high-gloss sheen, organic flowing shapes, rich contrast, luxury gallery print, elegant modern wall art, 2K, no text',
    showcase: 'Abstract fluid art, marbled swirls of metallic gold, sapphire blue and crimson, organic flowing shapes with high-gloss sheen, luxury gallery print, rich contrast, macro detail, elegant modern wall art, 2K, no text',
  },
  {
    slug: 'deco',
    label: 'Art Deco',
    framework: 'in bold Art Deco poster style: geometric symmetry, gold, black and emerald palette, 1920s luxury aesthetic, clean vector-sharp lines, high-contrast editorial composition, premium wall-art print, 2K, no text',
    showcase: 'Bold Art Deco poster, symmetrical geometric sunburst, gold and black with emerald accents, 1920s luxury aesthetic, clean vector-sharp lines, high-contrast editorial composition, premium wall-art print, 2K, no text',
  },
  {
    slug: 'travel',
    label: 'Travel Poster',
    framework: 'as a vintage WPA travel poster: screen-print texture, warm retro palette, bold layered composition, golden-hour light, dramatic depth, gallery print, 2K, no text',
    showcase: 'Vintage national-park travel poster, dramatic mountain range at golden hour, layered depth, screen-print texture, warm retro palette, bold composition, WPA poster style, gallery print, 2K, no text',
  },
  {
    slug: 'botanical',
    label: 'Botanical',
    framework: 'as a lush botanical illustration: emerald and gold ink on a deep dark background, fine detailed linework, elegant symmetrical layout, luxury wall-art print, 2K, no text',
    showcase: 'Lush botanical illustration, monstera and tropical leaves, deep emerald and gold ink on dark background, fine detailed linework, elegant symmetrical layout, luxury wall-art print, 2K, no text',
  },
  {
    slug: 'geometric',
    label: 'Geometric',
    framework: 'in minimal geometric-abstract style: bold simple shapes, muted earth tones with a single vivid accent, clean negative space, modern Scandinavian poster aesthetic, crisp edges, gallery print, 2K, no text',
    showcase: 'Minimal geometric abstract, bold interlocking shapes in muted earth tones with a single vivid accent, clean negative space, modern Scandinavian poster aesthetic, crisp edges, gallery print, 2K, no text',
  },
  {
    slug: 'anime',
    label: 'Anime Scene',
    framework: 'in cinematic anime art style: vibrant Makoto Shinkai color, dramatic lighting, sweeping skies, ultra-detailed scenery, poster composition, 2K, no text',
    showcase: 'Cinematic anime landscape, a lone figure on a hill beneath a vast sunset sky, sweeping clouds, vibrant Makoto Shinkai style color, dramatic lighting, ultra-detailed scenery, poster composition, 2K, no text',
  },
  {
    slug: 'wildlife',
    label: 'Wildlife',
    framework: 'as a fine-art wildlife portrait: dramatic rim lighting against a dark background, hyper-detailed, intense and majestic, rich shadows, gallery wall print, 2K, no text',
    showcase: 'Majestic wildlife portrait, a powerful lion in dramatic rim lighting against a dark background, hyper-detailed fur, intense gaze, fine-art photography, rich shadows, gallery wall print, 2K, no text',
  },
]

// ---------------------------------------------------------------------------
// Prompt composition. The selected STYLE is the framework; the user's text is
// the subject. Subject leads so it's never ignored; the style frames it.
// ---------------------------------------------------------------------------
function enrichMetalPrompt(raw: string): string {
  if (raw.length >= 120) return raw
  return `${raw}, gallery wall-art print, vivid saturated color, dramatic composition, high detail, professional poster art`
}

function buildMetalPrompt(userText: string, styleSlug: string | null): string {
  const subject = userText.trim()
  const style = styleSlug ? METAL_STARTERS.find(s => s.slug === styleSlug) ?? null : null
  if (subject && style) return `${subject}, ${style.framework}`   // subject leads, style frames
  if (subject) return enrichMetalPrompt(subject)                   // free-typed only
  if (style) return style.showcase                                 // style picked, no text → demo scene
  return ''
}

// ---------------------------------------------------------------------------
// MetalPlate sub-component
// ---------------------------------------------------------------------------
interface MetalPlateProps {
  artworkUrl: string
  size: SizeKey
  finish: Finish
}

function MetalPlate({ artworkUrl, size, finish }: MetalPlateProps) {
  const { w, h } = PLATE_DIMS[size]
  const isGlossy = finish === 'glossy'

  return (
    <div
      style={{
        width:  w,
        height: h,
        position: 'relative',
        borderRadius: 6,
        overflow: 'hidden',
        // Deep shadow for museum-quality feel
        boxShadow: isGlossy
          ? '0 20px 60px rgba(0,0,0,0.85), 0 4px 12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.25), inset -1px -1px 0 rgba(0,0,0,0.5)'
          : '0 16px 48px rgba(0,0,0,0.75), 0 4px 10px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12), inset -1px -1px 0 rgba(0,0,0,0.45)',
        transition: 'box-shadow 0.3s ease',
        flexShrink: 0,
      }}
      className={`group ${isGlossy ? 'glossy-plate' : ''}`}
    >
      {/* Artwork base layer */}
      <img
        src={artworkUrl}
        alt="Metal art preview"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          filter: isGlossy ? 'saturate(1.1) contrast(1.04)' : 'saturate(0.92) contrast(0.98)',
        }}
      />

      {/* Brushed aluminum texture overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/metal-art/plate-texture.webp)',
          backgroundSize: 'cover',
          mixBlendMode: 'overlay',
          opacity: 0.18,
          pointerEvents: 'none',
        }}
      />

      {/* Diagonal sheen gradient — glossy only, animates on hover */}
      {isGlossy && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, transparent 60%)',
            pointerEvents: 'none',
            transition: 'opacity 0.4s ease',
          }}
          className="opacity-100 group-hover:opacity-0"
        />
      )}
      {isGlossy && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, transparent 0%, rgba(255,255,255,0.18) 40%, transparent 80%)',
            pointerEvents: 'none',
            transition: 'opacity 0.4s ease',
            transform: 'translateX(-100%)',
          }}
          className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-700"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function MetalArtStudio() {
  const { addToCart } = useCart()
  const { user } = useAuth()
  const toast = useToast()

  // ----- Artwork state -----
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null)
  const [artTab, setArtTab] = useState<ArtTab>('upload')

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // Generate
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const [prompt, setPrompt] = useState('')
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  const [genCount, setGenCount] = useState<1 | 2 | 3 | 4>(1)
  const [generating, setGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [itcCost, setItcCost]   = useState<number | null>(null)
  const [freeTrial, setFreeTrial] = useState(false)

  // Preview
  const [size, setSize]     = useState<SizeKey>('8x11')
  const [finish, setFinish] = useState<Finish>('glossy')
  const [scene, setScene]   = useState<Scene>('studio')

  // Order
  const [qty, setQty]             = useState(1)
  const [addingToCart, setAddingToCart] = useState(false)
  const [cartAdded, setCartAdded] = useState(false)

  // Earn
  const [designName, setDesignName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  // ----- Fetch wallet + pricing on mount -----
  useEffect(() => {
    if (!user?.id) return

    const fetchWallet = async () => {
      try {
        const response = await apiFetch('/api/wallet/get')
        if (response?.wallet?.itc_balance) {
          setWalletBalance(Number(response.wallet.itc_balance))
        }
      } catch {
        // non-critical — wallet just won't show
      }
    }

    const fetchPricing = async () => {
      try {
        const res = await imaginationApi.getPricing()
        const data = res.data as {
          pricing: Array<{ feature_key: string; current_cost: number }>
          freeTrials: Array<{ feature_key: string; uses_remaining: number }>
        }
        const genPricing = data.pricing?.find(p => p.feature_key === 'generate')
        if (genPricing) setItcCost(genPricing.current_cost)
        const trialEntry = data.freeTrials?.find(t => t.feature_key === 'generate')
        setFreeTrial((trialEntry?.uses_remaining ?? 0) > 0)
      } catch {
        // non-critical
      }
    }

    fetchWallet()
    fetchPricing()
  }, [user?.id])

  // ----- Upload handler -----
  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File too large', 'Maximum upload size is 15 MB.')
      return
    }

    setUploading(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await apiFetch('/api/imagination-station/ai/use-upload', {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      })

      const uploadedUrl: string = res?.url ?? dataUrl
      setArtworkUrl(uploadedUrl)
      setGeneratedImages([])
      toast.success('Artwork uploaded', 'Scroll down to preview it on metal.')
    } catch (err: unknown) {
      toast.error('Upload failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [toast])

  // ----- Generate handler -----
  const handleGenerate = useCallback(async () => {
    const finalPrompt = buildMetalPrompt(prompt, selectedStyle)
    if (!finalPrompt) {
      toast.warning('Pick a style or describe your art', 'Choose a style above, type what you want, or both.')
      return
    }
    setGenerating(true)
    setGeneratedImages([])
    try {
      const res = await imaginationApi.generateImage({
        prompt: finalPrompt,
        style: 'metal-art',
        count: genCount,
      })

      const payload = res.data as {
        // New shape
        images?: GeneratedImage[]
        cost?: number
        freeTrialUsed?: boolean
        // Legacy single-image shape
        imageUrl?: string
        url?: string
        output?: string
        processedUrl?: string
      }

      // Parse: prefer new images[] array; fall back to legacy single-image fields
      let parsed: GeneratedImage[] = []
      if (Array.isArray(payload.images) && payload.images.length > 0) {
        parsed = payload.images
      } else {
        const legacyUrl =
          payload.imageUrl ?? payload.url ?? payload.output ?? payload.processedUrl ?? null
        if (legacyUrl) {
          parsed = [{ url: legacyUrl, modelId: 'ai', modelLabel: 'AI' }]
        }
      }

      setGeneratedImages(parsed)
      if (payload.freeTrialUsed) setFreeTrial(false)

      // Refresh wallet after spend
      if (user?.id) {
        const wRes = await apiFetch('/api/wallet/get').catch(() => null)
        if (wRes?.wallet?.itc_balance !== undefined) {
          setWalletBalance(Number(wRes.wallet.itc_balance))
        }
      }

      if (parsed.length === 0) {
        toast.warning('No images returned', 'Try adjusting your prompt.')
      }
    } catch (err: unknown) {
      toast.error('Generation failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setGenerating(false)
    }
  }, [prompt, selectedStyle, genCount, user?.id, toast])

  // ----- Add to cart -----
  const handleAddToCart = useCallback(async () => {
    if (!artworkUrl) return
    setAddingToCart(true)
    try {
      const dims = PLATE_DIMS[size]
      const sizeLabel = dims.labelIn
      const price = METAL_ART_PRICES[size]

      const product: Product = {
        id: `metal-art-custom-${Date.now()}`,
        name: `Custom Metal Art Print ${sizeLabel}`,
        description: `Museum-grade ${finish} metal print — ${sizeLabel}. Magnet-mounted steel plate, vivid full-color print, arrives ready to hang.`,
        price,
        category: 'metal-art',
        images: [artworkUrl],
        inStock: true,
        metadata: {
          size,
          width_in:  size === '4x6' ? 4 : 8,
          height_in: size === '4x6' ? 6 : 11,
          finish,
          artwork_url: artworkUrl,
          custom: true,
        },
      }

      addToCart(
        product,
        qty,
        size,        // selectedSize
        undefined,   // selectedColor
        artworkUrl,  // customDesign
        {
          elements: [],
          template: 'metal-art',
          mockupUrl: artworkUrl,
        },
      )

      setCartAdded(true)
      toast.success('Added to cart', `${qty} × Custom Metal Art Print ${sizeLabel} — $${(price * qty).toFixed(2)}`)
    } catch (err: unknown) {
      toast.error('Failed to add to cart', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setAddingToCart(false)
    }
  }, [artworkUrl, size, finish, qty, addToCart, toast])

  // ----- Submit design to earn -----
  const handleSubmitDesign = useCallback(async () => {
    if (!artworkUrl) return
    if (!designName.trim()) {
      toast.warning('Name required', 'Give your design a name before submitting.')
      return
    }
    setSubmitting(true)
    try {
      await apiFetch('/api/imagination-station/designs/submit', {
        method: 'POST',
        body: JSON.stringify({
          name: designName.trim(),
          design_concept: designName.trim(),
          preview_url: artworkUrl,
          style: 'metal-art',
          category: 'metal-art',
        }),
      })
      setSubmitted(true)
    } catch (err: unknown) {
      toast.error('Submission failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [artworkUrl, designName, toast])

  // ----- Derived -----
  // Free trial covers the FIRST image; remaining images cost itcCost each.
  const perImageCost = itcCost ?? 0
  const chargeableCount = Math.max(0, genCount - (freeTrial ? 1 : 0))
  const totalGenCost = perImageCost * chargeableCount
  const costLabel = totalGenCost > 0
    ? `${totalGenCost} ITC`
    : (freeTrial ? 'Free trial' : 'Free')
  const price = METAL_ART_PRICES[size]
  const canGenerate = (prompt.trim().length > 0 || !!selectedStyle) && !generating

  // =====================================================================
  // RENDER
  // =====================================================================
  return (
    <div
      style={{ backgroundColor: '#fafafa', minHeight: '100vh', color: '#111827' }}
      className="font-sans"
    >
      {/* ----------------------------------------------------------------
          HERO
      ---------------------------------------------------------------- */}
      <section
        className="relative flex flex-col items-center justify-center text-center overflow-hidden"
        style={{ minHeight: '92vh' }}
      >
        {/* Background wall scene — lightened for the hero */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: 'url(/metal-art/wall-scene-living.webp)',
            filter: 'brightness(0.72) saturate(0.75)',
          }}
        />
        {/* White gradient overlay at bottom so text stays readable */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(255,255,255,0.55) 100%)' }}
        />

        {/* Sample plate composited on hero */}
        <div
          className="absolute"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -70%)',
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 260,
              height: 390,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #8a8a8a 0%, #c8c8c8 40%, #9a9a9a 100%)',
              boxShadow: '0 24px 72px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          />
        </div>

        {/* Hero text */}
        <div className="relative z-10 px-6 max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-6">
            <img src="/icons/icon-metal-art.webp" alt="Metal Art Studio" className="w-10 h-10 rounded-xl object-contain shadow-sm" />
            <p
              className="text-xs uppercase tracking-[0.35em]"
              style={{ color: '#7c3aed', fontWeight: 600 }}
            >
              Imagine This Printed
            </p>
          </div>
          <h1
            className="font-bold tracking-tight mb-6"
            style={{
              fontSize: 'clamp(2.4rem, 6vw, 5rem)',
              lineHeight: 1.05,
              color: '#111827',
              textShadow: '0 2px 12px rgba(255,255,255,0.8)',
            }}
          >
            YOUR ART.
            <br />
            ON METAL.
          </h1>
          <p
            className="text-lg max-w-xl mx-auto mb-10"
            style={{ color: '#374151', lineHeight: 1.6 }}
          >
            Museum-grade metal prints, made by you — designed, printed and shipped
            by Imagine This Printed.
          </p>
          <button
            onClick={() => {
              document.getElementById('step-1')?.scrollIntoView({ behavior: 'smooth' })
            }}
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded font-semibold text-sm uppercase tracking-wider transition-all"
            style={{
              backgroundColor: '#7c3aed',
              color: '#ffffff',
              boxShadow: '0 4px 20px rgba(124,58,237,0.35)',
            }}
          >
            Start creating
            <ChevronRight size={16} />
          </button>
        </div>
      </section>

      {/* ----------------------------------------------------------------
          STEP 1 — GET YOUR ARTWORK
      ---------------------------------------------------------------- */}
      <section id="step-1" className="py-24 px-6" style={{ backgroundColor: '#ffffff' }}>
        <div className="max-w-3xl mx-auto">
          <StepLabel number={1} />
          <h2 className="text-3xl font-bold mb-2" style={{ color: '#111827' }}>
            Get your artwork
          </h2>
          <p className="mb-10 text-sm" style={{ color: '#4b5563' }}>
            Upload an existing image or generate something new with AI.
          </p>

          {/* Tab bar */}
          <div className="flex mb-8 border-b" style={{ borderColor: '#e5e7eb' }}>
            {(['upload', 'generate'] as ArtTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setArtTab(tab)}
                className="flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors capitalize"
                style={{
                  color: artTab === tab ? '#7c3aed' : '#4b5563',
                  borderBottom: artTab === tab ? '2px solid #7c3aed' : '2px solid transparent',
                  marginBottom: -1,
                  background: 'none',
                  cursor: 'pointer',
                }}
              >
                {tab === 'upload' ? <Upload size={15} /> : <Sparkles size={15} />}
                {tab === 'upload' ? 'Upload your art' : 'Generate with AI'}
              </button>
            ))}
          </div>

          {/* Upload tab */}
          {artTab === 'upload' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div
                className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-16 px-8 cursor-pointer transition-all group"
                style={{ borderColor: '#d1d5db', backgroundColor: '#f9fafb' }}
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#7c3aed'; (e.currentTarget as HTMLDivElement).style.backgroundColor = '#faf5ff' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'; (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f9fafb' }}
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = '#7c3aed'; (e.currentTarget as HTMLDivElement).style.backgroundColor = '#faf5ff' }}
                onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'; (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f9fafb' }}
                onDrop={e => {
                  e.preventDefault();
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db';
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f9fafb'
                  const file = e.dataTransfer.files?.[0]
                  if (file && fileInputRef.current) {
                    const dt = new DataTransfer()
                    dt.items.add(file)
                    fileInputRef.current.files = dt.files
                    fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                  }
                }}
              >
                {uploading ? (
                  <>
                    <Loader2 size={40} className="animate-spin mb-5" style={{ color: '#7c3aed' }} />
                    <p className="text-sm font-medium" style={{ color: '#7c3aed' }}>Uploading…</p>
                  </>
                ) : artworkUrl ? (
                  <>
                    <img
                      src={artworkUrl}
                      alt="Uploaded artwork"
                      className="max-h-48 max-w-full object-contain rounded-lg mb-5 shadow-md"
                    />
                    <p className="text-xs" style={{ color: '#9ca3af' }}>Click to replace</p>
                  </>
                ) : (
                  <>
                    <div
                      className="rounded-full flex items-center justify-center mb-5"
                      style={{ width: 72, height: 72, backgroundColor: '#f3eeff', border: '2px dashed #c4b5fd' }}
                    >
                      <Upload size={28} style={{ color: '#7c3aed' }} />
                    </div>
                    <p className="text-base font-semibold mb-1" style={{ color: '#374151' }}>
                      Drag &amp; drop or click to upload
                    </p>
                    <p className="text-sm mb-4" style={{ color: '#6b7280' }}>
                      JPG, PNG, WEBP — up to 15 MB
                    </p>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setArtTab('generate') }}
                      className="text-xs underline underline-offset-2 transition-colors"
                      style={{ color: '#7c3aed', background: 'none', cursor: 'pointer' }}
                    >
                      or generate one with AI →
                    </button>
                  </>
                )}
              </div>

              {artworkUrl && !uploading && (
                <p
                  className="mt-4 text-sm flex items-center gap-2"
                  style={{ color: '#059669' }}
                >
                  <CheckCircle size={15} />
                  Artwork ready — scroll down to preview on metal
                </p>
              )}
            </div>
          )}

          {/* Generate tab */}
          {artTab === 'generate' && (
            <div className="space-y-8">
              {/* Wallet balance */}
              {user && walletBalance !== null && (
                <div
                  className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm"
                  style={{ backgroundColor: '#f5f3ff', color: '#4b5563', border: '1px solid #ede9fe' }}
                >
                  <Star size={14} style={{ color: '#7c3aed' }} />
                  Wallet: <span style={{ color: '#111827', fontWeight: 600 }}>{walletBalance.toLocaleString()} ITC</span>
                </div>
              )}

              {/* ---- Style starters (pick a STYLE = framework; you still type your subject below) ---- */}
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: '#374151' }}>
                  1. Pick a style
                </p>
                <p className="text-xs mb-4" style={{ color: '#6b7280' }}>
                  This sets the look. You describe what's in it below — e.g. "a lion" in the Anime style makes an anime lion.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {METAL_STARTERS.map(starter => {
                    const active = selectedStyle === starter.slug
                    return (
                      <button
                        key={starter.slug}
                        type="button"
                        onClick={() => setSelectedStyle(active ? null : starter.slug)}
                        className="flex flex-col items-center text-center group rounded-xl overflow-hidden transition-all relative"
                        style={{
                          border: active ? '2px solid #7c3aed' : '2px solid #e5e7eb',
                          background: 'none',
                          cursor: 'pointer',
                          boxShadow: active ? '0 0 0 3px rgba(124,58,237,0.15)' : 'none',
                        }}
                        title={starter.label}
                        aria-pressed={active}
                      >
                        <div className="w-full aspect-square overflow-hidden">
                          <img
                            src={`/metal-art/starters/${starter.slug}.webp`}
                            alt={starter.label}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        </div>
                        {active && (
                          <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: '#7c3aed' }}>
                            <CheckCircle size={13} style={{ color: '#fff' }} />
                          </span>
                        )}
                        <span
                          className="block px-2 py-1.5 text-xs font-medium w-full"
                          style={{
                            color: active ? '#7c3aed' : '#4b5563',
                            backgroundColor: active ? '#f5f3ff' : '#f9fafb',
                          }}
                        >
                          {starter.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ---- Prompt textarea (the subject) ---- */}
              <div>
                <label
                  htmlFor="gen-prompt"
                  className="block text-sm font-semibold mb-1"
                  style={{ color: '#374151' }}
                >
                  2. Describe what you want
                </label>
                <p className="text-xs mb-2" style={{ color: '#6b7280' }}>
                  {selectedStyle
                    ? `Your words, rendered in the ${METAL_STARTERS.find(s => s.slug === selectedStyle)?.label} style.`
                    : 'Pick a style above, or just describe it and we’ll frame it as gallery wall art.'}
                </p>
                <textarea
                  ref={promptRef}
                  id="gen-prompt"
                  rows={3}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder={selectedStyle ? 'e.g. a majestic lion' : 'e.g. a Japanese wave in deep ocean blues'}
                  className="w-full rounded px-4 py-3 text-sm resize-none outline-none transition-colors"
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #d1d5db',
                    color: '#111827',
                    lineHeight: 1.6,
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#d1d5db' }}
                />
                {selectedStyle && !prompt.trim() && (
                  <p className="mt-1 text-xs" style={{ color: '#9ca3af' }}>
                    Tip: leave this blank to generate a sample in this style, or type your subject to make it yours.
                  </p>
                )}
              </div>

              {/* Count selector */}
              <div>
                <p className="text-sm font-medium mb-3" style={{ color: '#374151' }}>
                  Variations <span className="font-normal" style={{ color: '#9ca3af' }}>(each from a different top AI model)</span>
                </p>
                <div className="flex gap-2">
                  {([1, 2, 3, 4] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => setGenCount(n)}
                      className="w-10 h-10 rounded text-sm font-semibold transition-all"
                      style={{
                        background: genCount === n ? '#7c3aed' : '#f9fafb',
                        color: genCount === n ? '#ffffff' : '#4b5563',
                        border: genCount === n ? 'none' : '1px solid #d1d5db',
                        cursor: 'pointer',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex items-center gap-2 px-7 py-3 rounded font-semibold text-sm uppercase tracking-wider transition-all disabled:opacity-40"
                style={{
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  cursor: !canGenerate ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 16px rgba(124,58,237,0.25)',
                }}
              >
                {generating ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    Generate
                    {costLabel && (
                      <span
                        className="ml-1 px-2 py-0.5 rounded text-xs font-bold"
                        style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
                      >
                        {costLabel}
                      </span>
                    )}
                  </>
                )}
              </button>

              {/* Results grid */}
              {generatedImages.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-4" style={{ color: '#4b5563' }}>
                    Click an image to select it as your artwork
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {generatedImages.map((img, idx) => (
                      <div key={idx} className="flex flex-col gap-1">
                        <button
                          onClick={() => {
                            setArtworkUrl(img.url)
                            toast.success('Artwork selected', 'Scroll down to preview on metal.')
                          }}
                          className="rounded-lg overflow-hidden relative group transition-all w-full"
                          style={{
                            border: artworkUrl === img.url ? '2px solid #7c3aed' : '2px solid #e5e7eb',
                            cursor: 'pointer',
                          }}
                          title={img.modelLabel ?? img.modelId}
                        >
                          <img
                            src={img.url}
                            alt={`Generated option ${idx + 1}`}
                            className="w-full aspect-square object-cover block"
                          />
                          {/* Model label badge — always visible in top-left */}
                          <span
                            className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-semibold"
                            style={{
                              backgroundColor: 'rgba(124,58,237,0.85)',
                              color: '#ffffff',
                              backdropFilter: 'blur(4px)',
                            }}
                          >
                            {img.modelLabel ?? img.modelId}
                          </span>
                          {artworkUrl === img.url && (
                            <div
                              className="absolute top-2 right-2 rounded-full p-1"
                              style={{ backgroundColor: '#7c3aed' }}
                            >
                              <CheckCircle size={14} style={{ color: '#ffffff' }} />
                            </div>
                          )}
                        </button>

                        {/* Expandable prompt */}
                        {img.prompt && (
                          <details className="text-xs" style={{ color: '#6b7280' }}>
                            <summary
                              className="cursor-pointer select-none hover:underline"
                              style={{ color: '#9ca3af', listStyle: 'none', outline: 'none' }}
                            >
                              view prompt ↓
                            </summary>
                            <p
                              className="mt-1 px-3 py-2 rounded leading-relaxed"
                              style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', color: '#6b7280', fontSize: '0.7rem' }}
                            >
                              {img.prompt}
                            </p>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------------
          STEP 2 — PREVIEW ON METAL  (activates once artwork exists)
      ---------------------------------------------------------------- */}
      <section
        id="step-2"
        className="py-24 px-6 transition-opacity duration-500"
        style={{
          backgroundColor: '#f9fafb',
          opacity: artworkUrl ? 1 : 0.65,
          pointerEvents: artworkUrl ? 'auto' : 'none',
        }}
      >
        <div className="max-w-5xl mx-auto">
          <StepLabel number={2} />
          <h2 className="text-3xl font-bold mb-2" style={{ color: '#111827' }}>
            Preview on metal
          </h2>
          <p className="mb-10 text-sm" style={{ color: '#4b5563' }}>
            Choose your finish, size, and see it on the wall.
          </p>

          <div className="flex flex-col lg:flex-row gap-12">
            {/* Controls column */}
            <div className="space-y-8 lg:w-56 flex-shrink-0">
              {/* Finish toggle */}
              <ControlGroup label="Finish">
                <ToggleRow
                  options={['matte', 'glossy'] as const}
                  value={finish}
                  onChange={v => setFinish(v as Finish)}
                  labelMap={{ matte: 'Matte', glossy: 'Glossy' }}
                />
              </ControlGroup>

              {/* Size toggle */}
              <ControlGroup label="Size">
                <ToggleRow
                  options={['4x6', '8x11'] as const}
                  value={size}
                  onChange={v => setSize(v as SizeKey)}
                  labelMap={{ '4x6': '4 × 6"', '8x11': '8 × 11"' }}
                />
              </ControlGroup>

              {/* Scene toggle */}
              <ControlGroup label="Scene">
                <ToggleRow
                  options={['studio', 'living', 'office'] as const}
                  value={scene}
                  onChange={v => setScene(v as Scene)}
                  labelMap={{ studio: 'Studio', living: 'Living room', office: 'Office' }}
                />
              </ControlGroup>

              {/* Dimension caption */}
              <p
                className="text-xs pt-2"
                style={{ color: '#9ca3af', borderTop: '1px solid #e5e7eb' }}
              >
                {PLATE_DIMS[size].labelIn} portrait
              </p>
            </div>

            {/* Preview area */}
            <div className="flex-1 flex flex-col items-center justify-center">
              {artworkUrl ? (
                <SceneView
                  artworkUrl={artworkUrl}
                  size={size}
                  finish={finish}
                  scene={scene}
                />
              ) : (
                <div
                  className="rounded-lg flex flex-col items-center justify-center py-24 px-8"
                  style={{ border: '2px dashed #d1d5db', backgroundColor: '#f3f4f6', width: '100%', maxWidth: 520 }}
                >
                  <Layers size={40} className="mb-3" style={{ color: '#d1d5db' }} />
                  <p className="text-sm" style={{ color: '#9ca3af' }}>
                    Your artwork will appear here
                  </p>
                </div>
              )}

              {/* Specification note */}
              <p
                className="mt-6 text-xs text-center"
                style={{ color: '#9ca3af', maxWidth: 420, lineHeight: 1.7 }}
              >
                Magnet-mounted steel plate · vivid full-color print · arrives ready to hang
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------
          STEP 3 — ORDER / EARN  (activates once artwork exists)
      ---------------------------------------------------------------- */}
      <section
        id="step-3"
        className="py-24 px-6 transition-opacity duration-500"
        style={{
          backgroundColor: '#ffffff',
          opacity: artworkUrl ? 1 : 0.65,
          pointerEvents: artworkUrl ? 'auto' : 'none',
        }}
      >
        <div className="max-w-5xl mx-auto">
          <StepLabel number={3} />
          <h2 className="text-3xl font-bold mb-10" style={{ color: '#111827' }}>
            Order or earn
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* ---- Order card ---- */}
            <div
              className="rounded-xl p-8 flex flex-col gap-6"
              style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart size={18} style={{ color: '#7c3aed' }} />
                  <h3 className="text-lg font-bold" style={{ color: '#111827' }}>
                    Order for yourself
                  </h3>
                </div>
                <p className="text-xs" style={{ color: '#4b5563' }}>
                  Ships within 3–5 business days
                </p>
              </div>

              {/* Price */}
              <div>
                <div>
                  <span
                    className="text-4xl font-bold"
                    style={{ color: '#111827' }}
                  >
                    ${price.toFixed(2)}
                  </span>
                  <span className="text-sm ml-2" style={{ color: '#4b5563' }}>
                    {PLATE_DIMS[size].labelIn} · {finish}
                  </span>
                </div>
                <p className="text-sm font-semibold mt-1" style={{ color: '#7c3aed' }}>
                  or pay {usdToItcLabel(price)} with coins
                </p>
              </div>

              {/* Qty stepper */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: '#4b5563' }}>
                  Quantity
                </p>
                <div className="flex items-center gap-0">
                  <StepperButton
                    icon={<Minus size={14} />}
                    onClick={() => setQty(q => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                  />
                  <span
                    className="w-12 text-center text-sm font-semibold"
                    style={{ color: '#111827' }}
                  >
                    {qty}
                  </span>
                  <StepperButton
                    icon={<Plus size={14} />}
                    onClick={() => setQty(q => Math.min(10, q + 1))}
                    disabled={qty >= 10}
                  />
                </div>
              </div>

              {/* Line total */}
              {qty > 1 && (
                <p className="text-sm" style={{ color: '#4b5563' }}>
                  Total: <strong style={{ color: '#111827' }}>${(price * qty).toFixed(2)}</strong>
                </p>
              )}

              {/* CTA */}
              {cartAdded ? (
                <div className="flex flex-col gap-3">
                  <div
                    className="flex items-center gap-2 text-sm font-medium"
                    style={{ color: '#059669' }}
                  >
                    <CheckCircle size={16} />
                    Added to cart
                  </div>
                  <Link
                    to="/cart"
                    className="text-xs underline"
                    style={{ color: '#7c3aed' }}
                  >
                    Go to cart
                  </Link>
                  <button
                    onClick={() => setCartAdded(false)}
                    className="text-xs"
                    style={{ color: '#9ca3af', background: 'none', cursor: 'pointer' }}
                  >
                    Add another
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAddToCart}
                  disabled={addingToCart || !artworkUrl}
                  className="flex items-center justify-center gap-2 py-3.5 rounded font-semibold text-sm uppercase tracking-wider transition-all disabled:opacity-40"
                  style={{
                    backgroundColor: '#7c3aed',
                    color: '#ffffff',
                    cursor: addingToCart || !artworkUrl ? 'not-allowed' : 'pointer',
                  }}
                >
                  {addingToCart ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Adding…
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={15} />
                      Add to cart
                    </>
                  )}
                </button>
              )}
            </div>

            {/* ---- Earn card ---- */}
            <div
              className="rounded-xl p-8 flex flex-col gap-6"
              style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Star size={18} style={{ color: '#7c3aed' }} />
                  <h3 className="text-lg font-bold" style={{ color: '#111827' }}>
                    Sell this design
                  </h3>
                </div>
                <p className="text-xs" style={{ color: '#4b5563' }}>
                  Earn 15% royalties on every sale
                </p>
              </div>

              <p className="text-sm" style={{ color: '#4b5563', lineHeight: 1.7 }}>
                List your design in the store. Every time someone orders a print
                with your artwork, you earn 15% automatically — no effort required.
              </p>

              {submitted ? (
                <div
                  className="flex items-start gap-3 rounded-lg p-4"
                  style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}
                >
                  <CheckCircle size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#059669' }} />
                  <p className="text-sm" style={{ color: '#166534' }}>
                    Submitted for review — find it in your Creator Hub once approved.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="design-name"
                      className="block text-xs font-medium mb-2"
                      style={{ color: '#4b5563' }}
                    >
                      Design name
                    </label>
                    <input
                      id="design-name"
                      type="text"
                      value={designName}
                      onChange={e => setDesignName(e.target.value)}
                      placeholder="e.g. Ocean Wave No. 7"
                      className="w-full rounded px-4 py-2.5 text-sm outline-none transition-colors"
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #d1d5db',
                        color: '#111827',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#d1d5db' }}
                    />
                  </div>

                  {!user && (
                    <div
                      className="flex items-center gap-2 text-xs rounded p-3"
                      style={{ backgroundColor: '#f5f3ff', border: '1px solid #ede9fe', color: '#6d28d9' }}
                    >
                      <AlertCircle size={14} />
                      Sign in to submit designs for sale
                    </div>
                  )}

                  <button
                    onClick={handleSubmitDesign}
                    disabled={submitting || !artworkUrl || !designName.trim() || !user}
                    className="flex items-center justify-center gap-2 py-3.5 rounded font-semibold text-sm uppercase tracking-wider transition-all disabled:opacity-40"
                    style={{
                      background: 'transparent',
                      color: '#7c3aed',
                      border: '1px solid #7c3aed',
                      cursor: submitting || !artworkUrl || !designName.trim() || !user ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Star size={15} />
                        Submit for review
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scene view — plates placed on wall photos or charcoal backdrop
// ---------------------------------------------------------------------------
interface SceneViewProps {
  artworkUrl: string
  size: SizeKey
  finish: Finish
  scene: Scene
}

function SceneView({ artworkUrl, size, finish, scene }: SceneViewProps) {
  const { w, h } = PLATE_DIMS[size]

  if (scene === 'studio') {
    return (
      <div
        className="flex items-center justify-center rounded-xl"
        style={{
          backgroundColor: '#f0eef6',
          backgroundImage: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
          width: '100%',
          maxWidth: 520,
          minHeight: 480,
          padding: 40,
          border: '1px solid #ddd6fe',
        }}
      >
        <MetalPlate artworkUrl={artworkUrl} size={size} finish={finish} />
      </div>
    )
  }

  const pos = SCENE_PLATE[scene === 'living' ? 'living' : 'office']

  // Scale plate down for 4x6 in scene
  const scaleRatio = size === '4x6' ? 0.75 : 1

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{ width: '100%', maxWidth: 520, aspectRatio: '4/3' }}
    >
      <img
        src={scene === 'living' ? '/metal-art/wall-scene-living.webp' : '/metal-art/wall-scene-office.webp'}
        alt="Wall scene"
        className="w-full h-full object-cover"
      />
      {/* Plate positioned on wall */}
      <div
        style={{
          position: 'absolute',
          left: pos.left,
          top: pos.top,
          width: pos.width,
          aspectRatio: `${w}/${h}`,
          transform: `scale(${scaleRatio})`,
          transformOrigin: 'top left',
        }}
      >
        <div style={{ width: '100%', height: '100%', position: 'relative', borderRadius: 4, overflow: 'hidden' }}>
          <img
            src={artworkUrl}
            alt="Plate on wall"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              filter: finish === 'glossy' ? 'saturate(1.08)' : 'saturate(0.94)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'url(/metal-art/plate-texture.webp)',
              backgroundSize: 'cover',
              mixBlendMode: 'overlay',
              opacity: 0.14,
              pointerEvents: 'none',
            }}
          />
          {finish === 'glossy' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 55%)',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* Bevel shadow */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), inset -1px -1px 0 rgba(0,0,0,0.4)',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small reusable helpers
// ---------------------------------------------------------------------------
function StepLabel({ number }: { number: number }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
        style={{ backgroundColor: '#7c3aed', color: '#ffffff' }}
      >
        {number}
      </span>
      <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: '#9ca3af' }}>
        Step {number}
      </span>
    </div>
  )
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#7c3aed' }}>
        {label}
      </p>
      {children}
    </div>
  )
}

function ToggleRow<T extends string>({
  options,
  value,
  onChange,
  labelMap,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labelMap: Record<T, string>
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className="px-3 py-1.5 rounded text-xs font-medium transition-all"
          style={{
            background: value === opt ? '#7c3aed' : '#f9fafb',
            color: value === opt ? '#ffffff' : '#4b5563',
            border: value === opt ? 'none' : '1px solid #e5e7eb',
            cursor: 'pointer',
          }}
        >
          {labelMap[opt]}
        </button>
      ))}
    </div>
  )
}

function StepperButton({
  icon,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-9 h-9 flex items-center justify-center rounded transition-colors disabled:opacity-30"
      style={{
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        color: '#374151',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon}
    </button>
  )
}
