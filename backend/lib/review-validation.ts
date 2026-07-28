// Product review input validation + rating aggregation.
//
// Dependency-free on purpose (no Supabase, no env) so it is unit-testable and
// so the same rules can be reused by any future admin/moderation path.
//
// The limits here MIRROR the CHECK constraints in
// supabase/migrations/20260728140000_product_reviews.sql. Keeping them in both
// places is intentional: the DB constraint is the guarantee, this is the layer
// that turns a violation into a 400 with a readable message instead of a 500
// with a Postgres error string.

export const REVIEW_MIN_RATING = 1
export const REVIEW_MAX_RATING = 5
export const REVIEW_TITLE_MAX = 120
export const REVIEW_BODY_MAX = 4000

// Order statuses that count as "this customer actually bought it".
// Mirrors backend/lib/order-status.ts and public.viewer_purchased_product().
// 'pending' is excluded (no money taken), 'cancelled'/'refunded' are excluded
// (a refunded order is not a purchase you get to review as a verified buyer).
export const PURCHASED_ORDER_STATUSES = [
  'paid',
  'processing',
  'printed',
  'shipped',
  'delivered',
  'completed'
] as const

export interface ReviewInput {
  rating: number
  title: string | null
  body: string | null
}

export type ReviewValidation =
  | { ok: true; value: ReviewInput }
  | { ok: false; error: string }

/**
 * Validate a review submission off the wire.
 *
 * Rating must be a whole number 1-5. A fractional rating is rejected rather
 * than rounded: the column is SMALLINT, so 4.6 would silently persist as 5 —
 * a rating the customer never gave.
 */
export function validateReviewSubmission(input: unknown): ReviewValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Review body is required' }
  }

  const { rating, title, body } = input as { rating?: unknown; title?: unknown; body?: unknown }

  if (typeof rating !== 'number' || !Number.isInteger(rating)) {
    return { ok: false, error: `rating must be a whole number between ${REVIEW_MIN_RATING} and ${REVIEW_MAX_RATING}` }
  }
  if (rating < REVIEW_MIN_RATING || rating > REVIEW_MAX_RATING) {
    return { ok: false, error: `rating must be between ${REVIEW_MIN_RATING} and ${REVIEW_MAX_RATING}` }
  }

  if (title !== undefined && title !== null && typeof title !== 'string') {
    return { ok: false, error: 'title must be text' }
  }
  const cleanTitle = normalizeText(title)
  if (cleanTitle && cleanTitle.length > REVIEW_TITLE_MAX) {
    return { ok: false, error: `title must be ${REVIEW_TITLE_MAX} characters or fewer` }
  }

  if (body !== undefined && body !== null && typeof body !== 'string') {
    return { ok: false, error: 'body must be text' }
  }
  const cleanBody = normalizeText(body)
  if (cleanBody && cleanBody.length > REVIEW_BODY_MAX) {
    return { ok: false, error: `body must be ${REVIEW_BODY_MAX} characters or fewer` }
  }

  return { ok: true, value: { rating, title: cleanTitle, body: cleanBody } }
}

// Trim, and treat whitespace-only as absent so the UI never renders an empty
// bordered box for a "title" that is three spaces.
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface ReviewSummary {
  count: number
  /** Mean rating rounded to one decimal. 0 when there are no reviews. */
  average: number
  /** Histogram keyed by star value, always all five keys present. */
  distribution: Record<string, number>
}

/**
 * Aggregate a list of ratings into the summary the product page renders.
 *
 * Ratings outside 1-5 are ignored rather than thrown on — a bad row in the
 * table must not take down the whole product page.
 */
export function summarizeReviews(ratings: readonly number[]): ReviewSummary {
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  let total = 0
  let count = 0

  for (const rating of ratings) {
    if (!Number.isInteger(rating) || rating < REVIEW_MIN_RATING || rating > REVIEW_MAX_RATING) continue
    distribution[String(rating)] += 1
    total += rating
    count += 1
  }

  // Round half away from zero on a positive mean, then fix the float: 3.35
  // stored as 3.3499999 must still read 3.4, and 4.0 must not render as
  // 4.000000000000001.
  const average = count === 0 ? 0 : Math.round((total / count) * 10) / 10

  return { count, average, distribution }
}
