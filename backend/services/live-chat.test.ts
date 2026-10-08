import { describe, it, expect, vi } from 'vitest'
import { startLiveChat, liveChatDescription, cleanEmail, type LiveChatDb } from './live-chat.js'

/** A tiny stand-in for the Supabase query builder: records every write, answers reads from `rows`. */
function fakeDb(rows: Record<string, any> = {}) {
  const writes: { table: string; op: string; value: any }[] = []
  const db: LiveChatDb = {
    from(table: string) {
      const q: any = {
        _op: 'select', _value: null,
        select() { return q },
        eq() { return q },
        insert(v: any) { q._op = 'insert'; q._value = v; writes.push({ table, op: 'insert', value: v }); return q },
        update(v: any) { q._op = 'update'; q._value = v; writes.push({ table, op: 'update', value: v }); return q },
        upsert(v: any) { writes.push({ table, op: 'upsert', value: v }); return Promise.resolve({ error: null }) },
        maybeSingle() { return Promise.resolve({ data: rows[table] ?? null, error: null }) },
        single() { return Promise.resolve({ data: q._op === 'insert' ? { id: 'aaaaaaaa-1111-4111-8111-111111111111' } : rows[table], error: null }) },
        then(res: any) { return Promise.resolve({ error: null }).then(res) },
      }
      return q
    },
  }
  return { db, writes }
}

const deps = (available: boolean) => ({
  checkAgentAvailability: vi.fn(async () => ({ available })),
  createNotification: vi.fn(async () => undefined),
  pingChristinaAboutTicket: vi.fn(async () => true),
})

describe('startLiveChat', () => {
  it('Christina reachable: files an open ticket, opens a waiting session, pings her as live_chat', async () => {
    const { db, writes } = fakeDb()
    const d = deps(true)
    const r = await startLiveChat(db, { name: 'Maria', email: 'Maria@Example.com', message: 'Can I pick up today?' }, d)
    expect(r).toMatchObject({ ok: true, live: true, email: 'maria@example.com' })
    const ticket = writes.find(w => w.table === 'support_tickets' && w.op === 'insert')!.value
    // prod allows open | in_progress | resolved | closed on tickets; waiting is a chat_sessions status
    expect(ticket.status).toBe('open')
    expect(writes.some(w => w.table === 'support_tickets' && w.op === 'update' && 'status' in w.value)).toBe(false)
    expect(ticket.description.startsWith('Name: Maria')).toBe(true)
    expect(writes.some(w => w.table === 'chat_sessions' && w.op === 'upsert' && w.value.status === 'waiting')).toBe(true)
    expect(d.pingChristinaAboutTicket).toHaveBeenCalledWith(expect.objectContaining({ kind: 'live_chat' }))
  })

  it('nobody reachable: still files the ticket (open) and pings, never claims a live chat', async () => {
    const { db, writes } = fakeDb()
    const d = deps(false)
    const r = await startLiveChat(db, { message: 'Do you do 50 team shirts?' }, d)
    expect(r).toMatchObject({ ok: true, live: false })
    expect(r.ticketId).toBeTruthy()
    expect(writes.find(w => w.op === 'insert')!.value.status).toBe('open')
    expect(writes.some(w => w.table === 'chat_sessions')).toBe(false)
    expect(d.pingChristinaAboutTicket).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ticket' }))
  })

  it('reuses the chat\'s existing ticket and fills a missing email', async () => {
    const id = 'bbbbbbbb-2222-4222-8222-222222222222'
    const { db, writes } = fakeDb({ support_tickets: { id, email: null } })
    const r = await startLiveChat(db, { ticketId: id, email: 'a@b.co' }, deps(true))
    expect(r.ticketId).toBe(id)
    expect(writes.some(w => w.table === 'support_tickets' && w.op === 'insert')).toBe(false)
    expect(writes.some(w => w.op === 'update' && w.value.email === 'a@b.co')).toBe(true)
  })
})

describe('helpers', () => {
  it('cleanEmail drops junk and the old anonymous placeholder', () => {
    expect(cleanEmail(' A@B.co ')).toBe('a@b.co')
    expect(cleanEmail('nope')).toBeNull()
    expect(cleanEmail('anonymous@customer.com')).toBeNull()
  })

  it('description puts the typed name first so the reply email can greet it', () => {
    expect(liveChatDescription({ name: 'Maria', reason: 'Sizing', message: 'Is a large roomy?' }))
      .toBe('Name: Maria\n\nSizing\n\nLast message: Is a large roomy?')
    expect(liveChatDescription({ reason: 'Sizing', message: 'Sizing' })).toBe('Sizing')
  })
})
