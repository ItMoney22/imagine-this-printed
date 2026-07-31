// Tests for the ITP -> Darrell V2 merch order-event sender (Watchtower task
// c83da451). The receiving contract is authoritative and lives at
// D:/Projects for MetaSphere/Darrell V2/docs/merch-orders-webhook.md — the
// signature test below mirrors its documented reference signer verbatim.
//
// backend/lib/supabase.ts creates its client eagerly at module load, so
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must exist BEFORE merch-webhook.ts
// (which imports it) is evaluated. None of these tests touch a real
// database — sendMerchOrderEvent's DB-touching paths are only exercised
// through the "inert until configured" guards below, which return before any
// Supabase call — so dummy values are fine. A dynamic import after setting
// the env vars (rather than a static import, which ESM hoists ahead of any
// code in this file) is what makes the ordering work — same pattern as
// backend/services/order-pricing.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  signMerchPayload,
  buildMerchEventId,
  buildMerchOrderPayload,
  selectDarrellItems,
  deliverMerchEvent,
  sendMerchOrderEvent,
  MERCH_WEBHOOK_URL
} = await import('./merch-webhook.js')

const DARRELL_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_CREATOR_ID = '22222222-2222-2222-2222-222222222222'

describe('signMerchPayload', () => {
  it('matches the reference signer documented in Darrell V2 docs/merch-orders-webhook.md', () => {
    const secret = 'test-shared-secret'
    const rawBody = '{"id":"evt_abc","type":"order.paid"}'
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    expect(signMerchPayload(rawBody, secret)).toBe(expected)
  })

  it('is sensitive to the exact raw bytes (never re-serializes)', () => {
    const secret = 'test-shared-secret'
    const compact = '{"id":"evt_abc"}'
    const spaced = '{ "id": "evt_abc" }' // same data, different bytes
    expect(signMerchPayload(compact, secret)).not.toBe(signMerchPayload(spaced, secret))
  })

  it('produces a different signature for a different secret', () => {
    const rawBody = '{"id":"evt_abc"}'
    expect(signMerchPayload(rawBody, 'secret-a')).not.toBe(signMerchPayload(rawBody, 'secret-b'))
  })
})

describe('buildMerchEventId', () => {
  it('is deterministic for the same order + type (redelivery dedupes on their end)', () => {
    expect(buildMerchEventId('order-1', 'order.paid')).toBe(buildMerchEventId('order-1', 'order.paid'))
  })

  it('differs by event type for the same order', () => {
    expect(buildMerchEventId('order-1', 'order.paid')).not.toBe(buildMerchEventId('order-1', 'order.refunded'))
  })
})

describe('buildMerchOrderPayload', () => {
  it('matches the contract shape', () => {
    const order = { id: 'order-1', order_number: 'ITP-123', customer_email: 'buyer@example.com', currency: 'USD' }
    const items = [{
      externalRef: 'design-1',
      productId: 'prod-1',
      orderItemId: 'item-1',
      quantity: 2,
      unitAmountCents: 2500,
      subtotalCents: 5000,
      creatorMarginCents: 1500
    }]
    const payload = buildMerchOrderPayload(order, items, 'order.paid')

    expect(payload.id).toBe(buildMerchEventId('order-1', 'order.paid'))
    expect(payload.type).toBe('order.paid')
    expect(typeof payload.occurredAt).toBe('string')
    expect(payload.order).toEqual({
      id: 'order-1',
      number: 'ITP-123',
      buyerEmail: 'buyer@example.com',
      currency: 'usd'
    })
    expect(payload.items).toEqual(items)
  })

  it('omits optional order fields when absent instead of sending null-shaped keys', () => {
    const order = { id: 'order-2', order_number: null, customer_email: null, currency: null }
    const payload = buildMerchOrderPayload(order, [], 'order.canceled')
    expect(payload.order).toEqual({ id: 'order-2', currency: 'usd' })
  })
})

