import { useState } from 'react'
import { Link } from 'react-router-dom'

interface ProfileStats {
  designCount: number
  salesCount: number
  totalRoyalties: number
  points: number
}

interface ProfileData {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  cover_image_url: string | null
  bio: string | null
  location: string | null
  website: string | null
  role: string
  joined_date: string
  social_links?: {
    twitter?: string
    instagram?: string
    tiktok?: string
  }
}

interface ProfileHeaderProps {
  profile: ProfileData
  stats: ProfileStats
  topDesigns: { images: string[] }[]
  isOwnProfile: boolean
  onEditClick: () => void
}

export function ProfileHeader({
  profile,
  stats,
  topDesigns,
  isOwnProfile,
  onEditClick
}: ProfileHeaderProps) {
  const [coverError, setCoverError] = useState(false)

  // Generate cover image - either custom, collage of designs, or role-based gradient
  const getCoverStyle = () => {
    // If user has custom cover image
    if (profile.cover_image_url && !coverError) {
      return {
        backgroundImage: `url(${profile.cover_image_url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    }

    // If user has designs, show collage-style with gradient overlay
    if (topDesigns.length > 0) {
      return {
        backgroundImage: `linear-gradient(135deg, rgba(147, 51, 234, 0.85), rgba(236, 72, 153, 0.75)),
          url(${topDesigns[0]?.images?.[0] || ''})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    }

    // Fallback: role-based gradient
    const gradients: Record<string, string> = {
      vendor: 'linear-gradient(135deg, #9333EA 0%, #EC4899 100%)',
      founder: 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)',
      admin: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
      customer: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)'
    }
    return { background: gradients[profile.role] || gradients.customer }
  }

  const getRoleBadge = () => {
    const badges: Record<string, { bg: string; text: string; label: string }> = {
      vendor: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Creator' },
      founder: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Founder' },
      admin: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Admin' },
      customer: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Member' }
    }
    return badges[profile.role] || badges.customer
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    })
  }

  const badge = getRoleBadge()

  return (
    <div className="relative">
      {/* Cover Image */}
      <div
        className="h-56 md:h-80 relative overflow-hidden"
        style={getCoverStyle()}
      >
        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        />

        {/* Design Collage Overlay (when showing multiple designs) */}
        {!profile.cover_image_url && topDesigns.length >= 3 && (
          <div className="absolute inset-0 flex">
            {topDesigns.slice(0, 5).map((design, idx) => (
              <div
                key={idx}
                className="flex-1 bg-cover bg-center opacity-20"
                style={{
                  backgroundImage: `url(${design.images?.[0] || ''})`,
                  clipPath: idx === 0 ? 'polygon(0 0, 100% 0, 80% 100%, 0 100%)' :
                            idx === topDesigns.length - 1 ? 'polygon(20% 0, 100% 0, 100% 100%, 0 100%)' :
                            'polygon(20% 0, 100% 0, 80% 100%, 0 100%)'
                }}
              />
            ))}
          </div>
        )}

        {/* Bottom gradient for transition to white */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white via-white/80 to-transparent" />

        {/* Edit Cover Button */}
        {isOwnProfile && (
          <button
            onClick={onEditClick}
            className="absolute top-4 right-4 flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-sm rounded-full text-slate-700 hover:bg-white transition-all shadow-lg group"
            title="Edit cover photo"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-medium hidden sm:inline">Edit Cover</span>
          </button>
        )}
      </div>

      {/* Profile Info Section */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-20 relative z-10">
        <div className="bg-white rounded-3xl shadow-soft-xl border border-slate-100 overflow-hidden">
          <div className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Avatar */}
              <div className="relative flex-shrink-0 -mt-24 sm:-mt-28">
                <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full border-4 border-white bg-white shadow-soft-lg overflow-hidden ring-4 ring-purple-100">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.display_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                      <span className="text-4xl sm:text-5xl text-white font-display font-bold">
                        {profile.display_name?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
                {isOwnProfile && (
                  <button
                    onClick={onEditClick}
                    className="absolute bottom-2 right-2 p-2.5 bg-primary rounded-full text-white shadow-lg hover:bg-primary-dark transition-colors"
                    title="Edit avatar"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Name & Info */}
              <div className="flex-1 min-w-0 pt-2">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 truncate">
                    {profile.display_name || profile.username}
                  </h1>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 font-body">
                  <span className="font-medium text-slate-600">@{profile.username}</span>
                  <span className="hidden sm:inline text-slate-300">•</span>
                  <span>Joined {formatDate(profile.joined_date)}</span>
                  {profile.location && (
                    <>
                      <span className="hidden sm:inline text-slate-300">•</span>
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {profile.location}
                      </span>
                    </>
                  )}
                </div>

                {profile.bio && (
                  <p className="mt-3 text-slate-600 leading-relaxed line-clamp-2 font-body">{profile.bio}</p>
                )}

                {/* Social Links */}
                <div className="flex items-center gap-4 mt-4">
                  {profile.website && (
                    <a
                      href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                      <span className="hidden sm:inline">Website</span>
                    </a>
                  )}
                  {profile.social_links?.twitter && (
                    <a
                      href={profile.social_links.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </a>
                  )}
                  {profile.social_links?.instagram && (
                    <a
                      href={profile.social_links.instagram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-pink-50 hover:text-pink-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                      </svg>
                    </a>
                  )}
                  {profile.social_links?.tiktok && (
                    <a
                      href={profile.social_links.tiktok}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                      </svg>
                    </a>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-start gap-3 pt-2 sm:pt-0">
                {isOwnProfile ? (
                  <>
                    <button
                      onClick={onEditClick}
                      className="btn-primary !px-6 !py-2.5"
                    >
                      Edit Profile
                    </button>
                    <Link
                      to="/account/settings"
                      className="p-2.5 bg-slate-100 rounded-xl text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </Link>
                  </>
                ) : (
                  <button className="btn-primary !px-6 !py-2.5">
                    Follow
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-4 border-t border-slate-100 bg-slate-50/50">
            <div className="p-4 sm:p-6 text-center border-r border-slate-100 last:border-r-0">
              <p className="text-2xl sm:text-3xl font-display font-bold text-slate-900">{stats.designCount}</p>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">Designs</p>
            </div>
            <div className="p-4 sm:p-6 text-center border-r border-slate-100 last:border-r-0">
              <p className="text-2xl sm:text-3xl font-display font-bold text-emerald-600">{stats.salesCount}</p>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">Sales</p>
            </div>
            <div className="p-4 sm:p-6 text-center border-r border-slate-100 last:border-r-0">
              <p className="text-2xl sm:text-3xl font-display font-bold text-amber-600">${stats.totalRoyalties.toFixed(0)}</p>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">Earned</p>
            </div>
            <div className="p-4 sm:p-6 text-center">
              <p className="text-2xl sm:text-3xl font-display font-bold text-purple-600">{stats.points.toLocaleString()}</p>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">Points</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
