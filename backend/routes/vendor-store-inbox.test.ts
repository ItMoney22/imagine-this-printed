import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// Crystal's store inbox (David 2026-10-26). Runs the REAL vendor-store router (so requireStoreManager and the
// store-owner claim run too) on an ephemeral port; only Supabase, auth, roles, Stripe, GCS and the Resend send
// are faked. What must hold:
//   * the store's owner and ITP admins read her mail; a manager, another seller or a shopper never do;
//   * the Inbox tab is her inbound mail, the Junk tab is what Jev filed (archived), never another mailbox's mail;
//   * opening a message as her clears its unread dot, an admin looking in does not;
//   * a reply goes out from her store address to the sender, threaded, and is kept;
//   * when she claims the store, the mailbox becomes hers.

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake'

const STORE_ID = 'store-1'
const BOX = 'box-crystal'
const OTHER_BOX = 'box-wecare'
const CRYSTAL = 'user-crystal'

let tables: Record<string, any[]> = {}
let nextId = 1

function builder(table: string) {
  let op = 'select'
  let payload: any
  let head = false
  const filters: [string, any][] = []
  const match = (r: any) => filters.every(([col, val]) => (Array.isArray(val) ? val.includes(r[col]) : r[col] === val))
  const result = (one: boolean) => {
    const rows = tables[table] ?? (tables[table] = [])
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((p: any) => ({ id: `row-${nextId++}`, ...p }))
      rows.push(...list)
      return { data: one ? list[0] : list, error: null }
    }
    if (op === 'update') {
      rows.filter(match).forEach(r => Object.assign(r, payload))
      return { data: null, error: null }
    }
    const found = rows.filter(match)
    if (head) return { data: null, count: found.length, error: null }
    return one ? { data: found[0] ?? null, error: null } : { data: found, error: null }
  }
  const b: any = {
    select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b },
    insert: (p: any) => { op = 'insert'; payload = p; return b },
    update: (p: any) => { op = 'update'; payload = p; return b },
    eq: (col: string, val: any) => { filters.push([col, val]); return b },
    in: (col: string, vals: any[]) => { filters.push([col, vals]); return b },
    ilike: (col: string, val: string) => { filters.push([col, val.toLowerCase()]); return b },
    is: () => b,
    or: () => b,
    order: () => b,
    limit: () => b,
    single: async () => result(true),
    maybeSingle: async () => result(true),
    then: (ok: any, err: any) => Promise.resolve(result(false)).then(ok, err),
  }
  return b
}

const confirmed = new Set<string>()
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (t: string) => builder(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email_confirmed_at: confirmed.has(id) ? '2026-10-26T00:00:00Z' : null } } }) } },
  },
}))

// Who is signed in: the x-test-user header (id|email).
vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const h = req.header('x-test-user')
    if (!h) return res.status(401).json({ error: 'sign in' })
    const [sub, email] = h.split('|')
    req.user = { sub, email }
    next()
  },
}))
const roles: Record<string, string> = {}
vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async (id: string) => roles[id] ?? null }))
vi.mock('../services/google-cloud-storage.js', () => ({ uploadImageFromBuffer: async () => ({ publicUrl: '', path: '' }) }))
vi.mock('../services/print-files.js', () => ({ getPrintFileRefsFor: async () => ({}) }))
vi.mock('stripe', () => ({ default: class { accounts = { retrieve: async (id: string) => ({ id, capabilities: {} }) } } }))
const sent: any[] = []
vi.mock('../services/email-resend.js', () => ({
  sendViaResend: async (p: any) => { sent.push(p); return { id: `re_${sent.length}` } },
}))

const { default: router } = await import('./vendor-store.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/vendor-store', router)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close() })

const msg = (over: Record<string, any>) => ({
  mailbox_id: BOX, direction: 'inbound', message_id: null, from_name: '', to_addresses: ['crystal@imaginethisprinted.com'],
  text_body: null, html_body: null, attachments: [], is_read: false, is_archived: false, created_at: '2026-10-26T15:00:00Z', ...over,
})

