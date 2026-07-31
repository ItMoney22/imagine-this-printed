import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load, so
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must exist BEFORE webhooks.ts (which
// imports it) is evaluated. None of these tests touch a real database —
// verifySupabaseWebhookSecret is pure — so dummy values are fine. A dynamic
// import after setting the env vars (rather than a static import, which ESM
// hoists ahead of any code in this file) is what makes the ordering work —
// same pattern as backend/services/merch-webhook.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { verifySupabaseWebhookSecret } = await import('./webhooks.js')

/**
 * Regression tests for the Supabase auth webhook hardening: POST
 * /api/webhooks/supabase-auth used to wrap its secret check in
 * `if (webhookSecret) { ... }`, so an unset/mistyped SUPABASE_WEBHOOK_SECRET
 * in the deploy environment silently skipped verification entirely and
 * accepted any request — an open relay for sendWelcomeEmail(). It must now
 * fail closed (503) instead.
 */
describe('verifySupabaseWebhookSecret', () => {
  it('fails closed (503) when the secret is not configured, even if a header is sent', () => {
    const result = verifySupabaseWebhookSecret(undefined, 'anything-an-attacker-sends')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.status).toBe(503)
  })

  it('fails closed (503) when the secret is configured as an empty string', () => {
    const result = verifySupabaseWebhookSecret('', 'anything')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.status).toBe(503)
  })

  it('rejects (401) a missing header when the secret IS configured', () => {
    const result = verifySupabaseWebhookSecret('real-secret', undefined)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.status).toBe(401)
  })

  it('rejects (401) a wrong secret of the same length (would throw on raw timingSafeEqual only if lengths differ)', () => {
    const result = verifySupabaseWebhookSecret('real-secret', 'wrong-secre1')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.status).toBe(401)
  })

  it('rejects (401) a wrong secret of a different length without throwing', () => {
    // crypto.timingSafeEqual throws on mismatched buffer lengths — this must
    // not bubble up as an unhandled exception, just a normal 401.
    expect(() => verifySupabaseWebhookSecret('real-secret', 'short')).not.toThrow()
    const result = verifySupabaseWebhookSecret('real-secret', 'short')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.status).toBe(401)
  })

  it('rejects (401) when the header arrives as a string array (duplicate header)', () => {
    const result = verifySupabaseWebhookSecret('real-secret', ['real-secret', 'real-secret'])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.status).toBe(401)
  })

  it('accepts the exact matching secret', () => {
    const result = verifySupabaseWebhookSecret('real-secret', 'real-secret')
    expect(result.ok).toBe(true)
  })
})
