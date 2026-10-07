import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

// Drives the REAL POST /api/support/tickets handler (DB, mail and Jev faked) to
// prove the contact form's human check: once TURNSTILE_SECRET_KEY is set, a
// post without a valid token is refused with a visible 400; bot-shaped posts
// still take the quiet spam path; a person with a valid token gets a ticket,
// an admin notification and the alert email.

const db = vi.hoisted(() => ({ inserts: [] as Array<{ table: string; row: Record<string, any> }> }))
const mail = vi.hoisted(() => ({ confirm: vi.fn(async () => {}), alert: vi.fn(async () => {}) }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const b: any = {
        insert(row: Record<string, any>) {
          db.inserts.push({ table, row })
          const done = { data: { id: 'ticket-1', ...row }, error: null }
          return { select: () => ({ single: async () => done }), then: (r: (v: any) => void) => r({ error: null }) }
        },
      }
      return b
    },
  }),
}))
vi.mock('../utils/email.js', () => ({ sendTicketConfirmationEmail: mail.confirm, sendNewSupportTicketEmail: mail.alert }))
vi.mock('../lib/jev-triage.js', async (orig) => ({
  ...(await orig<typeof import('../lib/jev-triage.js')>()),
  triageTicket: async () => ({ category: 'wrong_or_damaged', priority: 'high', dbPriority: 'high', needsReview: false, categorySource: 'jev', prioritySource: 'jev', floor: { rules: [] }, mode: 'on' }),
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const { default: router } = await import('./support.js')

const realFetch = globalThis.fetch
let base = ''
let server: ReturnType<express.Express['listen']>
beforeAll(async () => {
  const app = express()
  app.set('trust proxy', true)
  app.use(express.json())
  app.use('/api/support', router)
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close(); globalThis.fetch = realFetch; delete process.env.TURNSTILE_SECRET_KEY })

// Cloudflare's siteverify answers "good-token" only; everything else goes to the real fetch (our test server).
const siteverify = vi.fn()
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).includes('challenges.cloudflare.com')) {
    siteverify(Object.fromEntries(init.body))
    const ok = init.body.get('response') === 'good-token'
    return { ok: true, status: 200, json: async () => ({ success: ok, 'error-codes': ok ? [] : ['invalid-input-response'] }) }
  }
  return realFetch(url, init)
}) as typeof fetch

let ip = 0
async function post(body: Record<string, unknown>) {
  // A fresh client IP per post so the 5-per-hour limiter never interferes.
  const res = await realFetch(`${base}/api/support/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

const person = { name: 'Jane Doe', email: 'jane@example.com', subject: 'Print peeling', description: 'My hoodie print is peeling after one wash.' }
const bot = { name: 'QwErTy', email: 'x@example.com', subject: 'IBBemvLcPW', description: 'Ie9G7TNF63cx1poUIZIJbSmRG5R3nDXukB4Xj38vzVI88eCnHQxKvO8', order_id: '0wvd4Ok9Wn' }
const tickets = () => db.inserts.filter((i) => i.table === 'support_tickets').map((i) => i.row)
const notes = () => db.inserts.filter((i) => i.table === 'admin_notifications')

describe('contact form human check (Turnstile)', () => {
  beforeEach(() => {
    db.inserts.length = 0
    mail.confirm.mockClear()
    mail.alert.mockClear()
    siteverify.mockClear()
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
  })

  it('refuses a post with no token, visibly, and stores nothing', async () => {
    const r = await post(person)
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/security check/)
    expect(tickets()).toHaveLength(0)
    expect(mail.alert).not.toHaveBeenCalled()
  })

  it('refuses a forged token', async () => {
    const r = await post({ ...person, captchaToken: 'forged' })
    expect(r.status).toBe(400)
    expect(siteverify).toHaveBeenCalledWith(expect.objectContaining({ secret: 'test-secret', response: 'forged' }))
    expect(tickets()).toHaveLength(0)
  })

  it('a person with a valid token reaches the team: open ticket, admin notification, alert email', async () => {
    const r = await post({ ...person, captchaToken: 'good-token' })
    expect(r.status).toBe(201)
    expect(r.json.ticketId).toBe('ticket-1')
    expect(tickets()[0]).toMatchObject({ status: 'open', category: 'wrong_or_damaged' })
    expect(notes()).toHaveLength(1)
    expect(mail.alert).toHaveBeenCalledTimes(1)
  })

  it('a bot-shaped post is still filed quietly (closed spam, no alert), token or not', async () => {
    const r = await post(bot)
    expect(r.status).toBe(201)
    expect(tickets()[0]).toMatchObject({ status: 'closed', category: 'spam' })
    expect(notes()).toHaveLength(0)
    expect(mail.alert).not.toHaveBeenCalled()
    expect(mail.confirm).not.toHaveBeenCalled()
  })

  it('without a secret configured the form works exactly as before', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const r = await post(person)
    expect(r.status).toBe(201)
    expect(siteverify).not.toHaveBeenCalled()
  })
})
