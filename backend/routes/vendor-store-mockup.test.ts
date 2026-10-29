import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// Her assistant's mockups (task 820ff916, David 2026-10-29: "crystal gives him a image says mock this on a shirt he does
// it he comes up in a lightbox"). Runs the REAL router on an ephemeral port over a small stateful Supabase fake; the
// brain, the render, GCS and the ITC ledger are faked. What must hold:
//   * "mock this on a shirt" with a picture offers a mockup whose price the reply states, and charges nothing yet;
//   * pressing it charges the stated price once (a double tap never twice), and its picture lands as its own reply;
//   * not enough credits = refused before any render; a failed render hands the credits back.

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake'

const STORE_ID = 'store-1'
let tables: Record<string, any[]> = {}
let nextId = 1

// A JSON path filter ('mockup->>status') reads inside the row's JSON, the way PostgREST does.
const cell = (row: any, col: string) => {
  const [c, key] = col.split('->>')
  return key ? row[c]?.[key] : row[c]
}
function builder(table: string) {
  let op = 'select'
  let payload: any
  const filters: [string, any][] = []
  const matched = () => (tables[table] ??= []).filter(r => filters.every(([c, v]) => (Array.isArray(v) ? v.includes(cell(r, c)) : cell(r, c) === v)))
  const result = (one: boolean) => {
    let rows: any[]
    if (op === 'insert') {
      rows = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: `row-${nextId++}`, created_at: new Date().toISOString(), ...p }))
      tables[table] = [...(tables[table] ?? []), ...rows]
    } else if (op === 'update') {
      rows = matched()
      rows.forEach(r => Object.assign(r, payload))
    } else rows = matched()
    rows = rows.map(r => JSON.parse(JSON.stringify(r)))
    return one ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
  }
  const b: any = {
    select: () => b,
    insert: (p: any) => { op = 'insert'; payload = p; return b },
    update: (p: any) => { op = 'update'; payload = p; return b },
    eq: (c: string, v: any) => { filters.push([c, v]); return b },
    in: (c: string, v: any[]) => { filters.push([c, v]); return b },
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

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => builder(t) } }))
vi.mock('../middleware/supabaseAuth.js', () => ({ requireAuth: (q: any, _s: any, n: any) => { q.user = { id: 'crystal-user', sub: 'crystal-user' }; n() } }))
vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async () => 'vendor', invalidateCachedRole: () => {} }))
let brainAnswer: any = null
const brainCalls: any[] = []
vi.mock('../services/store-assistant.js', () => ({ askStoreAssistant: async (...a: any[]) => { brainCalls.push(a); return brainAnswer } }))
vi.mock('../services/google-cloud-storage.js', () => ({ uploadImageFromBuffer: async () => ({ publicUrl: '', path: '' }), getSignedUrl: async () => '' }))
vi.mock('../services/print-files.js', () => ({ getPrintFileRefsFor: async () => ({}) }))
vi.mock('stripe', () => ({ default: class { accounts = { retrieve: async (id: string) => ({ id, capabilities: { transfers: 'active' } }) } } }))

