import React, { useState, useEffect } from 'react'
import api from '../lib/api'
import { useToast } from '../hooks/useToast'

interface CreatorProduct {
  id: string
  name: string
  description: string
  price: number
  status: string
  images: string[]
  category: string
  created_at: string
  metadata: {
    creator_id: string
    original_prompt: string
    image_prompt: string
    creator_royalty_percent: number
    submitted_at: string
  }
  product_assets: Array<{
    id: string
    url: string
    kind: string
    is_primary: boolean
    display_order: number
  }>
  creator?: {
    id: string
    username: string
    email: string
  }
}

// Available shirt colors and sizes
const SHIRT_COLORS = [
  { id: 'black', name: 'Black', hex: '#1a1a1a' },
  { id: 'white', name: 'White', hex: '#ffffff' },
  { id: 'navy', name: 'Navy Blue', hex: '#1e3a5f' },
  { id: 'grey', name: 'Heather Grey', hex: '#9ca3af' },
  { id: 'red', name: 'Red', hex: '#dc2626' },
  { id: 'forest', name: 'Forest Green', hex: '#166534' },
]

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']

// Metal-art config
const METAL_SIZES = ['4x6', '8x11']
const METAL_FINISHES = ['matte', 'glossy']
const METAL_ADDONS: { id: string; name: string; price: number; printed: boolean }[] = [
  { id: 'easel_stand', name: 'Tabletop easel stand', price: 7, printed: true },
  { id: 'standoff_mount', name: 'Floating standoff wall mount', price: 10, printed: true },
  { id: 'hanging_kit', name: 'Sawtooth hanging kit', price: 5, printed: true },
  { id: 'gift_box', name: 'Gift packaging', price: 5, printed: false },
]

// 3D-art config
const TIER_3D = ['mini', 'small', 'medium', 'large']
const COLOR_MODES_3D: { id: string; name: string }[] = [
  { id: 'grey', name: 'Grey PLA' },
  { id: 'color4', name: 'Full color' },
]

type ProductKind = 'apparel' | 'metal' | '3d'

/** Infer the product type from its category / metadata so we show the right config. */
function productKind(p: { category?: string; metadata?: any }): ProductKind {
  const c = (p.category || '').toLowerCase()
  const t = (p.metadata?.product_template || '').toString().toLowerCase()
  if (c.includes('metal') || t.includes('metal')) return 'metal'
  if (c.includes('3d') || c.includes('print3d') || t.includes('3d') || t.includes('toy')) return '3d'
  return 'apparel'
}

/** Which expected generations are missing (mirrors the backend approve gate).
 *  A design with any missing gens is saved as 'incomplete' (off the products tab). */
function missingGenerations(p: { category?: string; metadata?: any; images?: string[] }): string[] {
  const kind = productKind(p)
  const meta: any = p.metadata || {}
  const assets = meta.assets && typeof meta.assets === 'object' ? meta.assets : {}
  const hasMockup = !!(meta.mockup_url || (Array.isArray(assets.mockups) && assets.mockups.length))
  const missing: string[] = []
  if (!assets.clean && !(Array.isArray(p.images) && p.images.length)) missing.push('clean design')
  if (!hasMockup) missing.push('mockup')
  if (kind === 'apparel') {
    if (!assets.halftone) missing.push('halftone')
    if (!assets.dtf) missing.push('DTF')
  }
  return missing
}

interface ApprovalConfig {
  name: string
  price: number
  colors: string[]   // apparel
  sizes: string[]    // apparel sizes OR metal sizes
  finish: string     // metal
  addons: string[]   // metal add-on ids
  colorMode: string  // 3d
}

