// Team shirt personalization — the customer-facing panel.
//
// Shown on /product/:id when the product carries a team template. The customer
// types a name and a number; the back plate re-renders as they type and the
// picture they approve is literally the file the press receives (same render
// function, different width — see backend/services/team-plate/render.ts).
//
// TWO THINGS THIS DELIBERATELY GETS RIGHT
//
//   1. FEATURE DETECTION. Vercel deploys ahead of Render, so a browser can be
//      holding a product page that knows about /api/team-plate while the API
//      has never heard of it (this bit ITP for real on 2026-09-08). A 404 or a
//      network error makes the panel hide itself and the shirt sells as an
//      ordinary product — far better than a form that errors on every
//      keystroke, which reads to a customer as a broken store.
//
//   2. NO SPINNER. David, 2026-09-02: any waiting UI is a themed animated
//      progress bar with stage text and elapsed time. Most renders are cached
//      and return in ~150ms, so the bar is only ever seen on a genuinely new
//      name.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Type } from 'lucide-react'
import { apiFetch } from '../lib/api'

export interface TeamTemplateField {
  key: string
  label: string
  type: 'text' | 'number'
  max: number
  uppercase?: boolean
}

export interface TeamTemplateSummary {
  version: number
  fields: TeamTemplateField[]
  upcharge?: number
}

interface Props {
  productId: string
  template: TeamTemplateSummary
  /** Lifted so the page can gate Add to Cart and pass values through. */
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
  /** Told when the API turns out not to support this yet (deploy skew). */
  onUnsupported: () => void
}

const DEBOUNCE_MS = 400
/** A fresh render is ~150ms warm; this is the honest ceiling for a cold one. */
const EXPECTED_MS = 1500

/** Mirrors backend/shared/team-template.ts sanitizeFieldValue. The server
 *  sanitizes again at preview AND at checkout — this only keeps the input box
 *  from showing characters that will be silently dropped. */
function clean(field: TeamTemplateField, raw: string): string {
  if (field.type === 'number') return raw.replace(/[^0-9]/g, '').slice(0, field.max)
  let out = raw.replace(/[^A-Za-z0-9 '-]/g, '').replace(/\s+/g, ' ')
  if (field.uppercase !== false) out = out.toUpperCase()
  return out.slice(0, field.max)
}

const TeamPersonalizePanel: React.FC<Props> = ({ productId, template, values, onChange, onUnsupported }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards against an out-of-order response overwriting a newer preview when
  // someone types quickly.
  const requestSeq = useRef(0)

  const filled = template.fields.every((f) => (values[f.key] ?? '').length > 0)

  const runPreview = useCallback(
    async (next: Record<string, string>) => {
      const seq = ++requestSeq.current
      setBusy(true)
      setError(null)
      const startedAt = Date.now()
      const tick = setInterval(() => setElapsed(Date.now() - startedAt), 100)
      try {
        const data = await apiFetch('/api/team-plate/preview', {
          method: 'POST',
          body: JSON.stringify({ productId, values: next }),
        })
        if (seq !== requestSeq.current) return
        setPreviewUrl(data.url)
      } catch (err: any) {
        if (seq !== requestSeq.current) return
        // apiFetch throws a plain Error('HTTP 404: ...') with no status
        // property, so the code has to be read off the message. A TypeError
        // (no HTTP code at all) is a network/CORS failure, which on a fresh
        // deploy means the same thing: this API does not serve the route.
        const message = String(err?.message ?? '')
        const notServed = /HTTP (404|405|501)[^0-9]/.test(message + ' ') || !/HTTP [0-9]{3}/.test(message)
        if (notServed) {
          // The API predates this feature (or is unreachable). Sell the shirt
          // rather than show a broken form.
          onUnsupported()
          return
        }
        setError('Could not draw that preview. Your name and number are still saved.')
      } finally {
        clearInterval(tick)
        if (seq === requestSeq.current) setBusy(false)
      }
    },
    [productId, onUnsupported]
  )

  // Debounced: one render per pause in typing, not one per keystroke.
  useEffect(() => {
    if (!filled) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => runPreview(values), DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), filled, runPreview])

  const setField = (field: TeamTemplateField, raw: string) => {
    onChange({ ...values, [field.key]: clean(field, raw) })
  }

  const pct = Math.min(95, Math.round((elapsed / EXPECTED_MS) * 100))

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Type className="w-4 h-4 text-primary" />
        <h3 className="font-display font-semibold text-text">Personalize the back</h3>
        {template.upcharge ? (
          <span className="ml-auto text-sm text-muted">+${template.upcharge.toFixed(2)}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {template.fields.map((field) => (
          <label key={field.key} className="block">
            <span className="block text-sm text-muted mb-1">{field.label}</span>
            <input
              type="text"
              inputMode={field.type === 'number' ? 'numeric' : 'text'}
              value={values[field.key] ?? ''}
              maxLength={field.max}
              onChange={(e) => setField(field, e.target.value)}
              placeholder={field.type === 'number' ? '00' : 'LAST NAME'}
              className="w-full rounded-lg border border-primary/30 bg-bg px-3 py-2 text-text
                         placeholder:text-muted/60 focus:border-primary focus:outline-none"
            />
            <span className="mt-1 block text-xs text-muted">
              {(values[field.key] ?? '').length}/{field.max}
            </span>
          </label>
        ))}
      </div>

      {busy && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            Drawing your name on the back… {(elapsed / 1000).toFixed(1)}s
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {previewUrl && !busy && (
        <figure className="space-y-1">
          <img
            src={previewUrl}
            alt="Your personalized back print"
            className="w-full rounded-lg border border-primary/20 bg-white"
          />
          <figcaption className="text-xs text-muted">
            This is exactly what gets printed.
          </figcaption>
        </figure>
      )}

      {!filled && (
        <p className="text-sm text-muted">
          Fill in {template.fields.map((f) => f.label.toLowerCase()).join(' and ')} to see your shirt.
        </p>
      )}
    </div>
  )
}

export default TeamPersonalizePanel
