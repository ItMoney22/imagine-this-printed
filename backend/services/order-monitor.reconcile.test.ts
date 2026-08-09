import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for reconcileUnrecordedPayments — the net added on 2026-08-07 after a
// real $26 order (ITP-MSJK1K3I-8GDG) was captured by Stripe and then sat at
// payment_status=pending for lack of a webhook, because the Stripe Dashboard
// endpoint still pointed at /api/webhooks/stripe (deleted 2026-07-27, f4785ce).
//
// The two properties that actually matter, and are what these tests pin:
//   1. It heals ONLY when Stripe says the intent succeeded. An abandoned
//      checkout (requires_payment_method) must be left completely alone —
//      wrongly flipping one of those to paid would tell the crew to print a
//      shirt nobody paid for.
//   2. A heal is LOUD. Silently repairing a broken webhook pipeline would hide
//      the outage that made the repair necessary.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY = 'sk_test_reconciler'

/** Rows the fake `orders` query returns, swapped per test. */
let orderRows: any[] = []
let orderQueryError: { message: string } | null = null
/** Everything written, so assertions can read what the sweep actually did. */
const inserted: Array<{ table: string; row: any }> = []
/** PaymentIntent lookups the sweep performed, and what Stripe "returned". */
let intentsById: Record<string, any> = {}
const retrieved: string[] = []

vi.mock('../lib/supabase.js', () => {
  // Chainable no-op filter builder: every method returns `this`, and awaiting
  // it (or .then-ing it) resolves to the configured rows. Mirrors the shape
  // reconcileUnrecordedPayments uses: select→neq→not→not→gt→order→limit→await.
  const makeChain = (resolve: () => any) => {
    const chain: any = {}
    for (const m of ['select', 'neq', 'not', 'gt', 'eq', 'lt', 'order', 'limit']) {
      chain[m] = () => chain
    }
    chain.then = (onOk: any, onErr?: any) => Promise.resolve(resolve()).then(onOk, onErr)
    return chain
  }

  return {
    supabase: {
      from: (table: string) => ({
        select: (...args: any[]) => makeChain(() =>
          table === 'orders'
            ? { data: orderQueryError ? null : orderRows, error: orderQueryError }
            : { data: [], error: null }
        ).select(...args),
        insert: (row: any) => {
          inserted.push({ table, row })
          return makeChain(() => ({ data: null, error: null }))
        },
        update: () => makeChain(() => ({ data: null, error: null }))
      })
    }
  }
})

// order-monitor.ts imports sendEmail at module scope; stub it so nothing can
// reach a real transport from a test run.
vi.mock('../utils/email.js', () => ({ sendEmail: async () => true }))

vi.mock('stripe', () => ({
  default: class FakeStripe {
    paymentIntents = {
      retrieve: async (id: string) => {
        retrieved.push(id)
        const pi = intentsById[id]
        if (!pi) throw new Error(`No such payment_intent: ${id}`)
        return pi
      }
    }
  }
}))

const applyPaidCheckoutOrder = vi.fn(async () => ({ claimed: true }))
vi.mock('./order-payment.js', () => ({
  applyPaidCheckoutOrder: (...args: any[]) => applyPaidCheckoutOrder(...(args as [])) as any
}))

const { reconcileUnrecordedPayments } = await import('./order-monitor.js')

const PAID_ORDER = {
  id: 'bf1abb5f-0e9a-4e29-803a-015e82161d3a',
  order_number: 'ITP-MSJK1K3I-8GDG',
  payment_intent_id: 'pi_paid',
  total: 26,
  created_at: new Date().toISOString(),
  status: 'pending',
  payment_status: 'pending'
}
const ABANDONED_ORDER = {
  id: '13063e4c-5a92-4a3e-94af-2fa36eb24a50',
  order_number: 'ITP-MSIWUX4F-NTLU',
  payment_intent_id: 'pi_abandoned',
  total: 26,
  created_at: new Date().toISOString(),
  status: 'pending',
  payment_status: 'pending'
}

beforeEach(() => {
  orderRows = []
  orderQueryError = null
  inserted.length = 0
  retrieved.length = 0
  intentsById = {
    pi_paid: { id: 'pi_paid', status: 'succeeded', metadata: { orderId: PAID_ORDER.id } },
    pi_abandoned: { id: 'pi_abandoned', status: 'requires_payment_method', metadata: { orderId: ABANDONED_ORDER.id } }
  }
  applyPaidCheckoutOrder.mockClear()
  applyPaidCheckoutOrder.mockResolvedValue({ claimed: true })
})

