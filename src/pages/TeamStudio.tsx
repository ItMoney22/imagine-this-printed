// Team Studio — personalizable team shirts, built in Imagination Station.
//
// David 2026-09-24: "the team name step flow is horrible the look the way it
// works ... i dont want this style anymore ... when we do the step flow and we
// pick the team thing i want imagination station to open up".
//
// The old screen erased the sample lettering and re-set it in vector fonts,
// which is where the flat, wrong-looking "SMITH" came from. This one never
// erases anything: GPT Image 2.5 Flare edits the ORIGINAL back art and redoes
// only the name and number in the art's own lettering
// (backend/services/team-plate/generate.ts), then a crisp upscale makes the
// 300 DPI press file. The operator's job shrinks to five guided steps:
//
//   1. Artwork   — pick the back design (optionally prep it in Flare Lab)
//   2. Mark      — box where the name and number sit, say what they read now
//   3. Direction — plain-words notes for the lettering model + the upcharge
//   4. Proof     — real flare renders of test names, side by side with the art
//   5. Publish   — press-file check at 300 DPI, then save to the product
//
// Route: /imagination-station/team/:productId (admin). The Step Flow's Mockup
// step links here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  Hash,
  ImagePlus,
  Plus,
  Printer,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Wand2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { apiErrorMessage, imaginationApi, teamStudioApi, type LetteringVerdict } from '../lib/api'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../context/SupabaseAuthContext'
import ProgressBar from '../components/studio/ProgressBar'
import FlareLab from '../components/imagination/flare/FlareLab'
import { SpellingBadge } from '../components/imagination/flare/SpellingBadge'
import type { TeamField, TeamTemplate } from '../../backend/shared/team-template'

type Box = { x: number; y: number; w: number; h: number } // fractions of the artwork, 0..1

interface FieldDraft {
  key: string
  label: string
  type: 'text' | 'number'
  max: number
  sample: string
  box: Box | null
  arched: boolean
  fill: string
  strokes: Array<{ color: string; w: number }>
}

interface SourceState {
  assetId: string
  url: string
  canvas: { w: number; h: number; dpi: number }
}

interface ProofRow {
  id: string
  values: Record<string, string>
  status: 'idle' | 'running' | 'done' | 'failed'
  startedAt?: number
  url?: string
  error?: string
  modelId?: string | null
  cached?: boolean
  lettering?: LetteringVerdict | null
  attempts?: number
}

interface PressState {
  url: string
  width: number
  height: number
  inches: { w: number; h: number }
  values: Record<string, string>
}

const STEPS = [
  { n: 1, title: 'Artwork', blurb: 'The back design, sample lettering and all' },
  { n: 2, title: 'Mark the lettering', blurb: 'Where the name and number sit' },
  { n: 3, title: 'Direction', blurb: 'Notes for the lettering model' },
  { n: 4, title: 'Proof', blurb: 'Real renders of test names' },
  { n: 5, title: 'Press & publish', blurb: '300 DPI check, then go live' },
] as const

const STEP_GUIDE: Record<number, { title: string; points: string[] }> = {
  1: {
    title: 'Start from the finished design',
    points: [
      'Use the back art WITH its sample name and number — Flare copies that lettering style, so nothing gets erased.',
      'Transparent PNG is best. If the art has a painted checkerboard or soft edges, open Flare Lab → True Transparent or Print Cleanup first.',
      'The press file is built at 3600px wide (12" at 300 DPI) at the art\'s own shape.',
    ],
  },
  2: {
    title: 'Tell Flare which text is which',
    points: [
      'Pick a field, then drag a box over that lettering on the art.',
      'Type what it reads NOW ("BEAR", "9") — this is how the model knows which words to replace.',
      'Colours are sampled from the box automatically; fix them if the swatch looks off.',
      'Boxes are placement hints, not cut lines — a bit loose is fine.',
    ],
  },
  3: {
    title: 'Say it like an art director',
    points: [
      'One line per instruction: "the name arches over the number like the sample".',
      'Mention what must survive: "keep the gold drop shadow", "keep the distressing on the letters".',
      'Skip it if the proofs already look right — the model reads the sample lettering first.',
    ],
  },
  4: {
    title: 'Proof the hard cases',
    points: [
      'Try a short name, a long name and a name with an apostrophe — they stress spacing differently.',
      'Every proof is a real GPT Image 2.5 Flare render, exactly what a customer will see.',
      'Every proof is read back letter by letter; a misspelled render is redrawn once automatically. Still glance at it.',
      'Not right? Adjust the boxes or the notes and proof again — changed templates render fresh.',
    ],
  },
  5: {
    title: 'Check the print file, then publish',
    points: [
      'The press check runs the order pipeline: the approved proof, crisp-upscaled to the full canvas.',
      'Open it full size and zoom in on the letter edges.',
      'Publishing saves the template; the product page shows the name & number boxes right away.',
    ],
  },
}

