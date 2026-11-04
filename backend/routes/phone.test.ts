import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import type { AddressInfo } from 'net'
import type { Server } from 'http'

// lib/supabase.ts builds its client at import; these only have to exist (same pattern as print-bridge.test.ts).
process.env.SUPABASE_URL ||= 'https://test-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const AUTH = 'test-auth-token'
const BASE = 'https://api.imaginethisprinted.com'
const CALL = 'CA' + 'a'.repeat(32)

function setPhoneEnv() {
  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: AUTH,
    TWILIO_PHONE_NUMBER: '+14702278666',
    PHONE_FORWARD_TO: '+14015550199',
    PHONE_PUBLIC_URL: BASE,
    PHONE_AGENT_SECRET: 'test-agent-secret',
    VOICE_BRIDGE_URL: 'https://darrell-voice-bridge.fly.dev',
    VOICE_BRIDGE_TOKEN: 'bridge-token',
  })
  delete process.env.PHONE_AI_ENABLED
  delete process.env.PHONE_GEMINI_API_KEY
}

// ── an in-memory stand-in for the Supabase tables the phone line touches ────
type Row = Record<string, any>
function fakeDb() {
  const tables: Record<string, Row[]> = {}
  let ids = 0
  const table = (name: string) => (tables[name] ||= [])
  function from(name: string) {
    const filters: ((r: Row) => boolean)[] = []
    let pending: { kind: 'insert' | 'upsert' | 'update' | 'select'; rows?: Row[]; patch?: Row; opts?: any } = { kind: 'select' }
    let ordered: { col: string; asc: boolean } | null = null
    let limit = Infinity
    const matches = () => table(name).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (pending.kind === 'insert') {
        const made = pending.rows!.map((r) => ({ id: r.id ?? `id-${++ids}`, created_at: new Date().toISOString(), ...r }))
        table(name).push(...made)
        return made
      }
      if (pending.kind === 'upsert') {
        const keys = String(pending.opts?.onConflict || 'id').split(',')
        for (const r of pending.rows!) {
          const hit = table(name).find((x) => keys.every((k) => x[k] === r[k]))
          if (hit && pending.opts?.ignoreDuplicates) continue
          if (hit) Object.assign(hit, r)
          else table(name).push({ created_at: new Date().toISOString(), ...r })
        }
        return []
      }
      if (pending.kind === 'update') {
        const hit = matches()
        for (const r of hit) Object.assign(r, pending.patch)
        return hit
      }
      let rows = matches()
      if (ordered) rows = [...rows].sort((a, b) => (a[ordered!.col] > b[ordered!.col] ? 1 : -1) * (ordered!.asc ? 1 : -1))
      return rows.slice(0, limit)
    }
    const b: any = {
      insert: (rows: Row | Row[]) => ((pending = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }), b),
      upsert: (rows: Row | Row[], opts: any) => ((pending = { kind: 'upsert', rows: Array.isArray(rows) ? rows : [rows], opts }), b),
      update: (patch: Row) => ((pending = { kind: 'update', patch }), b),
      select: () => b,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), b),
      gte: (col: string, v: string) => (filters.push((r) => String(r[col]) >= v), b),
      order: (col: string, o: { ascending: boolean }) => ((ordered = { col, asc: o.ascending }), b),
      limit: (n: number) => ((limit = n), b),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: any) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok, bad),
    }
    return b
  }
  return { tables, db: { from } }
}

function fakeDeps(overrides: Record<string, unknown> = {}) {
  const store = fakeDb()
  const emails: unknown[][] = []
  const pings: any[] = []
  const updates: { callSid: string; body: string }[] = []
  const deps = {
    db: store.db,
    triage: async () => ({
      category: 'order_status', priority: 'normal', dbPriority: 'medium', needsReview: false,
      categorySource: 'jev', prioritySource: 'jev', floor: { priority: 'normal', rules: [] }, mode: 'on',
    }) as any,
    emailTeam: async (...a: unknown[]) => void emails.push(a),
    bulkRecipients: () => ['davidt@imaginethisprinted.com'],
    ping: async (p: any) => (pings.push(p), true),
    updateCall: async (callSid: string, body: string) => (updates.push({ callSid, body }), true),
    ...overrides,
  }
  return { deps: deps as any, store, emails, pings, updates }
}

