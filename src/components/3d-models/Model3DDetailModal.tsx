import { useState } from 'react'
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
  Lock
} from 'lucide-react'
import type { User3DModel } from '../../types'
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
  const [isApproving, setIsApproving] = useState(false)
  const [isGenerating3D, setIsGenerating3D] = useState(false)
  const [isOrdering, setIsOrdering] = useState(false)
  const [isPurchasingLicense, setIsPurchasingLicense] = useState(false)

  // Order options - simplified to paint kit addon only
  const [includePaintKit, setIncludePaintKit] = useState(false)

  if (!isOpen) return null

  const hasAllAngles = model.angle_images?.front && model.angle_images?.back &&
                       model.angle_images?.left && model.angle_images?.right
  const isReady = model.status === 'ready'
  const canGenerate3D = hasAllAngles && !['generating_3d', 'ready'].includes(model.status)

  // Check purchased licenses
  const purchasedLicenses = (model as any).purchased_licenses || []
  const hasPersonalLicense = purchasedLicenses.includes('personal')
  const hasCommercialLicense = purchasedLicenses.includes('commercial')
  const hasAnyLicense = hasPersonalLicense || hasCommercialLicense

  // Calculate price - simplified
  const totalPrice = PRINT_PRICING.base_price + (includePaintKit ? PRINT_PRICING.paint_kit_addon : 0)

  const handleApprove = async () => {
    setIsApproving(true)
    try {
      await api.post(`/api/3d-models/${model.id}/approve`)
      onRefresh()
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setIsApproving(false)
    }
  }

  const handleGenerate3D = async () => {
    setIsGenerating3D(true)
    try {
      await api.post(`/api/3d-models/${model.id}/generate-3d`)
      onRefresh()
    } catch (err) {
      console.error('Failed to start 3D generation:', err)
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
                      <span className="text-text font-medium">PLA</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Color</span>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-gray-400 border border-border" />
                        <span className="text-text font-medium">Grey</span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Base Price</span>
                      <span className="text-text font-medium">${PRINT_PRICING.base_price}</span>
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
                      <span className="text-muted">Grey PLA Print</span>
                      <span className="text-text">${PRINT_PRICING.base_price}</span>
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

        {/* Footer Actions */}
        <div className="p-4 border-t border-border flex flex-wrap gap-2 justify-end">
          {model.status === 'awaiting_approval' && (
            <button
              onClick={handleApprove}
              disabled={isApproving}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-medium flex items-center gap-2 transition-all"
            >
              {isApproving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Approving...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Approve Concept</span>
                </>
              )}
            </button>
          )}

          {canGenerate3D && (
            <button
              onClick={handleGenerate3D}
              disabled={isGenerating3D}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium flex items-center gap-2 transition-all"
            >
              {isGenerating3D ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Generate 3D Model</span>
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
