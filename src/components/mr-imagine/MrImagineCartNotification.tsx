import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { X, ShoppingCart, ArrowRight } from 'lucide-react'
import { MrImagineAvatar } from './MrImagineAvatar'
import { MR_IMAGINE_CONFIG } from './config'
import { useCart } from '../../context/CartContext'
import type { Product } from '../../types'

interface CartNotificationItem {
  product: Product
  size: string
}

export const MrImagineCartNotification: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false)
  const [lastAddedItem, setLastAddedItem] = useState<CartNotificationItem | null>(null)
  const [expression, setExpression] = useState<'default' | 'happy' | 'waving'>('happy')
  const { state } = useCart()

  // Messages Mr. Imagine says when items are added
  const celebrationMessages = [
    "Awesome choice! That's going to look amazing!",
    "Great pick! Your style game is on point!",
    "Love it! Another masterpiece for your collection!",
    "Excellent taste! This one's a winner!",
    "Ooh, nice! You've got great design sense!",
    "Perfect! Your cart is looking incredible!",
  ]

  const [currentMessage, setCurrentMessage] = useState(celebrationMessages[0])

  const handleCartItemAdded = useCallback((event: CustomEvent<CartNotificationItem>) => {
    const item = event.detail
    setLastAddedItem(item)
    setCurrentMessage(celebrationMessages[Math.floor(Math.random() * celebrationMessages.length)])
    setExpression('happy')
    setIsVisible(true)

    // Animate expression
    setTimeout(() => setExpression('waving'), 1500)
    setTimeout(() => setExpression('happy'), 2500)

    // Auto-hide after 5 seconds
    setTimeout(() => {
      setIsVisible(false)
    }, 5000)
  }, [])

  useEffect(() => {
    window.addEventListener('cart-item-added', handleCartItemAdded as EventListener)
    return () => {
      window.removeEventListener('cart-item-added', handleCartItemAdded as EventListener)
    }
  }, [handleCartItemAdded])

  if (!isVisible || !lastAddedItem) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-right-full fade-in duration-300">
      <div className="relative max-w-sm bg-gradient-to-br from-purple-900/95 via-indigo-900/95 to-purple-800/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-purple-500/30 overflow-hidden">
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-purple-500/10 animate-pulse" />

        {/* Close button */}
        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-2 right-2 p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative p-4 flex gap-4">
          {/* Mr. Imagine Avatar */}
          <div className="flex-shrink-0">
            <MrImagineAvatar
              size="lg"
              expression={expression}
              pose="waistUp"
              animate={true}
              glow={true}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Speech bubble */}
            <div className="relative mb-3">
              <div className="absolute left-0 top-3 w-0 h-0 border-t-8 border-t-transparent border-r-8 border-r-white/90 border-b-8 border-b-transparent -ml-2" />
              <div className="bg-white/90 backdrop-blur-sm rounded-xl rounded-tl-none px-3 py-2 shadow-inner">
                <p className="text-sm font-medium text-purple-900">{currentMessage}</p>
              </div>
            </div>

            {/* Added item info */}
            <div className="flex items-center gap-3 mb-3">
              {lastAddedItem.product.images?.[0] && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 border border-white/20">
                  <img
                    src={lastAddedItem.product.images[0]}
                    alt={lastAddedItem.product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {lastAddedItem.product.name}
                </p>
                <p className="text-xs text-purple-200">
                  Size: {lastAddedItem.size} &bull; ${lastAddedItem.product.price}
                </p>
              </div>
            </div>

            {/* Cart summary and action */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-purple-200">
                <ShoppingCart className="w-4 h-4" />
                <span>{state.items.length} item{state.items.length !== 1 ? 's' : ''} in cart</span>
              </div>
              <Link
                to="/cart"
                onClick={() => setIsVisible(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-green-500/30 transition-all hover:scale-105"
              >
                View Cart
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-green-400 to-emerald-500 animate-[shrink_5s_linear_forwards]"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )
}

export default MrImagineCartNotification