describe('reconcileUnrecordedPayments', () => {
  it('heals an order Stripe says is succeeded but the DB still calls pending', async () => {
    orderRows = [PAID_ORDER]

    const result = await reconcileUnrecordedPayments()

    expect(result).toEqual({ checked: 1, healed: 1 })
    expect(retrieved).toEqual(['pi_paid'])
    expect(applyPaidCheckoutOrder).toHaveBeenCalledTimes(1)
    // Third argument is the source tag — it must say 'reconciler', because that
    // is what puts the "webhook did NOT deliver" banner on the team alert.
    const [pi, , source] = applyPaidCheckoutOrder.mock.calls[0] as any[]
    expect(pi.id).toBe('pi_paid')
    expect(source).toBe('reconciler')
  })

  it('leaves an abandoned checkout completely alone', async () => {
    orderRows = [ABANDONED_ORDER]

    const result = await reconcileUnrecordedPayments()

    expect(result).toEqual({ checked: 1, healed: 0 })
    expect(retrieved).toEqual(['pi_abandoned'])
    expect(applyPaidCheckoutOrder).not.toHaveBeenCalled()
    // No heal means no alarm — an unpaid order is not an incident.
    expect(inserted).toHaveLength(0)
  })

  it('raises a health_alert naming the recovered orders when it heals', async () => {
    orderRows = [PAID_ORDER]

    await reconcileUnrecordedPayments()

    const alert = inserted.find(i => i.table === 'admin_notifications')
    expect(alert).toBeTruthy()
    expect(alert!.row.type).toBe('health_alert')
    expect(alert!.row.title).toContain('missed 1 payment')
    expect(alert!.row.message).toContain('ITP-MSJK1K3I-8GDG')
    // Points at the thing that actually needs fixing.
    expect(alert!.row.message).toContain('/api/stripe/webhook')

    const audit = inserted.find(i => i.table === 'audit_logs')
    expect(audit!.row.action).toBe('payments_reconciled')
    expect(audit!.row.metadata).toMatchObject({ healed: 1, orders: ['ITP-MSJK1K3I-8GDG'] })
  })

  it('keeps sweeping when one intent lookup blows up', async () => {
    orderRows = [
      { ...ABANDONED_ORDER, payment_intent_id: 'pi_missing' },
      PAID_ORDER
    ]

    const result = await reconcileUnrecordedPayments()

    expect(retrieved).toEqual(['pi_missing', 'pi_paid'])
    expect(result).toEqual({ checked: 2, healed: 1 })
    expect(applyPaidCheckoutOrder).toHaveBeenCalledTimes(1)
  })

  it('does not count an order another delivery already claimed', async () => {
    orderRows = [PAID_ORDER]
    // The webhook landed between the candidate query and the heal — the atomic
    // claim inside applyPaidCheckoutOrder loses, so nothing was recovered here
    // and no outage alarm should be raised off it.
    applyPaidCheckoutOrder.mockResolvedValue({ claimed: false })

    const result = await reconcileUnrecordedPayments()

    expect(result).toEqual({ checked: 1, healed: 0 })
    expect(inserted).toHaveLength(0)
  })

  it('is a no-op when nothing is outstanding', async () => {
    orderRows = []

    const result = await reconcileUnrecordedPayments()

    expect(result).toEqual({ checked: 0, healed: 0 })
    expect(retrieved).toHaveLength(0)
    expect(inserted).toHaveLength(0)
  })

  it('reports zero rather than throwing when the candidate query fails', async () => {
    orderQueryError = { message: 'connection reset' }

    const result = await reconcileUnrecordedPayments()

    expect(result).toEqual({ checked: 0, healed: 0 })
    expect(applyPaidCheckoutOrder).not.toHaveBeenCalled()
  })

  it('skips entirely when STRIPE_SECRET_KEY is absent', async () => {
    const saved = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      orderRows = [PAID_ORDER]
      const result = await reconcileUnrecordedPayments()
      expect(result).toEqual({ checked: 0, healed: 0 })
      expect(retrieved).toHaveLength(0)
    } finally {
      process.env.STRIPE_SECRET_KEY = saved
    }
  })
})
