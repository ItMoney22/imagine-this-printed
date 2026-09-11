import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// PATCH /api/orders/:orderId — does the buyer actually hear about it?
//
// This route is what every button in Order Management calls. It wrote the
// status and the tracking number and sent NOTHING: an admin marked an order
// shipped, the dashboard said "shipped", and the customer was never told. The
// only code that mailed a shipping notice lived on a different endpoint
// (PATCH /api/stripe/orders/:id/status) that no screen calls.
//
// So what is under test here is the notification decision, not the write:
// real news mails, repeated saves do not. The handler is pulled straight off
// the Express router's stack — no HTTP server — the same way
// studio-flow.test.ts does it.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

type Row = Record<string, any>
let orderRow: Row

function makeQuery(table: string) {
  let mode: 'select' | 'update' | 'insert' = 'select'
  let payload: any = null

  const exec = () => {
    if (table !== 'orders') return { data: null, error: null }
    if (mode === 'update') {
      orderRow = { ...orderRow, ...payload }
      return { data: { ...orderRow }, error: null }
    }
    return { data: { ...orderRow }, error: null }
  }

  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: (p: any) => {
      mode = 'update'
      payload = p
      return chain
    },
    insert: async (row: any) => {
      mode = 'insert'
      payload = row
      return { data: null, error: null }
    },
    single: async () => exec(),
    maybeSingle: async () => exec(),
    then: (onOk: any, onErr?: any) => Promise.resolve(exec()).then(onOk, onErr),
  }
  return chain
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => makeQuery(t) } }))
vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (_r: any, _s: any, n: any) => n(),
  requireRole: () => (_r: any, _s: any, n: any) => n(),
}))

const sendOrderShippedEmail = vi.fn(async () => true)
const sendOrderDeliveredEmail = vi.fn(async () => true)
vi.mock('../utils/email.js', () => ({
  sendOrderShippedEmail: (...a: any[]) => sendOrderShippedEmail(...(a as [])),
  sendOrderDeliveredEmail: (...a: any[]) => sendOrderDeliveredEmail(...(a as [])),
}))

const ordersRouter = (await import('./orders.js')).default

function patchHandler() {
  const layer = (ordersRouter as any).stack.find(
    (l: any) => l.route?.path === '/:orderId' && l.route?.methods?.patch
  )
  if (!layer) throw new Error('No PATCH /:orderId route on the orders router')
  const stack = layer.route.stack
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<any>
}

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (c: number) => {
    res.statusCode = c
    return res
  }
  res.json = (b: any) => {
    res.body = b
    return res
  }
  return res
}

async function patchOrder(body: Record<string, any>) {
  const res = makeRes()
  await patchHandler()({ params: { orderId: 'ord-1' }, body, user: { sub: 'admin-1' } }, res)
  return res
}

beforeEach(() => {
  orderRow = {
    id: 'ord-1',
    order_number: 'ITP-1042',
    status: 'processing',
    customer_email: 'buyer@example.com',
    customer_name: 'Dana Reyes',
    shipping_address: { firstName: 'Dana', lastName: 'Reyes' },
    tracking_number: null,
    tracking_company: null,
  }
  sendOrderShippedEmail.mockClear()
  sendOrderDeliveredEmail.mockClear()
})

