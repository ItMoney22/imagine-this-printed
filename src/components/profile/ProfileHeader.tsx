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
        backgroundImage: `linear-gradient(to right, rgba(88, 28, 135, 0.8), rgba(157, 23, 77, 0.8)),
          url(${topDesigns[0]?.images?.[0] || ''})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    }

    // Fallback: role-based gradient
    const gradients: Record<string, string> = {
      vendor: 'linear-gradient(135deg, #581c87 0%, #9d174d 100%)',
      founder: 'linear-gradient(135deg, #92400e 0%, #d97706 100%)',
      admin: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
      customer: 'linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)'
    }
    return { background: gradients[profile.role] || gradients.customer }
  }

  const getRoleBadgeColor = () => {
    const colors: Record<string, string> = {
      vendor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      founder: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      admin: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      customer: 'bg-gray-500/20 text-gray-300 border-gray-500/30'
    }
    return colors[profile.role] || colors.customer
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric'
    })
  }

  return (
    <div className="relative">
      {/* Cover Image */}
      <div
        className="h-48 md:h-72 relative"
        style={getCoverStyle()}
      >
        {/* Design Collage Overlay (when showing multiple designs) */}
        {!profile.cover_image_url && topDesigns.length >= 3 && (
          <div className="absolute inset-0 flex">
            {topDesigns.slice(0, 5).map((design, idx) => (
              <div
                key={idx}
                className="flex-1 bg-cover bg-center opacity-30"
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

        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Edit Cover Button */}
        {isOwnProfile && (
          <button
            onClick={onEditClick}
            className="absolute top-4 right-4 p-2 bg-black/40 backdrop-blur-sm rounded-lg text-white/80 hover:text-white hover:bg-black/60 transition-all"
            title="Edit cover photo"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {/* Profile Info Section */}
      <div className="max-w-6xl mx-auto px-4 -mt-16 relative z-10">
        <div className="bg-card border border-white/10 rounded-2xl p-6">
          <div className="flex flex-col md:flex-row md:items-end gap-4">
            {/* Avatar */}
            <div className="relative -mt-20 md:-mt-24">
              <div className="w-28 h-28 md:w-36 md:h-36 rounded-full border-4 border-card bg-card overflow-hidden">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.display_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-4xl md:text-5xl text-white font-bold">
                    {profile.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </div>
              {isOwnProfile && (
                <button
                  onClick={onEditClick}
                  className="absolute bottom-1 right-1 p-2 bg-purple-600 rounded-full text-white shadow-lg hover:bg-purple-500 transition-colors"
                  title="Edit avatar"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Name & Info */}
            <div className="flex-1">
              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-white">
                  {profile.display_name || profile.username}
                </h1>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getRoleBadgeColor()}`}>
                  {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted">
                <span>@{profile.username}</span>
                <span className="text-white/30">|</span>
                <span>Joined {formatDate(profile.joined_date)}</span>
                {profile.location && (
                  <>
                    <span className="text-white/30">|</span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {profile.location}
                    </span>
                  </>
                )}
              </div>

              {profile.bio && (
                <p className="mt-3 text-sm text-gray-300 line-clamp-2">{profile.bio}</p>
              )}

              {/* Social Links */}
              <div className="flex items-center gap-3 mt-3">
                {profile.website && (
                  <a
                    href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </a>
                )}
                {profile.social_links?.twitter && (
                  <a
                    href={profile.social_links.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                )}
                {profile.social_links?.instagram && (
                  <a
                    href={profile.social_links.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-pink-400 hover:text-pink-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </a>
                )}
                {profile.social_links?.tiktok && (
                  <a
                    href={profile.social_links.tiktok}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white hover:text-gray-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                    </svg>
                  </a>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {isOwnProfile ? (
                <>
                  <button
                    onClick={onEditClick}
                    className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-500 transition-colors"
                  >
                    Edit Profile
                  </button>
                  <Link
                    to="/account/settings"
                    className="p-2 bg-white/5 border border-white/10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </Link>
                </>
              ) : (
                <button className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-500 transition-colors">
                  Follow
                </button>
              )}
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
            <div className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-white">{stats.designCount}</p>
              <p className="text-xs md:text-sm text-muted">Designs</p>
            </div>
            <div className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-emerald-400">{stats.salesCount}</p>
              <p className="text-xs md:text-sm text-muted">Sales</p>
            </div>
            <div className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-amber-400">${stats.totalRoyalties.toFixed(0)}</p>
              <p className="text-xs md:text-sm text-muted">Earned</p>
            </div>
            <div className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-purple-400">{stats.points.toLocaleString()}</p>
              <p className="text-xs md:text-sm text-muted">Points</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
