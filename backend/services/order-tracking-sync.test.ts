import { describe, it, expect, vi } from 'vitest'
import { syncOrderTracking, type TrackingSyncDeps } from './order-tracking-sync.js'
import type { LiveTracking } from './shipment-tracking.js'

const live = (over: Partial<LiveTracking> = {}): LiveTracking => ({
  trackingNumber: '1ZB8F618YN62290045',
  carrier: 'UPS',
  trackingUrl: 'https://www.ups.com/track?tracknum=1ZB8F618YN62290045',
  status: 'in_transit',
  statusDetail: 'Your shipment is in transit.',
  statusAt: '2026-09-11T08:14:00.000Z',
  location: 'Atlanta, GA',
  eta: '2026-09-16T05:00:00.000Z',
  service: 'Surepost Lightweight',
  events: [{ status: 'in_transit', detail: 'Your shipment is in transit.', date: '2026-09-11T08:14:00.000Z', location: 'Atlanta, GA' }],
  ...over
})

const shippedOrder = {
  id: 'order-1',
  order_number: 'ITP-MTRQH7VJ-2UO1',
  status: 'shipped',
  customer_email: 'buyer@example.com',
  customer_name: 'Casey',
  tracking_number: '1ZB8F618YN62290045',
  tracking_company: 'UPS'
}

const makeDeps = (over: Partial<TrackingSyncDeps> = {}): TrackingSyncDeps => ({
  fetchTracking: vi.fn(async () => ({ ok: true as const, tracking: live() })),
  saveSnapshot: vi.fn(async () => true),
  claimDelivered: vi.fn(async () => true),
  issueCoupon: vi.fn(async () => ({ code: 'THANKS10-AB3K9Z', percent: 10, expiresAt: '2026-11-10T12:00:00.000Z', reused: false })),
  sendDeliveredEmail: vi.fn(async () => true),
  now: () => new Date('2026-09-11T12:00:00Z'),
  ...over
})

