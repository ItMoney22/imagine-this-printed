import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// Crystal's reminders, end to end (David 2026-10-26: "setup reminders for her through email with her assistant
// reminding her to post etc."). The REAL sweep, its Supabase claim, fireReminder, store-assistant.ts, sendViaResend
// and the reminders route run here; only the database, Gemini, Resend and auth are faked. Resend's fake honours the
// Idempotency-Key header and stores one inbox message per (address, email id), which is what Resend inbound plus
// routes/email.ts's unique (mailbox_id, resend_id) do for crystal@imaginethisprinted.com. What must hold:
//   * a reminder fires at its Eastern time and lands in her inbox exactly once, however many ticks or replicas run;
//   * switching it off stops it (and switching it on again never mails a slot that already passed);
//   * a failed send is retried with the same email and key, so it still lands once.

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.GOOGLE_API_KEY = 'test-google-key'
process.env.RESEND_API_KEY = 'test-resend-key'

type Row = Record<string, any>
let db: Record<string, Row[]> = {}
let seq = 0
const UNIQUE: Record<string, string[]> = { vendor_store_reminder_sends: ['reminder_id', 'slot_at'] }
const DEFAULTS: Record<string, () => Row> = {
  vendor_store_reminder_sends: () => ({ status: 'claimed', attempts: 1, subject: null, body: null, written_by: null, resend_id: null, sent_at: null }),
  vendor_store_reminders: () => ({ enabled: true, note: null, sort: 0, armed_at: new Date().toISOString() }),
}

function from(table: string) {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: any
  let limit = Infinity
  const filters: Array<(r: Row) => boolean> = []
  const run = (): { data: any; error: any } => {
    const rows = (db[table] ||= [])
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...DEFAULTS[table]?.(), ...p }))
      const keys = UNIQUE[table]
      if (keys && list.some(row => rows.some(r => keys.every(k => r[k] === row[k])))) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
      }
      rows.push(...list)
      return { data: list.map(r => ({ ...r })), error: null }
    }
    const hit = rows.filter(r => filters.every(f => f(r)))
    if (op === 'update') {
      hit.forEach(r => Object.assign(r, payload))
      return { data: hit.map(r => ({ ...r })), error: null }
    }
    if (op === 'delete') {
      db[table] = rows.filter(r => !hit.includes(r))
      return { data: null, error: null }
    }
    return { data: hit.slice(0, limit).map(r => ({ ...r })), error: null }
  }
  const b: any = {
    select: () => b,
    insert: (p: any) => { op = 'insert'; payload = p; return b },
    update: (p: any) => { op = 'update'; payload = p; return b },
    delete: () => { op = 'delete'; return b },
    eq: (c: string, v: any) => { filters.push(r => r[c] === v); return b },
    in: (c: string, vs: any[]) => { filters.push(r => vs.includes(r[c])); return b },
    order: () => b,
    limit: (n: number) => { limit = n; return b },
    single: async () => {
      const { data, error } = run()
      return error ? { data: null, error } : data?.[0] ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } }
    },
    maybeSingle: async () => {
      const { data, error } = run()
      return { data: data?.[0] ?? null, error }
    },
    then: (ok: any, err: any) => Promise.resolve(run()).then(ok, err),
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => from(t) } }))
vi.mock('../middleware/supabaseAuth.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }))
vi.mock('../routes/vendor-store.js', () => ({
  requireStoreManager: (req: any, _res: any, next: any) => {
    req.vendorStore = { store: db.vendor_storefronts[0], isAdmin: false }
    next()
  },
}))

// --- Gemini and Resend, faked at the network ------------------------------------------------------------------
const geminiAsks: any[] = []
let geminiDown = false
let resendPlan: Array<'ok' | 'fail' | 'deliver-then-fail'> = []
const resendKeys = new Map<string, { id: string; body: string }>()
const resendCalls: Array<{ key: string | null }> = []
let inbox: Array<{ to: string; resendId: string; from: string; subject: string; text: string; html: string }> = []

const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url)
  if (u.includes('generativelanguage.googleapis.com')) {
    if (geminiDown) return new Response('quota exhausted', { status: 429 })
    const body = JSON.parse(init.body)
    geminiAsks.push(body)
    const ask = body.contents.at(-1).parts[0].text as string
    const reply = ask.includes('Instagram')
      ? 'Hi Crystal! Today, post your Gothic Ghost Face Candle Holder ($20.00) lit up at dusk.\n\nCaption: Spooky season glow. #candles #halloweendecor #crystalsshirtsandmore'
      : 'Hi Crystal! No new orders since yesterday. Share your candle holder in your stories today.'
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply }) }] } }] })
  }
  if (u === 'https://api.resend.com/emails') {
    const key = new Headers(init.headers).get('Idempotency-Key')
    resendCalls.push({ key })
    if (key && resendKeys.has(key)) {
      const prior = resendKeys.get(key)!
      if (prior.body !== init.body) return Response.json({ name: 'invalid_idempotent_request' }, { status: 409 })
      return Response.json({ id: prior.id })
    }
    const step = resendPlan.shift() ?? 'ok'
    if (step === 'fail') return Response.json({ message: 'Resend is having a moment' }, { status: 500 })
    const id = `re_${++seq}`
    if (key) resendKeys.set(key, { id, body: init.body })
    const msg = JSON.parse(init.body)
    for (const to of msg.to) {
      if (!inbox.some(m => m.to === to && m.resendId === id)) inbox.push({ to, resendId: id, from: msg.from, subject: msg.subject, text: msg.text, html: msg.html })
    }
    if (step === 'deliver-then-fail') return new Response('gateway timeout', { status: 504 })
    return Response.json({ id })
  }
  throw new Error(`unexpected fetch ${u}`)
}) as typeof fetch

