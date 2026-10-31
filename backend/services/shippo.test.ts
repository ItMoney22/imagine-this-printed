import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buyLabel, estimateCarrierRates, labelCentsOf, labelTrackingStatus, quoteRates, refundLabel, withMarkup } from './shippo.js'

// The one Shippo client (services/shippo.ts): the main site's quote, the admin label and a store seller's label all
// call it, so a quote and the label it pays for follow the same rules. Shippo itself is faked at fetch.

const from = { name: 'Imagine This Printed', street1: '640 Goodyear Ave', city: 'Rockmart', state: 'GA', zip: '30153', country: 'US' }
const to = { name: 'Pat Buyer', street1: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30303', country: 'US' }

const rate = (provider: string, token: string, name: string, amount: string, days = 4) =>
  ({ object_id: `rate_${token}`, provider, servicelevel: { token, name }, amount, currency: 'USD', estimated_days: days })

let calls: Array<{ url: string; body: any; method?: string }> = []
let reply: (url: string, body: any) => { status: number; json: any } = () => ({ status: 200, json: {} })
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  process.env.SHIPPO_API_TOKEN = 'shippo_test_fake'
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), body })
    calls[calls.length - 1].method = init?.method || 'GET'
    const r = reply(String(url), body)
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }) as any
})
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.SHIPPO_API_TOKEN
})

describe('quoteRates', () => {
  it('rates the parcel live, keeps USPS/UPS only and adds ITP’s 5% cut', async () => {
    reply = () => ({
      status: 201,
      json: { rates: [
        rate('USPS', 'usps_ground_advantage', 'Ground Advantage', '5.58'),
        rate('USPS', 'usps_priority', 'Priority Mail', '9.10', 2),
        rate('FedEx', 'fedex_ground', 'Ground', '4.00'),
      ] }
    })
    const q = await quoteRates({ addressFrom: from, addressTo: to, weightLb: 1.5 })
    expect(q.source).toBe('shippo')
    expect(q.rates.map(r => [r.service, r.chargeCents])).toEqual([['usps_ground_advantage', 586], ['usps_priority', 956]])
    expect(calls[0].url).toBe('https://api.goshippo.com/shipments/')
    expect(calls[0].body.address_from.zip).toBe('30153')
    expect(calls[0].body.parcels[0].weight).toBe('1.50')
  })

  it('falls back to the weight-aware estimates when Shippo fails, has nothing, is not set up, or has no address', async () => {
    reply = () => ({ status: 500, json: {} })
    expect((await quoteRates({ addressFrom: from, addressTo: to, weightLb: 1 })).source).toBe('estimate')
    reply = () => ({ status: 201, json: { rates: [rate('FedEx', 'fedex_ground', 'Ground', '4.00')] } })
    expect((await quoteRates({ addressFrom: from, addressTo: to, weightLb: 1 })).source).toBe('estimate')
    expect((await quoteRates({ addressFrom: from, addressTo: null, weightLb: 1 })).source).toBe('estimate')
    delete process.env.SHIPPO_API_TOKEN
    const q = await quoteRates({ addressFrom: from, addressTo: to, weightLb: 1 })
    expect(q.source).toBe('estimate')
    expect(q.rates).toEqual(estimateCarrierRates(1))
    expect(calls).toHaveLength(2)
  })
})

describe('the cut and the label', () => {
  it('the label is the charge without the cut, to the cent', () => {
    for (const base of [3.99, 5.58, 7.43, 9.1, 12.67, 33.33]) {
      const charge = Math.round(withMarkup(base) * 100)
      expect(labelCentsOf(charge)).toBe(Math.round(base * 100))
    }
  })

  it('estimates carry Shippo’s service tokens so they line up with live rates', () => {
    expect(estimateCarrierRates(0.5).map(r => r.service)).toEqual(['usps_ground_advantage', 'usps_priority', 'ups_ground', 'ups_second_day_air', 'ups_next_day_air_saver'])
  })
})

describe('buyLabel', () => {
  it('buys the rate as a PDF and hands back the transaction', async () => {
    reply = () => ({ status: 201, json: { object_id: 'tx_1', status: 'SUCCESS', label_url: 'https://deliver.goshippo.com/tx_1.pdf', tracking_number: '9400' } })
    const r = await buyLabel('rate_x', 'ITP-1 crystal')
    expect(r.ok && r.transaction.tracking_number).toBe('9400')
    expect(calls[0].url).toBe('https://api.goshippo.com/transactions/')
    expect(calls[0].body).toEqual({ rate: 'rate_x', label_file_type: 'PDF', async: false, metadata: 'ITP-1 crystal' })
  })

  it('says what Shippo said when the purchase fails', async () => {
    reply = () => ({ status: 201, json: { status: 'ERROR', messages: [{ text: 'Address not found' }] } })
    expect(await buyLabel('rate_x')).toEqual({ ok: false, status: 201, error: 'Address not found' })
  })
})

// A refunded order hands its unused labels back (services/order-refunds.ts). Shapes from ITP's live account 2026-10-26:
// GET /transactions/<id> carries tracking_status; POST /refunds/ answers { object_id, status, transaction }.
describe('labelTrackingStatus', () => {
  it('reads the transaction’s tracking status with a GET (free)', async () => {
    reply = () => ({ status: 200, json: { object_id: 'tx_1', status: 'SUCCESS', tracking_status: 'pre_transit' } })
    expect(await labelTrackingStatus('tx_1')).toBe('PRE_TRANSIT')
    expect(calls[0]).toMatchObject({ url: 'https://api.goshippo.com/transactions/tx_1', method: 'GET', body: null })
  })

  it('is null when Shippo can’t say', async () => {
    reply = () => ({ status: 404, json: { detail: 'Not found.' } })
    expect(await labelTrackingStatus('tx_gone')).toBeNull()
    reply = () => ({ status: 200, json: { object_id: 'tx_1' } })
    expect(await labelTrackingStatus('tx_1')).toBeNull()
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as any
    expect(await labelTrackingStatus('tx_1')).toBeNull()
  })
})

describe('refundLabel', () => {
  it('asks Shippo to refund the one label and hands back its answer', async () => {
    reply = () => ({ status: 201, json: { object_id: 'rf_1', status: 'QUEUED', transaction: 'tx_1', test: false } })
    expect(await refundLabel('tx_1')).toEqual({ ok: true, refund: { id: 'rf_1', status: 'QUEUED' } })
    expect(calls[0]).toMatchObject({ url: 'https://api.goshippo.com/refunds/', method: 'POST', body: { transaction: 'tx_1', async: false } })
  })

  it('says what Shippo said when it won’t take the request, and survives a network failure', async () => {
    reply = () => ({ status: 400, json: { transaction: ['Transaction has already been refunded.'] } })
    expect(await refundLabel('tx_1')).toEqual({ ok: false, status: 400, error: 'Transaction has already been refunded.' })
    reply = () => ({ status: 500, json: {} })
    expect(await refundLabel('tx_1')).toEqual({ ok: false, status: 500, error: 'Shippo could not refund the label (500)' })
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as any
    expect(await refundLabel('tx_1')).toEqual({ ok: false, status: 0, error: 'Shippo refund request failed: offline' })
  })
})
