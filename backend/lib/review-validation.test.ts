// Tests for product review validation + rating aggregation (Watchtower task
// cd19d3fb-cce5-437e-946c-8e271167d9b7).
//
// review-validation.ts is dependency-free, so a plain static import works —
// same as order-status.test.ts.

import { describe, it, expect } from 'vitest'
import {
  PURCHASED_ORDER_STATUSES,
  REVIEW_BODY_MAX,
  REVIEW_TITLE_MAX,
  summarizeReviews,
  validateReviewSubmission
} from './review-validation.js'

describe('validateReviewSubmission — rating', () => {
  it('accepts each whole star value', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const result = validateReviewSubmission({ rating })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.rating).toBe(rating)
    }
  })

  it('rejects a fractional rating instead of rounding it', () => {
    // The column is SMALLINT. Rounding here would persist a 5-star review the
    // customer never gave.
    const result = validateReviewSubmission({ rating: 4.6 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('whole number')
  })

  it('rejects out-of-range and non-numeric ratings', () => {
    for (const rating of [0, 6, -1, 100, '5', null, undefined, NaN]) {
      expect(validateReviewSubmission({ rating }).ok).toBe(false)
    }
  })

  it('rejects a non-object body', () => {
    expect(validateReviewSubmission(null).ok).toBe(false)
    expect(validateReviewSubmission('5 stars').ok).toBe(false)
  })
})

describe('validateReviewSubmission — text fields', () => {
  it('trims and treats whitespace-only text as absent', () => {
    const result = validateReviewSubmission({ rating: 5, title: '  Great  ', body: '   ' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBe('Great')
      expect(result.value.body).toBeNull()
    }
  })

  it('allows a rating with no text at all', () => {
    const result = validateReviewSubmission({ rating: 4 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBeNull()
      expect(result.value.body).toBeNull()
    }
  })

  it('rejects text longer than the DB CHECK constraint allows', () => {
    // A 500 from a Postgres constraint violation is the failure mode this
    // prevents — the limits must match the migration exactly.
    expect(validateReviewSubmission({ rating: 5, title: 'x'.repeat(REVIEW_TITLE_MAX + 1) }).ok).toBe(false)
    expect(validateReviewSubmission({ rating: 5, body: 'x'.repeat(REVIEW_BODY_MAX + 1) }).ok).toBe(false)
  })

  it('accepts text exactly at the limit', () => {
    expect(validateReviewSubmission({ rating: 5, title: 'x'.repeat(REVIEW_TITLE_MAX) }).ok).toBe(true)
    expect(validateReviewSubmission({ rating: 5, body: 'x'.repeat(REVIEW_BODY_MAX) }).ok).toBe(true)
  })

  it('rejects non-string text fields', () => {
    expect(validateReviewSubmission({ rating: 5, title: 42 }).ok).toBe(false)
    expect(validateReviewSubmission({ rating: 5, body: { text: 'hi' } }).ok).toBe(false)
  })
})

describe('PURCHASED_ORDER_STATUSES', () => {
  it('excludes unpaid, cancelled and refunded orders', () => {
    for (const status of ['pending', 'cancelled', 'refunded', 'on_hold']) {
      expect(PURCHASED_ORDER_STATUSES as readonly string[]).not.toContain(status)
    }
  })

  it('includes every post-payment status', () => {
    for (const status of ['paid', 'processing', 'printed', 'shipped', 'delivered', 'completed']) {
      expect(PURCHASED_ORDER_STATUSES as readonly string[]).toContain(status)
    }
  })
})

describe('summarizeReviews', () => {
  it('reports zeroes for a product with no reviews', () => {
    const summary = summarizeReviews([])
    expect(summary).toEqual({
      count: 0,
      average: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
    })
  })

  it('averages to one decimal and builds the histogram', () => {
    const summary = summarizeReviews([5, 4, 4, 3])
    expect(summary.count).toBe(4)
    expect(summary.average).toBe(4)
    expect(summary.distribution).toEqual({ '1': 0, '2': 0, '3': 1, '4': 2, '5': 1 })
  })

  it('does not leak float noise into the displayed average', () => {
    // 5/3 = 1.6666... and (3+4)/2 = 3.5 are the two shapes that render as
    // "1.6666666666666667 stars" if the rounding is skipped.
    expect(summarizeReviews([1, 2, 2]).average).toBe(1.7)
    expect(summarizeReviews([3, 4]).average).toBe(3.5)
    expect(summarizeReviews([4, 4, 4]).average).toBe(4)
  })

  it('ignores corrupt ratings rather than crashing the product page', () => {
    const summary = summarizeReviews([5, 0, 9, 4.5 as number, NaN, 3])
    expect(summary.count).toBe(2)
    expect(summary.average).toBe(4)
    expect(summary.distribution['5']).toBe(1)
    expect(summary.distribution['3']).toBe(1)
  })
})
