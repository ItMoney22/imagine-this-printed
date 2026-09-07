import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for sweepAbandonedCarts — the recovery job that was missing for six
// weeks while its schedule layer, its tests and its migration all sat in the
// repo doing nothing (see services/abandoned-cart.ts header).
//
// The properties that actually matter, because each one is a way to burn the
// sending domain or embarrass the shop in front of a customer:
//   1. A customer is NEVER mailed the same stage twice. The claim row goes in
//      BEFORE the send, so a crash between the two cannot re-mail on the next
//      tick.
//   2. A paid, cancelled or refunded order is never chased.
//   3. If the dedupe table can't be read, the sweep sends NOTHING rather than
//      guessing — an unapplied migration must not turn into a double-send.
//   4. A suppressed (unsubscribed / previously bounced) address is not mailed,
//      and its claim row stays so the stage is not retried.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.FRONTEND_URL = 'https://imaginethisprinted.com'

let orderRows: any[] = []
let reminderRows: any[] = []
let reminderQueryError: { message: string } | null = null
/** Claim inserts, in order, so a test can assert claim-before-send. */
let claimInserts: any[] = []
/** Set to a code to make the NEXT claim insert fail (e.g. '23505'). */
let claimErrorCode: string | null = null
const events: string[] = []

vi.mock('../lib/supabase.js', () => {
  const makeChain = (resolve: () => any) => {
    const chain: any = {}
    for (const m of ['select', 'eq', 'neq', 'not', 'gt', 'lt', 'in', 'order', 'limit', 'update']) {
      chain[m] = () => chain
    }
    chain.then = (onOk: any, onErr?: any) => Promise.resolve(resolve()).then(onOk, onErr)
    return chain
  }

  return {
    supabase: {
      from: (table: string) => ({
        select: (...args: any[]) => makeChain(() => {
          if (table === 'orders') return { data: orderRows, error: null }
          if (table === 'abandoned_cart_reminders') {
            return reminderQueryError
              ? { data: null, error: reminderQueryError }
              : { data: reminderRows, error: null }
          }
          return { data: [], error: null }
        }).select(...args),
        insert: (row: any) => {
          if (table === 'abandoned_cart_reminders') {
            events.push(`claim:${row.order_id}:${row.stage}`)
            claimInserts.push(row)
            if (claimErrorCode) {
              const code = claimErrorCode
              claimErrorCode = null
              return makeChain(() => ({ data: null, error: { code, message: 'duplicate key' } }))
            }
          }
          return makeChain(() => ({ data: null, error: null }))
        },
        update: () => makeChain(() => ({ data: null, error: null }))
      })
    }
  }
})

let sendResult: any = { success: true, messageId: 'resend_abc' }
const sendAbandonedCartEmail = vi.fn(async (opts: any) => {
  events.push(`send:${opts.to}:${opts.stage}`)
  return sendResult
})
vi.mock('../utils/email-marketing.js', () => ({
  sendAbandonedCartEmail: (opts: any) => sendAbandonedCartEmail(opts)
}))

const { sweepAbandonedCarts } = await import('./abandoned-cart.js')

