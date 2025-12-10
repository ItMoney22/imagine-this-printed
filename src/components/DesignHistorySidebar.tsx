import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import axios from 'axios'

interface DesignSession {
  id: string
  status: 'draft' | 'generating' | 'completed' | 'submitted' | 'archived'
  prompt: string | null
  style: string | null
  color: string | null
  product_type: string | null
  step: string | null
  generated_images: { url: string; replicate_id?: string }[]
  selected_image_url: string | null
  product_id: string | null
  created_at: string
  updated_at: string
}

interface DesignHistorySidebarProps {
  isOpen: boolean
  onClose: () => void
  onLoadSession: (session: DesignSession) => void
  onRemixSession: (session: DesignSession) => void
  currentSessionId?: string | null
}

export const DesignHistorySidebar = ({
  isOpen,
  onClose,
  onLoadSession,
  onRemixSession,
  currentSessionId
}: DesignHistorySidebarProps) => {
  const [sessions, setSessions] = useState<DesignSession[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'drafts' | 'history'>('drafts')

  // Fetch sessions on mount and when sidebar opens
  useEffect(() => {
    if (isOpen) {
      fetchSessions()
    }
  }, [isOpen])

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const { data } = await axios.get('/api/user-products/design-sessions', {
        headers: { Authorization: `Bearer ${token}` }
      })

      setSessions(data.sessions || [])
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (sessionId: string) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      await axios.delete(`/api/user-products/design-sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setSessions(prev => prev.filter(s => s.id !== sessionId))
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const handleRemix = async (session: DesignSession) => {
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.access_token

      const { data } = await axios.post(
        `/api/user-products/design-sessions/${session.id}/remix`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )

      onRemixSession(data.session)
      onClose()
    } catch (error) {
      console.error('Failed to remix session:', error)
    }
  }

  const drafts = sessions.filter(s => s.status === 'draft' || s.status === 'generating')
  const completed = sessions.filter(s => s.status === 'completed' || s.status === 'submitted')

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getStepLabel = (step: string | null) => {
    switch (step) {
      case 'welcome': return 'Starting'
      case 'prompt': return 'Describing'
      case 'style': return 'Style'
      case 'color': return 'Color'
      case 'generating': return 'Generating'
      case 'complete': return 'Complete'
      default: return 'Draft'
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed right-0 top-0 bottom-0 w-80 md:w-96 bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-serif text-xl text-gray-800">My Designs</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('drafts')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'drafts'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Drafts ({drafts.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            History ({completed.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm">Loading your designs...</p>
            </div>
          ) : (
            <>
              {activeTab === 'drafts' && (
                <>
                  {drafts.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <span className="text-4xl mb-3 block">📝</span>
                      <p className="text-sm">No drafts yet</p>
                      <p className="text-xs mt-1">Your in-progress designs will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {drafts.map(session => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          isActive={session.id === currentSessionId}
                          onLoad={() => { onLoadSession(session); onClose() }}
                          onDelete={() => handleDelete(session.id)}
                          formatDate={formatDate}
                          getStepLabel={getStepLabel}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'history' && (
                <>
                  {completed.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <span className="text-4xl mb-3 block">🎨</span>
                      <p className="text-sm">No completed designs yet</p>
                      <p className="text-xs mt-1">Create your first design!</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {completed.map(session => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          isActive={false}
                          onLoad={() => {}}
                          onRemix={() => handleRemix(session)}
                          formatDate={formatDate}
                          getStepLabel={getStepLabel}
                          showRemix
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// Session Card Component
interface SessionCardProps {
  session: DesignSession
  isActive: boolean
  onLoad: () => void
  onDelete?: () => void
  onRemix?: () => void
  formatDate: (date: string) => string
  getStepLabel: (step: string | null) => string
  showRemix?: boolean
}

const SessionCard = ({
  session,
  isActive,
  onLoad,
  onDelete,
  onRemix,
  formatDate,
  getStepLabel,
  showRemix
}: SessionCardProps) => {
  const hasImage = session.generated_images?.length > 0 || session.selected_image_url

  return (
    <div
      className={`group relative bg-gradient-to-br from-gray-50 to-white rounded-xl border transition-all ${
        isActive
          ? 'border-purple-400 ring-2 ring-purple-200'
          : 'border-gray-100 hover:border-purple-200 hover:shadow-md'
      }`}
    >
      <div className="p-3">
        {/* Image Preview */}
        {hasImage && (
          <div className="aspect-square w-full rounded-lg overflow-hidden bg-gray-100 mb-3">
            <img
              src={session.selected_image_url || session.generated_images?.[0]?.url}
              alt="Design preview"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Prompt Preview */}
        <p className="text-sm text-gray-700 line-clamp-2 mb-2">
          {session.prompt || 'No description yet...'}
        </p>

        {/* Meta Info */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${
              session.status === 'draft' ? 'bg-yellow-400' :
              session.status === 'generating' ? 'bg-blue-400 animate-pulse' :
              session.status === 'completed' ? 'bg-green-400' :
              'bg-purple-400'
            }`} />
            {getStepLabel(session.step)}
          </span>
          <span>{formatDate(session.updated_at)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
        {!showRemix && (
          <button
            onClick={onLoad}
            className="px-4 py-2 bg-white text-purple-600 font-medium text-sm rounded-lg hover:bg-purple-50 transition-colors"
          >
            Continue
          </button>
        )}
        {showRemix && onRemix && (
          <button
            onClick={onRemix}
            className="px-4 py-2 bg-white text-purple-600 font-medium text-sm rounded-lg hover:bg-purple-50 transition-colors"
          >
            Remix
          </button>
        )}
        {onDelete && !showRemix && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="px-3 py-2 bg-white/20 text-white font-medium text-sm rounded-lg hover:bg-white/30 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

export default DesignHistorySidebar
