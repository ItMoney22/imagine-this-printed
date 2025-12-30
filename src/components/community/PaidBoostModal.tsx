import React, { useState } from 'react'
import { X, Rocket, Coins, AlertCircle } from 'lucide-react'
import type { CommunityPost } from '../../types'
import { communityService, COMMUNITY_CONFIG } from '../../utils/community-service'
import { useAuth } from '../../context/SupabaseAuthContext'

interface PaidBoostModalProps {
  isOpen: boolean
  onClose: () => void
  post: CommunityPost
  onSuccess: (boostPoints: number) => void
}

const PaidBoostModal: React.FC<PaidBoostModalProps> = ({
  isOpen,
  onClose,
  post,
  onSuccess
}) => {
  const { user, refreshProfile } = useAuth()
  const [itcAmount, setItcAmount] = useState<number>(COMMUNITY_CONFIG.MIN_PAID_BOOST_ITC)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const userBalance = user?.wallet?.itcBalance || 0
  const minAmount = COMMUNITY_CONFIG.MIN_PAID_BOOST_ITC
  const maxAmount = Math.min(COMMUNITY_CONFIG.MAX_PAID_BOOST_ITC, userBalance)

  const quickAmounts = [1, 5, 10, 25, 50, 100].filter(a => a <= userBalance)

  const handleSubmit = async () => {
    if (!user) return

    if (itcAmount < minAmount || itcAmount > maxAmount) {
      setError(`Amount must be between ${minAmount} and ${maxAmount} ITC`)
      return
    }

    if (itcAmount > userBalance) {
      setError('Insufficient ITC balance')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await communityService.submitPaidBoost(post.id, itcAmount)

      if (result.ok) {
        onSuccess(result.boost_points || itcAmount)
        await refreshProfile?.()
        onClose()
      } else {
        setError(result.message || 'Failed to boost')
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card border border-white/10 rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-orange-400" />
            <h3 className="font-semibold text-text">Boost This Post</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Post Preview */}
          <div className="flex items-center gap-3 p-3 bg-bg/50 rounded-lg">
            {post.primary_image_url && (
              <img
                src={post.primary_image_url}
                alt={post.title || 'Post'}
                className="w-12 h-12 rounded-lg object-cover"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-text truncate">
                {post.title || 'Untitled'}
              </p>
              <p className="text-sm text-muted">
                by @{post.creator_username}
              </p>
            </div>
          </div>

          {/* Balance Display */}
          <div className="flex items-center justify-between p-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/20">
            <span className="text-sm text-muted">Your ITC Balance</span>
            <span className="flex items-center gap-1 font-semibold text-text">
              <Coins className="w-4 h-4 text-yellow-400" />
              {userBalance.toLocaleString()} ITC
            </span>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm text-muted mb-2">
              Boost Amount (ITC)
            </label>
            <input
              type="number"
              min={minAmount}
              max={maxAmount}
              value={itcAmount}
              onChange={(e) => {
                setItcAmount(Math.max(0, parseInt(e.target.value) || 0))
                setError(null)
              }}
              className="w-full px-4 py-3 bg-bg border border-white/10 rounded-lg text-text focus:outline-none focus:border-purple-500 transition-colors"
              placeholder="Enter amount"
            />
          </div>

          {/* Quick Amount Buttons */}
          {quickAmounts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map((amount) => (
                <button
                  key={amount}
                  onClick={() => {
                    setItcAmount(amount)
                    setError(null)
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    itcAmount === amount
                      ? 'bg-purple-500 text-white'
                      : 'bg-white/5 text-muted hover:bg-white/10'
                  }`}
                >
                  {amount} ITC
                </button>
              ))}
            </div>
          )}

          {/* Info */}
          <div className="text-xs text-muted space-y-1">
            <p>• Each ITC spent = 1 boost point for the creator</p>
            <p>• The creator earns 1 ITC when you boost</p>
            <p>• Higher boosted posts appear at the top</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Insufficient Balance Warning */}
          {userBalance === 0 && (
            <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              You don't have any ITC. Earn ITC by having others boost your posts!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-lg font-medium bg-white/5 text-muted hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || userBalance === 0 || itcAmount <= 0 || itcAmount > userBalance}
            className="flex-1 py-2.5 px-4 rounded-lg font-medium bg-gradient-to-r from-orange-500 to-yellow-500 text-white hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Boosting...
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                Boost for {itcAmount} ITC
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PaidBoostModal