beforeEach(() => {
  sent.length = 0
  confirmed.clear()
  for (const k of Object.keys(roles)) delete roles[k]
  roles[CRYSTAL] = 'vendor'
  roles['user-david'] = 'admin'
  roles['user-manager'] = 'manager'
  roles['user-other-seller'] = 'vendor'
  roles['user-shopper'] = 'customer'
  tables = {
    vendor_storefronts: [{
      id: STORE_ID, slug: 'crystal', name: 'Crystal’s Shirts and More', status: 'draft', fee_percent: 10, theme: {},
      owner_user_id: CRYSTAL, owner_email: 'crystal@imaginethisprinted.com', inbox_mailbox_id: BOX,
    }],
    email_mailboxes: [
      { id: BOX, address: 'crystal@imaginethisprinted.com', display_name: 'Crystal’s Shirts and More', is_active: true, user_id: CRYSTAL },
      { id: OTHER_BOX, address: 'wecare@imaginethisprinted.com', display_name: 'Customer Care', is_active: true, user_id: null },
    ],
    email_messages: [
      msg({ id: 'm-order', from_address: 'bella@example.com', from_name: 'Bella', subject: 'Size question', message_id: '<q1@example.com>',
        text_body: 'Hi Crystal,\nDoes the tee run small?\n> quoted old line\nhttps://example.com/x', created_at: '2026-10-26T15:10:00Z' }),
      msg({ id: 'm-read', from_address: 'sam@example.com', subject: 'Thanks!', is_read: true, created_at: '2026-10-26T14:00:00Z' }),
      msg({ id: 'm-spam', from_address: 'seo@growth.biz', subject: 'Rank #1 on Google', is_archived: true, is_read: true }),
      msg({ id: 'm-wecare', mailbox_id: OTHER_BOX, from_address: 'customer@example.com', subject: 'Company mail' }),
    ],
  }
})

