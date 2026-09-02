// Single source of truth for the storefront bundle promo.
//
// David 2026-09-02 (verbatim): "i want to change our 3 for $25 to 2 for
// $25." Before this module, the deal was hardcoded three separate times —
// src/context/CartContext.tsx (the actual price math), src/components/ProductCard.tsx
// (the "3 for $25!" badge) and src/pages/AdminDashboard.tsx (the admin toggle
// label) — and NOT AT ALL in the server-side checkout pricing engine
// (backend/services/order-pricing.ts had zero bundle logic; see Watchtower
// row 54405e88). A cart of 2-3 bundle-eligible tees was charged full price
// at checkout even though the storefront advertised a discount. All four
// now import from here.

export const BUNDLE_DEAL = {
  /** How many eligible units make one bundle. */
  qty: 2,
  /** Total price (cents) for one full bundle. */
  priceCents: 2500,
  /** Storefront copy — badge, admin toggle label, cart/checkout messaging. */
  label: '2 for $25'
} as const

/**
 * Total price (cents) for `eligibleQty` units of a bundle-eligible product,
 * POOLED across every eligible line in the cart/order (not per line — see
 * callers). Every complete group of BUNDLE_DEAL.qty costs
 * BUNDLE_DEAL.priceCents; whatever's left over (not enough to form another
 * full group) is charged at `unitCents` per unit.
 *
 * `unitCents` is a parameter rather than an implicit BUNDLE_DEAL.priceCents
 * reference so a future bundle with a genuinely different remainder price
 * doesn't have to fork this function — but today's callers (CartContext,
 * order-pricing) both pass BUNDLE_DEAL.priceCents, mirroring the original
 * CartContext.calculateTotal assumption that a bundle-eligible item's
 * non-bundled price is the deal's own $25, not the product's own listed
 * price (the deal was never "$X off," it's a flat $25 whether you buy 1 or
 * a matched pair).
 */
export function bundleTotalCents(eligibleQty: number, unitCents: number): number {
  const qty = Number.isFinite(eligibleQty) ? Math.max(0, Math.floor(eligibleQty)) : 0
  const sets = Math.floor(qty / BUNDLE_DEAL.qty)
  const remainder = qty % BUNDLE_DEAL.qty
  return sets * BUNDLE_DEAL.priceCents + remainder * unitCents
}

/**
 * Eligibility rule — EXACTLY what CartContext.tsx's calculateTotal has
 * checked since before this module existed: a product is eligible when
 * EITHER its top-level `isThreeForTwentyFive` flag OR
 * `metadata.isThreeForTwentyFive` is truthy. The flag's name is legacy (from
 * the original "3 for $25" wording) — it is still the literal field stored
 * on the product row/metadata today. Only the deal's terms changed on
 * 2026-09-02, not the flag name, so no data migration was needed to ship
 * the new terms.
 */
export function isBundleEligible(
  product:
    | {
        isThreeForTwentyFive?: boolean | null
        metadata?: { isThreeForTwentyFive?: boolean | null } | null
      }
    | null
    | undefined
): boolean {
  if (!product) return false
  return !!(product.isThreeForTwentyFive || product.metadata?.isThreeForTwentyFive)
}
