// Tests for the order status state machine (Watchtower task
// 17273d7f-2bef-43ea-a97a-5b12b7cbd352).
//
// order-status.ts is deliberately dependency-free — no Supabase, no env — so a
// plain static import works here, unlike order-pricing.test.ts which has to
// dynamic-import around backend/lib/supabase.ts's eager client construction.

import { describe, it, expect } from 'vitest'
import {
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  checkOrderTransition,
  isOrderStatus
} from './order-status.js'

describe('isOrderStatus', () => {
  it('accepts every declared status', () => {
    for (const status of ORDER_STATUSES) {
      expect(isOrderStatus(status)).toBe(true)
    }
  })

  it('rejects unknown values and non-strings', () => {
    expect(isOrderStatus('COMPLETED')).toBe(false)
    expect(isOrderStatus('archived')).toBe(false)
    expect(isOrderStatus(null)).toBe(false)
    expect(isOrderStatus(undefined)).toBe(false)
    expect(isOrderStatus(3)).toBe(false)
  })
})

describe('checkOrderTransition — rejections', () => {
  it('blocks the pending -> completed jump that awarded rewards on unpaid orders', () => {
    const result = checkOrderTransition('pending', 'completed')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('from "pending" to "completed"')
  })

  it('blocks moving backwards out of a terminal status', () => {
    for (const terminal of ['cancelled', 'refunded'] as const) {
      const result = checkOrderTransition(terminal, 'processing')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('terminal status')
    }
  })

  it('blocks skipping fulfilment steps out of a hold', () => {
    expect(checkOrderTransition('on_hold', 'shipped').ok).toBe(false)
    expect(checkOrderTransition('on_hold', 'completed').ok).toBe(false)
  })

  it('blocks rewinding a delivered order back to processing', () => {
    expect(checkOrderTransition('delivered', 'processing').ok).toBe(false)
  })

  it('rejects an unknown target status even when the current status is unknown', () => {
    const result = checkOrderTransition('who-knows', 'archived')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Unknown order status')
  })
})

describe('checkOrderTransition — allowances', () => {
  it('allows the normal fulfilment path end to end', () => {
    const path = ['pending', 'processing', 'printed', 'shipped', 'delivered', 'completed'] as const
    for (let i = 0; i < path.length - 1; i++) {
      const result = checkOrderTransition(path[i], path[i + 1])
      expect(result.ok, `${path[i]} -> ${path[i + 1]}`).toBe(true)
      if (result.ok) expect(result.kind).toBe('move')
    }
  })

  it('allows a refund from every post-payment status', () => {
    for (const from of ['paid', 'shipped', 'delivered', 'completed'] as const) {
      expect(checkOrderTransition(from, 'refunded').ok, from).toBe(true)
    }
  })

  it('treats an unknown current status as movable so legacy rows are not bricked', () => {
    const result = checkOrderTransition('awaiting_payment', 'on_hold')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.unknownFrom).toBe(true)

    const fromNull = checkOrderTransition(null, 'cancelled')
    expect(fromNull.ok).toBe(true)
    if (fromNull.ok) expect(fromNull.unknownFrom).toBe(true)
  })
})

describe('checkOrderTransition — idempotency', () => {
  it('reports same-status writes as a noop rather than an error', () => {
    for (const status of ORDER_STATUSES) {
      const result = checkOrderTransition(status, status)
      expect(result.ok, status).toBe(true)
      if (result.ok) expect(result.kind).toBe('noop')
    }
  })
})

describe('ORDER_STATUS_TRANSITIONS table integrity', () => {
  it('has an entry for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_TRANSITIONS[status]).toBeDefined()
    }
  })

  it('only ever points at declared statuses, and never at itself', () => {
    for (const status of ORDER_STATUSES) {
      for (const target of ORDER_STATUS_TRANSITIONS[status]) {
        expect(isOrderStatus(target), `${status} -> ${target}`).toBe(true)
        expect(target, `${status} lists itself`).not.toBe(status)
      }
    }
  })
})
