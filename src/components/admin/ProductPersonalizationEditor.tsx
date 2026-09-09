// Admin: turn a product into a personalized listing and place the print zones.
//
// David 2026-09-09, after the first build shipped: turning a product
// personalizable was a raw database write and the print zones had no authoring
// surface at all, so the renderer could never actually fire on anything.
//
// Two halves:
//  - FIELDS: which of Team / Name / Number the buyer is asked for, what they
//    are called, whether they are required, and how long they may be.
//  - ZONES: where each field prints on the artwork, in print-file pixels.
//
// Zones are the part that needs seeing rather than typing. Four numbers with no
// feedback is how you end up selling a shirt with the player's name across his
// face, so this draws the boxes over the real print file AND renders a true
// preview through the same server code path a paid order uses.
import React, { useState } from 'react'
import { Type, Eye, Loader2, Plus, Trash2 } from 'lucide-react'
import { adminApi } from '../../lib/api'
import {
  DEFAULT_PERSONALIZATION_FIELDS,
  PERSONALIZATION_FIELD_ORDER,
  type PersonalizationFieldId
} from '../../../backend/shared/personalization'

/** The shape stored at products.metadata.personalization. */
export interface PersonalizationMetadata {
  enabled?: boolean
  fields?: Partial<Record<PersonalizationFieldId, {
    enabled?: boolean
    label?: string
    required?: boolean
    maxLength?: number
  }>>
  zones?: Array<{
    field: PersonalizationFieldId
    x: number
    y: number
    width: number
    height: number
    color?: string
    align?: 'left' | 'center' | 'right'
    uppercase?: boolean
    maxFontSize?: number
  }>
}

interface Props {
  productId: string
  /** The print file the zones are measured against — the same artwork the server renders onto. */
  printFileUrl?: string | null
  value: PersonalizationMetadata | undefined
  onChange: (next: PersonalizationMetadata) => void
}

const SAMPLE = { team: 'Wildcats', name: 'Smith', number: '12' }

/** Zone geometry is in print-file pixels; the overlay scales to whatever width the preview renders at. */
const PREVIEW_WIDTH = 420

