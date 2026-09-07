// Tests for the "real order vs abandoned checkout" rule.
//
// These pin the exact live rows from the 2026-09-07 report, because the whole
// point of the module is that those two rows stop reading as shippable orders.
import { describe, it, expect } from 'vitest'
import {
  isPaidOrder,
  isAbandonedCheckout,
  partitionOrders,
  paidRevenueTotal,
  PAID_PAYMENT_STATUSES,
  UNPAID_PAYMENT_STATUS
} from './order-visibility.js'

// The two rows David was looking at. Both `requires_payment_method` in live Stripe.
const ABANDONED_A = { order_number: 'ITP-MTRCHS6X-T7W5', status: 'pending', payment_status: 'pending', total: 34.2 }
const ABANDONED_B = { order_number: 'ITP-MTQBXPVV-38KZ', status: 'pending', payment_status: 'pending', total: 21.4 }
// The one genuine customer order in the table.
const REAL_PAID = { order_number: 'ITP-MSJK1K3I-8GDG', status: 'delivered', payment_status: 'paid', total: 26 }

describe('isPaidOrder', () => {
  it('accepts an order money actually reached us for', () => {
    expect(isPaidOrder(REAL_PAID)).toBe(true)
  })

  it('keeps refunded orders counted as real orders', () => {
    // The order happened. It was made, probably shipped. Excluding it would
    // silently rewrite revenue history every time support issued a refund.
    expect(isPaidOrder({ status: 'refunded', payment_status: 'refunded' })).toBe(true)
    expect(isPaidOrder({ status: 'shipped', payment_status: 'partially_refunded' })).toBe(true)
  })

  it('rejects the abandoned checkouts that started this', () => {
    expect(isPaidOrder(ABANDONED_A)).toBe(false)
    expect(isPaidOrder(ABANDONED_B)).toBe(false)
  })

  it('treats a missing or null payment_status as NOT paid', () => {
    // Safe direction: a false positive here ships goods nobody paid for.
    expect(isPaidOrder({ status: 'processing' })).toBe(false)
    expect(isPaidOrder({ status: 'processing', payment_status: null })).toBe(false)
    expect(isPaidOrder(null)).toBe(false)
    expect(isPaidOrder(undefined)).toBe(false)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(isPaidOrder({ payment_status: ' PAID ' })).toBe(true)
  })

  it('does not treat a fulfilment status as proof of payment', () => {
    // The exact trap: an admin dragging status to 'completed' must not make an
    // unpaid draft read as paid. payment_status decides, status never does.
    expect(isPaidOrder({ status: 'completed', payment_status: 'pending' })).toBe(false)
    expect(isPaidOrder({ status: 'shipped', payment_status: 'pending' })).toBe(false)
  })
})

describe('isAbandonedCheckout', () => {
  it('identifies both live abandoned checkouts', () => {
    expect(isAbandonedCheckout(ABANDONED_A)).toBe(true)
    expect(isAbandonedCheckout(ABANDONED_B)).toBe(true)
  })

  it('is not simply the negation of isPaidOrder', () => {
    // A declined card is not an abandoned cart and must not be chased with
    // "did you forget something?" mail.
    expect(isPaidOrder({ payment_status: 'failed' })).toBe(false)
    expect(isAbandonedCheckout({ payment_status: 'failed' })).toBe(false)
  })

  it('leaves a draft an admin already cancelled alone', () => {
    expect(isAbandonedCheckout({ status: 'cancelled', payment_status: 'pending' })).toBe(false)
  })

  it('never calls a paid order abandoned', () => {
    expect(isAbandonedCheckout(REAL_PAID)).toBe(false)
  })
})

describe('partitionOrders', () => {
  it('splits the live table exactly as the admin surfaces need it', () => {
    const rows = [ABANDONED_A, ABANDONED_B, REAL_PAID, { status: 'cancelled', payment_status: 'paid', total: 1.08 }]
    const { paid, abandoned, other } = partitionOrders(rows)
    expect(paid.map(o => o.order_number)).toEqual(['ITP-MSJK1K3I-8GDG', undefined])
    expect(abandoned.map(o => o.order_number)).toEqual(['ITP-MTRCHS6X-T7W5', 'ITP-MTQBXPVV-38KZ'])
    expect(other).toEqual([])
  })

  it('puts a failed payment in neither bucket', () => {
    const { paid, abandoned, other } = partitionOrders([{ payment_status: 'failed' }])
    expect(paid).toHaveLength(0)
    expect(abandoned).toHaveLength(0)
    expect(other).toHaveLength(1)
  })
})

describe('paidRevenueTotal', () => {
  it('excludes the phantom revenue from abandoned carts', () => {
    // AdminDashboard summed all six rows and reported $90.01. Only $36.41 of
    // that was ever real money (the $26 delivered order + $9.41 of cancelled
    // but genuinely-charged orders).
    const rows = [
      ABANDONED_A, ABANDONED_B, REAL_PAID,
      { status: 'cancelled', payment_status: 'paid', total: 1.08 },
      { status: 'cancelled', payment_status: 'paid', total: 1.08 },
      { status: 'cancelled', payment_status: 'paid', total: 7.25 }
    ]
    expect(rows.reduce((s, r) => s + Number(r.total), 0)).toBeCloseTo(91.01, 2)
    expect(paidRevenueTotal(rows)).toBeCloseTo(35.41, 2)
  })

  it('survives string and null totals', () => {
    expect(paidRevenueTotal([
      { payment_status: 'paid', total: '10.50' },
      { payment_status: 'paid', total: null },
      { payment_status: 'pending', total: 999 }
    ])).toBeCloseTo(10.5, 2)
  })

  it('is 0 for an empty list', () => {
    expect(paidRevenueTotal([])).toBe(0)
  })
})

describe('exported constants', () => {
  it('keeps the contract other modules key off stable', () => {
    expect(UNPAID_PAYMENT_STATUS).toBe('pending')
    expect(PAID_PAYMENT_STATUSES).toContain('paid')
  })
})
