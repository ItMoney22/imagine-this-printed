import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import api from '../lib/api'
import { ProfileHeader } from '../components/profile/ProfileHeader'
import { ProfileEditPanel } from '../components/profile/ProfileEditPanel'
import { DesignGrid } from '../components/profile/DesignGrid'

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
  created_at: string
  social_twitter: string | null
  social_instagram: string | null
  social_tiktok: string | null
  show_designs: boolean
  show_reviews: boolean
  show_activity: boolean
  allow_messages: boolean
  is_public: boolean
}

interface Design {
  id: string
  name: string
  images: string[]
  status: string
  view_count: number
  created_at: string
  product_assets?: { url: string; kind: string; is_primary: boolean }[]
}

interface Order {
  id: string
  total: number
  status: string
  created_at: string
  order_items: { product_name: string; quantity: number }[]
}

interface Review {
  id: string
  rating: number
  comment: string
  created_at: string
  product_name?: string
  reviewer_name?: string
  type: 'written' | 'received'
}

interface ProfileStats {
  designCount: number
  salesCount: number
  totalRoyalties: number
  points: number
}

type TabType = 'overview' | 'designs' | 'orders' | 'reviews'

const UserProfilePage = () => {
  const { username } = useParams<{ username: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, wallet } = useAuth()

  const isAccountRoute = location.pathname.startsWith('/account/profile')

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [designs, setDesigns] = useState<Design[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [stats, setStats] = useState<ProfileStats>({ designCount: 0, salesCount: 0, totalRoyalties: 0, points: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [isOwnProfile, setIsOwnProfile] = useState(false)
  const [showEditPanel, setShowEditPanel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (username || isAccountRoute) {
      loadProfile()
    }
  }, [username, isAccountRoute, user])

  const loadProfile = async () => {
    setIsLoading(true)
    setError(null)

    try {
      let userId: string | undefined

      if (isAccountRoute) {
        if (!user) {
          navigate('/login')
          return
        }
        userId = user.id
      } else {
        if (!username) {
          throw new Error('Username required')
        }
        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('username', username)
          .single()

        if (!userProfile) {
          throw new Error('Profile not found')
        }
        userId = userProfile.id
      }

      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (profileError) throw profileError

      setProfile(profileData)
      const isOwn = isAccountRoute || (user && user.id === profileData.id)
      setIsOwnProfile(!!isOwn)

      // Load designs (real data from products table)
      await loadDesigns(userId, isOwn)

      // Load stats
      await loadStats(userId, isOwn)

      // Load additional data if own profile
      if (isOwn) {
        await Promise.all([
          loadOrders(userId),
          loadReviews(userId)
        ])
      }

    } catch (err: any) {
      console.error('Error loading profile:', err)
      setError(err.message || 'Failed to load profile')
      setProfile(null)
    } finally {
      setIsLoading(false)
    }
  }

  const loadDesigns = async (userId: string, isOwn?: boolean) => {
    try {
      let query = supabase
        .from('products')
        .select('id, name, images, status, view_count, created_at, product_assets(url, kind, is_primary)')
        .eq('created_by_user_id', userId)
        .order('created_at', { ascending: false })

      // Non-owners only see approved designs
      if (!isOwn) {
        query = query.in('status', ['approved', 'published'])
      }

      const { data, error } = await query

      if (error) {
        console.error('Error loading designs:', error)
        setDesigns([])
        return
      }

      setDesigns(data || [])
    } catch (err) {
      console.error('Failed to load designs:', err)
      setDesigns([])
    }
  }

  const loadStats = async (userId: string, isOwn?: boolean) => {
    try {
      // Get design count
      const { count: designCount } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('created_by_user_id', userId)

      // Get royalties from ITC transactions
      const { data: royalties } = await supabase
        .from('itc_transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('type', 'royalty')

      const totalRoyalties = royalties?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0

      // Get wallet points if own profile
      let points = 0
      if (isOwn && wallet) {
        points = wallet.points || 0
      }

      setStats({
        designCount: designCount || 0,
        salesCount: 0, // Would need order_items analysis
        totalRoyalties,
        points
      })
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  const loadOrders = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, total, status, created_at, order_items(product_name, quantity)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) {
        console.error('Error loading orders:', error)
        return
      }

      setOrders(data || [])
    } catch (err) {
      console.error('Failed to load orders:', err)
    }
  }

  const loadReviews = async (userId: string) => {
    try {
      // Get reviews written by user
      const { data: writtenReviews } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at, product:products(name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10)

      const mapped: Review[] = (writtenReviews || []).map(r => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        product_name: (r.product as any)?.name || 'Product',
        type: 'written' as const
      }))

      setReviews(mapped)
    } catch (err) {
      console.error('Failed to load reviews:', err)
    }
  }

  const handleProfileUpdated = (updatedProfile: ProfileData) => {
    setProfile(updatedProfile)
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="h-48 md:h-72 bg-gradient-to-br from-purple-900/50 to-pink-900/30 animate-pulse" />
        <div className="max-w-6xl mx-auto px-4 -mt-16 relative z-10">
          <div className="bg-card border border-white/10 rounded-2xl p-6">
            <div className="flex items-end gap-4">
              <div className="w-28 h-28 rounded-full bg-white/10 animate-pulse -mt-20" />
              <div className="flex-1 space-y-2">
                <div className="h-8 w-48 bg-white/10 rounded animate-pulse" />
                <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error / Not found state
  if (error || !profile) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center">
            <svg className="w-12 h-12 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {error === 'Profile not found' ? 'Profile Not Found' : 'Oops!'}
          </h1>
          <p className="text-muted mb-6">
            {isAccountRoute
              ? "You need to be logged in to view your profile."
              : "The profile you're looking for doesn't exist or is private."}
          </p>
          <button
            onClick={() => navigate(isAccountRoute ? '/login' : '/')}
            className="px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-500 transition-colors"
          >
            {isAccountRoute ? 'Sign In' : 'Go Home'}
          </button>
        </div>
      </div>
    )
  }

  // Map profile for header
  const headerProfile = {
    id: profile.id,
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    cover_image_url: profile.cover_image_url,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    role: profile.role,
    joined_date: profile.created_at,
    social_links: {
      twitter: profile.social_twitter || undefined,
      instagram: profile.social_instagram || undefined,
      tiktok: profile.social_tiktok || undefined
    }
  }

  // Tabs configuration
  const tabs: { id: TabType; label: string; hidden?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'designs', label: 'Designs', hidden: !profile.show_designs && !isOwnProfile },
    { id: 'orders', label: 'Orders', hidden: !isOwnProfile },
    { id: 'reviews', label: 'Reviews', hidden: !profile.show_reviews && !isOwnProfile }
  ]

  const visibleTabs = tabs.filter(t => !t.hidden)

  return (
    <div className="min-h-screen bg-bg pb-16">
      {/* Profile Header */}
      <ProfileHeader
        profile={headerProfile}
        stats={stats}
        topDesigns={designs.slice(0, 5)}
        isOwnProfile={isOwnProfile}
        onEditClick={() => setShowEditPanel(true)}
      />

      {/* Tab Navigation */}
      <div className="sticky top-16 z-20 bg-bg/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4">
          <nav className="flex gap-1 overflow-x-auto">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-muted hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-6xl mx-auto px-4 mt-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Featured Designs */}
              {designs.length > 0 && (profile.show_designs || isOwnProfile) && (
                <div className="bg-card border border-white/10 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Featured Designs</h3>
                    <button
                      onClick={() => setActiveTab('designs')}
                      className="text-sm text-purple-400 hover:text-purple-300"
                    >
                      View all
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {designs.slice(0, 3).map(design => (
                      <Link
                        key={design.id}
                        to={`/products/${design.id}`}
                        className="aspect-square rounded-lg overflow-hidden bg-white/5 group"
                      >
                        <img
                          src={design.images?.[0] || '/placeholder-design.png'}
                          alt={design.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Activity Feed (own profile with show_activity enabled) */}
              {isOwnProfile && profile.show_activity && (
                <div className="bg-card border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
                  <div className="space-y-4">
                    {designs.slice(0, 3).map(design => (
                      <div key={design.id} className="flex items-center gap-3 text-sm">
                        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                          <span>+</span>
                        </div>
                        <span className="text-muted">Created design</span>
                        <span className="text-white font-medium">{design.name || 'Untitled'}</span>
                        <span className="text-muted ml-auto">
                          {new Date(design.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                    {designs.length === 0 && (
                      <p className="text-muted text-center py-4">No recent activity</p>
                    )}
                  </div>
                </div>
              )}

              {/* Empty state for non-own profiles */}
              {!isOwnProfile && designs.length === 0 && (
                <div className="bg-card border border-white/10 rounded-xl p-12 text-center">
                  <p className="text-muted">This user hasn't created any public content yet.</p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="bg-card border border-white/10 rounded-xl p-6">
                <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">Stats</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Designs</span>
                    <span className="text-white font-medium">{stats.designCount}</span>
                  </div>
                  {isOwnProfile && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Total Earnings</span>
                        <span className="text-emerald-400 font-medium">${stats.totalRoyalties.toFixed(0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Points</span>
                        <span className="text-purple-400 font-medium">{stats.points.toLocaleString()}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Quick Links (own profile) */}
              {isOwnProfile && (
                <div className="bg-card border border-white/10 rounded-xl p-6">
                  <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">Quick Links</h3>
                  <div className="space-y-2">
                    <Link
                      to="/create-design"
                      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create New Design
                    </Link>
                    <Link
                      to="/wallet"
                      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 text-white hover:bg-white/10 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      View Wallet
                    </Link>
                    <Link
                      to="/my-designs"
                      className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 text-white hover:bg-white/10 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Design Dashboard
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Designs Tab */}
        {activeTab === 'designs' && (
          <DesignGrid
            designs={designs}
            isOwnProfile={isOwnProfile}
            showFilters={isOwnProfile}
          />
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && isOwnProfile && (
          <div className="space-y-4">
            {orders.length === 0 ? (
              <div className="bg-card border border-white/10 rounded-xl p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                  <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No orders yet</h3>
                <p className="text-muted mb-6">Start shopping to see your order history here.</p>
                <Link
                  to="/products"
                  className="inline-flex px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-500 transition-colors"
                >
                  Browse Products
                </Link>
              </div>
            ) : (
              orders.map(order => (
                <div
                  key={order.id}
                  className="bg-card border border-white/10 rounded-xl p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white font-medium">Order #{order.id.slice(0, 8)}</p>
                    <p className="text-sm text-muted">
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                    <p className="text-sm text-muted mt-1">
                      {(order.order_items || []).length} item(s)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">${order.total?.toFixed(2) || '0.00'}</p>
                    <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full ${
                      order.status === 'delivered' ? 'bg-emerald-500/20 text-emerald-300' :
                      order.status === 'shipped' ? 'bg-blue-500/20 text-blue-300' :
                      order.status === 'processing' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-gray-500/20 text-gray-300'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Reviews Tab */}
        {activeTab === 'reviews' && (
          <div className="space-y-4">
            {reviews.length === 0 ? (
              <div className="bg-card border border-white/10 rounded-xl p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                  <svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No reviews yet</h3>
                <p className="text-muted">
                  {isOwnProfile
                    ? "Reviews you write will appear here."
                    : "This user hasn't written any reviews yet."}
                </p>
              </div>
            ) : (
              reviews.map(review => (
                <div
                  key={review.id}
                  className="bg-card border border-white/10 rounded-xl p-4"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map(star => (
                            <svg
                              key={star}
                              className={`w-4 h-4 ${star <= review.rating ? 'text-yellow-400' : 'text-white/20'}`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          ))}
                        </div>
                        <span className="text-sm text-muted">
                          on {review.product_name}
                        </span>
                      </div>
                      <p className="text-white">{review.comment}</p>
                      <p className="text-xs text-muted mt-2">
                        {new Date(review.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Edit Panel */}
      {isOwnProfile && (
        <ProfileEditPanel
          isOpen={showEditPanel}
          onClose={() => setShowEditPanel(false)}
          profile={{
            ...profile,
            social_twitter: profile.social_twitter || null,
            social_instagram: profile.social_instagram || null,
            social_tiktok: profile.social_tiktok || null,
            show_designs: profile.show_designs ?? true,
            show_reviews: profile.show_reviews ?? true,
            show_activity: profile.show_activity ?? false,
            allow_messages: profile.allow_messages ?? false
          }}
          onProfileUpdated={handleProfileUpdated}
        />
      )}
    </div>
  )
}

export default UserProfilePage