describe('shipping notifications', () => {
  it('mails the buyer when an order moves to shipped, with the tracking it just saved', async () => {
    const res = await patchOrder({
      status: 'shipped',
      tracking_number: '9400111899223197428490',
      tracking_company: 'USPS',
    })

    expect(res.statusCode).toBe(200)
    expect(res.body.customerNotified).toBe('shipped')
    expect(sendOrderShippedEmail).toHaveBeenCalledTimes(1)
    const [email, orderRef, tracking, carrier, options] = sendOrderShippedEmail.mock.calls[0] as any[]
    expect(email).toBe('buyer@example.com')
    // The friendly order number, not the uuid — it's what the buyer sees.
    expect(orderRef).toBe('ITP-1042')
    expect(tracking).toBe('9400111899223197428490')
    expect(carrier).toBe('USPS')
    expect(options).toMatchObject({ orderId: 'ord-1', customerName: 'Dana Reyes' })
  })

  it('does not re-announce a shipment when the same status is saved again', async () => {
    await patchOrder({ status: 'shipped', tracking_number: 'TRK-1' })
    sendOrderShippedEmail.mockClear()

    // A double-clicked status button: same status, same tracking, no news.
    const res = await patchOrder({ status: 'shipped', tracking_number: 'TRK-1' })

    expect(res.statusCode).toBe(200)
    expect(res.body.customerNotified).toBeNull()
    expect(sendOrderShippedEmail).not.toHaveBeenCalled()
  })

  it('mails again when a corrected tracking number lands on an already-shipped order', async () => {
    await patchOrder({ status: 'shipped', tracking_number: 'TRK-WRONG' })
    sendOrderShippedEmail.mockClear()

    const res = await patchOrder({ tracking_number: 'TRK-RIGHT', tracking_company: 'UPS' })

    expect(res.body.customerNotified).toBe('shipped')
    expect(sendOrderShippedEmail).toHaveBeenCalledTimes(1)
    expect(sendOrderShippedEmail.mock.calls[0][2]).toBe('TRK-RIGHT')
  })

  it('stays quiet when only the notes change', async () => {
    const res = await patchOrder({ internal_notes: 'boxed, waiting on pickup' })

    expect(res.body.customerNotified).toBeNull()
    expect(sendOrderShippedEmail).not.toHaveBeenCalled()
    expect(sendOrderDeliveredEmail).not.toHaveBeenCalled()
  })

  it('moves a processing order to shipped when tracking alone is saved', async () => {
    const res = await patchOrder({ tracking_number: 'TRK-1', tracking_company: 'USPS' })

    expect(res.body.order.status).toBe('shipped')
    expect(res.body.order.fulfillment_status).toBe('fulfilled')
    expect(res.body.customerNotified).toBe('shipped')
  })

  it('saves tracking on an unpaid order without illegally marking it shipped', async () => {
    // pending -> shipped is not a legal move (an unpaid order has not shipped),
    // and the whole request 409-ing would lose the number the admin just typed.
    orderRow.status = 'pending'

    const res = await patchOrder({ tracking_number: 'TRK-1' })

    expect(res.statusCode).toBe(200)
    expect(res.body.order.tracking_number).toBe('TRK-1')
    expect(res.body.order.status).toBe('pending')
    // Still real news to the buyer — they have a number they can track.
    expect(res.body.customerNotified).toBe('shipped')
  })

  it('sends the delivered email — not the shipped one — on delivery', async () => {
    orderRow.status = 'shipped'
    orderRow.tracking_number = 'TRK-1'

    const res = await patchOrder({ status: 'delivered' })

    expect(res.body.customerNotified).toBe('delivered')
    expect(sendOrderDeliveredEmail).toHaveBeenCalledTimes(1)
    expect(sendOrderShippedEmail).not.toHaveBeenCalled()
    // Delivery also stamps delivered_at, which the customer-facing status page
    // and every "was this actually delivered?" query read.
    expect(res.body.order.delivered_at).toBeTruthy()
  })

  // David: "a nice email to the cust maybe giving them a 10% coupon on next order".
  it('mints a real 10% code and hands it to the delivered email', async () => {
    orderRow.status = 'shipped'

    await patchOrder({ status: 'delivered' })

    const options = sendOrderDeliveredEmail.mock.calls[0][2]
    expect(options.coupon.percent).toBe(10)
    expect(options.coupon.code).toMatch(/^THANKS10-[A-Z0-9]{6}$/)
    expect(options.coupon.expiresAt).toBeTruthy()
  })

  it('reuses the code already on the order rather than minting a second one', async () => {
    orderRow.status = 'shipped'
    orderRow.delivery_coupon_code = 'THANKS10-OLD123'

    await patchOrder({ status: 'delivered' })

    expect(sendOrderDeliveredEmail.mock.calls[0][2].coupon.code).toBe('THANKS10-OLD123')
  })

  it('still saves the tracking on a guest order with no email on file', async () => {
    orderRow.customer_email = null

    const res = await patchOrder({ status: 'shipped', tracking_number: 'TRK-1' })

    expect(res.statusCode).toBe(200)
    expect(res.body.order.tracking_number).toBe('TRK-1')
    expect(res.body.customerNotified).toBeNull()
    expect(sendOrderShippedEmail).not.toHaveBeenCalled()
  })

  it('does not fail the admin write when the mail provider is down', async () => {
    sendOrderShippedEmail.mockRejectedValueOnce(new Error('resend 503'))

    const res = await patchOrder({ status: 'shipped', tracking_number: 'TRK-1' })

    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.customerNotified).toBeNull()
  })
})
