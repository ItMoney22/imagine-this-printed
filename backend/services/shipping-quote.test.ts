// Tests for the signed shipping-quote tokens that close Watchtower task
// 188ead33 GAP 2 (client-tamperable carrier shipping cost).

import { describe, it, expect } from 'vitest'
import { signShippingQuote, verifyShippingQuote, computeCartWeightLb } from './shipping-quote.js'

const ZIP = '30153'
const WEIGHT = 2.5

describe('signShippingQuote / verifyShippingQuote', () => {
  it('round-trips a legitimate quote', () => {
    const token = signShippingQuote({ amountCents: 1299, carrier: 'USPS', service: 'Ground Advantage', weightLb: WEIGHT, destinationZip: ZIP })
    const result = verifyShippingQuote({ token, destinationZip: ZIP, weightLb: WEIGHT })
    expect(result.ok).toBe(true)
    expect(result.amountCents).toBe(1299)
  })

  it('THE DELIVERABLE: rejects a token whose amount was tampered with after signing', () => {
    const token = signShippingQuote({ amountCents: 1299, carrier: 'USPS', service: 'Ground Advantage', weightLb: WEIGHT, destinationZip: ZIP })
    const [payload, signature] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))

    // Attacker edits the amount down to a penny and re-encodes the payload,
    // but can't produce a valid signature for it without the server secret —
    // so they keep the OLD signature, which no longer matches.
    const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, amountCents: 1 }), 'utf8').toString('base64url')
    const tamperedToken = `${tamperedPayload}.${signature}`

    const result = verifyShippingQuote({ token: tamperedToken, destinationZip: ZIP, weightLb: WEIGHT })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/signature invalid/i)
    expect(result.amountCents).toBeUndefined()
  })

  it('rejects a missing token', () => {
    const result = verifyShippingQuote({ token: null, destinationZip: ZIP, weightLb: WEIGHT })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/missing shipping quote/i)
  })

  it('rejects a malformed token', () => {
    expect(verifyShippingQuote({ token: 'not-a-real-token', destinationZip: ZIP, weightLb: WEIGHT }).ok).toBe(false)
    expect(verifyShippingQuote({ token: 'a.b.c', destinationZip: ZIP, weightLb: WEIGHT }).ok).toBe(false)
  })

  it('rejects an expired token', () => {
    const token = signShippingQuote({ amountCents: 500, carrier: 'USPS', service: 'Ground', weightLb: WEIGHT, destinationZip: ZIP }, -1)
    const result = verifyShippingQuote({ token, destinationZip: ZIP, weightLb: WEIGHT })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/expired/i)
  })

  it('rejects a quote reused against a different destination', () => {
    const token = signShippingQuote({ amountCents: 500, carrier: 'USPS', service: 'Ground', weightLb: WEIGHT, destinationZip: '90210' })
    const result = verifyShippingQuote({ token, destinationZip: ZIP, weightLb: WEIGHT })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not match the shipping address/i)
  })

  it('rejects a quote reused against a materially different cart weight (light-cart quote replayed on a heavy cart)', () => {
    const token = signShippingQuote({ amountCents: 500, carrier: 'USPS', service: 'Ground', weightLb: 0.5, destinationZip: ZIP })
    const result = verifyShippingQuote({ token, destinationZip: ZIP, weightLb: 20 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not match the current cart/i)
  })

  it('tolerates float-rounding noise in weight without rejecting', () => {
    const token = signShippingQuote({ amountCents: 500, carrier: 'USPS', service: 'Ground', weightLb: 2.5, destinationZip: ZIP })
    const result = verifyShippingQuote({ token, destinationZip: ZIP, weightLb: 2.53 })
    expect(result.ok).toBe(true)
  })

  it('does not cap the amount — a legitimate quote above the old $60 band is honored in full', () => {
    const token = signShippingQuote({ amountCents: 8500, carrier: 'UPS', service: 'Next Day Air Saver', weightLb: 40, destinationZip: ZIP })
    const result = verifyShippingQuote({ token, destinationZip: ZIP, weightLb: 40 })
    expect(result.ok).toBe(true)
    expect(result.amountCents).toBe(8500)
  })
})

describe('computeCartWeightLb', () => {
  it('defaults missing item weight to 0.5lb, matching the pre-existing client behavior', () => {
    expect(computeCartWeightLb([{ quantity: 2 }])).toBe(1) // 2 * 0.5
  })

  it('sums weight * quantity across items', () => {
    expect(computeCartWeightLb([{ weight: 1.2, quantity: 3 }, { weight: 0.3, quantity: 1 }])).toBe(3.9)
  })

  it('floors at 0.1lb minimum', () => {
    expect(computeCartWeightLb([])).toBe(0.1)
  })
})
