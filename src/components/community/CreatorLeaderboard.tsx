import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, User, Rocket, Crown, Medal, Award } from 'lucide-react'
import type { CommunityLeaderboardEntry } from '../../types'
import { communityService } from '../../utils/community-service'

interface CreatorLeaderboardProps {
  period?: 'all_time' | 'this_month' | 'this_week'
  limit?: number
}

const CreatorLeaderboard: React.FC<CreatorLeaderboardProps> = ({
  period = 'all_time',
  limit = 5
}) => {
  const [leaders, setLeaders] = useState<CommunityLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState(period)

  useEffect(() => {
    loadLeaderboard()
  }, [selectedPeriod, limit])

  const loadLeaderboard = async () => {
    setLoading(true)
    try {
      const data = await communityService.getLeaderboard({
        period: selectedPeriod,
        limit
      })
      setLeaders(data)
    } catch (error) {
      console.error('Failed to load leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-400" />
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />
      case 3:
        return <Award className="w-5 h-5 text-amber-600" />
      default:
        return (
          <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-muted">
            #{rank}
          </span>
        )
    }
  }

  const getRankStyle = (rank: number) => {
    switch (rank) {
      case 1:
        return 'border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 to-orange-500/10'
      case 2:
        return 'border-gray-400/30 bg-gradient-to-r from-gray-400/10 to-gray-500/10'
      case 3:
        return 'border-amber-600/30 bg-gradient-to-r from-amber-600/10 to-orange-600/10'
      default:
        return 'border-white/10 bg-white/5'
    }
  }

  const periodOptions = [
    { value: 'all_time', label: 'All Time' },
    { value: 'this_month', label: 'This Month' },
    { value: 'this_week', label: 'This Week' }
  ] as const

  return (
    <div className="bg-card rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <h3 className="font-semibold text-text">Top Creators</h3>
          </div>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as typeof selectedPeriod)}
            className="text-sm bg-bg border border-white/10 rounded-lg px-2 py-1 text-muted focus:outline-none focus:border-purple-500"
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Leaderboard List */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(limit)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-lg bg-white/5">
                <div className="w-5 h-5 rounded-full bg-white/10" />
                <div className="w-10 h-10 rounded-full bg-white/10" />
                <div className="flex-1">
                  <div className="h-4 w-24 bg-white/10 rounded mb-1" />
                  <div className="h-3 w-16 bg-white/10 rounded" />
                </div>
                <div className="h-4 w-12 bg-white/10 rounded" />
              </div>
            ))}
          </div>
        ) : leaders.length === 0 ? (
          <div className="text-center py-8 text-muted">
            <Rocket className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>No creators yet</p>
            <p className="text-sm">Be the first to get boosted!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leaders.map((leader) => (
              <Link
                key={leader.creator_id}
                to={`/profile/${leader.creator_username}`}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all hover:scale-[1.02] ${getRankStyle(leader.rank)}`}
              >
                {/* Rank */}
                <div className="flex-shrink-0">
                  {getRankIcon(leader.rank)}
                </div>

                {/* Avatar */}
                <div className="flex-shrink-0">
                  {leader.creator_avatar_url ? (
                    <img
                      src={leader.creator_avatar_url}
                      alt={leader.creator_display_name || leader.creator_username}
                      className="w-10 h-10 rounded-full object-cover border-2 border-white/10"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text truncate">
                    {leader.creator_display_name || leader.creator_username}
                  </p>
                  <p className="text-xs text-muted">@{leader.creator_username}</p>
                </div>

                {/* Boost Count */}
                <div className="flex items-center gap-1 text-sm">
                  <Rocket className="w-4 h-4 text-orange-400" />
                  <span className="font-semibold text-text">
                    {communityService.formatBoostCount(leader.total_boosts_received)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* View All Link */}
      {leaders.length >= limit && (
        <div className="px-4 pb-4">
          <Link
            to="/community/leaderboard"
            className="block text-center text-sm text-primary hover:underline"
          >
            View Full Leaderboard →
          </Link>
        </div>
      )}
    </div>
  )
}

export default CreatorLeaderboard
