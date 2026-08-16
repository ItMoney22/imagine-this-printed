// ---------------------------------------------------------------------------
// "See It On You" — buyer-side virtual try-on card for the product page.
// Watchtower task 3b362203.
//
// SHAPE OF THE UX (decision recorded in the handoff):
// An inline card in the buy column, not a modal. A modal would hide the price
// and the Add to Cart button behind it, and the entire point of this feature is
// to move add-to-cart — the result and the cart button need to be on screen
// together. The card renders only for apparel and only when the backend says
// the feature is switched on, so it stays invisible until FASHN is provisioned.
//
// Flow: pick a photo -> pick a tier -> render -> result sits beside the original
// with an Add to Cart right there. That last button is what carries the
// attribution: it reports the tryonId, which is how the cohort report knows an
// add-to-cart came from a shopper who used the feature.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Camera,
  Coins,
  ImagePlus,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { tryonApi, type TryOnConfig, type TryOnResult } from '../lib/api'

interface VirtualTryOnProps {
  productId: string
  productName: string
  /** Index into the product's gallery — the garment the shopper is looking at. */
  garmentImageIndex: number
  /** Called from the result panel; receives the try-on the cart is attributed to. */
  onAddToCart: (attribution: { tryonId: string | null; secondsSinceTryon: number }) => void
  disabled?: boolean
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

type Tier = 'standard' | 'premium'

export default function VirtualTryOn({
  productId,
  productName,
  garmentImageIndex,
  onAddToCart,
  disabled
}: VirtualTryOnProps) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [available, setAvailable] = useState<boolean | null>(null)
  const [config, setConfig] = useState<TryOnConfig | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier>('standard')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<TryOnResult | null>(null)
  const [resultAt, setResultAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const viewLogged = useRef(false)

  // --- availability -------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    tryonApi
      .isEnabled()
      .then((res) => { if (!cancelled) setAvailable(Boolean(res?.enabled)) })
      .catch(() => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [])

  // Personal state (free-remaining, balance, prices) only exists for a signed-in
  // shopper — /config is behind auth.
  //
  // Keyed on user.id, NOT on the user object. An auth context that hands back a
  // fresh object on every render would otherwise re-run this effect forever and
  // its cleanup would cancel each fetch before it landed — config would stay
  // null and the card would show stale "1 free today" copy for good.
  const userId = user?.id
  useEffect(() => {
    if (!userId || available !== true) return
    let cancelled = false
    tryonApi
      .getConfig()
      .then((cfg) => { if (!cancelled) setConfig(cfg) })
      .catch(() => { /* the card still works; it just shows generic pricing */ })
    return () => { cancelled = true }
  }, [userId, available])

  // --- instrumentation: the matched-cohort denominator --------------------
  // Fires once, when the card is actually on screen. "Rendered in the DOM" is
  // not "seen", and the whole conversion comparison rests on this being an
  // honest impression count.
  useEffect(() => {
    if (!userId || available !== true || viewLogged.current) return
    const node = cardRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !viewLogged.current) {
          viewLogged.current = true
          void tryonApi.track({ eventType: 'tryon_card_viewed', productId })
          observer.disconnect()
        }
      },
      { threshold: 0.4 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [userId, available, productId])

  // Revoke the object URL so a shopper cycling through photos doesn't leak blobs.
  useEffect(() => {
    return () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }
  }, [photoPreview])

  const pickPhoto = useCallback((file: File | undefined) => {
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.warning('Unsupported file', 'Use a JPEG, PNG or WebP photo.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.warning('Photo too large', 'Keep it under 10 MB.')
      return
    }
    setPhotoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setPhoto(file)
    setResult(null)
    setError(null)
  }, [toast])

