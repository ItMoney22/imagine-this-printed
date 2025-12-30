import React, { useState, useEffect, useCallback } from 'react'
import { Sparkles, TrendingUp, Clock, Filter, Loader2 } from 'lucide-react'
import type { CommunityPost } from '../../types'
import { communityService } from '../../utils/community-service'
import type { CommunitySortOption, CommunityFilterOption } from '../../utils/community-service'
import CommunityPostCard from './CommunityPostCard'
import CreatorLeaderboard from './CreatorLeaderboard'

interface CommunityShowcaseProps {
  showLeaderboard?: boolean
}

const CommunityShowcase: React.FC<CommunityShowcaseProps> = ({
  showLeaderboard = true
}) => {
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sort, setSort] = useState<CommunitySortOption>('most_boosted')
  const [filter, setFilter] = useState<CommunityFilterOption>('all')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadPosts = useCallback(async (pageNum: number, reset: boolean = false) => {
    if (reset) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const response = await communityService.getCommunityFeed({
        sort,
        filter,
        page: pageNum,
        limit: 20
      })

      if (response.ok) {
        if (reset) {
          setPosts(response.posts)
        } else {
          setPosts(prev => [...prev, ...response.posts])
        }
        setHasMore(pageNum < response.pagination.totalPages)
      }
    } catch (error) {
      console.error('Failed to load posts:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [sort, filter])

  useEffect(() => {
    setPage(1)
    loadPosts(1, true)
  }, [sort, filter])

  const handleLoadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    loadPosts(nextPage, false)
  }

  const handleVoteChange = (postId: string, voted: boolean) => {
    setPosts(prev => prev.map(post => {
      if (post.id === postId) {
        return {
          ...post,
          user_has_voted: voted,
          free_vote_count: voted ? post.free_vote_count + 1 : Math.max(0, post.free_vote_count - 1),
          total_boost_score: voted ? post.total_boost_score + 1 : Math.max(0, post.total_boost_score - 1)
        }
      }
      return post
    }))
  }

  const handleBoostSuccess = (postId: string, newScore: number) => {
    setPosts(prev => prev.map(post => {
      if (post.id === postId) {
        return {
          ...post,
          paid_boost_count: post.paid_boost_count + 1,
          total_boost_score: newScore
        }
      }
      return post
    }))
  }

  const sortOptions: { value: CommunitySortOption; label: string; icon: React.ReactNode }[] = [
    { value: 'most_boosted', label: 'Most Boosted', icon: <Sparkles className="w-4 h-4" /> },
    { value: 'trending', label: 'Trending', icon: <TrendingUp className="w-4 h-4" /> },
    { value: 'recent', label: 'Recent', icon: <Clock className="w-4 h-4" /> }
  ]

  const filterOptions: { value: CommunityFilterOption; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'designs', label: 'Designs' },
    { value: 'vendor_products', label: 'Products' }
  ]

  return (
    <div className="space-y-6">
      {/* Leaderboard */}
      {showLeaderboard && (
        <div className="mb-8">
          <CreatorLeaderboard limit={5} />
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Sort Buttons */}
        <div className="flex items-center gap-1 bg-card rounded-lg p-1 border border-white/10">
          {sortOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setSort(option.value)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                sort === option.value
                  ? 'bg-primary text-white'
                  : 'text-muted hover:text-text hover:bg-white/5'
              }`}
            >
              {option.icon}
              <span className="hidden sm:inline">{option.label}</span>
            </button>
          ))}
        </div>

        {/* Filter Dropdown */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as CommunityFilterOption)}
            className="bg-card border border-white/10 rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-purple-500"
          >
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Posts Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-card rounded-xl border border-white/10 overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10" />
                  <div className="flex-1">
                    <div className="h-4 w-24 bg-white/10 rounded mb-1" />
                    <div className="h-3 w-16 bg-white/10 rounded" />
                  </div>
                </div>
                <div className="aspect-square bg-white/5" />
                <div className="p-4 space-y-3">
                  <div className="h-4 w-3/4 bg-white/10 rounded" />
                  <div className="h-3 w-1/2 bg-white/10 rounded" />
                  <div className="flex gap-4">
                    <div className="h-4 w-12 bg-white/10 rounded" />
                    <div className="h-4 w-12 bg-white/10 rounded" />
                    <div className="h-4 w-12 bg-white/10 rounded" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16">
          <Sparkles className="w-16 h-16 mx-auto mb-4 text-muted/30" />
          <h3 className="text-xl font-semibold text-text mb-2">No posts yet</h3>
          <p className="text-muted max-w-md mx-auto">
            Be the first to share your design or product with the community!
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {posts.map((post) => (
              <CommunityPostCard
                key={post.id}
                post={post}
                onVoteChange={handleVoteChange}
                onBoostSuccess={handleBoostSuccess}
              />
            ))}
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div className="flex justify-center mt-8">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 px-6 py-3 bg-card border border-white/10 rounded-lg font-medium text-text hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CommunityShowcase
