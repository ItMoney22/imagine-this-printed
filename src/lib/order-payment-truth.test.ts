import { describe, it, expect } from 'vitest'
import { wasEverPaid, isUnpaidDraft, EVER_PAID_PAYMENT_STATUSES } from './order-payment-truth'

describe('order payment truth', () => {
  it('treats a paid order as paid', () => {
    expect(wasEverPaid('paid')).toBe(true)
    expect(isUnpaidDraft('paid')).toBe(false)
  })

  it('treats an abandoned checkout as an unpaid draft', () => {
    // routes/stripe.ts writes status='pending', payment_status='pending' when
    // the payment intent is created — before the customer pays, or doesn't.
    expect(wasEverPaid('pending')).toBe(false)
    expect(isUnpaidDraft('pending')).toBe(true)
  })

  it('treats a missing or empty payment_status as unpaid', () => {
    expect(isUnpaidDraft(null)).toBe(true)
    expect(isUnpaidDraft(undefined)).toBe(true)
    expect(isUnpaidDraft('')).toBe(true)
  })

  it('counts refunded, partially refunded and disputed as money that landed', () => {
    // A refund is a payment that came in and went back out — the customer must
    // not be shown a Pay Now button for it, and the admin must still see it as
    // a real order.
    expect(wasEverPaid('refunded')).toBe(true)
    expect(wasEverPaid('partially_refunded')).toBe(true)
    expect(wasEverPaid('disputed')).toBe(true)
  })

  it('does not care about casing or stray whitespace', () => {
    expect(wasEverPaid(' Paid ')).toBe(true)
    expect(wasEverPaid('REFUNDED')).toBe(true)
  })

  it('rejects statuses that only look paid', () => {
    expect(wasEverPaid('unpaid')).toBe(false)
    expect(wasEverPaid('requires_payment_method')).toBe(false)
    expect(wasEverPaid('failed')).toBe(false)
    expect(wasEverPaid('cancelled')).toBe(false)
  })

  it('matches the backend EVER_PAID_STATUSES set exactly', () => {
    expect([...EVER_PAID_PAYMENT_STATUSES]).toEqual([
      'paid',
      'refunded',
      'partially_refunded',
      'disputed'
    ])
  })
})