const ledger: Array<{ kind: 'deduct' | 'refund'; uid: string; amount: number; reason: string }> = []
vi.mock('../services/imagination-pricing.js', () => ({
  pricingService: {
    deductITC: async (uid: string, amount: number, reason: string) => { ledger.push({ kind: 'deduct', uid, amount, reason }) },
    refundITC: async (uid: string, amount: number, reason: string) => { ledger.push({ kind: 'refund', uid, amount, reason }) },
  },
}))
const renders: any[] = []
let renderFails = false
let releaseRender: () => void = () => {}
vi.mock('../services/store-mockup.js', () => ({
  mockupPriceItc: async () => 15,
  renderStoreMockup: async (opts: any) => {
    renders.push(opts)
    await new Promise<void>(r => { releaseRender = r })
    await opts.onStage?.('Putting your picture on it…')
    if (renderFails) throw new Error('flux said no')
    return { path: 'products/vendor-stores/crystal/assistant/mockups/m0ck.png', color: opts.choice.color ?? 'white', modelId: 'x', qaOk: true }
  },
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
afterAll(() => server?.close())

const PICTURE = 'https://api.imaginethisprinted.com/api/media/products/vendor-stores/crystal/assistant/abcdefabcdef.png'
beforeEach(() => {
  nextId = 1
  ledger.length = 0
  renders.length = 0
  brainCalls.length = 0
  renderFails = false
  brainAnswer = { heard: null, reply: 'Wepa, that would look brutal on a tee!', remember: [], makeProduct: true, request: null, mockup: null, usage: null }
  tables = {
    vendor_storefronts: [{ id: STORE_ID, slug: 'crystal', name: 'Crystal’s Shirts and More', status: 'draft', fee_percent: 10, owner_user_id: 'crystal-user', stripe_account_id: null, theme: { ownerFirst: 'Crystal', assistantName: 'Rico' } }],
    vendor_store_items: [],
    user_wallets: [{ user_id: 'crystal-user', itc_balance: 40 }],
    vendor_store_assistant_messages: [],
  }
})

const manage = (path: string, init?: RequestInit) => fetch(`${base}/api/vendor-store/manage/crystal${path}`, init)
const say = async (text: string, picture?: Buffer) => {
  const form = new FormData()
  form.append('text', text)
  if (picture) form.append('image', new Blob([picture], { type: 'image/png' }), 'design.png')
  return manage('/assistant', { method: 'POST', body: form })
}
const png = async () => (await import('sharp')).default({ create: { width: 800, height: 800, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 0 } } }).png().toBuffer()
const poll = async (id: string) => {
  for (let i = 0; i < 50; i++) {
    const body = await (await manage(`/assistant/mockup/${id}`)).json()
    if (body.message.mockup.status !== 'rendering') return body
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('never finished')
}
/** Seeds a reply that offered a mockup of her saved picture, the way a turn leaves it. */
const offered = (over: Record<string, any> = {}) => {
  const row = { id: 'offer-1', storefront_id: STORE_ID, role: 'assistant', text: 'Dale!', image_url: null, created_at: '2026-10-29T15:00:01Z',
    mockup: { product: 'tshirt', color: 'black', size: null, status: 'offered', sourceUrl: PICTURE, priceItc: 15, ...over } }
  tables.vendor_store_assistant_messages.push(row)
  return row
}

describe('store assistant: "mock this on a shirt"', () => {
  it('offers a mockup of the picture she sent, states its price, and charges nothing yet', async () => {
    // The brain did not set a mockup: her words alone are enough.
    const res = await say('mock this on a shirt', await png())
    expect(res.status).toBe(200)
    const body = await res.json()
    const [, reply] = body.messages
    expect(reply.mockup).toEqual({ status: 'offered', label: 'tee', priceItc: 15 })
    expect(reply.text).toMatch(/15 ITC/)
    expect(reply.makeProduct).toBe(false) // one next button: the mockup
    const saved = tables.vendor_store_assistant_messages.find(r => r.role === 'assistant')!
    expect(saved.mockup).toMatchObject({ product: 'tshirt', status: 'offered', priceItc: 15, sourceUrl: body.imageUrl })
    expect(ledger).toEqual([])
    expect(renders).toEqual([])
    // Rico knew the price, her balance and that a picture is there.
    expect(brainCalls[0][0].mockup).toEqual({ priceItc: 15, balanceItc: 40, picture: true })
  })

  it('takes the product and colour the brain picked, and keeps a reply that already states the price', async () => {
    brainAnswer = { ...brainAnswer, reply: 'A hoodie mockup is 15 ITC, jefa. Press Make the mockup.', mockup: { product: 'hoodie', color: 'navy', size: null } }
    const body = await (await say('ponlo en una sudadera azul marino', await png())).json()
    expect(body.messages[1].text).toBe('A hoodie mockup is 15 ITC, jefa. Press Make the mockup.')
    expect(body.messages[1].mockup.label).toBe('navy hoodie')
  })

  it('"now on a hoodie" with nothing attached uses the last picture in the chat; with no picture there is no offer', async () => {
    expect((await (await say('mock this on a shirt')).json()).messages[1].mockup).toBeUndefined()
    tables.vendor_store_assistant_messages.push({ id: 'p1', storefront_id: STORE_ID, role: 'user', text: '', image_url: PICTURE, created_at: '2026-10-29T14:00:00Z' })
    const body = await (await say('now mock it on a hoodie')).json()
    expect(body.messages[1].mockup).toEqual({ status: 'offered', label: 'hoodie', priceItc: 15 })
    expect(tables.vendor_store_assistant_messages.at(-1)!.mockup.sourceUrl).toBe(PICTURE)
  })
})

describe('store assistant: Make the mockup', () => {
  it('charges the stated price once, renders her picture, and lands it as its own reply', async () => {
    offered()
    const press = () => manage('/assistant/mockup/offer-1', { method: 'POST' })
    const res = await press()
    expect(res.status).toBe(202)
    expect((await res.json()).message.mockup).toMatchObject({ status: 'rendering', stage: 'Getting it ready…', label: 'black tee' })
    // A second tap while it renders is the same mockup, not a second charge.
    expect((await (await press()).json()).message.mockup.status).toBe('rendering')
    expect(ledger).toEqual([{ kind: 'deduct', uid: 'crystal-user', amount: 15, reason: 'assistant_mockup' }])
    expect(renders).toHaveLength(1)
    expect(renders[0]).toMatchObject({ slug: 'crystal', designUrl: PICTURE, choice: { product: 'tshirt', color: 'black', size: null } })

    releaseRender()
    const { message, result } = await poll('offer-1')
    expect(message.mockup).toMatchObject({ status: 'done', resultId: result.id })
    expect(result).toMatchObject({
      role: 'assistant',
      imageUrl: 'https://api.imaginethisprinted.com/api/media/products/vendor-stores/crystal/assistant/mockups/m0ck.png',
      makeProduct: false,
      mockup: { status: 'result', label: 'black tee' },
    })
    expect(result.text).toMatch(/^Mira, Crystal, here it is on a black tee/)
    expect(JSON.stringify(result)).not.toMatch(/flux|gpt|openai|gemini|replicate|nano|imagen/i)
    // The server-only payer never leaves the server.
    expect(JSON.stringify(message)).not.toMatch(/crystal-user|sourceUrl|paidBy/)
    // Pressing a finished one does nothing more.
    expect((await press()).status).toBe(200)
    expect(ledger).toHaveLength(1)
  })

  it('not enough credits: refused before anything renders or is charged', async () => {
    tables.user_wallets = [{ user_id: 'crystal-user', itc_balance: 3 }]
    offered()
    const res = await manage('/assistant/mockup/offer-1', { method: 'POST' })
    expect(res.status).toBe(402)
    expect((await res.json()).error).toBe('A mockup is 15 ITC and you have 3. Buy credits, then press it again.')
    expect(ledger).toEqual([])
    expect(renders).toEqual([])
    expect(tables.vendor_store_assistant_messages[0].mockup.status).toBe('offered')
  })

  it('a failed render hands the credits back and can be pressed again', async () => {
    renderFails = true
    offered()
    expect((await manage('/assistant/mockup/offer-1', { method: 'POST' })).status).toBe(202)
    releaseRender()
    const { message, result } = await poll('offer-1')
    expect(result).toBeNull()
    expect(message.mockup).toMatchObject({ status: 'failed', error: 'That one didn’t come out. Your credits are back: press it again.' })
    expect(ledger.map(l => [l.kind, l.amount])).toEqual([['deduct', 15], ['refund', 15]])
    renderFails = false
    expect((await manage('/assistant/mockup/offer-1', { method: 'POST' })).status).toBe(202)
    releaseRender()
    expect((await poll('offer-1')).message.mockup.status).toBe('done')
  })

  it('a render lost mid-way (a restart) fails after a few minutes and refunds once', async () => {
    offered({ status: 'rendering', startedAt: new Date(Date.now() - 7 * 60_000).toISOString(), paidBy: 'crystal-user' })
    const first = await (await manage('/assistant/mockup/offer-1')).json()
    expect(first.message.mockup.status).toBe('failed')
    await manage('/assistant/mockup/offer-1')
    expect(ledger).toEqual([{ kind: 'refund', uid: 'crystal-user', amount: 15, reason: 'assistant_mockup_stalled' }])
  })

  it('the picture service out of credit: nothing is charged', async () => {
    tables.admin_settings = [{ key: 'image_credit_outage:replicate', value: { since: '2026-10-29T10:00:00Z' } }]
    offered()
    const res = await manage('/assistant/mockup/offer-1', { method: 'POST' })
    expect(res.status).toBe(503)
    expect(ledger).toEqual([])
  })

  it('is hers alone: another store’s offer is not found', async () => {
    tables.vendor_store_assistant_messages.push({ id: 'theirs', storefront_id: 'store-2', role: 'assistant', text: 'x', image_url: null, mockup: { product: 'tshirt', status: 'offered', sourceUrl: PICTURE, priceItc: 15 } })
    expect((await manage('/assistant/mockup/theirs', { method: 'POST' })).status).toBe(404)
    expect(ledger).toEqual([])
  })
})
