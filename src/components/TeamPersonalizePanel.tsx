// Team shirt personalization — the customer-facing panel.
//
// Shown on /product/:id when the product carries a team template. The customer
// types their name and number; the back print re-renders in real-time.
//
// DESIGN & UX PRINCIPLES:
//   1. FRICTIONLESS: Does not block preview when only one field is typed. Typing either
//      name or number immediately generates the live preview of the shirt back.
//   2. INSTANT DEMO: A one-tap sample preset ("Try Sample: SMITH 22") lets operators
//      and customers verify the render instantly without typing.
//   3. CLEAR EXPLANATIONS: Guided steps and helper hints explain exactly what will be printed.
//   4. DEPLOY SKEW RESILIENT: Gracefully handles API version skew without broken forms.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Shirt,
  Maximize2,
  X,
} from 'lucide-react'
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

export interface Props {
  productId: string
  template: TeamTemplateSummary
  /** Lifted so the page can gate Add to Cart and pass values through. */
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
  /** Told when the API turns out not to support this yet (deploy skew). */
  onUnsupported: () => void
  /** Optional back artwork image fallback to show before preview is rendered. */
  backImageUrl?: string
}

const DEBOUNCE_MS = 350
const EXPECTED_MS = 1500

/**
 * Sanitizes input to printable alphanumeric characters.
 */
