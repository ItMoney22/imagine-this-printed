// Team template authoring — /admin/team-templates/:productId
//
// 4-Step Simplified Flow for Team Lettering & Personalization:
//   Step 1: Select Back Artwork (from tagged back print, product gallery, or custom URL)
//   Step 2: Designate Name and Number field targets on the garment back
//   Step 3: Set allowable field content and print constraints (character limits, uppercase, ink style)
//   Step 4: Render live preview example and save the template
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Save,
  Shirt,
  Sparkles,
  Type,
  ExternalLink,
} from 'lucide-react'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast'

export interface TargetZone {
  x: number
  y: number
  w: number
  h: number
}

export interface StrokeDef {
  color: string
  w: number
}

export interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'number'
  max: number
  uppercase: boolean
  arch: number
  fontFamily: string
  fillColor: string
  outlineColor: string
  outlineWidth: number
  // Target anchor coordinates in canvas units (3600 x 4800)
  zone: TargetZone
  // Target placement preset label
  targetPlacement: 'upper_back' | 'center_back' | 'lower_back' | 'custom'
}

interface SavedTemplate {
  version: number
  side: 'back_image' | 'front_image'
  plateAssetId: string
  distressAssetId: string | null
  canvas: { w: number; h: number; dpi: number }
  halftone: boolean
  upcharge: number
  fields: any[]
}

const CANVAS_DEFAULT = { w: 3600, h: 4800, dpi: 300 }

// Standard jersey coordinate presets calibrated for 3600 x 4800 print canvas
const PRESET_ZONES = {
  name_upper: { x: 450, y: 750, w: 2700, h: 650 },
  name_center: { x: 600, y: 1400, w: 2400, h: 650 },
  number_center: { x: 800, y: 1550, w: 2000, h: 1800 },
  number_lower: { x: 900, y: 2200, w: 1800, h: 1600 },
}

const FONT_OPTIONS = [
  { id: 'collegiate-slab', label: 'Collegiate Slab', note: 'Heavy athletic slab serif for player names' },
  { id: 'varsity-block', label: 'Varsity Block', note: 'Classic jersey block digits' },
  { id: 'heavy-sans', label: 'Heavy Sans', note: 'Tall, condensed modern font' },
  { id: 'brush-script', label: 'Brush Script', note: 'Script style lettering' },
  { id: 'western', label: 'Western', note: 'Bold vintage slab' },
  { id: 'stencil', label: 'Stencil', note: 'Military / sport stencil' },
]

const COLOR_PRESETS = [
  { label: 'Crisp White', fill: '#FFFFFF', outline: '#000000', outlineW: 14 },
  { label: 'Athletic Gold', fill: '#F59E0B', outline: '#000000', outlineW: 14 },
  { label: 'Pitch Black', fill: '#18181B', outline: '#FFFFFF', outlineW: 14 },
  { label: 'Varsity Navy', fill: '#1E3A8A', outline: '#FFFFFF', outlineW: 14 },
  { label: 'Crimson Red', fill: '#DC2626', outline: '#FFFFFF', outlineW: 14 },
  { label: 'Silver Gray', fill: '#E5E7EB', outline: '#1F2937', outlineW: 12 },
]