const as = (user: string, path = '', init: RequestInit = {}) =>
  fetch(`${base}/api/vendor-store/manage/crystal/inbox${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-test-user': user, ...(init.headers || {}) },
  })
const crystal = `${CRYSTAL}|crystal@imaginethisprinted.com`
const david = 'user-david|david@example.com'

describe('store inbox: who can read it', () => {
  it('shows her her own mail: inbox first, newest first, with the unread and junk counts', async () => {
    const res = await as(crystal)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.address).toBe('crystal@imaginethisprinted.com')
    expect(body.messages.map((m: any) => m.id)).toEqual(['m-order', 'm-read'])
    expect(body.unread).toBe(1)
    expect(body.junk).toBe(1)
    expect(body.messages[0]).toMatchObject({ fromName: 'Bella', subject: 'Size question', read: false, preview: 'Hi Crystal, Does the tee run small?' })
  })

  it('keeps Jev’s junk in its own tab', async () => {
    const body = await (await as(crystal, '?folder=junk')).json()
    expect(body.folder).toBe('junk')
    expect(body.messages.map((m: any) => m.id)).toEqual(['m-spam'])
  })

  it('lets an ITP admin read it', async () => {
    expect((await as(david)).status).toBe(200)
  })

  it('refuses a manager, another seller, a shopper and a signed-out visitor', async () => {
    for (const who of ['user-manager|m@example.com', 'user-other-seller|o@example.com', 'user-shopper|s@example.com']) {
      const res = await as(who)
      expect(res.status, who).toBe(403)
      expect(JSON.stringify(await res.json())).not.toContain('Size question')
    }
    expect((await fetch(`${base}/api/vendor-store/manage/crystal/inbox`)).status).toBe(401)
    expect((await as('user-manager|m@example.com', '/m-order')).status).toBe(403)
  })

  it('never opens a message from another mailbox through her store', async () => {
    expect((await as(crystal, '/m-wecare')).status).toBe(404)
    expect((await as(david, '/m-wecare')).status).toBe(404)
  })
})

describe('store inbox: open, reply, junk', () => {
  it('clears the unread dot when she opens it, not when an admin looks', async () => {
    const byAdmin = await (await as(david, '/m-order')).json()
    expect(byAdmin.message.subject).toBe('Size question')
    expect(tables.email_messages.find(m => m.id === 'm-order').is_read).toBe(false)
    await as(crystal, '/m-order')
    expect(tables.email_messages.find(m => m.id === 'm-order').is_read).toBe(true)
  })

  it('sends her reply from the store address to the sender, threaded, and keeps it', async () => {
    const res = await as(crystal, '/m-order/reply', { method: 'POST', body: JSON.stringify({ text: 'It runs true to size!' }) })
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      from: '"Crystal’s Shirts and More" <crystal@imaginethisprinted.com>',
      to: ['bella@example.com'],
      subject: 'Re: Size question',
      headers: { 'In-Reply-To': '<q1@example.com>', References: '<q1@example.com>' },
    })
    expect(sent[0].text).toContain('It runs true to size!')
    expect(sent[0].text).toContain('> Does the tee run small?')
    const stored = tables.email_messages.find(m => m.direction === 'outbound')
    expect(stored).toMatchObject({ mailbox_id: BOX, in_reply_to: '<q1@example.com>', text_body: 'It runs true to size!', resend_id: 're_1' })
    const opened = await (await as(crystal, '/m-order')).json()
    expect(opened.replies.map((r: any) => r.text)).toEqual(['It runs true to size!'])
  })

  it('will not answer junk or an empty reply', async () => {
    expect((await as(crystal, '/m-spam/reply', { method: 'POST', body: JSON.stringify({ text: 'hi' }) })).status).toBe(400)
    expect((await as(crystal, '/m-order/reply', { method: 'POST', body: JSON.stringify({ text: '  ' }) })).status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it('moves a message out of junk and back', async () => {
    expect((await as(crystal, '/m-spam', { method: 'PATCH', body: JSON.stringify({ junk: false }) })).status).toBe(200)
    expect(tables.email_messages.find(m => m.id === 'm-spam').is_archived).toBe(false)
    expect((await as(crystal, '/m-spam', { method: 'PATCH', body: JSON.stringify({ junk: true }) })).status).toBe(200)
    expect(tables.email_messages.find(m => m.id === 'm-spam').is_archived).toBe(true)
    expect((await as(crystal, '/m-wecare', { method: 'PATCH', body: JSON.stringify({ junk: true }) })).status).toBe(404)
  })

  it('shows an empty inbox for a store with no mailbox yet', async () => {
    tables.vendor_storefronts[0].inbox_mailbox_id = null
    const body = await (await as(crystal)).json()
    expect(body).toMatchObject({ address: null, messages: [] })
  })
})

describe('store inbox: the mailbox follows the store owner', () => {
  it('becomes hers when she claims the store with her confirmed store email', async () => {
    tables.vendor_storefronts[0].owner_user_id = null
    tables.email_mailboxes[0].user_id = null
    roles['user-new'] = 'customer'
    confirmed.add('user-new')
    const res = await as('user-new|Crystal@imaginethisprinted.com')
    expect(res.status).toBe(200)
    expect(tables.vendor_storefronts[0].owner_user_id).toBe('user-new')
    expect(tables.email_mailboxes[0].user_id).toBe('user-new')
    expect(tables.email_mailboxes[1].user_id).toBe(null)
  })

  it('does not hand the mailbox over on an unconfirmed address', async () => {
    tables.vendor_storefronts[0].owner_user_id = null
    tables.email_mailboxes[0].user_id = null
    roles['user-new'] = 'customer'
    expect((await as('user-new|crystal@imaginethisprinted.com')).status).toBe(403)
    expect(tables.email_mailboxes[0].user_id).toBe(null)
  })

  it('moves with the owner when an admin changes it', async () => {
    tables.user_profiles = [{ id: 'user-personal', role: 'customer', email: 'crystal.personal@example.com' }]
    const res = await fetch(`${base}/api/vendor-store/manage/crystal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-user': david },
      body: JSON.stringify({ ownerEmail: 'crystal.personal@example.com' }),
    })
    expect(res.status).toBe(200)
    expect(tables.email_mailboxes[0].user_id).toBe('user-personal')
  })
})