let phone: typeof import('./phone.js')
let agent: typeof import('../services/phone-agent.js')
let tokens: typeof import('../lib/phone-agent-token.js')
let tw: typeof import('../lib/phone-twilio.js')
let express: typeof import('express')
beforeAll(async () => {
  // Cold imports of the route graph run here, under a 30 s hook timeout, not inside an it() (task 1e4242ba).
  phone = await import('./phone.js')
  agent = await import('../services/phone-agent.js')
  tokens = await import('../lib/phone-agent-token.js')
  tw = await import('../lib/phone-twilio.js')
  express = (await import('express')).default as any
}, 30_000)

beforeEach(setPhoneEnv)

describe('Twilio signatures', () => {
  // Reference values from the official `twilio` package's getExpectedTwilioSignature.
  const smsParams = {
    AccountSid: 'AC00000000000000000000000000000000', Body: 'Hi, is my order ready?', From: '+14705550123',
    MessageSid: 'SM11111111111111111111111111111111', NumMedia: '0', To: '+14702278666',
  }
  it('matches the twilio package on a form post', () => {
    expect(tw.twilioSignature(AUTH, `${BASE}/api/phone/twilio/sms`, smsParams)).toBe('l5Gqdq16sW5WHJ4zxJ5hFwocgZU=')
  })
  it('signs the query string as part of the url', () => {
    const url = `${BASE}/api/phone/twilio/dial-done?reason=wants%20a%20person`
    expect(tw.twilioSignature(AUTH, url, { CallSid: CALL, DialCallStatus: 'no-answer', From: '+14705550123' })).toBe('SAh3cRHfQT3uIgyVj2ZdggbYb2s=')
  })
  it('refuses a wrong token, a changed body and a missing signature', () => {
    const url = `${BASE}/api/phone/twilio/sms`
    const sig = tw.twilioSignature(AUTH, url, smsParams)
    expect(tw.validTwilioSignature(AUTH, sig, url, smsParams)).toBe(true)
    expect(tw.validTwilioSignature('other-token', sig, url, smsParams)).toBe(false)
    expect(tw.validTwilioSignature(AUTH, sig, url, { ...smsParams, Body: 'changed' })).toBe(false)
    expect(tw.validTwilioSignature(AUTH, undefined, url, smsParams)).toBe(false)
    expect(tw.validTwilioSignature('', sig, url, smsParams)).toBe(false)
  })
})

describe('incoming call TwiML', () => {
  it('hands the call to the bridge with the token in the PATH, then rings the shop', () => {
    const xml = phone.incomingCallTwiml({ CallSid: CALL, From: '+14705550123', To: '+14702278666' })
    const stream = xml.match(/<Stream url="([^"]+)"/)?.[1]
    expect(stream).toBe('wss://darrell-voice-bridge.fly.dev/twilio/bridge-token')
    expect(stream).not.toContain('?') // Twilio drops query strings on a Stream url (client-phone-system trap 1)
    expect(xml).toContain(`<Parameter name="appUrl" value="${BASE}"/>`)
    expect(xml).toContain(`<Parameter name="callSid" value="${CALL}"/>`)
    const token = xml.match(/<Parameter name="callToken" value="([^"]+)"/)?.[1]
    expect(tokens.verifyCallToken(token, CALL)).toEqual({ ok: true, callSid: CALL })
    // The fallback is AFTER the Connect: a dead bridge falls through to a person.
    expect(xml.indexOf('<Dial')).toBeGreaterThan(xml.indexOf('</Connect>'))
    expect(xml).toContain('<Number>+14015550199</Number>')
    expect(xml).toContain(`action="${BASE}/api/phone/twilio/dial-done"`)
  })
  it('kill switch: PHONE_AI_ENABLED=false or no bridge url just forwards', () => {
    process.env.PHONE_AI_ENABLED = 'false'
    let xml = phone.incomingCallTwiml({ CallSid: CALL })
    expect(xml).not.toContain('<Connect>')
    expect(xml).toContain('<Number>+14015550199</Number>')
    delete process.env.PHONE_AI_ENABLED
    delete process.env.VOICE_BRIDGE_URL
    xml = phone.incomingCallTwiml({ CallSid: CALL })
    expect(xml).not.toContain('<Connect>')
    expect(xml).toContain('<Dial')
  })
  it('no PHONE_AGENT_SECRET: no assistant, the call still rings the shop', () => {
    delete process.env.PHONE_AGENT_SECRET
    const xml = phone.incomingCallTwiml({ CallSid: CALL })
    expect(xml).not.toContain('<Connect>')
    expect(xml).toContain('<Number>+14015550199</Number>')
  })
  it('no number to ring: says so and hangs up', () => {
    delete process.env.PHONE_FORWARD_TO
    const xml = phone.incomingCallTwiml({ CallSid: CALL })
    expect(xml).toContain('not available')
    expect(xml).toContain('<Hangup/>')
  })
})

