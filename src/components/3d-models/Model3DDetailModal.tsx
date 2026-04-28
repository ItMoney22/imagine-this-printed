import { useEffect, useState } from 'react'
import {
  Box,
  CheckCircle,
  Download,
  Loader2,
  ShoppingCart,
  X,
  Zap,
  Image as ImageIcon,
  Palette,
  Lock,
  Ruler
} from 'lucide-react'
import type { User3DModel, PrintSizeTier, SizeTierConfig } from '../../types'
import { Model3DViewer, Model3DFallbackViewer } from './Model3DViewer'
import { Model3DStatusProgress } from './Model3DStatusProgress'
import api from '../../lib/api'
import { useCart } from '../../context/CartContext'

interface Model3DDetailModalProps {
  model: User3DModel
  isOpen: boolean
  onClose: () => void
  onRefresh: () => void
}

// Simplified pricing - PLA grey only
const PRINT_PRICING = {
  base_price: 25,
  paint_kit_addon: 15
}

// Download license pricing (ITC)
const DOWNLOAD_PRICING = {
  personal: 200,
  commercial: 500
}

export function Model3DDetailModal({
  model,
  isOpen,
  onClose,
  onRefresh
}: Model3DDetailModalProps) {
  const { addToCart } = useCart()

  const [activeTab, setActiveTab] = useState<'preview' | 'order' | 'download'>('preview')
  const [isGenerating3D, setIsGenerating3D] = useState(false)
  const [isOrdering, setIsOrdering] = useState(false)
  const [isPurchasingLicense, setIsPurchasingLicense] = useState(false)

  // Size tier picker (loaded from /api/3d-models/size-tiers)
  const [sizeTiers, setSizeTiers] = useState<SizeTierConfig[]>([])
  const [selectedTier, setSelectedTier] = useState<PrintSizeTier>('small')

  useEffect(() => {
    if (!isOpen) return
    api.get('/api/3d-models/size-tiers')
      .then((res) => {
        const tiers: SizeTierConfig[] = res.data?.tiers ?? []
        if (tiers.length) setSizeTiers(tiers)
      })
      .catch((err) => console.warn('[3d-detail] size-tiers fetch failed', err))
  }, [isOpen])

  // Order options - simplified to paint kit addon only
  const [includePaintKit, setIncludePaintKit] = useState(false)

  if (!isOpen) return null

  // Tripo3D works directly from the concept image — no angles required.
  // Show the size picker once the concept is approved and we're ready to convert.
  const hasConcept = !!model.concept_image_url
  const isReady = model.status === 'ready'
  const canGenerate3D = hasConcept && (
    model.status === 'awaiting_3d_generation' ||
    model.status === 'awaiting_approval' || // pre-approval too — admin/owner can pick early
    model.status === 'failed'                // allow retry from a failed state
  )
  const selectedTierConfig = sizeTiers.find((t) => t.tier === selectedTier)

  // Check purchased licenses
  const purchasedLicenses = model.purchased_licenses || []
  const hasPersonalLicense = purchasedLicenses.includes('personal')
  const hasCommercialLicense = purchasedLicenses.includes('commercial')
  const hasAnyLicense = hasPersonalLicense || hasCommercialLicense

  // Calculate price — prefer the size-tier price stored on the model row,
  // falls back to the legacy flat $25 for old models created before tiering shipped.
  const basePrintPrice = model.print_price_usd ?? PRINT_PRICING.base_price
  const totalPrice = basePrintPrice + (includePaintKit ? PRINT_PRICING.paint_kit_addon : 0)

  // (Approve handler removed — generate-3d implicitly approves)

  const handleGenerate3D = async () => {
    setIsGenerating3D(true)
    try {
      await api.post(`/api/3d-models/${model.id}/generate-3d`, { size: selectedTier })
      onRefresh()
    } catch (err: any) {
      console.error('Failed to start 3D generation:', err)
      const msg = err?.response?.data?.error || err?.message || 'Failed to start 3D generation'
      alert(msg)
    } finally {
      setIsGenerating3D(false)
    }
  }

  const handleOrder = async () => {
    setIsOrdering(true)
    try {
      const response = await api.post(`/api/3d-models/${model.id}/order`, {
        include_paint_kit: includePaintKit
      })

      if (response.data?.ok && response.data?.product) {
        // Add to cart
        addToCart({
          ...response.data.product,
          quantity: 1
        })
        onClose()
      }
    } catch (err) {
      console.error('Failed to order:', err)
    } finally {
      setIsOrdering(false)
    }
  }

  const handlePurchaseLicense = async (licenseType: 'personal' | 'commercial') => {
    setIsPurchasingLicense(true)
    try {
      const response = await api.post(`/api/3d-models/${model.id}/purchase-download`, {
        license_type: licenseType
      })

      if (response.data?.ok) {
        onRefresh() // Refresh to get updated licenses
      }
    } catch (err: any) {
      console.error('Failed to purchase license:', err)
      if (err.response?.status === 402) {
        alert('Insufficient ITC balance')
      }
    } finally {
      setIsPurchasingLicense(false)
    }
  }

  const handleDownload = async (format: 'glb' | 'stl') => {
    if (!hasAnyLicense) {
      setActiveTab('download')
      return
    }

    try {
      const response = await api.get(`/api/3d-models/${model.id}/download/${format}`)
      if (response.data?.downloadUrl) {
        window.open(response.data.downloadUrl, '_blank')
      }
    } catch (err: any) {
      console.error('Failed to get download URL:', err)
      if (err.response?.status === 402) {
        setActiveTab('download')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Box className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-display font-bold text-text text-lg">
                3D Model Details
              </h2>
              <p className="text-muted text-sm line-clamp-1">
                {model.prompt}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg text-muted hover:text-text transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Status Progress */}
          <Model3DStatusProgress
            status={model.status}
            errorMessage={model.error_message}
            className="mb-6"
          />

          {/* Tabs */}
          {isReady && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab('preview')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'preview'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-muted hover:text-text'
                }`}
              >
                3D Preview
              </button>
              <button
                onClick={() => setActiveTab('order')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'order'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-muted hover:text-text'
                }`}
              >
                Order Print
              </button>
              <button
                onClick={() => setActiveTab('download')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                  activeTab === 'download'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'text-muted hover:text-text'
                }`}
              >
                <Download className="w-4 h-4" />
                Download Files
                {hasAnyLicense && <CheckCircle className="w-3 h-3 text-green-400" />}
              </button>
            </div>
          )}

          {/* Size tier picker — visible when ready to convert (concept exists, not yet 3D) */}
          {canGenerate3D && sizeTiers.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-bg/40 border border-primary/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-text font-semibold flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-primary" />
                  Pick a print size
                </h3>
                <span className="text-xs text-muted">Drives mesh detail + print pricing</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {sizeTiers.map((tier) => {
                  const active = tier.tier === selectedTier
                  return (
                    <button
                      key={tier.tier}
                      onClick={() => setSelectedTier(tier.tier)}
                      disabled={isGenerating3D}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        active
                          ? 'border-primary bg-primary/15 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-bg/40 hover:border-primary/40'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-baseline justify-between mb-1">
                        <span className={`font-bold text-sm ${active ? 'text-primary' : 'text-text'}`}>
                          {tier.label}
                        </span>
                        <span className="text-[10px] text-muted">{tier.printHeightMm}mm</span>
                      </div>
                      <p className="text-[11px] text-muted leading-snug mb-2 line-clamp-2">
                        {tier.description}
                      </p>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-sm font-semibold ${active ? 'text-primary' : 'text-text/80'}`}>
                          {tier.itcCost} ITC
                        </span>
                        <span className="text-[10px] text-muted">+ ${tier.printPriceUsd} print</span>
                      </div>
                      <p className="text-[10px] text-muted/70 mt-1">~{tier.approxSeconds}s gen</p>
                    </button>
                  )
                })}
              </div>
              {selectedTierConfig && (
                <p className="text-[11px] text-muted mt-3">
                  Mesh quality: <span className="text-text/80">{selectedTierConfig.faceLimit.toLocaleString()} faces</span>
                  {' · '}Texture: <span className="text-text/80">{selectedTierConfig.texture}</span>
                  {selectedTierConfig.quad && <span className="text-text/80"> · quad mesh</span>}
                  {' · '}<span className="text-text/80">auto-scaled to mm</span> for slicer
                </p>
              )}
            </div>
          )}

          {/* Preview Tab */}
          {(activeTab === 'preview' || !isReady) && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* 3D Viewer or Concept Image */}
              <div className="aspect-square rounded-xl overflow-hidden bg-bg">
                {isReady && model.glb_url ? (
                  <Model3DViewer
                    glbUrl={model.glb_url}
                    alt={model.prompt}
                    className="w-full h-full"
                  />
                ) : (
                  <Model3DFallbackViewer
                    conceptUrl={model.concept_image_url}
                    angleImages={model.angle_images}
                    className="w-full h-full"
                  />
                )}
              </div>

              {/* Angle Views Gallery */}
              <div>
                <h3 className="text-text font-medium mb-3 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Generated Views
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {model.concept_image_url && (
                    <div className="aspect-square rounded-lg overflow-hidden bg-bg border border-border">
                      <img
                        src={model.concept_image_url}
                        alt="Concept"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center">
                        Concept
                      </div>
                    </div>
                  )}
                  {['front', 'back', 'left', 'right'].map(angle => {
                    const url = model.angle_images?.[angle as keyof typeof model.angle_images]
                    return (
                      <div key={angle} className="relative aspect-square rounded-lg overflow-hidden bg-bg border border-border">
                        {url ? (
                          <>
                            <img
                              src={url}
                              alt={`${angle} view`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center capitalize">
                              {angle}
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted">
                            <span className="text-xs capitalize">{angle}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Order Tab - Simplified PLA Grey + Paint Kit */}
          {activeTab === 'order' && isReady && (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Preview */}
              <div className="aspect-square rounded-xl overflow-hidden bg-bg">
                {model.glb_url && (
                  <Model3DViewer
                    glbUrl={model.glb_url}
                    alt={model.prompt}
                    className="w-full h-full"
                  />
                )}
              </div>

              {/* Order Options */}
              <div className="space-y-4">
                {/* Material & Color Info */}
                <div className="p-4 rounded-xl bg-bg border border-border">
                  <h4 className="font-medium text-text mb-2">Print Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Material</span>
                      <span className="text-text font-medium">PLA <span className="text-xs text-muted">(more materials coming soon)</span></span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Color</span>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-gray-400 border border-border" />
                        <span className="text-text font-medium">Grey</span>
                      </div>
                    </div>
                    {model.print_height_mm && (
                      <div className="flex justify-between">
                        <span className="text-muted">Print height</span>
                        <span className="text-text font-medium">{model.print_height_mm}mm tall</span>
                      </div>
                    )}
                    {model.size_tier && (
                      <div className="flex justify-between">
                        <span className="text-muted">Size tier</span>
                        <span className="text-text font-medium capitalize">{model.size_tier}</span>
                      </div>
                    )}
                    {model.triangle_count && (
                      <div className="flex justify-between">
                        <span className="text-muted">Mesh detail</span>
                        <span className="text-text font-medium">{model.triangle_count.toLocaleString()} triangles</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted">Base Price</span>
                      <span className="text-text font-medium">${basePrintPrice}</span>
                    </div>
                  </div>
                </div>

                {/* Paint Kit Addon */}
                <button
                  onClick={() => setIncludePaintKit(!includePaintKit)}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                    includePaintKit
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-border hover:border-purple-400/50 bg-bg'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      includePaintKit ? 'bg-purple-500 text-white' : 'bg-border'
                    }`}>
                      {includePaintKit && <CheckCircle className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Palette className="w-5 h-5 text-purple-400" />
                        <span className="font-medium text-text">Add Paint Kit</span>
                        <span className="text-sm font-bold text-purple-400">+${PRINT_PRICING.paint_kit_addon}</span>
                      </div>
                      <p className="text-sm text-muted mt-1">
                        Includes acrylic paints, brushes, and instructions - fun for the whole family!
                      </p>
                    </div>
                  </div>
                </button>

                {/* Price Summary */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Grey PLA Print {model.print_height_mm ? `(${model.print_height_mm}mm)` : ''}</span>
                      <span className="text-text">${basePrintPrice}</span>
                    </div>
                    {includePaintKit && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">Paint Kit</span>
                        <span className="text-text">+${PRINT_PRICING.paint_kit_addon}</span>
                      </div>
                    )}
                    <div className="border-t border-border pt-2 flex items-center justify-between">
                      <span className="text-text font-medium">Total</span>
                      <span className="text-2xl font-bold text-purple-400">
                        ${totalPrice.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Download Tab - License Purchase */}
          {activeTab === 'download' && isReady && (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Preview */}
              <div className="aspect-square rounded-xl overflow-hidden bg-bg">
                {model.glb_url && (
                  <Model3DViewer
                    glbUrl={model.glb_url}
                    alt={model.prompt}
                    className="w-full h-full"
                  />
                )}
              </div>

              {/* License Options */}
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <div className="flex items-start gap-3">
                    <Lock className="w-5 h-5 text-amber-400 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-text">Download License Required</h4>
                      <p className="text-sm text-muted mt-1">
                        Purchase a license to download your 3D model files (GLB/STL). All designs include a watermark.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Personal License */}
                <div className={`p-4 rounded-xl border-2 transition-all ${
                  hasPersonalLicense
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-border bg-bg'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">Personal Use</span>
                      {hasPersonalLicense && <CheckCircle className="w-4 h-4 text-green-400" />}
                    </div>
                    <span className="text-lg font-bold text-blue-400">{DOWNLOAD_PRICING.personal} ITC</span>
                  </div>
                  <p className="text-sm text-muted mb-3">
                    Print for yourself, gifts, or personal projects. Not for resale.
                  </p>
                  {hasPersonalLicense ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload('glb')}
                        className="flex-1 px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium transition-all"
                      >
                        Download GLB
                      </button>
                      <button
                        onClick={() => handleDownload('stl')}
                        className="flex-1 px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium transition-all"
                      >
                        Download STL
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handlePurchaseLicense('personal')}
                      disabled={isPurchasingLicense}
                      className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-all disabled:opacity-50"
                    >
                      {isPurchasingLicense ? 'Processing...' : 'Purchase Personal License'}
                    </button>
                  )}
                </div>

                {/* Commercial License */}
                <div className={`p-4 rounded-xl border-2 transition-all ${
                  hasCommercialLicense
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-border bg-bg'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">Commercial Use</span>
                      {hasCommercialLicense && <CheckCircle className="w-4 h-4 text-green-400" />}
                    </div>
                    <span className="text-lg font-bold text-purple-400">{DOWNLOAD_PRICING.commercial} ITC</span>
                  </div>
                  <p className="text-sm text-muted mb-3">
                    Sell prints, use in products, or for business purposes.
                  </p>
                  {hasCommercialLicense ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload('glb')}
                        className="flex-1 px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium transition-all"
                      >
                        Download GLB
                      </button>
                      <button
                        onClick={() => handleDownload('stl')}
                        className="flex-1 px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium transition-all"
                      >
                        Download STL
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handlePurchaseLicense('commercial')}
                      disabled={isPurchasingLicense}
                      className="w-full px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-all disabled:opacity-50"
                    >
                      {isPurchasingLicense ? 'Processing...' : 'Purchase Commercial License'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions — note: explicit "Approve Concept" was removed. Picking a size
            and clicking Generate IS the approval. Saves a click and avoids the legacy
            DB-state flip that the schema doesn't support. */}
        <div className="p-4 border-t border-border flex flex-wrap gap-2 justify-end">{/* approve button removed */}

          {canGenerate3D && (
            <button
              onClick={handleGenerate3D}
              disabled={isGenerating3D || !selectedTierConfig}
              className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-semibold flex items-center gap-2 transition-all shadow-lg shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating3D ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting…</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>
                    Generate {selectedTierConfig?.label ?? 'Small'} (
                    {selectedTierConfig?.itcCost ?? '…'} ITC)
                  </span>
                </>
              )}
            </button>
          )}

          {isReady && activeTab === 'order' && (
            <button
              onClick={handleOrder}
              disabled={isOrdering}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium flex items-center gap-2 transition-all"
            >
              {isOrdering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Adding...</span>
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4" />
                  <span>Add to Cart - ${totalPrice.toFixed(2)}</span>
                </>
              )}
            </button>
          )}

          {isReady && activeTab === 'preview' && (
            <>
              <button
                onClick={() => setActiveTab('download')}
                className="px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium flex items-center gap-2 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Download Files</span>
                {!hasAnyLicense && <Lock className="w-3 h-3" />}
              </button>
              <button
                onClick={() => setActiveTab('order')}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium flex items-center gap-2 transition-all"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Order Print</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Model3DDetailModal
