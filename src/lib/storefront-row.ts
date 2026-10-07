import { canonicalCategoryOf } from './product-kind'
import type { Product } from '../types'

/** The columns a storefront card needs for Quick Add (sizes, colours, placement). */
export const STOREFRONT_PRODUCT_COLUMNS =
  'id, name, description, price, images, category, is_active, created_at, updated_at, metadata, sizes, colors, is_featured'

/** One products row -> the Product a ProductCard renders. Shared by the catalog and the home page. */
export function mapProductRow(p: any): Product {
  return {
    // isUserSubmitted below isn't a declared Product field (ProductCard.tsx
    // reads it via `(product as any).isUserSubmitted`) — cast at the return,
    // same as this file's previous `as Product[]`, so it still compiles.
    id: p.id,
    name: p.name,
    description: p.description || '',
    price: p.price || 0,
    images: p.images || [],
    // Classify by kind (column → metadata.product_template fallback) so
    // metal/3D products with a null category stop landing under T-Shirts.
    category: canonicalCategoryOf({ category: p.category, metadata: p.metadata }) as Product['category'],
    inStock: p.is_active !== false,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    metadata: p.metadata || {},
    isThreeForTwentyFive: p.metadata?.isThreeForTwentyFive || false,
    // sizes/colors live on the columns (set at approval); metadata fallback for legacy rows
    sizes: p.sizes || p.metadata?.sizes || [],
    colors: p.colors || p.metadata?.colors || [],
    is_featured: p.is_featured ?? false,
    isUserSubmitted: p.metadata?.is_user_submitted || false
  } as Product
}
