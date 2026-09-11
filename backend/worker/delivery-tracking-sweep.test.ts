import { describe, it, expect, vi } from 'vitest'

// The sweep transitively imports backend/lib/supabase.ts, which calls
// createClient() eagerly at module load and throws without a URL/key. These
// tests inject their own deps and never touch a real client, so dummy values
// are fine. Dynamic import (ESM hoists a static one above this assignment) is
// what makes the ordering work — mirrors step-flow-stall-sweep.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { sweepDeliveries } = await import('./delivery-tracking-sweep.js')
type DeliverySweepDeps = Parameters<typeof sweepDeliveries>[0]

const order = (id: string) => ({
  id,
  order_number: `ITP-${id}`,
  status: 'shipped',
  customer_email: 'buyer@example.com',
  tracking_number: `1Z${id}`,
  tracking_company: 'UPS'
})

const quiet = { deliveredNow: false, emailed: false, error: null, couponCode: null }

const makeDeps = (over: Partial<DeliverySweepDeps> = {}): DeliverySweepDeps => ({
  fetchDueOrders: vi.fn(async () => [order('a'), order('b')]),
  sync: vi.fn(async () => quiet),
  ...over
})

describe('sweepDeliveries', () => {
  it('polls every due order and reports a quiet tick', async () => {
    const deps = makeDeps()
    const summary = await sweepDeliveries(deps)

    expect(summary).toEqual({ scanned: 2, delivered: 0, emailed: 0, errors: 0 })
    expect(deps.sync).toHaveBeenCalledTimes(2)
  })

  it('counts deliveries and the emails they triggered', async () => {
    const deps = makeDeps({
      sync: vi.fn(async (o: any) =>
        o.id === 'a'
          ? { deliveredNow: true, emailed: true, error: null, couponCode: 'THANKS10-AAA111' }
          : quiet
      )
    })
    const summary = await sweepDeliveries(deps)

    expect(summary.delivered).toBe(1)
    expect(summary.emailed).toBe(1)
  })

  // A delivery whose email bounced is still a delivery — the order must move.
  it('separates "delivered" from "emailed"', async () => {
    const deps = makeDeps({
      sync: vi.fn(async () => ({ deliveredNow: true, emailed: false, error: 'Resend 500', couponCode: null }))
    })
    const summary = await sweepDeliveries(deps)

    expect(summary.delivered).toBe(2)
    expect(summary.emailed).toBe(0)
    expect(summary.errors).toBe(2)
  })

  // One poisoned order must never stop the rest of the batch.
  it('keeps going when a single order throws', async () => {
    const deps = makeDeps({
      sync: vi.fn(async (o: any) => {
        if (o.id === 'a') throw new Error('carrier exploded')
        return { deliveredNow: true, emailed: true, error: null, couponCode: null }
      })
    })
    const summary = await sweepDeliveries(deps)

    expect(summary.scanned).toBe(2)
    expect(summary.errors).toBe(1)
    expect(summary.delivered).toBe(1)
  })

  it('does nothing when no order is due', async () => {
    const deps = makeDeps({ fetchDueOrders: vi.fn(async () => []) })
    const summary = await sweepDeliveries(deps)

    expect(summary.scanned).toBe(0)
    expect(deps.sync).not.toHaveBeenCalled()
  })
})
