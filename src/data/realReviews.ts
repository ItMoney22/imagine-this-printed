// REAL REVIEWS ONLY. Every entry here is copied verbatim from a genuine Etsy
// review of shop 67055923 (via backend/scripts/import-etsy-reviews.mjs), or is a
// buyer quote we hold written permission for. Never type one in by hand, never
// write a sample/placeholder, never paraphrase. src/lib/real-reviews.test.ts
// fails the build if an entry lacks provenance or looks like filler.
//
// As of 2026-10-13 both ITP Etsy shops (67055923 and the older 46974694) have
// 0 reviews and the site's own reviews table is empty, so this list is empty on
// purpose. The home and product sections render nothing until a real review
// lands here.

export type ReviewSource = 'etsy' | 'permissioned'

export interface RealReviewPhoto {
  url: string
  /** Where the buyer's OK to show this photo is documented (Etsy review image, or a message/ticket id). */
  permission: string
}

export interface RealReview {
  /** Etsy review id, or the ticket/message id holding the buyer's permission. */
  sourceRef: string
  source: ReviewSource
  /** Etsy listing the review belongs to; null for a permissioned quote from a site order. */
  etsyListingId: number | null
  /** ITP product id for that listing (etsy_listings.product_id), null when unmatched. */
  productId: string | null
  rating: 1 | 2 | 3 | 4 | 5
  /** Verbatim buyer text. */
  quote: string
  /** First name or initial as given by the buyer; 'Etsy buyer' when Etsy gave none. */
  buyerName: string
  /** ISO date of the review. */
  reviewedAt: string
  photos: RealReviewPhoto[]
}

export const REAL_REVIEWS: RealReview[] = []
