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
  Plus
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
          <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted">Loading your designs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/50 to-pink-900/30 backdrop-blur-3xl" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay" />

        <div className="relative max-w-7xl mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-4xl font-display font-bold text-white mb-2 ml-1">My Designs</h1>
              <p className="text-purple-200/80 text-lg font-light ml-1">Manage your creations and earn royalties</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="glass px-6 py-3 rounded-2xl border border-white/10">
                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">Balance</span>
                <p className="text-2xl font-bold text-amber-400 font-display">{wallet.itc_balance} ITC</p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="btn-primary group"
              >
                <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
                Create New
              </button>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
              <div className="glass-dark p-5 rounded-2xl border border-white/5 hover:border-purple-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                    <Palette className="w-5 h-5" />
                  </div>
                  <p className="text-sm text-purple-200/60 font-medium">Total Designs</p>
                </div>
                <p className="text-3xl font-bold text-white font-display ml-1">{stats.totalDesigns ?? 0}</p>
              </div>

              <div className="glass-dark p-5 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
                    <ShoppingCart className="w-5 h-5" />
                  </div>
                  <p className="text-sm text-emerald-200/60 font-medium">Total Sales</p>
                </div>
                <p className="text-3xl font-bold text-white font-display ml-1">{stats.totalSales ?? 0}</p>
              </div>

              <div className="glass-dark p-5 rounded-2xl border border-white/5 hover:border-amber-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <p className="text-sm text-amber-200/60 font-medium">Royalties Earned</p>
                </div>
                <p className="text-3xl font-bold text-amber-400 font-display ml-1">${(stats.totalRoyalties ?? 0).toFixed(2)}</p>
              </div>

              <div className="glass-dark p-5 rounded-2xl border border-white/5 hover:border-orange-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-orange-500/20 rounded-lg text-orange-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <p className="text-sm text-orange-200/60 font-medium">Pending Approval</p>
                </div>
                <p className="text-3xl font-bold text-white font-display ml-1">{stats.designsByStatus?.pending ?? 0}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-2 border-b border-white/10 mb-8 overflow-x-auto pb-1">
          {[
            { key: 'designs', label: 'My Designs', icon: Palette },
            { key: 'drafts', label: 'Drafts', icon: FileText },
            { key: 'tools', label: 'AI Tools', icon: Wand2 },
            { key: 'earnings', label: 'Earnings', icon: DollarSign },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as Tab)}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-all border-b-2 -mb-[2px] whitespace-nowrap ${activeTab === tab.key
                ? 'text-purple-400 border-purple-400 bg-purple-500/5'
                : 'text-muted border-transparent hover:text-white hover:bg-white/5'
                }`}
            >
              <tab.icon className={`w-4 h-4 ${activeTab === tab.key ? 'text-purple-400' : 'text-muted'}`} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'designs' && (
          <div className="space-y-6">
            {designs.length === 0 ? (
              <div className="text-center py-20 bg-white/5 rounded-3xl border border-white/10 border-dashed">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Palette className="w-10 h-10 text-white/20" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">No designs yet</h3>
                <p className="text-muted mb-8 max-w-sm mx-auto">Create your first design with Mr. Imagine and start earning royalties!</p>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="btn-primary"
                >
                  Start Creating
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {designs.map(design => (
                  <div
                    key={design.id}
                    className="card-editorial group cursor-pointer"
                    onClick={() => setSelectedDesign(design)}
                  >
                    <div className="aspect-square bg-white/5 relative overflow-hidden">
                      {design.images?.[0] ? (
                        <div className="img-zoom w-full h-full">
                          <img
                            src={design.images[0]}
                            alt={design.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/20">
                          <ImageIcon className="w-12 h-12" />
                        </div>
                      )}

                      {/* Overlay on hover */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button className="p-2 bg-white rounded-full text-purple-600 transform translate-y-4 group-hover:translate-y-0 transition-all duration-300">
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Status badge */}
                      <div className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold shadow-lg backdrop-blur-md ${design.status === 'approved' ? 'bg-emerald-500/90 text-white' :
                        design.status === 'pending_approval' ? 'bg-orange-500/90 text-white' :
                          'bg-gray-500/90 text-white'
                        }`}>
                        {design.status === 'approved' ? 'Live' :
                          design.status === 'pending_approval' ? 'Pending' :
                            design.status}
                      </div>
                    </div>

                    <div className="p-5">
                      <h3 className="font-bold text-white truncate text-lg">{design.name}</h3>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-sm text-muted">
                          {new Date(design.created_at).toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-1.5 text-sm font-medium px-2 py-1 bg-white/5 rounded-lg border border-white/5">
                          <Eye className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-purple-100">{design.view_count || 0}</span>
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
              <div className="text-center py-20 bg-white/5 rounded-3xl border border-white/10 border-dashed">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileText className="w-10 h-10 text-white/20" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">No drafts</h3>
                <p className="text-muted">Your in-progress designs will appear here</p>
              </div>
            ) : (
              sessions.map(session => (
                <div
                  key={session.id}
                  className="glass-dark p-4 rounded-xl flex items-center gap-4 group hover:border-white/20 transition-all"
                >
                  <div className="w-20 h-20 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border border-white/10">
                    {session.selected_image_url ? (
                      <img
                        src={session.selected_image_url}
                        alt="Draft"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileText className="w-8 h-8 text-white/20" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-lg truncate mb-1">
                      {session.prompt || 'Untitled Draft'}
                    </p>
                    <div className="flex items-center gap-3 text-sm text-muted">
                      <span className="px-2 py-0.5 bg-white/5 rounded text-xs uppercase tracking-wider">Step: {session.step}</span>
                      <span>•</span>
                      <span>{session.style || 'No style'}</span>
                      <span>•</span>
                      <span>{session.color || 'No color'}</span>
                    </div>
                    <p className="text-xs text-purple-300/50 mt-2">
                      Last edited: {new Date(session.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleResumeSession(session)}
                      className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 transition-colors shadow-lg shadow-purple-900/20"
                    >
                      Resume
                    </button>
                    <button
                      onClick={() => handleDeleteSession(session.id)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="space-y-6">
            <div className="glass p-8 rounded-3xl border border-white/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 bg-purple-500/10 blur-[100px] rounded-full" />

              <h3 className="text-2xl font-bold text-white mb-2 relative z-10">AI Image Tools</h3>
              <p className="text-purple-200/70 mb-8 max-w-2xl relative z-10">
                Enhance your designs with powerful AI tools. Select a design below or paste an image URL.
              </p>

              <div className="grid md:grid-cols-2 gap-6 relative z-10">
                {/* Upscale Tool */}
                <div className="glass-dark p-6 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all group">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                      <ZoomIn className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">4x Upscale</h4>
                      <p className="text-sm text-blue-300 font-medium">{UPSCALE_COST} ITC</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted mb-6 leading-relaxed">
                    Increase image resolution by 4x using AI. Perfect for print-quality output.
                  </p>
                  <button
                    onClick={() => selectedDesign && handleUpscale(selectedDesign.images?.[0])}
                    disabled={!selectedDesign || toolProcessing === 'upscale'}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-900/20"
                  >
                    {toolProcessing === 'upscale' ? 'Processing...' : 'Upscale Selected'}
                  </button>
                </div>

                {/* Background Removal */}
                <div className="glass-dark p-6 rounded-2xl border border-white/5 hover:border-pink-500/30 transition-all group">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-rose-500 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/20 group-hover:scale-110 transition-transform">
                      <Scissors className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">Remove Background</h4>
                      <p className="text-sm text-pink-300 font-medium">{BG_REMOVE_COST} ITC</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted mb-6 leading-relaxed">
                    Remove backgrounds instantly. Great for creating transparent PNGs.
                  </p>
                  <button
                    onClick={() => selectedDesign && handleBgRemove(selectedDesign.images?.[0])}
                    disabled={!selectedDesign || toolProcessing === 'bg-remove'}
                    className="w-full py-3 bg-pink-600 hover:bg-pink-500 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-pink-900/20"
                  >
                    {toolProcessing === 'bg-remove' ? 'Processing...' : 'Remove BG Selected'}
                  </button>
                </div>
              </div>

              {/* Selected Design Preview */}
              {selectedDesign && (
                <div className="mt-8 p-4 glass-dark rounded-xl border border-white/10 flex items-center gap-6 animate-fade-in relative z-10">
                  <div className="relative">
                    <img
                      src={selectedDesign.images?.[0]}
                      alt={selectedDesign.name}
                      className="w-24 h-24 object-cover rounded-lg border border-white/10"
                    />
                    <button
                      onClick={() => setSelectedDesign(null)}
                      className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full text-white hover:bg-red-600 shadow-lg"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-1">Selected Design</p>
                    <p className="text-lg font-semibold text-white">{selectedDesign.name}</p>
                    <p className="text-sm text-muted mt-1">Ready to apply AI tools</p>
                  </div>
                </div>
              )}

              {/* Tool Result */}
              {toolResult && (
                <div className="mt-8 p-6 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 relative z-10 animate-fade-in">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-emerald-500/20 rounded-lg">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    </div>
                    <p className="font-bold text-emerald-400">
                      {toolResult.type === 'upscale' ? 'Upscaled Image Ready!' : 'Background Removed!'}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-6">
                    <div className="w-full sm:w-48 aspect-square bg-black/20 rounded-xl overflow-hidden border border-white/5">
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
                        className="btn-primary w-full sm:w-auto"
                      >
                        <Download className="w-4 h-4" />
                        Download Result
                      </a>
                      <button
                        onClick={() => setToolResult(null)}
                        className="px-6 py-3 border border-white/10 text-white font-medium rounded-xl hover:bg-white/5 transition-colors w-full sm:w-auto"
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
              <div className="mt-8">
                <h4 className="font-medium text-white mb-4 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-purple-400" />
                  Select a design to process:
                </h4>
                <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {designs.slice(0, 16).map(design => (
                    <button
                      key={design.id}
                      onClick={() => setSelectedDesign(design)}
                      className="aspect-square bg-white/5 rounded-xl overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all border border-white/5 hover:scale-105"
                    >
                      {design.images?.[0] ? (
                        <img
                          src={design.images[0]}
                          alt={design.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/20">
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
          <div className="space-y-8">
            <div className="glass p-8 rounded-3xl border border-white/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-32 bg-emerald-500/5 blur-[100px] rounded-full" />

              <div className="relative z-10">
                <h3 className="text-2xl font-bold text-white mb-2">Creator Royalties</h3>
                <p className="text-emerald-200/70 mb-8 max-w-2xl">
                  Earn 10% ITC on every sale of your designs. Royalties are credited automatically when orders complete.
                </p>

                <div className="grid md:grid-cols-3 gap-6">
                  <div className="glass-dark p-6 rounded-2xl border border-white/5">
                    <p className="text-sm text-emerald-300/70 font-medium mb-1">Total Earned</p>
                    <p className="text-4xl font-bold text-emerald-400 font-display">${(stats?.totalRoyalties ?? 0).toFixed(2)}</p>
                  </div>
                  <div className="glass-dark p-6 rounded-2xl border border-white/5">
                    <p className="text-sm text-emerald-300/70 font-medium mb-1">Products Sold</p>
                    <p className="text-4xl font-bold text-white font-display">{stats?.totalSales || 0}</p>
                  </div>
                  <div className="glass-dark p-6 rounded-2xl border border-white/5">
                    <p className="text-sm text-emerald-300/70 font-medium mb-1">Active Designs</p>
                    <p className="text-4xl font-bold text-white font-display">{stats?.designsByStatus?.approved ?? 0}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="glass-dark p-8 rounded-3xl border border-white/5">
              <h4 className="font-semibold text-white mb-8 text-lg">How Royalties Work</h4>
              <div className="grid md:grid-cols-4 gap-8 relative">
                {/* Connecting Line (Desktop) */}
                <div className="hidden md:block absolute top-6 left-1/2 -translate-x-1/2 w-3/4 h-0.5 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="text-center relative z-10 group">
                  <div className="w-14 h-14 bg-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-purple-500/30 group-hover:scale-110 transition-transform shadow-lg shadow-purple-500/20">
                    <Palette className="w-6 h-6 text-purple-400" />
                  </div>
                  <p className="text-white font-bold mb-1">Create</p>
                  <p className="text-sm text-muted">Design with Mr. Imagine</p>
                </div>

                <div className="text-center relative z-10 group">
                  <div className="w-14 h-14 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-blue-500/30 group-hover:scale-110 transition-transform shadow-lg shadow-blue-500/20">
                    <CheckCircle2 className="w-6 h-6 text-blue-400" />
                  </div>
                  <p className="text-white font-bold mb-1">Approved</p>
                  <p className="text-sm text-muted">Goes live on marketplace</p>
                </div>

                <div className="text-center relative z-10 group">
                  <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-emerald-500/30 group-hover:scale-110 transition-transform shadow-lg shadow-emerald-500/20">
                    <ShoppingCart className="w-6 h-6 text-emerald-400" />
                  </div>
                  <p className="text-white font-bold mb-1">Someone Buys</p>
                  <p className="text-sm text-muted">Customer purchases your design</p>
                </div>

                <div className="text-center relative z-10 group">
                  <div className="w-14 h-14 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-amber-500/30 group-hover:scale-110 transition-transform shadow-lg shadow-amber-500/20">
                    <DollarSign className="w-6 h-6 text-amber-400" />
                  </div>
                  <p className="text-white font-bold mb-1">You Earn 10%</p>
                  <p className="text-sm text-muted">ITC credited to wallet</p>
                </div>
              </div>
            </div>

            {/* Payout info */}
            <div className="glass-dark p-8 rounded-3xl border border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h4 className="font-semibold text-white mb-2 text-lg">Cash Out Your ITC</h4>
                <p className="text-muted max-w-xl">
                  Once you have at least 5,000 ITC ($50), you can request a payout via PayPal or Venmo.
                  A 5% processing fee applies.
                </p>
              </div>
              <Link
                to="/wallet"
                className="btn-primary bg-gradient-to-r from-amber-600 to-orange-600 shadow-amber-900/20 whitespace-nowrap"
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
            className="glass-dark border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedDesign(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white backdrop-blur-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="aspect-video bg-black/40 relative flex items-center justify-center">
              {selectedDesign.images?.[0] ? (
                <img
                  src={selectedDesign.images[0]}
                  alt={selectedDesign.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-white/20">
                  <ImageIcon className="w-20 h-20" />
                </div>
              )}
            </div>

            <div className="p-8">
              <div className="flex items-start justify-between gap-4 mb-4">
                <h2 className="text-3xl font-bold text-white font-display mb-1">{selectedDesign.name}</h2>
                <div className={`px-3 py-1 rounded-full text-xs font-bold border ${selectedDesign.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    selectedDesign.status === 'pending_approval' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                      'bg-gray-500/10 text-gray-400 border-gray-500/20'
                  }`}>
                  {selectedDesign.status === 'approved' ? 'Live on Marketplace' :
                    selectedDesign.status === 'pending_approval' ? 'Pending Review' :
                      selectedDesign.status}
                </div>
              </div>

              <p className="text-lg text-purple-100/80 mb-6">{selectedDesign.description}</p>

              <div className="flex items-center gap-2 mb-8 text-sm text-purple-300 bg-purple-500/5 px-4 py-2 rounded-lg border border-purple-500/10 w-fit">
                <Eye className="w-4 h-4" />
                <span>{selectedDesign.view_count || 0} views</span>
              </div>

              {selectedDesign.metadata?.original_prompt && (
                <div className="mb-8 p-4 bg-black/20 rounded-xl border border-white/5">
                  <p className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">Original Prompt</p>
                  <p className="text-sm text-white/90 italic leading-relaxed">"{selectedDesign.metadata.original_prompt}"</p>
                </div>
              )}

              <div className="flex gap-4">
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
                  className="px-8 py-3 border border-white/10 text-white font-medium rounded-xl hover:bg-white/5 transition-colors"
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