const TEST_NAMES: Array<Record<string, string>> = [
  { name: 'LI', number: '5' },
  { name: 'RODRIGUEZ', number: '27' },
  { name: "O'BRIEN", number: '88' },
]

const STYLE_SUGGESTIONS = [
  'The name arches over the number exactly like the sample.',
  'Keep the distressed texture inside the letters.',
  'Keep the outline layers and the drop shadow.',
  'The number is the biggest element; the name sits above it.',
]

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const uid = () => Math.random().toString(36).slice(2, 10)

function defaultFields(): FieldDraft[] {
  return [
    { key: 'name', label: 'Last name', type: 'text', max: 12, sample: '', box: null, arched: true, fill: '#FFFFFF', strokes: [] },
    { key: 'number', label: 'Number', type: 'number', max: 2, sample: '', box: null, arched: false, fill: '#FFFFFF', strokes: [] },
  ]
}

function fieldFromTemplate(f: TeamField, canvas: { w: number; h: number }): FieldDraft {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    max: f.max,
    sample: f.sample ?? '',
    box: { x: f.zone.x / canvas.w, y: f.zone.y / canvas.h, w: f.zone.w / canvas.w, h: f.zone.h / canvas.h },
    arched: f.arch > 0,
    fill: f.fill,
    strokes: f.strokes,
  }
}

function boxToZone(box: Box, canvas: { w: number; h: number }) {
  const x = Math.round(clamp01(box.x) * canvas.w)
  const y = Math.round(clamp01(box.y) * canvas.h)
  return {
    x,
    y,
    w: Math.max(1, Math.min(canvas.w - x, Math.round(box.w * canvas.w))),
    h: Math.max(1, Math.min(canvas.h - y, Math.round(box.h * canvas.h))),
  }
}

