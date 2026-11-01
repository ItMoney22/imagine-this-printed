// Create-your-own pet ornament — the customer-facing panel (task 81358f3a).
//
// Shown on /product/:id when the product carries products.metadata.pet_ornament.
// Three plain steps: pick the pet and type its name, add a photo if you like,
// see YOUR ornament. The picture is drawn by the server from the SAME outlines
// the print files are built from, in the filaments that will print, so what
// the customer sees is what arrives. No photo -> our own design for the pet.
//
// The name preview is free and follows the typing. A photo is one drawing
// (~15 s) and can be swapped for another or dropped for our design at any time.
import React, { useEffect, useRef, useState } from 'react'
import { Camera, PawPrint, RefreshCw, Sparkles, X } from 'lucide-react'
import api, { apiFetch } from '../lib/api'
import { sanitizeName, typingName } from '../../backend/shared/name-print'
import type { PetOrnamentTemplate } from '../../backend/shared/pet-ornament'

interface Props {
  productId: string
  template: PetOrnamentTemplate
  /** Lifted so the page can gate Add to Cart and pass the values through. */
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}

interface Preview {
  key: string
  svg: string
  colours: Array<{ name: string; hex: string }>
  widthIn: number
  heightIn: number
}

const PAUSE_MS = 250
/** The photo goes up at most this big: plenty for a portrait, quick on a phone connection. */
const UPLOAD_EDGE = 1024

