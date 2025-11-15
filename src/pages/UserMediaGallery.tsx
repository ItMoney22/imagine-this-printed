import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'

interface MediaItem {
  id: string
  media_type: 'mockup' | 'design' | 'upload'
  file_url: string
  metadata: any
  created_at: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

const UserMediaGallery: React.FC = () => {
  const { user } = useAuth()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  })
  const [filterType, setFilterType] = useState<'all' | 'mockup' | 'design' | 'upload'>('all')
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)

  useEffect(() => {
    if (user) {
      fetchGallery()
    }
  }, [user, pagination.page, filterType])

  const fetchGallery = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(
        `/api/realistic-mockups/gallery?page=${pagination.page}&limit=${pagination.limit}&type=${filterType}`
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch gallery')
      }

      setItems(response.items)
      setPagination(response.pagination)
    } catch (err: any) {
      console.error('Gallery fetch error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (item: MediaItem) => {
    try {
      // Create a temporary link and click it
      const link = document.createElement('a')
      link.href = item.file_url
      link.download = `${item.media_type}-${item.id}.png`
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err: any) {
      alert('Download failed: ' + err.message)
    }
  }

  const handleDelete = async (itemId: string) => {
    const confirmed = window.confirm(
      'Are you sure you want to delete this item? This cannot be undone.'
    )

    if (!confirmed) return

    try {
      // TODO: Implement delete endpoint
      alert('Delete functionality will be implemented in the next update')
    } catch (err: any) {
      alert('Delete failed: ' + err.message)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text mb-4">Sign In Required</h2>
          <p className="text-muted">Please sign in to view your media gallery</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text mb-2">My Media Gallery</h1>
          <p className="text-muted">All your saved mockups and designs in one place</p>
        </div>

        {/* Filters */}
        <div className="bg-card border border-primary/30 rounded-lg p-4 mb-6">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-muted font-semibold">Filter:</span>
            <button
              onClick={() => setFilterType('all')}
              className={`px-4 py-2 rounded-lg transition-all ${
                filterType === 'all'
                  ? 'bg-primary text-white shadow-glow'
                  : 'bg-bg text-text hover:bg-primary/10'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('mockup')}
              className={`px-4 py-2 rounded-lg transition-all ${
                filterType === 'mockup'
                  ? 'bg-primary text-white shadow-glow'
                  : 'bg-bg text-text hover:bg-primary/10'
              }`}
            >
              Mockups
            </button>
            <button
              onClick={() => setFilterType('design')}
              className={`px-4 py-2 rounded-lg transition-all ${
                filterType === 'design'
                  ? 'bg-primary text-white shadow-glow'
                  : 'bg-bg text-text hover:bg-primary/10'
              }`}
            >
              Designs
            </button>
            <button
              onClick={() => setFilterType('upload')}
              className={`px-4 py-2 rounded-lg transition-all ${
                filterType === 'upload'
                  ? 'bg-primary text-white shadow-glow'
                  : 'bg-bg text-text hover:bg-primary/10'
              }`}
            >
              Uploads
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && items.length === 0 && (
          <div className="bg-card border border-primary/30 rounded-lg p-12 text-center">
            <svg className="w-24 h-24 mx-auto mb-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h3 className="text-xl font-semibold text-text mb-2">No media yet</h3>
            <p className="text-muted">
              {filterType === 'all'
                ? 'Generate your first realistic mockup to get started!'
                : `No ${filterType}s found. Try a different filter.`}
            </p>
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && items.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-card border border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-all cursor-pointer group"
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="aspect-square relative overflow-hidden bg-bg">
                    <img
                      src={item.file_url}
                      alt={item.media_type}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.src = 'https://via.placeholder.com/400?text=Image+Not+Found'
                      }}
                    />
                    <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
                      {item.media_type}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-muted">
                      {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="flex justify-center items-center space-x-2">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                  className="px-4 py-2 bg-card border border-primary/30 rounded-lg text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/10 transition-colors"
                >
                  Previous
                </button>
                <span className="text-text">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page === pagination.pages}
                  className="px-4 py-2 bg-card border border-primary/30 rounded-lg text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/10 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {/* Modal for Selected Item */}
        {selectedItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setSelectedItem(null)}
          >
            <div
              className="bg-card border-2 border-primary/30 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                {/* Modal Header */}
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-text">
                    {selectedItem.media_type.charAt(0).toUpperCase() + selectedItem.media_type.slice(1)}
                  </h3>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="p-2 hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    <svg className="w-6 h-6 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Image */}
                <div className="mb-4">
                  <img
                    src={selectedItem.file_url}
                    alt={selectedItem.media_type}
                    className="w-full rounded-lg border border-primary/20"
                    onError={(e) => {
                      e.currentTarget.src = 'https://via.placeholder.com/800?text=Image+Not+Found'
                    }}
                  />
                </div>

                {/* Metadata */}
                <div className="bg-bg p-4 rounded-lg mb-4">
                  <h4 className="text-sm font-semibold text-text mb-2">Details</h4>
                  <div className="space-y-1 text-sm text-muted">
                    <p><span className="font-semibold">Type:</span> {selectedItem.media_type}</p>
                    <p><span className="font-semibold">Created:</span> {new Date(selectedItem.created_at).toLocaleString()}</p>
                    {selectedItem.metadata && (
                      <p><span className="font-semibold">Info:</span> {JSON.stringify(selectedItem.metadata, null, 2)}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleDownload(selectedItem)}
                    className="flex-1 bg-primary hover:bg-primary/80 text-white font-semibold py-3 px-4 rounded-lg transition-all"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => handleDelete(selectedItem.id)}
                    className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default UserMediaGallery

