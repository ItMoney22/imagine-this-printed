import { describe, it, expect, vi } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load, so
// these must exist before kiosk.ts is evaluated. Same pattern as
// coupons.test.ts / order-status.test.ts.
process.env.SUPABASE_URL ||= 'https://test-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

/**
 * Watchtower ITP Closeout campaign, 2026-07-28 (task 83eb5c5b) —
 * acceptance criterion: "Attempting to access a kiosk session with only a
 * kiosk ID (without a valid per-device secret exchange) fails" and "the
 * system prevents unauthorized users from gaining role:'kiosk' privileges
 * by enumerating kiosk IDs or bypassing the new secret exchange
 * mechanism." This is the proof.
 *
 * Fake `kiosks` + `kiosk_devices` tables with just enough of the
 * supabase-js chain (`select().eq().maybeSingle()` / `.eq().eq().is()`)
 * that verifyKioskDeviceSecret actually exercises, mirroring the
 * assign-then-await style server chains used elsewhere in this repo (see
 * coupons.test.ts's makeFakeCouponDb).
 */
function makeFakeKioskDb(kiosk: { id: string; is_active: boolean } | null, devices: Array<{ id: string; kiosk_id: string; secret_hash: string; revoked_at: string | null }>) {
  return {
    from(table: string) {
      if (table === 'kiosks') {
        const filters: Array<[string, any]> = []
        const builder: any = {
          select: () => builder,
          eq(col: string, val: any) {
            filters.push([col, val])
            return builder
          },
          maybeSingle: async () => {
            if (!kiosk) return { data: null, error: null }
            const match = filters.every(([col, val]) => (kiosk as any)[col] === val)
            return { data: match ? kiosk : null, error: null }
          }
        }
        return builder
      }
      if (table === 'kiosk_devices') {
        const filters: Array<[string, any]> = []
        let isNullFilter: string | null = null
        const builder: any = {
          select: () => builder,
          eq(col: string, val: any) {
            filters.push([col, val])
            return builder
          },
          is(col: string, val: null) {
            if (val === null) isNullFilter = col
            return builder
          },
          maybeSingle: async () => {
            const match = devices.find(d =>
              filters.every(([col, val]) => (d as any)[col] === val) &&
              (!isNullFilter || (d as any)[isNullFilter] === null)
            )
            return { data: match ? { id: match.id } : null, error: null }
          }
        }
        return builder
      }
      throw new Error(`makeFakeKioskDb: unexpected table "${table}"`)
    }
  }
}

describe('verifyKioskDeviceSecret — kiosk sessions require a valid per-device secret', () => {
  it('rejects a real kiosk ID with NO secret exchange (wrong secret) — the core enumeration guard', async () => {
    vi.resetModules()
    vi.doMock('../lib/supabase.js', () => ({
      supabase: makeFakeKioskDb(
        { id: 'kiosk-1', is_active: true },
        [{ id: 'device-1', kiosk_id: 'kiosk-1', secret_hash: 'a'.repeat(64), revoked_at: null }]
      )
    }))
    const { verifyKioskDeviceSecret } = await import('./kiosk.js')

    const result = await verifyKioskDeviceSecret('kiosk-1', 'totally-wrong-secret')
    expect(result).toBeNull()
  })

  it('rejects a made-up/enumerated kiosk ID outright', async () => {
    vi.resetModules()
    vi.doMock('../lib/supabase.js', () => ({
      supabase: makeFakeKioskDb(null, [])
    }))
    const { verifyKioskDeviceSecret } = await import('./kiosk.js')

    const result = await verifyKioskDeviceSecret('kiosk-does-not-exist', 'anything')
    expect(result).toBeNull()
  })

  it('rejects an inactive kiosk even with the correct device secret', async () => {
    vi.resetModules()
    const { hashKioskToken } = await import('../middleware/requireKioskSession.js')
    const rawSecret = 'device-secret-for-inactive-kiosk'
    vi.doMock('../lib/supabase.js', () => ({
      supabase: makeFakeKioskDb(
        { id: 'kiosk-2', is_active: false },
        [{ id: 'device-2', kiosk_id: 'kiosk-2', secret_hash: hashKioskToken(rawSecret), revoked_at: null }]
      )
    }))
    const { verifyKioskDeviceSecret } = await import('./kiosk.js')

    const result = await verifyKioskDeviceSecret('kiosk-2', rawSecret)
    expect(result).toBeNull()
  })

  it('rejects a revoked device even with the correct secret', async () => {
    vi.resetModules()
    const { hashKioskToken } = await import('../middleware/requireKioskSession.js')
    const rawSecret = 'device-secret-for-revoked-device'
    vi.doMock('../lib/supabase.js', () => ({
      supabase: makeFakeKioskDb(
        { id: 'kiosk-3', is_active: true },
        [{ id: 'device-3', kiosk_id: 'kiosk-3', secret_hash: hashKioskToken(rawSecret), revoked_at: '2026-07-01T00:00:00Z' }]
      )
    }))
    const { verifyKioskDeviceSecret } = await import('./kiosk.js')

    const result = await verifyKioskDeviceSecret('kiosk-3', rawSecret)
    expect(result).toBeNull()
  })

  it('accepts the correct secret for the correct active kiosk (regression guard)', async () => {
    vi.resetModules()
    const { hashKioskToken } = await import('../middleware/requireKioskSession.js')
    const rawSecret = 'the-real-device-secret'
    vi.doMock('../lib/supabase.js', () => ({
      supabase: makeFakeKioskDb(
        { id: 'kiosk-4', is_active: true },
        [{ id: 'device-4', kiosk_id: 'kiosk-4', secret_hash: hashKioskToken(rawSecret), revoked_at: null }]
      )
    }))
    const { verifyKioskDeviceSecret } = await import('./kiosk.js')

    const result = await verifyKioskDeviceSecret('kiosk-4', rawSecret)
    expect(result).toEqual({ id: 'device-4' })
  })

  it("a device secret provisioned for kiosk A does not unlock kiosk B (no cross-kiosk reuse)", async () => {
    vi.resetModules()
    const { hashKioskToken } = await import('../middleware/requireKioskSession.js')
    const rawSecret = 'kiosk-a-secret'
    vi.doMock('../lib/supabase.js', () => ({
      supabase: makeFakeKioskDb(
        { id: 'kiosk-b', is_active: true },
        [{ id: 'device-a', kiosk_id: 'kiosk-a', secret_hash: hashKioskToken(rawSecret), revoked_at: null }]
      )
    }))
    const { verifyKioskDeviceSecret } = await import('./kiosk.js')

    const result = await verifyKioskDeviceSecret('kiosk-b', rawSecret)
    expect(result).toBeNull()
  })
})