describe('the router, over HTTP', () => {
  let server: Server
  let base = ''
  let h: ReturnType<typeof fakeDeps>
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    h = fakeDeps()
    const app = express()
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))
    app.use('/api/phone', phone.createPhoneRouter(h.deps))
    server = await new Promise<Server>((ok) => {
      const s = app.listen(0, () => ok(s))
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await new Promise((ok) => server.close(ok))
  })
  afterAll(() => vi.unstubAllGlobals())

  /** POST like Twilio does: form body, signed against the public url. */
  const twilioPost = (path: string, params: Record<string, string>, sign = true) =>
    realFetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(sign ? { 'X-Twilio-Signature': tw.twilioSignature(AUTH, `${BASE}${path}`, params) } : {}),
      },
      body: new URLSearchParams(params).toString(),
    })
  const bridgePost = (path: string, body: unknown, token?: string) =>
    realFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-phone-call-token': token } : {}) },
      body: JSON.stringify(body),
    })
  const settle = () => new Promise((ok) => setTimeout(ok, 30))

  it('incoming: refuses an unsigned webhook, answers a signed one and records the call', async () => {
    const params = { CallSid: CALL, From: '+14705550123', To: '+14702278666' }
    expect((await twilioPost('/api/phone/twilio/incoming', params, false)).status).toBe(403)
    const res = await twilioPost('/api/phone/twilio/incoming', params)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/xml')
    expect(await res.text()).toContain('<Connect><Stream')
    await settle()
    expect(h.store.tables.phone_calls?.[0]).toMatchObject({ call_sid: CALL, from_number: '+14705550123' })
  })

  it('session: 403 without or with a forged token, 503 without a Gemini key, the persona with one', async () => {
    const token = tokens.mintCallToken(CALL)
    expect((await bridgePost('/api/phone/agent/session', { callSid: CALL })).status).toBe(403)
    expect((await bridgePost('/api/phone/agent/session', { callSid: CALL }, 'forged.token')).status).toBe(403)
    expect((await bridgePost('/api/phone/agent/session', { callSid: 'CA' + 'b'.repeat(32) }, token)).status).toBe(403)
    expect((await bridgePost('/api/phone/agent/session', { callSid: CALL }, token)).status).toBe(503)

    process.env.PHONE_GEMINI_API_KEY = 'test-gemini-key'
    const minted: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        minted.push(JSON.parse(init.body).uses)
        return new Response(JSON.stringify({ name: 'auth_tokens/one-use' }), { status: 200 })
      }
      return realFetch(url, init)
    })
    const res = await bridgePost('/api/phone/agent/session', { callSid: CALL, from: '+14705550123' }, token)
    expect(res.status).toBe(200)
    const s = await res.json()
    expect(minted).toEqual([1])
    expect(s).toMatchObject({
      voiceProvider: 'gemini', model: 'models/gemini-3.8-live', voice: 'Puck', tenant: 'imaginethisprinted',
      credentials: { token: 'auth_tokens/one-use' },
    })
    expect(s.greeting).toContain('Imagine This Printed')
    expect(s.instructions).toContain('+14705550123')
    expect(s.tools.map((t: { name: string }) => t.name)).toEqual(['take_message', 'transfer_to_shop'])
  })

  it('take_message files a support ticket, pings Christina and links the call', async () => {
    const token = tokens.mintCallToken(CALL)
    const res = await bridgePost('/api/phone/agent/tool', {
      tool: 'take_message', callSid: CALL, from: '+14705550123',
      args: { caller_name: 'Dana', summary: 'Wants 20 church shirts by Dec 5.', callback_number: '470 555 0199', urgency: 'soon' },
    }, token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    const ticket = h.store.tables.support_tickets[0]
    expect(ticket).toMatchObject({ subject: 'Phone message from Dana', status: 'open', email: null })
    expect(ticket.description).toContain('Call back: (470) 555-0199')
    expect(h.store.tables.ticket_messages.map((m: Row) => m.sender_type)).toEqual(['user', 'system'])
    expect(h.pings[0]).toMatchObject({ kind: 'ticket', ticketId: ticket.id, customerName: 'Dana' })
    expect(h.emails).toHaveLength(1)
    expect(h.store.tables.phone_calls[0]).toMatchObject({ call_sid: CALL, ticket_id: ticket.id })

    // A second message on the same call joins that ticket.
    await bridgePost('/api/phone/agent/tool', { tool: 'take_message', callSid: CALL, args: { caller_name: 'Dana', summary: 'Also hoodies.' } }, token)
    expect(h.store.tables.support_tickets).toHaveLength(1)
    expect(h.pings[1]).toMatchObject({ kind: 'chat_message', ticketId: ticket.id })
  })

  it('a token for one call cannot run a tool on another', async () => {
    const res = await bridgePost('/api/phone/agent/tool', { tool: 'take_message', callSid: 'CA' + 'c'.repeat(32), args: { caller_name: 'X', summary: 'y' } }, tokens.mintCallToken(CALL))
    expect(res.status).toBe(403)
    expect(h.store.tables.support_tickets).toBeUndefined()
  })

  it('transfer_to_shop redirects the live call to the shop with a missed-call path', async () => {
    const res = await bridgePost('/api/phone/agent/tool', { tool: 'transfer_to_shop', callSid: CALL, args: { reason: 'order problem' } }, tokens.mintCallToken(CALL))
    expect(await res.json()).toMatchObject({ ok: true, speak: 'Connecting you now.' })
    expect(h.updates[0].callSid).toBe(CALL)
    expect(h.updates[0].body).toContain('<Number>+14015550199</Number>')
    expect(h.updates[0].body).toContain(`action="${BASE}/api/phone/twilio/dial-done?reason=order+problem"`)
  })

  it('dial-done: a missed call becomes a ticket with the number; an answered one just hangs up', async () => {
    let res = await twilioPost('/api/phone/twilio/dial-done', { CallSid: CALL, DialCallStatus: 'completed', From: '+14705550123' })
    expect(await res.text()).toContain('<Hangup/>')
    await settle()
    expect(h.store.tables.support_tickets).toBeUndefined()

    res = await twilioPost('/api/phone/twilio/dial-done', { CallSid: CALL, DialCallStatus: 'no-answer', From: '+14705550123' })
    expect(await res.text()).toContain('will call you back')
    await settle()
    expect(h.store.tables.support_tickets[0]).toMatchObject({ subject: 'Missed call from (470) 555-0123' })
  })

  it('sms: a text opens a ticket, the next one joins it, STOP is ignored, no reply is sent', async () => {
    const text = (Body: string, extra: Record<string, string> = {}) =>
      twilioPost('/api/phone/twilio/sms', { From: '+14705550123', To: '+14702278666', Body, MessageSid: 'SM1', NumMedia: '0', ...extra })
    const res = await text('Is my order ready?')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
    await settle()
    expect(h.store.tables.support_tickets).toHaveLength(1)
    expect(h.store.tables.support_tickets[0]).toMatchObject({ subject: 'Text message from (470) 555-0123', status: 'open' })

    await text('Order 1234', { NumMedia: '1', MediaUrl0: 'https://api.twilio.com/media/ME1' })
    await text('STOP')
    await settle()
    expect(h.store.tables.support_tickets).toHaveLength(1)
    const said = h.store.tables.ticket_messages.filter((m: Row) => m.sender_type === 'user').map((m: Row) => m.message)
    expect(said).toHaveLength(2)
    expect(said[1]).toContain('https://api.twilio.com/media/ME1')
    expect(said.join(' ')).not.toContain('STOP')
    expect((await twilioPost('/api/phone/twilio/sms', { From: '+1', Body: 'x' }, false)).status).toBe(403)
  })

  it('sms that Jev is sure is spam is filed closed and alerts no one', async () => {
    h.deps.triage = async () => ({ category: 'spam', dbPriority: 'low', needsReview: false, floor: { rules: [] } }) as any
    await twilioPost('/api/phone/twilio/sms', { From: '+14705550123', Body: 'WIN A CRUISE', MessageSid: 'SM2', NumMedia: '0' })
    await settle()
    expect(h.store.tables.support_tickets[0]).toMatchObject({ category: 'spam', status: 'closed' })
    expect(h.pings).toHaveLength(0)
    expect(h.emails).toHaveLength(0)
  })

  it('heartbeat seeds the call row; transcript turns dedupe; hangup copies them onto the ticket', async () => {
    const token = tokens.mintCallToken(CALL)
    expect((await bridgePost('/api/phone/agent/heartbeat', { callSid: CALL, aiSeconds: 15 }, token)).status).toBe(200)
    expect(h.store.tables.phone_calls[0]).toMatchObject({ call_sid: CALL, ai_seconds: 15 })
    await bridgePost('/api/phone/agent/transcript', { callSid: CALL, speaker: 'assistant', text: 'Thanks for calling.', seq: 0 }, token)
    await bridgePost('/api/phone/agent/transcript', { callSid: CALL, speaker: 'caller', text: 'Hi, I need shirts.', seq: 1 }, token)
    await bridgePost('/api/phone/agent/transcript', { callSid: CALL, speaker: 'caller', text: 'retry of the same turn', seq: 1 }, token)
    expect(h.store.tables.phone_call_turns).toHaveLength(2)

    await bridgePost('/api/phone/agent/tool', { tool: 'take_message', callSid: CALL, args: { caller_name: 'Lee', summary: 'Needs shirts.' } }, token)
    await twilioPost('/api/phone/twilio/status', { CallSid: CALL, CallStatus: 'completed', CallDuration: '42', From: '+14705550123' })
    await settle()
    expect(h.store.tables.phone_calls[0]).toMatchObject({ status: 'completed', duration_seconds: 42 })
    const note = h.store.tables.ticket_messages.find((m: Row) => String(m.message).startsWith('Call transcript'))
    expect(note).toMatchObject({ is_internal: true })
    expect(note.message).toContain('Mr. Imagine: Thanks for calling.\nCaller: Hi, I need shirts.')
    expect(h.store.tables.phone_calls[0].transcript_filed_at).toBeTruthy()
  })

  it('status: the forwarded child leg is not recorded as a call', async () => {
    await twilioPost('/api/phone/twilio/status', { CallSid: 'CA' + 'd'.repeat(32), ParentCallSid: CALL, CallStatus: 'completed', CallDuration: '9' })
    expect(h.store.tables.phone_calls).toBeUndefined()
  })
})

