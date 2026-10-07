import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

// Drives the REAL /api/email/webhooks/resend handler (signature check stubbed,
// DB faked) to prove how inbound mail is filed: spam is stored archived and not
// forwarded, a sender flood is stored but not forwarded, ordinary mail is
// forwarded to the mailbox owner's phone as before.

const db = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, any>>,
  recentFromSender: 0,
}))
const triageEmails = vi.hoisted(() => vi.fn())
const sendViaResend = vi.hoisted(() => vi.fn(async () => ({ id: 'sent' })))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      let head = false
      const b: any = {
        select(_c?: string, opts?: { head?: boolean }) { head = !!opts?.head; return b },
        in() { return b },
        eq() { return b },
        gte() { return b },
        insert: async (row: Record<string, any>) => { db.inserts.push(row); return { error: null } },
        then(resolve: (v: any) => void) {
          if (table === 'email_mailboxes') {
            resolve({ data: [{ id: 'mb1', address: 'wecare@imaginethisprinted.com', display_name: 'We Care', forward_to: 'owner@example.com' }], error: null })
          } else if (table === 'email_messages' && head) {
            resolve({ count: db.recentFromSender, error: null })
          } else resolve({ data: [], error: null })
        },
      }
      return b
    },
  }),
}))
vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../services/gcs-storage.js', () => ({ uploadFile: vi.fn() }))
vi.mock('../services/email-suppression.js', () => ({ listSuppressions: vi.fn(), recordSuppression: vi.fn() }))
vi.mock('../services/email-resend.js', async (orig) => ({
  ...(await orig<typeof import('../services/email-resend.js')>()),
  verifyResendWebhook: () => true,
  fetchReceivedEmail: async () => null,
  fetchReceivedAttachments: async () => [],
  sendViaResend,
}))
vi.mock('../lib/jev-triage.js', async (orig) => ({
  ...(await orig<typeof import('../lib/jev-triage.js')>()),
  triageEmails,
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const { default: router } = await import('./email.js')

let base = ''
let server: ReturnType<express.Express['listen']>
beforeAll(async () => {
  const app = express()
  app.use('/api/email/webhooks/resend', express.raw({ type: 'application/json' }))
  app.use(express.json())
  app.use('/api/email', router)
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server?.close())

const triageAs = (label: string | null, confidence: number) =>
  triageEmails.mockImplementation(async (emails: Array<{ id: string }>) =>
    new Map(emails.map((e) => [e.id, { id: e.id, label, jev: { label: { choice: label ?? 'spam', confidence } } }])))

async function receive(from: string, subject: string) {
  const res = await fetch(`${base}/api/email/webhooks/resend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'email.received', data: { email_id: `em-${Math.random()}`, from, to: ['wecare@imaginethisprinted.com'], subject, text: 'body' } }),
  })
  return { status: res.status, json: await res.json() }
}

describe('Resend inbound webhook filing', () => {
  beforeEach(() => {
    db.inserts.length = 0
    db.recentFromSender = 0
    sendViaResend.mockClear()
    triageEmails.mockReset()
  })

  it('forwards an ordinary customer email to the owner', async () => {
    triageAs('customer_issue', 0.95)
    const r = await receive('Jane Doe <jane@example.com>', 'Where is my order?')
    expect(r.json).toMatchObject({ received: true, matched: 1, filed: 'ok' })
    expect(db.inserts[0].is_archived).toBeUndefined()
    expect(sendViaResend).toHaveBeenCalledTimes(1)
  })

  it('files confident spam quietly: stored archived + read, not forwarded', async () => {
    triageAs('spam', 0.95)
    const r = await receive('SEO Pros <leads@seo.example>', 'Page 1 of Google in 30 days')
    expect(r.json).toMatchObject({ matched: 1, filed: 'spam' })
    expect(db.inserts[0]).toMatchObject({ status: 'received', is_archived: true, is_read: true })
    expect(sendViaResend).not.toHaveBeenCalled()
  })

  it('stops forwarding a sender who floods the inbox, but keeps the mail in view', async () => {
    triageAs('customer_issue', 0.9)
    db.recentFromSender = 5
    const r = await receive('flood@example.com', 'again')
    expect(r.json).toMatchObject({ matched: 1, filed: 'sender_flood' })
    expect(db.inserts[0].is_archived).toBeUndefined()
    expect(sendViaResend).not.toHaveBeenCalled()
  })

  it('skips Jev and the throttle for our own system mail', async () => {
    const r = await receive('wecare@imaginethisprinted.com', 'New Support Ticket [HIGH]: x')
    expect(r.json).toMatchObject({ matched: 1, filed: 'ok' })
    expect(triageEmails).not.toHaveBeenCalled()
  })

  it('forwards when Jev is down', async () => {
    triageEmails.mockRejectedValue(new Error('lane down'))
    const r = await receive('jane@example.com', 'hello')
    expect(r.json).toMatchObject({ filed: 'ok' })
    expect(sendViaResend).toHaveBeenCalledTimes(1)
  })
})
