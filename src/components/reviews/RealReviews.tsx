import { Star } from 'lucide-react'
import { REAL_REVIEWS, type RealReview } from '../../data/realReviews'
import { featuredReviews, reviewsForProduct, summarize } from '../../lib/real-reviews'

function StarRow({ rating, className = 'w-4 h-4' }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${className} ${n <= Math.round(rating) ? 'fill-accent text-accent' : 'text-muted'}`} />
      ))}
    </span>
  )
}

function ReviewCard({ review }: { review: RealReview }) {
  const date = new Date(review.reviewedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return (
    <figure className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
      <StarRow rating={review.rating} />
      <blockquote className="text-text leading-relaxed">&ldquo;{review.quote}&rdquo;</blockquote>
      {review.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {review.photos.map((p) => (
            <img
              key={p.url}
              src={p.url}
              alt={`Photo from ${review.buyerName}`}
              loading="lazy"
              className="h-24 w-24 rounded-lg object-cover shrink-0"
            />
          ))}
        </div>
      )}
      <figcaption className="text-sm text-muted">
        {review.buyerName} &middot; {date} &middot; {review.source === 'etsy' ? 'Etsy review' : 'Customer review'}
      </figcaption>
    </figure>
  )
}

/** Home page strip. Renders nothing until a real review exists. */
export function HomeSocialProof() {
  const picks = featuredReviews(3)
  if (picks.length === 0) return null
  const { count, average } = summarize(REAL_REVIEWS)
  return (
    <section className="py-12 sm:py-24 bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold text-text mb-3">What buyers say</h2>
          <div className="inline-flex items-center gap-2 text-muted">
            <StarRow rating={average} className="w-5 h-5" />
            <span>
              {average.toFixed(1)} from {count} real {count === 1 ? 'review' : 'reviews'}
            </span>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          {picks.map((r) => (
            <ReviewCard key={r.sourceRef} review={r} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** Product page block. Renders nothing unless this product has real reviews. */
export function ProductSocialProof({ productId }: { productId: string }) {
  const reviews = reviewsForProduct(productId)
  if (reviews.length === 0) return null
  const { count, average } = summarize(reviews)
  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-text">Reviews</h2>
        <StarRow rating={average} className="w-5 h-5" />
        <span className="text-muted">
          {average.toFixed(1)} ({count})
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {reviews.map((r) => (
          <ReviewCard key={r.sourceRef} review={r} />
        ))}
      </div>
    </section>
  )
}