describe('what Mr. Imagine knows matches the help page', () => {
  it('reads the same processing times, pickup place and money numbers', async () => {
    const help = await import('../../src/lib/help-facts.js')
    const persona = await import('../lib/phone-agent-persona.js')
    const pricing = await import('../services/order-pricing.js')
    const ship = await import('../../src/utils/shipping-calculator.js')
    expect(persona.PHONE_SHOP_FACTS.processing).toEqual(help.PROCESSING)
    expect(persona.PHONE_SHOP_FACTS.email).toBe(help.SUPPORT_EMAIL)
    expect(ship.WAREHOUSE_ADDRESS.address.replace('Ave', 'Avenue')).toBe(persona.PHONE_SHOP_FACTS.pickupStreet)
    expect(ship.PICKUP_HOURS).toBe('10:00 AM - 8:00 PM ET')
    expect(pricing.FREE_SHIPPING_THRESHOLD_CENTS).toBe(ship.FREE_SHIPPING_THRESHOLD * 100)
    expect(pricing.RUSH_FEE_CENTS).toBe(Math.round(ship.RUSH_FEE * 100))
    const text = persona.buildPhoneInstructions('')
    expect(text).toContain('50 dollars')
    expect(text).toContain('7.99 dollars')
    expect(text).not.toMatch(/\b(GPT|OpenAI|Gemini|Grok|Claude|Flux)\b/)
  })
})

describe('callback numbers', () => {
  it('takes a spoken US number, else the caller id', () => {
    expect(agent.callbackNumber('470-555-0199', '+14705550123')).toBe('+14705550199')
    expect(agent.callbackNumber('1 (470) 555 0199', '')).toBe('+14705550199')
    expect(agent.callbackNumber('', '+14705550123')).toBe('+14705550123')
    expect(agent.callbackNumber('call me', 'anonymous')).toBeNull()
  })
})
