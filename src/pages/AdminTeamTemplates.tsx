// Team template authoring — /admin/team-templates/:productId
//
// Turns a back design that already has a sample name and number on it into a
// personalizable template. The machine guesses; the operator corrects; the
// side-by-side at the bottom is the only thing that has to be RIGHT, because
// it is a human comparing two pictures.
//
// The flow:
//   1. Derive — erases the sample lettering (or takes a clean plate you
//      upload), then diffs original against plate. The changed pixels ARE the
//      lettering, so that one diff seeds the zones, the distress mask and the
//      colours in a single pass.
//   2. Nudge — drag the boxes, pick fonts, adjust colours.
//   3. Proof — type a test name and watch it render beside the original.
//   4. Save.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Wand2, Save, Eye, AlertTriangle, ArrowLeft } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast'

interface Zone { x: number; y: number; w: number; h: number }
interface Stroke { color: string; w: number }
interface Field {
  key: string
  label: string
  type: 'text' | 'number'
  max: number
  uppercase: boolean
  zone: Zone
  arch: number
  font: { family: string; src: string }
  fill: string
  strokes: Stroke[]
  offset: { dx: number; dy: number; color: string } | null
}
interface Template {
  version: number
  side: 'back_image' | 'front_image'
  plateAssetId: string
  /** The original art the per-order flare edit works from (null on pre-09-23 templates). */
  sourceAssetId: string | null
  distressAssetId: string | null
  canvas: { w: number; h: number; dpi: number }
  halftone: boolean
  upcharge: number
  fields: Field[]
}

