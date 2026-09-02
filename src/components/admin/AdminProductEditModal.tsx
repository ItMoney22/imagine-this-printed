// Enhanced product edit modal — extracted from AdminDashboard.tsx (see
// docs/plans/2026-09-01-imagine-studio-step-flow-design.md §7).
//
// Layout: a large `object-contain` viewer on the left (click → ImageLightbox
// for zoom/prev/next/download/set-main/delete) and Details / Images / AI
// Tools tabs on the right. The Images tab groups assets by kind — Source ·
// No background · Upscaled · Mockups · Model shots (the last of which reads
// `product.metadata.etsy_shots.images`, a field the old modal never showed).
//
// This component owns no persistence itself — every mutation goes back up
// through the props the parent (AdminDashboard) supplies, which is also
// where `productAssets` (flat, table thumbnail) vs. `productAssetGroups`
// (grouped by kind, this modal's Images tab) live as separate state. See the
// bug note on `onSave` below for why field edits use a two-part contract.
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, RefreshCw, Scissors, ArrowUpCircle, LayoutGrid, Sparkles,
  ExternalLink, Wand2, ImageOff, Check, Download,
} from 'lucide-react'
import { CHECKERBOARD_BG } from '../imagination/checkerboard'
import { COLOR_PRESETS, isLightSwatch } from '../../utils/color-presets'
import { MockupProgressPanel, type MockupProgress } from '../MockupProgressPanel'
import { ImageLightbox, type LightboxImage } from './ImageLightbox'

type AssetGroupKey = 'source' | 'nobg' | 'upscaled' | 'mockup' | 'model'

const GROUP_LABELS: Record<AssetGroupKey, string> = {
  source: 'Source',
  nobg: 'No Background',
  upscaled: 'Upscaled',
  mockup: 'Mockups',
  model: 'Model Shots',
}

// Fixed display order for the Images tab and the flattened lightbox gallery.
const GROUP_ORDER: AssetGroupKey[] = ['source', 'nobg', 'upscaled', 'mockup', 'model']

interface GalleryImage {
  url: string
  assetId?: string
  group: AssetGroupKey
}

const buildGallery = (product: any, assetGroups: Record<string, any[]>): GalleryImage[] => {
  const out: GalleryImage[] = []
  const pushGroup = (key: AssetGroupKey, list: any[] | undefined) => {
    for (const asset of list || []) {
      if (asset?.url) out.push({ url: asset.url, assetId: asset.id, group: key })
    }
  }
  pushGroup('source', assetGroups?.source)
  pushGroup('nobg', assetGroups?.nobg)
  pushGroup('upscaled', assetGroups?.upscaled)
  pushGroup('mockup', assetGroups?.mockup)
  // Etsy model shots (backend/services/etsy-model-shots.ts) live directly on
  // metadata as plain URL strings — no product_assets row, hence no assetId
  // (which is also why they can't be deleted from the lightbox).
  const modelShots: string[] = Array.isArray(product?.metadata?.etsy_shots?.images)
    ? product.metadata.etsy_shots.images
    : []
  for (const url of modelShots) {
    if (url) out.push({ url, group: 'model' })
  }
  return out
}

const SIZES_LABEL = (v: string) => v

export interface AdminProductEditModalProps {
  product: any
  assetGroups: Record<string, any[]>
  jobs: any[]
  sizeOptions: string[]
  loadingAction: string | null
  generatingGptText: boolean
  mockupProgress?: MockupProgress
  onClose: () => void
  // `localPatch` mirrors what the field displays immediately (optimistic
  // update to the parent's editingProductData); `persistField`/`persistValue`
  // is what actually gets written to the DB row. These differ for the
  // in-stock checkbox — the UI/local key is `inStock`, the DB column is
  // `is_active` — which is why this isn't a plain (field, value) pair.
  onSave: (localPatch: Record<string, any>, persistField: string, persistValue: any) => void
  onSetMain: (imageUrl: string) => void
  onDeleteImage: (assetId: string, imageUrl: string) => void
  onRegenerate: () => void
  onRemoveBackground: () => void
  onUpscale: () => void
  onCreateMockups: () => void
  onGptAssist: () => void
}

