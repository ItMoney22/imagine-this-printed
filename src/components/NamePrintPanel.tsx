// 3D name gifts — the customer-facing panel (task bf353160).
//
// Shown on /product/:id when the product carries products.metadata.name_print
// (a name ornament or a name keychain). The customer types a name and sees
// their piece from above, drawn by the server from the SAME outlines the print
// file is built from — so what they type is exactly what prints. There is no
// sample name: until they type, the preview says so instead.
//
// Previews are free (geometry, no model call), so this one follows the typing
// with a short pause instead of waiting for a button press. No spinner (David
// 2026-09-02): the last picture stays up, dimmed, until the new one lands.
import React, { useEffect, useRef, useState } from 'react'
import { PenLine } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { sanitizeName, typingName, type NamePrintTemplate } from '../../backend/shared/name-print'

interface Props {
  productId: string
  template: NamePrintTemplate
  /** Lifted so the page can gate Add to Cart and pass the name through. */
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}

interface Preview {
  name: string
  svg: string
  widthIn: number
  heightIn: number
}

const PAUSE_MS = 250

const SHAPE_WORD: Record<NamePrintTemplate['shape'], string> = { ornament: 'ornament', keychain: 'keychain' }

const NamePrintPanel: React.FC<Props> = ({ productId, template, values, onChange }) => {
  const key = template.field.key
  const name = values[key] ?? ''
  const [preview, setPreview] = useState<Preview | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const typed = name.trim()
    if (!typed) {
      setPreview(null)
      return
    }
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch('/api/name-print/preview', {
          method: 'POST',
          body: JSON.stringify({ productId, values: { [key]: typed } }),
        })
        if (mine !== seq.current) return
        setUnavailable(false)
        setPreview({ name: data.values?.[key] ?? typed, svg: data.svg, widthIn: data.size?.widthIn, heightIn: data.size?.heightIn })
      } catch {
        // An API that predates this feature (Vercel deploys ahead of Render)
        // or a blip. The name is still kept and still printed as typed.
        if (mine === seq.current) setUnavailable(true)
      }
    }, PAUSE_MS)
    return () => clearTimeout(timer)
  }, [name, key, productId])

  const stale = preview !== null && preview.name !== name.trim()
  const shape = SHAPE_WORD[template.shape]

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <PenLine className="w-4 h-4 text-primary" />
        <h3 className="font-display font-semibold text-text">Add the name</h3>
        {template.upcharge ? <span className="ml-auto text-sm text-muted">+${template.upcharge.toFixed(2)}</span> : null}
      </div>

      <label className="block">
        <span className="block text-sm text-muted mb-1">{template.field.label}</span>
        <input
          type="text"
          value={name}
          maxLength={template.field.max}
          onChange={(e) => onChange({ ...values, [key]: typingName(e.target.value, template.field.max) })}
          onBlur={() => onChange({ ...values, [key]: sanitizeName(name, template.field.max) })}
          placeholder="Type a name"
          autoComplete="off"
          className="w-full rounded-lg border border-primary/30 bg-bg px-3 py-2 text-lg text-text
                     placeholder:text-muted/60 focus:border-primary focus:outline-none"
        />
        <span className="mt-1 flex justify-between text-xs text-muted">
          <span>Printed exactly as typed, capitals included.</span>
          <span>
            {sanitizeName(name, template.field.max).length}/{template.field.max}
          </span>
        </span>
      </label>

      <figure className="space-y-2">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-primary/20 bg-bg">
          {preview ? (
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
              alt={`Your ${shape} with the name ${preview.name}`}
              className={`h-full w-full object-contain p-4 transition-opacity duration-200 ${stale ? 'opacity-50' : 'opacity-100'}`}
            />
          ) : (
            <p className="px-6 text-center text-sm text-muted">Your name shows up here as you type.</p>
          )}
        </div>
        <figcaption className="text-xs text-muted">
          {preview && !stale
            ? `Seen from above: ${template.colours.plate.name.toLowerCase()} ${shape}, name raised in ${template.colours.letters.name.toLowerCase()}. About ${preview.widthIn} x ${preview.heightIn} in.`
            : unavailable
              ? 'The preview is taking a break. Your name is saved and printed exactly as typed.'
              : 'Check the spelling: we print exactly what you type.'}
        </figcaption>
      </figure>
    </div>
  )
}

/**
 * The cart's picture of a name gift: the shopper's OWN name on it, not the
 * example name in the product photos. Falls back to the product photo while
 * it loads or if the preview is unavailable.
 */
export const NamePrintThumb: React.FC<{ productId: string; name: string; fallback: string; className?: string }> = ({
  productId,
  name,
  fallback,
  className,
}) => {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    apiFetch('/api/name-print/preview', { method: 'POST', body: JSON.stringify({ productId, values: { name } }) })
      .then((data) => live && typeof data?.svg === 'string' && setSvg(data.svg))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [productId, name])
  return (
    <img
      src={svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : fallback}
      alt={`Your piece with the name ${name}`}
      className={className}
    />
  )
}

export default NamePrintPanel
