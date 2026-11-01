import type { CartItem } from '../types'
import { BUNDLE_DEAL, bundleTotalCents, isBundleEligible } from '../../backend/shared/promos'
import { isBlankGarmentMeta } from '../../backend/shared/blank-pricing'
import { lineBasePrice } from './product-kind'

/**
 * What the "2 for $25" deal did to this cart, in words a shopper can check
 * against the line prices (task dda57173: the badge promised a deal the cart
 * applied silently, so two $25 tees showed $50 of lines over a $25 subtotal).
 * Same eligibility as CartContext.calculateTotal and the server pricing engine.
 */
export function bundleNote(items: CartItem[]): { eligibleQty: number; saved: number; oneMore: boolean } {
  const eligible = items.filter(i => !isBlankGarmentMeta(i.product.metadata) && isBundleEligible(i.product))
  const eligibleQty = eligible.reduce((sum, i) => sum + i.quantity, 0)
  const listed = eligible.reduce((sum, i) => sum + lineBasePrice(i.product, i.selectedSize, i.selectedColor) * i.quantity, 0)
  const saved = Math.max(0, Math.round((listed - bundleTotalCents(eligibleQty, BUNDLE_DEAL.priceCents) / 100) * 100) / 100)
  return { eligibleQty, saved, oneMore: eligibleQty % BUNDLE_DEAL.qty !== 0 }
}
