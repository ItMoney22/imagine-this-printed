import { apiFetch } from '../lib/api'
import type {
  CommunityPost,
  CommunityLeaderboardEntry,
  CommunityBoostEarning,
  CommunityFeedResponse,
  CommunityLeaderboardResponse,
  CommunityBoostResponse,
  CommunityEarningsResponse
} from '../types'

// Configuration constants (mirrors backend)
export const COMMUNITY_CONFIG = {
  FREE_VOTE_POINTS: 1,
  PAID_BOOST_MULTIPLIER: 1,
  CREATOR_EARN_PER_BOOST: 1,
  MIN_PAID_BOOST_ITC: 1,
  MAX_PAID_BOOST_ITC: 100,
  DEFAULT_PAGE_SIZE: 20,
  LEADERBOARD_SIZE: 5
}

export type CommunitySortOption = 'most_boosted' | 'recent' | 'trending'
export type CommunityFilterOption = 'all' | 'designs' | 'vendor_products'

interface GetCommunityFeedOptions {
  sort?: CommunitySortOption
  filter?: CommunityFilterOption
  page?: number
  limit?: number
}

interface GetLeaderboardOptions {
  period?: 'all_time' | 'this_month' | 'this_week'
  limit?: number
}

class CommunityService {
  /**
   * Get community feed with sorting and filtering
   */
  async getCommunityFeed(options: GetCommunityFeedOptions = {}): Promise<CommunityFeedResponse> {
    const {
      sort = 'most_boosted',
      filter = 'all',
      page = 1,
      limit = COMMUNITY_CONFIG.DEFAULT_PAGE_SIZE
    } = options

    try {
      const params = new URLSearchParams({
        sort,
        filter,
        page: String(page),
        limit: String(limit)
      })

      const response = await apiFetch(`/api/community/feed?${params}`)
      return response as CommunityFeedResponse
    } catch (error) {
      console.error('[CommunityService] getCommunityFeed error:', error)
      return {
        ok: false,
        posts: [],
        pagination: { page, limit, total: 0, totalPages: 0 }
      }
    }
  }

  /**
   * Get top creators leaderboard
   */
  async getLeaderboard(options: GetLeaderboardOptions = {}): Promise<CommunityLeaderboardEntry[]> {
    const { period = 'all_time', limit = COMMUNITY_CONFIG.LEADERBOARD_SIZE } = options

    try {
      const params = new URLSearchParams({
        period,
        limit: String(limit)
      })

      const response = await apiFetch(`/api/community/leaderboard?${params}`)
      return (response as CommunityLeaderboardResponse).leaderboard || []
    } catch (error) {
      console.error('[CommunityService] getLeaderboard error:', error)
      return []
    }
  }

  /**
   * Toggle free vote on a post
   */
  async toggleFreeVote(postId: string): Promise<CommunityBoostResponse> {
    try {
      const response = await apiFetch(`/api/community/posts/${postId}/boost`, {
        method: 'POST'
      })
      return response as CommunityBoostResponse
    } catch (error: any) {
      console.error('[CommunityService] toggleFreeVote error:', error)
      return {
        ok: false,
        message: error.message || 'Failed to vote'
      }
    }
  }

  /**
   * Submit paid ITC boost
   */
  async submitPaidBoost(postId: string, itcAmount: number): Promise<CommunityBoostResponse> {
    if (itcAmount < COMMUNITY_CONFIG.MIN_PAID_BOOST_ITC || itcAmount > COMMUNITY_CONFIG.MAX_PAID_BOOST_ITC) {
      return {
        ok: false,
        message: `ITC amount must be between ${COMMUNITY_CONFIG.MIN_PAID_BOOST_ITC} and ${COMMUNITY_CONFIG.MAX_PAID_BOOST_ITC}`
      }
    }

    try {
      const response = await apiFetch(`/api/community/posts/${postId}/boost-paid`, {
        method: 'POST',
        body: JSON.stringify({ itc_amount: itcAmount })
      })
      return response as CommunityBoostResponse
    } catch (error: any) {
      console.error('[CommunityService] submitPaidBoost error:', error)
      return {
        ok: false,
        message: error.message || 'Failed to boost'
      }
    }
  }

  /**
   * Get user's boost earnings
   */
  async getMyEarnings(limit = 50, offset = 0): Promise<CommunityEarningsResponse> {
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      })

      const response = await apiFetch(`/api/community/my-earnings?${params}`)
      return response as CommunityEarningsResponse
    } catch (error) {
      console.error('[CommunityService] getMyEarnings error:', error)
      return {
        ok: false,
        earnings: [],
        total_earned: 0,
        count: 0
      }
    }
  }

  /**
   * Publish a design to the community
   */
  async publishDesignToCommunity(productId: string, title?: string, description?: string): Promise<{ ok: boolean; post?: CommunityPost; message: string }> {
    try {
      const response = await apiFetch('/api/community/posts', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, title, description })
      })
      return response as { ok: boolean; post?: CommunityPost; message: string }
    } catch (error: any) {
      console.error('[CommunityService] publishDesignToCommunity error:', error)
      return {
        ok: false,
        message: error.message || 'Failed to publish design'
      }
    }
  }

  /**
   * Get a single post by ID
   */
  async getPost(postId: string): Promise<CommunityPost | null> {
    try {
      const response = await apiFetch(`/api/community/posts/${postId}`)
      return (response as { ok: boolean; post: CommunityPost }).post || null
    } catch (error) {
      console.error('[CommunityService] getPost error:', error)
      return null
    }
  }

  /**
   * Format boost count for display (e.g., 1.2K)
   */
  formatBoostCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`
    }
    return String(count)
  }

  /**
   * Get time ago string for display
   */
  getTimeAgo(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return date.toLocaleDateString()
  }
}

export const communityService = new CommunityService()
