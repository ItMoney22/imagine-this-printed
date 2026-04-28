// Middle-right floating cart drawer.
//
// Behavior:
//   * When the cart has any items, a small pill-shaped trigger sits at
//     `top-1/2 right-4` (vertically centered, hugging the right edge).
//   * On `cart-item-added` (the same custom event MrImagineCartNotification
//     subscribes to), the drawer auto-expands and stays open until the user
//     dismisses it OR ~8 seconds pass with no interaction.
//   * The trigger pill stays visible even when collapsed so the user can
//     re-open the drawer at any time without going to the cart page.
//   * Hides entirely if the cart is empty (no orphan UI on browse pages
//     before any add-to-cart).
//
// This intentionally does NOT replace MrImagineCartNotification — that's the
// celebratory toast at bottom-right. This is the always-accessible mini-cart.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShoppingCart, X, ArrowRight, Trash2, Plus, Minus } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { getColorName } from '../utils/color-presets'

const AUTO_HIDE_MS = 8000

const FloatingCart: React.FC = () => {
  const { state, removeFromCart, updateQuantity } = useCart()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const hideTimer = useRef<number | null>(null)

  const itemCount = state.items.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = state.total

  const armAutoHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setExpanded(false), AUTO_HIDE_MS)
  }, [])

  const cancelAutoHide = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  // Auto-expand on add-to-cart, then start the auto-hide timer
  useEffect(() => {
    const onAdded = () => {
      setExpanded(true)
      armAutoHide()
    }
    window.addEventListener('cart-item-added', onAdded)
    return () => {
      window.removeEventListener('cart-item-added', onAdded)
      cancelAutoHide()
    }
  }, [armAutoHide, cancelAutoHide])

  // If the user removes the last item while expanded, snap closed
  useEffect(() => {
    if (itemCount === 0 && expanded) setExpanded(false)
  }, [itemCount, expanded])

  if (itemCount === 0) return null

  const handleCheckout = () => {
    setExpanded(false)
    cancelAutoHide()
    navigate('/checkout')
  }

  const handleViewCart = () => {
    setExpanded(false)
    cancelAutoHide()
    navigate('/cart')
  }

  return (
    <>
      {/* Always-on trigger pill. Vertically centered on the right edge so it
          doesn't fight with the bottom-right MrImagineCartNotification toast. */}
      {!expanded && (
        <button
          onClick={() => {
            setExpanded(true)
            armAutoHide()
          }}
          aria-label={`Open cart (${itemCount} item${itemCount === 1 ? '' : 's'})`}
          className="fixed top-1/2 right-3 -translate-y-1/2 z-40 group flex items-center gap-2 px-3 py-3 rounded-l-2xl rounded-r-md bg-gradient-to-br from-primary to-secondary text-white shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] hover:pl-5 transition-all"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 flex items-center justify-center text-[10px] font-bold bg-amber-400 text-slate-900 rounded-full shadow-md">
            {itemCount}
          </span>
        </button>
      )}

      {/* Expanded drawer panel */}
      {expanded && (
        <div
          onMouseEnter={cancelAutoHide}
          onMouseLeave={armAutoHide}
          className="fixed top-1/2 right-3 -translate-y-1/2 z-40 w-80 max-h-[70vh] flex flex-col bg-card border border-primary/30 rounded-2xl shadow-[0_0_40px_rgba(168,85,247,0.35)] backdrop-blur-xl animate-in slide-in-from-right-4 fade-in duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-text">
                Cart · {itemCount} item{itemCount === 1 ? '' : 's'}
              </span>
            </div>
            <button
              onClick={() => {
                setExpanded(false)
                cancelAutoHide()
              }}
              className="p-1 text-muted hover:text-text rounded-md hover:bg-white/5 transition-colors"
              aria-label="Close cart"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {state.items.map((item) => {
              const img =
                item.designData?.mockupUrl ||
                item.customDesign ||
                item.product.images?.[0] ||
                'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=200&h=200&fit=crop'
              return (
                <div
                  key={item.id}
                  className="flex gap-2 p-2 rounded-lg bg-bg/50 border border-white/5"
                >
                  <img
                    src={img}
                    alt={item.product.name}
                    className="w-12 h-12 rounded-md object-cover shrink-0 border border-white/10"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).src =
                        'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=200&h=200&fit=crop'
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text truncate">
                      {item.product.name}
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted mt-0.5">
                      {item.selectedSize && (
                        <span className="px-1.5 py-0.5 bg-white/5 rounded">
                          {item.selectedSize}
                        </span>
                      )}
                      {item.selectedColor && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/5 rounded">
                          <span
                            className="w-2 h-2 rounded-full border border-white/20"
                            style={{ backgroundColor: item.selectedColor }}
                          />
                          {getColorName(item.selectedColor)}
                        </span>
                      )}
                      <span className="text-text/80 font-medium ml-auto">
                        ${(item.product.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-5 h-5 rounded bg-white/5 hover:bg-white/10 text-text flex items-center justify-center transition-colors"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-medium text-text px-1.5 min-w-[16px] text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-5 h-5 rounded bg-white/5 hover:bg-white/10 text-text flex items-center justify-center transition-colors"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="ml-auto w-5 h-5 rounded text-muted hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                        aria-label={`Remove ${item.product.name}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer with subtotal + actions */}
          <div className="px-4 py-3 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Subtotal</span>
              <span className="text-base font-bold text-text">${subtotal.toFixed(2)}</span>
            </div>
            <button
              onClick={handleCheckout}
              className="w-full py-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] transition-all flex items-center justify-center gap-1.5"
            >
              Checkout
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleViewCart}
              className="w-full py-1.5 text-xs text-muted hover:text-text border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
            >
              View full cart
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default FloatingCart
