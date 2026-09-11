import { describe, it, expect, vi } from 'vitest'
import { issueDeliveryCoupon, type DeliveryCouponDeps } from './delivery-coupon.js'

const order = { id: 'order-1', order_number: 'ITP-MTRQH7VJ-2UO1', customer_email: 'buyer@example.com' }

const makeDeps = (over: Partial<DeliveryCouponDeps> = {}): DeliveryCouponDeps => ({
  insertCoupon: vi.fn(async () => ({ ok: true as const })),
  saveCodeOnOrder: vi.fn(async () => true),
  randomSuffix: () => 'AB3K9Z',
  now: () => new Date('2026-09-11T12:00:00Z'),
  ...over
})

describe('issueDeliveryCoupon', () => {
  it('mints a single-use 10% code and records it on the order', async () => {
    const deps = makeDeps()
    const coupon = await issueDeliveryCoupon(order, deps)

    expect(coupon).not.toBeNull()
    expect(coupon!.code).toBe('THANKS10-AB3K9Z')
    expect(coupon!.percent).toBe(10)
    // 60 days of runway — long enough to be useful, short enough to pull a
    // second order forward rather than sit in an inbox forever.
    expect(coupon!.expiresAt).toBe('2026-11-10T12:00:00.000Z')

    const row = (deps.insertCoupon as any).mock.calls[0][0]
    expect(row.type).toBe('percentage')
    expect(row.value).toBe(10)
    expect(row.max_uses).toBe(1)
    expect(row.per_user_limit).toBe(1)
    expect(row.is_active).toBe(true)
    // Every issued code is traceable back to the delivery that earned it.
    expect(row.metadata.order_id).toBe('order-1')
    expect(row.metadata.source).toBe('order_delivered')
    expect(deps.saveCodeOnOrder).toHaveBeenCalledWith('order-1', 'THANKS10-AB3K9Z')
  })

  // The sweep and a manual "Delivered" click can both land on the same order.
  it('reuses the code already on the order instead of minting a second one', async () => {
    const deps = makeDeps()
    const coupon = await issueDeliveryCoupon({ ...order, delivery_coupon_code: 'THANKS10-OLD123' }, deps)

    expect(coupon!.code).toBe('THANKS10-OLD123')
    expect(coupon!.reused).toBe(true)
    expect(deps.insertCoupon).not.toHaveBeenCalled()
  })

  it('retries with a fresh suffix when the code collides', async () => {
    const suffixes = ['DUPDUP', 'FRESH1']
    let i = 0
    const insertCoupon = vi.fn(async (row: any) =>
      row.code === 'THANKS10-DUPDUP' ? { ok: false as const, duplicate: true } : { ok: true as const }
    )
    const deps = makeDeps({ insertCoupon, randomSuffix: () => suffixes[i++] })

    const coupon = await issueDeliveryCoupon(order, deps)
    expect(coupon!.code).toBe('THANKS10-FRESH1')
    expect(insertCoupon).toHaveBeenCalledTimes(2)
  })

  // A dead coupon table must never cost the customer their delivered email.
  it('returns null instead of throwing when the coupon cannot be created', async () => {
    const deps = makeDeps({ insertCoupon: vi.fn(async () => ({ ok: false as const, error: 'relation does not exist' })) })
    await expect(issueDeliveryCoupon(order, deps)).resolves.toBeNull()
  })

  it('mints nothing when the perk is switched off', async () => {
    const deps = makeDeps()
    const coupon = await issueDeliveryCoupon(order, deps, { enabled: false })
    expect(coupon).toBeNull()
    expect(deps.insertCoupon).not.toHaveBeenCalled()
  })

  // Losing the write-back is survivable (worst case: a second delivery sweep
  // mints a spare code) but the customer must still get the code they were sent.
  it('still returns the coupon when the write-back to the order fails', async () => {
    const deps = makeDeps({ saveCodeOnOrder: vi.fn(async () => false) })
    const coupon = await issueDeliveryCoupon(order, deps)
    expect(coupon!.code).toBe('THANKS10-AB3K9Z')
  })
})
