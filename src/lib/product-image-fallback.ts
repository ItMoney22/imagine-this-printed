import type { SyntheticEvent } from 'react'

/** ITP's own "no photo" tile (public/catalog/product-image-fallback.svg): the bulb mark on the warm
 *  background. Every product image that is missing or fails to load shows this, never a third-party
 *  stock photo passed off as our product (task 227293bd). */
export const PRODUCT_IMAGE_FALLBACK = '/catalog/product-image-fallback.svg'

/** onError for a product <img>: swap to the ITP tile. Skips when the tile itself is what failed, so a
 *  missing tile cannot loop. */
export function showProductImageFallback(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  if (img.src.endsWith(PRODUCT_IMAGE_FALLBACK)) return
  img.src = PRODUCT_IMAGE_FALLBACK
}
