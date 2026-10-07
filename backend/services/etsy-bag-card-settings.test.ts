import { describe, it, expect } from 'vitest'
import { loadEtsyShopCoupon, saveEtsyShopCoupon } from './etsy-bag-card-settings.js'

// A tiny admin_settings stand-in: one key/value map, same calls the service makes.
function fakeDb(initial: Record<string, unknown> = {}, opts: { failWith?: string } = {}) {
  const rows = new Map(Object.entries(initial))
  const calls: { table: string; upsert?: unknown; onConflict?: string }[] = []
  const db = {
    from(table: string) {
      const call: { table: string; upsert?: unknown; onConflict?: string } = { table }
      calls.push(call)
      let key = ''
      const q = {
        select: () => q,
        eq: (_col: string, v: string) => ((key = v), q),
        maybeSingle: async () =>
          opts.failWith ? { data: null, error: { message: opts.failWith } } : { data: rows.has(key) ? { value: rows.get(key) } : null, error: null },
        upsert: async (row: { key: string; value: unknown }, o: { onConflict: string }) => {
          call.upsert = row
          call.onConflict = o.onConflict
          if (opts.failWith) return { error: { message: opts.failWith } }
          rows.set(row.key, row.value)
          return { error: null }
        }
      }
      return q
    }
  }
  return { db, rows, calls }
}

describe('Etsy bag card code in admin_settings', () => {
  it('has no code until one is saved (the print page stays on hold)', async () => {
    const { db } = fakeDb()
    expect(await loadEtsyShopCoupon(db)).toBeNull()
  })

  it('saves a good code under etsy_bag_card and reads it back', async () => {
    const { db, calls } = fakeDb()
    const now = new Date('2026-10-07T20:00:00Z')
    const saved = await saveEtsyShopCoupon(db, { code: 'thankyou15', percentOff: 15 }, 'christina@example.com', now)
    expect(saved).toEqual({ ok: true, coupon: { code: 'THANKYOU15', percentOff: 15, savedAt: now.toISOString(), savedBy: 'christina@example.com' } })
    expect(calls.at(-1)).toMatchObject({ table: 'admin_settings', onConflict: 'key', upsert: { key: 'etsy_bag_card' } })
    expect(await loadEtsyShopCoupon(db)).toEqual({ code: 'THANKYOU15', percentOff: 15, savedAt: now.toISOString(), savedBy: 'christina@example.com' })
  })

  it('refuses a bad code without writing anything', async () => {
    const { db, calls } = fakeDb()
    const saved = await saveEtsyShopCoupon(db, { code: 'ETSYBAG', percentOff: 15 }, null)
    expect(saved.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('surfaces a database error instead of pretending', async () => {
    const { db } = fakeDb({}, { failWith: 'relation "admin_settings" does not exist' })
    await expect(loadEtsyShopCoupon(db)).rejects.toThrow(/admin_settings/)
    await expect(saveEtsyShopCoupon(db, { code: 'THANKYOU15', percentOff: 15 }, null)).rejects.toThrow(/admin_settings/)
  })
})
