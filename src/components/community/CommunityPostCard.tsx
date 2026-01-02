import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, Rocket, Eye, User, Store, Palette, Crown, BadgeCheck } from 'lucide-react'
import type { CommunityPost } from '../../types'
import { communityService } from '../../utils/community-service'
import { useAuth } from '../../context/SupabaseAuthContext'
import { useMrImagineNotify } from '../MrImagineNotification'
import PaidBoostModal from './PaidBoostModal'

interface CommunityPostCardProps {
  post: CommunityPost
  onVoteChange?: (postId: string, voted: boolean) => void
  onBoostSuccess?: (postId: string, newScore: number) => void
}

const CommunityPostCard: React.FC<CommunityPostCardProps> = ({
  post,
  onVoteChange,
  onBoostSuccess
}) => {
  const { user } = useAuth()
  const [isVoting, setIsVoting] = useState(false)
  const [hasVoted, setHasVoted] = useState(post.user_has_voted || false)
  const [voteCount, setVoteCount] = useState(post.free_vote_count)
  const [boostCount, setBoostCount] = useState(post.paid_boost_count)
  const [totalScore, setTotalScore] = useState(post.total_boost_score)
  const [showBoostModal, setShowBoostModal] = useState(false)
  const [imageError, setImageError] = useState(false)

  const handleVote = async () => {
    if (!user) {
      alert('Please sign in to vote')
      return
    }

    if (post.creator_id === user.id) {
      alert('You cannot vote on your own post')
      return
    }

    setIsVoting(true)
    try {
      const result = await communityService.toggleFreeVote(post.id)
      if (result.ok) {
        const newVoted = result.voted ?? !hasVoted
        setHasVoted(newVoted)
        setVoteCount(prev => newVoted ? prev + 1 : Math.max(0, prev - 1))
        setTotalScore(prev => newVoted ? prev + 1 : Math.max(0, prev - 1))
        onVoteChange?.(post.id, newVoted)
      } else {
        alert(result.message || 'Failed to vote')
      }
    } catch (error) {
      console.error('Vote error:', error)
    } finally {
      setIsVoting(false)
    }
  }

  const handleBoostSuccess = (boostPoints: number) => {
    setBoostCount(prev => prev + 1)
    setTotalScore(prev => prev + boostPoints)
    onBoostSuccess?.(post.id, totalScore + boostPoints)
  }

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'vendor':
        return (
          <span className="flex items-center gap-1 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
            <Store className="w-3 h-3" />
            Vendor
          </span>
        )
      case 'founder':
        return (
          <span className="flex items-center gap-1 text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
            <Crown className="w-3 h-3" />
            Founder
          </span>
        )
      case 'admin':
        return (
          <span className="flex items-center gap-1 text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
            <BadgeCheck className="w-3 h-3" />
            Admin
          </span>
        )
      default:
        return null
    }
  }

  return (
    <>
      <div className="bg-card rounded-xl border border-white/10 overflow-hidden hover:border-purple-500/30 transition-all duration-300 group">
        {/* Creator Header */}
        <div className="p-4 flex items-center gap-3">
          <Link
            to={`/profile/${post.creator_username}`}
            className="flex-shrink-0"
          >
            {post.creator_avatar_url ? (
              <img
                src={post.creator_avatar_url}
                alt={post.creator_display_name || post.creator_username}
                className="w-10 h-10 rounded-full object-cover border-2 border-white/10 hover:border-purple-500/50 transition-colors"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            )}
          </Link>
          <div className="flex-1 min-w-0">
            <Link
              to={`/profile/${post.creator_username}`}
              className="font-medium text-text hover:text-primary transition-colors block truncate"
            >
              {post.creator_display_name || post.creator_username}
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">@{post.creator_username}</span>
              {getRoleBadge(post.creator_role)}
            </div>
          </div>
          {post.is_featured && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">
              Featured
            </span>
          )}
        </div>

        {/* Post Image */}
        <Link to={post.product_id ? `/products/${post.product_id}` : '#'} className="block">
          <div className="relative aspect-square bg-bg/50 overflow-hidden">
            {!imageError && post.primary_image_url ? (
              <img
                src={post.primary_image_url}
                alt={post.title || 'Community post'}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Palette className="w-16 h-16 text-muted/30" />
              </div>
            )}

            {/* Post type badge */}
            <div className="absolute top-3 left-3">
              <span className={`text-xs px-2 py-1 rounded-full ${
                post.post_type === 'design'
                  ? 'bg-purple-500/80 text-white'
                  : 'bg-blue-500/80 text-white'
              }`}>
                {post.post_type === 'design' ? 'Design' : 'Product'}
              </span>
            </div>

            {/* Boost score badge */}
            {totalScore > 0 && (
              <div className="absolute top-3 right-3">
                <span className="flex items-center gap-1 text-xs bg-black/60 text-white px-2 py-1 rounded-full">
                  <Rocket className="w-3 h-3" />
                  {communityService.formatBoostCount(totalScore)}
                </span>
              </div>
            )}
          </div>
        </Link>

        {/* Post Content */}
        <div className="p-4">
          {post.title && (
            <h3 className="font-medium text-text mb-1 line-clamp-1">
              {post.title}
            </h3>
          )}
          {post.description && (
            <p className="text-sm text-muted line-clamp-2 mb-3">
              {post.description}
            </p>
          )}

          {/* Stats Row */}
          <div className="flex items-center gap-4 text-sm text-muted mb-4">
            <span className="flex items-center gap-1">
              <Heart className={`w-4 h-4 ${hasVoted ? 'fill-red-500 text-red-500' : ''}`} />
              {communityService.formatBoostCount(voteCount)}
            </span>
            <span className="flex items-center gap-1">
              <Rocket className="w-4 h-4 text-orange-400" />
              {communityService.formatBoostCount(boostCount)}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-4 h-4" />
              {communityService.formatBoostCount(post.view_count)}
            </span>
            <span className="text-xs ml-auto">
              {communityService.getTimeAgo(post.created_at)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleVote}
              disabled={isVoting}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium transition-all ${
                hasVoted
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-white/5 text-muted hover:bg-white/10 hover:text-text'
              } disabled:opacity-50`}
            >
              <Heart className={`w-4 h-4 ${hasVoted ? 'fill-current' : ''}`} />
              {hasVoted ? 'Voted' : 'Vote'}
            </button>
            <button
              onClick={() => setShowBoostModal(true)}
              disabled={!user}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium bg-gradient-to-r from-orange-500/20 to-yellow-500/20 text-orange-400 hover:from-orange-500/30 hover:to-yellow-500/30 transition-all disabled:opacity-50"
            >
              <Rocket className="w-4 h-4" />
              Boost
            </button>
          </div>
        </div>
      </div>

      {/* Paid Boost Modal */}
      <PaidBoostModal
        isOpen={showBoostModal}
        onClose={() => setShowBoostModal(false)}
        post={post}
        onSuccess={handleBoostSuccess}
      />
    </>
  )
}

export default CommunityPostCard