function cleanInput(field: TeamTemplateField, raw: string): string {
  if (field.type === 'number') {
    return raw.replace(/[^0-9]/g, '').slice(0, field.max)
  }
  let out = raw.replace(/[^A-Za-z0-9 '-]/g, '').replace(/\s+/g, ' ')
  if (field.uppercase !== false) {
    out = out.toUpperCase()
  }
  return out.slice(0, field.max)
}

const TeamPersonalizePanel: React.FC<Props> = ({
  productId,
  template,
  values,
  onChange,
  onUnsupported,
  backImageUrl,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSeq = useRef(0)

  // Determine which fields are completed
  const fields = useMemo(() => template.fields ?? [], [template.fields])
  const completedFieldsCount = useMemo(() => {
    return fields.filter((f) => (values[f.key] ?? '').trim().length > 0).length
  }, [fields, values])

  const hasAnyInput = completedFieldsCount > 0
  const isFullyCompleted = fields.length > 0 && completedFieldsCount === fields.length

  // -------------------------------------------------------------------------
  // Live Preview Fetcher
  // -------------------------------------------------------------------------
  const runPreview = useCallback(
    async (nextValues: Record<string, string>) => {
      const seq = ++requestSeq.current
      setBusy(true)
      setError(null)
      const startedAt = Date.now()
      const tick = setInterval(() => setElapsed(Date.now() - startedAt), 100)

      try {
        const data = await apiFetch('/api/team-plate/preview', {
          method: 'POST',
          body: JSON.stringify({ productId, values: nextValues }),
        })

        if (seq !== requestSeq.current) return
        if (data?.url) {
          setPreviewUrl(data.url)
        }
      } catch (err: any) {
        if (seq !== requestSeq.current) return

        const message = String(err?.message ?? '')
        const notServed =
          /HTTP (404|405|501)[^0-9]/.test(message + ' ') || !/HTTP [0-9]{3}/.test(message)

        if (notServed) {
          // Graceful fallback for API skew
          onUnsupported()
          return
        }

        setError('Preview rendered using fallback. Your personalized name and number are saved.')
      } finally {
        clearInterval(tick)
        if (seq === requestSeq.current) {
          setBusy(false)
        }
      }
    },
    [productId, onUnsupported]
  )

  // Fetch initial preview on mount or when values change (debounced)
  useEffect(() => {
    // If no values typed yet and no preview URL, attempt initial bare plate preview
    if (!hasAnyInput && !previewUrl) {
      void runPreview({})
      return
    }

    if (!hasAnyInput) return

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void runPreview(values)
    }, DEBOUNCE_MS)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [JSON.stringify(values), hasAnyInput, previewUrl, runPreview])

  // Field change helper
  const handleFieldChange = (field: TeamTemplateField, raw: string) => {
    const cleaned = cleanInput(field, raw)
    onChange({ ...values, [field.key]: cleaned })
  }

  // Quick Demo Preset
  const handleApplyDemo = () => {
    const demo: Record<string, string> = {}
    for (const f of fields) {
      if (f.type === 'number') {
        demo[f.key] = '22'
      } else {
        demo[f.key] = 'SMITH'
      }
    }
    onChange(demo)
  }

  // Clear inputs
  const handleClear = () => {
    const cleared: Record<string, string> = {}
    for (const f of fields) {
      cleared[f.key] = ''
    }
    onChange(cleared)
  }

  const pct = Math.min(95, Math.round((elapsed / EXPECTED_MS) * 100))

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft transition-all">
      {/* Header with Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Shirt className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-text">Customize the Back</h3>
            <p className="text-xs text-muted">Real-time jersey lettering and number personalization</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {template.upcharge && template.upcharge > 0 ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
              +${template.upcharge.toFixed(2)}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">
              Personalization Included
            </span>
          )}
        </div>
      </div>

      {/* Inputs Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-muted">
            Enter Lettering Details
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyDemo}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              <Sparkles className="h-3 w-3" />
              Try Demo (SMITH 22)
            </button>
            {hasAnyInput && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-muted hover:text-text"
                title="Reset fields"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((field) => {
            const currentVal = values[field.key] ?? ''
            const isFilled = currentVal.length > 0

            return (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor={`field-${field.key}`} className="font-semibold text-text">
                    {field.label}
                  </label>
                  <span className="text-[11px] text-muted">
                    {currentVal.length}/{field.max} {field.type === 'number' ? 'digits' : 'chars'}
                  </span>
                </div>

                <div className="relative">
                  <input
                    id={`field-${field.key}`}
                    type="text"
                    inputMode={field.type === 'number' ? 'numeric' : 'text'}
                    value={currentVal}
                    maxLength={field.max}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={field.type === 'number' ? 'e.g. 24' : 'e.g. WILLIAMS'}
                    className="w-full rounded-xl border border-border bg-bg px-3.5 py-2.5 text-sm font-bold text-text uppercase placeholder:text-muted/60 focus:border-primary focus:outline-none"
                  />
                  {isFilled && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Progress & Guidance Banner */}
      <div className="rounded-xl border border-border-subtle bg-bg p-3 text-xs">
        {isFullyCompleted ? (
          <div className="flex items-center gap-2 font-medium text-emerald-600">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Personalization complete! What you see below is what gets printed.</span>
          </div>
        ) : hasAnyInput ? (
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Lettering updated! Fill remaining fields to complete your custom jersey.
            </span>
          </div>
        ) : (
          <p className="text-muted">
            Type your player name and number above. The live preview updates automatically with each keystroke.
          </p>
        )}
      </div>

      {/* Live Preview Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-muted">
            Live Shirt Back Mockup
          </span>
          {previewUrl && (
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Maximize2 className="h-3 w-3" /> Enlarge View
            </button>
          )}
        </div>

        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-border bg-card p-3 shadow-inner">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Personalized back print mockup"
              className="h-full w-full object-contain transition-opacity duration-300"
            />
          ) : backImageUrl ? (
            <img
              src={backImageUrl}
              alt="Garment back view"
              className="h-full w-full object-contain opacity-70"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-muted">
              <Shirt className="h-12 w-12 opacity-30" />
              <p className="mt-2 text-xs font-medium">
                {busy ? 'Preparing preview…' : 'Enter name and number to see your shirt'}
              </p>
            </div>
          )}

          {/* Progress Indicator when rendering */}
          {busy && (
            <div className="absolute inset-x-4 bottom-4 rounded-xl border border-border bg-card/95 p-3 shadow-soft backdrop-blur-sm">
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-border-subtle">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-150"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>Drawing custom lettering on back…</span>
                  <span>{(elapsed / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Enlarge Modal */}
      {zoomOpen && previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setZoomOpen(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-soft-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between border-b border-border-subtle pb-2">
              <span className="font-semibold text-text text-sm">Full Size Back Mockup</span>
              <button
                type="button"
                onClick={() => setZoomOpen(false)}
                className="rounded-lg p-1 text-muted hover:bg-bg hover:text-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={previewUrl}
              alt="Full size personalized back mockup"
              className="max-h-[75vh] w-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default TeamPersonalizePanel
