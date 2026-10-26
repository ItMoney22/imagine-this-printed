import { describe, it, expect } from 'vitest'
import { combineOptions, isShippoLabelUrl, packageWeights, readUsAddress } from './vendor-store-shipping.js'
import { signStoreShippingQuote, verifyStoreShippingQuote } from './shipping-quote.js'
import type { QuotedRate } from './shippo.js'

// Crystal's store ships as two packages: hers from her address, ITP's from Rockmart. The buyer picks one service for
// both, and one signed token carries both charges to the checkout.

const q = (provider: string, service: string, name: string, chargeCents: number, estimatedDays = 4): QuotedRate =>
  ({ id: `r_${service}_${chargeCents}`, provider, service, name, chargeCents, currency: 'USD', estimatedDays })

describe('combineOptions', () => {
  it('offers each service both packages can ship by, priced together, cheapest first', () => {
    const own = { source: 'shippo' as const, weightLb: 0.5, rates: [q('USPS', 'usps_priority', 'Priority Mail', 980, 2), q('USPS', 'usps_ground_advantage', 'Ground Advantage', 780, 5), q('UPS', 'ups_ground', 'Ground', 1300)] }
    const itp = { source: 'shippo' as const, weightLb: 0.5, rates: [q('USPS', 'usps_ground_advantage', 'Ground Advantage', 586, 3), q('USPS', 'usps_priority', 'Priority Mail', 900, 2)] }
    const options = combineOptions({ slug: 'crystal', zip: '30303', own, itp })
    expect(options.map(o => [o.id, o.name, o.amountCents, o.days, o.packages])).toEqual([
      ['usps_ground_advantage', 'USPS Ground Advantage', 780 + 586, 5, 2],
      ['usps_priority', 'USPS Priority Mail', 980 + 900, 2, 2],
    ])
    const v = verifyStoreShippingQuote({ token: options[0].token, slug: 'crystal', destinationZip: '30303', ownWeightLb: 0.5, itpWeightLb: 0.5 })
    expect(v.ok && [v.claims.own?.chargeCents, v.claims.itp?.chargeCents, v.claims.own?.service]).toEqual([780, 586, 'usps_ground_advantage'])
  })

  it('a one-package cart offers every service of that package', () => {
    const own = { source: 'shippo' as const, weightLb: 1, rates: [q('USPS', 'usps_ground_advantage', 'Ground Advantage', 780), q('UPS', 'ups_ground', 'Ground', 1300)] }
    const options = combineOptions({ slug: 'crystal', zip: '30303', own, itp: null })
    expect(options.map(o => [o.name, o.amountCents, o.packages])).toEqual([['USPS Ground Advantage', 780, 1], ['UPS Ground', 1300, 1]])
  })

  it('packages with no service in common still ship: one Standard choice at each one’s cheapest rate', () => {
    const own = { source: 'shippo' as const, weightLb: 1, rates: [q('USPS', 'usps_ground_advantage', 'Ground Advantage', 780)] }
    const itp = { source: 'shippo' as const, weightLb: 1, rates: [q('UPS', 'ups_ground', 'Ground', 1100)] }
    expect(combineOptions({ slug: 'crystal', zip: '30303', own, itp }).map(o => [o.id, o.amountCents])).toEqual([['standard', 1880]])
  })
})

describe('the signed store quote', () => {
  const pkg = (chargeCents: number, weightLb = 0.5) => ({ chargeCents, carrier: 'USPS', service: 'usps_ground_advantage', name: 'USPS Ground Advantage', weightLb, source: 'shippo' as const })
  const token = signStoreShippingQuote({ slug: 'crystal', destinationZip: '30303', own: pkg(780), itp: pkg(586) })
  const check = (over: Partial<Parameters<typeof verifyStoreShippingQuote>[0]> = {}) =>
    verifyStoreShippingQuote({ token, slug: 'crystal', destinationZip: '30303', ownWeightLb: 0.5, itpWeightLb: 0.5, ...over })

  it('holds for the same store, address and cart', () => expect(check().ok).toBe(true))

  it('refuses an edited amount, another store, a new ZIP, a changed cart, a missing package, and an old quote', () => {
    const [payload, sig] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    claims.own.chargeCents = 1
    const edited = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`
    expect(check({ token: edited }).ok).toBe(false)
    expect(check({ slug: 'darrell' }).ok).toBe(false)
    expect(check({ destinationZip: '10001' }).ok).toBe(false)
    expect(check({ ownWeightLb: 1 }).ok).toBe(false)
    expect(check({ itpWeightLb: null }).ok).toBe(false)
    expect(check({ token: undefined }).ok).toBe(false)
    const old = signStoreShippingQuote({ slug: 'crystal', destinationZip: '30303', own: pkg(780), itp: pkg(586) }, -1)
    expect(check({ token: old }).ok).toBe(false)
  })
})

describe('addresses and packages', () => {
  it('tidies an address and names what is missing', () => {
    const ok = readUsAddress({ name: ' Pat  Buyer ', street1: '1 Main St', city: 'Atlanta', state: 'ga', zip: '30303' })
    expect('address' in ok && ok.address).toMatchObject({ name: 'Pat Buyer', state: 'GA', zip: '30303' })
    expect(readUsAddress({ name: 'Pat', street1: '1 Main', city: 'Atlanta', state: 'Georgia', zip: '30303' })).toEqual({ error: 'Add the state as two letters, like GA' })
    expect(readUsAddress({ name: 'Pat', street1: '1 Main', city: 'Atlanta', state: 'GA', zip: '303' })).toEqual({ error: 'Add a 5-digit ZIP code' })
    expect(readUsAddress({ name: 'Crystal', street1: '1 Main', city: 'Atlanta', state: 'GA', zip: '30303' }, { phoneRequired: true }))
      .toEqual({ error: 'Add a phone number the carrier can call' })
  })

  it('weighs her items and ITP’s as two boxes, half a pound a unit', () => {
    expect(packageWeights([{ kind: 'own', quantity: 2 }, { kind: 'itp', quantity: 1 }, { kind: 'own', quantity: 1 }])).toEqual({ own: 1.5, itp: 0.5 })
    expect(packageWeights([{ kind: 'itp', quantity: 3 }])).toEqual({ own: null, itp: 1.5 })
  })

  it('only ever fetches a label from Shippo’s own file hosts', () => {
    expect(isShippoLabelUrl('https://deliver.goshippo.com/abc.pdf?Expires=1')).toBe(true)
    expect(isShippoLabelUrl('https://shippo-delivery-east.s3.amazonaws.com/abc.pdf')).toBe(true)
    expect(isShippoLabelUrl('http://deliver.goshippo.com/abc.pdf')).toBe(false)
    expect(isShippoLabelUrl('https://evil.example.com/shippo.pdf')).toBe(false)
    expect(isShippoLabelUrl('https://169.254.169.254/latest')).toBe(false)
  })
})
