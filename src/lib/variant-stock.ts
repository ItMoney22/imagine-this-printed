// Storefront-side helpers for GET /api/product-availability/:productId
// (backend/routes/product-availability.ts). Dependency-free and pure so the
// per-size/per-color stock hints on ProductPage are unit-testable without a
// rendered component or a network mock — mirrors the split already used by
// backend/lib/variant-availability.ts on the server side.
//
// FALLBACK CONTRACT: the endpoint reports `mode: 'product-level'` (no
// `byVariant`) for non-apparel categories and for apparel with no
// blank_inventory mapping. `variantQtyFrom` returns null in both cases, which
// every caller here treats as "say nothing, defer to is_active" — never as
// zero/out-of-stock.

export interface ProductAvailability {
  mode: 'product-level' | 'blank-inventory'
  available: boolean
  stockQuantity: number | null
  byVariant?: Record<string, number>
}

// "Only N left" kicks in at this qty; mirrors the backend's
// variantStockLabel threshold (backend/lib/variant-availability.ts).
export const LOW_STOCK_THRESHOLD = 5

/** Units fulfillable for one color/size combo, or null when there's no blank-backed data for it. */
export function variantQtyFrom(
  availability: ProductAvailability | null | undefined,
  color: string,
  size: string
): number | null {
  if (!availability?.byVariant) return null
  const key = `${color}::${size}`
  return key in availability.byVariant ? availability.byVariant[key] : null
}

export type VariantStockStatus = 'unknown' | 'in-stock' | 'low' | 'out'

/** Classifies a variant qty for rendering — null (no data) always maps to 'unknown', never 'out'. */
export function variantStockStatus(qty: number | null): VariantStockStatus {
  if (qty === null) return 'unknown'
  if (qty <= 0) return 'out'
  if (qty <= LOW_STOCK_THRESHOLD) return 'low'
  return 'in-stock'
}
