// Custom QR Counter Stand — the order page (task deebfdca, built to David's
// approved mock of 2026-10-17). A business types where its code points and the
// words under it, drops in its logo, watches the stand's face update, picks a
// quantity and adds it to the cart. $25 struck, $17.95.
//
// Every rule here is the server's own (backend/shared/qr-stand.ts): checkout
// re-checks the link, caption and logo and prices the line itself.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ImageUp, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import StandPreview from '../components/qr-stand/StandPreview'
import { logoPrintFrom } from '../lib/qr-stand/load-logo'
import { uploadLogo, LOGO_TYPES } from '../lib/qr-stand/upload-logo'
import { SHOP_PLACE } from '../config/business-info'
import { STANDARD_FULFILLMENT_DAYS } from '../utils/shipping-calculator'
import {
  QR_STAND,
  QR_CAPTIONS,
  QR_CAPTION_MAX,
  QR_FIELD,
  QR_LINK_MAX_BYTES,
  cleanQrCaption,
  normalizeQrLink,
  qrCaptionProblem,
  qrLinkProblem,
} from '../../backend/shared/qr-stand'
import type { Product } from '../types'

const PHOTOS = [
  { src: '/business/qr-stand-cafe.webp', alt: 'A QR counter stand saying Review Us on a cafe counter, being scanned with a phone' },
  { src: '/business/qr-stand-lineup.webp', alt: 'Three QR counter stands: Review Us, Pay Here and Visit Our Website' },
  { src: '/business/qr-stand-salon.webp', alt: 'A Pay Here QR counter stand on a salon front desk beside a card reader' },
]

const REF_KEY = 'itp_qr_stand_ref'
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

type Upload = { stage: 'idle' } | { stage: 'uploading'; pct: number } | { stage: 'done' } | { stage: 'error'; message: string }

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="py-5 first:pt-0 last:pb-0 border-b border-border last:border-b-0">
      <h2 className="flex items-center gap-3 font-body text-base font-semibold text-text mb-3">
        <span className="w-7 h-7 shrink-0 rounded-full bg-primary text-white text-sm flex items-center justify-center" aria-hidden="true">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function QrStandOrder() {
  const { addToCart } = useCart()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [photo, setPhoto] = useState(0)
  const [rawLink, setRawLink] = useState('')
  const [touchedLink, setTouchedLink] = useState(false)
  const [preset, setPreset] = useState<string>(QR_CAPTIONS[0])
  const [custom, setCustom] = useState('')
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoPrint, setLogoPrint] = useState<string | null>(null)
  const [logoProblem, setLogoProblem] = useState<string | null>(null)
  const [upload, setUpload] = useState<Upload>({ stage: 'idle' })
  const [dragging, setDragging] = useState(false)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // A client site we built (Darrell's shop) links here with a signed ref. It
  // rides on the cart line so his own site can book his share; the buyer is
  // never shown it. Kept for the visit so a reload does not drop it.
  const [ref] = useState<string | null>(() => {
    const fromUrl = params.get('ref')
    try {
      if (fromUrl) sessionStorage.setItem(REF_KEY, fromUrl)
      return fromUrl || sessionStorage.getItem(REF_KEY)
    } catch {
      return fromUrl
    }
  })

  useEffect(() => {
    document.title = `${QR_STAND.name} | Imagine This Printed`
  }, [])

  const link = normalizeQrLink(rawLink)
  const linkProblem = link ? qrLinkProblem(link) : null
  const caption = cleanQrCaption(preset === 'Custom' ? custom : preset)
  const captionProblem = qrCaptionProblem(caption)
  const bytes = useMemo(() => new TextEncoder().encode(link).length, [link])
  const uploading = upload.stage === 'uploading'
  const ready = !!link && !linkProblem && !captionProblem && !uploading && !logoProblem

  async function takeFile(file: File | undefined | null) {
    if (!file) return
    if (!LOGO_TYPES.test(file.type)) {
      setUpload({ stage: 'error', message: 'Use a PNG or JPG of your logo.' })
      return
    }
    setLogoProblem(null)
    // What will print, straight from the file, before the upload finishes.
    const print = await logoPrintFrom(file).catch(() => ({ dataUrl: null, problem: null }))
    if (print.problem) {
      setLogoProblem(print.problem)
      setUpload({ stage: 'idle' })
      return
    }
    setLogoPrint(print.dataUrl)
    setUpload({ stage: 'uploading', pct: 0 })
    try {
      const { path, url } = await uploadLogo(file, (pct) => setUpload({ stage: 'uploading', pct }))
      setLogoPath(path)
      setLogoUrl(url)
      setUpload({ stage: 'done' })
    } catch (e: any) {
      setLogoPrint(null)
      setUpload({ stage: 'error', message: e?.message ?? 'The logo did not upload. Please try again.' })
    }
  }

  function removeLogo() {
    setLogoPath(null)
    setLogoUrl(null)
    setLogoPrint(null)
    setLogoProblem(null)
    setUpload({ stage: 'idle' })
  }

  function add() {
    setTouchedLink(true)
    if (!ready) {
      const why = (link ? linkProblem : 'Type where the code should point.') ?? captionProblem ?? logoProblem
      toast.warning('Almost there', why ?? '')
      return
    }
    const product = {
      id: QR_STAND.lineIdPrefix,
      name: QR_STAND.name,
      description: 'A countertop stand with your link as a QR code, your words under it and your logo in the middle.',
      price: QR_STAND.priceCents / 100,
      images: [`${window.location.origin}${PHOTOS[0].src}`],
      category: '3d-prints',
      inStock: true,
      weight: QR_STAND.weightLb,
      metadata: { product_kind: 'qr-stand', original_price: QR_STAND.wasCents / 100 },
    } as Product & { weight: number }
    const personalization: Record<string, string> = {
      [QR_FIELD.link]: link,
      [QR_FIELD.caption]: caption,
      ...(logoPath ? { [QR_FIELD.logoPath]: logoPath } : {}),
      ...(logoUrl ? { [QR_FIELD.logoUrl]: logoUrl } : {}),
      ...(ref ? { [QR_FIELD.ref]: ref } : {}),
    }
    addToCart(product, qty, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, personalization)
    setAdded(true)
    toast.success('Added to cart', `${qty} x ${QR_STAND.name}`)
  }

  const showLinkProblem = (touchedLink || link.length > 0) && (linkProblem || (touchedLink && !link))

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-28 sm:pb-12">
      <nav aria-label="Breadcrumb" className="text-sm text-muted mb-5">
        <Link to="/catalog" className="text-primary hover:underline">Shop</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span>Business Products</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-8 lg:gap-12 items-start">
        {/* Photos */}
        <div className="lg:sticky lg:top-6">
          <div className="rounded-2xl overflow-hidden bg-card border border-border shadow-soft">
            <img
              src={PHOTOS[photo].src}
              alt={PHOTOS[photo].alt}
              className="w-full aspect-[3/2] object-cover"
              loading="eager"
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {PHOTOS.map((p, i) => (
              <button
                key={p.src}
                type="button"
                onClick={() => setPhoto(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-pressed={photo === i}
                className={`rounded-xl overflow-hidden border-2 transition-colors ${photo === i ? 'border-primary' : 'border-border hover:border-primary/40'}`}
              >
                <img src={p.src} alt="" className="w-full aspect-[3/2] object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>

        {/* Order */}
        <div>
          <h1 className="font-display text-4xl sm:text-5xl text-text leading-tight">{QR_STAND.name}</h1>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="font-display text-2xl text-muted line-through" aria-label={`Was ${money(QR_STAND.wasCents)}`}>
              {money(QR_STAND.wasCents)}
            </span>
            <span className="font-display text-3xl text-text">{money(QR_STAND.priceCents)}</span>
            <span className="rounded-full bg-accent text-white text-xs font-semibold px-3 py-1">Sale</span>
          </div>
          <p className="mt-2 text-sm text-muted">
            Printed in {SHOP_PLACE.town}, {SHOP_PLACE.stateCode}. Ships within {STANDARD_FULFILLMENT_DAYS} business days.
          </p>

          <div className="mt-6 rounded-2xl border border-border bg-card shadow-soft p-5 sm:p-6">
            <Step n={1} title="Where should the code point?">
              <input
                type="url"
                inputMode="url"
                autoComplete="url"
                value={rawLink}
                onChange={(e) => setRawLink(e.target.value)}
                onBlur={() => setTouchedLink(true)}
                placeholder="https://g.page/r/your-review-link"
                aria-label="Where should the code point?"
                aria-invalid={!!showLinkProblem}
                aria-describedby="qr-link-help"
                className={`w-full rounded-xl border bg-card px-4 py-3 text-text placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40 ${showLinkProblem ? 'border-red-500' : 'border-border'}`}
              />
              <div id="qr-link-help" className="mt-2 flex items-start justify-between gap-3 text-sm">
                {showLinkProblem ? (
                  <p className="text-red-600 font-medium" role="alert">{linkProblem ?? 'Type where the code should point.'}</p>
                ) : (
                  <p className="text-muted">Your website, Google review, menu or payment link. Up to {QR_LINK_MAX_BYTES} characters.</p>
                )}
                {link && (
                  <span className={`shrink-0 tabular-nums ${bytes > QR_LINK_MAX_BYTES ? 'text-red-600' : 'text-muted'}`}>
                    {bytes}/{QR_LINK_MAX_BYTES}
                  </span>
                )}
              </div>
            </Step>

            <Step n={2} title="Words under the code">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Words under the code">
                {[...QR_CAPTIONS, 'Custom'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={preset === c}
                    onClick={() => setPreset(c)}
                    className={`rounded-full border px-4 py-2 text-sm transition-colors min-h-[44px] ${
                      preset === c ? 'border-accent text-accent bg-accent/5' : 'border-border text-text hover:border-accent/50'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {preset === 'Custom' && (
                <div className="mt-3">
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    maxLength={QR_CAPTION_MAX}
                    placeholder="Your words"
                    aria-label="Your words under the code"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-text placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {custom && captionProblem && <p className="mt-2 text-sm text-red-600" role="alert">{captionProblem}</p>}
                </div>
              )}
            </Step>

            <Step n={3} title="Your logo for the centre">
              {logoPrint || uploading ? (
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 shrink-0 rounded-xl border border-border bg-bg flex items-center justify-center p-2">
                    {logoPrint && <img src={logoPrint} alt="Your logo as it prints" className="max-w-full max-h-full" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {uploading ? (
                      <>
                        <p className="text-sm text-text mb-2">Uploading your logo… {upload.pct}%</p>
                        <div className="h-2 rounded-full bg-border overflow-hidden" role="progressbar" aria-valuenow={upload.pct} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${upload.pct}%` }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-text">Printed in black, like the code.</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-3 py-2 text-sm hover:bg-primary/5 min-h-[40px]"
                          >
                            <ImageUp className="w-4 h-4" aria-hidden="true" /> Replace logo
                          </button>
                          <button
                            type="button"
                            onClick={removeLogo}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 text-accent px-3 py-2 text-sm hover:bg-accent/5 min-h-[40px]"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" /> Remove
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    void takeFile(e.dataTransfer.files?.[0])
                  }}
                  className={`w-full rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                    dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 bg-bg/60'
                  }`}
                >
                  <ImageUp className="w-8 h-8 mx-auto text-primary" aria-hidden="true" />
                  <span className="block mt-2 text-sm text-text">Drop your logo here (PNG or JPG).</span>
                  <span className="block text-xs text-muted mt-1">It goes in the square in the middle of the code.</span>
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  void takeFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              {(logoProblem || upload.stage === 'error') && (
                <p className="mt-2 text-sm text-red-600" role="alert">
                  {logoProblem ?? (upload.stage === 'error' ? upload.message : '')}
                </p>
              )}
            </Step>

            <Step n={4} title="Live preview">
              <div className="rounded-xl bg-bg border border-border px-6 py-5 flex justify-center">
                <StandPreview
                  link={linkProblem ? '' : link}
                  caption={captionProblem ? '' : caption}
                  logoSrc={logoPrint}
                  className="w-full max-w-[260px] h-auto"
                />
              </div>
            </Step>

            <Step n={5} title="Quantity">
              <div className="inline-flex items-center rounded-xl border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="One fewer"
                  className="w-12 h-12 flex items-center justify-center text-primary hover:bg-primary/5 disabled:opacity-40"
                  disabled={qty <= 1}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-14 text-center tabular-nums text-text" aria-live="polite" aria-label={`Quantity ${qty}`}>
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(50, q + 1))}
                  aria-label="One more"
                  className="w-12 h-12 flex items-center justify-center text-primary hover:bg-primary/5"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </Step>

            <div className="pt-5">
              <button
                type="button"
                onClick={add}
                disabled={uploading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white font-semibold py-3.5 shadow-soft hover:bg-primary/90 active:scale-[0.99] transition disabled:opacity-60"
              >
                <ShoppingCart className="w-5 h-5" aria-hidden="true" />
                Add to cart{qty > 1 ? ` · ${money(QR_STAND.priceCents * qty)}` : ''}
              </button>
              {added && (
                <button
                  type="button"
                  onClick={() => navigate('/cart')}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary text-primary font-semibold py-3 hover:bg-primary/5"
                >
                  <Check className="w-5 h-5" aria-hidden="true" /> In your cart: check out
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