const NOW = new Date('2026-09-07T18:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

/** The real live row: $21.40, one Gothic Ghost tee, never paid. */
function draft(overrides: Record<string, any> = {}) {
  return {
    id: 'e2f1a6b0-1111-4222-8333-444455556666',
    order_number: 'ITP-MTQBXPVV-38KZ',
    customer_email: 'd.akinsheye13@example.com',
    customer_name: 'Dara A',
    total: 21.4,
    status: 'pending',
    payment_status: 'pending',
    created_at: hoursAgo(6),
    shipping_address: { firstName: 'Dara', lastName: 'A' },
    metadata: { items: [{ id: 'p1', name: 'Gothic Ghost Tee', quantity: 1, price: 21.4, size: 'L' }] },
    ...overrides
  }
}

beforeEach(() => {
  orderRows = []
  reminderRows = []
  reminderQueryError = null
  claimInserts = []
  claimErrorCode = null
  events.length = 0
  sendResult = { success: true, messageId: 'resend_abc' }
  sendAbandonedCartEmail.mockClear()
  delete process.env.ABANDONED_CART_EMAILS
})

describe('sweepAbandonedCarts — the send decision', () => {
  it('mails a 6h-old unpaid checkout its first reminder', async () => {
    orderRows = [draft()]
    const result = await sweepAbandonedCarts(NOW)

    expect(result.sent).toBe(1)
    expect(sendAbandonedCartEmail).toHaveBeenCalledTimes(1)
    const call = sendAbandonedCartEmail.mock.calls[0][0] as any
    expect(call.stage).toBe('first')
    expect(call.to).toBe('d.akinsheye13@example.com')
    expect(call.total).toBe(21.4)
    expect(call.items[0].name).toBe('Gothic Ghost Tee')
    // The CTA has to be a tokenized restore link, not a bare /cart URL that
    // only works in the browser they abandoned in.
    expect(call.recoverUrl).toMatch(/\/recover-cart\/e2f1a6b0-1111-4222-8333-444455556666\?t=[0-9a-f]{32}$/)
  })

  it('does not mail a checkout that is only 1h old', async () => {
    // They may still be on the payment screen, or in a 3DS challenge.
    orderRows = [draft({ created_at: hoursAgo(1) })]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('sends the second reminder at 24h once the first has gone', async () => {
    orderRows = [draft({ created_at: hoursAgo(30) })]
    reminderRows = [{ order_id: draft().id, stage: 'first' }]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(1)
    expect((sendAbandonedCartEmail.mock.calls[0][0] as any).stage).toBe('second')
  })

  it('stops after the second — there is no third nudge', async () => {
    orderRows = [draft({ created_at: hoursAgo(72) })]
    reminderRows = [
      { order_id: draft().id, stage: 'first' },
      { order_id: draft().id, stage: 'second' }
    ]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('does not chase a cart abandoned more than a week ago', async () => {
    orderRows = [draft({ created_at: hoursAgo(24 * 9) })]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('never mails an order that was actually paid', async () => {
    orderRows = [draft({ payment_status: 'paid', status: 'processing' })]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.scanned).toBe(0)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('never mails a draft an admin cancelled', async () => {
    orderRows = [draft({ status: 'cancelled' })]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.scanned).toBe(0)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('skips a checkout with no items to show', async () => {
    // "You left something behind" with an empty cart is worse than no email.
    orderRows = [draft({ metadata: { items: [] } })]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })
})

describe('sweepAbandonedCarts — never mail twice', () => {
  it('claims the stage BEFORE sending, so a crash mid-send cannot re-mail', async () => {
    orderRows = [draft()]
    await sweepAbandonedCarts(NOW)
    expect(events).toEqual([
      `claim:${draft().id}:first`,
      'send:d.akinsheye13@example.com:first'
    ])
  })

  it('backs off silently when another sweep already claimed the stage', async () => {
    orderRows = [draft()]
    claimErrorCode = '23505' // unique violation on (order_id, stage)
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('sends NOTHING when the dedupe table cannot be read', async () => {
    // This is what an unapplied migration looks like. Guessing here would mean
    // re-mailing everyone who was already mailed.
    orderRows = [draft()]
    reminderQueryError = { message: 'relation "public.abandoned_cart_reminders" does not exist' }
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(result.halted).toMatch(/reminder history unreadable/)
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })
})

describe('sweepAbandonedCarts — guards', () => {
  it('honours a suppressed address without retrying the stage', async () => {
    orderRows = [draft()]
    sendResult = { success: false, suppressed: true, suppressionReason: 'complaint' }
    const result = await sweepAbandonedCarts(NOW)
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    // The claim row still went in: the stage is done, not pending a retry.
    expect(claimInserts).toHaveLength(1)
  })

  it('can be switched off entirely without a deploy', async () => {
    process.env.ABANDONED_CART_EMAILS = 'false'
    orderRows = [draft()]
    const result = await sweepAbandonedCarts(NOW)
    expect(result.halted).toBe('ABANDONED_CART_EMAILS=false')
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled()
  })

  it('caps how many go out in one sweep', async () => {
    process.env.ABANDONED_CART_MAX_PER_RUN = '2'
    // Re-import so the module-scope cap picks up the env change.
    vi.resetModules()
    const { sweepAbandonedCarts: capped } = await import('./abandoned-cart.js')
    orderRows = Array.from({ length: 5 }, (_, i) =>
      draft({ id: `00000000-0000-4000-8000-00000000000${i}`, customer_email: `buyer${i}@example.com` })
    )
    const result = await capped(NOW)
    expect(result.sent).toBe(2)
    delete process.env.ABANDONED_CART_MAX_PER_RUN
  })

  it('reports a clean zero when there is nothing to do', async () => {
    orderRows = []
    const result = await sweepAbandonedCarts(NOW)
    expect(result).toMatchObject({ scanned: 0, sent: 0, failed: 0 })
  })
})
