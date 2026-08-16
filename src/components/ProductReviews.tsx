import React, { useCallback, useEffect, useState } from 'react'
import { Star, BadgeCheck, Loader2 } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { apiFetch } from '../lib/api'

// ---------------------------------------------------------------------------
// Product reviews + ratings for the storefront product page.
//
// Read + write both go through the backend API (GET/POST
// /api/reviews/product/:productId), never a direct-from-browser Supabase
// insert — the backend enforces the verified-purchase gate on the service-role
// connection, which RLS alone cannot (service role bypasses RLS).
//
// The one product/design rule that matters here: every review in this list
// passed the verified-purchase gate, so the "Verified buyer" badge is rendered
// as a statement of fact rather than a stored flag that could drift. See
// backend/routes/reviews.ts.
// ---------------------------------------------------------------------------

interface ReviewSummary {
  count: number
  average: number
  distribution: Record<string, number>
}

interface Review {
  id: string
  rating: number
  title: string | null
  body: string | null
  createdAt: string
  authorName: string
  verifiedPurchase: boolean
}

interface ViewerState {
  signedIn: boolean
  canReview: boolean
  ownReview: Review | null
}

interface ReviewsResponse {
  summary: ReviewSummary
  reviews: Review[]
  page: number
  pageSize: number
  hasMore: boolean
  viewer: ViewerState
}

const STAR_VALUES = [1, 2, 3, 4, 5] as const

/** Relative bar width for the distribution histogram. */
function distributionPercent(distribution: Record<string, number>, star: number): number {
  const total = Object.values(distribution).reduce((sum, n) => sum + n, 0)
  if (total === 0) return 0
  return Math.round((distribution[String(star)] / total) * 100)
}

function StarRating({
  value,
  size = 16,
  className = ''
}: {
  value: number
  size?: number
  className?: string
}) {
  return (
    <div className={`flex items-center gap-0.5 ${className}`} aria-label={`${value} out of 5 stars`}>
      {STAR_VALUES.map((star) => (
        <Star
          key={star}
          size={size}
          className={star <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}
        />
      ))}
    </div>
  )
}