describe('syncOrderTracking', () => {
  it('does nothing for an order with no tracking number', async () => {
    const deps = makeDeps()
    const out = await syncOrderTracking({ ...shippedOrder, tracking_number: null }, deps)
    expect(out.skipped).toBe('no_tracking')
    expect(deps.fetchTracking).not.toHaveBeenCalled()
    expect(deps.saveSnapshot).not.toHaveBeenCalled()
  })

  it('stores the live scan on the order and leaves the customer alone', async () => {
    const deps = makeDeps()
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.status).toBe('in_transit')
    expect(out.deliveredNow).toBe(false)
    const patch = (deps.saveSnapshot as any).mock.calls[0][1]
    expect(patch.tracking_status).toBe('in_transit')
    expect(patch.tracking_status_detail).toBe('Your shipment is in transit.')
    expect(patch.tracking_location).toBe('Atlanta, GA')
    expect(patch.tracking_eta).toBe('2026-09-16T05:00:00.000Z')
    expect(patch.tracking_events).toHaveLength(1)
    expect(patch.tracking_checked_at).toBe('2026-09-11T12:00:00.000Z')
    expect(patch.tracking_error).toBeNull()
    expect(deps.sendDeliveredEmail).not.toHaveBeenCalled()
    expect(deps.claimDelivered).not.toHaveBeenCalled()
  })

  it('marks the order delivered, mints the coupon and mails it', async () => {
    const deps = makeDeps({ fetchTracking: vi.fn(async () => ({ ok: true as const, tracking: live({ status: 'delivered', statusDetail: 'Delivered, front porch' }) })) })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.deliveredNow).toBe(true)
    expect(out.couponCode).toBe('THANKS10-AB3K9Z')
    expect(out.emailed).toBe(true)
    expect(deps.claimDelivered).toHaveBeenCalledWith('order-1', '2026-09-11T08:14:00.000Z')
    const [emailedOrder, coupon] = (deps.sendDeliveredEmail as any).mock.calls[0]
    expect(emailedOrder.id).toBe('order-1')
    expect(coupon.code).toBe('THANKS10-AB3K9Z')
  })

  // Two sweeps (or a sweep racing an admin click) must not double-mail.
  it('sends nothing when another writer already claimed the delivery', async () => {
    const deps = makeDeps({
      fetchTracking: vi.fn(async () => ({ ok: true as const, tracking: live({ status: 'delivered' }) })),
      claimDelivered: vi.fn(async () => false)
    })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.deliveredNow).toBe(false)
    expect(deps.issueCoupon).not.toHaveBeenCalled()
    expect(deps.sendDeliveredEmail).not.toHaveBeenCalled()
  })

  // A refunded/cancelled order that the carrier later scans as delivered must
  // not be dragged back into the fulfilment flow.
  it('refuses to deliver an order whose lifecycle forbids it', async () => {
    const deps = makeDeps({ fetchTracking: vi.fn(async () => ({ ok: true as const, tracking: live({ status: 'delivered' }) })) })
    const out = await syncOrderTracking({ ...shippedOrder, status: 'refunded' }, deps)

    expect(out.deliveredNow).toBe(false)
    expect(deps.claimDelivered).not.toHaveBeenCalled()
    // The scan is still recorded — the admin should see what the carrier says.
    expect((deps.saveSnapshot as any).mock.calls[0][1].tracking_status).toBe('delivered')
  })

  it('still sends the delivered email when the coupon could not be minted', async () => {
    const deps = makeDeps({
      fetchTracking: vi.fn(async () => ({ ok: true as const, tracking: live({ status: 'delivered' }) })),
      issueCoupon: vi.fn(async () => null)
    })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.deliveredNow).toBe(true)
    expect(out.couponCode).toBeNull()
    expect(deps.sendDeliveredEmail).toHaveBeenCalled()
    expect((deps.sendDeliveredEmail as any).mock.calls[0][1]).toBeNull()
  })

  it('keeps the delivered status when the email provider blows up', async () => {
    const deps = makeDeps({
      fetchTracking: vi.fn(async () => ({ ok: true as const, tracking: live({ status: 'delivered' }) })),
      sendDeliveredEmail: vi.fn(async () => { throw new Error('Resend 500') })
    })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.deliveredNow).toBe(true)
    expect(out.emailed).toBe(false)
    expect(out.error).toContain('Resend 500')
  })

  it('records a poll failure without clobbering the last known status', async () => {
    const deps = makeDeps({ fetchTracking: vi.fn(async () => ({ ok: false as const, reason: 'error' as const, message: 'Shippo 503' })) })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.status).toBeNull()
    expect(out.error).toBe('Shippo 503')
    const patch = (deps.saveSnapshot as any).mock.calls[0][1]
    expect(patch.tracking_error).toBe('Shippo 503')
    expect(patch.tracking_checked_at).toBe('2026-09-11T12:00:00.000Z')
    expect(patch.tracking_status).toBeUndefined()
  })

  // Nothing is wrong with the order — the feature is simply not configured.
  it('writes nothing at all when Shippo is not configured', async () => {
    const deps = makeDeps({ fetchTracking: vi.fn(async () => ({ ok: false as const, reason: 'no_token' as const, message: 'off' })) })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.skipped).toBe('no_token')
    expect(deps.saveSnapshot).not.toHaveBeenCalled()
  })

  it('treats a number Shippo has never seen as a soft, retryable miss', async () => {
    const deps = makeDeps({ fetchTracking: vi.fn(async () => ({ ok: false as const, reason: 'not_found' as const, message: 'no record yet' })) })
    const out = await syncOrderTracking(shippedOrder, deps)

    expect(out.error).toBe('no record yet')
    expect((deps.saveSnapshot as any).mock.calls[0][1].tracking_error).toBe('no record yet')
  })
})