export const AdminCreatorProductsTab: React.FC = () => {
  const toast = useToast()
  const [products, setProducts] = useState<CreatorProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null)
  const [showApproveModal, setShowApproveModal] = useState<string | null>(null)
  const [approvalKind, setApprovalKind] = useState<ProductKind>('apparel')
  const [approvalConfig, setApprovalConfig] = useState<ApprovalConfig>({
    name: '', price: 25, colors: ['black', 'white'], sizes: ['S', 'M', 'L', 'XL'], finish: 'glossy', addons: [], colorMode: 'grey',
  })

  useEffect(() => {
    loadPendingProducts()
  }, [])

  const loadPendingProducts = async () => {
    try {
      setLoading(true)
      const response = await api.get('/api/admin/user-products/pending')
      setProducts(response.data.products || [])
      setError(null)
    } catch (err: any) {
      console.error('Failed to load pending products:', err)
      setError(err.message || 'Failed to load pending products')
    } finally {
      setLoading(false)
    }
  }

  const openApproveModal = (product: CreatorProduct) => {
    const kind = productKind(product)
    setApprovalKind(kind)
    // products.price is dollars already; default per type.
    const defaultPrice = product.price && product.price > 0
      ? product.price
      : kind === 'metal' ? 29.99 : kind === '3d' ? 18.99 : 25
    setApprovalConfig({
      name: product.name || '',
      price: defaultPrice,
      colors: kind === 'apparel' ? ['black', 'white'] : [],
      sizes: kind === 'metal' ? ['4x6', '8x11'] : kind === '3d' ? ['small'] : ['S', 'M', 'L', 'XL'],
      finish: 'glossy',
      addons: [],
      colorMode: 'grey',
    })
    setShowApproveModal(product.id)
  }

  const toggleColor = (colorId: string) => {
    setApprovalConfig(prev => ({
      ...prev,
      colors: prev.colors.includes(colorId) ? prev.colors.filter(c => c !== colorId) : [...prev.colors, colorId]
    }))
  }

  const toggleSize = (size: string) => {
    setApprovalConfig(prev => ({
      ...prev,
      sizes: prev.sizes.includes(size) ? prev.sizes.filter(s => s !== size) : [...prev.sizes, size]
    }))
  }

  const toggleAddon = (addonId: string) => {
    setApprovalConfig(prev => ({
      ...prev,
      addons: prev.addons.includes(addonId) ? prev.addons.filter(a => a !== addonId) : [...prev.addons, addonId]
    }))
  }

  const handleApprove = async (productId: string) => {
    try {
      setActionLoading(productId)
      const payload: any = { name: approvalConfig.name, price: approvalConfig.price }
      if (approvalKind === 'apparel') {
        payload.colors = approvalConfig.colors
        payload.sizes = approvalConfig.sizes
      } else if (approvalKind === 'metal') {
        payload.sizes = approvalConfig.sizes
        payload.finish = approvalConfig.finish
        payload.addons = approvalConfig.addons
      } else {
        payload.sizes = approvalConfig.sizes
        payload.colorMode = approvalConfig.colorMode
      }
      const { data } = await api.post(`/api/admin/user-products/${productId}/approve`, payload)
      setProducts(products.filter(p => p.id !== productId))
      setShowApproveModal(null)
      // Backend gates incomplete designs to status 'incomplete' (off the
      // products tab) and returns what's missing — surface that to the admin.
      if (data?.status === 'incomplete') {
        toast.warning('Saved as incomplete', data?.message || 'Missing generations — won\'t show on storefront yet.', 8000)
      } else {
        toast.success('Product approved', data?.message || 'Creator has been notified.')
      }
    } catch (err: any) {
      console.error('Failed to approve product:', err)
      toast.error('Failed to approve', err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (productId: string) => {
    try {
      setActionLoading(productId)
      await api.post(`/api/admin/user-products/${productId}/reject`, {
        reason: rejectReason || 'Does not meet quality standards'
      })
      setProducts(products.filter(p => p.id !== productId))
      setShowRejectModal(null)
      setRejectReason('')
      toast.success('Product rejected', 'Creator has been notified.')
    } catch (err: any) {
      console.error('Failed to reject product:', err)
      toast.error('Failed to reject', err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const getMainImage = (product: CreatorProduct): string => {
    const primaryAsset = product.product_assets?.find(a => a.is_primary)
    if (primaryAsset?.url) return primaryAsset.url
    const designAsset = product.product_assets?.find(a => a.kind === 'design')
    if (designAsset?.url) return designAsset.url
    return product.images?.[0] || '/placeholder-product.png'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
        <span className="ml-3 text-muted">Loading creator products...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-600">{error}</p>
        <button
          onClick={loadPendingProducts}
          className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text">Creator Products</h2>
          <p className="text-sm text-muted">
            User-submitted designs pending approval ({products.length} pending)
          </p>
        </div>
        <button
          onClick={loadPendingProducts}
          className="px-4 py-2 bg-card hover:bg-gray-100 border border-gray-200 rounded-lg text-sm"
        >
          Refresh
        </button>
      </div>

      {products.length === 0 ? (
        <div className="bg-card rounded-lg shadow p-12 text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-medium text-text">All caught up!</h3>
          <p className="text-muted">No creator products pending approval.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {products.map((product) => (
            <div key={product.id} className="bg-card rounded-lg shadow overflow-hidden">
              <div className="md:flex">
                {/* Product Image */}
                <div className="md:w-64 h-64 md:h-auto flex-shrink-0">
                  <img
                    src={getMainImage(product)}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Product Details */}
                <div className="p-6 flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-text">{product.name}</h3>
                      <p className="text-sm text-muted">{product.category}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Pending Review
                      </span>
                      {(() => {
                        const missing = missingGenerations(product)
                        return missing.length === 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            ✓ All generations ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800" title="Approving now will save as INCOMPLETE (off the products tab)">
                            Incomplete — missing: {missing.join(', ')}
                          </span>
                        )
                      })()}
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-text">{product.description}</p>

                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted">Price:</span>
                      <span className="ml-2 font-medium text-text">${product.price?.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted">Creator Royalty:</span>
                      <span className="ml-2 font-medium text-green-600">
                        {product.metadata?.creator_royalty_percent || 15}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Creator:</span>
                      <span className="ml-2 font-medium text-text">
                        {product.creator?.username || product.creator?.email || 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Submitted:</span>
                      <span className="ml-2 text-text">
                        {new Date(product.metadata?.submitted_at || product.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Original Prompt */}
                  {product.metadata?.original_prompt && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-muted mb-1">Original Prompt:</p>
                      <p className="text-sm text-text italic">"{product.metadata.original_prompt}"</p>
                    </div>
                  )}

                  {/* All Assets */}
                  {product.product_assets && product.product_assets.length > 1 && (
                    <div className="mt-4">
                      <p className="text-xs text-muted mb-2">All images ({product.product_assets.length}):</p>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {product.product_assets.map((asset) => (
                          <img
                            key={asset.id}
                            src={asset.url}
                            alt={asset.kind}
                            className="w-16 h-16 object-cover rounded border border-gray-200"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={() => openApproveModal(product)}
                      disabled={actionLoading === product.id}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-lg font-medium transition-colors"
                    >
                      Configure &amp; Approve
                    </button>
                    <button
                      onClick={() => setShowRejectModal(product.id)}
                      disabled={actionLoading === product.id}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg font-medium transition-colors"
                    >
                      ✗ Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-text mb-4">Reject Product</h3>
            <p className="text-sm text-muted mb-4">
              Please provide a reason for rejection. This will be sent to the creator.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full p-3 border border-gray-300 rounded-lg text-sm"
              rows={4}
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={actionLoading === showRejectModal}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg font-medium"
              >
                {actionLoading === showRejectModal ? 'Rejecting...' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => {
                  setShowRejectModal(null)
                  setRejectReason('')
                }}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal with Color/Size Configuration */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-text mb-4">Configure & Approve Product</h3>
            <p className="text-sm text-muted mb-1">
              {approvalKind === 'metal' ? 'Metal wall art' : approvalKind === '3d' ? '3D print' : 'Apparel'} — set the details before approving.
            </p>
            <p className="text-xs text-muted mb-6">Mr. Imagine already wrote the title &amp; description — tweak if you like.</p>

            {/* Title (AI-generated, editable) */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-text mb-2">Title</label>
              <input
                type="text"
                value={approvalConfig.name}
                onChange={(e) => setApprovalConfig(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Price */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-text mb-2">Price ($)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={approvalConfig.price}
                onChange={(e) => setApprovalConfig(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* APPAREL — colors + sizes */}
            {approvalKind === 'apparel' && (
              <>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Available Colors ({approvalConfig.colors.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {SHIRT_COLORS.map(color => (
                      <button key={color.id} onClick={() => toggleColor(color.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${approvalConfig.colors.includes(color.id) ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <span className="w-5 h-5 rounded-full border border-gray-300" style={{ backgroundColor: color.hex }} />
                        <span className="text-sm text-text">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Available Sizes ({approvalConfig.sizes.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {SHIRT_SIZES.map(size => (
                      <button key={size} onClick={() => toggleSize(size)}
                        className={`px-4 py-2 rounded-lg border-2 transition-all text-sm font-medium ${approvalConfig.sizes.includes(size) ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-gray-300 text-text'}`}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* METAL — sizes + finish + add-ons */}
            {approvalKind === 'metal' && (
              <>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Available Sizes ({approvalConfig.sizes.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {METAL_SIZES.map(size => (
                      <button key={size} onClick={() => toggleSize(size)}
                        className={`px-4 py-2 rounded-lg border-2 transition-all text-sm font-medium ${approvalConfig.sizes.includes(size) ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-gray-300 text-text'}`}>
                        {size}"
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Finish</label>
                  <div className="flex gap-2">
                    {METAL_FINISHES.map(f => (
                      <button key={f} onClick={() => setApprovalConfig(prev => ({ ...prev, finish: f }))}
                        className={`px-4 py-2 rounded-lg border-2 capitalize text-sm font-medium ${approvalConfig.finish === f ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-gray-300 text-text'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Add-ons ({approvalConfig.addons.length})</label>
                  <div className="space-y-2">
                    {METAL_ADDONS.map(a => (
                      <button key={a.id} onClick={() => toggleAddon(a.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border-2 text-left transition-all ${approvalConfig.addons.includes(a.id) ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <span className="text-sm text-text">{a.name}{a.printed && <span className="text-xs text-purple-500"> · 3D-printed</span>}</span>
                        <span className="text-sm font-medium text-text">+${a.price}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 3D — size tier + color mode */}
            {approvalKind === '3d' && (
              <>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Available Sizes ({approvalConfig.sizes.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {TIER_3D.map(size => (
                      <button key={size} onClick={() => toggleSize(size)}
                        className={`px-4 py-2 rounded-lg border-2 capitalize transition-all text-sm font-medium ${approvalConfig.sizes.includes(size) ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-gray-300 text-text'}`}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-text mb-2">Color mode</label>
                  <div className="flex gap-2">
                    {COLOR_MODES_3D.map(m => (
                      <button key={m.id} onClick={() => setApprovalConfig(prev => ({ ...prev, colorMode: m.id }))}
                        className={`px-4 py-2 rounded-lg border-2 text-sm font-medium ${approvalConfig.colorMode === m.id ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-gray-300 text-text'}`}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Validation */}
            {((approvalKind === 'apparel' && (approvalConfig.colors.length === 0 || approvalConfig.sizes.length === 0)) || (approvalKind !== 'apparel' && approvalConfig.sizes.length === 0)) && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-700">
                  {approvalKind === 'apparel' ? 'Select at least one color and one size.' : 'Select at least one size.'}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleApprove(showApproveModal)}
                disabled={actionLoading === showApproveModal || (approvalKind === 'apparel' ? (approvalConfig.colors.length === 0 || approvalConfig.sizes.length === 0) : approvalConfig.sizes.length === 0)}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-lg font-medium"
              >
                {actionLoading === showApproveModal ? 'Approving...' : 'Approve Product'}
              </button>
              <button
                onClick={() => setShowApproveModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminCreatorProductsTab
