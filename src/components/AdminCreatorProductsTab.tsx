import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

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

export const AdminCreatorProductsTab: React.FC = () => {
  const [products, setProducts] = useState<CreatorProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null)

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

  const handleApprove = async (productId: string) => {
    try {
      setActionLoading(productId)
      await api.post(`/api/admin/user-products/${productId}/approve`)
      setProducts(products.filter(p => p.id !== productId))
      alert('Product approved! Creator has been notified.')
    } catch (err: any) {
      console.error('Failed to approve product:', err)
      alert(`Failed to approve: ${err.message}`)
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
      alert('Product rejected. Creator has been notified.')
    } catch (err: any) {
      console.error('Failed to reject product:', err)
      alert(`Failed to reject: ${err.message}`)
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
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      Pending Review
                    </span>
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
                        {product.metadata?.creator_royalty_percent || 10}%
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
                      onClick={() => handleApprove(product.id)}
                      disabled={actionLoading === product.id}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-lg font-medium transition-colors"
                    >
                      {actionLoading === product.id ? 'Processing...' : '✓ Approve'}
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
    </div>
  )
}

export default AdminCreatorProductsTab
