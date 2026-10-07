import { useEffect, useState } from 'react'
import ProductCard from '../ProductCard'
import { supabase } from '../../lib/supabase'
import { applyStorefrontVisibility } from '../../lib/product-visibility'
import { STOREFRONT_PRODUCT_COLUMNS, mapProductRow } from '../../lib/storefront-row'
import { canonicalCategoryOf, isBlankProduct } from '../../lib/product-kind'
import type { Product } from '../../types'

/**
 * Four whole product cards under the buy box (approved mock 394b217c): the same
 * shelf first, then the rest of the shop. Every card is a sellable listing with
 * its photo (the old "Similar Products" box left blank grey tiles on phones).
 */
export function YouMayAlsoLike({ product }: { product: Product }) {
  const [items, setItems] = useState<Product[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await applyStorefrontVisibility(
        supabase.from('products').select(STOREFRONT_PRODUCT_COLUMNS)
      )
        .neq('id', product.id)
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(60)
      if (error) console.error('[you-may-also-like]', error)
      const shelf = canonicalCategoryOf(product)
      const rows = (data || []).map(mapProductRow).filter((p) => !isBlankProduct(p) && (p.images?.length ?? 0) > 0)
      const same = rows.filter((p) => canonicalCategoryOf(p) === shelf)
      const rest = rows.filter((p) => canonicalCategoryOf(p) !== shelf)
      if (alive) setItems([...same, ...rest].slice(0, 4))
    })()
    return () => {
      alive = false
    }
  }, [product])

  if (items.length === 0) return null
  return (
    <section className="mt-14 sm:mt-20">
      <h2 className="font-display text-2xl sm:text-3xl text-text mb-5 sm:mb-6">You may also like</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} showSocialBadges={false} compact />
        ))}
      </div>
    </section>
  )
}
