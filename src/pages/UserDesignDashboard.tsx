import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import axios from 'axios'
import {
  Palette,
  FileText,
  Wand2,
  DollarSign,
  Eye,
  CheckCircle2,
  ShoppingCart,
  ZoomIn,
  Scissors,
  Trash2,
  Image as ImageIcon,
  Download,
  X,
  Plus,
  Sparkles,
  ArrowRight,
  Clock,
  TrendingUp
} from 'lucide-react'
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
          <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted">Loading your designs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Hero Header Section */}
      <section className="relative py-12 sm:py-16 bg-gradient-to-br from-purple-50 via-bg to-pink-50 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-pink-200/30 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 sm:gap-8">
            {/* Left: Title & Description */}
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm font-medium mb-4">
                <Sparkles className="w-4 h-4" />
                Creator Dashboard
              </span>
              <h1 className="font-display text-3xl sm:text-4xl md:text-5xl text-text mb-3">
                My <span className="text-gradient">Designs</span>
              </h1>
              <p className="text-muted text-base sm:text-lg max-w-xl">
                Manage your creations, track sales, and earn royalties from your designs.
              </p>
            </div>

            {/* Right: Balance & CTA */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <div className="card-editorial p-4 sm:p-5 flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-200">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted uppercase tracking-wider">ITC Balance</p>
                  <p className="text-2xl font-display font-bold text-text">{wallet.itc_balance}</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="btn-primary group"
              >
                <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                Create New
              </button>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 sm:mt-10">
              <div className="card-editorial p-4 sm:p-5 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Palette className="w-5 h-5 text-purple-600" />
                  </div>
                  <p className="text-sm text-muted font-medium">Total Designs</p>
                </div>
                <p className="text-2xl sm:text-3xl font-display font-bold text-text">{stats.totalDesigns ?? 0}</p>
              </div>

              <div className="card-editorial p-4 sm:p-5 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <ShoppingCart className="w-5 h-5 text-emerald-600" />
                  </div>
                  <p className="text-sm text-muted font-medium">Total Sales</p>
                </div>
                <p className="text-2xl sm:text-3xl font-display font-bold text-text">{stats.totalSales ?? 0}</p>
              </div>

              <div className="card-editorial p-4 sm:p-5 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <TrendingUp className="w-5 h-5 text-amber-600" />
                  </div>
                  <p className="text-sm text-muted font-medium">Royalties Earned</p>
                </div>
                <p className="text-2xl sm:text-3xl font-display font-bold text-emerald-600">${(stats.totalRoyalties ?? 0).toFixed(2)}</p>
              </div>

              <div className="card-editorial p-4 sm:p-5 group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Clock className="w-5 h-5 text-orange-600" />
                  </div>
                  <p className="text-sm text-muted font-medium">Pending Review</p>
                </div>
                <p className="text-2xl sm:text-3xl font-display font-bold text-text">{stats.designsByStatus?.pending ?? 0}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Tabs & Content */}
      <section className="py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Tab Navigation */}
          <div className="flex gap-1 sm:gap-2 border-b border-border mb-8 overflow-x-auto pb-px">
            {[
              { key: 'designs', label: 'My Designs', icon: Palette },
              { key: 'drafts', label: 'Drafts', icon: FileText },
              { key: 'tools', label: 'AI Tools', icon: Wand2 },
              { key: 'earnings', label: 'Earnings', icon: DollarSign },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as Tab)}
                className={`flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-4 font-medium transition-all border-b-2 -mb-px whitespace-nowrap rounded-t-lg ${activeTab === tab.key
                  ? 'text-purple-600 border-purple-600 bg-purple-50'
                  : 'text-muted border-transparent hover:text-text hover:bg-gray-50'
                  }`}
              >
                <tab.icon className={`w-4 h-4 ${activeTab === tab.key ? 'text-purple-600' : ''}`} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'designs' && (
            <div className="space-y-6">
              {designs.length === 0 ? (
                <div className="text-center py-16 sm:py-20 card-editorial border-2 border-dashed border-purple-200">
                  <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Palette className="w-10 h-10 text-purple-400" />
                  </div>
                  <h3 className="text-xl font-display font-semibold text-text mb-2">No designs yet</h3>
                  <p className="text-muted mb-8 max-w-sm mx-auto">
                    Create your first design with Mr. Imagine and start earning royalties!
                  </p>
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="btn-primary"
                  >
                    <Sparkles className="w-5 h-5" />
                    Start Creating
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                  {designs.map(design => (
                    <div
                      key={design.id}
                      className="card-editorial group cursor-pointer"
                      onClick={() => setSelectedDesign(design)}
                    >
                      <div className="aspect-square bg-gray-100 relative overflow-hidden">
                        {design.images?.[0] ? (
                          <img
                            src={design.images[0]}
                            alt={design.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <ImageIcon className="w-12 h-12" />
                          </div>
                        )}

                        {/* Overlay on hover */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-6">
                          <span className="px-4 py-2 bg-white rounded-full text-sm font-medium text-text flex items-center gap-2 shadow-lg">
                            <Eye className="w-4 h-4" />
                            View Details
                          </span>
                        </div>

                        {/* Status badge */}
                        <div className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold shadow-md ${design.status === 'approved' ? 'bg-emerald-500 text-white' :
                          design.status === 'pending_approval' ? 'bg-amber-500 text-white' :
                            'bg-gray-500 text-white'
                          }`}>
                          {design.status === 'approved' ? 'Live' :
                            design.status === 'pending_approval' ? 'Pending' :
                              design.status}
                        </div>
                      </div>

                      <div className="p-4 sm:p-5">
                        <h3 className="font-display font-semibold text-text truncate text-lg">{design.name}</h3>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-sm text-muted">
                            {new Date(design.created_at).toLocaleDateString()}
                          </span>
                          <div className="flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 bg-purple-50 rounded-lg">
                            <Eye className="w-3.5 h-3.5 text-purple-500" />
                            <span className="text-purple-700">{design.view_count || 0}</span>
                          </div>
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
                <div className="text-center py-16 sm:py-20 card-editorial border-2 border-dashed border-purple-200">
                  <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <FileText className="w-10 h-10 text-purple-400" />
                  </div>
                  <h3 className="text-xl font-display font-semibold text-text mb-2">No drafts</h3>
                  <p className="text-muted">Your in-progress designs will appear here</p>
                </div>
              ) : (
                sessions.map(session => (
                  <div
                    key={session.id}
                    className="card-editorial p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 group"
                  >
                    <div className="w-full sm:w-20 h-32 sm:h-20 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {session.selected_image_url ? (
                        <img
                          src={session.selected_image_url}
                          alt="Draft"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileText className="w-8 h-8 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-medium text-text text-lg truncate mb-1">
                        {session.prompt || 'Untitled Draft'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium uppercase tracking-wider">
                          Step: {session.step}
                        </span>
                        <span className="hidden sm:inline">•</span>
                        <span>{session.style || 'No style'}</span>
                        <span className="hidden sm:inline">•</span>
                        <span>{session.color || 'No color'}</span>
                      </div>
                      <p className="text-xs text-muted mt-2">
                        Last edited: {new Date(session.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleResumeSession(session)}
                        className="flex-1 sm:flex-none btn-primary py-2.5 px-5"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => handleDeleteSession(session.id)}
                        className="p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="space-y-6">
              <div className="card-editorial p-6 sm:p-8 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2" />

                <div className="relative">
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium mb-4">
                    <Wand2 className="w-3 h-3" />
                    AI Powered
                  </span>
                  <h3 className="text-2xl font-display font-bold text-text mb-2">AI Image Tools</h3>
                  <p className="text-muted mb-8 max-w-2xl">
                    Enhance your designs with powerful AI tools. Select a design below or use one from your collection.
                  </p>

                  <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
                    {/* Upscale Tool */}
                    <div className="card-editorial p-5 sm:p-6 border border-blue-100 hover:border-blue-300 transition-colors group">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform">
                          <ZoomIn className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-display font-semibold text-text">4x Upscale</h4>
                          <p className="text-sm text-blue-600 font-medium">{UPSCALE_COST} ITC</p>
                        </div>
                      </div>
                      <p className="text-sm text-muted mb-6 leading-relaxed">
                        Increase image resolution by 4x using AI. Perfect for print-quality output.
                      </p>
                      <button
                        onClick={() => selectedDesign && handleUpscale(selectedDesign.images?.[0])}
                        disabled={!selectedDesign || toolProcessing === 'upscale'}
                        className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-200"
                      >
                        {toolProcessing === 'upscale' ? 'Processing...' : 'Upscale Selected'}
                      </button>
                    </div>

                    {/* Background Removal */}
                    <div className="card-editorial p-5 sm:p-6 border border-pink-100 hover:border-pink-300 transition-colors group">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-rose-500 rounded-xl flex items-center justify-center shadow-lg shadow-pink-200 group-hover:scale-110 transition-transform">
                          <Scissors className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-display font-semibold text-text">Remove Background</h4>
                          <p className="text-sm text-pink-600 font-medium">{BG_REMOVE_COST} ITC</p>
                        </div>
                      </div>
                      <p className="text-sm text-muted mb-6 leading-relaxed">
                        Remove backgrounds instantly. Great for creating transparent PNGs.
                      </p>
                      <button
                        onClick={() => selectedDesign && handleBgRemove(selectedDesign.images?.[0])}
                        disabled={!selectedDesign || toolProcessing === 'bg-remove'}
                        className="w-full py-3 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-pink-200"
                      >
                        {toolProcessing === 'bg-remove' ? 'Processing...' : 'Remove BG Selected'}
                      </button>
                    </div>
                  </div>

                  {/* Selected Design Preview */}
                  {selectedDesign && (
                    <div className="mt-8 p-4 sm:p-5 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                      <div className="relative w-full sm:w-auto">
                        <img
                          src={selectedDesign.images?.[0]}
                          alt={selectedDesign.name}
                          className="w-full sm:w-24 h-40 sm:h-24 object-cover rounded-xl"
                        />
                        <button
                          onClick={() => setSelectedDesign(null)}
                          className="absolute -top-2 -right-2 p-1.5 bg-red-500 rounded-full text-white hover:bg-red-600 shadow-lg"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-1">Selected Design</p>
                        <p className="text-lg font-display font-semibold text-text">{selectedDesign.name}</p>
                        <p className="text-sm text-muted mt-1">Ready to apply AI tools</p>
                      </div>
                    </div>
                  )}

                  {/* Tool Result */}
                  {toolResult && (
                    <div className="mt-8 p-5 sm:p-6 bg-emerald-50 rounded-2xl border border-emerald-200">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        </div>
                        <p className="font-display font-semibold text-emerald-700">
                          {toolResult.type === 'upscale' ? 'Upscaled Image Ready!' : 'Background Removed!'}
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-6">
                        <div className="w-full sm:w-48 aspect-square bg-white rounded-xl overflow-hidden border border-emerald-100 shadow-inner">
                          <img
                            src={toolResult.url}
                            alt="Result"
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="flex-1 flex flex-col justify-center gap-3">
                          <a
                            href={toolResult.url}
                            download
                            className="btn-primary bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-200"
                          >
                            <Download className="w-4 h-4" />
                            Download Result
                          </a>
                          <button
                            onClick={() => setToolResult(null)}
                            className="px-6 py-3 border border-gray-200 text-text font-medium rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Design selector for tools */}
              {!selectedDesign && designs.length > 0 && (
                <div className="mt-8">
                  <h4 className="font-display font-medium text-text mb-4 flex items-center gap-2">
                    <Palette className="w-4 h-4 text-purple-500" />
                    Select a design to process:
                  </h4>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                    {designs.slice(0, 16).map(design => (
                      <button
                        key={design.id}
                        onClick={() => setSelectedDesign(design)}
                        className="aspect-square bg-gray-100 rounded-xl overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all hover:scale-105 shadow-sm"
                      >
                        {design.images?.[0] ? (
                          <img
                            src={design.images[0]}
                            alt={design.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'earnings' && (
            <div className="space-y-6 sm:space-y-8">
              <div className="card-editorial p-6 sm:p-8 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/2" />

                <div className="relative">
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium mb-4">
                    <TrendingUp className="w-3 h-3" />
                    Creator Earnings
                  </span>
                  <h3 className="text-2xl font-display font-bold text-text mb-2">Creator Royalties</h3>
                  <p className="text-muted mb-8 max-w-2xl">
                    Earn 10% ITC on every sale of your designs. Royalties are credited automatically when orders complete.
                  </p>

                  <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
                    <div className="card-editorial p-5 sm:p-6 border border-emerald-100">
                      <p className="text-sm text-muted font-medium mb-2">Total Earned</p>
                      <p className="text-3xl sm:text-4xl font-display font-bold text-emerald-600">${(stats?.totalRoyalties ?? 0).toFixed(2)}</p>
                    </div>
                    <div className="card-editorial p-5 sm:p-6 border border-emerald-100">
                      <p className="text-sm text-muted font-medium mb-2">Products Sold</p>
                      <p className="text-3xl sm:text-4xl font-display font-bold text-text">{stats?.totalSales || 0}</p>
                    </div>
                    <div className="card-editorial p-5 sm:p-6 border border-emerald-100">
                      <p className="text-sm text-muted font-medium mb-2">Active Designs</p>
                      <p className="text-3xl sm:text-4xl font-display font-bold text-text">{stats?.designsByStatus?.approved ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="card-editorial p-6 sm:p-8">
                <h4 className="font-display font-semibold text-text mb-8 text-lg">How Royalties Work</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 relative">
                  {/* Connecting Line (Desktop) */}
                  <div className="hidden md:block absolute top-7 left-1/2 -translate-x-1/2 w-3/4 h-0.5 bg-gradient-to-r from-purple-200 via-blue-200 to-emerald-200" />

                  <div className="text-center relative z-10 group">
                    <div className="w-14 h-14 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-purple-100">
                      <Palette className="w-6 h-6 text-purple-600" />
                    </div>
                    <p className="font-display font-semibold text-text mb-1">Create</p>
                    <p className="text-sm text-muted">Design with Mr. Imagine</p>
                  </div>

                  <div className="text-center relative z-10 group">
                    <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-blue-100">
                      <CheckCircle2 className="w-6 h-6 text-blue-600" />
                    </div>
                    <p className="font-display font-semibold text-text mb-1">Approved</p>
                    <p className="text-sm text-muted">Goes live on marketplace</p>
                  </div>

                  <div className="text-center relative z-10 group">
                    <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-pink-100">
                      <ShoppingCart className="w-6 h-6 text-pink-600" />
                    </div>
                    <p className="font-display font-semibold text-text mb-1">Someone Buys</p>
                    <p className="text-sm text-muted">Customer purchases</p>
                  </div>

                  <div className="text-center relative z-10 group">
                    <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-emerald-100">
                      <DollarSign className="w-6 h-6 text-emerald-600" />
                    </div>
                    <p className="font-display font-semibold text-text mb-1">You Earn 10%</p>
                    <p className="text-sm text-muted">ITC credited to wallet</p>
                  </div>
                </div>
              </div>

              {/* Payout info */}
              <div className="card-editorial p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border border-amber-100">
                <div>
                  <h4 className="font-display font-semibold text-text mb-2 text-lg">Cash Out Your ITC</h4>
                  <p className="text-muted max-w-xl">
                    Once you have at least 5,000 ITC ($50), you can request a payout via PayPal or Venmo.
                    A 5% processing fee applies.
                  </p>
                </div>
                <Link
                  to="/wallet"
                  className="btn-primary bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-200 whitespace-nowrap"
                >
                  Go to Wallet
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Design Detail Modal */}
      {selectedDesign && activeTab === 'designs' && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedDesign(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedDesign(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="aspect-video bg-gray-100 relative flex items-center justify-center">
              {selectedDesign.images?.[0] ? (
                <img
                  src={selectedDesign.images[0]}
                  alt={selectedDesign.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-gray-300">
                  <ImageIcon className="w-20 h-20" />
                </div>
              )}
            </div>

            <div className="p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <h2 className="text-2xl sm:text-3xl font-display font-bold text-text">{selectedDesign.name}</h2>
                <div className={`px-3 py-1 rounded-full text-xs font-bold ${selectedDesign.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    selectedDesign.status === 'pending_approval' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                  }`}>
                  {selectedDesign.status === 'approved' ? 'Live on Marketplace' :
                    selectedDesign.status === 'pending_approval' ? 'Pending Review' :
                      selectedDesign.status}
                </div>
              </div>

              <p className="text-muted mb-6">{selectedDesign.description}</p>

              <div className="flex items-center gap-2 mb-8 text-sm text-purple-600 bg-purple-50 px-4 py-2 rounded-lg w-fit">
                <Eye className="w-4 h-4" />
                <span>{selectedDesign.view_count || 0} views</span>
              </div>

              {selectedDesign.metadata?.original_prompt && (
                <div className="mb-8 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-2">Original Prompt</p>
                  <p className="text-sm text-text italic leading-relaxed">"{selectedDesign.metadata.original_prompt}"</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => {
                    setActiveTab('tools')
                  }}
                  className="flex-1 btn-primary"
                >
                  <Wand2 className="w-4 h-4" />
                  Use AI Tools
                </button>
                <button
                  onClick={() => setSelectedDesign(null)}
                  className="px-8 py-3 border border-gray-200 text-text font-medium rounded-full hover:bg-gray-50 transition-colors"
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