  const clearPhoto = useCallback(() => {
    setPhotoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setPhoto(null)
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const freeAvailable = config ? !config.freeUsedToday : true
  const tierCost = config?.tiers
    ? (tier === 'premium' ? config.tiers.premium.itcCost : config.tiers.standard.itcCost)
    : (tier === 'premium' ? 25 : 10)
  const costNow = freeAvailable ? 0 : tierCost
  const balance = config?.itcBalance ?? 0
  const cannotAfford = !freeAvailable && balance < tierCost

  const handleGenerate = useCallback(async () => {
    if (!photo || !user) return
    setGenerating(true)
    setError(null)
    try {
      const res = await tryonApi.generate({ photo, productId, tier, garmentImageIndex })
      setResult(res)
      setResultAt(Date.now())
      // Written even when /config never landed — otherwise the card would keep
      // advertising "1 free today" after the shopper has spent it.
      setConfig((prev) => ({
        ...(prev ?? { enabled: true, dailyFreeCap: 1 }),
        freeUsedToday: true,
        freeRemainingToday: 0,
        itcBalance: res.itcBalance
      }))
      toast.success(
        res.usedFree ? 'Here you go — on the house' : `Rendered for ${res.itcCharged} ITC`,
        res.usedFree ? "That's today's free try-on." : `${res.itcBalance} ITC left in your wallet.`
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      // apiFetch prefixes "HTTP 402: " onto the server's message; the shopper
      // only needs the sentence.
      setError(message.replace(/^HTTP \d+:\s*/, ''))
    } finally {
      setGenerating(false)
    }
  }, [photo, user, productId, tier, garmentImageIndex, toast])

  const handleDelete = useCallback(async () => {
    if (!result?.tryonId) { clearPhoto(); return }
    try {
      await tryonApi.remove(result.tryonId)
      toast.success('Deleted', 'That try-on and your photo are gone.')
    } catch {
      toast.error('Could not delete', 'Try that again in a moment.')
    }
    clearPhoto()
  }, [result, clearPhoto, toast])

  // Deliberately does NOT emit the add_to_cart event itself. ProductPage owns
  // that call for BOTH buttons — if only this one reported, the control cohort
  // would show a 0% add-to-cart rate and every lift number would be a lie.
  const handleAddToCart = useCallback(() => {
    const seconds = resultAt ? Math.round((Date.now() - resultAt) / 1000) : 0
    onAddToCart({ tryonId: result?.tryonId ?? null, secondsSinceTryon: seconds })
  }, [resultAt, result, onAddToCart])

  // The card does not exist until FASHN is provisioned. No teaser, no dead
  // button — an unprovisioned feature advertising itself is just a broken promise.
  if (available !== true) return null

  return (
    <div
      ref={cardRef}
      className="bg-card card-border rounded-2xl p-5 shadow-soft"
      aria-labelledby="tryon-heading"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 id="tryon-heading" className="font-semibold text-text flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
          See It On You
        </h3>
        {freeAvailable && user && (
          <span className="shrink-0 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/30">
            1 free today
          </span>
        )}
      </div>

      <p className="text-sm text-muted mb-4">
        Upload a photo of yourself and we'll put {productName} on you before you buy.
      </p>

      {!user ? (
        <button
          onClick={() => navigate(`/login?redirect=/product/${productId}`)}
          className="w-full btn-secondary min-h-[44px]"
        >
          <Camera className="w-4 h-4" aria-hidden="true" />
          Sign in to try it on
        </button>
      ) : (
        <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => pickPhoto(e.target.files?.[0])}
            accept={ACCEPTED.join(',')}
            className="hidden"
          />

          {/* --- photo slot --- */}
          {!photoPreview ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="w-full min-h-[44px] flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border-2 border-dashed border-primary/40 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              <ImagePlus className="w-8 h-8 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium text-text">Choose a photo</span>
              <span className="text-xs text-muted">Head-to-knee shot works best · JPEG, PNG or WebP · 10 MB max</span>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <figure className="relative">
                <img
                  src={photoPreview}
                  alt="The photo you uploaded"
                  className="w-full aspect-[3/4] object-cover rounded-xl bg-bg/40"
                />
                <figcaption className="mt-1 text-xs text-muted text-center">Your photo</figcaption>
                <button
                  onClick={clearPhoto}
                  aria-label="Remove photo"
                  className="absolute top-2 right-2 w-9 h-9 flex items-center justify-center rounded-full bg-bg/80 text-text hover:bg-bg transition-colors"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </figure>

              <figure className="relative">
                {generating ? (
                  <div className="w-full aspect-[3/4] rounded-xl bg-bg/40 card-border flex flex-col items-center justify-center gap-2 px-2 text-center">
                    <Loader2 className="w-7 h-7 text-primary animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    <span className="text-xs text-muted">Dressing you…</span>
                  </div>
                ) : result ? (
                  <img
                    src={result.imageUrl}
                    alt={`${productName} rendered on your photo`}
                    className="w-full aspect-[3/4] object-cover rounded-xl bg-bg/40 shadow-glow"
                  />
                ) : (
                  <div className="w-full aspect-[3/4] rounded-xl bg-bg/40 card-border flex items-center justify-center">
                    <Camera className="w-7 h-7 text-muted" aria-hidden="true" />
                  </div>
                )}
                <figcaption className="mt-1 text-xs text-muted text-center">
                  {result ? 'On you' : 'Your try-on'}
                </figcaption>
              </figure>
            </div>
          )}

          {/* --- extra poses from a premium render --- */}
          {result && result.images.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto">
              {result.images.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt={`Try-on pose ${i + 1}`}
                  className="w-16 h-20 object-cover rounded-md card-border shrink-0"
                />
              ))}
            </div>
          )}

          {/* --- tier picker ---
              Hidden while the free render is available, because the server
              ALWAYS spends the free slot on the cheapest configuration. Showing
              "Premium · 2 poses · free today" would promise a second pose the
              shopper is never going to get. */}
          {photoPreview && !result && freeAvailable && (
            <p className="mt-4 text-xs text-muted">
              Today's free try-on renders in Standard. Premium ({config?.tiers?.premium.poses ?? 2} poses)
              unlocks after that for {config?.tiers?.premium.itcCost ?? 25} ITC.
            </p>
          )}

          {photoPreview && !result && !freeAvailable && (
            <fieldset className="mt-4">
              <legend className="sr-only">Try-on quality</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['standard', 'premium'] as Tier[]).map((t) => {
                  const cost = config?.tiers
                    ? (t === 'premium' ? config.tiers.premium.itcCost : config.tiers.standard.itcCost)
                    : (t === 'premium' ? 25 : 10)
                  const poses = config?.tiers
                    ? (t === 'premium' ? config.tiers.premium.poses : config.tiers.standard.poses)
                    : (t === 'premium' ? 2 : 1)
                  const selected = tier === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTier(t)}
                      aria-pressed={selected}
                      // Both states carry a 2px border so selecting one doesn't
                      // shift the row by a pixel.
                      className={`min-h-[44px] px-3 py-2 rounded-xl text-left transition-colors border-2 ${
                        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-text capitalize">{t}</span>
                      <span className="block text-xs text-muted">
                        {poses} {poses === 1 ? 'pose' : 'poses'} · {cost} ITC
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          {/* --- errors --- */}
          {error && (
            <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>
          )}

          {/* --- actions --- */}
          <div className="mt-4 space-y-2">
            {!result ? (
              <>
                <button
                  onClick={handleGenerate}
                  disabled={!photo || generating || disabled || cannotAfford}
                  className="w-full btn-primary min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                  )}
                  {generating
                    ? 'Rendering…'
                    : costNow === 0
                      ? 'Try it on — free'
                      : `Try it on — ${costNow} ITC`}
                </button>

                {!freeAvailable && (
                  <p className="text-xs text-muted flex items-center gap-1.5 justify-center">
                    <Coins className="w-3.5 h-3.5" aria-hidden="true" />
                    {cannotAfford
                      ? `You need ${tierCost} ITC and have ${balance}.`
                      : `Today's free try-on is used. Balance: ${balance} ITC.`}
                  </p>
                )}
              </>
            ) : (
              <>
                {/* THE conversion lever: the cart button lives next to the result. */}
                <button
                  onClick={handleAddToCart}
                  disabled={disabled}
                  className="w-full btn-primary shadow-glow min-h-[44px] disabled:opacity-50"
                >
                  <ShoppingCart className="w-4 h-4" aria-hidden="true" />
                  Add to Cart
                </button>
                <div className="flex gap-2">
                  <button onClick={clearPhoto} className="flex-1 btn-secondary min-h-[44px] !px-4 !py-2 text-sm">
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    Another photo
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex-1 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold text-muted hover:text-red-600 card-border transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>

          <p className="mt-3 text-xs text-muted flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            Your photo is private to your account and is only used to make this try-on.
            Delete it any time and the file goes with it.
          </p>
        </>
      )}
    </div>
  )
}
