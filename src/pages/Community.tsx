import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import { validateSocialUrl } from '../utils/social-embed'
import { CommunityShowcase } from '../components/community'
import { Sparkles, Share2, Users, Rocket, ThumbsUp, ThumbsDown, ExternalLink, Plus } from 'lucide-react'

type TabType = 'showcase' | 'social'

// Matches the raw social_posts row shape returned by GET /api/social/posts
// (backend/routes/social.ts) — deliberately snake_case, not the fabricated
// camelCase SocialPost type in src/types/index.ts that the old mock
// social-service.ts was shaped around. SocialContentManagement.tsx (the
// admin side of this same feature) defines the identical local interface.
interface SocialPost {
  id: string
  platform: 'tiktok' | 'instagram' | 'youtube' | 'twitter'
  url: string
  embed_code: string | null
  thumbnail_url: string | null
  title: string | null
  description: string | null
  author_username: string | null
  author_display_name: string | null
  approved_at: string
  tags: string[]
  product_ids: string[]
  votes: number
  is_featured: boolean
  view_count: number
}

const Community: React.FC = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('showcase')
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'recent' | 'votes' | 'featured'>('recent')
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [showSubmissionModal, setShowSubmissionModal] = useState(false)
  const [submissionForm, setSubmissionForm] = useState({
    url: '',
    featuredProducts: '',
    handle: '',
    description: '',
    notes: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Available tags for filtering
  const availableTags = [
    'custom-design', 't-shirt', 'hoodie', 'tumbler', 'dtf-transfer',
    'creative', 'unboxing', 'tutorial', 'style', 'personalized'
  ]

  useEffect(() => {
    if (activeTab === 'social') {
      loadPosts()
    }
  }, [sortBy, platformFilter, tagFilter, activeTab])

  const loadPosts = async () => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams({ sort: sortBy })
      if (platformFilter !== 'all') params.set('platform', platformFilter)

      const result = await apiFetch(`/api/social/posts?${params.toString()}`)
      let fetchedPosts: SocialPost[] = result?.posts || []

      // Backend doesn't support tag filtering server-side — filter client-side.
      if (tagFilter.length > 0) {
        fetchedPosts = fetchedPosts.filter(post => tagFilter.some(tag => (post.tags || []).includes(tag)))
      }

      setPosts(fetchedPosts)
    } catch (error) {
      console.error('Error loading posts:', error)
      setPosts([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmitContent = async () => {
    try {
      setIsSubmitting(true)

      const validation = validateSocialUrl(submissionForm.url)
      if (!validation.isValid) {
        alert(`Invalid URL: ${validation.error}`)
        return
      }

      await apiFetch('/api/social/submissions', {
        method: 'POST',
        body: JSON.stringify({
          platform: validation.platform,
          url: submissionForm.url,
          submitterHandle: submissionForm.handle,
          featuredProducts: submissionForm.featuredProducts.split(',').map(p => p.trim()).filter(Boolean),
          description: submissionForm.description,
          notes: submissionForm.notes
        })
      })

      // Reset form
      setSubmissionForm({
        url: '',
        featuredProducts: '',
        handle: '',
        description: '',
        notes: ''
      })
      setShowSubmissionModal(false)

      alert('Content submitted successfully! It will be reviewed by our team.')
    } catch (error: any) {
      console.error('Error submitting content:', error)
      alert(error?.message || 'Failed to submit content. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVote = async (postId: string, direction: 'up' | 'down') => {
    if (!user) {
      alert('Please sign in to vote')
      return
    }

    try {
      const result = await apiFetch(`/api/social/posts/${postId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ voteType: direction })
      })
      const voteChange = result?.voteChange || 0
      setPosts(prev => prev.map(post =>
        post.id === postId ? { ...post, votes: post.votes + voteChange } : post
      ))
    } catch (error) {
      console.error('Error voting:', error)
    }
  }

  const toggleTag = (tag: string) => {
    setTagFilter(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'tiktok':
        return (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
          </svg>
        )
      case 'instagram':
        return (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
        )
      case 'youtube':
        return (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
        )
      case 'twitter':
        return (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        )
      default:
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )
    }
  }

  const getPlatformStyles = (platform: string) => {
    switch (platform) {
      case 'tiktok': return 'bg-slate-900 text-white'
      case 'instagram': return 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 text-white'
      case 'youtube': return 'bg-red-600 text-white'
      case 'twitter': return 'bg-slate-900 text-white'
      default: return 'bg-slate-500 text-white'
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <div className="min-h-screen bg-bg pb-16">
      {/* Header Section */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 relative">
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-white mb-4">
              Community
            </h1>
            <p className="text-lg sm:text-xl text-purple-100 mb-8 max-w-2xl mx-auto">
              Discover amazing creations, boost your favorites, and earn ITC rewards!
            </p>

            {/* Tab Buttons */}
            <div className="inline-flex items-center gap-2 p-1 bg-white/10 rounded-xl backdrop-blur-sm">
              <button
                onClick={() => setActiveTab('showcase')}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
                  activeTab === 'showcase'
                    ? 'bg-white text-purple-700 shadow-lg'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <Sparkles className="w-5 h-5" />
                Creator Showcase
              </button>
              <button
                onClick={() => setActiveTab('social')}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
                  activeTab === 'social'
                    ? 'bg-white text-purple-700 shadow-lg'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <Share2 className="w-5 h-5" />
                Social Media
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'showcase' ? (
          /* Creator Showcase Tab */
          <div>
            {/* Info Banner */}
            <div className="mb-8 p-4 bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border border-orange-500/20 rounded-xl">
              <div className="flex items-start gap-3">
                <Rocket className="w-6 h-6 text-orange-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-text mb-1">Boost & Earn ITC</h3>
                  <p className="text-sm text-muted">
                    Vote on your favorite designs for free, or spend ITC to boost them higher!
                    Creators earn 1 ITC for every boost they receive. The more boosts, the higher they rank!
                  </p>
                </div>
              </div>
            </div>

            <CommunityShowcase showLeaderboard={true} />
          </div>
        ) : (
          /* Social Media Tab - real feed backed by /api/social/posts */
          <div>
            {/* Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'tiktok', 'instagram', 'youtube', 'twitter'] as const).map(platform => (
                  <button
                    key={platform}
                    onClick={() => setPlatformFilter(platform)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${
                      platformFilter === platform
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                        : 'bg-card border border-white/10 text-muted hover:text-text'
                    }`}
                  >
                    {platform}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-3 py-2 bg-card border border-white/10 rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                >
                  <option value="recent">Most Recent</option>
                  <option value="votes">Most Voted</option>
                  <option value="featured">Featured First</option>
                </select>
                <button
                  onClick={() => setShowSubmissionModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Submit Your Creation
                </button>
              </div>
            </div>

            {/* Tag filter chips */}
            <div className="flex flex-wrap gap-2 mb-8">
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    tagFilter.includes(tag)
                      ? 'bg-purple-600 text-white'
                      : 'bg-card border border-white/10 text-muted hover:text-text'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600"></div>
              </div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="bg-card rounded-2xl shadow-soft border border-white/10 p-12 text-center max-w-lg mx-auto">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                    <Share2 className="w-12 h-12 text-purple-400" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-text mb-3">No posts yet</h2>
                  <p className="text-muted mb-6">
                    Be the first to share your TikTok, Instagram, YouTube, or Twitter/X post
                    featuring your creations!
                  </p>
                  <button
                    onClick={() => setShowSubmissionModal(true)}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-all"
                  >
                    Submit Your Creation
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {posts.map(post => (
                  <div key={post.id} className="bg-card rounded-xl shadow-lg border border-white/10 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg inline-flex items-center gap-1 ${getPlatformStyles(post.platform)}`}>
                        {getPlatformIcon(post.platform)}
                        {post.platform}
                      </span>
                      {post.is_featured && (
                        <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700">
                          Featured
                        </span>
                      )}
                    </div>

                    <div className="relative h-48 bg-black/20">
                      {post.thumbnail_url ? (
                        <img src={post.thumbnail_url} alt={post.title || 'Community post'} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Share2 className="w-12 h-12 text-muted" />
                        </div>
                      )}
                    </div>

                    <div className="p-4">
                      <h3 className="font-medium text-text mb-1 truncate">{post.title || 'Untitled'}</h3>
                      <p className="text-sm text-muted mb-3">@{post.author_username || post.author_display_name || 'unknown'}</p>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleVote(post.id, 'up')}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-emerald-400 transition-colors"
                            title="Upvote"
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <span className="text-sm font-semibold text-text">{formatNumber(post.votes || 0)}</span>
                          <button
                            onClick={() => handleVote(post.id, 'down')}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-red-400 transition-colors"
                            title="Downvote"
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                        </div>
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 font-medium"
                        >
                          View <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>

                      {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {post.tags.map(tag => (
                            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-muted">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submission Modal */}
      {showSubmissionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-white/10">
            <div className="px-6 py-4 border-b border-white/10 sticky top-0 bg-card">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-display font-bold text-text">Submit Your Creation</h3>
                <button
                  onClick={() => setShowSubmissionModal(false)}
                  className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
                <h4 className="font-semibold text-purple-400 mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Submission Guidelines
                </h4>
                <ul className="text-sm text-purple-300/80 space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    Share content featuring our products or designs
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    Supported platforms: TikTok, Instagram, YouTube, Twitter/X
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    Content will be reviewed before appearing on the site
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    High-quality, original content is more likely to be featured
                  </li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Post URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={submissionForm.url}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full px-4 py-3 bg-bg border border-white/10 rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="https://www.tiktok.com/@user/video/123..."
                  required
                />
                <p className="text-xs text-muted mt-1.5">
                  Paste the full URL of your TikTok, Instagram, YouTube, or Twitter post
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Featured Products <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={submissionForm.featuredProducts}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, featuredProducts: e.target.value }))}
                  className="w-full px-4 py-3 bg-bg border border-white/10 rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="Custom T-Shirt, DTF Transfer, etc."
                  required
                />
                <p className="text-xs text-muted mt-1.5">
                  List the products shown in your content (separated by commas)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Your Handle <span className="text-muted">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={submissionForm.handle}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, handle: e.target.value }))}
                  className="w-full px-4 py-3 bg-bg border border-white/10 rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  placeholder="@yourusername"
                />
                <p className="text-xs text-muted mt-1.5">
                  Your social media handle for attribution
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Description <span className="text-muted">(Optional)</span>
                </label>
                <textarea
                  value={submissionForm.description}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-3 bg-bg border border-white/10 rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none"
                  placeholder="Brief description of your content..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Additional Notes <span className="text-muted">(Optional)</span>
                </label>
                <textarea
                  value={submissionForm.notes}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-3 bg-bg border border-white/10 rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none"
                  placeholder="Anything else you'd like us to know..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between sticky bottom-0 bg-card">
              <button
                onClick={() => setShowSubmissionModal(false)}
                className="px-6 py-2.5 text-muted hover:text-text font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitContent}
                disabled={isSubmitting || !submissionForm.url || !submissionForm.featuredProducts}
                className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:bg-white/10 disabled:text-muted disabled:cursor-not-allowed font-semibold transition-all"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Submitting...
                  </span>
                ) : 'Submit for Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Community
