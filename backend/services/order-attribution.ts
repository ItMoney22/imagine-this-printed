// ---------------------------------------------------------------------------
// Landing-UTM attribution, captured client-side (src/utils/utm.ts) and
// forwarded to checkout so a paid order can be traced back to the social
// post that drove it. utm_campaign on an outbox-sourced visit is the
// social_outbox row id (backend/services/social-utm.ts) — orders.attribution
// is the other half of that join.
//
// Pure and I/O-free on purpose, same shape as social-utm.ts: the request
// body is untrusted input (any client can POST anything), so every field is
// allowlisted, coerced to string, and length-capped before it ever reaches a
// JSONB column.
// ---------------------------------------------------------------------------

const STRING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer'] as const

export interface OrderAttribution {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer?: string
  landed_at?: string
}

/**
 * Validate + allowlist a client-supplied attribution object. Returns null
 * when there is nothing usable (absent, wrong type, or every field empty) —
 * an order with no known campaign should store NULL, not `{}`.
 */
export function sanitizeAttribution(raw: unknown): OrderAttribution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const out: OrderAttribution = {}

  for (const key of STRING_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) out[key] = value.slice(0, 300)
  }

  if (typeof input.landed_at === 'string') {
    const parsed = new Date(input.landed_at)
    if (!Number.isNaN(parsed.getTime())) out.landed_at = parsed.toISOString()
  }

  return Object.keys(out).length > 0 ? out : null
}

/**
 * Written when a checkout carries no usable attribution (typed URL, bookmark,
 * stripped referrer). Same shape as a tagged visit so reports can group on
 * utm_source without a NULL special case; GA4 uses the same (direct)/(none).
 */
export const DIRECT_ATTRIBUTION: OrderAttribution = { utm_source: '(direct)', utm_medium: '(none)' }

/** Sanitized attribution, or the direct fallback — never null. */
export function attributionOrDirect(raw: unknown): OrderAttribution {
  return sanitizeAttribution(raw) ?? { ...DIRECT_ATTRIBUTION }
}
