import { useState } from 'react'
import { Link } from 'react-router-dom'

interface Design {
  id: string
  name: string
  images: string[]
  status: string
  view_count: number
  created_at: string
  product_assets?: { url: string; kind: string; is_primary: boolean }[]
}

interface DesignGridProps {
  designs: Design[]
  isOwnProfile: boolean
  showFilters?: boolean
}

type FilterType = 'all' | 'approved' | 'pending' | 'draft'

export function DesignGrid({ designs, isOwnProfile, showFilters = true }: DesignGridProps) {
  const [filter, setFilter] = useState<FilterType>('all')

  const filteredDesigns = designs.filter(design => {
    if (filter === 'all') return true
    if (filter === 'approved') return design.status === 'approved' || design.status === 'published'
    if (filter === 'pending') return design.status === 'pending_approval' || design.status === 'pending'
    if (filter === 'draft') return design.status === 'draft'
    return true
  })

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; label: string }> = {
      approved: { color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', label: 'Approved' },
      published: { color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', label: 'Published' },
      pending_approval: { color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', label: 'Pending' },
      pending: { color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', label: 'Pending' },
      draft: { color: 'bg-gray-500/20 text-gray-300 border-gray-500/30', label: 'Draft' },
      rejected: { color: 'bg-red-500/20 text-red-300 border-red-500/30', label: 'Rejected' }
    }
    return badges[status] || badges.draft
  }

  const getDesignImage = (design: Design) => {
    // Check product_assets first (if available from joined query)
    const primaryAsset = design.product_assets?.find(a => a.is_primary)
    if (primaryAsset?.url) return primaryAsset.url

    // Fall back to images array
    if (design.images?.length > 0) return design.images[0]

    // Placeholder
    return '/placeholder-design.png'
  }

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'approved', label: 'Approved' },
    { key: 'pending', label: 'Pending' },
    ...(isOwnProfile ? [{ key: 'draft' as FilterType, label: 'Drafts' }] : [])
  ]

  if (designs.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
          <svg className="w-10 h-10 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-white mb-2">No designs yet</h3>
        <p className="text-muted mb-6">
          {isOwnProfile
            ? "Start creating your first design!"
            : "This user hasn't created any designs yet."}
        </p>
        {isOwnProfile && (
          <Link
            to="/create-design"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Design
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filter Pills */}
      {showFilters && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                filter === f.key
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/5 text-muted hover:bg-white/10 hover:text-white'
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">
                ({designs.filter(d => {
                  if (f.key === 'all') return true
                  if (f.key === 'approved') return d.status === 'approved' || d.status === 'published'
                  if (f.key === 'pending') return d.status === 'pending_approval' || d.status === 'pending'
                  if (f.key === 'draft') return d.status === 'draft'
                  return false
                }).length})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Design Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredDesigns.map(design => {
          const badge = getStatusBadge(design.status)
          return (
            <Link
              key={design.id}
              to={isOwnProfile ? `/my-designs` : `/products/${design.id}`}
              className="group block bg-card rounded-xl overflow-hidden border border-white/5 hover:border-purple-500/30 transition-all"
            >
              {/* Image */}
              <div className="aspect-square relative overflow-hidden">
                <img
                  src={getDesignImage(design)}
                  alt={design.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/placeholder-design.png'
                  }}
                />

                {/* Status Badge (own profile only) */}
                {isOwnProfile && (
                  <span className={`absolute top-2 left-2 px-2 py-1 text-xs font-medium rounded-full border ${badge.color}`}>
                    {badge.label}
                  </span>
                )}

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white font-medium">View Design</span>
                </div>
              </div>

              {/* Info */}
              <div className="p-3">
                <h4 className="text-sm font-medium text-white truncate">{design.name || 'Untitled Design'}</h4>
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-center gap-1 text-xs text-muted">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {design.view_count || 0}
                  </div>
                  <span className="text-xs text-muted">
                    {new Date(design.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {filteredDesigns.length === 0 && filter !== 'all' && (
        <div className="text-center py-8 text-muted">
          No {filter} designs found
        </div>
      )}
    </div>
  )
}
