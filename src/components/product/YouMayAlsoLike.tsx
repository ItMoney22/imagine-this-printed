import { useEffect, useState } from 'react'
import ProductCard from '../ProductCard'
import { supabase } from '../../lib/supabase'
import { applyStorefrontVisibility } from '../../lib/product-visibility'
import { STOREFRONT_PRODUCT_COLUMNS, mapProductRow } from '../../lib/storefront-row'
import { canonicalCategoryOf, isBlankProduct } from '../../lib/product-kind'
import type { Product } from '../../types'

interface YouMayAlsoLikeProps {
  /** The listing being looked at (product page) or the first one in the cart: its shelf comes first. */
  product?: Product
  /** Listings never to suggest (the product itself, everything already in the cart). */
  excludeIds?: string[]
  title?: string
}

/**
 * Four whole product cards (approved mocks 394b217c product page, 0c21434e
 * cart): the same shelf first, then the rest of the shop. Every card is a
 * sellable listing with its photo (the old "Similar Products" and "Complete
 * Your Order" boxes left blank grey tiles on phones).
 */
export function YouMayAlsoLike({ product, excludeIds = [], title = 'You may also like' }: YouMayAlsoLikeProps) {
  const [items, setItems] = useState<Product[]>([])
  const skip = [product?.id, ...excludeIds].filter(Boolean).join(',')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await applyStorefrontVisibility(
        supabase.from('products').select(STOREFRONT_PRODUCT_COLUMNS)
      )
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(60)
      if (error) console.error('[you-may-also-like]', error)
      const skipped = new Set(skip.split(',').filter(Boolean))
      const shelf = product ? canonicalCategoryOf(product) : null
      const rows = (data || [])
        .map(mapProductRow)
        .filter((p) => !skipped.has(p.id) && !isBlankProduct(p) && (p.images?.length ?? 0) > 0)
      const same = shelf ? rows.filter((p) => canonicalCategoryOf(p) === shelf) : []
      const rest = rows.filter((p) => !same.includes(p))
      if (alive) setItems([...same, ...rest].slice(0, 4))
    })()
    return () => {
      alive = false
    }
  }, [product, skip])

  if (items.length === 0) return null
  return (
    <section className="mt-14 sm:mt-20">
      <h2 className="font-display text-2xl sm:text-3xl text-text mb-5 sm:mb-6">{title}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} showSocialBadges={false} compact />
        ))}
      </div>
    </section>
  )
}