const AdminTeamTemplates: React.FC = () => {
  const { productId = '' } = useParams()
  const toast = useToast()

  const [productName, setProductName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [fonts, setFonts] = useState<Array<{ id: string; label: string; note: string }>>([])
  const [template, setTemplate] = useState<Template | null>(null)
  const [deriving, setDeriving] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [proofValues, setProofValues] = useState<Record<string, string>>({})
  const [proofUrl, setProofUrl] = useState<string | null>(null)
  const [proofing, setProofing] = useState(false)

  const canvasRef = useRef<HTMLDivElement | null>(null)

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, images, metadata')
        .eq('id', productId)
        .maybeSingle()
      if (cancelled || !data) return
      setProductName(data.name ?? '')
      // Prefer the image the operator TAGGED as the back print in the
      // product modal (products.metadata.print_artwork.back_image). Falling
      // back to 'the last gallery image' is a guess, and on a product whose
      // gallery ends with a size chart or a lifestyle shot it is a wrong one.
      const images: string[] = Array.isArray(data.images) ? data.images : []
      const tagged = (data as any)?.metadata?.print_artwork?.back_image
      setSourceUrl(tagged || images[images.length - 1] || '')

      const existing = await apiFetch(`/api/team-plate/${productId}/template`).catch(() => null)
      if (!cancelled && existing?.template) setTemplate(existing.template)

      const list = await apiFetch('/api/team-plate/fonts').catch(() => ({ fonts: [] }))
      if (!cancelled) setFonts(list.fonts ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [productId])

  // ---- derive -------------------------------------------------------------
  const derive = async () => {
    if (!sourceUrl) {
      toast.warning('Artwork needed', 'Paste the URL of the back design first')
      return
    }
    setDeriving(true)
    const startedAt = Date.now()
    const tick = setInterval(() => setElapsed(Date.now() - startedAt), 200)
    try {
      const data = await apiFetch(`/api/team-plate/${productId}/derive`, {
        method: 'POST',
        body: JSON.stringify({ sourceUrl }),
      })
      const fields: Field[] = (data.suggestions ?? []).map((s: any, i: number) => ({
        key: s.guessedType === 'number' ? 'number' : i === 0 ? 'name' : `field_${i}`,
        label: s.guessedType === 'number' ? 'Number' : 'Last name',
        type: s.guessedType,
        max: s.guessedType === 'number' ? 2 : 12,
        uppercase: s.guessedType !== 'number',
        zone: s.zone,
        arch: s.guessedType === 'number' ? 0 : 16,
        font: { family: s.guessedType === 'number' ? 'varsity-block' : 'collegiate-slab', src: 'house' },
        fill: s.fill,
        strokes: s.strokes ?? [],
        offset: null,
      }))
      setTemplate({
        version: 1,
        side: 'back_image',
        plateAssetId: data.plateAssetId,
        sourceAssetId: data.sourceAssetId ?? null,
        distressAssetId: data.distressAssetId,
        canvas: data.canvas,
        halftone: false,
        upcharge: 0,
        fields,
      })
      setProofValues(
        Object.fromEntries(fields.map((f) => [f.key, f.type === 'number' ? '22' : 'SMITH']))
      )
      toast.success('Template derived', `${fields.length} zone${fields.length === 1 ? '' : 's'} found`)
    } catch (err: any) {
      toast.error('Could not derive', err?.message ?? 'Unknown error')
    } finally {
      clearInterval(tick)
      setDeriving(false)
    }
  }

  // ---- edit helpers -------------------------------------------------------
  const patchField = useCallback((index: number, patch: Partial<Field>) => {
    setTemplate((t) =>
      t ? { ...t, fields: t.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : t
    )
  }, [])

  // Drag to move a zone, or drag its corner handle to resize. Numeric inputs
  // below stay authoritative for anyone who wants exact pixels.
  const startDrag = (index: number, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (!template) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...template.fields[index].zone }
    const k = canvasRef.current ? template.canvas.w / canvasRef.current.clientWidth : 1

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * k
      const dy = (ev.clientY - startY) * k
      if (mode === 'move') {
        patchField(index, {
          zone: {
            ...start,
            x: Math.max(0, Math.round(start.x + dx)),
            y: Math.max(0, Math.round(start.y + dy)),
          },
        })
      } else {
        patchField(index, {
          zone: {
            ...start,
            w: Math.max(20, Math.round(start.w + dx)),
            h: Math.max(20, Math.round(start.h + dy)),
          },
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- proof --------------------------------------------------------------
  const runProof = async () => {
    if (!template) return
    setProofing(true)
    try {
      const data = await apiFetch(`/api/team-plate/${productId}/proof`, {
        method: 'POST',
        body: JSON.stringify({ template, values: proofValues }),
      })
      setProofUrl(data.url)
    } catch (err: any) {
      toast.error('Could not render proof', err?.message ?? 'Unknown error')
    } finally {
      setProofing(false)
    }
  }

  const save = async () => {
    if (!template) return
    setSaving(true)
    try {
      const data = await apiFetch(`/api/team-plate/${productId}/template`, {
        method: 'PUT',
        body: JSON.stringify({ template }),
      })
      setWarnings(data.warnings ?? [])
      toast.success('Template saved', 'This product is now personalizable')
    } catch (err: any) {
      toast.error('Could not save', err?.message ?? 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const pct = Math.min(95, Math.round((elapsed / 45000) * 100))

  return (
    <div className="min-h-screen bg-bg text-text p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="text-muted hover:text-text">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-bold">Team template</h1>
            <p className="text-sm text-muted">{productName || productId}</p>
          </div>
        </div>

        {/* Step 1 — source + derive */}
        <section className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
          <h2 className="font-semibold">1. The back design</h2>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="URL of the back artwork (with its sample name and number)"
            className="w-full rounded-lg border border-primary/30 bg-bg px-3 py-2 text-sm"
          />
          <button
            onClick={derive}
            disabled={deriving}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            {deriving ? 'Erasing the sample lettering…' : 'Erase sample lettering & find zones'}
          </button>
          {deriving && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-muted">
                Erasing, then diffing original against plate to find the zones… {(elapsed / 1000).toFixed(0)}s
              </p>
            </div>
          )}
          <p className="text-xs text-muted">
            If you have the layered source file, export it with the name and number layers hidden and
            paste that as a clean plate instead — it beats any erase.
          </p>
        </section>

        {template && (
          <>
            {/* Step 2 — zones */}
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-primary/30 bg-card p-4">
                <h2 className="mb-3 font-semibold">2. Zones</h2>
                <div ref={canvasRef} className="relative w-full select-none">
                  {sourceUrl && (
                    <img src={sourceUrl} alt="Back design" className="w-full rounded-lg bg-white" />
                  )}
                  {template.fields.map((field, i) => (
                    <div
                      key={field.key}
                      onPointerDown={startDrag(i, 'move')}
                      className="absolute cursor-move border-2 border-primary/80 bg-primary/10"
                      style={{
                        left: `${(field.zone.x / template.canvas.w) * 100}%`,
                        top: `${(field.zone.y / template.canvas.h) * 100}%`,
                        width: `${(field.zone.w / template.canvas.w) * 100}%`,
                        height: `${(field.zone.h / template.canvas.h) * 100}%`,
                      }}
                    >
                      <span className="absolute -top-5 left-0 text-xs text-primary">{field.label}</span>
                      <span
                        onPointerDown={startDrag(i, 'resize')}
                        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm bg-primary"
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Drag to move, corner to resize. Canvas {template.canvas.w}×{template.canvas.h} @{' '}
                  {template.canvas.dpi} DPI.
                </p>
              </div>

              {/* Step 3 — fields */}
              <div className="space-y-3">
                {template.fields.map((field, i) => (
                  <div key={field.key} className="rounded-xl border border-primary/30 bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={field.label}
                        onChange={(e) => patchField(i, { label: e.target.value })}
                        className="flex-1 rounded border border-primary/30 bg-bg px-2 py-1 text-sm font-semibold"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => patchField(i, { type: e.target.value as 'text' | 'number' })}
                        className="rounded border border-primary/30 bg-bg px-2 py-1 text-sm"
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <label>
                        Max chars
                        <input
                          type="number"
                          value={field.max}
                          onChange={(e) => patchField(i, { max: Number(e.target.value) })}
                          className="w-full rounded border border-primary/30 bg-bg px-2 py-1"
                        />
                      </label>
                      <label>
                        Arch°
                        <input
                          type="number"
                          value={field.arch}
                          onChange={(e) => patchField(i, { arch: Number(e.target.value) })}
                          className="w-full rounded border border-primary/30 bg-bg px-2 py-1"
                        />
                      </label>
                      <label>
                        Fill
                        <input
                          type="color"
                          value={field.fill}
                          onChange={(e) => patchField(i, { fill: e.target.value.toUpperCase() })}
                          className="h-8 w-full rounded border border-primary/30 bg-bg"
                        />
                      </label>
                    </div>

                    <label className="block text-xs">
                      Font
                      <select
                        value={field.font.family}
                        onChange={(e) => patchField(i, { font: { family: e.target.value, src: 'house' } })}
                        className="w-full rounded border border-primary/30 bg-bg px-2 py-1 text-sm"
                      >
                        {fonts.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="space-y-1">
                      <span className="text-xs text-muted">Outlines (widest first)</span>
                      {field.strokes.map((stroke, si) => (
                        <div key={si} className="flex items-center gap-2">
                          <input
                            type="color"
                            value={stroke.color}
                            onChange={(e) =>
                              patchField(i, {
                                strokes: field.strokes.map((s, j) =>
                                  j === si ? { ...s, color: e.target.value.toUpperCase() } : s
                                ),
                              })
                            }
                            className="h-7 w-10 rounded border border-primary/30 bg-bg"
                          />
                          <input
                            type="number"
                            value={stroke.w}
                            onChange={(e) =>
                              patchField(i, {
                                strokes: field.strokes.map((s, j) =>
                                  j === si ? { ...s, w: Number(e.target.value) } : s
                                ),
                              })
                            }
                            className="w-20 rounded border border-primary/30 bg-bg px-2 py-1 text-sm"
                          />
                          <button
                            onClick={() =>
                              patchField(i, { strokes: field.strokes.filter((_, j) => j !== si) })
                            }
                            className="text-xs text-muted hover:text-text"
                          >
                            remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          patchField(i, { strokes: [...field.strokes, { color: '#FFFFFF', w: 12 }] })
                        }
                        className="text-xs text-primary hover:underline"
                      >
                        + add outline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Step 4 — proof */}
            <section className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
              <h2 className="font-semibold">4. Proof it against the original</h2>
              <div className="flex flex-wrap items-end gap-3">
                {template.fields.map((field) => (
                  <label key={field.key} className="text-xs">
                    {field.label}
                    <input
                      value={proofValues[field.key] ?? ''}
                      onChange={(e) =>
                        setProofValues((v) => ({ ...v, [field.key]: e.target.value.toUpperCase() }))
                      }
                      className="block rounded border border-primary/30 bg-bg px-2 py-1 text-sm"
                    />
                  </label>
                ))}
                <button
                  onClick={runProof}
                  disabled={proofing}
                  className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Eye className="h-4 w-4" />
                  {proofing ? 'Rendering…' : 'Render proof'}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {sourceUrl && (
                  <figure>
                    <img src={sourceUrl} alt="Original" className="w-full rounded-lg bg-white" />
                    <figcaption className="text-xs text-muted">Original</figcaption>
                  </figure>
                )}
                {proofUrl && (
                  <figure>
                    <img src={proofUrl} alt="Proof" className="w-full rounded-lg bg-white" />
                    <figcaption className="text-xs text-muted">Rendered — save when these match</figcaption>
                  </figure>
                )}
              </div>
            </section>

            {warnings.length > 0 && (
              <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4">
                <div className="mb-1 flex items-center gap-2 text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-semibold">Font coverage</span>
                </div>
                <ul className="list-disc pl-5 text-sm text-muted">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save template'}
              </button>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={template.halftone}
                  onChange={(e) => setTemplate({ ...template, halftone: e.target.checked })}
                />
                Halftone the press file
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                Upcharge $
                <input
                  type="number"
                  value={template.upcharge}
                  onChange={(e) => setTemplate({ ...template, upcharge: Number(e.target.value) })}
                  className="w-20 rounded border border-primary/30 bg-bg px-2 py-1"
                />
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AdminTeamTemplates
