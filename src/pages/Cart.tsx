import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShoppingBag, Lock, Store, HelpCircle, Minus, Plus, ArrowRight } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { YouMayAlsoLike } from '../components/product/YouMayAlsoLike'
import { shippingCalculator } from '../utils/shipping-calculator'
import { SHOP_PLACE } from '../config/business-info'
import { getColorName } from '../utils/color-presets'
import { addonsUnitTotal, lineBasePrice, printLocationLabel, sizePriceDelta, formatPriceDelta } from '../lib/product-kind'
import { garmentTierUpcharge, getGarmentTier } from '../lib/garment-tiers'
import type { CartItem } from '../types'

const FALLBACK = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'

/** 2XL and up adds $2.50 a shirt (the same rail the summary and checkout charge), so the line says so
 *  instead of showing the base price under a total that is $2.50 higher. */
function sizeUpcharge(item: CartItem): number {
  return item.selectedSize ? Math.max(0, sizePriceDelta(item.product, item.selectedSize)) : 0
}

/** The shopper's own choices on a cart line, in plain words (never a code like front_image). */
function choiceChips(item: CartItem): string[] {
  const chips: string[] = []
  if (item.selectedSize) {
    const plus = sizeUpcharge(item)
    chips.push(plus > 0 ? `${item.selectedSize} (${formatPriceDelta(plus)})` : item.selectedSize)
  }
  if (item.selectedColor) chips.push(getColorName(item.selectedColor))
  const place = printLocationLabel(item.printLocation)
  if (place) chips.push(`${place} print`)
  const tier = item.selectedTier ? getGarmentTier(item.selectedTier) : null
  if (tier) {
    const up = garmentTierUpcharge(item.selectedTier)
    chips.push(up > 0 ? `${tier.label} (+$${up.toFixed(2)})` : tier.label)
  }
  for (const addon of item.selectedAddons ?? []) chips.push(`+ ${addon.name} (+$${addon.price.toFixed(2)})`)
  for (const [k, v] of Object.entries(item.personalization ?? {})) if (v) chips.push(`${k}: ${v}`)
  if (item.designData?.mockupUrl) chips.push('Your design')
  else if (item.customDesign) chips.push('Your design included')
  return chips
}

