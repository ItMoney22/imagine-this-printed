// One definition of "this product row is fit to show a shopper".
//
// Why this exists: the storefront had THREE different answers to that question
// living in three files. ProductCatalog filtered `status = 'active'` AND
// `is_active = true` AND the approval predicate; the recommendation widget
// filtered only `is_active = true`. On the live table that is the difference
// between 118 rows and 2,538 — the recommender was pulling from a pool that is
// ~95% unfinished draft designs, which is exactly what shoppers were seeing in
// "Recommended for You" (raw transparent-background art, never priced or
// approved for sale).
//
// `is_active` alone is NOT a sale-readiness signal on this table. Mrs. Imagine
// / the design importer / the Step Flow all create rows with is_active = true
// long before the product is finished; `status` is the column that moves
// 'draft' -> 'pending_approval' -> 'active' when a product is actually ready.
// Any customer-facing query must gate on BOTH, so the rule lives here and the
// call sites import it.

/** The only `products.status` value a shopper may ever see. */
export const STOREFRONT_PRODUCT_STATUS = 'active'

// Unapproved user-submitted designs must never leave the server. Written as an
// explicit "keep if NOT flagged unapproved" OR, not a negated AND: most catalog
// rows never set metadata.is_user_submitted at all, and Postgres's 3-valued
// NULL logic makes `NOT (a AND b)` silently drop rows where a/b are simply
// unset — that would hide the entire non-user-submitted catalog.
export function applyApprovalFilter<T>(query: T): T {
  return (query as any).or(
    'metadata->>is_user_submitted.is.null,metadata->>is_user_submitted.eq.false,metadata->>approved_by_admin.eq.true'
  )
}

/**
 * Full storefront gate: live status + active flag + approval predicate.
 * Use this on EVERY query whose rows are rendered to a shopper.
 */
export function applyStorefrontVisibility<T>(query: T): T {
  return applyApprovalFilter(
    (query as any).eq('status', STOREFRONT_PRODUCT_STATUS).eq('is_active', true)
  )
}
