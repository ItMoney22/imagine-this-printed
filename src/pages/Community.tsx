import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { socialService } from '../utils/social-service'
import type { SocialPost, SocialSubmission } from '../types'

const Community: React.FC = () => {
  const { user } = useAuth()
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
    loadPosts()
  }, [sortBy, platformFilter, tagFilter])

  const loadPosts = async () => {
    try {
      setIsLoading(true)
      const fetchedPosts = await socialService.getSocialPosts(
        sortBy,
        platformFilter === 'all' ? undefined : platformFilter,
        tagFilter.length > 0 ? tagFilter : undefined
      )
      setPosts(fetchedPosts)
    } catch (error) {
      console.error('Error loading posts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmitContent = async () => {
    try {
      setIsSubmitting(true)

      // Validate URL
      const validation = socialService.validateSocialUrl(submissionForm.url)
      if (!validation.isValid) {
        alert(`Invalid URL: ${validation.error}`)
        return
      }

      const submission: Omit<SocialSubmission, 'id' | 'submittedAt' | 'status'> = {
        platform: validation.platform as any,
        url: submissionForm.url,
        submittedBy: user?.id || 'anonymous',
        submitterHandle: submissionForm.handle,
        featuredProducts: submissionForm.featuredProducts.split(',').map(p => p.trim()).filter(Boolean),
        description: submissionForm.description,
        notes: submissionForm.notes
      }

      await socialService.submitSocialContent(submission)
      
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
    } catch (error) {
      console.error('Error submitting content:', error)
      alert('Failed to submit content. Please try again.')
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
      const newVoteCount = await socialService.voteOnPost(postId, user.id, direction)
      setPosts(prev => prev.map(post => 
        post.id === postId ? { ...post, votes: newVoteCount } : post
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
      case 'tiktok': return '🎵'
      case 'instagram': return '📷'
      case 'youtube': return '📹'
      case 'twitter': return '🐦'
      default: return '📱'
    }
  }

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'tiktok': return 'bg-black text-white'
      case 'instagram': return 'bg-pink-500 text-white'
      case 'youtube': return 'bg-red-600 text-white'
      case 'twitter': return 'bg-blue-500 text-white'
      default: return 'bg-card0 text-white'
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-text mb-4">Community Showcase</h1>
        <p className="text-xl text-muted mb-6">
          See how our customers bring their designs to life! Share your creations and get featured.
        </p>
        <button
          onClick={() => setShowSubmissionModal(true)}
          className="btn-primary text-lg px-8 py-3"
        >
          Submit Your Creation
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b card-border">
          <div className="flex flex-wrap items-center gap-4">
            {/* Sort By */}
            <div>
              <label className="block text-sm font-medium text-text mb-1">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="form-select"
              >
                <option value="recent">Most Recent</option>
                <option value="votes">Top Voted</option>
                <option value="featured">Featured</option>
              </select>
            </div>

            {/* Platform Filter */}
            <div>
              <label className="block text-sm font-medium text-text mb-1">Platform</label>
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="form-select"
              >
                <option value="all">All Platforms</option>
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube</option>
                <option value="twitter">Twitter</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tag Filters */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-text mb-2">Filter by tags</label>
          <div className="flex flex-wrap gap-2">
            {availableTags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  tagFilter.includes(tag)
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-200 text-text hover:bg-gray-300'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Posts Grid */}
      {posts.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10m-10 0a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2m-10 0V4" />
          </svg>
          <h3 className="text-lg font-medium text-text mb-2">No posts found</h3>
          <p className="text-muted">Try adjusting your filters or be the first to submit content!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <div key={post.id} className="bg-card rounded-lg shadow overflow-hidden">
              {/* Post Header */}
              <div className="px-4 py-3 border-b card-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <img
                      src={post.author.profileImage || 'https://via.placeholder.com/40x40?text=User'}
                      alt={post.author.displayName}
                      className="w-8 h-8 rounded-full"
                    />
                    <div>
                      <p className="font-medium text-text">{post.author.displayName}</p>
                      <p className="text-sm text-muted">{post.author.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${getPlatformColor(post.platform)}`}>
                      {getPlatformIcon(post.platform)} {post.platform}
                    </span>
                    {post.isFeatured && (
                      <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
                        ⭐ Featured
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Post Content */}
              <div className="relative">
                {post.platform === 'tiktok' && post.embedCode ? (
                  <div 
                    className="w-full aspect-[9/16] max-h-96 overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: post.embedCode }}
                  />
                ) : (
                  <div className="relative">
                    <img
                      src={post.thumbnailUrl || 'https://via.placeholder.com/400x400?text=Social+Post'}
                      alt={post.title}
                      className="w-full h-64 object-cover"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-card text-text px-4 py-2 rounded-full font-medium hover:bg-card transition-colors"
                      >
                        View Original
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Post Info */}
              <div className="px-4 py-3">
                <h3 className="font-medium text-text mb-2">{post.title}</h3>
                {post.description && (
                  <p className="text-sm text-muted mb-3 line-clamp-2">{post.description}</p>
                )}

                {/* Tags */}
                {post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {post.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="px-2 py-1 text-xs bg-card text-muted rounded">
                        #{tag}
                      </span>
                    ))}
                    {post.tags.length > 3 && (
                      <span className="px-2 py-1 text-xs bg-card text-muted rounded">
                        +{post.tags.length - 3} more
                      </span>
                    )}
                  </div>
                )}

                {/* Engagement Stats */}
                <div className="flex items-center justify-between text-sm text-muted mb-3">
                  <div className="flex items-center space-x-4">
                    <span>👀 {formatNumber(post.viewCount)}</span>
                    <span>❤️ {formatNumber(post.engagement.likes)}</span>
                    <span>💬 {formatNumber(post.engagement.comments)}</span>
                  </div>
                  <span>{new Date(post.submittedAt).toLocaleDateString()}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleVote(post.id, 'up')}
                      className="flex items-center space-x-1 px-3 py-1 text-sm bg-card hover:bg-gray-200 rounded-full transition-colors"
                    >
                      <span>👍</span>
                      <span>{post.votes}</span>
                    </button>
                    <button className="flex items-center space-x-1 px-3 py-1 text-sm bg-card hover:bg-gray-200 rounded-full transition-colors">
                      <span>💬</span>
                      <span>{post.comments.length}</span>
                    </button>
                  </div>
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 hover:text-purple-800 text-sm font-medium"
                  >
                    View Original →
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Submission Modal */}
      {showSubmissionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b card-border">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-text">Submit Your Creation</h3>
                <button
                  onClick={() => setShowSubmissionModal(false)}
                  className="text-gray-400 hover:text-muted"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <h4 className="font-medium text-blue-900 mb-2">Submission Guidelines</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Share content featuring our products or designs</li>
                  <li>• Supported platforms: TikTok, Instagram, YouTube, Twitter</li>
                  <li>• Content will be reviewed before appearing on the site</li>
                  <li>• High-quality, original content is more likely to be featured</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Post URL *
                </label>
                <input
                  type="url"
                  value={submissionForm.url}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, url: e.target.value }))}
                  className="form-input w-full"
                  placeholder="https://www.tiktok.com/@user/video/123... or https://instagram.com/p/..."
                  required
                />
                <p className="text-xs text-muted mt-1">
                  Paste the full URL of your TikTok, Instagram, YouTube, or Twitter post
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Featured Products *
                </label>
                <input
                  type="text"
                  value={submissionForm.featuredProducts}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, featuredProducts: e.target.value }))}
                  className="form-input w-full"
                  placeholder="Custom T-Shirt, DTF Transfer, etc."
                  required
                />
                <p className="text-xs text-muted mt-1">
                  List the products shown in your content (separated by commas)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Your Handle (Optional)
                </label>
                <input
                  type="text"
                  value={submissionForm.handle}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, handle: e.target.value }))}
                  className="form-input w-full"
                  placeholder="@yourusername"
                />
                <p className="text-xs text-muted mt-1">
                  Your social media handle for attribution
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Description
                </label>
                <textarea
                  value={submissionForm.description}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="form-input w-full"
                  placeholder="Brief description of your content..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Additional Notes
                </label>
                <textarea
                  value={submissionForm.notes}
                  onChange={(e) => setSubmissionForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="form-input w-full"
                  placeholder="Anything else you'd like us to know..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t card-border flex items-center justify-between">
              <button
                onClick={() => setShowSubmissionModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitContent}
                disabled={isSubmitting || !submissionForm.url || !submissionForm.featuredProducts}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : 'Submit for Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Community