// Per-size/per-color availability for sellable products, derived from the
// blank-shirt inventory ledger (blank_inventory). Read-only — this never
// mutates stock; it answers "can this product's size+color combination be
// fulfilled from the blanks we have on hand".
//
// WHY IT EXISTS
//
// The storefront's `inStock` flag is `products.is_active !== false` (see
// ProductCatalog.tsx / ProductPage.tsx / AdminDashboard.tsx), which ignores the
// granular blank_inventory rows tracked for fulfillment
// (backend/services/blank-inventory.ts). This module is the bridge: given a
// product's sizes/colors and its blank mapping, it computes the availability a
// product page should show next to each size/color swatch.
//
// Deliberately dependency-free (no Supabase, no env) so it is unit-testable,
// mirroring lib/review-validation.ts and lib/abandoned-cart.ts. The query that
// loads `blanks` lives in the route (backend/routes/product-availability.ts).
//
// SCOPE (a stated, honest limitation)
//
// This covers APPAREL products whose fulfillment is blank-driven. Metal art,
// 3D prints and DTF transfers are made-to-order or differently stocked, so a
// product without a blank mapping falls back to product-level stock — which is
// exactly the `is_active`/`stock_quantity` behavior the route reports.

export interface AvailabilityBlank {
  color: string
  size: string
  style_code: string
  qty_on_hand: number
}

export interface VariantAvailability {
  /** True when blank data actually resolved for this product (vs fallback). */
  blankBacked: boolean
  /**
   * Keyed by `${color}::${size}` → number of units fulfillable from blanks.
   * Only present when blankBacked is true.
   */
  byVariant: Record<string, number>
}

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Compute per-variant availability for a product.
 *
 * @param blanks         blank_inventory rows (already filtered to what a
 *                       matching query can return).
 * @param productSizes   the product's size list (products.sizes / metadata).
 * @param productColors  the product's color list (products.colors / metadata).
 * @param blankStyle     products.metadata.blank_style, when the product is
 *                       pinned to a specific blank style_code.
 */
export function computeVariantAvailability(
  blanks: readonly AvailabilityBlank[],
  productSizes: readonly string[],
  productColors: readonly string[],
  blankStyle: string | null | undefined
): VariantAvailability {
  if (!productSizes.length || !productColors.length || blanks.length === 0) {
    return { blankBacked: false, byVariant: {} }
  }

  const style = norm(blankStyle)
  const byVariant: Record<string, number> = {}

  for (const color of productColors) {
    for (const size of productSizes) {
      const matching = blanks.filter(
        (b) =>
          norm(b.color) === norm(color) &&
          norm(b.size) === norm(size) &&
          (style === '' || norm(b.style_code) === style)
      )
      // Sum across matching blanks (a product unpinned to a single style can be
      // fulfilled from any matching blank; a pinned style already filtered to
      // just that one style above).
      const qty = matching.reduce((sum, b) => sum + Math.max(0, b.qty_on_hand), 0)
      byVariant[`${color}::${size}`] = qty
    }
  }

  return { blankBacked: true, byVariant }
}

/** Human-friendly stock label for one variant, e.g. "Only 2 left" / "In stock". */
export function variantStockLabel(qty: number): string {
  if (qty <= 0) return 'Out of stock'
  if (qty === 1) return 'Only 1 left'
  if (qty <= 5) return `Only ${qty} left`
  return 'In stock'
}
