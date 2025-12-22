import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { CreateDesignModal } from '../components/CreateDesignModal'

interface UserDesign {
  id: string
  name: string
  description: string
  images: string[]
  status: string
  view_count: number
  created_at: string
  metadata: {
    creator_id?: string
    original_prompt?: string
    image_prompt?: string
    product_type?: string
    shirt_color?: string
  }
}

interface DesignSession {
  id: string
  status: string
  prompt: string | null
  style: string | null
  color: string | null
  product_type: string
  selected_image_url: string | null
  step: string
  created_at: string
  updated_at: string
}

interface CreatorStats {
  totalDesigns: number
  totalSales: number
  totalRoyalties: number
  designsByStatus: {
    approved: number
    pending: number
    rejected: number
  }
}

type Tab = 'designs' | 'drafts' | 'tools' | 'earnings'

// ITC costs for tools
const UPSCALE_COST = 15
const BG_REMOVE_COST = 10

export default function UserDesignDashboard() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('designs')
  const [designs, setDesigns] = useState<UserDesign[]>([])
  const [sessions, setSessions] = useState<DesignSession[]>([])
  const [stats, setStats] = useState<CreatorStats | null>(null)
  const [wallet, setWallet] = useState({ itc_balance: 0, points: 0 })
  const [loading, setLoading] = useState(true)
  const [selectedDesign, setSelectedDesign] = useState<UserDesign | null>(null)
  const [toolProcessing, setToolProcessing] = useState<string | null>(null)
  const [toolResult, setToolResult] = useState<{ url: string; type: string } | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Fetch all data on mount
  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [user])

  const fetchData = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      // Fetch in parallel
      const [designsRes, sessionsRes, statsRes, walletRes] = await Promise.all([
        // User's designs (products they created)
        axios.get('/api/user-products/my-products', {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: { products: [] } })),

        // Design sessions (drafts)
        axios.get('/api/user-products/design-sessions', {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: { sessions: [] } })),

        // Creator analytics
        axios.get('/api/user-products/creator-analytics', {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: null })),

        // Wallet
        supabase
          .from('user_wallets')
          .select('itc_balance, points')
          .eq('user_id', user?.id)
          .single()
      ])

      setDesigns(designsRes.data.products || [])
      setSessions(sessionsRes.data.sessions || [])
      if (statsRes.data) {
        setStats(statsRes.data)
      }
      if (walletRes.data) {
        setWallet({
          itc_balance: Number(walletRes.data.itc_balance) || 0,
          points: Number(walletRes.data.points) || 0
        })
      }
    } catch (error) {
      console.error('[Dashboard] Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Handle upscale image
  const handleUpscale = useCallback(async (imageUrl: string) => {
    if (wallet.itc_balance < UPSCALE_COST) {
      alert(`Not enough ITC! Need ${UPSCALE_COST} ITC, you have ${wallet.itc_balance}`)
      return
    }

    setToolProcessing('upscale')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      // Deduct ITC first
      await axios.post('/api/wallet/deduct-itc', {
        amount: UPSCALE_COST,
        reason: 'Image upscaling (4x)'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Call upscale API
      const { data } = await axios.post('/api/ai/upscale', {
        image_url: imageUrl,
        scale: 4
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setToolResult({ url: data.upscaled_url, type: 'upscale' })
      setWallet(prev => ({ ...prev, itc_balance: prev.itc_balance - UPSCALE_COST }))
    } catch (error: any) {
      console.error('[Dashboard] Upscale error:', error)
      alert(error.response?.data?.error || 'Failed to upscale image')
    } finally {
      setToolProcessing(null)
    }
  }, [wallet.itc_balance])

  // Handle background removal
  const handleBgRemove = useCallback(async (imageUrl: string) => {
    if (wallet.itc_balance < BG_REMOVE_COST) {
      alert(`Not enough ITC! Need ${BG_REMOVE_COST} ITC, you have ${wallet.itc_balance}`)
      return
    }

    setToolProcessing('bg-remove')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      // Deduct ITC first
      await axios.post('/api/wallet/deduct-itc', {
        amount: BG_REMOVE_COST,
        reason: 'Background removal'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Call background removal API
      const { data } = await axios.post('/api/ai/remove-background', {
        image_url: imageUrl
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setToolResult({ url: data.result_url, type: 'bg-remove' })
      setWallet(prev => ({ ...prev, itc_balance: prev.itc_balance - BG_REMOVE_COST }))
    } catch (error: any) {
      console.error('[Dashboard] BG remove error:', error)
      alert(error.response?.data?.error || 'Failed to remove background')
    } finally {
      setToolProcessing(null)
    }
  }, [wallet.itc_balance])

  // Delete design session
  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Delete this draft?')) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      await axios.delete(`/api/user-products/design-sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setSessions(prev => prev.filter(s => s.id !== sessionId))
    } catch (error) {
      console.error('[Dashboard] Delete session error:', error)
    }
  }

  // Resume design session
  const handleResumeSession = (session: DesignSession) => {
    // Navigate to create-design with session data
    window.location.href = `/create-design?resume=${session.id}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted">Loading your designs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/30 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-bold text-white">My Designs</h1>
              <p className="text-purple-200/70 mt-1">Manage your creations and earn royalties</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/10">
                <span className="text-sm text-purple-300/70">Balance</span>
                <p className="text-xl font-bold text-amber-400">{wallet.itc_balance} ITC</p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all hover:scale-105"
              >
                + Create New
              </button>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <p className="text-sm text-purple-300/70">Total Designs</p>
                <p className="text-2xl font-bold text-white">{stats.totalDesigns ?? 0}</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <p className="text-sm text-purple-300/70">Total Sales</p>
                <p className="text-2xl font-bold text-emerald-400">{stats.totalSales ?? 0}</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <p className="text-sm text-purple-300/70">Royalties Earned</p>
                <p className="text-2xl font-bold text-amber-400">${(stats.totalRoyalties ?? 0).toFixed(2)}</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
                <p className="text-sm text-purple-300/70">Pending Approval</p>
                <p className="text-2xl font-bold text-orange-400">{stats.designsByStatus?.pending ?? 0}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-2 border-b border-white/10 mb-6">
          {[
            { key: 'designs', label: 'My Designs', icon: '🎨' },
            { key: 'drafts', label: 'Drafts', icon: '📝' },
            { key: 'tools', label: 'AI Tools', icon: '🪄' },
            { key: 'earnings', label: 'Earnings', icon: '💰' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as Tab)}
              className={`px-4 py-3 font-medium transition-all border-b-2 -mb-[2px] ${
                activeTab === tab.key
                  ? 'text-purple-400 border-purple-400'
                  : 'text-muted border-transparent hover:text-white'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'designs' && (
          <div className="space-y-6">
            {designs.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">🎨</div>
                <h3 className="text-xl font-semibold text-white mb-2">No designs yet</h3>
                <p className="text-muted mb-6">Create your first design with Mr. Imagine!</p>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl"
                >
                  Start Creating
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {designs.map(design => (
                  <div
                    key={design.id}
                    className="bg-card border border-white/10 rounded-2xl overflow-hidden hover:border-purple-500/50 transition-all group cursor-pointer"
                    onClick={() => setSelectedDesign(design)}
                  >
                    <div className="aspect-square bg-white/5 relative">
                      {design.images?.[0] ? (
                        <img
                          src={design.images[0]}
                          alt={design.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl">
                          🎨
                        </div>
                      )}
                      {/* Status badge */}
                      <div className={`absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-medium ${
                        design.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                        design.status === 'pending_approval' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {design.status === 'approved' ? 'Live' :
                         design.status === 'pending_approval' ? 'Pending' :
                         design.status}
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-white truncate">{design.name}</h3>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-muted">
                          {new Date(design.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-sm text-purple-300 flex items-center gap-1">
                          <span>👁️</span> {design.view_count || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'drafts' && (
          <div className="space-y-4">
            {sessions.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">📝</div>
                <h3 className="text-xl font-semibold text-white mb-2">No drafts</h3>
                <p className="text-muted">Your in-progress designs will appear here</p>
              </div>
            ) : (
              sessions.map(session => (
                <div
                  key={session.id}
                  className="bg-card border border-white/10 rounded-xl p-4 flex items-center gap-4"
                >
                  <div className="w-16 h-16 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0">
                    {session.selected_image_url ? (
                      <img
                        src={session.selected_image_url}
                        alt="Draft"
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <span className="text-2xl">📝</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">
                      {session.prompt || 'Untitled Draft'}
                    </p>
                    <p className="text-sm text-muted">
                      Step: {session.step} • {session.style || 'No style'} • {session.color || 'No color'}
                    </p>
                    <p className="text-xs text-purple-300/50 mt-1">
                      Last edited: {new Date(session.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleResumeSession(session)}
                      className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 transition-colors"
                    >
                      Resume
                    </button>
                    <button
                      onClick={() => handleDeleteSession(session.id)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/20 border border-purple-500/20 rounded-2xl p-6">
              <h3 className="text-xl font-semibold text-white mb-2">AI Image Tools</h3>
              <p className="text-purple-200/70 mb-6">
                Enhance your designs with powerful AI tools. Select a design below or paste an image URL.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Upscale Tool */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center text-2xl">
                      🔍
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">4x Upscale</h4>
                      <p className="text-sm text-amber-400">{UPSCALE_COST} ITC</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted mb-4">
                    Increase image resolution by 4x using AI. Perfect for print-quality output.
                  </p>
                  <button
                    onClick={() => selectedDesign && handleUpscale(selectedDesign.images[0])}
                    disabled={!selectedDesign || toolProcessing === 'upscale'}
                    className="w-full py-2 bg-blue-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
                  >
                    {toolProcessing === 'upscale' ? 'Processing...' : 'Upscale Selected'}
                  </button>
                </div>

                {/* Background Removal */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-rose-500 rounded-xl flex items-center justify-center text-2xl">
                      ✂️
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">Remove Background</h4>
                      <p className="text-sm text-amber-400">{BG_REMOVE_COST} ITC</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted mb-4">
                    Remove backgrounds instantly. Great for creating transparent PNGs.
                  </p>
                  <button
                    onClick={() => selectedDesign && handleBgRemove(selectedDesign.images[0])}
                    disabled={!selectedDesign || toolProcessing === 'bg-remove'}
                    className="w-full py-2 bg-pink-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pink-500 transition-colors"
                  >
                    {toolProcessing === 'bg-remove' ? 'Processing...' : 'Remove BG Selected'}
                  </button>
                </div>
              </div>

              {/* Selected Design Preview */}
              {selectedDesign && (
                <div className="mt-6 p-4 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-sm text-purple-300 mb-2">Selected: {selectedDesign.name}</p>
                  <div className="flex items-start gap-4">
                    <img
                      src={selectedDesign.images[0]}
                      alt={selectedDesign.name}
                      className="w-24 h-24 object-cover rounded-lg"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-muted">Click a design from "My Designs" tab to select it for processing</p>
                    </div>
                    <button
                      onClick={() => setSelectedDesign(null)}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Tool Result */}
              {toolResult && (
                <div className="mt-6 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/30">
                  <p className="text-sm text-emerald-400 mb-2">
                    {toolResult.type === 'upscale' ? 'Upscaled Image Ready!' : 'Background Removed!'}
                  </p>
                  <div className="flex items-center gap-4">
                    <img
                      src={toolResult.url}
                      alt="Result"
                      className="w-32 h-32 object-cover rounded-lg"
                    />
                    <div className="flex flex-col gap-2">
                      <a
                        href={toolResult.url}
                        download
                        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-500"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => setToolResult(null)}
                        className="px-4 py-2 border border-white/10 text-white text-sm rounded-lg hover:bg-white/5"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Design selector for tools */}
            {!selectedDesign && designs.length > 0 && (
              <div>
                <h4 className="font-medium text-white mb-3">Select a design to process:</h4>
                <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {designs.slice(0, 16).map(design => (
                    <button
                      key={design.id}
                      onClick={() => setSelectedDesign(design)}
                      className="aspect-square bg-white/5 rounded-lg overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all"
                    >
                      {design.images?.[0] ? (
                        <img
                          src={design.images[0]}
                          alt={design.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">🎨</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'earnings' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-emerald-900/30 to-teal-900/20 border border-emerald-500/20 rounded-2xl p-6">
              <h3 className="text-xl font-semibold text-white mb-2">Creator Royalties</h3>
              <p className="text-emerald-200/70 mb-6">
                Earn 10% ITC on every sale of your designs. Royalties are credited automatically when orders complete.
              </p>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-sm text-emerald-300/70">Total Earned</p>
                  <p className="text-3xl font-bold text-emerald-400">${(stats?.totalRoyalties ?? 0).toFixed(2)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-sm text-emerald-300/70">Products Sold</p>
                  <p className="text-3xl font-bold text-white">{stats?.totalSales || 0}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-sm text-emerald-300/70">Active Designs</p>
                  <p className="text-3xl font-bold text-white">{stats?.designsByStatus?.approved ?? 0}</p>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="bg-card border border-white/10 rounded-2xl p-6">
              <h4 className="font-semibold text-white mb-4">How Royalties Work</h4>
              <div className="grid md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">🎨</span>
                  </div>
                  <p className="text-sm text-white font-medium">Create</p>
                  <p className="text-xs text-muted">Design with Mr. Imagine</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">✅</span>
                  </div>
                  <p className="text-sm text-white font-medium">Approved</p>
                  <p className="text-xs text-muted">Goes live on marketplace</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">🛒</span>
                  </div>
                  <p className="text-sm text-white font-medium">Someone Buys</p>
                  <p className="text-xs text-muted">Customer purchases your design</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl">💰</span>
                  </div>
                  <p className="text-sm text-white font-medium">You Earn 10%</p>
                  <p className="text-xs text-muted">ITC credited to wallet</p>
                </div>
              </div>
            </div>

            {/* Payout info */}
            <div className="bg-card border border-white/10 rounded-2xl p-6">
              <h4 className="font-semibold text-white mb-4">Cash Out Your ITC</h4>
              <p className="text-muted mb-4">
                Once you have at least 5,000 ITC ($50), you can request a payout via PayPal or Venmo.
                A 5% processing fee applies.
              </p>
              <Link
                to="/wallet"
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium rounded-lg"
              >
                Go to Wallet
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Design Detail Modal */}
      {selectedDesign && activeTab === 'designs' && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedDesign(null)}
        >
          <div
            className="bg-card border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="aspect-video bg-white/5 relative">
              {selectedDesign.images?.[0] ? (
                <img
                  src={selectedDesign.images[0]}
                  alt={selectedDesign.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl">🎨</div>
              )}
            </div>
            <div className="p-6">
              <h2 className="text-2xl font-bold text-white">{selectedDesign.name}</h2>
              <p className="text-muted mt-2">{selectedDesign.description}</p>

              <div className="flex items-center gap-4 mt-4 text-sm">
                <span className={`px-3 py-1 rounded-full ${
                  selectedDesign.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                  selectedDesign.status === 'pending_approval' ? 'bg-orange-500/20 text-orange-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {selectedDesign.status === 'approved' ? 'Live on Marketplace' :
                   selectedDesign.status === 'pending_approval' ? 'Pending Review' :
                   selectedDesign.status}
                </span>
                <span className="text-purple-300">👁️ {selectedDesign.view_count || 0} views</span>
              </div>

              {selectedDesign.metadata?.original_prompt && (
                <div className="mt-4 p-3 bg-white/5 rounded-lg">
                  <p className="text-xs text-purple-300 mb-1">Original Prompt</p>
                  <p className="text-sm text-white">{selectedDesign.metadata.original_prompt}</p>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setActiveTab('tools')
                  }}
                  className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-lg"
                >
                  Use AI Tools
                </button>
                <button
                  onClick={() => setSelectedDesign(null)}
                  className="px-6 py-2 border border-white/10 text-white rounded-lg hover:bg-white/5"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Design Modal */}
      <CreateDesignModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        itcBalance={wallet.itc_balance}
        onDesignCreated={(designId, imageUrl) => {
          setIsCreateModalOpen(false)
          // Refresh designs list
          fetchData()
        }}
        onBalanceChange={(newBalance) => {
          setWallet(prev => ({ ...prev, itc_balance: newBalance }))
        }}
      />
    </div>
  )
}
