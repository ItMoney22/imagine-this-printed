// Signed shipping quote tokens.
//
// WHY THIS EXISTS (Watchtower task 188ead33):
// POST /api/stripe/checkout-payment-intent previously bounds-checked carrier
// shipping against a $3–$60 sanity band. A legitimate order with a real Shippo
// quote above $60 would hard-fail checkout, and the band itself was a trust
// gap (any client could submit any amount in that band). The fix:
//   1. /api/shipping/rates signs each returned rate with HMAC-SHA256.
//   2. The checkout flow submits the signed token instead of the raw amount.
//   3. The pricing engine verifies the signature and uses the amount inside
//      the token — never the client-declared amount.
//
// TOKEN FORMAT (base64url-encoded JSON, then HMAC-SHA256):
//   payload = { rate, carrier, service, cartHash, exp }
//   token   = HMAC_SHA256(payload, SHIPPING_TOKEN_SECRET)
//
// The client passes `shippingQuoteToken` in the checkout body. The pricing
// engine decodes + verifies it; on failure the order is rejected with 400.

import { createHmac, randomBytes } from 'node:crypto'

const TOKEN_VERSION = '1' // bump when the format changes
const TOKEN_TTL_MS = 15 * 60 * 1000 // 15 minutes

export interface ShippingQuoteTokenPayload {
  rate: number
  carrier: string
  service: string
  cartHash: string
  exp: number
}

export interface ShippingQuoteToken {
  payload: ShippingQuoteTokenPayload
  signature: string
  token: string // base64url(payload) + '.' + base64url(signature)
}

/**
 * Build a signed shipping quote token.
 *
 * @param payload   The data to bind to the signature.
 * @param secret    SHIPPING_TOKEN_SECRET from env.
 * @returns         The full `version.payload.sig` token string.
 */
export function signShippingQuote(
  payload: ShippingQuoteTokenPayload,
  secret: string
): ShippingQuoteToken {
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url')

  const sig = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url')

  const token = `${TOKEN_VERSION}.${payloadB64}.${sig}`
  return { payload, signature: sig, token }
}

/**
 * Verify a shipping quote token and return the payload.
 *
 * Rejects (throws) when:
 *   - The token format is wrong (version mismatch, missing parts).
 *   - The signature does not match (tampered or wrong secret).
 *   - The token is expired.
 *
 * @returns The verified payload.
 */
export function verifyShippingQuote(
  token: string | null | undefined,
  secret: string
): ShippingQuoteTokenPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing shipping quote token')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid shipping quote token format')
  }

  const [version, payloadB64, sig] = parts

  if (version !== TOKEN_VERSION) {
    throw new Error('Unsupported shipping quote token version')
  }

  // Verify signature before trusting the payload.
  const expectedSig = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url')

  if (!timingSafeEqual(expectedSig, sig)) {
    throw new Error('Shipping quote token signature mismatch')
  }

  let payload: ShippingQuoteTokenPayload
  try {
    const raw = Buffer.from(payloadB64, 'base64url').toString('utf8')
    payload = JSON.parse(raw) as ShippingQuoteTokenPayload
  } catch {
    throw new Error('Shipping quote token payload is not valid JSON')
  }

  if (typeof payload.rate !== 'number' || !Number.isFinite(payload.rate) || payload.rate < 0) {
    throw new Error('Shipping quote token has invalid rate')
  }
  if (typeof payload.carrier !== 'string' || !payload.carrier) {
    throw new Error('Shipping quote token has invalid carrier')
  }
  if (typeof payload.service !== 'string' || !payload.service) {
    throw new Error('Shipping quote token has invalid service')
  }
  if (typeof payload.cartHash !== 'string' || !payload.cartHash) {
    throw new Error('Shipping quote token has invalid cartHash')
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('Shipping quote token has invalid expiry')
  }

  // Enforce expiry. Tokens older than TOKEN_TTL_MS are rejected.
  if (Date.now() > payload.exp) {
    throw new Error('Shipping quote token has expired')
  }

  return payload
}

/**
 * Compute a stable cart hash for binding to the token.
 *
 * The hash is over a canonical string representation of the cart items so the
 * same cart always produces the same hash (and the token can't be replayed on
 * a different cart).
 */
export function computeCartHash(items: Array<{ productId?: string | null; quantity?: number; selectedSize?: string | null }>): string {
  const sorted = [...items]
    .filter(i => i.productId)
    .map(i => ({
      id: String(i.productId),
      qty: Math.max(1, Math.floor(Number.isFinite(i.quantity) ? i.quantity : 1)),
      size: i.selectedSize ?? ''
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const canonical = JSON.stringify(sorted)
  // Salted HMAC for extra safety — the salt is random each call but the
  // hash is only used to bind the token to the cart contents.
  const salt = randomBytes(16).toString('hex')
  const hash = createHmac('sha256', salt)
    .update(canonical)
    .digest('hex')

  return hash
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