const TeamStudio: React.FC = () => {
  const { productId = '' } = useParams<{ productId: string }>()
  const toast = useToast()
  const { user } = useAuth()

  const [step, setStep] = useState(1)
  const [productName, setProductName] = useState('')
  const [candidates, setCandidates] = useState<string[]>([])
  const [chosenUrl, setChosenUrl] = useState('')
  const [source, setSource] = useState<SourceState | null>(null)
  const [settingSource, setSettingSource] = useState<number | null>(null)
  const [fields, setFields] = useState<FieldDraft[]>(defaultFields)
  const [activeField, setActiveField] = useState(0)
  const [styleNotes, setStyleNotes] = useState('')
  const [upcharge, setUpcharge] = useState(0)
  const [proofs, setProofs] = useState<ProofRow[]>(() => TEST_NAMES.map((values) => ({ id: uid(), values, status: 'idle' })))
  const [press, setPress] = useState<PressState | null>(null)
  const [pressRun, setPressRun] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [published, setPublished] = useState(false)
  const [flareOpen, setFlareOpen] = useState(false)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  // ---- load the product and any saved template ---------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('products').select('id, name, images, metadata').eq('id', productId).maybeSingle()
      if (cancelled || !data) return
      setProductName(data.name ?? '')
      const images: string[] = Array.isArray(data.images) ? data.images : []
      const tagged: string | undefined = (data as any)?.metadata?.print_artwork?.back_image
      const list = [...new Set([tagged, ...images].filter(Boolean) as string[])]
      setCandidates(list)
      setChosenUrl(tagged || images[images.length - 1] || '')

      const saved = await teamStudioApi.getTemplate(productId).catch(() => null)
      const t: TeamTemplate | null = saved?.template ?? null
      if (cancelled || !t) return
      setFields(t.fields.map((f) => fieldFromTemplate(f, t.canvas)))
      setStyleNotes(t.styleNotes ?? '')
      setUpcharge(t.upcharge ?? 0)
      setPublished(true)
      const assetId = t.sourceAssetId ?? t.plateAssetId
      const { data: asset } = await supabase.from('product_assets').select('url').eq('id', assetId).maybeSingle()
      if (!cancelled && asset?.url) {
        setSource({ assetId, url: asset.url, canvas: t.canvas })
        setChosenUrl(asset.url)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productId])

  // ---- template assembly ---------------------------------------------------
  const template = useMemo(() => {
    if (!source) return null
    if (fields.length === 0 || fields.some((f) => !f.box)) return null
    return {
      version: 1,
      side: 'back_image' as const,
      plateAssetId: source.assetId,
      sourceAssetId: source.assetId,
      distressAssetId: null,
      canvas: source.canvas,
      halftone: false,
      upcharge: Number.isFinite(upcharge) && upcharge > 0 ? upcharge : 0,
      styleNotes: styleNotes.trim(),
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        max: f.max,
        uppercase: f.type === 'text',
        zone: boxToZone(f.box!, source.canvas),
        arch: f.arched ? 16 : 0,
        // The flare engine draws in the art's own lettering; the font slot is
        // kept for the schema (and the quarantined vector engine) only.
        font: { family: 'flare-matched', src: 'house' },
        fill: f.fill,
        strokes: f.strokes,
        offset: null,
        sample: f.sample.trim(),
      })),
    }
  }, [source, fields, styleNotes, upcharge])

  const markedCount = fields.filter((f) => f.box).length
  const doneProofs = proofs.filter((p) => p.status === 'done')
  const stepDone: Record<number, boolean> = {
    1: !!source,
    2: !!template,
    3: !!template,
    4: doneProofs.length > 0,
    5: published && !!press,
  }

  // ---- step 1: artwork ---------------------------------------------------------
  const lockArtwork = async (url: string) => {
    if (!url) return
    setSettingSource(Date.now())
    try {
      const out = await teamStudioApi.setSource(productId, url)
      setSource({ assetId: out.sourceAssetId, url: out.sourceUrl, canvas: out.canvas })
      setChosenUrl(out.sourceUrl)
      setProofs((ps) => ps.map((p) => ({ ...p, status: 'idle', url: undefined })))
      setPress(null)
      toast.success('Artwork locked in', `Press canvas ${out.canvas.w}×${out.canvas.h} px at 300 DPI`)
      setStep(2)
    } catch (err) {
      toast.error('Could not use that artwork', apiErrorMessage(err))
    } finally {
      setSettingSource(null)
    }
  }

  const uploadArtwork = async (file: File | undefined) => {
    if (!file) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })
    setCandidates((c) => [dataUrl, ...c])
    setChosenUrl(dataUrl)
  }

  const flareUpscale = async (url: string): Promise<string | null> => {
    try {
      const { data } = await imaginationApi.upscaleImage({ imageUrl: url, factor: 2 })
      return data.processedUrl || data.imageUrl || data.url || data.output || null
    } catch (err: any) {
      toast.error('Upscale failed', err?.response?.data?.error || 'Please try again.')
      return null
    }
  }

  // ---- step 2: marking ---------------------------------------------------------
  const updateField = (i: number, patch: Partial<FieldDraft>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  const eyedrop = useCallback(
    async (i: number, box: Box) => {
      if (!source) return
      try {
        const out = await teamStudioApi.eyedrop(productId, {
          sourceAssetId: source.assetId,
          canvas: source.canvas,
          zone: boxToZone(box, source.canvas),
        })
        setFields((fs) => fs.map((f, j) => (j === i ? { ...f, fill: out.fill, strokes: out.strokes ?? [] } : f)))
      } catch {
        /* colours stay editable by hand */
      }
    },
    [productId, source]
  )

  const addField = () => {
    const n = fields.length + 1
    setFields((fs) => [...fs, { key: `line${n}`, label: `Line ${n}`, type: 'text', max: 16, sample: '', box: null, arched: false, fill: '#FFFFFF', strokes: [] }])
    setActiveField(fields.length)
  }

  // ---- step 4: proofs ------------------------------------------------------------
  const runProof = async (row: ProofRow) => {
    if (!template) return
    setProofs((ps) => ps.map((p) => (p.id === row.id ? { ...p, status: 'running', startedAt: Date.now(), error: undefined } : p)))
    try {
      const out = await teamStudioApi.proof(productId, template, row.values)
      setProofs((ps) => ps.map((p) => (p.id === row.id ? { ...p, status: 'done', url: out.url, modelId: out.modelId, cached: out.cached, values: out.values ?? p.values, lettering: out.lettering, attempts: out.attempts } : p)))
    } catch (err) {
      setProofs((ps) => ps.map((p) => (p.id === row.id ? { ...p, status: 'failed', error: apiErrorMessage(err, 'Proof failed') } : p)))
    }
  }

  const runAllProofs = () => proofs.filter((p) => p.status !== 'running').forEach((p) => void runProof(p))

  // ---- step 5: press + publish ---------------------------------------------------
  const runPress = async (values: Record<string, string>) => {
    if (!template) return
    setPressRun(Date.now())
    setPress(null)
    try {
      const out = await teamStudioApi.pressProof(productId, template, values)
      setPress({ url: out.url, width: out.width, height: out.height, inches: out.inches, values: out.values })
    } catch (err) {
      toast.error('Press check failed', apiErrorMessage(err))
    } finally {
      setPressRun(null)
    }
  }

  const publish = async () => {
    if (!template) return
    setSaving(true)
    try {
      await teamStudioApi.save(productId, template)
      setPublished(true)
      toast.success('Team template is live', 'Customers can now add their name and number on the product page.')
    } catch (err) {
      toast.error('Could not publish', apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const guide = STEP_GUIDE[step]

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* header */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur border-b border-text/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/imagination-station" className="p-2 rounded-lg hover:bg-text/5" aria-label="Back to Imagination Station">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 via-fuchsia-500 to-violet-600 flex items-center justify-center shrink-0">
            <Hash className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg leading-tight">Team Studio</h1>
            <p className="text-xs text-muted truncate">{productName || 'Loading…'} · Imagination Station · GPT Image 2.5 Flare</p>
          </div>
          {published && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Check className="w-3.5 h-3.5" /> Template live
            </span>
          )}
          <Link to={`/product/${productId}`} target="_blank" className="hidden sm:inline-flex text-xs px-3 py-1.5 rounded-lg border border-text/15 hover:border-primary/40">
            View product
          </Link>
        </div>
        {/* stepper */}
        <div className="max-w-7xl mx-auto px-4 pb-3 flex gap-1.5 overflow-x-auto">
          {STEPS.map((s) => {
            const active = s.n === step
            const done = stepDone[s.n]
            const reachable = s.n === 1 || stepDone[s.n - 1] || done
            return (
              <button
                key={s.n}
                type="button"
                disabled={!reachable}
                onClick={() => setStep(s.n)}
                className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition disabled:opacity-40 ${
                  active ? 'border-primary bg-primary/10' : 'border-text/10 hover:border-primary/30'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-white' : 'bg-text/10 text-muted'
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : s.n}
                </span>
                <span>
                  <span className="block text-sm font-medium leading-tight">{s.title}</span>
                  <span className="hidden md:block text-[11px] text-muted">{s.blurb}</span>
                </span>
              </button>
            )
          })}
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <section className="min-w-0 space-y-5">
          {/* ---------------- STEP 1 ---------------- */}
          {step === 1 && (
            <div className="space-y-4">
              <div
                className="rounded-2xl border border-text/10 overflow-hidden flex items-center justify-center min-h-[320px]"
                style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '22px 22px' }}
              >
                {chosenUrl ? (
                  <img src={chosenUrl} alt="Back design" className="max-h-[60vh] w-auto object-contain" />
                ) : (
                  <p className="text-sm text-muted p-8">No back design tagged on this product — upload one below.</p>
                )}
              </div>

              {candidates.length > 0 && (
                <div>
                  <p className="text-xs text-muted mb-2">Product images — pick the back design</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {candidates.map((c) => (
                      <button
                        key={c.slice(0, 120)}
                        type="button"
                        onClick={() => setChosenUrl(c)}
                        className={`shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 ${c === chosenUrl ? 'border-primary' : 'border-transparent'}`}
                        style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '10px 10px' }}
                      >
                        <img src={c} alt="" className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => lockArtwork(chosenUrl)}
                  disabled={!chosenUrl || settingSource != null}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary to-secondary disabled:opacity-40 shadow-glow-sm"
                >
                  <Check className="w-4 h-4" /> Use this artwork
                </button>
                <button
                  type="button"
                  onClick={() => setFlareOpen(true)}
                  disabled={!chosenUrl}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 text-sm font-medium disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4" /> Prep in Flare Lab
                </button>
                <button type="button" onClick={() => uploadRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-text/15 text-sm">
                  <Upload className="w-4 h-4" /> Upload art
                </button>
                <input ref={uploadRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={(e) => uploadArtwork(e.target.files?.[0])} />
              </div>
              {settingSource != null && <ProgressBar label="Saving the artwork as the template source" startedAt={settingSource} expectedMs={6000} />}
            </div>
          )}

          {/* ---------------- STEP 2 ---------------- */}
          {step === 2 && source && (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
              <ZoneCanvas
                imageUrl={source.url}
                fields={fields}
                activeField={activeField}
                onSelect={setActiveField}
                onBox={(i, box) => {
                  updateField(i, { box })
                  void eyedrop(i, box)
                }}
              />
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div
                    key={f.key}
                    onClick={() => setActiveField(i)}
                    className={`rounded-xl border p-3 space-y-2 cursor-pointer ${i === activeField ? 'border-primary bg-primary/5' : 'border-text/10'}`}
                  >
                    <div className="flex items-center gap-2">
                      {f.type === 'number' ? <Hash className="w-4 h-4 text-primary" /> : <Type className="w-4 h-4 text-primary" />}
                      <input
                        value={f.label}
                        onChange={(e) => updateField(i, { label: e.target.value })}
                        className="flex-1 bg-transparent font-medium text-sm outline-none"
                        aria-label="Field label customers see"
                      />
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${f.box ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                        {f.box ? 'marked' : 'drag a box'}
                      </span>
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setFields((fs) => fs.filter((_, j) => j !== i))
                            setActiveField(0)
                          }}
                          className="text-muted hover:text-red-400"
                          aria-label="Remove field"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-[1fr_70px] gap-2">
                      <label className="text-[11px] text-muted">
                        Reads now
                        <input
                          value={f.sample}
                          onChange={(e) => updateField(i, { sample: e.target.value })}
                          placeholder={f.type === 'number' ? '9' : 'BEAR'}
                          className="mt-0.5 w-full px-2 py-1.5 rounded-lg bg-bg border border-text/15 text-text text-sm"
                        />
                      </label>
                      <label className="text-[11px] text-muted">
                        Max
                        <input
                          type="number"
                          min={1}
                          max={24}
                          value={f.max}
                          onChange={(e) => updateField(i, { max: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })}
                          className="mt-0.5 w-full px-2 py-1.5 rounded-lg bg-bg border border-text/15 text-text text-sm"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                      <label className="flex items-center gap-1">
                        Fill
                        <input type="color" value={f.fill} onChange={(e) => updateField(i, { fill: e.target.value.toUpperCase() })} className="w-7 h-7 rounded border border-text/15 bg-transparent" />
                      </label>
                      {f.strokes.map((s, k) => (
                        <label key={k} className="flex items-center gap-1">
                          Outline
                          <input
                            type="color"
                            value={s.color}
                            onChange={(e) => updateField(i, { strokes: f.strokes.map((x, m) => (m === k ? { ...x, color: e.target.value.toUpperCase() } : x)) })}
                            className="w-7 h-7 rounded border border-text/15 bg-transparent"
                          />
                        </label>
                      ))}
                      <select
                        value={f.type}
                        onChange={(e) => updateField(i, { type: e.target.value as 'text' | 'number' })}
                        className="px-1.5 py-1 rounded bg-bg border border-text/15 text-text"
                        aria-label="Field type"
                      >
                        <option value="text">Letters</option>
                        <option value="number">Digits</option>
                      </select>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={f.arched} onChange={(e) => updateField(i, { arched: e.target.checked })} /> Arched
                      </label>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addField} className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-text/20 text-sm text-muted hover:text-text">
                  <Plus className="w-4 h-4" /> Add another line (year, city…)
                </button>
                <button
                  type="button"
                  disabled={!template}
                  onClick={() => setStep(3)}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary to-secondary disabled:opacity-40"
                >
                  {template ? 'Next: direction' : `Mark ${fields.length - markedCount} more`} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ---------------- STEP 3 ---------------- */}
          {step === 3 && (
            <div className="space-y-4 max-w-2xl">
              <label className="block">
                <span className="text-sm font-medium">Art director's notes for the lettering</span>
                <textarea
                  value={styleNotes}
                  onChange={(e) => setStyleNotes(e.target.value.slice(0, 500))}
                  rows={5}
                  placeholder="The name arches over the number exactly like the sample."
                  className="mt-1.5 w-full px-3 py-2 rounded-xl bg-card border border-text/15 text-sm"
                />
                <span className="text-[11px] text-muted">{styleNotes.length}/500</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {STYLE_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyleNotes((n) => (n.includes(s) ? n : `${n ? `${n}\n` : ''}${s}`).slice(0, 500))}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-text/10 text-muted hover:text-text hover:border-primary/40"
                  >
                    + {s}
                  </button>
                ))}
              </div>
              <label className="block max-w-xs">
                <span className="text-sm font-medium">Personalization upcharge</span>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-muted">$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={upcharge}
                    onChange={(e) => setUpcharge(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28 px-3 py-2 rounded-xl bg-card border border-text/15 text-sm"
                  />
                  <span className="text-xs text-muted">per shirt</span>
                </div>
              </label>
              <button
                type="button"
                onClick={() => setStep(4)}
                disabled={!template}
                className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-primary to-secondary disabled:opacity-40"
              >
                Next: proof it <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ---------------- STEP 4 ---------------- */}
          {step === 4 && source && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={runAllProofs}
                  disabled={!template}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-orange-500 via-fuchsia-500 to-violet-600 disabled:opacity-40"
                >
                  <Wand2 className="w-4 h-4" /> Render all proofs
                </button>
                <button
                  type="button"
                  onClick={() => setProofs((ps) => [...ps, { id: uid(), values: Object.fromEntries(fields.map((f) => [f.key, ''])), status: 'idle' }])}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-text/15 text-sm"
                >
                  <Plus className="w-4 h-4" /> Add a test name
                </button>
                <span className="text-xs text-muted">Each proof is one Flare render (~40s). Unchanged names come back from cache.</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <figure className="rounded-2xl border border-text/10 overflow-hidden bg-card">
                  <div className="aspect-[3/4] flex items-center justify-center" style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}>
                    <img src={source.url} alt="Original" className="max-h-full max-w-full object-contain" />
                  </div>
                  <figcaption className="px-3 py-2 text-xs text-muted">Original (sample lettering)</figcaption>
                </figure>
                {proofs.map((p) => (
                  <figure key={p.id} className="rounded-2xl border border-text/10 overflow-hidden bg-card">
                    <div className="aspect-[3/4] flex items-center justify-center relative" style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}>
                      {p.url && p.status === 'done' ? (
                        <img src={p.url} alt={`Proof ${Object.values(p.values).join(' ')}`} className="max-h-full max-w-full object-contain" />
                      ) : p.status === 'running' ? (
                        <div className="w-full px-6">
                          <ProgressBar label="Flare is lettering it in the art's own style" startedAt={p.startedAt} expectedMs={45000} />
                        </div>
                      ) : (
                        <p className="text-xs text-muted px-6 text-center">{p.error ?? 'Not rendered yet'}</p>
                      )}
                    </div>
                    <figcaption className="p-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {fields.map((f) => (
                          <input
                            key={f.key}
                            value={p.values[f.key] ?? ''}
                            onChange={(e) => setProofs((ps) => ps.map((x) => (x.id === p.id ? { ...x, values: { ...x.values, [f.key]: e.target.value }, status: x.status === 'running' ? x.status : 'idle' } : x)))}
                            placeholder={f.label}
                            maxLength={f.max}
                            className={`px-2 py-1.5 rounded-lg bg-bg border border-text/15 text-sm ${f.type === 'number' ? 'w-16' : 'flex-1 min-w-0'}`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => runProof(p)}
                          disabled={!template || p.status === 'running'}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-semibold disabled:opacity-40"
                        >
                          <Eye className="w-3.5 h-3.5" /> {p.status === 'done' ? 'Re-proof' : 'Render proof'}
                        </button>
                        {p.status === 'done' && (
                          <button
                            type="button"
                            onClick={() => {
                              setStep(5)
                              void runPress(p.values)
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                          >
                            <Printer className="w-3.5 h-3.5" /> Press check
                          </button>
                        )}
                        {p.status === 'done' && (
                          <span className="text-[10px] text-muted ml-auto truncate">{p.cached ? 'cached' : p.modelId?.replace('openai/', '') ?? ''}</span>
                        )}
                      </div>
                      {p.status === 'done' && (
                        <SpellingBadge
                          verdict={p.lettering}
                          expected={fields.map((f) => p.values[f.key] ?? '').filter(Boolean)}
                          attempts={p.attempts}
                        />
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {/* ---------------- STEP 5 ---------------- */}
          {step === 5 && (
            <div className="space-y-4">
              {!press && pressRun == null && (
                <div className="rounded-2xl border border-text/10 p-5 bg-card space-y-3">
                  <p className="text-sm">Pick a rendered proof to check at full print size.</p>
                  <div className="flex flex-wrap gap-2">
                    {doneProofs.map((p) => (
                      <button key={p.id} type="button" onClick={() => runPress(p.values)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-text/15 text-sm hover:border-primary/40">
                        <Printer className="w-4 h-4" /> {Object.values(p.values).filter(Boolean).join(' · ')}
                      </button>
                    ))}
                    {doneProofs.length === 0 && (
                      <button type="button" onClick={() => setStep(4)} className="text-sm underline">
                        Render a proof first
                      </button>
                    )}
                  </div>
                </div>
              )}
              {pressRun != null && <ProgressBar size="lg" label="Building the 300 DPI press file (approved proof → crisp upscale → full canvas)" startedAt={pressRun} expectedMs={50000} />}
              {press && (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
                  <div className="rounded-2xl border border-text/10 overflow-hidden flex items-center justify-center" style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '18px 18px' }}>
                    <img src={press.url} alt="Press file" className="max-h-[65vh] w-auto object-contain" />
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-xl border border-text/10 p-3 bg-card text-sm space-y-1">
                      <p className="font-semibold">Press file</p>
                      <p className="text-muted text-xs">
                        {press.width} × {press.height} px · 300 DPI
                      </p>
                      <p className="text-muted text-xs">
                        {press.inches.w}" × {press.inches.h}" print
                      </p>
                      <p className="text-muted text-xs">{Object.values(press.values).join(' · ')}</p>
                      <a href={press.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline mt-1">
                        <ImagePlus className="w-3.5 h-3.5" /> Open full size to zoom the edges
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={publish}
                      disabled={!template || saving}
                      className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 disabled:opacity-40"
                    >
                      <Check className="w-4 h-4" /> {published ? 'Update the live template' : 'Publish to the product'}
                    </button>
                    {published && (
                      <Link to={`/product/${productId}`} target="_blank" className="block text-center text-xs underline text-muted">
                        See it on the product page
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* guide rail */}
        <aside className="space-y-3 lg:sticky lg:top-40 self-start">
          <div className="rounded-2xl border border-text/10 bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted">Step {step} guide</p>
            <h2 className="font-semibold mt-1">{guide.title}</h2>
            <ul className="mt-2 space-y-2">
              {guide.points.map((pt) => (
                <li key={pt} className="text-xs text-muted flex gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  {pt}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-fuchsia-500/20 bg-gradient-to-br from-orange-500/5 via-fuchsia-500/5 to-violet-600/5 p-4">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-fuchsia-400" /> How it works
            </p>
            <p className="text-xs text-muted mt-1.5">
              Each customer's shirt is a GPT Image 2.5 Flare edit of this exact artwork: the sample name and number are redrawn
              as theirs, in the same lettering, with everything else held. The approved preview is then crisp-upscaled into the
              print file, so what they approve is what prints.
            </p>
          </div>
        </aside>
      </main>

      {flareOpen && chosenUrl && (
        <FlareLab
          isOpen={flareOpen}
          onClose={() => setFlareOpen(false)}
          imageUrl={chosenUrl}
          isAdmin={user?.role === 'admin'}
          title="Flare Lab · prep the back art"
          initialOp="cleanup"
          tools={['cleanup', 'transparent', 'inpaint', 'edit', 'text', 'recolor']}
          onUse={(url) => {
            setCandidates((c) => [url, ...c])
            setChosenUrl(url)
            setFlareOpen(false)
          }}
          onUpscaleForPrint={flareUpscale}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The marking canvas: drag a box for the active field; boxes are fractions of
// the displayed artwork so they survive any on-screen size.
// ---------------------------------------------------------------------------

const FIELD_COLOURS = ['#EC4899', '#22D3EE', '#F59E0B', '#34D399', '#A78BFA']

interface ZoneCanvasProps {
  imageUrl: string
  fields: FieldDraft[]
  activeField: number
  onSelect: (i: number) => void
  onBox: (i: number, box: Box) => void
}

const ZoneCanvas: React.FC<ZoneCanvasProps> = ({ imageUrl, fields, activeField, onSelect, onBox }) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }
  const live = drag
    ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    : null

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Drawing: <span className="font-semibold text-text">{fields[activeField]?.label}</span> — drag over that lettering on the art.
      </p>
      <div
        ref={ref}
        className="relative rounded-2xl overflow-hidden border border-text/10 select-none touch-none cursor-crosshair mx-auto w-fit"
        style={{ backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '20px 20px' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const p = pos(e)
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
        }}
        onPointerMove={(e) => {
          if (!drag) return
          const p = pos(e)
          setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d))
        }}
        onPointerUp={() => {
          if (live && live.w > 0.02 && live.h > 0.02) onBox(activeField, live)
          setDrag(null)
        }}
      >
        <img src={imageUrl} alt="Back design" className="block max-h-[70vh] w-auto pointer-events-none" draggable={false} />
        {fields.map((f, i) =>
          f.box ? (
            <button
              key={f.key}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(i)}
              className="absolute border-2 rounded-md"
              style={{
                left: `${f.box.x * 100}%`,
                top: `${f.box.y * 100}%`,
                width: `${f.box.w * 100}%`,
                height: `${f.box.h * 100}%`,
                borderColor: FIELD_COLOURS[i % FIELD_COLOURS.length],
                background: i === activeField ? `${FIELD_COLOURS[i % FIELD_COLOURS.length]}22` : 'transparent',
              }}
              aria-label={`Select ${f.label}`}
            >
              <span className="absolute -top-5 left-0 text-[10px] font-bold px-1 rounded text-white" style={{ background: FIELD_COLOURS[i % FIELD_COLOURS.length] }}>
                {f.label}
              </span>
            </button>
          ) : null
        )}
        {live && (
          <div
            className="absolute border-2 border-dashed rounded-md pointer-events-none"
            style={{
              left: `${live.x * 100}%`,
              top: `${live.y * 100}%`,
              width: `${live.w * 100}%`,
              height: `${live.h * 100}%`,
              borderColor: FIELD_COLOURS[activeField % FIELD_COLOURS.length],
            }}
          />
        )}
      </div>
    </div>
  )
}

export default TeamStudio