const ProductReviews: React.FC<{ productId: string }> = ({ productId }) => {
  const { user } = useAuth()
  const toast = useToast()

  const [summary, setSummary] = useState<ReviewSummary>({ count: 0, average: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } })
  const [reviews, setReviews] = useState<Review[]>([])
  const [viewer, setViewer] = useState<ViewerState>({ signedIn: false, canReview: false, ownReview: null })
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Form state
  const [formOpen, setFormOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (nextPage: number) => {
    try {
      const data: ReviewsResponse = await apiFetch(`/api/reviews/product/${productId}?page=${nextPage}`)
      setSummary(data.summary)
      setViewer(data.viewer)
      setHasMore(data.hasMore)
      setPage(data.page)
      if (nextPage === 1) {
        setReviews(data.reviews)
      } else {
        setReviews((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          return [...prev, ...data.reviews.filter((r) => !seen.has(r.id))]
        })
      }
    } catch (err) {
      // A product page must never crash because its review list failed to load.
      // Surface nothing loud — the section simply shows zero reviews.
      console.error('[ProductReviews] failed to load:', err)
      setReviews([])
      setSummary({ count: 0, average: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [productId])

  useEffect(() => {
    load(1)
  }, [load])

  const loadMore = () => {
    setLoadingMore(true)
    load(page + 1)
  }

  const openForm = () => {
    if (viewer.ownReview) {
      setRating(viewer.ownReview.rating)
      setTitle(viewer.ownReview.title || '')
      setBody(viewer.ownReview.body || '')
    }
    setFormOpen(true)
  }

  const submitReview = async () => {
    if (rating < 1 || rating > 5) {
      toast.warning('Rating required', 'Please pick a star rating')
      return
    }
    setSubmitting(true)
    try {
      await apiFetch(`/api/reviews/product/${productId}`, {
        method: 'POST',
        body: JSON.stringify({
          rating,
          title: title.trim() || null,
          body: body.trim() || null
        })
      })
      toast.success('Review saved', 'Thanks — your review is live on this product.')
      setFormOpen(false)
      setRating(0)
      setTitle('')
      setBody('')
      await load(1)
    } catch (err: any) {
      console.error('[ProductReviews] submit failed:', err)
      toast.error('Could not save review', err?.message || 'Please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <section className="mt-16" aria-label="Customer reviews">
        <div className="flex items-center gap-2 text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading reviews…</span>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-16" aria-label="Customer reviews">
      <h2 className="text-2xl font-bold text-text font-serif mb-6">Customer Reviews</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Rating summary + write-a-review CTA */}
        <div className="md:col-span-1">
          <div className="bg-card card-border rounded-lg p-6">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-5xl font-bold text-text">{summary.count > 0 ? summary.average.toFixed(1) : '—'}</span>
              <div className="flex flex-col">
                <StarRating value={summary.count > 0 ? Math.round(summary.average) : 0} size={18} />
                <span className="text-sm text-muted mt-1">
                  {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 mt-4">
              {STAR_VALUES.slice().reverse().map((star) => (
                <div key={star} className="flex items-center gap-2">
                  <span className="text-xs text-muted w-8 text-right">{star}★</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-500"
                      style={{ width: `${distributionPercent(summary.distribution, star)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted w-6">{summary.distribution[String(star)]}</span>
                </div>
              ))}
            </div>

            {/* Write-a-review affordance. Only verified buyers see the CTA; a
                signed-out shopper is nudged toward sign-in. */}
            <div className="mt-6">
              {user ? (
                viewer.canReview ? (
                  <button
                    onClick={openForm}
                    className="w-full btn-primary shadow-glow"
                  >
                    {viewer.ownReview ? 'Edit your review' : 'Write a review'}
                  </button>
                ) : (
                  <p className="text-sm text-muted text-center">
                    You can review this once you've purchased it.
                  </p>
                )
              ) : (
                <p className="text-sm text-muted text-center">
                  <a href="/login" className="text-primary hover:text-secondary font-medium">Sign in</a>{' '}
                  to write a review.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Review list + submission form */}
        <div className="md:col-span-2 space-y-6">
          {formOpen && (
            <div className="bg-card card-border rounded-lg p-6 shadow-soft">
              <h3 className="text-lg font-semibold text-text mb-4">
                {viewer.ownReview ? 'Update your review' : 'Write a review'}
              </h3>

              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Your rating</label>
                <div
                  className="flex items-center gap-1"
                  onMouseLeave={() => setHoveredRating(0)}
                >
                  {STAR_VALUES.map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoveredRating(star)}
                      aria-label={`${star} star${star > 1 ? 's' : ''}`}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star
                        size={28}
                        className={
                          star <= (hoveredRating || rating)
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-300'
                        }
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-sm text-muted">
                    {rating > 0 ? `${rating} star${rating > 1 ? 's' : ''}` : 'Select a rating'}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Headline <span className="text-muted font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Sum it up in a line"
                  className="w-full px-4 py-2 rounded-md border border-slate-300 bg-bg text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Your review <span className="text-muted font-normal">(optional)</span></label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  placeholder="How did it fit? What did you think of the print?"
                  className="w-full px-4 py-2 rounded-md border border-slate-300 bg-bg text-text focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={submitReview}
                  disabled={submitting || rating === 0}
                  className="btn-primary shadow-glow disabled:opacity-60 flex items-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitting ? 'Saving…' : 'Submit review'}
                </button>
                <button
                  onClick={() => setFormOpen(false)}
                  className="text-sm text-muted hover:text-text transition-colors px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {reviews.length === 0 ? (
            <div className="bg-card card-border rounded-lg p-8 text-center">
              <p className="text-muted text-sm">
                No reviews yet. Be the first to review this piece.
              </p>
            </div>
          ) : (
            reviews.map((review) => (
              <article key={review.id} className="bg-card card-border rounded-lg p-6">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <StarRating value={review.rating} size={14} />
                      {review.title && (
                        <h3 className="font-semibold text-text">{review.title}</h3>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                      <span className="font-medium text-text">{review.authorName}</span>
                      {review.verifiedPurchase && (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <BadgeCheck className="w-3.5 h-3.5" />
                          Verified buyer
                        </span>
                      )}
                      <span>·</span>
                      <span>{formatDate(review.createdAt)}</span>
                    </div>
                  </div>
                </div>
                {review.body && <p className="text-muted leading-relaxed mt-2">{review.body}</p>}
              </article>
            ))
          )}

          {hasMore && (
            <div className="text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn-secondary disabled:opacity-60 flex items-center gap-2 mx-auto"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Show more reviews'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default ProductReviews
