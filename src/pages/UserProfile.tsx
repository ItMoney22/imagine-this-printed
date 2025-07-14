import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../utils/supabase'
import type { UserProfile, Order, Product, ThreeDModel } from '../types'

const UserProfilePage: React.FC = () => {
  const { username } = useParams<{ username: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAccountRoute = location.pathname.startsWith('/account/profile')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [designs, setDesigns] = useState<Product[]>([])
  const [models, setModels] = useState<ThreeDModel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'designs' | 'models'>('overview')
  const [isOwnProfile, setIsOwnProfile] = useState(false)

  useEffect(() => {
    if (username || isAccountRoute) {
      loadUserProfile()
    }
  }, [username, isAccountRoute, user])

  const loadUserProfile = async () => {
    setIsLoading(true)
    try {
      // Ensure we have the current user info
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      
      // Determine which profile to load
      let targetUserId = null
      let targetUsername = null
      
      if (isAccountRoute) {
        // For account route, use current user's ID
        if (!currentUser) {
          throw new Error('User not authenticated')
        }
        targetUserId = currentUser.id
        targetUsername = currentUser.email?.split('@')[0] || 'current-user'
      } else {
        // For public profile, load by username
        targetUsername = username
      }

      let profileData = null
      
      // Load profile from database
      if (targetUserId) {
        // Load by user_id for account route
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', targetUserId)
          .single()
        
        if (error && error.code !== 'PGRST116') {
          throw error
        }
        profileData = data
      } else if (targetUsername) {
        // Load by username for public profile
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('username', targetUsername)
          .single()
        
        if (error && error.code !== 'PGRST116') {
          throw error
        }
        profileData = data
      }

      // If profile doesn't exist and this is account route, create default one
      if (!profileData && isAccountRoute && currentUser) {
        const defaultProfile = {
          user_id: currentUser.id,
          username: targetUsername,
          display_name: (currentUser as any).firstName ? `${(currentUser as any).firstName} ${(currentUser as any).lastName || ''}`.trim() : 'User',
          bio: '',
          profile_image: null,
          location: '',
          website: '',
          social_links: {},
          is_public: true,
          show_order_history: false,
          show_designs: true,
          show_models: true,
          joined_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        const { data: newProfile, error: createError } = await supabase
          .from('user_profiles')
          .insert([defaultProfile])
          .select()
          .single()

        if (createError) throw createError
        profileData = newProfile
      }

      if (profileData) {
        // Load additional stats
        const { data: orderStats } = await supabase
          .from('orders')
          .select('total_amount')
          .eq('user_id', profileData.user_id)

        const totalOrders = orderStats?.length || 0
        const totalSpent = orderStats?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0

        const userProfile: UserProfile = {
          id: profileData.id,
          userId: profileData.user_id,
          username: profileData.username,
          displayName: profileData.display_name,
          bio: profileData.bio || '',
          profileImage: profileData.profile_image || null,
          location: profileData.location || '',
          website: profileData.website || '',
          socialLinks: profileData.social_links || {},
          isPublic: profileData.is_public,
          showOrderHistory: profileData.show_order_history,
          showDesigns: profileData.show_designs,
          showModels: profileData.show_models,
          joinedDate: profileData.joined_date,
          totalOrders,
          totalSpent,
          favoriteCategories: [],
          badges: []
        }

        setProfile(userProfile)
        
        // Check if this is the current user's profile
        const isOwn = isAccountRoute || (currentUser && currentUser.id === profileData.user_id)
        setIsOwnProfile(isOwn || false)

        // Load additional data if profile allows it
        if (userProfile.showOrderHistory || isOwn) {
          loadOrders()
        }
        if (userProfile.showDesigns || isOwn) {
          loadDesigns()
        }
        if (userProfile.showModels || isOwn) {
          loadModels()
        }
      } else {
        // No profile found
        setProfile(null)
        setIsOwnProfile(false)
      }
    } catch (error) {
      console.error('Error loading profile:', error)
      setProfile(null)
      setIsOwnProfile(false)
    } finally {
      setIsLoading(false)
    }
  }

  const loadOrders = async () => {
    // Mock orders data
    const mockOrders: Order[] = [
      {
        id: 'order_1',
        userId: 'user_1',
        items: [],
        total: 89.99,
        status: 'delivered',
        createdAt: '2025-01-10T10:30:00Z'
      },
      {
        id: 'order_2',
        userId: 'user_1',
        items: [],
        total: 156.50,
        status: 'shipped',
        createdAt: '2025-01-05T14:20:00Z'
      }
    ]
    setOrders(mockOrders)
  }

  const loadDesigns = async () => {
    // Mock designs data
    const mockDesigns: Product[] = [
      {
        id: 'design_1',
        name: 'Retro Gaming Tee',
        description: 'Custom retro gaming design for t-shirts',
        price: 25.99,
        images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop'],
        category: 'shirts',
        inStock: true
      },
      {
        id: 'design_2',
        name: 'Mountain Adventure Logo',
        description: 'Outdoor adventure logo design for DTF transfers',
        price: 12.99,
        images: ['https://images.unsplash.com/photo-1503341338985-95ad5e163e51?w=400&h=400&fit=crop'],
        category: 'dtf-transfers',
        inStock: true
      }
    ]
    setDesigns(mockDesigns)
  }

  const loadModels = async () => {
    // Mock 3D models data
    const mockModels: ThreeDModel[] = [
      {
        id: 'model_1',
        title: 'Custom Phone Stand',
        description: 'Adjustable phone stand for desk use',
        fileUrl: '/models/phone-stand.stl',
        category: 'functional',
        uploadedBy: 'user_1',
        approved: true,
        votes: 15,
        points: 150,
        createdAt: '2025-01-01T00:00:00Z',
        fileType: 'stl'
      },
      {
        id: 'model_2',
        title: 'Decorative Vase',
        description: 'Modern geometric vase design',
        fileUrl: '/models/vase.stl',
        category: 'decorative',
        uploadedBy: 'user_1',
        approved: true,
        votes: 23,
        points: 230,
        createdAt: '2024-12-15T00:00:00Z',
        fileType: 'stl'
      }
    ]
    setModels(mockModels)
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <div className="bg-white rounded-lg shadow p-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">No Profile Found</h1>
            <p className="text-gray-600 mb-6">
              {isAccountRoute 
                ? "It looks like you don't have a profile set up yet. One will be created automatically when you sign up."
                : "The user profile you're looking for doesn't exist or is private."
              }
            </p>
            <button 
              onClick={() => navigate(isAccountRoute ? '/signup' : '/')}
              className="btn-primary"
            >
              {isAccountRoute ? 'Create Account' : 'Go Home'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Profile Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-6">
            <img
              src={profile.profileImage || 'https://via.placeholder.com/120x120?text=Profile'}
              alt={profile.displayName}
              className="w-24 h-24 rounded-full object-cover"
            />
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <h1 className="text-2xl font-bold text-gray-900">{profile.displayName}</h1>
                {isOwnProfile && (
                  <button
                    onClick={() => navigate('/account/profile/edit')}
                    className="text-purple-600 hover:text-purple-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
              <p className="text-gray-600 text-sm mb-1">@{profile.username}</p>
              {profile.location && (
                <p className="text-gray-500 text-sm mb-3 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  {profile.location}
                </p>
              )}
              {profile.bio && (
                <p className="text-gray-700 mb-4">{profile.bio}</p>
              )}
              
              {/* Social Links */}
              <div className="flex items-center space-x-3">
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                    </svg>
                  </a>
                )}
                {profile.socialLinks.twitter && (
                  <a
                    href={profile.socialLinks.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-600"
                  >
                    🐦
                  </a>
                )}
                {profile.socialLinks.instagram && (
                  <a
                    href={profile.socialLinks.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-pink-500 hover:text-pink-600"
                  >
                    📷
                  </a>
                )}
                {profile.socialLinks.linkedin && (
                  <a
                    href={profile.socialLinks.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 hover:text-blue-800"
                  >
                    💼
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="text-right">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-purple-600">{profile.totalOrders}</p>
                <p className="text-sm text-gray-500">Orders</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">${profile.totalSpent.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Spent</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Joined {new Date(profile.joinedDate).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Badges */}
        {profile.badges.length > 0 && (
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Achievements</h3>
            <div className="flex flex-wrap gap-3">
              {profile.badges.map((badge) => (
                <div
                  key={badge.id}
                  className="flex items-center space-x-2 bg-gray-100 rounded-full px-3 py-1"
                  title={badge.description}
                >
                  <span className="text-lg">{badge.icon}</span>
                  <span className="text-sm font-medium text-gray-700">{badge.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'orders', label: 'Orders', icon: '📦', hidden: !profile.showOrderHistory && !isOwnProfile },
            { id: 'designs', label: 'Designs', icon: '🎨', hidden: !profile.showDesigns && !isOwnProfile },
            { id: 'models', label: '3D Models', icon: '🔳', hidden: !profile.showModels && !isOwnProfile }
          ].filter(tab => !tab.hidden).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Activity Overview</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{designs.length}</div>
                <div className="text-sm text-gray-500">Designs Created</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{models.length}</div>
                <div className="text-sm text-gray-500">3D Models</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600">{profile.badges.length}</div>
                <div className="text-sm text-gray-500">Badges Earned</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Favorite Categories</h3>
            <div className="flex flex-wrap gap-2">
              {profile.favoriteCategories.map((category) => (
                <span
                  key={category}
                  className="bg-purple-100 text-purple-800 text-sm px-3 py-1 rounded-full"
                >
                  {category}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Order History</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {orders.map((order) => (
              <div key={order.id} className="p-6 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Order #{order.id}</p>
                  <p className="text-sm text-gray-500">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">${order.total}</p>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                    order.status === 'shipped' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'designs' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {designs.map((design) => (
            <div key={design.id} className="bg-white rounded-lg shadow overflow-hidden">
              <img
                src={design.images[0]}
                alt={design.name}
                className="w-full h-48 object-cover"
              />
              <div className="p-4">
                <h3 className="font-medium text-gray-900 mb-1">{design.name}</h3>
                <p className="text-sm text-gray-600 mb-2">{design.description}</p>
                <p className="text-lg font-bold text-purple-600">${design.price}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'models' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {models.map((model) => (
            <div key={model.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-center h-32 bg-gray-100 rounded-lg mb-4">
                <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 mb-2">{model.title}</h3>
              <p className="text-sm text-gray-600 mb-3">{model.description}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded">
                  {model.category}
                </span>
                <div className="flex items-center space-x-3">
                  <span className="text-gray-500">👍 {model.votes}</span>
                  <span className="text-purple-600">⭐ {model.points}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default UserProfilePage