/** Cart (approved mock 0c21434e, task b9656cc9): the lines, a summary with ONE Check out button. */
const Cart: React.FC = () => {
  const { state, removeFromCart, updateQuantity } = useCart()
  const navigate = useNavigate()
  const [freeShippingProgress, setFreeShippingProgress] = useState({
    amountNeeded: 0,
    percentage: 0,
    qualified: false
  })

  useEffect(() => {
    const progress = shippingCalculator.calculateFreeShippingProgress(state.total)
    setFreeShippingProgress(progress)
  }, [state.total])

  if (state.items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="max-w-md mx-auto text-center bg-card rounded-3xl border border-border shadow-soft p-10">
          <ShoppingBag className="mx-auto h-12 w-12 text-primary mb-4" strokeWidth={1.5} />
          <h1 className="font-display text-3xl text-text mb-2">Your cart is empty</h1>
          <p className="text-text-secondary mb-6">Shirts, hoodies, 3D prints and more, printed to order in {SHOP_PLACE.town}.</p>
          <Link to="/catalog" className="btn-primary">
            Shop the store <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    )
  }

  const handleQuantityChange = (itemId: string, newQuantity: number) => {
    if (newQuantity === 0) {
      removeFromCart(itemId)
    } else {
      updateQuantity(itemId, newQuantity)
    }
  }

  const count = state.items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <h1 className="font-display text-3xl sm:text-4xl text-text mb-6 sm:mb-8">
        Your cart <span className="text-xl sm:text-2xl text-text-secondary">({count} {count === 1 ? 'item' : 'items'})</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2">
          <ul className="space-y-3 sm:space-y-4">
            {state.items.map((item) => {
              const unit = lineBasePrice(item.product, item.selectedSize, item.selectedColor)
              const line = (unit + sizeUpcharge(item) + garmentTierUpcharge(item.selectedTier) + addonsUnitTotal(item.selectedAddons)) * item.quantity
              return (
                <li key={item.id} className="bg-card rounded-2xl border border-border shadow-soft p-3 sm:p-4 flex gap-3 sm:gap-5">
                  <Link to={`/product/${item.product.slug || item.product.id}`} className="shrink-0">
                    <img
                      src={item.designData?.mockupUrl || item.customDesign || item.product.images?.[0] || FALLBACK}
                      alt={item.product.name}
                      className="w-24 h-24 sm:w-32 sm:h-32 object-contain rounded-xl bg-bg"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = FALLBACK
                      }}
                    />
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/product/${item.product.slug || item.product.id}`} className="font-display text-lg sm:text-xl text-text leading-snug hover:text-primary">
                        {item.product.name}
                      </Link>
                      <p className="font-semibold text-text whitespace-nowrap">${line.toFixed(2)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {choiceChips(item).map((chip) => (
                        <span key={chip} className="px-2.5 py-1 rounded-full border border-border text-xs text-text-secondary">
                          {chip}
                        </span>
                      ))}
                    </div>
                    <div className="mt-auto pt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center border border-border rounded-full">
                        <button
                          onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                          className="w-10 h-10 flex items-center justify-center text-text"
                          aria-label={`One fewer ${item.product.name}`}
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-8 text-center font-semibold text-text" aria-live="polite">{item.quantity}</span>
                        <button
                          onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                          className="w-10 h-10 flex items-center justify-center text-text"
                          aria-label={`One more ${item.product.name}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="text-sm font-medium text-primary hover:underline underline-offset-4 py-2"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-card rounded-2xl border border-border shadow-soft p-5 sm:p-6 lg:sticky lg:top-6">
            <h2 className="font-display text-2xl text-text mb-4">Order summary</h2>

            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-secondary">Subtotal</dt>
                <dd className="text-text">${state.total.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">Shipping</dt>
                <dd className="text-text-secondary">{freeShippingProgress.qualified ? 'Free' : 'Calculated at checkout'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">Tax</dt>
                {/* Tax depends on the shipping address (server-side US state
                    rate table) — there's no address yet on this page, so we
                    don't invent a number. See src/pages/Checkout.tsx for the
                    real, server-calculated figure once it's known. */}
                <dd className="text-text-secondary">Calculated at checkout</dd>
              </div>
              <div className="border-t border-border pt-3 flex justify-between items-baseline">
                <dt className="font-semibold text-text">Total</dt>
                <dd className="font-display text-2xl text-text">
                  ${state.total.toFixed(2)}{!freeShippingProgress.qualified && '+'} <span className="text-xs font-body text-muted">+ tax</span>
                </dd>
              </div>
            </dl>

            {/* Free shipping progress (threshold lives in shipping-calculator) */}
            <div className="mt-4">
              <div className="h-2 rounded-full bg-border-subtle overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(freeShippingProgress.percentage)} aria-label="Progress to free shipping">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${freeShippingProgress.qualified ? 100 : freeShippingProgress.percentage}%` }} />
              </div>
              <p className="text-sm text-primary mt-2">
                {freeShippingProgress.qualified
                  ? 'Your order ships free.'
                  : `You are $${freeShippingProgress.amountNeeded.toFixed(2)} away from free shipping.`}
              </p>
            </div>

            <button onClick={() => navigate('/checkout')} className="w-full btn-primary mt-5">
              Check out <ArrowRight className="w-5 h-5" />
            </button>
            <Link to="/catalog" className="block text-center text-sm font-semibold text-primary hover:underline underline-offset-4 mt-3 py-1">
              Continue shopping
            </Link>

            <ul className="grid grid-cols-3 gap-2 border-t border-border mt-5 pt-4 text-center text-xs text-text-secondary">
              <li className="flex flex-col items-center gap-1.5">
                <Lock className="w-5 h-5 text-primary" strokeWidth={1.75} />
                Secure checkout
              </li>
              <li className="flex flex-col items-center gap-1.5">
                <Store className="w-5 h-5 text-primary" strokeWidth={1.75} />
                Free pickup in {SHOP_PLACE.town}
              </li>
              <li className="flex flex-col items-center gap-1.5">
                <HelpCircle className="w-5 h-5 text-primary" strokeWidth={1.75} />
                <Link to="/contact" className="hover:text-primary">Questions? Contact us</Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <YouMayAlsoLike product={state.items[0]?.product} excludeIds={state.items.map((item) => item.product.id)} title="Add one more" />
    </div>
  )
}

export default Cart
