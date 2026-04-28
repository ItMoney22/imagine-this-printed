// Promo-pricing helpers.
//
// Strategy: when an admin runs a promo, we mutate `products.price` to the
// discounted value and stash the previous value at `metadata.original_price`.
// All existing cart / checkout / payment-intent code keeps reading
// `product.price` and gets the discount automatically — no plumbing needed.
//
// Display code calls `getPromoBadge(product)` to decide whether to show the
// strikethrough + percent-off treatment.
//
// Clearing a promo restores `price` from `metadata.original_price` and drops
// the metadata key.

import type { Product } from '../types'

export interface PromoBadge {
  originalPrice: number
  promoPrice: number
  percentOff: number
}

/**
 * Returns badge data when a product is currently on promo, otherwise null.
 * "On promo" = `metadata.original_price` exists and is strictly greater than
 * the current `price`. This is intentionally tolerant: if metadata claims
 * an original price that's <= the live price, the promo is treated as
 * inactive (covers the case where an admin manually edited price upward
 * after a promo without clearing the metadata).
 */
export function getPromoBadge(product: Pick<Product, 'price' | 'metadata'>): PromoBadge | null {
  const original = product.metadata?.original_price
  const current = product.price
  if (typeof original !== 'number' || typeof current !== 'number') return null
  if (original <= current) return null
  const percentOff = Math.round(((original - current) / original) * 100)
  if (percentOff <= 0) return null
  return { originalPrice: original, promoPrice: current, percentOff }
}