/** Phone photos can be 5-12 MB (and HEIC on iPhone). The browser decodes it; we send a small JPEG. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That file is not a photo we can read. Try a JPEG or PNG.'))
      el.src = url
    })
    const scale = Math.min(1, UPLOAD_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that photo'))), 'image/jpeg', 0.9)
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

const STEPS = [
  { img: '/pet-ornament/step-pick.webp', title: 'Pick your pet', text: 'Cat, dog or bunny, and type their name.' },
  { img: '/pet-ornament/step-photo.webp', title: 'Add a photo', text: 'Optional. We draw YOUR pet from it.' },
  { img: '/pet-ornament/step-hang.webp', title: 'See it, then order', text: 'Printed in up to 4 colours, ready to hang.' },
]

const PetOrnamentPanel: React.FC<Props> = ({ productId, template, values, onChange }) => {
  const key = template.field.key
  const pet = values.pet && template.pets.some((p) => p.id === values.pet) ? values.pet : template.pets[0].id
  const name = values[key] ?? ''
  const portrait = values.portrait ?? ''
  const petLabel = template.pets.find((p) => p.id === pet)!.label

  const [preview, setPreview] = useState<Preview | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const set = (patch: Record<string, string>) => onChange({ ...values, pet, ...patch })

  // The page's values start empty; settle the pet so the cart always carries one.
  useEffect(() => {
    if (values.pet !== pet) onChange({ ...values, pet })
  }, [pet]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  const typed = name.trim()
  const previewKey = `${pet}|${portrait}|${typed}`
  useEffect(() => {
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch('/api/pet-ornament/preview', {
          method: 'POST',
          body: JSON.stringify({ productId, values: { pet, [key]: typed, portrait } }),
        })
        if (mine !== seq.current) return
        setUnavailable(false)
        setPreview({ key: previewKey, svg: data.svg, colours: data.colours ?? [], widthIn: data.size?.widthIn, heightIn: data.size?.heightIn })
      } catch (err: any) {
        if (mine !== seq.current) return
        // A portrait older than the store keeps (or a blip): fall back to our design.
        if (String(err?.message).includes('HTTP 410') && portrait) {
          setPhotoError('That photo has expired. Add it again, or keep our design.')
          set({ portrait: '' })
          return
        }
        setUnavailable(true)
      }
    }, PAUSE_MS)
    return () => clearTimeout(timer)
  }, [previewKey, productId, key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setPhotoError(null)
    setDrawing(true)
    setPhotoUrl(URL.createObjectURL(file))
    try {
      const small = await shrinkPhoto(file)
      const form = new FormData()
      form.append('productId', productId)
      form.append('pet', pet)
      form.append('photo', small, 'pet.jpg')
      const { data } = await api.post('/api/pet-ornament/portrait', form)
      set({ portrait: data.portraitId })
    } catch (err: any) {
      setPhotoError(err?.message || 'Our artist could not draw that one. Try another photo.')
      setPhotoUrl(null)
    } finally {
      setDrawing(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function dropPhoto() {
    setPhotoUrl(null)
    setPhotoError(null)
    set({ portrait: '' })
  }

  const stale = preview !== null && preview.key !== previewKey
  const cleanName = sanitizeName(name, template.field.max)

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-5">
      {/* The three steps, in pictures. */}
      <ol className="grid grid-cols-3 gap-2 sm:gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="text-center">
            <img src={s.img} alt="" className="mx-auto aspect-square w-full max-w-[120px] rounded-lg object-cover" loading="lazy" />
            <p className="mt-1.5 text-xs font-semibold text-text">
              <span className="text-primary">{i + 1}.</span> {s.title}
            </p>
            <p className="hidden text-[11px] leading-snug text-muted sm:block">{s.text}</p>
          </li>
        ))}
      </ol>

      {/* 1. Pet + name */}
      <fieldset>
        <legend className="mb-2 flex items-center gap-2 font-display font-semibold text-text">
          <PawPrint className="h-4 w-4 text-primary" /> Your pet
          {template.upcharge ? <span className="ml-auto text-sm font-normal text-muted">+${template.upcharge.toFixed(2)}</span> : null}
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pet">
          {template.pets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === pet}
              onClick={() => set({ pet: p.id })}
              className={`flex items-center gap-2 rounded-full border-2 py-1 pl-1 pr-4 text-sm font-semibold transition-colors ${
                p.id === pet ? 'border-primary bg-primary/10 text-text' : 'border-border bg-bg text-muted hover:border-primary/50'
              }`}
            >
              <img src={`/pet-ornament/pet-${p.id}.webp`} alt="" className="h-8 w-8 rounded-full bg-white object-cover" />
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-sm text-muted">{template.field.label}</span>
        <input
          type="text"
          value={name}
          maxLength={template.field.max}
          onChange={(e) => set({ [key]: typingName(e.target.value, template.field.max) })}
          onBlur={() => set({ [key]: sanitizeName(name, template.field.max) })}
          placeholder="Type their name"
          autoComplete="off"
          className="w-full rounded-lg border border-primary/30 bg-bg px-3 py-2 text-lg text-text placeholder:text-muted/60 focus:border-primary focus:outline-none"
        />
        <span className="mt-1 flex justify-between text-xs text-muted">
          <span>Printed exactly as typed, capitals included.</span>
          <span>
            {cleanName.length}/{template.field.max}
          </span>
        </span>
      </label>

      {/* 2. Photo (optional) */}
      {template.photo && (
        <div className="space-y-2">
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          {portrait || drawing ? (
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-bg p-2">
              {photoUrl ? (
                <img src={photoUrl} alt="Your photo" className={`h-14 w-14 rounded-md object-cover ${drawing ? 'opacity-60' : ''}`} />
              ) : (
                <Camera className="h-6 w-6 text-primary" />
              )}
              <p className="flex-1 text-sm text-text" aria-live="polite">
                {drawing ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 animate-pulse text-primary" /> Drawing your {petLabel.toLowerCase()}… about 15 seconds
                  </span>
                ) : (
                  `Drawn from your photo.`
                )}
              </p>
              {!drawing && (
                <div className="flex flex-col gap-1 text-right">
                  <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    <RefreshCw className="h-3 w-3" /> Try another photo
                  </button>
                  <button type="button" onClick={dropPhoto} className="inline-flex items-center gap-1 text-xs text-muted hover:underline">
                    <X className="h-3 w-3" /> Use our design
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-bg px-3 py-3 text-sm font-semibold text-text hover:border-primary"
            >
              <Camera className="h-5 w-5 text-primary" /> Add a photo of your {petLabel.toLowerCase()} <span className="font-normal text-muted">(optional)</span>
            </button>
          )}
          {photoError && <p className="text-sm text-red-500">{photoError}</p>}
          <p className="text-xs text-muted">A clear, front-facing photo works best. We use it only to draw your ornament.</p>
        </div>
      )}

      {/* 3. Their ornament */}
      <figure className="space-y-2">
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-primary/20 bg-bg sm:aspect-[4/3]">
          {preview ? (
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
              alt={`Your ${petLabel.toLowerCase()} ornament${preview.key.split('|')[2] ? ` with the name ${preview.key.split('|')[2]}` : ''}`}
              className={`h-full w-full object-contain p-4 transition-opacity duration-200 ${stale || drawing ? 'opacity-50' : 'opacity-100'}`}
            />
          ) : (
            <p className="px-6 text-center text-sm text-muted">Your ornament shows up here.</p>
          )}
        </div>
        <figcaption className="text-xs text-muted">
          {unavailable
            ? 'The preview is taking a break. Your choices are saved and printed exactly as shown.'
            : preview && !stale
              ? `Seen from above, in the colours we print: ${preview.colours.map((c) => c.name.toLowerCase()).join(', ')}. About ${preview.widthIn} x ${preview.heightIn} in.${
                  typed ? '' : ' Type a name to add it.'
                }`
              : 'Check the spelling: we print exactly what you type.'}
        </figcaption>
      </figure>
    </div>
  )
}

/** The cart's picture of a pet ornament: THEIR pet and name, not the product photo. */
export const PetOrnamentThumb: React.FC<{ productId: string; values: Record<string, string>; fallback: string; className?: string }> = ({
  productId,
  values,
  fallback,
  className,
}) => {
  const [svg, setSvg] = useState<string | null>(null)
  const sig = JSON.stringify(values)
  useEffect(() => {
    let live = true
    apiFetch('/api/pet-ornament/preview', { method: 'POST', body: JSON.stringify({ productId, values }) })
      .then((data) => live && typeof data?.svg === 'string' && setSvg(data.svg))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [productId, sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <img
      src={svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : fallback}
      alt={`Your pet ornament${values.name ? ` for ${values.name}` : ''}`}
      className={className}
    />
  )
}

export default PetOrnamentPanel