const ProductPersonalizationEditor: React.FC<Props> = ({ productId, printFileUrl, value, onChange }) => {
  const meta: PersonalizationMetadata = value ?? {}
  const enabled = meta.enabled === true

  const [preview, setPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // Natural size of the print file, needed to scale the overlay boxes.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const patch = (next: Partial<PersonalizationMetadata>) => onChange({ ...meta, ...next })

  const fieldConfig = (id: PersonalizationFieldId) => {
    const base = DEFAULT_PERSONALIZATION_FIELDS[id]
    const over = meta.fields?.[id] ?? {}
    return {
      enabled: over.enabled !== false,
      label: over.label ?? base.label,
      required: over.required ?? base.required,
      maxLength: over.maxLength ?? base.maxLength
    }
  }

  const patchField = (id: PersonalizationFieldId, next: Record<string, unknown>) =>
    patch({ fields: { ...(meta.fields ?? {}), [id]: { ...(meta.fields?.[id] ?? {}), ...next } } })

  const zones = meta.zones ?? []
  const zoneFor = (id: PersonalizationFieldId) => zones.find(z => z.field === id)

  const addZone = (id: PersonalizationFieldId) => {
    // A sane starting box in the middle of the artwork — moved by typing, seen
    // immediately in the overlay. Better than making the admin invent numbers.
    const w = natural?.w ?? 1000
    const h = natural?.h ?? 1000
    const index = zones.length
    patch({
      zones: [...zones, {
        field: id,
        x: Math.round(w * 0.15),
        y: Math.round(h * (0.2 + index * 0.2)),
        width: Math.round(w * 0.7),
        height: Math.round(h * 0.12),
        align: 'center',
        uppercase: id !== 'number'
      }]
    })
  }

  const patchZone = (id: PersonalizationFieldId, next: Record<string, unknown>) =>
    patch({ zones: zones.map(z => (z.field === id ? { ...z, ...next } : z)) })

  const removeZone = (id: PersonalizationFieldId) =>
    patch({ zones: zones.filter(z => z.field !== id) })

  const runPreview = async () => {
    setPreviewing(true)
    setPreviewError(null)
    try {
      const { data } = await adminApi.previewPersonalization(productId, SAMPLE)
      setPreview(data.url)
    } catch (e: any) {
      // The server sends a plain sentence ("No print zones yet...") in `error`.
      setPreviewError(e?.message || 'Could not render the preview')
      setPreview(null)
    } finally {
      setPreviewing(false)
    }
  }

  const scale = natural ? PREVIEW_WIDTH / natural.w : 0

  return (
    <div className="border border-slate-300 rounded-lg p-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => patch({ enabled: e.target.checked })}
          className="w-4 h-4"
        />
        <Type className="w-4 h-4 text-primary" />
        <span className="font-medium text-text">Let buyers personalize this</span>
      </label>
      <p className="text-xs text-muted mt-1 ml-6">
        Adds Team / Name / Number boxes on the product page, and a personalization
        box on the Etsy listing the next time it is published or updated.
      </p>

      {enabled && (
        <div className="mt-4 space-y-4">
          {/* ---- fields ---- */}
          <div>
            <h4 className="text-sm font-medium text-text mb-2">Fields the buyer fills in</h4>
            <div className="space-y-2">
              {PERSONALIZATION_FIELD_ORDER.map(id => {
                const cfg = fieldConfig(id)
                return (
                  <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex items-center gap-1.5 w-28">
                      <input
                        type="checkbox"
                        checked={cfg.enabled}
                        onChange={e => patchField(id, { enabled: e.target.checked })}
                      />
                      <span className="capitalize text-text">{id}</span>
                    </label>
                    {cfg.enabled && (
                      <>
                        <input
                          type="text"
                          value={cfg.label}
                          onChange={e => patchField(id, { label: e.target.value })}
                          className="px-2 py-1 rounded border border-slate-300 bg-card text-text w-32"
                          aria-label={`${id} label`}
                        />
                        <label className="flex items-center gap-1 text-muted">
                          <input
                            type="checkbox"
                            checked={cfg.required}
                            onChange={e => patchField(id, { required: e.target.checked })}
                          />
                          required
                        </label>
                        <label className="flex items-center gap-1 text-muted">
                          max
                          <input
                            type="number"
                            min={1}
                            value={cfg.maxLength}
                            onChange={e => patchField(id, { maxLength: Number(e.target.value) || 1 })}
                            className="px-2 py-1 rounded border border-slate-300 bg-card text-text w-16"
                            aria-label={`${id} max length`}
                          />
                        </label>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ---- zones ---- */}
          <div>
            <h4 className="text-sm font-medium text-text mb-1">Where it prints</h4>
            <p className="text-xs text-muted mb-2">
              Measured in print-file pixels{natural ? ` (this file is ${natural.w} x ${natural.h})` : ''}.
              Without a zone, a field is collected from the buyer but never printed.
            </p>
            <div className="space-y-2">
              {PERSONALIZATION_FIELD_ORDER.filter(id => fieldConfig(id).enabled).map(id => {
                const zone = zoneFor(id)
                if (!zone) {
                  return (
                    <div key={id} className="flex items-center gap-2 text-sm">
                      <span className="w-20 capitalize text-muted">{id}</span>
                      <button
                        type="button"
                        onClick={() => addZone(id)}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-primary text-text"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add zone
                      </button>
                    </div>
                  )
                }
                return (
                  <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-20 capitalize text-text">{id}</span>
                    {(['x', 'y', 'width', 'height'] as const).map(k => (
                      <label key={k} className="flex items-center gap-1 text-muted">
                        {k[0].toUpperCase()}
                        <input
                          type="number"
                          value={zone[k]}
                          onChange={e => patchZone(id, { [k]: Number(e.target.value) || 0 })}
                          className="px-2 py-1 rounded border border-slate-300 bg-card text-text w-20"
                          aria-label={`${id} ${k}`}
                        />
                      </label>
                    ))}
                    <select
                      value={zone.align ?? 'center'}
                      onChange={e => patchZone(id, { align: e.target.value })}
                      className="px-2 py-1 rounded border border-slate-300 bg-card text-text"
                      aria-label={`${id} alignment`}
                    >
                      <option value="left">left</option>
                      <option value="center">center</option>
                      <option value="right">right</option>
                    </select>
                    <label className="flex items-center gap-1 text-muted">
                      <input
                        type="checkbox"
                        checked={zone.uppercase === true}
                        onChange={e => patchZone(id, { uppercase: e.target.checked })}
                      />
                      CAPS
                    </label>
                    <button
                      type="button"
                      onClick={() => removeZone(id)}
                      className="p-1 text-red-500 hover:text-red-600"
                      aria-label={`Remove ${id} zone`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ---- overlay + rendered preview ---- */}
          {printFileUrl ? (
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-muted mb-1">Zones on the print file</p>
                <div className="relative inline-block border border-slate-300 rounded overflow-hidden">
                  <img
                    src={printFileUrl}
                    alt="Print file"
                    width={PREVIEW_WIDTH}
                    onLoad={e => {
                      const img = e.currentTarget
                      setNatural({ w: img.naturalWidth, h: img.naturalHeight })
                    }}
                    className="block bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
                  />
                  {scale > 0 && zones.map(zone => (
                    <div
                      key={zone.field}
                      className="absolute border-2 border-primary/80 bg-primary/10 flex items-center justify-center"
                      style={{
                        left: zone.x * scale,
                        top: zone.y * scale,
                        width: zone.width * scale,
                        height: zone.height * scale
                      }}
                    >
                      <span className="text-[10px] uppercase tracking-wide text-primary font-bold">
                        {zone.field}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-muted">Rendered preview</p>
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={previewing}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-primary text-text text-xs disabled:opacity-60"
                  >
                    {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    {previewing ? 'Rendering…' : 'Preview with sample text'}
                  </button>
                </div>
                {previewError && <p className="text-xs text-red-500 max-w-xs">{previewError}</p>}
                {preview
                  ? (
                    <img
                      src={preview}
                      alt="Personalized print preview"
                      width={PREVIEW_WIDTH}
                      className="block border border-slate-300 rounded bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
                    />
                  )
                  : (
                    <p className="text-xs text-muted max-w-xs">
                      Renders this product&apos;s real print file with {SAMPLE.team} / {SAMPLE.name} / {SAMPLE.number}
                      {' '}through the same code a paid order uses. Save your zone changes first.
                    </p>
                  )}
              </div>
            </div>
          )
            : (
              <p className="text-xs text-amber-500">
                This product has no print file yet, so zones cannot be placed against it.
              </p>
            )}
        </div>
      )}
    </div>
  )
}

export default ProductPersonalizationEditor
