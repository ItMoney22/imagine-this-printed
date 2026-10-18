import { REAL_REVIEWS, type RealReview } from '../data/realReviews'

export interface ReviewSummary {
  count: number
  average: number
}

export function summarize(reviews: RealReview[]): ReviewSummary {
  if (reviews.length === 0) return { count: 0, average: 0 }
  const total = reviews.reduce((sum, r) => sum + r.rating, 0)
  return { count: reviews.length, average: Math.round((total / reviews.length) * 10) / 10 }
}

export function reviewsForProduct(productId: string, all: RealReview[] = REAL_REVIEWS): RealReview[] {
  return all.filter((r) => r.productId === productId)
}

/** Home page picks: photo reviews first, then newest. */
export function featuredReviews(limit = 3, all: RealReview[] = REAL_REVIEWS): RealReview[] {
  return [...all]
    .sort((a, b) => {
      const photo = Number(b.photos.length > 0) - Number(a.photos.length > 0)
      return photo || b.reviewedAt.localeCompare(a.reviewedAt)
    })
    .slice(0, limit)
}
