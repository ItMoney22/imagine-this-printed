import { describe, it, expect } from 'vitest'

// email-suppression.ts imports backend/lib/supabase.ts, which creates its
// client eagerly at module load — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must
// exist BEFORE the import is evaluated. None of these tests touch a real
// database: the invalid-email guards in getSuppression/recordSuppression
// return before any Supabase call, same "inert until configured" pattern as
// backend/services/merch-webhook.test.ts. Dynamic import after env setup
// (not a static import, which ESM hoists ahead of this file's code) is what
// makes the ordering work.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { normalizeEmail, getSuppression, isSuppressed, recordSuppression } = await import('./email-suppression.js')

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM  ')).toBe('jane.doe@example.com')
  })

  it('handles null/undefined as empty string', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
  })
})

// These guards run BEFORE any Supabase call, so they're safe to test without
// a live database (same "inert" pattern used elsewhere in this suite).
describe('getSuppression / isSuppressed — invalid-input guard', () => {
  it('returns null for an empty address without touching the database', async () => {
    expect(await getSuppression('')).toBeNull()
  })

  it('returns null for an address with no "@" without touching the database', async () => {
    expect(await getSuppression('not-an-email')).toBeNull()
  })

  it('isSuppressed is false for an invalid address', async () => {
    expect(await isSuppressed('not-an-email')).toBe(false)
  })
})

describe('recordSuppression — invalid-input guard', () => {
  it('returns false for an empty address without touching the database', async () => {
    expect(await recordSuppression({ email: '', reason: 'hard_bounce' })).toBe(false)
  })

  it('returns false for an address with no "@" without touching the database', async () => {
    expect(await recordSuppression({ email: 'not-an-email', reason: 'complaint' })).toBe(false)
  })
})
