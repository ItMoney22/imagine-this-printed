// Team Shirts — the customer page, inside Imagination Station.
//
// David 2026-09-24, after the operator studio shipped in its place: "The
// customers should be able to just come in, add a name to the back, add a
// number to the back. They can pick a placement if they want." And: "there's no
// like design for the page ... generate some images, make things
// understandable", "I don't want you to mention that we're using GPT ... we're
// branding this through us."
//
// So this page is exactly that, and nothing else:
//   name -> number -> placement -> "Show me my shirt" -> size -> Add to cart.
// What the customer types is what gets drawn: the preview is the same image
// the press file is upscaled from (backend/services/team-plate/generate.ts),
// and there are no test names, no prices to set and no model names anywhere.
//
// Placement needs no schema: "number only" sends an empty name and "name only"
// an empty number, and the lettering prompt removes an empty field cleanly —
// at preview AND at checkout (routes/stripe.ts re-renders from the same values).
//
// An admin opening a shirt that is not set up yet gets ONE button: the server
// reads the sample name and number off the art (auto-setup.ts) and publishes
// the template. The old drag-a-box studio stays behind "Fine-tune".
//
// Every image on this page came from our own image engine
// (backend/scripts/generate-team-shirt-art.ts) and is served from /team-shirts.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Wand2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { apiErrorMessage, apiFetch, teamStudioApi } from '../lib/api'
import { useAuth } from '../context/SupabaseAuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import ProgressBar from '../components/studio/ProgressBar'
import { lineBasePrice, sizeChoicesFor } from '../lib/product-kind'
import { DEFAULT_GARMENT_TIER_ID } from '../lib/garment-tiers'
import type { Product } from '../types'

type Placement = 'both' | 'number' | 'name'

interface TemplateField {
  key: string
  label: string
  type: 'text' | 'number'
  max: number
  uppercase?: boolean
  sample?: string
}

interface TemplateSummary {
  fields: TemplateField[]
  upcharge: number
}

interface TeamMate {
  name: string
  number: string
  size: string
  quantity: number
  previewUrl: string | null
}

const PLACEMENTS: Array<{ id: Placement; title: string; blurb: string; img: string }> = [
  { id: 'both', title: 'Name + number', blurb: 'The classic jersey back', img: '/team-shirts/place-both.webp' },
  { id: 'number', title: 'Number only', blurb: 'Big and bold', img: '/team-shirts/place-number.webp' },
  { id: 'name', title: 'Name only', blurb: 'Across the shoulders', img: '/team-shirts/place-name.webp' },
]

const HOW_IT_WORKS = [
  { n: 1, title: 'Type your name', text: 'Any name, up to 12 letters. Apostrophes and hyphens welcome.', img: '/team-shirts/step-name.webp' },
  { n: 2, title: 'Pick your number', text: 'One or two digits, sized to fill the back like a real jersey.', img: '/team-shirts/step-number.webp' },
  { n: 3, title: 'Choose the spot', text: 'Name and number, number only, or name only. Your call.', img: '/team-shirts/step-place.webp' },
  { n: 4, title: 'We print & ship', text: 'You approve the exact picture we print. Then it goes on the press.', img: '/team-shirts/step-ship.webp' },
]

/** A new name is one Imagination render, ~20-40s. The bar is paced to the slow end. */
const RENDER_MS = 40_000

const SHIRT_HEX: Record<string, string> = {
  white: '#F7F7F5',
  black: '#1B1B1D',
  navy: '#1F2A44',
  maroon: '#6B1F2A',
  red: '#B3202A',
  royal: '#2A4DB3',
  'royal blue': '#2A4DB3',
  grey: '#9EA3A8',
  gray: '#9EA3A8',
  'sport grey': '#9EA3A8',
  'heather grey': '#A7A9AC',
  green: '#1F5E3A',
  'forest green': '#1F4A33',
  gold: '#D4A017',
  orange: '#E0661B',
  purple: '#4B2C83',
  pink: '#E985A8',
}