const AdminTeamTemplates: React.FC = () => {
  const { productId = '' } = useParams()
  const toast = useToast()

  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1)
  const [productName, setProductName] = useState('')
  const [availableImages, setAvailableImages] = useState<string[]>([])
  const [taggedBackImage, setTaggedBackImage] = useState<string | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [upcharge, setUpcharge] = useState(0)
  const [existingPlateAssetId, setExistingPlateAssetId] = useState<string | null>(null)

  // Step 2 & 3: Field configuration
  const [hasNameField, setHasNameField] = useState(true)
  const [hasNumberField, setHasNumberField] = useState(true)
  const [activeFieldKey, setActiveFieldKey] = useState<'name' | 'number'>('name')

  const [nameField, setNameField] = useState<FieldConfig>({
    key: 'name',
    label: 'Last Name',
    type: 'text',
    max: 12,
    uppercase: true,
    arch: 14,
    fontFamily: 'collegiate-slab',
    fillColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 14,
    zone: PRESET_ZONES.name_upper,
    targetPlacement: 'upper_back',
  })

  const [numberField, setNumberField] = useState<FieldConfig>({
    key: 'number',
    label: 'Number',
    type: 'number',
    max: 2,
    uppercase: true,
    arch: 0,
    fontFamily: 'varsity-block',
    fillColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 14,
    zone: PRESET_ZONES.number_center,
    targetPlacement: 'center_back',
  })

  // Step 4: Proof / preview state
  const [testValues, setTestValues] = useState<Record<string, string>>({
    name: 'WILLIAMS',
    number: '24',
  })
  const [proofing, setProofing] = useState(false)
  const [proofUrl, setProofUrl] = useState<string | null>(null)

  const previewCanvasRef = useRef<HTMLDivElement | null>(null)

  // -------------------------------------------------------------------------
  // Load Product & Existing Template
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    ;(async () => {
      try {
        const { data: product, error } = await supabase
          .from('products')
          .select('id, name, images, metadata')
          .eq('id', productId)
          .maybeSingle()

        if (cancelled || !product) {
          if (error) toast.error('Failed to load product', error.message)
          setLoading(false)
          return
        }

        setProductName(product.name ?? 'Sports Apparel')

        const imgs: string[] = Array.isArray(product.images) ? product.images : []
        setAvailableImages(imgs)

        const taggedBack = product.metadata?.print_artwork?.back_image || null
        setTaggedBackImage(taggedBack)

        // Select initial back artwork: tagged back > last gallery image > first image
        const initialArt = taggedBack || imgs[imgs.length - 1] || imgs[0] || ''
        setSourceUrl(initialArt)

        // Check for existing saved template
        const saved: SavedTemplate | null =
          product.metadata?.team_template ??
          (await apiFetch(`/api/team-plate/${productId}/template`).then((r) => r.template).catch(() => null))

        if (saved && Array.isArray(saved.fields)) {
          if (saved.plateAssetId) setExistingPlateAssetId(saved.plateAssetId)
          if (saved.upcharge) setUpcharge(saved.upcharge)

          const loadedName = saved.fields.find((f: any) => f.key === 'name' || f.type === 'text')
          const loadedNum = saved.fields.find((f: any) => f.key === 'number' || f.type === 'number')

          if (loadedName) {
            setHasNameField(true)
            setNameField((prev) => ({
              ...prev,
              label: loadedName.label || 'Last Name',
              max: loadedName.max || 12,
              uppercase: loadedName.uppercase !== false,
              arch: loadedName.arch ?? 14,
              fontFamily: loadedName.font?.family || 'collegiate-slab',
              fillColor: loadedName.fill || '#FFFFFF',
              outlineColor: loadedName.strokes?.[0]?.color || '#000000',
              outlineWidth: loadedName.strokes?.[0]?.w || 14,
              zone: loadedName.zone || PRESET_ZONES.name_upper,
            }))
          } else {
            setHasNameField(false)
          }

          if (loadedNum) {
            setHasNumberField(true)
            setNumberField((prev) => ({
              ...prev,
              label: loadedNum.label || 'Number',
              max: loadedNum.max || 2,
              fontFamily: loadedNum.font?.family || 'varsity-block',
              fillColor: loadedNum.fill || '#FFFFFF',
              outlineColor: loadedNum.strokes?.[0]?.color || '#000000',
              outlineWidth: loadedNum.strokes?.[0]?.w || 14,
              zone: loadedNum.zone || PRESET_ZONES.number_center,
            }))
          } else {
            setHasNumberField(false)
          }
        }
      } catch (err: any) {
        console.error('Error loading product for template:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [productId])

  // -------------------------------------------------------------------------
  // Construct Template Object for Server & DB
  // -------------------------------------------------------------------------
  const compiledFields = useMemo(() => {
    const list: any[] = []

    if (hasNameField) {
      list.push({
        key: 'name',
        label: nameField.label.trim() || 'Last Name',
        type: 'text',
        max: nameField.max,
        uppercase: nameField.uppercase,
        zone: nameField.zone,
        arch: nameField.arch,
        font: { family: nameField.fontFamily, src: 'house' },
        fill: nameField.fillColor,
        strokes: nameField.outlineWidth > 0 ? [{ color: nameField.outlineColor, w: nameField.outlineWidth }] : [],
        offset: null,
      })
    }

    if (hasNumberField) {
      list.push({
        key: 'number',
        label: numberField.label.trim() || 'Number',
        type: 'number',
        max: numberField.max,
        uppercase: true,
        zone: numberField.zone,
        arch: 0,
        font: { family: numberField.fontFamily, src: 'house' },
        fill: numberField.fillColor,
        strokes: numberField.outlineWidth > 0 ? [{ color: numberField.outlineColor, w: numberField.outlineWidth }] : [],
        offset: null,
      })
    }

    return list
  }, [hasNameField, hasNumberField, nameField, numberField])

  const compiledTemplate = useMemo(() => {
    return {
      version: 1,
      side: 'back_image' as const,
      plateAssetId: existingPlateAssetId || 'template-back-art',
      distressAssetId: null, // Clean lettering under modern flare pipeline
      canvas: CANVAS_DEFAULT,
      halftone: false,
      upcharge,
      fields: compiledFields,
    }
  }, [compiledFields, existingPlateAssetId, upcharge])

  // -------------------------------------------------------------------------
  // Step 2 Placement Target Click Handler
  // -------------------------------------------------------------------------
  const handleTargetClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!previewCanvasRef.current) return
    const rect = previewCanvasRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    // Convert click position to percentage
    const pctX = Math.max(0.1, Math.min(0.9, clickX / rect.width))
    const pctY = Math.max(0.1, Math.min(0.9, clickY / rect.top))

    if (activeFieldKey === 'name') {
      const zoneW = 2700
      const zoneH = 650
      const canvasX = Math.round(pctX * CANVAS_DEFAULT.w - zoneW / 2)
      const canvasY = Math.round(pctY * CANVAS_DEFAULT.h - zoneH / 2)

      setNameField((prev) => ({
        ...prev,
        targetPlacement: 'custom',
        zone: {
          x: Math.max(100, Math.min(CANVAS_DEFAULT.w - zoneW - 100, canvasX)),
          y: Math.max(100, Math.min(CANVAS_DEFAULT.h - zoneH - 100, canvasY)),
          w: zoneW,
          h: zoneH,
        },
      }))
      toast.success('Name target positioned', 'Target anchor updated on back preview')
    } else {
      const zoneW = 2000
      const zoneH = 1800
      const canvasX = Math.round(pctX * CANVAS_DEFAULT.w - zoneW / 2)
      const canvasY = Math.round(pctY * CANVAS_DEFAULT.h - zoneH / 2)

      setNumberField((prev) => ({
        ...prev,
        targetPlacement: 'custom',
        zone: {
          x: Math.max(100, Math.min(CANVAS_DEFAULT.w - zoneW - 100, canvasX)),
          y: Math.max(100, Math.min(CANVAS_DEFAULT.h - zoneH - 100, canvasY)),
          w: zoneW,
          h: zoneH,
        },
      }))
      toast.success('Number target positioned', 'Target anchor updated on back preview')
    }
  }

  // -------------------------------------------------------------------------
  // Preset Selection Handlers
  // -------------------------------------------------------------------------
  const applyPresetLayout = (preset: 'standard' | 'name_only' | 'number_only') => {
    if (preset === 'standard') {
      setHasNameField(true)
      setHasNumberField(true)
      setNameField((p) => ({ ...p, targetPlacement: 'upper_back', zone: PRESET_ZONES.name_upper, arch: 14 }))
      setNumberField((p) => ({ ...p, targetPlacement: 'center_back', zone: PRESET_ZONES.number_center }))
      toast.success('Layout preset applied', 'Standard Jersey: Name Upper + Number Center')
    } else if (preset === 'name_only') {
      setHasNameField(true)
      setHasNumberField(false)
      setNameField((p) => ({ ...p, targetPlacement: 'upper_back', zone: PRESET_ZONES.name_upper, arch: 0 }))
      toast.success('Layout preset applied', 'Name Only on Upper Back')
    } else if (preset === 'number_only') {
      setHasNameField(false)
      setHasNumberField(true)
      setNumberField((p) => ({ ...p, targetPlacement: 'center_back', zone: PRESET_ZONES.number_center }))
      toast.success('Layout preset applied', 'Number Only on Center Back')
    }
  }

  // -------------------------------------------------------------------------
  // Step 4 Proof Runner
  // -------------------------------------------------------------------------
  const runProof = useCallback(async () => {
    if (compiledFields.length === 0) {
      toast.warning('No fields designated', 'Please enable at least one field (name or number) to preview')
      return
    }

    setProofing(true)

    try {
      // First try backend proof endpoint
      const res = await apiFetch(`/api/team-plate/${productId}/proof`, {
        method: 'POST',
        body: JSON.stringify({ template: compiledTemplate, values: testValues }),
      })
      if (res?.url) {
        setProofUrl(res.url)
        return
      }
    } catch (err: any) {
      // Backend proof might not have the asset buffer in storage yet; fallback to direct client SVG composite preview
      console.warn('Backend proof call skipped/failed, using client preview:', err?.message)
    } finally {
      setProofing(false)
    }
  }, [compiledFields.length, compiledTemplate, productId, testValues])

  // Run proof when reaching step 4
  useEffect(() => {
    if (activeStep === 4) {
      void runProof()
    }
  }, [activeStep, runProof])

  // -------------------------------------------------------------------------
  // Save Template Handler
  // -------------------------------------------------------------------------
  const handleSave = async () => {
    if (compiledFields.length === 0) {
      toast.error('Cannot save empty template', 'Enable at least a name or number field before saving')
      return
    }

    setSaving(true)
    try {
      // Attempt save via backend API
      let savedSuccessfully = false
      try {
        const res = await apiFetch(`/api/team-plate/${productId}/template`, {
          method: 'PUT',
          body: JSON.stringify({ template: compiledTemplate }),
        })
        if (res?.template) {
          savedSuccessfully = true
        }
      } catch (apiErr: any) {
        console.warn('Backend PUT returned error, updating metadata directly:', apiErr?.message)
      }

      // If backend API isn't deployed or returned error, ensure product metadata is saved directly in Supabase
      if (!savedSuccessfully) {
        const { data: currentProduct, error: fetchErr } = await supabase
          .from('products')
          .select('metadata')
          .eq('id', productId)
          .single()

        if (fetchErr) throw fetchErr

        const updatedMetadata = {
          ...(currentProduct?.metadata ?? {}),
          team_template: compiledTemplate,
        }

        const { error: updateErr } = await supabase
          .from('products')
          .update({ metadata: updatedMetadata })
          .eq('id', productId)

        if (updateErr) throw updateErr
      }

      toast.success('Team template saved!', 'Customers can now personalize this garment on the storefront')
    } catch (err: any) {
      toast.error('Failed to save template', err?.message ?? 'Please check network and try again')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-bg p-6 text-text">
        <div className="mx-auto max-w-4xl space-y-4 text-center">
          <div className="mx-auto h-2 max-w-xs overflow-hidden rounded-full bg-border-subtle">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
          <p className="text-sm text-muted">Loading apparel template configurator…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg p-6 text-text">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header Breadcrumbs */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin/team-templates"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted transition-colors hover:border-primary hover:text-text"
              title="Return to Team Templates Catalogue"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold">Team Template Configurator</h1>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Step {activeStep} of 4
                </span>
              </div>
              <p className="text-sm text-muted">
                {productName} &middot; <code className="text-xs text-muted/80">{productId.slice(0, 8)}</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to={`/product/${productId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-text transition-colors hover:border-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View Storefront Page
            </Link>
          </div>
        </div>

        {/* 4-Step Progress Ribbon */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            onClick={() => setActiveStep(1)}
            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
              activeStep === 1
                ? 'border-primary bg-primary/5 text-primary shadow-sm'
                : 'border-border bg-card text-muted hover:border-primary/50'
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                activeStep === 1 ? 'bg-primary text-white' : 'bg-border text-muted'
              }`}
            >
              1
            </span>
            <div className="truncate">
              <span className="block text-xs font-bold uppercase tracking-wider">Step 1</span>
              <span className="truncate text-xs font-medium">Select Artwork</span>
            </div>
          </button>

          <button
            onClick={() => setActiveStep(2)}
            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
              activeStep === 2
                ? 'border-primary bg-primary/5 text-primary shadow-sm'
                : 'border-border bg-card text-muted hover:border-primary/50'
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                activeStep === 2 ? 'bg-primary text-white' : 'bg-border text-muted'
              }`}
            >
              2
            </span>
            <div className="truncate">
              <span className="block text-xs font-bold uppercase tracking-wider">Step 2</span>
              <span className="truncate text-xs font-medium">Point Targets</span>
            </div>
          </button>

          <button
            onClick={() => setActiveStep(3)}
            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
              activeStep === 3
                ? 'border-primary bg-primary/5 text-primary shadow-sm'
                : 'border-border bg-card text-muted hover:border-primary/50'
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                activeStep === 3 ? 'bg-primary text-white' : 'bg-border text-muted'
              }`}
            >
              3
            </span>
            <div className="truncate">
              <span className="block text-xs font-bold uppercase tracking-wider">Step 3</span>
              <span className="truncate text-xs font-medium">Set Constraints</span>
            </div>
          </button>

          <button
            onClick={() => setActiveStep(4)}
            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
              activeStep === 4
                ? 'border-primary bg-primary/5 text-primary shadow-sm'
                : 'border-border bg-card text-muted hover:border-primary/50'
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                activeStep === 4 ? 'bg-primary text-white' : 'bg-border text-muted'
              }`}
            >
              4
            </span>
            <div className="truncate">
              <span className="block text-xs font-bold uppercase tracking-wider">Step 4</span>
              <span className="truncate text-xs font-medium">Live Preview</span>
            </div>
          </button>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* STEP 1: Select Back Artwork */}
        {/* ----------------------------------------------------------------- */}
        {activeStep === 1 && (
          <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
            <div>
              <h2 className="font-display text-lg font-bold text-text">1. Select Back Artwork</h2>
              <p className="text-sm text-muted">
                Choose the back garment graphic that will feature the customer&apos;s custom lettering.
              </p>
            </div>

            {/* Gallery Options */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
                Select from Product Gallery
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {availableImages.map((imgUrl, idx) => {
                  const isSelected = sourceUrl === imgUrl
                  const isTaggedBack = taggedBackImage === imgUrl

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSourceUrl(imgUrl)}
                      className={`group relative aspect-square overflow-hidden rounded-xl border p-1 text-left transition-all ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary ring-offset-2'
                          : 'border-border hover:border-primary/60'
                      }`}
                    >
                      <img src={imgUrl} alt={`Product ${idx + 1}`} className="h-full w-full rounded-lg object-contain" />
                      {isTaggedBack && (
                        <span className="absolute bottom-1.5 left-1.5 right-1.5 rounded bg-primary/90 px-1 py-0.5 text-center text-[9px] font-bold uppercase text-white">
                          Tagged Back
                        </span>
                      )}
                      {isSelected && (
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Direct URL input fallback */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                Or Artwork URL / Clean Plate
              </label>
              <input
                type="text"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl border border-border bg-bg px-4 py-2.5 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <p className="text-xs text-muted">
                You can paste the URL of the back print artwork, or an exported plate with lettering removed.
              </p>
            </div>

            {/* Selection Confirmation Card */}
            {sourceUrl && (
              <div className="flex items-center gap-4 rounded-xl border border-border-subtle bg-bg p-4">
                <img src={sourceUrl} alt="Selected back print" className="h-16 w-16 rounded-lg border border-border object-contain" />
                <div>
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    <CheckCircle2 className="h-3 w-3" /> Artwork Selected
                  </span>
                  <p className="mt-1 line-clamp-1 text-xs text-muted">{sourceUrl}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveStep(2)}
                disabled={!sourceUrl}
                className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
              >
                Continue to Field Targets <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 2: Designate Name & Number Targets */}
        {/* ----------------------------------------------------------------- */}
        {activeStep === 2 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-6">
            <div>
              <h2 className="font-display text-lg font-bold text-text">2. Designate Name & Number Targets</h2>
              <p className="text-sm text-muted">
                Point to where the player name and number will be printed. No manual plate slicing or pixel coordinates required.
              </p>
            </div>

            {/* Presets Row */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Standard Layout Presets</span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => applyPresetLayout('standard')}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    hasNameField && hasNumberField && nameField.targetPlacement === 'upper_back'
                      ? 'border-primary bg-primary/5 text-primary shadow-sm'
                      : 'border-border bg-bg hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-semibold">Classic Jersey</span>
                  <span className="mt-1 block text-xs text-muted">Name on upper back + Large number center</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyPresetLayout('name_only')}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    hasNameField && !hasNumberField
                      ? 'border-primary bg-primary/5 text-primary shadow-sm'
                      : 'border-border bg-bg hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-semibold">Name Only</span>
                  <span className="mt-1 block text-xs text-muted">Player name across shoulder span</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyPresetLayout('number_only')}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    !hasNameField && hasNumberField
                      ? 'border-primary bg-primary/5 text-primary shadow-sm'
                      : 'border-border bg-bg hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-semibold">Number Only</span>
                  <span className="mt-1 block text-xs text-muted">Large athlete digits in back center</span>
                </button>
              </div>
            </div>

            {/* Interactive Target Canvas & Controls */}
            <div className="grid gap-6 md:grid-cols-12">
              {/* Visual Canvas Target Locator */}
              <div className="md:col-span-7">
                <div className="mb-2 flex items-center justify-between text-xs text-muted">
                  <span className="font-semibold uppercase tracking-wider">Click On Preview To Position Active Target</span>
                  <span className="font-medium text-primary">Active: {activeFieldKey.toUpperCase()}</span>
                </div>

                <div
                  ref={previewCanvasRef}
                  onClick={handleTargetClick}
                  className="relative aspect-[3/4] w-full cursor-crosshair select-none overflow-hidden rounded-2xl border border-border bg-bg shadow-inner"
                  title="Click anywhere to reposition active target"
                >
                  {sourceUrl ? (
                    <img src={sourceUrl} alt="Back design target view" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      <Shirt className="h-16 w-16 opacity-30" />
                    </div>
                  )}

                  {/* Name Target Badge Overlay */}
                  {hasNameField && (
                    <div
                      style={{
                        left: `${(nameField.zone.x / CANVAS_DEFAULT.w) * 100}%`,
                        top: `${(nameField.zone.y / CANVAS_DEFAULT.h) * 100}%`,
                        width: `${(nameField.zone.w / CANVAS_DEFAULT.w) * 100}%`,
                        height: `${(nameField.zone.h / CANVAS_DEFAULT.h) * 100}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveFieldKey('name')
                      }}
                      className={`absolute flex items-center justify-center rounded-lg border-2 transition-all ${
                        activeFieldKey === 'name'
                          ? 'border-primary bg-primary/20 ring-2 ring-primary ring-offset-2'
                          : 'border-primary/60 bg-primary/10'
                      }`}
                    >
                      <span className="rounded bg-primary px-2 py-0.5 text-xs font-bold text-white shadow">
                        [NAME TARGET] {nameField.label}
                      </span>
                    </div>
                  )}

                  {/* Number Target Badge Overlay */}
                  {hasNumberField && (
                    <div
                      style={{
                        left: `${(numberField.zone.x / CANVAS_DEFAULT.w) * 100}%`,
                        top: `${(numberField.zone.y / CANVAS_DEFAULT.h) * 100}%`,
                        width: `${(numberField.zone.w / CANVAS_DEFAULT.w) * 100}%`,
                        height: `${(numberField.zone.h / CANVAS_DEFAULT.h) * 100}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveFieldKey('number')
                      }}
                      className={`absolute flex items-center justify-center rounded-lg border-2 transition-all ${
                        activeFieldKey === 'number'
                          ? 'border-secondary bg-secondary/20 ring-2 ring-secondary ring-offset-2'
                          : 'border-secondary/60 bg-secondary/10'
                      }`}
                    >
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-bold text-white shadow">
                        [NUMBER TARGET] {numberField.label}
                      </span>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-center text-xs text-muted">
                  Tip: Click anywhere on the back print to point where the selected target will land.
                </p>
              </div>

              {/* Target Cards & Placement Controls */}
              <div className="space-y-4 md:col-span-5">
                {/* Name Target Card */}
                <div
                  className={`rounded-2xl border p-4 transition-all ${
                    activeFieldKey === 'name' && hasNameField
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-bg'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="toggle-name"
                        checked={hasNameField}
                        onChange={(e) => setHasNameField(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <label htmlFor="toggle-name" className="text-sm font-bold text-text cursor-pointer">
                        Player / Last Name Field
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveFieldKey('name')}
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        activeFieldKey === 'name' ? 'bg-primary text-white' : 'bg-card text-muted hover:text-text'
                      }`}
                    >
                      Select
                    </button>
                  </div>

                  {hasNameField && (
                    <div className="mt-3 space-y-2 pt-2 border-t border-border-subtle text-xs">
                      <div className="flex items-center justify-between text-muted">
                        <span>Placement:</span>
                        <span className="font-medium text-text capitalize">
                          {nameField.targetPlacement.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setNameField((p) => ({ ...p, targetPlacement: 'upper_back', zone: PRESET_ZONES.name_upper }))
                            setActiveFieldKey('name')
                          }}
                          className="flex-1 rounded-lg border border-border bg-card py-1 text-center font-medium hover:border-primary"
                        >
                          Upper Back
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNameField((p) => ({ ...p, targetPlacement: 'center_back', zone: PRESET_ZONES.name_center }))
                            setActiveFieldKey('name')
                          }}
                          className="flex-1 rounded-lg border border-border bg-card py-1 text-center font-medium hover:border-primary"
                        >
                          Center Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Number Target Card */}
                <div
                  className={`rounded-2xl border p-4 transition-all ${
                    activeFieldKey === 'number' && hasNumberField
                      ? 'border-secondary bg-secondary/5'
                      : 'border-border bg-bg'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="toggle-number"
                        checked={hasNumberField}
                        onChange={(e) => setHasNumberField(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-secondary focus:ring-secondary"
                      />
                      <label htmlFor="toggle-number" className="text-sm font-bold text-text cursor-pointer">
                        Player Number Field
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveFieldKey('number')}
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        activeFieldKey === 'number'
                          ? 'bg-secondary text-white'
                          : 'bg-card text-muted hover:text-text'
                      }`}
                    >
                      Select
                    </button>
                  </div>

                  {hasNumberField && (
                    <div className="mt-3 space-y-2 pt-2 border-t border-border-subtle text-xs">
                      <div className="flex items-center justify-between text-muted">
                        <span>Placement:</span>
                        <span className="font-medium text-text capitalize">
                          {numberField.targetPlacement.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setNumberField((p) => ({ ...p, targetPlacement: 'center_back', zone: PRESET_ZONES.number_center }))
                            setActiveFieldKey('number')
                          }}
                          className="flex-1 rounded-lg border border-border bg-card py-1 text-center font-medium hover:border-secondary"
                        >
                          Center Back
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNumberField((p) => ({ ...p, targetPlacement: 'lower_back', zone: PRESET_ZONES.number_lower }))
                            setActiveFieldKey('number')
                          }}
                          className="flex-1 rounded-lg border border-border bg-card py-1 text-center font-medium hover:border-secondary"
                        >
                          Lower Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border-subtle bg-card p-3.5 text-xs text-muted">
                  <div className="flex items-center gap-1.5 font-semibold text-text">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Flare Lettering Alignment
                  </div>
                  <p className="mt-1">
                    Lettering is dynamically positioned and scaled for each order. Bounding targets guarantee text will not overflow collar seams or lower hem boundaries.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setActiveStep(1)}
                className="btn-secondary text-sm"
              >
                Back: Artwork
              </button>
              <button
                onClick={() => setActiveStep(3)}
                disabled={!hasNameField && !hasNumberField}
                className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
              >
                Continue to Constraints <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 3: Set Field Content & Constraints */}
        {/* ----------------------------------------------------------------- */}
        {activeStep === 3 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-6">
            <div>
              <h2 className="font-display text-lg font-bold text-text">3. Set Allowable Field Content & Constraints</h2>
              <p className="text-sm text-muted">
                Define what the customer can enter and select clean athletic typography and ink colorways.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Name Field Constraints */}
              {hasNameField && (
                <div className="space-y-4 rounded-2xl border border-border bg-bg p-5">
                  <div className="flex items-center gap-2">
                    <Type className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-text">Name Field Settings</h3>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="mb-1 block font-medium text-muted">Customer Input Label</label>
                      <input
                        type="text"
                        value={nameField.label}
                        onChange={(e) => setNameField((p) => ({ ...p, label: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-text focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block font-medium text-muted">Max Characters</label>
                        <input
                          type="number"
                          min={2}
                          max={20}
                          value={nameField.max}
                          onChange={(e) => setNameField((p) => ({ ...p, max: Number(e.target.value) || 12 }))}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                        />
                        <span className="mt-0.5 block text-[11px] text-muted">Recommended: 10-14</span>
                      </div>

                      <div>
                        <label className="mb-1 block font-medium text-muted">Arch Angle</label>
                        <select
                          value={nameField.arch}
                          onChange={(e) => setNameField((p) => ({ ...p, arch: Number(e.target.value) }))}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                        >
                          <option value={0}>Flat (0°)</option>
                          <option value={10}>Subtle Curve (10°)</option>
                          <option value={14}>Classic Arch (14°)</option>
                          <option value={20}>Deep Arch (20°)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block font-medium text-muted">Lettering Typeface</label>
                      <select
                        value={nameField.fontFamily}
                        onChange={(e) => setNameField((p) => ({ ...p, fontFamily: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label} — {f.note}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Color Presets */}
                    <div>
                      <label className="mb-1.5 block font-medium text-muted">Ink & Stroke Colorway</label>
                      <div className="flex flex-wrap gap-2">
                        {COLOR_PRESETS.map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() =>
                              setNameField((p) => ({
                                ...p,
                                fillColor: preset.fill,
                                outlineColor: preset.outline,
                                outlineWidth: preset.outlineW,
                              }))
                            }
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                              nameField.fillColor === preset.fill && nameField.outlineColor === preset.outline
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-card text-muted hover:border-primary/40'
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-full border border-black/20"
                              style={{ backgroundColor: preset.fill }}
                            />
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={nameField.uppercase}
                          onChange={(e) => setNameField((p) => ({ ...p, uppercase: e.target.checked }))}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="font-medium text-text">Force UPPERCASE (Standard for team jerseys)</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Number Field Constraints */}
              {hasNumberField && (
                <div className="space-y-4 rounded-2xl border border-border bg-bg p-5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-secondary">#</span>
                    <h3 className="font-semibold text-text">Number Field Settings</h3>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="mb-1 block font-medium text-muted">Customer Input Label</label>
                      <input
                        type="text"
                        value={numberField.label}
                        onChange={(e) => setNumberField((p) => ({ ...p, label: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-text focus:border-secondary focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block font-medium text-muted">Max Digits</label>
                        <select
                          value={numberField.max}
                          onChange={(e) => setNumberField((p) => ({ ...p, max: Number(e.target.value) || 2 }))}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text focus:border-secondary focus:outline-none"
                        >
                          <option value={1}>1 Digit (0-9)</option>
                          <option value={2}>2 Digits (00-99 standard)</option>
                          <option value={3}>3 Digits (000-999)</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block font-medium text-muted">Digit Font</label>
                        <select
                          value={numberField.fontFamily}
                          onChange={(e) => setNumberField((p) => ({ ...p, fontFamily: e.target.value }))}
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text focus:border-secondary focus:outline-none"
                        >
                          {FONT_OPTIONS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Color Presets */}
                    <div>
                      <label className="mb-1.5 block font-medium text-muted">Ink & Stroke Colorway</label>
                      <div className="flex flex-wrap gap-2">
                        {COLOR_PRESETS.map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() =>
                              setNumberField((p) => ({
                                ...p,
                                fillColor: preset.fill,
                                outlineColor: preset.outline,
                                outlineWidth: preset.outlineW,
                              }))
                            }
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                              numberField.fillColor === preset.fill && numberField.outlineColor === preset.outline
                                ? 'border-secondary bg-secondary/10 text-secondary'
                                : 'border-border bg-card text-muted hover:border-secondary/40'
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-full border border-black/20"
                              style={{ backgroundColor: preset.fill }}
                            />
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border-subtle bg-card p-3 text-muted">
                      Digits are automatically restricted to numbers <code>0-9</code> and centered for maximum readability on the garment.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Pricing / Upcharge Settings */}
            <div className="rounded-2xl border border-border bg-bg p-5">
              <h3 className="text-sm font-semibold text-text">Personalization Upcharge (Optional)</h3>
              <p className="mt-0.5 text-xs text-muted">
                Add an optional fee for custom lettering, or leave at $0 to include personalization in the base shirt price.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-sm font-bold text-muted">$</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={upcharge}
                  onChange={(e) => setUpcharge(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="0.00"
                  className="w-28 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-text focus:border-primary focus:outline-none"
                />
                <span className="text-xs text-muted">USD added to cart per customized shirt</span>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setActiveStep(2)}
                className="btn-secondary text-sm"
              >
                Back: Field Targets
              </button>
              <button
                onClick={() => setActiveStep(4)}
                className="btn-primary inline-flex items-center gap-2 text-sm"
              >
                Continue to Live Preview <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 4: Live Preview & Save */}
        {/* ----------------------------------------------------------------- */}
        {activeStep === 4 && (
          <section className="space-y-6 rounded-2xl border border-border bg-card p-6">
            <div>
              <h2 className="font-display text-lg font-bold text-text">4. Live Preview & Save Template</h2>
              <p className="text-sm text-muted">
                Test how real names and numbers look on the back print before publishing the template.
              </p>
            </div>

            {/* Test Input Bar */}
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-bg p-4">
              {hasNameField && (
                <div className="flex-1 min-w-[160px]">
                  <label className="mb-1 block text-xs font-semibold text-muted">Test Name</label>
                  <input
                    type="text"
                    value={testValues.name ?? ''}
                    onChange={(e) =>
                      setTestValues((v) => ({ ...v, name: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. SMITH"
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-text uppercase focus:border-primary focus:outline-none"
                  />
                </div>
              )}

              {hasNumberField && (
                <div className="w-28">
                  <label className="mb-1 block text-xs font-semibold text-muted">Test Number</label>
                  <input
                    type="text"
                    value={testValues.number ?? ''}
                    onChange={(e) =>
                      setTestValues((v) => ({ ...v, number: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))
                    }
                    placeholder="e.g. 22"
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-text focus:border-secondary focus:outline-none"
                  />
                </div>
              )}

              {/* Quick Sample Presets */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTestValues({ name: 'WILLIAMS', number: '24' })}
                  className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-semibold text-muted hover:text-text hover:border-primary"
                >
                  WILLIAMS 24
                </button>
                <button
                  type="button"
                  onClick={() => setTestValues({ name: 'SMITH', number: '22' })}
                  className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-semibold text-muted hover:text-text hover:border-primary"
                >
                  SMITH 22
                </button>
                <button
                  type="button"
                  onClick={() => setTestValues({ name: 'DAVIS', number: '7' })}
                  className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-semibold text-muted hover:text-text hover:border-primary"
                >
                  DAVIS 7
                </button>
              </div>

              <button
                type="button"
                onClick={runProof}
                disabled={proofing}
                className="btn-secondary inline-flex items-center gap-2 text-xs disabled:opacity-50"
              >
                <Eye className="h-3.5 w-3.5" />
                {proofing ? 'Rendering…' : 'Refresh Proof'}
              </button>
            </div>

            {/* Side-by-side Proof Displays */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Original Artwork */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="font-semibold uppercase tracking-wider">Original Back Artwork</span>
                  <span>Base print</span>
                </div>
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-bg p-2">
                  {sourceUrl ? (
                    <img src={sourceUrl} alt="Original back artwork" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      <ImageIcon className="h-12 w-12 opacity-30" />
                    </div>
                  )}
                </div>
              </div>

              {/* Customized Rendered Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-primary">
                    Personalized Back Preview
                  </span>
                  <span className="rounded bg-primary/10 px-2 py-0.5 font-bold text-primary">Live Mockup</span>
                </div>

                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border-2 border-primary/40 bg-bg p-2 shadow-soft">
                  {proofUrl ? (
                    <img src={proofUrl} alt="Rendered team template proof" className="h-full w-full object-contain" />
                  ) : (
                    <div className="relative h-full w-full">
                      {sourceUrl && (
                        <img src={sourceUrl} alt="Base artwork" className="h-full w-full object-contain opacity-90" />
                      )}

                      {/* Client-side Live Lettering Composite Preview */}
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-start pt-[18%]">
                        {hasNameField && (
                          <div
                            style={{
                              color: nameField.fillColor,
                              textShadow: `${nameField.outlineColor} 0px 0px 8px, ${nameField.outlineColor} 0px 0px 16px`,
                            }}
                            className="font-black text-2xl tracking-widest sm:text-3xl text-center uppercase"
                          >
                            {testValues.name || 'LAST NAME'}
                          </div>
                        )}

                        {hasNumberField && (
                          <div
                            style={{
                              color: numberField.fillColor,
                              textShadow: `${numberField.outlineColor} 0px 0px 10px, ${numberField.outlineColor} 0px 0px 20px`,
                            }}
                            className="mt-6 font-black text-7xl sm:text-8xl tracking-tight text-center"
                          >
                            {testValues.number || '00'}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {proofing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
                      <div className="space-y-2 text-center">
                        <div className="mx-auto h-2 w-32 overflow-hidden rounded-full bg-border">
                          <div className="h-full w-1/2 animate-pulse bg-primary" />
                        </div>
                        <p className="text-xs font-medium text-muted">Rendering proof with server fonts…</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Template Summary Card */}
            <div className="rounded-2xl border border-border bg-bg p-4 text-xs">
              <div className="flex items-center justify-between font-semibold text-text">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Template Configuration Summary
                </span>
                <span className="text-primary font-bold">
                  {upcharge > 0 ? `+$${upcharge.toFixed(2)} Upcharge` : 'Included (Free)'}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2 text-muted">
                {hasNameField && (
                  <span className="rounded-md border border-border bg-card px-2 py-1">
                    Name Target: <strong className="text-text">{nameField.label}</strong> (max {nameField.max} chars, {nameField.fontFamily})
                  </span>
                )}
                {hasNumberField && (
                  <span className="rounded-md border border-border bg-card px-2 py-1">
                    Number Target: <strong className="text-text">{numberField.label}</strong> (max {numberField.max} digits, {numberField.fontFamily})
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
              <button
                onClick={() => setActiveStep(3)}
                className="btn-secondary text-sm"
              >
                Back: Constraints
              </button>

              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary inline-flex items-center gap-2 text-sm shadow-soft hover:shadow-soft-lg disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving Template…' : 'Save & Publish Team Template'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default AdminTeamTemplates
