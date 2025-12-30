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
  type?: 'product' | 'imagination_sheet'
  preview_url?: string
  print_type?: string
}

interface DesignGridProps {
  designs: Design[]
  isOwnProfile: boolean
  showFilters?: boolean
}

type FilterType = 'all' | 'approved' | 'pending' | 'draft' | 'sheets'

export function DesignGrid({ designs, isOwnProfile, showFilters = true }: DesignGridProps) {
  const [filter, setFilter] = useState<FilterType>('all')

  const filteredDesigns = designs.filter(design => {
    if (filter === 'all') return true
    if (filter === 'sheets') return design.type === 'imagination_sheet'
    if (filter === 'approved') return design.status === 'approved' || design.status === 'published'
    if (filter === 'pending') return design.status === 'pending_approval' || design.status === 'pending'
    if (filter === 'draft') return design.status === 'draft'
    return true
  })

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; text: string; label: string }> = {
      approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
      published: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Live' },
      pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending' },
      pending: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending' },
      draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
      rejected: { bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected' }
    }
    return badges[status] || badges.draft
  }

  const getDesignImage = (design: Design) => {
    // For imagination sheets, use preview_url
    if (design.type === 'imagination_sheet' && design.preview_url) {
      return design.preview_url
    }

    // Check product_assets first (if available from joined query)
    const primaryAsset = design.product_assets?.find(a => a.is_primary)
    if (primaryAsset?.url) return primaryAsset.url

    // Fall back to images array
    if (design.images?.length > 0) return design.images[0]

    // Placeholder
    return '/placeholder-design.png'
  }

  const getDesignLink = (design: Design) => {
    if (design.type === 'imagination_sheet') {
      return `/imagination-station/${design.id}`
    }
    return isOwnProfile ? `/my-designs` : `/products/${design.id}`
  }

  const getDesignTypeBadge = (design: Design) => {
    if (design.type === 'imagination_sheet') {
      const printTypeLabels: Record<string, string> = {
        'dtf': 'DTF',
        'uv_dtf': 'UV DTF',
        'sublimation': 'Sublimation'
      }
      return printTypeLabels[design.print_type || ''] || 'Sheet'
    }
    return null
  }

  const hasSheets = designs.some(d => d.type === 'imagination_sheet')

  const filters: { key: FilterType; label: string; icon?: string }[] = [
    { key: 'all', label: 'All' },
    ...(isOwnProfile && hasSheets ? [{ key: 'sheets' as FilterType, label: 'My Sheets' }] : []),
    { key: 'approved', label: 'Approved' },
    { key: 'pending', label: 'Pending' },
    ...(isOwnProfile ? [{ key: 'draft' as FilterType, label: 'Drafts' }] : [])
  ]

  if (designs.length === 0) {
    return (
      <div className="text-center py-20 px-4">
        <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
          <svg className="w-12 h-12 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-xl font-display font-bold text-slate-900 mb-2">No designs yet</h3>
        <p className="text-slate-500 mb-8 max-w-sm mx-auto">
          {isOwnProfile
            ? "Start creating your first design and bring your ideas to life!"
            : "This user hasn't created any designs yet."}
        </p>
        {isOwnProfile && (
          <Link
            to="/create-design"
            className="btn-primary"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Your First Design
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
          {filters.map(f => {
            const count = designs.filter(d => {
              if (f.key === 'all') return true
              if (f.key === 'sheets') return d.type === 'imagination_sheet'
              if (f.key === 'approved') return d.status === 'approved' || d.status === 'published'
              if (f.key === 'pending') return d.status === 'pending_approval' || d.status === 'pending'
              if (f.key === 'draft') return d.status === 'draft'
              return false
            }).length

            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  filter === f.key
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-purple-200 hover:bg-purple-50'
                }`}
              >
                {f.label}
                <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                  filter === f.key ? 'bg-white/20' : 'bg-slate-100'
                }`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Design Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
        {filteredDesigns.map((design, idx) => {
          const badge = getStatusBadge(design.status)
          const typeBadge = getDesignTypeBadge(design)
          return (
            <Link
              key={design.id}
              to={getDesignLink(design)}
              className="group block bg-white rounded-2xl overflow-hidden border border-slate-100 hover:border-purple-200 hover:shadow-soft-lg transition-all duration-300"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              {/* Image */}
              <div className="aspect-square relative overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100">
                <img
                  src={getDesignImage(design)}
                  alt={design.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/placeholder-design.png'
                  }}
                />

                {/* Status Badge (own profile only) */}
                {isOwnProfile && (
                  <span className={`absolute top-3 left-3 px-2.5 py-1 text-xs font-semibold rounded-full ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                )}

                {/* Type Badge for imagination sheets */}
                {typeBadge && (
                  <span className="absolute top-3 right-3 px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700">
                    {typeBadge}
                  </span>
                )}

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-center pb-6">
                  <span className="px-4 py-2 bg-white rounded-full text-sm font-medium text-slate-900 shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                    {design.type === 'imagination_sheet' ? 'Edit Sheet' : 'View Design'}
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <h4 className="text-sm font-semibold text-slate-900 truncate group-hover:text-purple-600 transition-colors">
                  {design.name || 'Untitled Design'}
                </h4>
                <div className="flex items-center justify-between mt-2">
                  {design.type === 'imagination_sheet' ? (
                    <div className="flex items-center gap-1.5 text-xs text-purple-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <span>Sheet</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span>{design.view_count || 0}</span>
                    </div>
                  )}
                  <span className="text-xs text-slate-400">
                    {new Date(design.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {filteredDesigns.length === 0 && filter !== 'all' && (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-slate-500">No {filter} designs found</p>
          <button
            onClick={() => setFilter('all')}
            className="mt-3 text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            View all designs
          </button>
        </div>
      )}
    </div>
  )
}
