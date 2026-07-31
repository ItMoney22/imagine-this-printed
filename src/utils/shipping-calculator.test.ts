// Checkout shipping options. These decide what a customer is charged to
// receive their order and whether they are promised next-business-day, so the
// assertions are concrete dollar amounts and concrete clock times rather than
// shape checks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ShippingCalculator,
  isRushAvailable,
  getRushUnavailableReason,
  LOCAL_DELIVERY_TIERS,
  MAX_DELIVERY_RADIUS_MILES,
  RUSH_FEE,
  RUSH_CUTOFF_HOUR,
  STANDARD_FULFILLMENT_DAYS,
  WAREHOUSE_ADDRESS
} from './shipping-calculator'
import type { ShippingAddress } from '../types'

const gaLocal: ShippingAddress = {
  name: 'Local Buyer', address1: '1 Main St', city: 'Rockmart',
  state: 'GA', zip: '30153', country: 'US'
}
const farAway: ShippingAddress = {
  name: 'Remote Buyer', address1: '500 Market St', city: 'San Francisco',
  state: 'CA', zip: '94105', country: 'US'
}

/**
 * Route both backend calls the calculator makes. `distance` of null makes the
 * endpoint fail so the ZIP-code fallback runs; `carriers` of null makes the
 * rate endpoint fail so the client-side estimate runs.
 */