describe('selectDarrellItems (the creator privacy gate)', () => {
  const productsById = new Map([
    ['prod-darrell', { id: 'prod-darrell', created_by_user_id: DARRELL_ID, metadata: { external_ref: 'design-abc' } }],
    ['prod-other', { id: 'prod-other', created_by_user_id: OTHER_CREATOR_ID, metadata: { external_ref: 'design-xyz' } }],
  ])
  const royaltiesByProduct = new Map([['prod-darrell', 1500]])

  it('includes only line items whose product belongs to the configured creator', () => {
    const items = [
      { id: 'item-1', product_id: 'prod-darrell', quantity: 2, unit_price: 25 },
      { id: 'item-2', product_id: 'prod-other', quantity: 1, unit_price: 30 },
    ]
    const out = selectDarrellItems(items, productsById, royaltiesByProduct, DARRELL_ID)

    expect(out).toHaveLength(1)
    expect(out[0].productId).toBe('prod-darrell')
    expect(out[0].externalRef).toBe('design-abc')
    expect(out[0].unitAmountCents).toBe(2500)
    expect(out[0].subtotalCents).toBe(5000)
    expect(out[0].creatorMarginCents).toBe(1500)
  })

  it('excludes every line item when the whole order belongs to a different creator', () => {
    const items = [{ id: 'item-2', product_id: 'prod-other', quantity: 1, unit_price: 30 }]
    const out = selectDarrellItems(items, productsById, royaltiesByProduct, DARRELL_ID)
    expect(out).toHaveLength(0)
  })

  it('excludes items with no matching product row rather than guessing', () => {
    const items = [{ id: 'item-3', product_id: 'unknown-product', quantity: 1, unit_price: 10 }]
    const out = selectDarrellItems(items, productsById, royaltiesByProduct, DARRELL_ID)
    expect(out).toHaveLength(0)
  })

  it('excludes custom cart lines with a null product_id', () => {
    const items = [{ id: 'item-4', product_id: null, quantity: 1, unit_price: 10 }]
    const out = selectDarrellItems(items, productsById, royaltiesByProduct, DARRELL_ID)
    expect(out).toHaveLength(0)
  })
})

describe('deliverMerchEvent (bounded retry policy)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not retry a 400 (bad signature/json/payload per contract)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await deliverMerchEvent(MERCH_WEBHOOK_URL, '{}', 'sha256=deadbeef')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on a 5xx and stops after the bounded attempt count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await deliverMerchEvent(MERCH_WEBHOOK_URL, '{}', 'sha256=deadbeef')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 10000)

  it('stops retrying as soon as a delivery succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ received: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await deliverMerchEvent(MERCH_WEBHOOK_URL, '{}', 'sha256=deadbeef')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 10000)

  it('retries once on a network/timeout error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)

    await deliverMerchEvent(MERCH_WEBHOOK_URL, '{}', 'sha256=deadbeef')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 10000)
})

describe('sendMerchOrderEvent — inert until configured', () => {
  const originalSecret = process.env.MERCH_WEBHOOK_SECRET
  const originalCreatorId = process.env.MERCH_WEBHOOK_CREATOR_USER_ID

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalSecret === undefined) delete process.env.MERCH_WEBHOOK_SECRET
    else process.env.MERCH_WEBHOOK_SECRET = originalSecret
    if (originalCreatorId === undefined) delete process.env.MERCH_WEBHOOK_CREATOR_USER_ID
    else process.env.MERCH_WEBHOOK_CREATOR_USER_ID = originalCreatorId
  })

  it('no-ops (never calls fetch, never throws) when MERCH_WEBHOOK_SECRET is unset', async () => {
    delete process.env.MERCH_WEBHOOK_SECRET
    process.env.MERCH_WEBHOOK_CREATOR_USER_ID = DARRELL_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendMerchOrderEvent({ orderId: 'order-1', type: 'order.paid' })).resolves.toBeUndefined()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no-ops (never calls fetch, never throws) when MERCH_WEBHOOK_CREATOR_USER_ID is unset', async () => {
    process.env.MERCH_WEBHOOK_SECRET = 'test-secret'
    delete process.env.MERCH_WEBHOOK_CREATOR_USER_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendMerchOrderEvent({ orderId: 'order-1', type: 'order.paid' })).resolves.toBeUndefined()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
