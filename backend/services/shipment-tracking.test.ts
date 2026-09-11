import { describe, it, expect } from 'vitest'
import { fetchLiveTracking, normalizeShippoTrack } from './shipment-tracking.js'

// A trimmed copy of a real Shippo /tracks response shape.
const shippoBody = (overrides: any = {}) => ({
  carrier: 'ups',
  tracking_number: '1ZB8F618YN62290045',
  eta: '2026-09-13T21:00:00Z',
  tracking_status: {
    status: 'TRANSIT',
    status_details: 'Your shipment is in transit.',
    status_date: '2026-09-11T08:14:00Z',
    location: { city: 'Atlanta', state: 'GA', zip: '30301', country: 'US' }
  },
  tracking_history: [
    {
      status: 'PRE_TRANSIT',
      status_details: 'Shipping label created',
      status_date: '2026-09-10T18:02:00Z',
      location: { city: 'Rockmart', state: 'GA', country: 'US' }
    },
    {
      status: 'TRANSIT',
      status_details: 'Your shipment is in transit.',
      status_date: '2026-09-11T08:14:00Z',
      location: { city: 'Atlanta', state: 'GA', country: 'US' }
    }
  ],
  ...overrides
})

const okFetch = (body: any) => async () =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as any

describe('normalizeShippoTrack', () => {
  it('maps Shippo status vocabulary onto our own', () => {
    const t = normalizeShippoTrack(shippoBody(), '1ZB8F618YN62290045', 'UPS')
    expect(t.status).toBe('in_transit')
    expect(t.statusDetail).toBe('Your shipment is in transit.')
    expect(t.location).toBe('Atlanta, GA')
    // Dates are normalized to real ISO strings so the DB and the UI agree.
    expect(t.eta).toBe('2026-09-13T21:00:00.000Z')
    expect(t.events).toHaveLength(2)
    // Newest scan first — the panel and the email both read events[0].
    expect(t.events[0].status).toBe('in_transit')
    expect(t.events[1].status).toBe('pre_transit')
  })

  it('treats the out-for-delivery substatus as its own step', () => {
    const body = shippoBody()
    body.tracking_status.substatus = { code: 'out_for_delivery', text: 'Out for delivery' }
    expect(normalizeShippoTrack(body, 'x', 'UPS').status).toBe('out_for_delivery')
  })

  it('reads DELIVERED, RETURNED and FAILURE', () => {
    for (const [shippo, ours] of [['DELIVERED', 'delivered'], ['RETURNED', 'returned'], ['FAILURE', 'failure']]) {
      const body = shippoBody()
      body.tracking_status.status = shippo
      expect(normalizeShippoTrack(body, 'x', 'UPS').status).toBe(ours)
    }
  })

  // Verified against a real Shippo response for order ITP-MTRQH7VJ-2UO1.
  it('does not invent a location from the country padding UPS sends pre-transit', () => {
    const t = normalizeShippoTrack(
      {
        servicelevel: { name: 'Surepost Lightweight', token: 'ups_surepost_lightweight' },
        eta: '2026-09-16T05:00:00Z',
        tracking_status: {
          status: 'PRE_TRANSIT',
          status_details: 'Shipper created a label, UPS has not received the package yet.',
          status_date: '2026-09-09T00:19:11Z',
          location: { city: '', state: '', zip: '', country: 'US' },
          substatus: { code: 'information_received', text: 'Information about the package received.' }
        },
        tracking_history: []
      },
      '1ZB8F618YN62290045',
      'UPS'
    )
    expect(t.status).toBe('pre_transit')
    expect(t.location).toBeNull()
    expect(t.service).toBe('Surepost Lightweight')
    expect(t.eta).toBe('2026-09-16T05:00:00.000Z')
  })

  it('survives a carrier that sends no history and no location', () => {
    const t = normalizeShippoTrack(
      { tracking_status: { status: 'UNKNOWN' } },
      '9400111899223197428490',
      'USPS'
    )
    expect(t.status).toBe('unknown')
    expect(t.events).toEqual([])
    expect(t.location).toBeNull()
    expect(t.eta).toBeNull()
    // The deep link is always usable even when there is no live scan at all.
    expect(t.trackingUrl).toContain('usps.com')
  })
})

describe('fetchLiveTracking', () => {
  it('asks Shippo for the right carrier token and returns normalized data', async () => {
    const calls: Array<{ url: string; headers: any }> = []
    const res = await fetchLiveTracking('1ZB8F618YN62290045', 'UPS Ground', {
      token: 'shippo_test_x',
      fetchFn: (async (url: string, init: any) => {
        calls.push({ url, headers: init?.headers })
        return { ok: true, status: 200, json: async () => shippoBody(), text: async () => '' } as any
      }) as any
    })

    expect(calls[0].url).toBe('https://api.goshippo.com/tracks/ups/1ZB8F618YN62290045')
    expect(calls[0].headers.Authorization).toBe('ShippoToken shippo_test_x')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.tracking.status).toBe('in_transit')
  })

  // DHL is `dhl_express` to Shippo, not `dhl` — getting this wrong 404s every poll.
  it('uses Shippo carrier tokens, not our internal keys', async () => {
    let url = ''
    await fetchLiveTracking('1234567890', 'DHL', {
      token: 't',
      fetchFn: (async (u: string) => { url = u; return { ok: true, status: 200, json: async () => shippoBody(), text: async () => '' } as any }) as any
    })
    expect(url).toContain('/tracks/dhl_express/')
  })

  it('reports a missing token rather than throwing, so callers stay on the deep link', async () => {
    const res = await fetchLiveTracking('1Z999', 'UPS', { token: '', fetchFn: okFetch(shippoBody()) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('no_token')
  })

  it('reports an unidentifiable carrier instead of guessing one', async () => {
    const res = await fetchLiveTracking('ABC-123-XYZ', 'Pigeon Post', { token: 't', fetchFn: okFetch(shippoBody()) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('unsupported_carrier')
  })

  it('turns a Shippo 404 into not_found, not an exception', async () => {
    const res = await fetchLiveTracking('1ZB8F618YN62290045', 'UPS', {
      token: 't',
      fetchFn: (async () => ({ ok: false, status: 404, text: async () => 'not found', json: async () => ({}) })) as any
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not_found')
  })

  it('turns a network failure into an error result, not an exception', async () => {
    const res = await fetchLiveTracking('1ZB8F618YN62290045', 'UPS', {
      token: 't',
      fetchFn: (async () => { throw new Error('socket hang up') }) as any
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('error')
      expect(res.message).toContain('socket hang up')
    }
  })
})
