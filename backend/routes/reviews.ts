// Product reviews — read + write.
//
// The one rule that makes this feature worth having: only someone who actually
// bought the product may review it. An unverified review table is a spam
// magnet, and "verified buyer" is the entire source of the social proof.
//
// That gate is enforced HERE as well as in RLS
// (supabase/migrations/20260728140000_product_reviews.sql). Both are required:
// backend/lib/supabase.ts connects with the SERVICE ROLE key, which bypasses
// RLS completely, so the policy protects the direct-from-browser path and this
// route protects the API path. Removing either one leaves a hole.

import { Router, Request, Response } from 'express'
import { requireAuth, optionalAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import {
  PURCHASED_ORDER_STATUSES,
  summarizeReviews,
  validateReviewSubmission
} from '../lib/review-validation.js'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Storefront page size. Reviews are paginated rather than unbounded because a
// popular product's review list would otherwise dominate the page payload.
const PAGE_SIZE = 20

interface ReviewRow {
  id: string
  user_id: string
  order_id: string | null
  rating: number
  title: string | null
  body: string | null
  created_at: string
}

/**
 * Find a paid order from this customer containing this product.
 *
 * Two plain queries instead of a PostgREST embed filter: nothing else in this
 * backend uses `!inner` embeds, and an embed silently depends on PostgREST's
 * relationship cache being warm for a brand-new FK.
 *
 * Returns the order id (stored on the review for auditability) or null.
 */
async function findPurchaseOrderId(userId: string, productId: string): Promise<string | null> {
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', userId)
    .in('status', PURCHASED_ORDER_STATUSES as unknown as string[])

  if (ordersError) throw ordersError
  if (!orders || orders.length === 0) return null

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('order_id')
    .eq('product_id', productId)
    .in('order_id', orders.map((o: { id: string }) => o.id))
    .limit(1)

  if (itemsError) throw itemsError
  return items && items.length > 0 ? items[0].order_id : null
}

/** Display names for a set of reviewers, keyed by user id. */
async function loadReviewerNames(userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {}

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, display_name, first_name, username')
    .in('id', userIds)

  if (error) throw error

  const names: Record<string, string> = {}
  for (const profile of data || []) {
    // Never fall back to the email address — that would publish a customer's
    // address on a public product page.
    names[profile.id] = profile.display_name || profile.first_name || profile.username || 'Verified buyer'
  }
  return names
}

/**
 * GET /api/reviews/product/:productId
 * Public. Returns the rating summary, a page of published reviews, and — for a
 * signed-in caller — whether they are allowed to write one.
 */
router.get('/product/:productId', optionalAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { productId } = req.params
    if (!UUID_RE.test(productId)) {
      return res.status(400).json({ error: 'Invalid product id' })
    }

    const page = Math.max(1, Number(req.query.page) || 1)
    const offset = (page - 1) * PAGE_SIZE

    // The summary counts EVERY published review, not just the current page —
    // an average computed from 20 of 400 reviews is simply a wrong number.
    const { data: allRatings, error: ratingsError } = await supabase
      .from('product_reviews')
      .select('rating')
      .eq('product_id', productId)
      .eq('status', 'published')

    if (ratingsError) throw ratingsError

    const summary = summarizeReviews((allRatings || []).map((r: { rating: number }) => r.rating))

    const { data: rows, error: rowsError } = await supabase
      .from('product_reviews')
      .select('id, user_id, order_id, rating, title, body, created_at')
      .eq('product_id', productId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (rowsError) throw rowsError

    const reviews = (rows || []) as ReviewRow[]
    const names = await loadReviewerNames([...new Set(reviews.map((r) => r.user_id))])

    const userId = req.user?.sub
    let viewer: { signedIn: boolean; canReview: boolean; ownReview: ReviewRow | null } = {
      signedIn: false,
      canReview: false,
      ownReview: null
    }

    if (userId) {
      const { data: own, error: ownError } = await supabase
        .from('product_reviews')
        .select('id, user_id, order_id, rating, title, body, created_at')
        .eq('product_id', productId)
        .eq('user_id', userId)
        .maybeSingle()

      if (ownError) throw ownError

      viewer = {
        signedIn: true,
        // An existing review already proves eligibility, so skip the purchase
        // lookup in the common "come back and read my own review" case.
        canReview: own ? true : (await findPurchaseOrderId(userId, productId)) !== null,
        ownReview: (own as ReviewRow) || null
      }
    }

    res.json({
      summary,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        createdAt: r.created_at,
        authorName: names[r.user_id] || 'Verified buyer',
        // Every review in this table passed the verified-purchase gate, so the
        // badge is a statement of fact rather than a stored flag that could
        // drift away from the truth.
        verifiedPurchase: true
      })),
      page,
      pageSize: PAGE_SIZE,
      hasMore: reviews.length === PAGE_SIZE
    })
  } catch (error: any) {
    console.error('[reviews] Failed to load reviews:', error)
    res.status(500).json({ error: 'Failed to load reviews' })
  }
})

/**
 * POST /api/reviews/product/:productId
 * Write (or replace) this customer's review of a product they bought.
 *
 * Upsert rather than insert-then-409: the unique constraint is
 * (product_id, user_id), so a second submit is an edit, which is what a
 * customer means when they submit the form again.
 */
router.post('/product/:productId', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { productId } = req.params
    if (!UUID_RE.test(productId)) {
      return res.status(400).json({ error: 'Invalid product id' })
    }

    const userId = req.user?.sub
    if (!userId) return res.status(401).json({ error: 'Authentication required' })

    const validation = validateReviewSubmission(req.body)
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error })
    }

    const orderId = await findPurchaseOrderId(userId, productId)
    if (!orderId) {
      return res.status(403).json({
        error: 'Only customers who have purchased this product can review it'
      })
    }

    const { data, error } = await supabase
      .from('product_reviews')
      .upsert(
        {
          product_id: productId,
          user_id: userId,
          order_id: orderId,
          rating: validation.value.rating,
          title: validation.value.title,
          body: validation.value.body,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'product_id,user_id' }
      )
      .select('id, rating, title, body, created_at')
      .single()

    if (error) throw error

    res.status(201).json({
      review: {
        id: data.id,
        rating: data.rating,
        title: data.title,
        body: data.body,
        createdAt: data.created_at,
        verifiedPurchase: true
      }
    })
  } catch (error: any) {
    console.error('[reviews] Failed to save review:', error)
    res.status(500).json({ error: 'Failed to save review' })
  }
})

export default router