const { sweepReminders, makeSupabaseReminderDeps } = await import('./store-reminders-sweep.js')
const { default: remindersRouter } = await import('../routes/vendor-store-reminders.js')

const CRYSTAL = 'crystal@imaginethisprinted.com'
const PERSONAL = 'crystal.personal@example.com'
const at = (iso: string) => vi.setSystemTime(new Date(iso))
const tick = () => sweepReminders(makeSupabaseReminderDeps())
const mail = (subject: string) => inbox.filter(m => m.to === CRYSTAL && m.subject === subject)
const POST_SUBJECT = 'Time to post on Instagram'
const reminder = (kind: string) => db.vendor_store_reminders.find(r => r.kind === kind)!

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
const api = async (method: string, path: string, body?: unknown) => {
  const res = await realFetch(`${base}/api/vendor-store/manage/crystal/reminders${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/vendor-store', remindersRouter)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server?.close()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-10-20T12:00:00Z')
  seq = 0
  geminiAsks.length = 0
  geminiDown = false
  resendPlan = []
  resendKeys.clear()
  resendCalls.length = 0
  inbox = []
  db = {
    // Like prod on 2026-10-26: she signs in with a personal address; her store inbox is crystal@ (task f4a337b0).
    vendor_storefronts: [{
      id: 'store-1', slug: 'crystal', name: 'Crystal’s Shirts and More', owner_email: PERSONAL, status: 'draft',
      theme: { ownerFirst: 'Crystal' }, fee_percent: 10, stripe_account_id: null, instagram: null, inbox_mailbox_id: 'mb-crystal',
    }],
    email_mailboxes: [{ id: 'mb-crystal', address: CRYSTAL, is_active: true }],
    vendor_store_items: [{
      id: 'item-1', storefront_id: 'store-1', product_id: '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3',
      name: 'Gothic Ghost Face Candle Holder', price_cents: 2000, itp_cost_cents: 1400, active: true, metadata: {},
    }],
    orders: [],
    vendor_store_assistant_memory: [{ storefront_id: 'store-1', fact: 'Crystal loves spooky season designs.' }],
    email_suppressions: [],
    // What the migration seeds (20261026213500_vendor_store_reminders.sql), switched on a week earlier.
    vendor_store_reminders: [
      { id: 'rem-ig', storefront_id: 'store-1', kind: 'instagram', title: 'Post on Instagram', note: null, days: [1, 3, 5], time_of_day: '10:00:00', enabled: true, armed_at: '2026-10-19T00:00:00Z', sort: 1 },
      { id: 'rem-orders', storefront_id: 'store-1', kind: 'orders', title: 'Check new orders', note: null, days: [0, 1, 2, 3, 4, 5, 6], time_of_day: '09:00:00', enabled: true, armed_at: '2026-10-19T00:00:00Z', sort: 2 },
      { id: 'rem-product', storefront_id: 'store-1', kind: 'product', title: 'Add a new product', note: null, days: [0], time_of_day: '10:00:00', enabled: true, armed_at: '2026-10-19T00:00:00Z', sort: 3 },
    ],
    vendor_store_reminder_sends: [],
  }
})

describe('reminders fire at their Eastern time and land in her inbox exactly once', () => {
  it('Monday: Check new orders at 9 AM, Post on Instagram at 10 AM, once each however often the clock ticks', async () => {
    at('2026-10-26T12:59:00Z') // 8:59 AM Eastern
    await tick()
    expect(inbox).toHaveLength(0)

    at('2026-10-26T13:00:20Z') // 9:00 AM
    await tick()
    expect(mail('Your orders check for Monday')).toHaveLength(1)
    expect(mail(POST_SUBJECT)).toHaveLength(0)

    at('2026-10-26T13:59:00Z') // 9:59 AM: not yet
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(0)

    at('2026-10-26T14:00:30Z') // 10:00 AM
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)

    // More ticks, then two worker replicas on the same tick: nobody sends either one again.
    for (const t of ['2026-10-26T14:05:00Z', '2026-10-26T14:10:00Z']) {
      at(t)
      await tick()
    }
    at('2026-10-26T14:15:00Z')
    await Promise.all([tick(), tick()])

    expect(mail(POST_SUBJECT)).toHaveLength(1)
    expect(mail('Your orders check for Monday')).toHaveLength(1)
    expect(inbox).toHaveLength(2) // Sunday's Add a new product slot was a day old: let go, not sent late
    expect(geminiAsks).toHaveLength(2)
    expect(db.vendor_store_reminder_sends.map(s => [s.reminder_id, s.slot_at, s.status])).toEqual([
      ['rem-orders', '2026-10-26T13:00:00.000Z', 'sent'],
      ['rem-ig', '2026-10-26T14:00:00.000Z', 'sent'],
    ])
  })

  it('is written fresh by her store assistant from her real products and memory, and comes from her assistant', async () => {
    at('2026-10-26T14:00:30Z')
    await tick()
    const post = mail(POST_SUBJECT)[0]
    expect(post.from).toBe('Your store assistant <assistant@imaginethisprinted.com>')
    expect(post.text).toContain('Gothic Ghost Face Candle Holder')
    expect(post.html).toContain('Post on Instagram')
    expect(post.html).toContain('Switch it off under Reminders')

    const ask = geminiAsks.find(a => a.contents.at(-1).parts[0].text.includes('Instagram'))
    const system = ask.systemInstruction.parts[0].text as string
    expect(system).toContain('store assistant')
    expect(system).toContain('Gothic Ghost Face Candle Holder')
    expect(system).toContain('Crystal loves spooky season designs.')
    expect(db.vendor_store_reminder_sends.find(s => s.reminder_id === 'rem-ig')).toMatchObject({ written_by: 'assistant', to_email: CRYSTAL })
  })
})

describe('switching a reminder off stops it', () => {
  it('off on her card: Wednesday sends nothing; back on at 10:30 never mails 10 AM late; Friday sends again', async () => {
    at('2026-10-26T14:00:30Z')
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)

    at('2026-10-27T15:00:00Z')
    const off = await api('PATCH', '/rem-ig', { enabled: false })
    expect(off.status).toBe(200)
    expect(off.body.reminder.enabled).toBe(false)

    at('2026-10-28T14:00:30Z') // Wednesday 10:00 AM
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)
    expect(mail('Your orders check for Wednesday')).toHaveLength(1) // the others keep going

    at('2026-10-28T14:30:00Z') // she switches it back on at 10:30
    await api('PATCH', '/rem-ig', { enabled: true })
    at('2026-10-28T14:35:00Z')
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)

    at('2026-10-30T14:00:30Z') // Friday 10:00 AM
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(2)
  })

  it('switched off between the sweep reading it and sending it: skipped, nothing sent', async () => {
    at('2026-10-26T14:00:30Z')
    const deps = makeSupabaseReminderDeps()
    const fetchEnabled = deps.fetchEnabled
    deps.fetchEnabled = async () => {
      const list = await fetchEnabled()
      reminder('instagram').enabled = false
      reminder('orders').enabled = false
      return list
    }
    await sweepReminders(deps)
    expect(inbox).toHaveLength(0)
    expect(geminiAsks).toHaveLength(0)
    expect(db.vendor_store_reminder_sends.map(s => [s.reminder_id, s.status, s.error])).toEqual([
      ['rem-ig', 'skipped', 'switched off'],
      ['rem-orders', 'skipped', 'switched off'],
    ])
  })
})

describe('when something goes wrong it still lands once', () => {
  it('Resend refuses: the next tick sends the same email and it lands once', async () => {
    resendPlan = ['fail']
    at('2026-10-26T14:00:30Z')
    reminder('orders').enabled = false
    await tick()
    expect(inbox).toHaveLength(0)
    expect(db.vendor_store_reminder_sends[0]).toMatchObject({ status: 'failed', attempts: 1 })

    at('2026-10-26T14:05:00Z')
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)
    expect(db.vendor_store_reminder_sends[0]).toMatchObject({ status: 'sent', attempts: 2 })
    expect(geminiAsks).toHaveLength(1) // written once, sent as written
  })

  it('Resend delivered but the answer was lost: the retry reuses the key and she still gets one email', async () => {
    resendPlan = ['deliver-then-fail']
    at('2026-10-26T14:00:30Z')
    reminder('orders').enabled = false
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)
    expect(db.vendor_store_reminder_sends[0].status).toBe('failed')

    at('2026-10-26T14:05:00Z')
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)
    expect(db.vendor_store_reminder_sends[0].status).toBe('sent')
    expect(resendCalls.map(c => c.key)).toEqual([
      'store-reminder-rem-ig-2026-10-26T14:00:00.000Z',
      'store-reminder-rem-ig-2026-10-26T14:00:00.000Z',
    ])
  })

  it('gives up on a slot after three failed tries', async () => {
    resendPlan = ['fail', 'fail', 'fail', 'ok']
    reminder('orders').enabled = false
    for (const t of ['14:00:30', '14:05:00', '14:10:00', '14:15:00', '14:20:00']) {
      at(`2026-10-26T${t}Z`)
      await tick()
    }
    expect(inbox).toHaveLength(0)
    expect(resendCalls).toHaveLength(3)
    expect(db.vendor_store_reminder_sends[0]).toMatchObject({ status: 'failed', attempts: 3 })
  })

  it('her assistant is down: the plain reminder still goes, once', async () => {
    geminiDown = true
    reminder('orders').enabled = false
    at('2026-10-26T14:00:30Z')
    await tick()
    at('2026-10-26T14:05:00Z')
    await tick()
    expect(mail(POST_SUBJECT)).toHaveLength(1)
    expect(mail(POST_SUBJECT)[0].text).toContain('time to post on Instagram')
    expect(db.vendor_store_reminder_sends[0]).toMatchObject({ status: 'sent', written_by: 'template' })
  })

  it('a suppressed address is never mailed', async () => {
    db.email_suppressions = [{ id: 's1', email: CRYSTAL, reason: 'hard_bounce', expires_at: null }]
    at('2026-10-26T14:00:30Z')
    await tick()
    expect(inbox).toHaveLength(0)
    expect(geminiAsks).toHaveLength(0)
    expect(db.vendor_store_reminder_sends.every(s => s.status === 'skipped' && s.error === 'suppressed (hard_bounce)')).toBe(true)
  })

  it('only ever mails her store inbox: never the personal address she signs in with', async () => {
    at('2026-10-26T14:00:30Z')
    await tick()
    expect(inbox.length).toBe(2)
    expect(inbox.every(m => m.to === CRYSTAL)).toBe(true)

    // No store inbox (or a switched-off one): skipped, and still nothing to her personal address.
    db.email_mailboxes[0].is_active = false
    at('2026-10-28T14:00:30Z')
    await tick()
    db.vendor_storefronts[0].inbox_mailbox_id = null
    at('2026-10-30T14:00:30Z')
    await tick()
    expect(inbox.filter(m => m.to === PERSONAL)).toHaveLength(0)
    expect(inbox).toHaveLength(2)
    expect(db.vendor_store_reminder_sends.filter(s => s.status === 'skipped').map(s => s.error)).toEqual(Array(4).fill('store has no inbox'))
    expect((await api('GET', '')).body.to).toBeNull()
  })

  it('a worker that was down at 10 AM does not mail it at 1 PM', async () => {
    at('2026-10-26T17:00:00Z') // 1 PM Eastern, three hours late
    await tick()
    expect(inbox).toHaveLength(0)
    expect(db.vendor_store_reminder_sends).toHaveLength(0)
  })
})

describe('her reminders card', () => {
  it('lists the three standing reminders with the schedules on the mock', async () => {
    const { status, body } = await api('GET', '')
    expect(status).toBe(200)
    expect(body.to).toBe(CRYSTAL)
    expect(body.reminders.map((r: any) => [r.title, r.schedule, r.enabled])).toEqual([
      ['Post on Instagram', 'Mon, Wed, Fri at 10 AM', true],
      ['Check new orders', 'Every day at 9 AM', true],
      ['Add a new product', 'Sundays at 10 AM', true],
    ])
  })

  it('Add a reminder makes one that fires; the standing ones switch off instead of deleting', async () => {
    at('2026-10-26T15:00:00Z')
    const added = await api('POST', '', { title: 'Restock the candle holders', days: [2], time: '18:30', note: 'craft fair Saturday' })
    expect(added.status).toBe(200)
    expect(added.body.reminder).toMatchObject({ kind: 'custom', schedule: 'Tuesdays at 6:30 PM', enabled: true })

    reminder('orders').enabled = false
    at('2026-10-27T22:30:10Z') // Tuesday 6:30 PM Eastern
    await tick()
    expect(mail('Restock the candle holders')).toHaveLength(1)
    expect(geminiAsks.at(-1).contents.at(-1).parts[0].text).toContain('"Restock the candle holders (craft fair Saturday)"')

    expect((await api('DELETE', '/rem-ig')).status).toBe(403)
    expect((await api('DELETE', `/${added.body.reminder.id}`)).status).toBe(200)
    expect((await api('POST', '', { title: 'x', days: [], time: '10:00' })).status).toBe(400)
    expect((await api('POST', '', { title: 'x', days: [1], time: '25:00' })).status).toBe(400)
  })
})