function stubBackend(opts: { distance?: unknown; carriers?: unknown } = {}) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (String(url).includes('calculate-distance')) {
      if (opts.distance === undefined) return { ok: false, status: 500 } as unknown as Response
      return { ok: true, json: async () => opts.distance } as unknown as Response
    }
    if (String(url).includes('/api/shipping/rates')) {
      if (opts.carriers === undefined) return { ok: false, status: 502 } as unknown as Response
      return { ok: true, json: async () => opts.carriers } as unknown as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('published constants — ShippingPolicy.tsx mirrors these by hand', () => {
  it('holds the two local-delivery tiers at $10 / $15 and a 20 mile ceiling', () => {
    expect(LOCAL_DELIVERY_TIERS).toEqual([
      { maxMiles: 10, fee: 10.0, label: 'Local Delivery (within 10 miles)' },
      { maxMiles: 20, fee: 15.0, label: 'Local Delivery (10-20 miles)' }
    ])
    expect(MAX_DELIVERY_RADIUS_MILES).toBe(20)
    // The furthest tier must not promise delivery past the stated radius.
    expect(LOCAL_DELIVERY_TIERS[LOCAL_DELIVERY_TIERS.length - 1].maxMiles)
      .toBe(MAX_DELIVERY_RADIUS_MILES)
  })

  it('keeps rush at $7.99 with a 2 PM cutoff and a 3 business day standard', () => {
    expect(RUSH_FEE).toBe(7.99)
    expect(RUSH_CUTOFF_HOUR).toBe(14)
    expect(STANDARD_FULFILLMENT_DAYS).toBe(3)
  })

  it('points pickup at the Rockmart warehouse', () => {
    expect(WAREHOUSE_ADDRESS.zip).toBe('30153')
    expect(WAREHOUSE_ADDRESS.state).toBe('GA')
  })
})

describe('isRushAvailable — 2 PM cutoff in WAREHOUSE time, not the browser time', () => {
  it('offers rush before 2 PM Eastern', () => {
    vi.useFakeTimers()
    // 13:00 UTC on a July date = 09:00 EDT.
    vi.setSystemTime(new Date('2026-07-28T13:00:00Z'))
    expect(isRushAvailable()).toBe(true)
  })

  it('withdraws rush after 2 PM Eastern', () => {
    vi.useFakeTimers()
    // 20:00 UTC = 16:00 EDT — past the cutoff.
    vi.setSystemTime(new Date('2026-07-28T20:00:00Z'))
    expect(isRushAvailable()).toBe(false)
  })

  it('is decided in Eastern time, so a UTC hour under 14 is not enough on its own', () => {
    vi.useFakeTimers()
    // 18:00 UTC is "before 2 PM" only if you read the wrong clock: it is
    // 14:00 EDT, exactly the cutoff, so rush must be OFF.
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    expect(isRushAvailable()).toBe(false)
  })

  it('explains the cutoff to the customer', () => {
    expect(getRushUnavailableReason()).toContain('2 PM ET')
  })
})

describe('free shipping progress bar', () => {
  it('counts down to the $50 threshold', () => {
    const c = new ShippingCalculator()
    expect(c.calculateFreeShippingProgress(0)).toEqual({ amountNeeded: 50, percentage: 0, qualified: false })
    expect(c.calculateFreeShippingProgress(30)).toEqual({ amountNeeded: 20, percentage: 60, qualified: false })
  })

  it('qualifies AT the threshold, not a cent above it', () => {
    const c = new ShippingCalculator()
    expect(c.calculateFreeShippingProgress(49.99).qualified).toBe(false)
    expect(c.calculateFreeShippingProgress(50).qualified).toBe(true)
  })

  it('never reports over 100% or a negative shortfall', () => {
    const c = new ShippingCalculator()
    expect(c.calculateFreeShippingProgress(500)).toEqual({ amountNeeded: 0, percentage: 100, qualified: true })
  })

  it('honours a runtime threshold change', () => {
    const c = new ShippingCalculator()
    c.updateFreeShippingThreshold(75)
    expect(c.calculateFreeShippingProgress(50).qualified).toBe(false)
    expect(c.calculateFreeShippingProgress(50).amountNeeded).toBe(25)
  })
})

describe('calculateShipping — local pickup + delivery eligibility', () => {
  it('always offers free local pickup and preselects it as the cheapest option', async () => {
    stubBackend()
    const res = await new ShippingCalculator().calculateShipping([], farAway, 10)
    const pickup = res.rates.find(r => r.id === 'local-pickup')!
    expect(pickup.amount).toBe(0)
    expect(pickup.rushEligible).toBe(true)
    expect(pickup.estimatedDays).toBe(STANDARD_FULFILLMENT_DAYS)
    expect(res.selectedRate?.id).toBe('local-pickup')
  })

  it('enables local delivery for a Rockmart-area GA ZIP via the fallback check', async () => {
    stubBackend() // distance endpoint 500s -> fallbackZipCheck
    const res = await new ShippingCalculator().calculateShipping([], gaLocal, 10)
    const delivery = res.rates.find(r => r.id === 'local-delivery')!
    expect(delivery.disabled).toBeFalsy()
    expect(delivery.amount).toBe(10)
    expect(delivery.rushEligible).toBe(true)
  })

  it('disables local delivery for an out-of-state address and says why', async () => {
    stubBackend()
    const res = await new ShippingCalculator().calculateShipping([], farAway, 10)
    const delivery = res.rates.find(r => r.id === 'local-delivery')!
    expect(delivery.disabled).toBe(true)
    expect(delivery.disabledReason).toContain('20 miles')
    expect(delivery.rushEligible).toBeFalsy()
  })

  it('disables local delivery for a GA ZIP outside the served list', async () => {
    stubBackend()
    const savannah: ShippingAddress = { ...gaLocal, city: 'Savannah', zip: '31401' }
    const res = await new ShippingCalculator().calculateShipping([], savannah, 10)
    expect(res.rates.find(r => r.id === 'local-delivery')!.disabled).toBe(true)
  })

  it('uses the live distance tier when the distance API answers', async () => {
    stubBackend({
      distance: { eligible: true, distanceMiles: 16.4, deliveryFee: 15, tierLabel: 'Local Delivery (10-20 miles)' }
    })
    const res = await new ShippingCalculator().calculateShipping([], gaLocal, 10)
    const delivery = res.rates.find(r => r.id === 'local-delivery')!
    expect(delivery.amount).toBe(15)
    expect(delivery.name).toBe('Local Delivery (10-20 miles)')
    expect(delivery.description).toContain('16.4 miles')
  })

  it('sinks disabled options below every usable one', async () => {
    stubBackend()
    const res = await new ShippingCalculator().calculateShipping([], farAway, 10)
    const lastEnabled = res.rates.map(r => !!r.disabled).lastIndexOf(false)
    const firstDisabled = res.rates.map(r => !!r.disabled).indexOf(true)
    expect(firstDisabled).toBeGreaterThan(lastEnabled)
  })
})

describe('calculateShipping — carrier rates', () => {
  it('uses live backend rates when they come back', async () => {
    stubBackend({
      carriers: { rates: [{ id: 'usps-ground', name: 'USPS Ground Advantage', provider: 'USPS', amount: 8.41, estimatedDays: 4 }] }
    })
    const res = await new ShippingCalculator().calculateShipping([], farAway, 10)
    const usps = res.rates.find(r => r.id === 'usps-ground')!
    expect(usps.amount).toBe(8.41)
    expect(usps.currency).toBe('USD') // defaulted
    expect(res.rates.filter(r => r.type === 'shipping')).toHaveLength(1)
  })

  it('falls back to USPS+UPS estimates with the 5% markup baked in, never FedEx mocks', async () => {
    stubBackend() // rates endpoint 502s
    const res = await new ShippingCalculator().calculateShipping([], farAway, 10)
    const byId = Object.fromEntries(res.rates.map(r => [r.id, r]))
    expect(byId['usps-ground'].amount).toBe(7.34)  // 6.99 * 1.05
    expect(byId['usps-priority'].amount).toBe(10.49) // 9.99 * 1.05
    expect(byId['ups-ground'].amount).toBe(12.59)
    expect(byId['ups-2day'].amount).toBe(20.99)
    expect(byId['ups-saver'].amount).toBe(36.74)
    expect(res.rates.some(r => /fedex/i.test(r.provider))).toBe(false)
  })

  it('falls back when the backend returns an empty rate list', async () => {
    stubBackend({ carriers: { rates: [] } })
    const res = await new ShippingCalculator().calculateShipping([], farAway, 10)
    expect(res.rates.find(r => r.id === 'usps-ground')!.amount).toBe(7.34)
  })

  it('sends one line per cart item with a 0.5lb default weight', async () => {
    const fetchMock = stubBackend({ carriers: { rates: [] } })
    await new ShippingCalculator().calculateShipping(
      [{ product: { weight: 2 }, quantity: 3 }, { product: {} }],
      farAway,
      10
    )
    const rateCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/shipping/rates'))!
    const body = JSON.parse(rateCall[1]!.body as string)
    expect(body.items).toEqual([{ weight: 2, quantity: 3 }, { weight: 0.5, quantity: 1 }])
    expect(body.addressTo.zip).toBe('94105')
  })
})

describe('calculateShipping — the $50 free shipping incentive', () => {
  it('zeroes the CHEAPEST carrier rate instead of hiding the paid upgrades', async () => {
    stubBackend()
    const res = await new ShippingCalculator().calculateShipping([], farAway, 60)
    expect(res.isFreeShipping).toBe(true)
    expect(res.freeShippingThreshold).toBe(50)

    const free = res.rates.find(r => r.name === 'Free Standard Shipping')!
    expect(free.id).toBe('usps-ground') // was the cheapest at 7.34
    expect(free.amount).toBe(0)
    expect(free.estimatedDays).toBeGreaterThanOrEqual(5)

    // The faster paid options survive so the customer can still upgrade.
    expect(res.rates.find(r => r.id === 'ups-saver')!.amount).toBe(36.74)
    expect(res.rates.filter(r => r.type === 'shipping')).toHaveLength(5)
  })

  it('leaves every carrier rate payable below the threshold', async () => {
    stubBackend()
    const res = await new ShippingCalculator().calculateShipping([], farAway, 49.99)
    expect(res.isFreeShipping).toBe(false)
    expect(res.rates.some(r => r.name === 'Free Standard Shipping')).toBe(false)
    expect(res.rates.find(r => r.id === 'usps-ground')!.amount).toBe(7.34)
  })

  it('never discounts a DISABLED option into the free slot', async () => {
    stubBackend()
    const res = await new ShippingCalculator().calculateShipping([], farAway, 60)
    const disabled = res.rates.filter(r => r.disabled)
    expect(disabled.every(r => r.name !== 'Free Standard Shipping')).toBe(true)
  })
})
