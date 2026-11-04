import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

// Drives the REAL POST /api/support/tickets handler and the REAL alert email
// (DB, Resend, suppression list and Jev faked) to prove who hears about a new
// ticket (task 71164456): a bulk_quote (12+ shirts, team, event) goes to the
// support inbox AND to BULK_QUOTE_ALERT_EMAIL (default davidt@); any other
// ticket goes to the support inbox only; a failed alert never fails the customer.

const db = vi.hoisted(() => ({ inserts: [] as Array<{ table: string; row: Record<string, any> }> }))
const sent = vi.hoisted(() => [] as Array<{ to: string[]; subject: string }>)
const triage = vi.hoisted(() => ({ category: 'bulk_quote' as string }))
const suppression = vi.hoisted(() => ({ throwFor: '' }))
const ping = vi.hoisted(() => vi.fn(async () => {}))

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
vi.mock('../services/email-resend.js', () => ({
  sendViaResend: async (msg: { to: string[]; subject: string }) => {
    sent.push({ to: msg.to, subject: msg.subject })
    return { id: `resend-${sent.length}` }
  },
}))
vi.mock('../services/email-suppression.js', () => ({
  getSuppression: async (to: string) => {
    if (suppression.throwFor && to === suppression.throwFor) throw new Error('suppression lookup down')
    return null
  },
}))
vi.mock('../services/support-ping.js', async (orig) => ({
  ...(await orig<typeof import('../services/support-ping.js')>()),
  pingChristinaAboutTicket: ping,
}))
vi.mock('../lib/jev-triage.js', async (orig) => ({
  ...(await orig<typeof import('../lib/jev-triage.js')>()),
  triageTicket: async () => ({
    category: triage.category, priority: 'high', dbPriority: 'high', needsReview: false,
    categorySource: 'jev', prioritySource: 'jev', floor: { rules: [] }, mode: 'on',
  }),
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.RESEND_API_KEY = 'test-resend-key'
delete process.env.SUPPORT_EMAIL
delete process.env.BULK_QUOTE_ALERT_EMAIL
delete process.env.TURNSTILE_SECRET_KEY
const { default: router, bulkQuoteAlertRecipients } = await import('./support.js')

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
afterAll(() => { server?.close(); delete process.env.BULK_QUOTE_ALERT_EMAIL })

let ip = 0
async function post(body: Record<string, unknown>) {
  // A fresh client IP per post so the 5-per-hour limiter never interferes.
  const res = await fetch(`${base}/api/support/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${++ip}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

const teamQuote = {
  name: 'Coach Rivera',
  email: 'coach@example.com',
  subject: 'Team shirts for our rec league',
  description: 'We need 18 shirts for our softball team with names and numbers on the back. Can you send a price?',
}
const general = { name: 'Jane Doe', email: 'jane@example.com', subject: 'Order question', description: 'When will my hoodie ship?' }

// Only the staff alerts; the customer's own confirmation also goes through Resend.
const alertsTo = () => sent.filter((m) => m.subject.includes('New Support Ticket')).map((m) => m.to.join(','))

describe('new-ticket alert recipients (bulk quotes reach David)', () => {
  beforeEach(() => {
    db.inserts.length = 0
    sent.length = 0
    ping.mockClear()
    suppression.throwFor = ''
    triage.category = 'bulk_quote'
    delete process.env.BULK_QUOTE_ALERT_EMAIL
  })

  it('a bulk_quote ticket alerts the support inbox AND davidt@ by default', async () => {
    const r = await post(teamQuote)
    expect(r.status).toBe(201)
    expect(alertsTo()).toEqual(['wecare@imaginethisprinted.com', 'davidt@imaginethisprinted.com'])
    // Customer still gets their confirmation, Christina still gets her ping.
    expect(sent.some((m) => m.to.includes('coach@example.com'))).toBe(true)
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('a general ticket alerts the support inbox only', async () => {
    triage.category = 'general'
    const r = await post(general)
    expect(r.status).toBe(201)
    expect(alertsTo()).toEqual(['wecare@imaginethisprinted.com'])
  })

  it('BULK_QUOTE_ALERT_EMAIL takes several addresses and never doubles the support inbox', async () => {
    process.env.BULK_QUOTE_ALERT_EMAIL = ' Owner@Example.com, wecare@imaginethisprinted.com,owner@example.com , sales@example.com'
    const r = await post(teamQuote)
    expect(r.status).toBe(201)
    expect(alertsTo()).toEqual(['wecare@imaginethisprinted.com', 'owner@example.com', 'sales@example.com'])
  })

  it('a failed bulk quote alert never fails the customer, and the ping still goes', async () => {
    suppression.throwFor = 'davidt@imaginethisprinted.com'
    const r = await post(teamQuote)
    expect(r.status).toBe(201)
    expect(r.json.ticketId).toBe('ticket-1')
    expect(alertsTo()).toEqual(['wecare@imaginethisprinted.com'])
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('recipients helper: default, blank entries dropped', () => {
    expect(bulkQuoteAlertRecipients()).toEqual(['davidt@imaginethisprinted.com'])
    process.env.BULK_QUOTE_ALERT_EMAIL = ' , ,'
    expect(bulkQuoteAlertRecipients()).toEqual([])
  })
})
