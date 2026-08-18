import { describe, it, expect } from 'vitest'

// health.ts imports PrismaClient (eager `new PrismaClient()` at module load)
// and google-cloud-storage / order-monitor services. None of that is touched
// by verifyHealthProbeToken, which is pure, but the import still needs
// DATABASE_URL present so Prisma's client construction doesn't throw. Dummy
// value is fine — no test here executes a query. Same dynamic-import-after-
// env-setup pattern as webhooks-supabase-auth.test.ts.
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/db'
process.env.SUPABASE_URL ||= 'https://dummy-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-role-key'

const { verifyHealthProbeToken } = await import('./health.js')

/**
 * Regression tests for GET /api/health/email hardening (Watchtower task
 * 14b05534): the endpoint used to fire a real Resend send on every
 * unauthenticated hit — an open spam relay that also leaked a tail of the
 * Resend API key in the response body. A live test send now requires a
 * HEALTH_PROBE_TOKEN that matches exactly.
 */
describe('verifyHealthProbeToken', () => {
  it('rejects when no token is configured server-side, even if one is provided', () => {
    expect(verifyHealthProbeToken(undefined, 'anything-an-attacker-sends')).toBe(false)
  })

  it('rejects when configured as an empty string', () => {
    expect(verifyHealthProbeToken('', 'anything')).toBe(false)
  })

  it('rejects a missing provided token when one IS configured', () => {
    expect(verifyHealthProbeToken('real-token', undefined)).toBe(false)
  })

  it('rejects a wrong token of the same length without throwing', () => {
    expect(() => verifyHealthProbeToken('real-token-1234', 'real-token-9999')).not.toThrow()
    expect(verifyHealthProbeToken('real-token-1234', 'real-token-9999')).toBe(false)
  })

  it('rejects a wrong token of a different length without throwing', () => {
    // crypto.timingSafeEqual throws on mismatched buffer lengths — must not
    // bubble up as an unhandled exception.
    expect(() => verifyHealthProbeToken('real-token', 'short')).not.toThrow()
    expect(verifyHealthProbeToken('real-token', 'short')).toBe(false)
  })

  it('accepts an exact match', () => {
    expect(verifyHealthProbeToken('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(true)
  })
})
