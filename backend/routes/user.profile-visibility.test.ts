import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load and
// middleware/supabaseAuth.ts throws without a JWT secret, so these must exist
// before user.ts is evaluated. Same pattern as kiosk.test.ts / coupons.test.ts.
process.env.SUPABASE_URL ||= 'https://test-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'

const { fetchVisibleProfile, PUBLIC_PROFILE_COLUMNS } = await import('./user.js')

// ---------------------------------------------------------------------------
// GET /api/profile/get shipped unauthenticated with `select('*')` on
// `user_profiles` through the SERVICE ROLE client. RLS never applies to that
// client, so any anonymous caller holding a user id got the full row — email,
// legal name, phone, shipping address, tax id, stripe_account_id, credit_limit,
// itc_balance and role. The 20260806 migration had closed exactly that exposure
// at the database layer (public.public_profiles); this route re-opened it at
// the API layer.
//
// These cases pin the two guarantees of the fix: an unprivileged caller can
// only ever select the public column list, and never sees a profile the owner
// has not marked public.
// ---------------------------------------------------------------------------

const FULL_ROW = {
  id: 'user-1',
  username: 'darrell',
  display_name: 'Darrell',
  is_public: true,
  // The columns that must never reach an unprivileged caller:
  email: 'darrell@example.com',
  first_name: 'Darrell',
  last_name: 'McCutchen',
  phone: '+15555550123',
  shipping_address: '123 Main St',
  tax_id: '12-3456789',
  stripe_account_id: 'acct_123',
  credit_limit: 5000,
  itc_balance: 4200,
  role: 'vendor'
}

const SENSITIVE_COLUMNS = [
  'email', 'first_name', 'last_name', 'phone', 'shipping_address',
  'tax_id', 'stripe_account_id', 'credit_limit', 'itc_balance', 'role'
]

/**
 * Fake `user_profiles` table that records the requested projection and, like
 * PostgREST, returns only the selected columns. `select('*')` returns the whole
 * row; a column list returns just those columns.
 */
function makeFakeProfilesDb(row: Record<string, any> | null) {
  const selects: string[] = []
  const db = {
    selects,
    from(table: string) {
      if (table !== 'user_profiles') throw new Error(`unexpected table "${table}"`)
      let projection = '*'
      const filters: Array<[string, any]> = []
      const builder: any = {
        select(cols: string) {
          projection = cols
          selects.push(cols)
          return builder
        },
        eq(col: string, val: any) {
          filters.push([col, val])
          return builder
        },
        single: async () => {
          if (!row) return { data: null, error: { message: 'not found' } }
          if (!filters.every(([col, val]) => row[col] === val)) {
            return { data: null, error: { message: 'not found' } }
          }
          if (projection === '*') return { data: { ...row }, error: null }
          const cols = projection.split(',').map(c => c.trim())
          const projected: Record<string, any> = {}
          for (const c of cols) if (c in row) projected[c] = row[c]
          return { data: projected, error: null }
        }
      }
      return builder
    }
  }
  return db
}

describe('fetchVisibleProfile', () => {
  it('never selects PII columns for an unprivileged caller', async () => {
    const db = makeFakeProfilesDb(FULL_ROW)

    const result = await fetchVisibleProfile(db, { userId: 'user-1', privileged: false })

    expect('profile' in result).toBe(true)
    const profile = (result as { profile: Record<string, any> }).profile
    for (const col of SENSITIVE_COLUMNS) {
      expect(profile).not.toHaveProperty(col)
    }
    expect(profile.username).toBe('darrell')
    // Proven at the query layer too, not just the response: the sensitive
    // columns are never even asked for.
    expect(db.selects).toEqual([PUBLIC_PROFILE_COLUMNS])
    for (const col of SENSITIVE_COLUMNS) {
      expect(PUBLIC_PROFILE_COLUMNS).not.toContain(col)
    }
  })

  it('hides a private profile from an unprivileged caller, with the same 404 as a missing one', async () => {
    const privateRow = { ...FULL_ROW, is_public: false }

    const hidden = await fetchVisibleProfile(makeFakeProfilesDb(privateRow), {
      userId: 'user-1',
      privileged: false
    })
    const missing = await fetchVisibleProfile(makeFakeProfilesDb(null), {
      userId: 'user-1',
      privileged: false
    })

    expect(hidden).toEqual({ notFound: true })
    expect(missing).toEqual({ notFound: true })
  })

  it('returns the full row to the owner or an admin, including a private profile', async () => {
    const privateRow = { ...FULL_ROW, is_public: false }
    const db = makeFakeProfilesDb(privateRow)

    const result = await fetchVisibleProfile(db, { userId: 'user-1', privileged: true })

    expect('profile' in result).toBe(true)
    const profile = (result as { profile: Record<string, any> }).profile
    expect(profile.email).toBe('darrell@example.com')
    expect(profile.itc_balance).toBe(4200)
    expect(db.selects).toEqual(['*'])
  })

  it('404s on a missing profile for a privileged caller too', async () => {
    const result = await fetchVisibleProfile(makeFakeProfilesDb(null), {
      userId: 'ghost',
      privileged: true
    })
    expect(result).toEqual({ notFound: true })
  })
})
