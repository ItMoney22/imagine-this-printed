import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { socialService } from '../utils/social-service'
import type { SocialSubmission, SocialPost, SocialAnalytics, Product } from '../types'

const SocialContentManagement: React.FC = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'analytics'>('pending')
  const [pendingSubmissions, setPendingSubmissions] = useState<SocialSubmission[]>([])
  const [approvedPosts, setApprovedPosts] = useState<SocialPost[]>([])
  const [analytics, setAnalytics] = useState<SocialAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSubmission, setSelectedSubmission] = useState<SocialSubmission | null>(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    action: 'approve' as 'approve' | 'reject',
    productIds: [] as string[],
    tags: [] as string[],
    adminNotes: '',
    shouldFeature: false
  })

  // Mock products for tagging
  const [products] = useState<Product[]>([
    { id: 'product_1', name: 'Custom T-Shirt', description: '', price: 24.99, images: [], category: 'shirts', inStock: true },
    { id: 'product_2', name: 'DTF Transfer', description: '', price: 15.99, images: [], category: 'dtf-transfers', inStock: true },
    { id: 'product_3', name: 'Custom Tumbler', description: '', price: 32.99, images: [], category: 'tumblers', inStock: true },
    { id: 'product_4', name: 'Premium Hoodie', description: '', price: 45.99, images: [], category: 'hoodies', inStock: true }
  ])

  const availableTags = [
    'custom-design', 't-shirt', 'hoodie', 'tumbler', 'dtf-transfer',
    'creative', 'unboxing', 'tutorial', 'style', 'personalized',
    'before-after', 'showcase', 'review', 'diy'
  ]

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder')) {
      loadData()
    }
  }, [user, activeTab])

  const loadData = async () => {
    try {
      setIsLoading(true)
      
      if (activeTab === 'pending') {
        const submissions = await socialService.getPendingSubmissions()
        setPendingSubmissions(submissions)
      } else if (activeTab === 'approved') {
        const posts = await socialService.getSocialPosts('recent')
        setApprovedPosts(posts)
      } else if (activeTab === 'analytics') {
        const analyticsData = await socialService.getSocialAnalytics()
        setAnalytics(analyticsData)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const openReviewModal = (submission: SocialSubmission) => {
    setSelectedSubmission(submission)
    setReviewForm({
      action: 'approve',
      productIds: [],
      tags: [],
      adminNotes: '',
      shouldFeature: false
    })
    setShowReviewModal(true)
  }

  const handleReviewSubmission = async () => {
    if (!selectedSubmission || !user) return

    try {
      const result = await socialService.processSubmission(
        selectedSubmission.id,
        reviewForm.action,
        user.id,
        reviewForm.adminNotes,
        reviewForm.productIds,
        reviewForm.tags
      )

      if (result && reviewForm.shouldFeature) {
        await socialService.toggleFeaturePost(result.id, user.id)
      }

      // Remove from pending list
      setPendingSubmissions(prev => prev.filter(sub => sub.id !== selectedSubmission.id))
      
      setShowReviewModal(false)
      setSelectedSubmission(null)
      
      alert(`Submission ${reviewForm.action === 'approve' ? 'approved' : 'rejected'} successfully!`)
    } catch (error) {
      console.error('Error processing submission:', error)
      alert('Failed to process submission')
    }
  }

  const toggleFeaturePost = async (postId: string) => {
    if (!user) return

    try {
      const isFeatured = await socialService.toggleFeaturePost(postId, user.id)
      setApprovedPosts(prev => prev.map(post =>
        post.id === postId 
          ? { ...post, isFeatured, featuredAt: isFeatured ? new Date().toISOString() : undefined }
          : post
      ))
    } catch (error) {
      console.error('Error toggling feature status:', error)
    }
  }

  const toggleTag = (tag: string) => {
    setReviewForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) 
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag]
    }))
  }

  const toggleProduct = (productId: string) => {
    setReviewForm(prev => ({
      ...prev,
      productIds: prev.productIds.includes(productId)
        ? prev.productIds.filter(id => id !== productId)
        : [...prev.productIds, productId]
    }))
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

  if (!user || (user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Admin access required.</p>
        </div>
      </div>
    )
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">Social Content Management</h1>
        <p className="text-muted">Review and manage community submissions</p>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'pending', label: 'Pending Review', icon: '⏳', count: pendingSubmissions.length },
            { id: 'approved', label: 'Approved Posts', icon: '✅', count: approvedPosts.length },
            { id: 'analytics', label: 'Analytics', icon: '📊' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-2 bg-gray-200 text-muted px-2 py-1 rounded-full text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Pending Submissions */}
      {activeTab === 'pending' && (
        <div className="space-y-6">
          {pendingSubmissions.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-text mb-2">No pending submissions</h3>
              <p className="text-muted">All submissions have been reviewed!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {pendingSubmissions.map((submission) => (
                <div key={submission.id} className="bg-card rounded-lg shadow">
                  <div className="px-6 py-4 border-b card-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${getPlatformColor(submission.platform)}`}>
                          {getPlatformIcon(submission.platform)} {submission.platform}
                        </span>
                        <span className="text-sm text-muted">
                          Submitted {new Date(submission.submittedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
                        Pending Review
                      </span>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div>
                      <h3 className="font-medium text-text mb-2">Submission Details</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-muted">URL: </span>
                          <a 
                            href={submission.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-purple-600 hover:text-purple-800 break-all"
                          >
                            {submission.url}
                          </a>
                        </div>
                        {submission.submitterHandle && (
                          <div>
                            <span className="font-medium text-muted">Handle: </span>
                            <span>{submission.submitterHandle}</span>
                          </div>
                        )}
                        <div>
                          <span className="font-medium text-muted">Featured Products: </span>
                          <span>{submission.featuredProducts.join(', ')}</span>
                        </div>
                        {submission.description && (
                          <div>
                            <span className="font-medium text-muted">Description: </span>
                            <span>{submission.description}</span>
                          </div>
                        )}
                        {submission.notes && (
                          <div>
                            <span className="font-medium text-muted">Notes: </span>
                            <span>{submission.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex space-x-3">
                      <button
                        onClick={() => openReviewModal(submission)}
                        className="btn-primary flex-1"
                      >
                        Review Submission
                      </button>
                      <a
                        href={submission.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary flex-1 text-center"
                      >
                        View Original
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Approved Posts */}
      {activeTab === 'approved' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {approvedPosts.map((post) => (
              <div key={post.id} className="bg-card rounded-lg shadow overflow-hidden">
                <div className="px-4 py-3 border-b card-border">
                  <div className="flex items-center justify-between">
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

                <div className="relative">
                  <img
                    src={post.thumbnailUrl || 'https://via.placeholder.com/400x300?text=Social+Post'}
                    alt={post.title}
                    className="w-full h-48 object-cover"
                  />
                </div>

                <div className="p-4">
                  <h3 className="font-medium text-text mb-2">{post.title}</h3>
                  <p className="text-sm text-muted mb-3">@{post.author.username}</p>

                  <div className="flex items-center justify-between text-sm text-muted mb-3">
                    <div className="flex items-center space-x-3">
                      <span>👀 {formatNumber(post.viewCount)}</span>
                      <span>👍 {post.votes}</span>
                    </div>
                    <span>{new Date(post.submittedAt).toLocaleDateString()}</span>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={() => toggleFeaturePost(post.id)}
                      className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                        post.isFeatured
                          ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                          : 'bg-card text-text hover:bg-gray-200'
                      }`}
                    >
                      {post.isFeatured ? 'Unfeature' : 'Feature'}
                    </button>
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3 py-2 text-sm bg-purple-100 text-purple-700 hover:bg-purple-200 rounded text-center transition-colors"
                    >
                      View
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analytics */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-card p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-muted">Total Posts</h3>
              <p className="text-2xl font-bold text-purple-600">{analytics.totalPosts}</p>
            </div>
            <div className="bg-card p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-muted">Total Views</h3>
              <p className="text-2xl font-bold text-blue-600">{formatNumber(analytics.totalViews)}</p>
            </div>
            <div className="bg-card p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-muted">Total Engagement</h3>
              <p className="text-2xl font-bold text-green-600">{formatNumber(analytics.totalEngagement)}</p>
            </div>
            <div className="bg-card p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-muted">Avg Engagement Rate</h3>
              <p className="text-2xl font-bold text-yellow-600">
                {((analytics.totalEngagement / analytics.totalViews) * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Platform Breakdown */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Platform Performance</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(analytics.platformBreakdown).map(([platform, data]) => (
                  <div key={platform} className="text-center">
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full ${getPlatformColor(platform)} mb-2`}>
                      <span className="text-xl">{getPlatformIcon(platform)}</span>
                    </div>
                    <h4 className="font-medium text-text capitalize">{platform}</h4>
                    <div className="text-sm text-muted space-y-1">
                      <p>{data.count} posts</p>
                      <p>{formatNumber(data.views)} views</p>
                      <p>{formatNumber(data.engagement)} engagement</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Posts & Featured Products */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-lg shadow">
              <div className="px-6 py-4 border-b card-border">
                <h3 className="text-lg font-medium text-text">Top Performing Posts</h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {analytics.topPerformingPosts.map((post, index) => (
                    <div key={post.postId} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-text">{post.title}</p>
                          <p className="text-xs text-muted capitalize">{post.platform}</p>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium text-text">{formatNumber(post.views)} views</p>
                        <p className="text-muted">{formatNumber(post.engagement)} engagement</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow">
              <div className="px-6 py-4 border-b card-border">
                <h3 className="text-lg font-medium text-text">Featured Products</h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {analytics.featuredProducts.map((product, index) => (
                    <div key={product.productId} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-text">{product.productName}</p>
                          <p className="text-xs text-muted">{product.mentionCount} mentions</p>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium text-text">{formatNumber(product.totalViews)} views</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {showReviewModal && selectedSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b card-border">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-text">Review Submission</h3>
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="text-gray-400 hover:text-muted"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Submission Info */}
              <div className="bg-card p-4 rounded-lg">
                <h4 className="font-medium text-text mb-2">Submission Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-muted">Platform: </span>
                    <span className="capitalize">{selectedSubmission.platform}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted">Submitted: </span>
                    <span>{new Date(selectedSubmission.submittedAt).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted">Handle: </span>
                    <span>{selectedSubmission.submitterHandle || 'Not provided'}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted">Products: </span>
                    <span>{selectedSubmission.featuredProducts.join(', ')}</span>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="font-medium text-muted">URL: </span>
                  <a 
                    href={selectedSubmission.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-purple-600 hover:text-purple-800 break-all"
                  >
                    {selectedSubmission.url}
                  </a>
                </div>
                {selectedSubmission.description && (
                  <div className="mt-3">
                    <span className="font-medium text-muted">Description: </span>
                    <span>{selectedSubmission.description}</span>
                  </div>
                )}
              </div>

              {/* Review Action */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">Action</label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="approve"
                      checked={reviewForm.action === 'approve'}
                      onChange={(e) => setReviewForm(prev => ({ ...prev, action: e.target.value as any }))}
                      className="form-radio text-green-600"
                    />
                    <span className="ml-2 text-sm text-text">Approve</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="reject"
                      checked={reviewForm.action === 'reject'}
                      onChange={(e) => setReviewForm(prev => ({ ...prev, action: e.target.value as any }))}
                      className="form-radio text-red-600"
                    />
                    <span className="ml-2 text-sm text-text">Reject</span>
                  </label>
                </div>
              </div>

              {reviewForm.action === 'approve' && (
                <>
                  {/* Product Tagging */}
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">Tag Products</label>
                    <div className="grid grid-cols-2 gap-2">
                      {products.map(product => (
                        <label key={product.id} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={reviewForm.productIds.includes(product.id)}
                            onChange={() => toggleProduct(product.id)}
                            className="form-checkbox"
                          />
                          <span className="ml-2 text-sm text-text">{product.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Tag Selection */}
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">Add Tags</label>
                    <div className="flex flex-wrap gap-2">
                      {availableTags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            reviewForm.tags.includes(tag)
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-200 text-text hover:bg-gray-300'
                          }`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Feature Option */}
                  <div>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={reviewForm.shouldFeature}
                        onChange={(e) => setReviewForm(prev => ({ ...prev, shouldFeature: e.target.checked }))}
                        className="form-checkbox"
                      />
                      <span className="ml-2 text-sm text-text">Feature this content</span>
                    </label>
                    <p className="text-xs text-muted mt-1">Featured content appears on the homepage and gets higher visibility</p>
                  </div>
                </>
              )}

              {/* Admin Notes */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Admin Notes {reviewForm.action === 'reject' && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  value={reviewForm.adminNotes}
                  onChange={(e) => setReviewForm(prev => ({ ...prev, adminNotes: e.target.value }))}
                  rows={3}
                  className="form-input w-full"
                  placeholder={reviewForm.action === 'approve' ? 'Optional notes...' : 'Please provide a reason for rejection...'}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t card-border flex items-center justify-between">
              <button
                onClick={() => setShowReviewModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleReviewSubmission}
                disabled={reviewForm.action === 'reject' && !reviewForm.adminNotes.trim()}
                className={`px-6 py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                  reviewForm.action === 'approve'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {reviewForm.action === 'approve' ? 'Approve' : 'Reject'} Submission
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SocialContentManagement