const YOUTH = /^Y/i

function cleanName(raw: string, max: number): string {
  return raw.replace(/[^A-Za-z '-]/g, '').replace(/\s+/g, ' ').toUpperCase().slice(0, max)
}
function cleanNumber(raw: string, max: number): string {
  return raw.replace(/[^0-9]/g, '').slice(0, max)
}

/** The one varsity face on the page (inputs + jersey chips). Loaded once, on demand. */
function useVarsityFont() {
  useEffect(() => {
    const id = 'itp-varsity-font'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Graduate&display=swap'
    document.head.appendChild(link)
  }, [])
}
const VARSITY: React.CSSProperties = { fontFamily: "'Graduate', 'DM Sans', system-ui, sans-serif" }

const TeamShirtStudio: React.FC = () => {
  const { productId = '' } = useParams<{ productId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { addToCart } = useCart()
  const toast = useToast()
  useVarsityFont()
  const isAdmin = user?.role === 'admin'

  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [template, setTemplate] = useState<TemplateSummary | null>(null)

  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [placement, setPlacement] = useState<Placement>('both')

  const [rendering, setRendering] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ url: string; key: string } | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [showBefore, setShowBefore] = useState(false)
  const renderSeq = useRef(0)

  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [team, setTeam] = useState<TeamMate[]>([])

  const [settingUp, setSettingUp] = useState<number | null>(null)
  const designRef = useRef<HTMLDivElement | null>(null)

  // ---- load --------------------------------------------------------------
  const load = async () => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)
    const { data } = await (isUuid
      ? supabase.from('products').select('*').eq('id', productId).maybeSingle()
      : supabase.from('products').select('*').eq('slug', productId).maybeSingle())
    if (!data) {
      setLoading(false)
      return
    }
    const mapped: Product = {
      id: data.id,
      slug: data.slug || undefined,
      name: data.name,
      description: data.description || '',
      price: data.price || 0,
      images: data.images || [],
      category: data.category || 'shirts',
      inStock: data.is_active !== false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      metadata: data.metadata || {},
      sizes: data.sizes || data.metadata?.sizes || [],
      colors: data.colors || data.metadata?.colors || [],
      print_locations: data.print_locations || [],
      product_type: data.product_type,
    } as Product
    setProduct(mapped)
    const t = data.metadata?.team_template
    setTemplate(
      t && Array.isArray(t.fields) && t.fields.length > 0
        ? { fields: t.fields, upcharge: Number(t.upcharge) > 0 ? Number(t.upcharge) : 0 }
        : null
    )
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  // ---- derived -------------------------------------------------------------
  const nameField = template?.fields.find((f) => f.type === 'text') ?? null
  const numberField = template?.fields.find((f) => f.type === 'number') ?? null
  const nameMax = nameField?.max ?? 12
  const numberMax = numberField?.max ?? 2
  const wantsName = placement !== 'number'
  const wantsNumber = placement !== 'name'

  /** Exactly what gets drawn: the template's own keys, empty where the placement drops a field. */
  const values = useMemo(() => {
    const out: Record<string, string> = {}
    for (const f of template?.fields ?? []) {
      if (f.type === 'number') out[f.key] = wantsNumber ? number : ''
      else out[f.key] = f === nameField && wantsName ? name : ''
    }
    return out
  }, [template, name, number, wantsName, wantsNumber, nameField])
  const valuesKey = JSON.stringify(values)

  const ready = (!wantsName || name.trim().length > 0) && (!wantsNumber || number.length > 0)
  const previewIsCurrent = !!preview && preview.key === valuesKey
  const backArt: string | undefined = (product?.metadata as any)?.print_artwork?.back_image
  const shirtHex = SHIRT_HEX[String((product?.metadata as any)?.shirt_color ?? 'white').toLowerCase()] ?? '#F7F7F5'
  const darkShirt = parseInt(shirtHex.slice(1, 3), 16) + parseInt(shirtHex.slice(3, 5), 16) + parseInt(shirtHex.slice(5, 7), 16) < 300

  const sizes = product ? sizeChoicesFor(product) : []
  const adultSizes = sizes.filter((s) => !YOUTH.test(s))
  const youthSizes = sizes.filter((s) => YOUTH.test(s))
  const unitPrice = product ? lineBasePrice(product, size || null, null) + (template?.upcharge ?? 0) : 0

  const stageImage = previewIsCurrent && !showBefore ? preview!.url : backArt
  const jerseyLabel = [wantsName ? name || 'YOUR NAME' : '', wantsNumber ? number || '00' : ''].filter(Boolean).join('  ·  ')

  // ---- actions -------------------------------------------------------------
  const render = async () => {
    if (!ready || !product) return
    const seq = ++renderSeq.current
    const key = valuesKey
    setRendering(Date.now())
    setRenderError(null)
    setShowBefore(false)
    try {
      const data = await apiFetch('/api/team-plate/preview', {
        method: 'POST',
        body: JSON.stringify({ productId: product.id, values }),
      })
      if (seq !== renderSeq.current) return
      setPreview({ url: data.url, key })
    } catch (err) {
      if (seq !== renderSeq.current) return
      const msg = String((err as any)?.message ?? '')
      setRenderError(
        /HTTP 429/.test(msg)
          ? 'That is a lot of previews in a row. Give it a few minutes and try again.'
          : 'We could not draw that one. Please try again in a moment.'
      )
    } finally {
      if (seq === renderSeq.current) setRendering(null)
    }
  }

  const addShirt = (goToCheckout: boolean) => {
    if (!product) return
    if (sizes.length > 0 && !size) {
      toast.warning('Pick a size', 'Choose a size for this shirt first.')
      return
    }
    if (!previewIsCurrent) {
      toast.warning('See it first', 'Press "Show me my shirt" so you can check the spelling before it prints.')
      return
    }
    addToCart(product, quantity, size || undefined, undefined, undefined, undefined, undefined, undefined, undefined, DEFAULT_GARMENT_TIER_ID, values)
    setTeam((t) => [...t, { name: wantsName ? name : '', number: wantsNumber ? number : '', size, quantity, previewUrl: preview?.url ?? null }])
    if (goToCheckout) {
      navigate('/checkout')
      return
    }
    toast.success('In your cart', `${[wantsName && name, wantsNumber && `#${number}`].filter(Boolean).join(' ')} · ${size || 'one size'}`)
  }

  const nextPlayer = () => {
    setName('')
    setNumber('')
    setPreview(null)
    setQuantity(1)
    designRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const autoSetup = async () => {
    setSettingUp(Date.now())
    try {
      await teamStudioApi.autoSetup(productId)
      await load()
      toast.success('Ready for names', 'Type a name below to see it on the shirt.')
    } catch (err) {
      toast.error('Could not set this shirt up', apiErrorMessage(err))
    } finally {
      setSettingUp(null)
    }
  }

  // ---- render --------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <ProgressBar label="Opening the team shirt studio" startedAt={Date.now()} expectedMs={2500} />
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-3xl">We couldn't find that shirt</h1>
        <Link to="/catalog" className="px-5 py-3 rounded-xl bg-primary text-white font-semibold">Browse shirts</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* ---------------- top bar ---------------- */}
      <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur border-b border-text/10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to={`/product/${product.slug || product.id}`} className="p-2 -ml-2 rounded-lg hover:bg-text/5" aria-label="Back to the shirt">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 text-white">
            <Sparkles className="w-3.5 h-3.5" /> Imagination Station
          </span>
          <span className="text-sm text-muted truncate hidden sm:block">Team Shirts · {product.name}</span>
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && template && (
              <Link
                to={`/imagination-station/team/${product.id}/setup`}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-text/15 text-muted hover:text-text"
                title="Admin only: adjust where the name and number sit"
              >
                <Settings2 className="w-3.5 h-3.5" /> Fine-tune
              </Link>
            )}
            <Link to="/cart" className="p-2 rounded-lg hover:bg-text/5" aria-label="Cart">
              <ShoppingCart className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden">
        <img src="/team-shirts/hero.webp" alt="A team wearing matching shirts with their names and numbers on the back" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-violet-900/50 via-transparent to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4 pt-28 pb-14 sm:pt-40 sm:pb-20 text-white">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-orange-200">
            <Users className="w-4 h-4" /> Team shirts
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl leading-[1.05] max-w-3xl">
            Your name. Your number.
            <span className="block bg-gradient-to-r from-orange-300 via-fuchsia-300 to-violet-300 bg-clip-text text-transparent">Your team.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base sm:text-lg text-white/85">
            Type it in and we letter it right into the design, in the design's own style. You see the exact shirt before we print it.
          </p>
          <button
            type="button"
            onClick={() => designRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="mt-7 inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl font-semibold bg-white text-black hover:scale-[1.02] active:scale-[0.99] transition"
          >
            Put my name on it <ArrowDown className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <h2 className="font-display text-2xl sm:text-3xl text-center">Four steps. About a minute.</h2>
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.n} className="rounded-3xl bg-card border border-text/10 overflow-hidden shadow-soft">
              <div className="relative aspect-square bg-[#FBF7F4]">
                <img src={s.img} alt="" loading="lazy" className="w-full h-full object-cover" />
                <span className="absolute top-3 left-3 w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white text-sm font-bold flex items-center justify-center shadow-lg">
                  {s.n}
                </span>
              </div>
              <div className="p-4">
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- the studio ---------------- */}
      <section ref={designRef} className="scroll-mt-16 max-w-7xl mx-auto px-4 pb-16">
        {!template ? (
          <NotReady isAdmin={isAdmin} hasBackArt={!!backArt} settingUp={settingUp} onSetUp={autoSetup} productPath={`/product/${product.slug || product.id}`} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 lg:gap-10 items-start">
            {/* stage */}
            <div className="lg:sticky lg:top-20">
              <div className="relative rounded-[2rem] overflow-hidden border border-text/10 bg-[radial-gradient(ellipse_at_top,rgba(167,139,250,0.35),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(251,146,60,0.25),transparent_55%)] bg-card p-6 sm:p-10">
                <p className="text-center text-[11px] uppercase tracking-[0.25em] text-muted">Back of the shirt</p>
                <ShirtBack color={shirtHex} art={stageImage} dim={!!rendering} light={!darkShirt} />

                {/* jersey chip: live as they type */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-5 max-w-[90%]">
                  <div
                    className={`px-4 py-2 rounded-full text-base sm:text-lg tracking-wider shadow-lg border whitespace-nowrap overflow-hidden text-ellipsis ${
                      darkShirt ? 'bg-white text-black border-white' : 'bg-black/85 text-white border-black'
                    }`}
                    style={VARSITY}
                  >
                    {jerseyLabel}
                  </div>
                </div>

                {previewIsCurrent && !rendering && (
                  <button
                    type="button"
                    onClick={() => setShowBefore((b) => !b)}
                    className="absolute top-4 right-4 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-black/70 text-white"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> {showBefore ? 'Show mine' : 'Show original'}
                  </button>
                )}
              </div>

              <div className="mt-3 min-h-[3.5rem]">
                {rendering != null ? (
                  <ProgressBar
                    size="lg"
                    label={`Imagination is lettering ${[wantsName && name, wantsNumber && number].filter(Boolean).join(' ')} into the design`}
                    startedAt={rendering}
                    expectedMs={RENDER_MS}
                  />
                ) : previewIsCurrent ? (
                  <p className="flex items-center justify-center gap-2 text-sm text-emerald-500">
                    <Check className="w-4 h-4" /> This is exactly what we print. Check the spelling.
                  </p>
                ) : preview ? (
                  <p className="text-center text-sm text-amber-500">You changed something. Press "Show me my shirt" to see the new version.</p>
                ) : (
                  <p className="text-center text-sm text-muted">This is the design. Add your name and number on the right to make it yours.</p>
                )}
                {renderError && <p className="mt-2 text-center text-sm text-red-500">{renderError}</p>}
              </div>
            </div>

            {/* controls */}
            <div className="space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">Make it yours</p>
                <h2 className="mt-1 font-display text-3xl">{product.name}</h2>
                <p className="mt-1 text-muted">
                  <span className="text-text font-semibold text-lg">${unitPrice.toFixed(2)}</span> per shirt · name and number included
                </p>
              </div>

              {/* placement */}
              <Panel n={1} title="Where does it go?">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {PLACEMENTS.map((p) => {
                    const on = placement === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlacement(p.id)}
                        aria-pressed={on}
                        className={`group rounded-2xl border-2 overflow-hidden text-left transition ${
                          on ? 'border-primary ring-4 ring-primary/20' : 'border-text/10 hover:border-primary/40'
                        }`}
                      >
                        <div className="bg-[#FBF7F4] aspect-[4/5] relative">
                          <img src={p.img} alt="" className="w-full h-full object-cover" />
                          {on && (
                            <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center">
                              <Check className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                        <div className="px-2.5 py-2">
                          <p className="text-sm font-semibold leading-tight">{p.title}</p>
                          <p className="text-[11px] text-muted hidden sm:block">{p.blurb}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Panel>

              {/* name + number */}
              <Panel n={2} title={wantsName && wantsNumber ? 'Your name and number' : wantsName ? 'Your name' : 'Your number'}>
                <div className={`grid gap-3 ${wantsName && wantsNumber ? 'grid-cols-[1fr_7rem]' : 'grid-cols-1'}`}>
                  {wantsName && (
                    <label className="block">
                      <span className="block text-sm text-muted mb-1.5">Name on the back</span>
                      <input
                        value={name}
                        onChange={(e) => setName(cleanName(e.target.value, nameMax))}
                        placeholder="YOUR NAME"
                        autoComplete="off"
                        maxLength={nameMax}
                        className="w-full h-16 px-4 rounded-2xl bg-bg border-2 border-text/15 focus:border-primary outline-none text-2xl tracking-wider placeholder:text-muted/40"
                        style={VARSITY}
                      />
                      <span className="mt-1 block text-xs text-muted">{name.length}/{nameMax} letters</span>
                    </label>
                  )}
                  {wantsNumber && (
                    <label className="block">
                      <span className="block text-sm text-muted mb-1.5">Number</span>
                      <input
                        value={number}
                        onChange={(e) => setNumber(cleanNumber(e.target.value, numberMax))}
                        placeholder="00"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={numberMax}
                        className="w-full h-16 px-4 rounded-2xl bg-bg border-2 border-text/15 focus:border-primary outline-none text-3xl text-center tracking-widest placeholder:text-muted/40"
                        style={VARSITY}
                      />
                      <span className="mt-1 block text-xs text-muted">{numberMax === 1 ? '1 digit' : `up to ${numberMax} digits`}</span>
                    </label>
                  )}
                </div>

                <button
                  type="button"
                  onClick={render}
                  disabled={!ready || rendering != null || previewIsCurrent}
                  className={`mt-4 w-full inline-flex items-center justify-center gap-2 h-14 rounded-2xl font-semibold text-white text-lg transition ${
                    previewIsCurrent
                      ? 'bg-emerald-600 cursor-default'
                      : 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 shadow-lg shadow-fuchsia-500/25 disabled:opacity-40 disabled:shadow-none hover:brightness-110'
                  }`}
                >
                  {previewIsCurrent ? <Check className="w-5 h-5" /> : <Wand2 className="w-5 h-5" />}
                  {previewIsCurrent ? 'That\'s your shirt' : preview ? 'Update my shirt' : 'Show me my shirt'}
                </button>
                {!ready && <p className="mt-2 text-xs text-muted text-center">Type {wantsName && wantsNumber ? 'a name and a number' : wantsName ? 'a name' : 'a number'} first.</p>}
              </Panel>

              {/* size + cart */}
              <Panel n={3} title="Size and quantity">
                {adultSizes.length > 0 && <SizeRow label="Adult" sizes={adultSizes} value={size} onChange={setSize} />}
                {youthSizes.length > 0 && <SizeRow label="Youth" sizes={youthSizes} value={size} onChange={setSize} />}
                <div className="mt-4 flex items-center gap-3">
                  <div className="inline-flex items-center rounded-xl border border-text/15">
                    <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="p-3" aria-label="One less">
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-8 text-center font-semibold">{quantity}</span>
                    <button type="button" onClick={() => setQuantity((q) => Math.min(50, q + 1))} className="p-3" aria-label="One more">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-muted">
                    Total <span className="text-text font-semibold">${(unitPrice * quantity).toFixed(2)}</span>
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => addShirt(false)}
                    disabled={!product.inStock}
                    className="inline-flex items-center justify-center gap-2 h-14 rounded-2xl font-semibold border-2 border-primary text-primary hover:bg-primary/5 disabled:opacity-40"
                  >
                    <ShoppingCart className="w-5 h-5" /> Add to cart
                  </button>
                  <button
                    type="button"
                    onClick={() => addShirt(true)}
                    disabled={!product.inStock}
                    className="inline-flex items-center justify-center gap-2 h-14 rounded-2xl font-semibold text-white bg-primary hover:brightness-110 disabled:opacity-40"
                  >
                    Buy now
                  </button>
                </div>
                {!previewIsCurrent && <p className="mt-2 text-xs text-muted text-center">You'll see your shirt before it goes in the cart.</p>}
              </Panel>

              {/* the rest of the team */}
              {team.length > 0 && (
                <div className="rounded-3xl border border-primary/30 bg-primary/5 p-5">
                  <p className="font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" /> Your team order ({team.reduce((n, t) => n + t.quantity, 0)} shirt{team.reduce((n, t) => n + t.quantity, 0) === 1 ? '' : 's'})
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {team.map((t, i) => (
                      <li key={i} className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-card border border-text/10 text-sm">
                        {t.previewUrl && <img src={t.previewUrl} alt="" className="w-7 h-7 rounded-full object-cover bg-white" />}
                        <span style={VARSITY}>{[t.name, t.number && `#${t.number}`].filter(Boolean).join(' ')}</span>
                        <span className="text-muted">· {t.size || 'one size'}{t.quantity > 1 ? ` ×${t.quantity}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={nextPlayer} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-semibold">
                      <Plus className="w-4 h-4" /> Add the next player
                    </button>
                    <Link to="/cart" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-text/15 font-semibold">
                      Review cart
                    </Link>
                  </div>
                </div>
              )}

              {/* trust */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { icon: ShieldCheck, text: 'You approve the exact print' },
                  { icon: Printer, text: 'Sharp at 300 DPI' },
                  { icon: Truck, text: 'Youth & adult sizes' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="rounded-2xl border border-text/10 bg-card px-2 py-3">
                    <Icon className="w-5 h-5 mx-auto text-primary" />
                    <p className="mt-1 text-[11px] sm:text-xs text-muted leading-tight">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------

const Panel: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="rounded-3xl border border-text/10 bg-card p-5 shadow-soft">
    <p className="flex items-center gap-2.5 font-semibold mb-4">
      <span className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white text-sm flex items-center justify-center">{n}</span>
      {title}
    </p>
    {children}
  </div>
)

const SizeRow: React.FC<{ label: string; sizes: string[]; value: string; onChange: (s: string) => void }> = ({ label, sizes, value, onChange }) => (
  <div className="mb-3 last:mb-0">
    <p className="text-xs text-muted mb-1.5">{label}</p>
    <div className="flex flex-wrap gap-2">
      {sizes.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={value === s}
          className={`min-w-[3rem] h-11 px-3 rounded-xl border-2 text-sm font-semibold transition ${
            value === s ? 'border-primary bg-primary text-white' : 'border-text/15 hover:border-primary/50'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  </div>
)

/** A plain tee, back view, in the product's garment colour, with the art on it. */
const ShirtBack: React.FC<{ color: string; art?: string; dim?: boolean; light?: boolean }> = ({ color, art, dim, light }) => (
  <div className="relative mx-auto mt-2 w-full max-w-[460px] aspect-[400/440]">
    <svg viewBox="0 0 400 440" className="absolute inset-0 w-full h-full drop-shadow-[0_24px_30px_rgba(0,0,0,0.25)]" aria-hidden="true">
      <defs>
        <linearGradient id="tee-shade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.10" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <path
        d="M140 18 Q200 30 260 18 L352 52 Q372 60 380 78 L398 150 L334 172 L320 146 L320 418 Q200 434 80 418 L80 146 L66 172 L2 150 L20 78 Q28 60 48 52 Z"
        fill={color}
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="2"
      />
      <path d="M140 18 Q200 30 260 18 L352 52 Q372 60 380 78 L398 150 L334 172 L320 146 L320 418 Q200 434 80 418 L80 146 L66 172 L2 150 L20 78 Q28 60 48 52 Z" fill="url(#tee-shade)" />
      <path d="M142 20 Q200 34 258 20" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="3" />
    </svg>
    {art && (
      <img
        src={art}
        alt="The back print"
        // Print files often carry a white background; on a light shirt multiply
        // drops it so the art reads as ink on fabric, not a sticker.
        className={`absolute left-[26%] top-[13%] w-[48%] h-[62%] object-contain transition duration-500 ${light ? 'mix-blend-multiply' : ''} ${dim ? 'opacity-40 blur-[1px] scale-[0.98]' : 'opacity-100'}`}
      />
    )}
  </div>
)

const NotReady: React.FC<{
  isAdmin: boolean
  hasBackArt: boolean
  settingUp: number | null
  onSetUp: () => void
  productPath: string
}> = ({ isAdmin, hasBackArt, settingUp, onSetUp, productPath }) => (
  <div className="max-w-2xl mx-auto rounded-3xl border border-text/10 bg-card p-8 text-center shadow-soft">
    <Sparkles className="w-8 h-8 mx-auto text-primary" />
    {isAdmin ? (
      <>
        <h2 className="mt-3 font-display text-2xl">Turn on names and numbers for this shirt</h2>
        <p className="mt-2 text-muted">
          {hasBackArt
            ? 'One click: Imagination reads the sample name and number on the back design and gets the shirt ready. Then type any name below to check it.'
            : 'This shirt has no back design yet. Add one in the Step Flow first.'}
        </p>
        {hasBackArt && (
          <>
            <button
              type="button"
              onClick={onSetUp}
              disabled={settingUp != null}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl font-semibold text-white bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 disabled:opacity-50"
            >
              <Wand2 className="w-5 h-5" /> Make it personalizable
            </button>
            {settingUp != null && (
              <div className="mt-5 text-left">
                <ProgressBar label="Reading the sample name and number off the design" startedAt={settingUp} expectedMs={20000} />
              </div>
            )}
          </>
        )}
      </>
    ) : (
      <>
        <h2 className="mt-3 font-display text-2xl">Names and numbers are coming to this shirt</h2>
        <p className="mt-2 text-muted">You can still grab the design as it is.</p>
        <Link to={productPath} className="mt-6 inline-flex px-6 py-3 rounded-2xl bg-primary text-white font-semibold">See the shirt</Link>
      </>
    )}
  </div>
)

export default TeamShirtStudio