export const AdminProductEditModal: React.FC<AdminProductEditModalProps> = ({
  product,
  assetGroups,
  jobs,
  sizeOptions,
  loadingAction,
  generatingGptText,
  mockupProgress,
  onClose,
  onSave,
  onSetMain,
  onDeleteImage,
  onRegenerate,
  onRemoveBackground,
  onUpscale,
  onCreateMockups,
  onGptAssist,
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'images' | 'ai'>('details')
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [customColorHex, setCustomColorHex] = useState('#')

  const gallery = useMemo(() => buildGallery(product, assetGroups), [product, assetGroups])
  const mainImageUrl: string | null = product?.images?.[0] ?? null

  // Team-only halftone/diffusion print files (`kind:'print'`, see step-flow
  // print prep, design doc §10) — deliberately kept OUT of `gallery` above so
  // they never reach the Mockups group, the flattened lightbox, or "Set as
  // main"; they get their own read-only section below with just a download.
  const printAssets = useMemo(
    () => (assetGroups?.print || []).filter((a: any) => !!a?.url),
    [assetGroups]
  )

  // Keep the big-viewer selection valid: default to the main image (or the
  // first gallery image) on open, and fall back the same way if whatever was
  // selected just got deleted out from under it.
  useEffect(() => {
    setSelectedUrl(prev => {
      if (prev && gallery.some(g => g.url === prev)) return prev
      return gallery.find(g => g.url === mainImageUrl)?.url ?? gallery[0]?.url ?? null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, gallery])

  const lightboxImages: LightboxImage[] = useMemo(
    () => gallery.map(g => ({ url: g.url, label: GROUP_LABELS[g.group], assetId: g.assetId })),
    [gallery],
  )

  const openLightboxAtSelected = () => {
    const idx = gallery.findIndex(g => g.url === selectedUrl)
    setLightboxIndex(idx >= 0 ? idx : 0)
  }

  const handleLightboxSetMain = (image: LightboxImage) => {
    onSetMain(image.url)
  }
  const handleLightboxDelete = (image: LightboxImage) => {
    if (!image.assetId) return
    onDeleteImage(image.assetId, image.url)
    setLightboxIndex(null)
  }

  const handleField = (localKey: string, value: any, persistField: string = localKey) => {
    onSave({ [localKey]: value }, persistField, value)
  }

  const toggleSize = (size: string) => {
    const current: string[] = product?.sizes || []
    const next = current.includes(size) ? current.filter((s: string) => s !== size) : [...current, size]
    onSave({ sizes: next }, 'sizes', next)
  }

  const toggleColor = (hex: string) => {
    const current: string[] = product?.colors || []
    const next = current.includes(hex) ? current.filter((c: string) => c !== hex) : [...current, hex]
    onSave({ colors: next }, 'colors', next)
  }

  const addCustomColor = () => {
    if (customColorHex.match(/^#[0-9A-Fa-f]{6}$/) && !(product?.colors || []).includes(customColorHex)) {
      const next = [...(product?.colors || []), customColorHex]
      onSave({ colors: next }, 'colors', next)
      setCustomColorHex('#')
    }
  }

  if (!product) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-card border border-white/10 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center flex-shrink-0">
          <h3 className="text-lg font-display font-bold text-text truncate pr-4">
            Edit Product: {product.name}
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-text transition-colors p-1.5 hover:bg-white/10 rounded-lg flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden p-6 flex flex-col lg:flex-row gap-6">
          {/* Large viewer */}
          <div className="lg:w-[42%] flex flex-col gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={openLightboxAtSelected}
              disabled={!selectedUrl}
              className={`relative rounded-2xl overflow-hidden border border-white/10 ${CHECKERBOARD_BG} flex items-center justify-center min-h-[260px] lg:h-[420px] group disabled:cursor-default`}
            >
              {selectedUrl ? (
                <img
                  src={selectedUrl}
                  alt={product.name}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted">
                  <ImageOff className="w-8 h-8" />
                  <span className="text-sm">No images yet</span>
                </div>
              )}
              {selectedUrl && (
                <span className="absolute bottom-2 right-2 text-[11px] px-2 py-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to zoom
                </span>
              )}
              {selectedUrl && selectedUrl === mainImageUrl && (
                <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded-full bg-accent text-black">
                  MAIN
                </span>
              )}
            </button>
            {mockupProgress && <MockupProgressPanel progress={mockupProgress} />}
          </div>

          {/* Tabs */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex gap-1 border-b border-white/10 mb-4 flex-shrink-0">
              {([
                ['details', 'Details'],
                ['images', 'Images'],
                ['ai', 'AI Tools'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 lg:overflow-y-auto pr-1 -mr-1">
              {activeTab === 'details' && (
                <DetailsTab
                  product={product}
                  sizeOptions={sizeOptions}
                  generatingGptText={generatingGptText}
                  onGptAssist={onGptAssist}
                  onField={handleField}
                  onToggleSize={toggleSize}
                  onToggleColor={toggleColor}
                  customColorHex={customColorHex}
                  onCustomColorHexChange={setCustomColorHex}
                  onAddCustomColor={addCustomColor}
                />
              )}
              {activeTab === 'images' && (
                <ImagesTab
                  gallery={gallery}
                  selectedUrl={selectedUrl}
                  mainImageUrl={mainImageUrl}
                  onSelect={setSelectedUrl}
                  printAssets={printAssets}
                />
              )}
              {activeTab === 'ai' && (
                <AiToolsTab
                  product={product}
                  gallery={gallery}
                  jobs={jobs}
                  loadingAction={loadingAction}
                  mockupProgress={mockupProgress}
                  onRegenerate={onRegenerate}
                  onRemoveBackground={onRemoveBackground}
                  onUpscale={onUpscale}
                  onCreateMockups={onCreateMockups}
                />
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-primary hover:opacity-90 text-white font-medium rounded-xl shadow-lg shadow-primary/25 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={lightboxImages}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          mainImageUrl={mainImageUrl}
          onSetMain={handleLightboxSetMain}
          onDelete={handleLightboxDelete}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const DetailsTab: React.FC<{
  product: any
  sizeOptions: string[]
  generatingGptText: boolean
  onGptAssist: () => void
  onField: (localKey: string, value: any, persistField?: string) => void
  onToggleSize: (size: string) => void
  onToggleColor: (hex: string) => void
  customColorHex: string
  onCustomColorHexChange: (v: string) => void
  onAddCustomColor: () => void
}> = ({
  product, sizeOptions, generatingGptText, onGptAssist, onField,
  onToggleSize, onToggleColor, customColorHex, onCustomColorHexChange, onAddCustomColor,
}) => {
  const showColors = product.category !== '3d-models' && product.category !== 'metal-art'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-text">Product Details</h4>
        <button
          onClick={onGptAssist}
          disabled={generatingGptText}
          className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-primary to-secondary hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium rounded-lg shadow-md transition-opacity"
        >
          {generatingGptText ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          GPT Assist
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted mb-2">Product Name</label>
        <input
          type="text"
          value={product.name || ''}
          onChange={(e) => onField('name', e.target.value)}
          className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted mb-2">Description</label>
        <textarea
          rows={4}
          value={product.description || ''}
          onChange={(e) => onField('description', e.target.value)}
          className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-2">Price ($)</label>
          <input
            type="number"
            step="0.01"
            value={product.price}
            onChange={(e) => onField('price', parseFloat(e.target.value))}
            className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-2">Category</label>
          <select
            value={product.category}
            onChange={(e) => onField('category', e.target.value)}
            className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          >
            <option value="shirts">T-Shirts</option>
            <option value="hoodies">Hoodies</option>
            <option value="tumblers">Tumblers</option>
            <option value="dtf-transfers">DTF Transfers</option>
            <option value="3d-models">3D Models</option>
            <option value="metal-art">Metal Art</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-2">Status</label>
          <select
            value={product.status}
            onChange={(e) => onField('status', e.target.value)}
            className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          >
            <option value="draft">Draft</option>
            <option value="active">Active (Published)</option>
          </select>
        </div>
        <div className="flex items-center space-x-2 pt-7">
          <input
            type="checkbox"
            id="inStockEdit"
            checked={product.inStock !== false}
            onChange={(e) => onField('inStock', e.target.checked, 'is_active')}
            className="w-4 h-4 text-primary border-white/20 rounded focus:ring-primary"
          />
          <label htmlFor="inStockEdit" className="text-sm text-text font-medium">
            Active
          </label>
        </div>
      </div>

      {sizeOptions.length > 0 && (
        <div className="bg-bg/40 border border-white/10 rounded-xl p-4">
          <label className="block text-sm font-medium text-text mb-3">Available Sizes</label>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onToggleSize(size)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  (product.sizes || []).includes(size)
                    ? 'bg-primary text-white shadow-md'
                    : 'bg-card text-text border border-white/10 hover:border-primary/50'
                }`}
              >
                {SIZES_LABEL(size)}
              </button>
            ))}
          </div>
          {(product.sizes || []).length > 0 && (
            <p className="text-xs text-muted mt-2">Selected: {(product.sizes || []).join(', ')}</p>
          )}
        </div>
      )}

      {showColors && (
        <div className="bg-bg/40 border border-white/10 rounded-xl p-4">
          <label className="block text-sm font-medium text-text mb-3">Available Colors</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {COLOR_PRESETS.map((color) => (
              <button
                key={color.hex}
                type="button"
                onClick={() => onToggleColor(color.hex)}
                className={`w-10 h-10 rounded-full border-2 transition-all flex items-center justify-center ${
                  (product.colors || []).includes(color.hex)
                    ? 'border-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-card'
                    : 'border-white/20 hover:border-white/40'
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.name}
              >
                {(product.colors || []).includes(color.hex) && (
                  <Check className={`w-4 h-4 ${isLightSwatch(color.hex) ? 'text-black' : 'text-white'}`} strokeWidth={3} />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customColorHex}
              onChange={(e) => onCustomColorHexChange(e.target.value)}
              placeholder="#000000"
              maxLength={7}
              className="w-24 bg-card border border-white/10 rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <input
              type="color"
              value={customColorHex.length === 7 ? customColorHex : '#000000'}
              onChange={(e) => onCustomColorHexChange(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <button
              type="button"
              onClick={onAddCustomColor}
              disabled={!customColorHex.match(/^#[0-9A-Fa-f]{6}$/)}
              className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              Add Color
            </button>
          </div>
          {(product.colors || []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {(product.colors || []).map((hex: string) => (
                <span
                  key={hex}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-card border border-white/10 rounded-full text-xs text-text"
                >
                  <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: hex }} />
                  {hex}
                  <button type="button" onClick={() => onToggleColor(hex)} className="text-muted hover:text-red-400">
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {product.metadata?.ai_generated && (
        <div className="border border-primary/20 rounded-xl p-4 bg-primary/5">
          <h4 className="font-semibold text-text mb-3">AI Metadata</h4>
          <div className="space-y-2 text-sm">
            {product.metadata.original_prompt && (
              <div>
                <span className="font-medium text-muted">Original Prompt:</span>
                <p className="text-text mt-1">{product.metadata.original_prompt}</p>
              </div>
            )}
            {product.metadata.image_prompt && (
              <div>
                <span className="font-medium text-muted">Image Prompt:</span>
                <p className="text-text mt-1">{product.metadata.image_prompt}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {product.metadata.image_style && (
                <div>
                  <span className="font-medium text-muted">Style:</span>
                  <p className="text-text capitalize">{product.metadata.image_style}</p>
                </div>
              )}
              {product.metadata.background && (
                <div>
                  <span className="font-medium text-muted">Background:</span>
                  <p className="text-text capitalize">{product.metadata.background}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const ImagesTab: React.FC<{
  gallery: GalleryImage[]
  selectedUrl: string | null
  mainImageUrl: string | null
  onSelect: (url: string) => void
  printAssets: any[]
}> = ({ gallery, selectedUrl, mainImageUrl, onSelect, printAssets }) => {
  if (gallery.length === 0 && printAssets.length === 0) {
    return <p className="text-sm text-muted">No images yet for this product.</p>
  }

  return (
    <div className="space-y-5">
      {GROUP_ORDER.map((key) => {
        const imgs = gallery.filter(g => g.group === key)
        if (imgs.length === 0) return null
        return (
          <div key={key}>
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              {GROUP_LABELS[key]} <span className="text-muted/60">({imgs.length})</span>
            </h5>
            <div className="grid grid-cols-3 gap-2">
              {imgs.map((img, i) => (
                <button
                  key={img.assetId || `${key}-${i}`}
                  type="button"
                  onClick={() => onSelect(img.url)}
                  className={`relative aspect-square rounded-lg overflow-hidden border ${CHECKERBOARD_BG} transition-colors ${
                    selectedUrl === img.url
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <img src={img.url} alt={`${GROUP_LABELS[key]} ${i + 1}`} className="w-full h-full object-contain" />
                  {mainImageUrl === img.url && (
                    <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-black">
                      MAIN
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {printAssets.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Print files (team only) <span className="text-muted/60">({printAssets.length})</span>
          </h5>
          <p className="text-[11px] text-muted mb-2">
            Halftone/diffusion screens for the press. Never shown to customers, never a main image.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {printAssets.map((asset: any, i: number) => (
              <div
                key={asset.id || `print-${i}`}
                className={`relative aspect-square rounded-lg overflow-hidden border border-white/10 ${CHECKERBOARD_BG}`}
              >
                <img src={asset.url} alt={`Print file ${i + 1}`} className="w-full h-full object-contain" />
                <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500 text-black">
                  TEAM ONLY
                </span>
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-1 right-1 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-1 rounded-full bg-black/70 text-white hover:bg-black/90"
                  title="Download print file"
                >
                  <Download className="w-3 h-3" /> Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const AiToolsTab: React.FC<{
  product: any
  gallery: GalleryImage[]
  jobs: any[]
  loadingAction: string | null
  mockupProgress?: MockupProgress
  onRegenerate: () => void
  onRemoveBackground: () => void
  onUpscale: () => void
  onCreateMockups: () => void
}> = ({ product, gallery, jobs, loadingAction, mockupProgress, onRegenerate, onRemoveBackground, onUpscale, onCreateMockups }) => {
  const navigate = useNavigate()
  const productId = product.id

  const openInImaginationStation = () => {
    const sourceUrl = gallery.find(g => g.group === 'source')?.url || product.images?.[0] || ''
    const params = new URLSearchParams({
      addImage: sourceUrl,
      productName: product.name || '',
      productId: productId || '',
    })
    navigate(`/imagination-station?${params.toString()}`)
  }

  const continueInStepFlow = () => {
    navigate(`/admin/ai/products/create?mode=steps&productId=${encodeURIComponent(productId)}`)
  }

  const isBusy = (op: string) => loadingAction === `${op}-${productId}`

  return (
    <div className="space-y-6">
      <div className="border border-white/10 rounded-xl p-4 bg-gradient-to-r from-primary/10 to-secondary/10">
        <h4 className="font-semibold text-text mb-3">Advanced Image Operations</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={onRegenerate}
            disabled={isBusy('regenerate')}
            className="flex items-center justify-center gap-2 bg-primary hover:opacity-90 disabled:opacity-50 text-white text-sm py-3 px-4 rounded-lg transition-opacity font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${isBusy('regenerate') ? 'animate-spin' : ''}`} />
            {isBusy('regenerate') ? 'Creating…' : 'Regenerate Image'}
          </button>
          <button
            onClick={onRemoveBackground}
            disabled={isBusy('rembg')}
            className="flex items-center justify-center gap-2 bg-secondary hover:opacity-90 disabled:opacity-50 text-white text-sm py-3 px-4 rounded-lg transition-opacity font-medium"
          >
            <Scissors className="w-4 h-4" />
            {isBusy('rembg') ? 'Creating…' : 'Remove Background'}
          </button>
          <button
            onClick={onUpscale}
            disabled={isBusy('upscale')}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm py-3 px-4 rounded-lg transition-colors font-medium"
          >
            <ArrowUpCircle className="w-4 h-4" />
            {isBusy('upscale') ? 'Creating…' : 'Upscale Image'}
          </button>
        </div>
        <button
          onClick={onCreateMockups}
          disabled={isBusy('mockups') || mockupProgress?.polling}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-accent hover:opacity-90 disabled:opacity-50 text-black text-sm py-3 px-4 rounded-lg transition-opacity font-medium"
        >
          <LayoutGrid className="w-4 h-4" />
          {isBusy('mockups')
            ? 'Creating…'
            : mockupProgress?.polling
            ? `Generating ${mockupProgress.succeeded + mockupProgress.failed}/${mockupProgress.total}…`
            : 'Create Mockups'}
        </button>
      </div>

      <div className="border border-white/10 rounded-xl p-4">
        <h4 className="font-semibold text-text mb-3">Send Elsewhere</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={openInImaginationStation}
            className="flex items-center justify-center gap-2 bg-card border border-white/10 hover:border-primary/50 text-text text-sm py-3 px-4 rounded-lg transition-colors font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Open in Imagination Station
          </button>
          <button
            onClick={continueInStepFlow}
            className="flex items-center justify-center gap-2 bg-card border border-white/10 hover:border-primary/50 text-text text-sm py-3 px-4 rounded-lg transition-colors font-medium"
          >
            <Sparkles className="w-4 h-4" />
            Continue in Step Flow
          </button>
        </div>
      </div>

      <div className="border border-white/10 rounded-xl p-4">
        <h4 className="font-semibold text-text mb-3">Processing Jobs</h4>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No jobs found for this product.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between bg-bg/40 p-3 rounded-lg border border-white/10">
                <div>
                  <span className="text-sm font-medium text-text capitalize">
                    {job.type.replace('replicate_', '').replace('_', ' ')}
                  </span>
                  <span
                    className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${
                      job.status === 'succeeded'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : job.status === 'running'
                        ? 'bg-blue-500/15 text-blue-400'
                        : job.status === 'failed'
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
                <span className="text-xs text-muted">{new Date(job.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminProductEditModal
