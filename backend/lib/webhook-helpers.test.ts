import { describe, it, expect } from 'vitest'
import { addBalance, claimOnce } from './webhook-helpers.js'

describe('addBalance', () => {
  it('adds a numeric delta to a string balance instead of concatenating', () => {
    // The exact regression class from the audit: Supabase returns NUMERIC/
    // DECIMAL columns as strings, so `"100" + 500` used to produce the
    // string "100500" instead of the number 600.
    expect(addBalance('100', 500)).toBe(600)
    expect(addBalance('100', 500)).not.toBe('100500' as any)
  })

  it('handles a real number balance', () => {
    expect(addBalance(100, 500)).toBe(600)
  })

  it('treats null/undefined balances as zero', () => {
    expect(addBalance(null, 250)).toBe(250)
    expect(addBalance(undefined, 250)).toBe(250)
  })

  it('handles a zero string balance', () => {
    expect(addBalance('0', 100)).toBe(100)
  })

  it('handles decimal string balances', () => {
    expect(addBalance('99.5', 0.5)).toBe(100)
  })
})

describe('claimOnce', () => {
  it('reports claimed=true when the update matched a row (first delivery)', async () => {
    const outcome = await claimOnce(
      Promise.resolve({ data: [{ id: 'row-1' }], error: null })
    )
    expect(outcome.claimed).toBe(true)
    expect(outcome.row).toEqual({ id: 'row-1' })
    expect(outcome.error).toBeNull()
  })

  it('reports claimed=false when the update matched nothing (redelivered event, no-op)', async () => {
    // This is what happens when a Stripe webhook is redelivered: the earlier
    // delivery's UPDATE already flipped the guard column, so the WHERE
    // .neq(...) clause on the second delivery excludes the row and Supabase
    // returns an empty array — not an error.
    const outcome = await claimOnce(
      Promise.resolve({ data: [], error: null })
    )
    expect(outcome.claimed).toBe(false)
    expect(outcome.row).toBeNull()
  })

  it('reports claimed=false when data is null', async () => {
    const outcome = await claimOnce(
      Promise.resolve({ data: null, error: null })
    )
    expect(outcome.claimed).toBe(false)
    expect(outcome.row).toBeNull()
  })

  it('surfaces the error and does not claim when the query fails', async () => {
    const dbError = { message: 'connection reset' }
    const outcome = await claimOnce(
      Promise.resolve({ data: null, error: dbError })
    )
    expect(outcome.claimed).toBe(false)
    expect(outcome.error).toBe(dbError)
  })
})
