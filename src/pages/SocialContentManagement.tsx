import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'

interface SocialSubmission {
  id: string
  platform: string
  url: string
  submitter_handle: string | null
  submitted_by: string | null
  submitted_at: string
  status: string
  description: string | null
  notes: string | null
  featured_products: string[]
  admin_notes: string | null
  processed_by: string | null
  processed_at: string | null
  rejection_reason: string | null
}

interface SocialPost {
  id: string
  platform: string
  url: string
  embed_code: string | null
  thumbnail_url: string | null
  title: string | null
  description: string | null
  author_username: string | null
  author_display_name: string | null
  approved_at: string
  status: string
  tags: string[]
  product_ids: string[]
  votes: number
  is_featured: boolean
  featured_at: string | null
  view_count: number
  engagement: { likes: number; shares: number; comments: number }
}

interface Analytics {
  totalPosts: number
  totalViews: number
  totalVotes: number
  featuredCount: number
  pendingCount: number
  platformBreakdown: {
    tiktok: number
    instagram: number
    youtube: number
    twitter: number
  }
}

const SocialContentManagement: React.FC = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'analytics'>('pending')
  const [pendingSubmissions, setPendingSubmissions] = useState<SocialSubmission[]>([])
  const [approvedPosts, setApprovedPosts] = useState<SocialPost[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSubmission, setSelectedSubmission] = useState<SocialSubmission | null>(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    action: 'approve' as 'approve' | 'reject',
    productIds: [] as string[],
    tags: [] as string[],
    adminNotes: '',
    shouldFeature: false,
    title: '',
    authorUsername: ''
  })

  const availableTags = [
    'custom-design', 't-shirt', 'hoodie', 'tumbler', 'dtf-transfer',
    'creative', 'unboxing', 'tutorial', 'style', 'personalized',
    'before-after', 'showcase', 'review', 'diy'
  ]

  const fetchPendingSubmissions = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('social_submissions')
        .select('*')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false })

      if (fetchError) throw fetchError
      setPendingSubmissions(data || [])
    } catch (err: any) {
      console.error('[social] Error fetching submissions:', err)
      setError(err.message)
    }
  }, [])

  const fetchApprovedPosts = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('social_posts')
        .select('*')
        .in('status', ['approved', 'featured'])
        .order('approved_at', { ascending: false })

      if (fetchError) throw fetchError
      setApprovedPosts(data || [])
    } catch (err: any) {
      console.error('[social] Error fetching posts:', err)
      setError(err.message)
    }
  }, [])

  const fetchAnalytics = useCallback(async () => {
    try {
      const response = await apiFetch('/api/social/analytics')

      if (response.ok) {
        const { analytics: data } = await response.json()
        setAnalytics(data)
      }
    } catch (err: any) {
      console.error('[social] Error fetching analytics:', err)
    }
  }, [])

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder' || user.role === 'manager')) {
      setIsLoading(true)
      setError(null)

      const loadData = async () => {
        if (activeTab === 'pending') {
          await fetchPendingSubmissions()
        } else if (activeTab === 'approved') {
          await fetchApprovedPosts()
        } else if (activeTab === 'analytics') {
          await fetchAnalytics()
        }
        setIsLoading(false)
      }

      loadData()
    }
  }, [user, activeTab, fetchPendingSubmissions, fetchApprovedPosts, fetchAnalytics])

  const openReviewModal = (submission: SocialSubmission) => {
    setSelectedSubmission(submission)
    setReviewForm({
      action: 'approve',
      productIds: [],
      tags: [],
      adminNotes: '',
      shouldFeature: false,
      title: submission.description?.substring(0, 100) || '',
      authorUsername: submission.submitter_handle || ''
    })
    setShowReviewModal(true)
  }

  const handleReviewSubmission = async () => {
    if (!selectedSubmission) return

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    setProcessing(true)
    try {
      const response = await fetch(`/api/social/submissions/${selectedSubmission.id}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: reviewForm.action,
          tags: reviewForm.tags,
          productIds: reviewForm.productIds,
          adminNotes: reviewForm.adminNotes,
          rejectionReason: reviewForm.action === 'reject' ? reviewForm.adminNotes : undefined,
          title: reviewForm.title,
          authorUsername: reviewForm.authorUsername
        })
      })

      if (!response.ok) {
        const { error: errMsg } = await response.json()
        throw new Error(errMsg || 'Failed to process submission')
      }

      // If approved and should feature, toggle feature
      if (reviewForm.action === 'approve' && reviewForm.shouldFeature) {
        const { post } = await response.json()
        if (post?.id) {
          await fetch(`/api/social/posts/${post.id}/feature`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ featured: true })
          })
        }
      }

      // Remove from pending list
      setPendingSubmissions(prev => prev.filter(sub => sub.id !== selectedSubmission.id))
      setShowReviewModal(false)
      setSelectedSubmission(null)
    } catch (err: any) {
      console.error('[social] Error processing submission:', err)
      alert(err.message || 'Failed to process submission')
    } finally {
      setProcessing(false)
    }
  }

  const toggleFeaturePost = async (postId: string, currentlyFeatured: boolean) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    try {
      const response = await fetch(`/api/social/posts/${postId}/feature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ featured: !currentlyFeatured })
      })

      if (response.ok) {
        setApprovedPosts(prev => prev.map(post =>
          post.id === postId
            ? { ...post, is_featured: !currentlyFeatured, featured_at: !currentlyFeatured ? new Date().toISOString() : null }
            : post
        ))
      }
    } catch (err) {
      console.error('[social] Error toggling feature:', err)
    }
  }

  const deletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    try {
      const response = await fetch(`/api/social/posts/${postId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      })

      if (response.ok) {
        setApprovedPosts(prev => prev.filter(post => post.id !== postId))
      }
    } catch (err) {
      console.error('[social] Error deleting post:', err)
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

  const getPlatformBadge = (platform: string) => {
    const styles: Record<string, string> = {
      tiktok: 'bg-black text-white',
      instagram: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 text-white',
      youtube: 'bg-red-600 text-white',
      twitter: 'bg-blue-500 text-white'
    }
    return styles[platform] || 'bg-gray-500 text-white'
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  // Access denied
  if (!user || !['admin', 'founder', 'manager'].includes(user.role || '')) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <p className="text-red-800 font-medium">Access denied. Admin access required.</p>
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="h-8 w-48 bg-white/20 rounded animate-pulse"></div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            <span className="ml-3 text-muted">Loading social content...</span>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <p className="text-red-800">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-purple-600 hover:text-purple-800 font-medium"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Social Content</h1>
              <p className="text-purple-100">Manage user-generated social media content</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Pending</span>
                <p className="text-white text-xl font-bold">{pendingSubmissions.length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Approved</span>
                <p className="text-white text-xl font-bold">{approvedPosts.length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Featured</span>
                <p className="text-white text-xl font-bold">{approvedPosts.filter(p => p.is_featured).length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Pending Review</p>
                <p className="text-2xl font-bold text-text">{pendingSubmissions.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Approved Posts</p>
                <p className="text-2xl font-bold text-text">{approvedPosts.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg shadow-purple-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Featured</p>
                <p className="text-2xl font-bold text-text">{approvedPosts.filter(p => p.is_featured).length}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Views</p>
                <p className="text-2xl font-bold text-text">{formatNumber(approvedPosts.reduce((sum, p) => sum + (p.view_count || 0), 0))}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-2 mb-6">
          <nav className="flex space-x-2">
            {[
              { id: 'pending', label: 'Pending Review', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', count: pendingSubmissions.length },
              { id: 'approved', label: 'Approved Posts', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', count: approvedPosts.length },
              { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                    : 'text-muted hover:text-text hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                    activeTab === tab.id ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Pending Submissions Tab */}
        {activeTab === 'pending' && (
          <div className="space-y-6">
            {pendingSubmissions.length === 0 ? (
              <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-medium text-text mb-2">No pending submissions</h3>
                <p className="text-muted">All submissions have been reviewed!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {pendingSubmissions.map((submission) => (
                  <div key={submission.id} className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden hover:shadow-purple-500/5 transition-shadow">
                    <div className="px-6 py-4 border-b border-purple-100 dark:border-purple-900/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg ${getPlatformBadge(submission.platform)}`}>
                            {submission.platform}
                          </span>
                          <span className="text-sm text-muted">
                            {new Date(submission.submitted_at).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Pending
                        </span>
                      </div>
                    </div>

                    <div className="p-6 space-y-4">
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
                        {submission.submitter_handle && (
                          <div>
                            <span className="font-medium text-muted">Handle: </span>
                            <span className="text-text">@{submission.submitter_handle}</span>
                          </div>
                        )}
                        {submission.description && (
                          <div>
                            <span className="font-medium text-muted">Description: </span>
                            <span className="text-text">{submission.description}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex space-x-3 pt-2">
                        <button
                          onClick={() => openReviewModal(submission)}
                          className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-purple-500/25 transition-all font-medium"
                        >
                          Review
                        </button>
                        <a
                          href={submission.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 px-4 py-2.5 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-xl text-center font-medium transition-colors"
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

        {/* Approved Posts Tab */}
        {activeTab === 'approved' && (
          <div className="space-y-6">
            {approvedPosts.length === 0 ? (
              <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h3 className="text-lg font-medium text-text mb-2">No approved posts yet</h3>
                <p className="text-muted">Approve submissions to see them here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {approvedPosts.map((post) => (
                  <div key={post.id} className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden hover:shadow-purple-500/5 transition-shadow">
                    <div className="px-4 py-3 border-b border-purple-100 dark:border-purple-900/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg ${getPlatformBadge(post.platform)}`}>
                            {post.platform}
                          </span>
                          {post.is_featured && (
                            <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              Featured
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => deletePost(post.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete post"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="relative h-48 bg-gray-100 dark:bg-gray-800">
                      {post.thumbnail_url ? (
                        <img
                          src={post.thumbnail_url}
                          alt={post.title || 'Social post'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="p-4">
                      <h3 className="font-medium text-text mb-1 truncate">{post.title || 'Untitled'}</h3>
                      <p className="text-sm text-muted mb-3">@{post.author_username || 'unknown'}</p>

                      <div className="flex items-center justify-between text-sm text-muted mb-4">
                        <div className="flex items-center space-x-3">
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {formatNumber(post.view_count || 0)}
                          </span>
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                            </svg>
                            {post.votes || 0}
                          </span>
                        </div>
                        <span>{new Date(post.approved_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex space-x-2">
                        <button
                          onClick={() => toggleFeaturePost(post.id, post.is_featured)}
                          className={`flex-1 px-3 py-2 text-sm font-medium rounded-xl transition-all ${
                            post.is_featured
                              ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25'
                              : 'bg-gray-100 dark:bg-gray-800 text-text hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          {post.is_featured ? 'Unfeature' : 'Feature'}
                        </button>
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 px-3 py-2 text-sm font-medium bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-xl text-center transition-colors"
                        >
                          View
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {analytics ? (
              <>
                {/* Platform Breakdown */}
                <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
                  <div className="px-6 py-4 border-b border-purple-100 dark:border-purple-900/30">
                    <h3 className="text-lg font-semibold text-text">Platform Breakdown</h3>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      {Object.entries(analytics.platformBreakdown).map(([platform, count]) => (
                        <div key={platform} className="text-center">
                          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${getPlatformBadge(platform)} mb-3`}>
                            <span className="text-2xl">
                              {platform === 'tiktok' ? '🎵' : platform === 'instagram' ? '📷' : platform === 'youtube' ? '📹' : '🐦'}
                            </span>
                          </div>
                          <h4 className="font-medium text-text capitalize">{platform}</h4>
                          <p className="text-2xl font-bold text-text">{count}</p>
                          <p className="text-sm text-muted">posts</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
                    <h3 className="text-sm font-medium text-muted mb-2">Total Engagement</h3>
                    <p className="text-3xl font-bold text-text">{formatNumber(analytics.totalVotes)}</p>
                    <p className="text-sm text-green-600 mt-1">votes across all posts</p>
                  </div>
                  <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
                    <h3 className="text-sm font-medium text-muted mb-2">Total Views</h3>
                    <p className="text-3xl font-bold text-text">{formatNumber(analytics.totalViews)}</p>
                    <p className="text-sm text-blue-600 mt-1">across all platforms</p>
                  </div>
                  <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
                    <h3 className="text-sm font-medium text-muted mb-2">Pending Queue</h3>
                    <p className="text-3xl font-bold text-text">{analytics.pendingCount}</p>
                    <p className="text-sm text-amber-600 mt-1">submissions waiting</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                <p className="text-muted">Loading analytics...</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Review Modal */}
      {showReviewModal && selectedSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="px-6 py-4 border-b border-purple-100 dark:border-purple-900/30">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text">Review Submission</h3>
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="text-gray-400 hover:text-muted transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Submission Info */}
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4">
                <h4 className="font-medium text-text mb-3">Submission Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-muted">Platform: </span>
                    <span className={`ml-2 px-2 py-0.5 text-xs rounded ${getPlatformBadge(selectedSubmission.platform)}`}>
                      {selectedSubmission.platform}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-muted">Submitted: </span>
                    <span className="text-text">{new Date(selectedSubmission.submitted_at).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted">Handle: </span>
                    <span className="text-text">@{selectedSubmission.submitter_handle || 'Not provided'}</span>
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
              </div>

              {/* Review Action */}
              <div>
                <label className="block text-sm font-medium text-text mb-3">Action</label>
                <div className="flex space-x-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      value="approve"
                      checked={reviewForm.action === 'approve'}
                      onChange={(e) => setReviewForm(prev => ({ ...prev, action: e.target.value as any }))}
                      className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                    />
                    <span className="ml-2 text-sm text-text">Approve</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      value="reject"
                      checked={reviewForm.action === 'reject'}
                      onChange={(e) => setReviewForm(prev => ({ ...prev, action: e.target.value as any }))}
                      className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-text">Reject</span>
                  </label>
                </div>
              </div>

              {reviewForm.action === 'approve' && (
                <>
                  {/* Title & Author */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">Post Title</label>
                      <input
                        type="text"
                        value={reviewForm.title}
                        onChange={(e) => setReviewForm(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
                        placeholder="Enter a title for the post"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">Author Username</label>
                      <input
                        type="text"
                        value={reviewForm.authorUsername}
                        onChange={(e) => setReviewForm(prev => ({ ...prev, authorUsername: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
                        placeholder="@username"
                      />
                    </div>
                  </div>

                  {/* Tag Selection */}
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">Add Tags</label>
                    <div className="flex flex-wrap gap-2">
                      {availableTags.map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                            reviewForm.tags.includes(tag)
                              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                              : 'bg-gray-100 dark:bg-gray-800 text-text hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Feature Option */}
                  <div>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reviewForm.shouldFeature}
                        onChange={(e) => setReviewForm(prev => ({ ...prev, shouldFeature: e.target.checked }))}
                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                      />
                      <span className="ml-2 text-sm text-text">Feature this content</span>
                    </label>
                    <p className="text-xs text-muted mt-1 ml-6">Featured content appears on the homepage and gets higher visibility</p>
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
                  className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text resize-none"
                  placeholder={reviewForm.action === 'approve' ? 'Optional notes...' : 'Please provide a reason for rejection...'}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-purple-100 dark:border-purple-900/30 flex items-center justify-between">
              <button
                onClick={() => setShowReviewModal(false)}
                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-text rounded-xl font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReviewSubmission}
                disabled={processing || (reviewForm.action === 'reject' && !reviewForm.adminNotes.trim())}
                className={`px-6 py-2.5 rounded-xl font-medium shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  reviewForm.action === 'approve'
                    ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-green-500/25'
                    : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-red-500/25'
                }`}
              >
                {processing ? 'Processing...' : `${reviewForm.action === 'approve' ? 'Approve' : 'Reject'} Submission`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SocialContentManagement
