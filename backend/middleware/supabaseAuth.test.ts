import { describe, it, expect, vi } from 'vitest'

// Must be set before supabaseAuth.ts is first imported below — the module
// now throws at load time if SUPABASE_JWT_SECRET is unset (fail-fast boot
// check), and requireAuth/optionalAuth verify against these values.
const TEST_SUPABASE_URL = 'https://test-project.supabase.co'
const TEST_JWT_SECRET = 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.SUPABASE_URL = TEST_SUPABASE_URL
process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET

// role-cache.ts (via lib/supabase.ts) is the one and only source of truth
// this middleware is allowed to trust. Mock it to a fixed "customer" so the
// test proves a forged `user_metadata.role: 'admin'` claim is ignored, not
// just that the DB happens to agree.
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'customer' }, error: null }),
        }),
      }),
    }),
  },
}))

function mockRes() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => { res.statusCode = code; return res }
  res.json = (body: any) => { res.body = body; return res }
  return res
}

describe('supabaseAuth — role must come from the server, not the token', () => {
  it('denies a privileged route to a forged admin claim in user_metadata (403)', async () => {
    const { requireAuth, requireRole } = await import('./supabaseAuth.js')
    const { jose } = await import('../lib/jose.js')
    const { SignJWT } = await jose()

    const secret = new TextEncoder().encode(TEST_JWT_SECRET)
    // Exactly what supabase.auth.updateUser({ data: { role: 'admin' } })
    // produces: a legitimately-signed token (real secret, real issuer) that
    // nonetheless carries a client-chosen role claim.
    const forgedToken = await new SignJWT({
      user_metadata: { role: 'admin' },
      email: 'attacker@example.com',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(`https://${new URL(TEST_SUPABASE_URL).host}/auth/v1`)
      .setSubject('11111111-1111-1111-1111-111111111111')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret)

    const req: any = {
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? `Bearer ${forgedToken}` : undefined,
    }
    const res = mockRes()
    const next = vi.fn()

    await requireAuth(req, res, next)
    expect(next).toHaveBeenCalledTimes(1) // token itself is valid, so requireAuth passes it through
    expect(req.user?.role).toBeUndefined() // but the forged role must never land on req.user

    const guardAdmin = requireRole(['admin'])
    await guardAdmin(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Insufficient permissions' })
  })

  it('still grants access when the authoritative profile role matches (regression guard)', async () => {
    const { requireRole } = await import('./supabaseAuth.js')
    const req: any = { user: { id: 'some-other-user', sub: 'some-other-user' } }
    const res = mockRes()
    const next = vi.fn()

    const guardCustomer = requireRole(['customer'])
    await guardCustomer(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(req.user.role).toBe('customer')
  })
})
