import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'

/**
 * Regression tests for the webhook signature-verification bug: the removed
 * routes/webhooks.ts POST /stripe verified against JSON.stringify(req.body)
 * (an already-parsed-then-reserialized object), which does not reproduce the
 * exact raw bytes Stripe signed. routes/stripe.ts POST /webhook (the
 * surviving, consolidated endpoint) verifies against the raw Buffer body
 * instead, because index.ts mounts express.raw() on /api/stripe/webhook
 * before express.json() runs.
 *
 * These tests exercise the real `stripe` package's webhooks.constructEvent —
 * the exact function both routes called — with a throwaway test secret. No
 * network calls, no env vars, no app/route import required.
 */

const TEST_SECRET = 'whsec_test_secret_not_real'
const stripe = new Stripe('sk_test_dummy_not_real', { apiVersion: '2025-02-24.acacia' })

// A JSON payload whose re-serialization differs from the original bytes:
// note the extra spacing and key order, which JSON.stringify(JSON.parse(x))
// will normalize away.
const rawBody = '{ "id":  "evt_test123", "object": "event", "type": "payment_intent.succeeded" }'

describe('Stripe webhook signature verification', () => {
  it('accepts a correctly-signed RAW body', () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: TEST_SECRET
    })

    const event = stripe.webhooks.constructEvent(rawBody, header, TEST_SECRET)
    expect(event.type).toBe('payment_intent.succeeded')
  })

  it('rejects a bad/forged signature', () => {
    expect(() =>
      stripe.webhooks.constructEvent(rawBody, 't=1,v1=deadbeef', TEST_SECRET)
    ).toThrow()
  })

  it('rejects a body that has been JSON.parse()d and re-stringified before verification — the exact bug in the removed routes/webhooks.ts:240', () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: TEST_SECRET
    })

    // Signature was generated over `rawBody`'s exact bytes. Re-serializing
    // the parsed object (as the removed route did) changes whitespace/key
    // order, so verifying against the reserialized string must fail even
    // though it represents "the same" JSON data and even with the correct
    // secret.
    const reserialized = JSON.stringify(JSON.parse(rawBody))
    expect(reserialized).not.toBe(rawBody)

    expect(() =>
      stripe.webhooks.constructEvent(reserialized, header, TEST_SECRET)
    ).toThrow()
  })

  it('rejects the correctly-signed body when checked against the wrong secret', () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: TEST_SECRET
    })

    expect(() =>
      stripe.webhooks.constructEvent(rawBody, header, 'whsec_wrong_secret')
    ).toThrow()
  })
})
