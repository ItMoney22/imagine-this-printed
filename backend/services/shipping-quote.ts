// Signed shipping-quote tokens.
//
// WHY THIS EXISTS (Watchtower task 188ead33, GAP 2 — follow-up to 9a8431d9):
// order-pricing.ts used to bounds-check the client-declared carrier shipping
// cost against a fixed $3-$60 band (see git history on order-pricing.ts).
// That is tamper-resistant only up to the width of the band — a customer
// could always submit any number inside [3, 60] regardless of what the
// parcel actually costs to ship, and a legitimate quote above $60 (a large
// or heavy order) hard-failed checkout.
//
// POST /api/shipping/rates now signs every quoted rate (HMAC-SHA256) with
// the amount, carrier, service, the parcel weight that produced it, the
// destination zip, and a short expiry. Checkout submits that token back
// unchanged instead of a bare number. The pricing engine verifies the
// signature, the expiry, and that the CURRENT checkout's parcel
// weight/destination still match what was quoted — then uses the amount
// INSIDE the token. A client-supplied dollar figure is never trusted again.
//
// Binding to weight (not full cart contents) is deliberate: weight is the
// only cart-dependent input that actually drives the carrier rate, and it's
// the one value both POST /api/shipping/rates (issuer) and
// checkout-payment-intent (verifier) can compute identically from data they
// both already receive. A quote minted for a light parcel can't be replayed
// against a heavier cart — the weight check rejects it.

import crypto from 'crypto'

// Falls back through layers of already-required secrets rather than being
// silently optional — checkout-payment-intent has no legitimate path around
// this. SHIPPING_QUOTE_SECRET should be set explicitly in production (see
// backend/.env.example); the fallbacks keep dev/test environments (which
// already set SUPABASE_SERVICE_ROLE_KEY — see order-pricing.test.ts) working
// without yet another required env var.
const SECRET =
  process.env.SHIPPING_QUOTE_SECRET ||
  process.env.STRIPE_WEBHOOK_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'insecure-dev-only-shipping-quote-secret'

if (SECRET === 'insecure-dev-only-shipping-quote-secret' && process.env.NODE_ENV === 'production') {
  console.error('[shipping-quote] SHIPPING_QUOTE_SECRET is not set in production — shipping quotes are being signed with a public fallback secret. Set SHIPPING_QUOTE_SECRET.')
}

// Long enough to fill out the rest of checkout after selecting a shipping
// option; short enough that a leaked/replayed quote is worthless quickly.
const QUOTE_TTL_MS = 15 * 60 * 1000

export interface ShippingQuoteClaims {
  amountCents: number
  carrier: string
  service: string
  /** Parcel weight (lb) that produced this rate — rounded to 2dp. */
  weightLb: number
  destinationZip: string
  /** Expiry, ms epoch. */
  exp: number
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex')
}

/** Mints a signed quote token. `ttlMs` is exposed for tests (e.g. negative = already expired). */
export function signShippingQuote(claims: Omit<ShippingQuoteClaims, 'exp'>, ttlMs = QUOTE_TTL_MS): string {
  const full: ShippingQuoteClaims = { ...claims, exp: Date.now() + ttlMs }
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url')
  return `${payload}.${signPayload(payload)}`
}

export interface VerifyShippingQuoteInput {
  token: string | null | undefined
  destinationZip: string
  weightLb: number
  /** Rounding slack for the weight comparison — float noise, not a security boundary. */
  weightToleranceLb?: number
}

export interface VerifyShippingQuoteResult {
  ok: boolean
  amountCents?: number
  error?: string
}

export function verifyShippingQuote(input: VerifyShippingQuoteInput): VerifyShippingQuoteResult {
  const { token, destinationZip, weightLb, weightToleranceLb = 0.05 } = input

  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Missing shipping quote — reselect a shipping option and try again.' }
  }

  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0 || token.indexOf('.', dotIndex + 1) !== -1) {
    return { ok: false, error: 'Malformed shipping quote — reselect a shipping option and try again.' }
  }
  const payload = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)

  // Timing-safe compare — the signature is attacker-observable, so string
  // equality (early-exit on first mismatched byte) would leak match progress.
  const expectedSignature = signPayload(payload)
  const sigBuf = Buffer.from(signature, 'hex')
  const expectedBuf = Buffer.from(expectedSignature, 'hex')
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: 'Shipping quote signature invalid — the amount may have been tampered with.' }
  }

  let claims: ShippingQuoteClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'Malformed shipping quote — reselect a shipping option and try again.' }
  }

  if (typeof claims.amountCents !== 'number' || !Number.isFinite(claims.amountCents) || claims.amountCents < 0) {
    return { ok: false, error: 'Malformed shipping quote — reselect a shipping option and try again.' }
  }
  if (!claims.exp || Date.now() > claims.exp) {
    return { ok: false, error: 'Shipping quote expired — reselect a shipping option and try again.' }
  }
  if ((claims.destinationZip || '') !== (destinationZip || '')) {
    return { ok: false, error: 'Shipping quote does not match the shipping address — reselect a shipping option.' }
  }
  if (Math.abs((claims.weightLb ?? 0) - weightLb) > weightToleranceLb) {
    return { ok: false, error: 'Shipping quote does not match the current cart — reselect a shipping option.' }
  }

  return { ok: true, amountCents: Math.round(claims.amountCents) }
}

/**
 * Mirrors the parcel-weight formula in POST /api/shipping/rates
 * (backend/routes/shipping.ts) so the token issuer and verifier always agree
 * on what "the cart's weight" means. Default 0.5 lb/item matches the
 * pre-existing client behavior documented there.
 */
export function computeCartWeightLb(items: Array<{ weight?: number | null; quantity?: number | null }>): number {
  const total = (items || []).reduce(
    (sum, it) => sum + ((Number(it?.weight) || 0.5) * (Number(it?.quantity) || 1)),
    0
  )
  return Math.round(Math.max(0.1, total) * 100) / 100
}
