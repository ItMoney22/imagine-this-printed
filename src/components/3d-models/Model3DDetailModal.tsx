import { useState } from 'react'
import {
  Box,
  CheckCircle,
  Download,
  Loader2,
  ShoppingCart,
  X,
  Zap,
  Image as ImageIcon
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

const PRINT_SIZES = [
  { key: 'small', label: 'Small (3")', price: 15 },
  { key: 'medium', label: 'Medium (5")', price: 25 },
  { key: 'large', label: 'Large (8")', price: 45 },
  { key: 'xlarge', label: 'X-Large (12")', price: 75 }
]

const MATERIALS = [
  { key: 'pla', label: 'PLA', multiplier: 1.0, description: 'Standard, eco-friendly' },
  { key: 'abs', label: 'ABS', multiplier: 1.2, description: 'Durable, heat-resistant' },
  { key: 'petg', label: 'PETG', multiplier: 1.3, description: 'Strong, flexible' },
  { key: 'resin', label: 'Resin', multiplier: 1.8, description: 'High detail, smooth' }
]

const COLORS = [
  { key: 'white', label: 'White', hex: '#FFFFFF' },
  { key: 'black', label: 'Black', hex: '#1a1a1a' },
  { key: 'gray', label: 'Gray', hex: '#6B7280' },
  { key: 'red', label: 'Red', hex: '#EF4444' },
  { key: 'blue', label: 'Blue', hex: '#3B82F6' },
  { key: 'green', label: 'Green', hex: '#22C55E' },
  { key: 'gold', label: 'Gold', hex: '#F59E0B' },
  { key: 'purple', label: 'Purple', hex: '#8B5CF6' }
]

export function Model3DDetailModal({
  model,
  isOpen,
  onClose,
  onRefresh
}: Model3DDetailModalProps) {
  const { addToCart } = useCart()

  const [activeTab, setActiveTab] = useState<'preview' | 'order'>('preview')
  const [isApproving, setIsApproving] = useState(false)
  const [isGenerating3D, setIsGenerating3D] = useState(false)
  const [isOrdering, setIsOrdering] = useState(false)

  // Order options
  const [selectedSize, setSelectedSize] = useState('medium')
  const [selectedMaterial, setSelectedMaterial] = useState('pla')
  const [selectedColor, setSelectedColor] = useState('white')

  if (!isOpen) return null

  const hasAllAngles = model.angle_images?.front && model.angle_images?.back &&
                       model.angle_images?.left && model.angle_images?.right
  const isReady = model.status === 'ready'
  const canGenerate3D = hasAllAngles && !['generating_3d', 'ready'].includes(model.status)

  // Calculate price
  const sizePrice = PRINT_SIZES.find(s => s.key === selectedSize)?.price || 25
  const materialMultiplier = MATERIALS.find(m => m.key === selectedMaterial)?.multiplier || 1.0
  const totalPrice = Math.round(sizePrice * materialMultiplier * 100) / 100

  const handleApprove = async () => {
    setIsApproving(true)
    try {
      await api.post(`/3d-models/${model.id}/approve`)
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
      await api.post(`/3d-models/${model.id}/generate-3d`)
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
      const response = await api.post(`/3d-models/${model.id}/order`, {
        material: selectedMaterial,
        color: selectedColor,
        size: selectedSize
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

  const handleDownload = async (format: 'glb' | 'stl') => {
    try {
      const response = await api.get(`/3d-models/${model.id}/download/${format}`)
      if (response.data?.downloadUrl) {
        window.open(response.data.downloadUrl, '_blank')
      }
    } catch (err) {
      console.error('Failed to get download URL:', err)
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

          {/* Order Tab */}
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
                {/* Size */}
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Size</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PRINT_SIZES.map(size => (
                      <button
                        key={size.key}
                        onClick={() => setSelectedSize(size.key)}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          selectedSize === size.key
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-border hover:border-purple-400/50'
                        }`}
                      >
                        <span className="block font-medium text-text">{size.label}</span>
                        <span className="text-sm text-muted">${size.price}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Material */}
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Material</label>
                  <div className="grid grid-cols-2 gap-2">
                    {MATERIALS.map(material => (
                      <button
                        key={material.key}
                        onClick={() => setSelectedMaterial(material.key)}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          selectedMaterial === material.key
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-border hover:border-purple-400/50'
                        }`}
                      >
                        <span className="block font-medium text-text">{material.label}</span>
                        <span className="text-xs text-muted">{material.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map(color => (
                      <button
                        key={color.key}
                        onClick={() => setSelectedColor(color.key)}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          selectedColor === color.key
                            ? 'border-purple-500 ring-2 ring-purple-500/30'
                            : 'border-transparent hover:border-purple-400/50'
                        }`}
                        style={{ backgroundColor: color.hex }}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                {/* Price */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                  <div className="flex items-center justify-between">
                    <span className="text-text font-medium">Total</span>
                    <span className="text-2xl font-bold text-purple-400">
                      ${totalPrice.toFixed(2)}
                    </span>
                  </div>
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

          {isReady && (
            <>
              <button
                onClick={() => handleDownload('glb')}
                className="px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium flex items-center gap-2 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>GLB</span>
              </button>
              <button
                onClick={() => handleDownload('stl')}
                className="px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 font-medium flex items-center gap-2 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>STL</span>
              </button>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Model3DDetailModal
