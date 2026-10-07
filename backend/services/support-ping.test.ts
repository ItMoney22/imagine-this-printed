import { describe, it, expect, vi, afterEach } from 'vitest'
import { supportPingBody, pingChristinaAboutTicket, pickTicket, ticketRef, escapeHtml, christinaReachable } from './support-ping.js'

const ID = '61b69961-98ff-4147-8198-fd85f390239b'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('supportPingBody', () => {
  it('sends first name only, a short reference and a capped message', () => {
    const body = supportPingBody({
      kind: 'ticket',
      ticketId: ID,
      subject: '  Do you print hoodies in navy?  ',
      message: 'x'.repeat(700),
      customerName: 'Sam Reed',
      customerEmail: 'sam@example.com',
      priority: 'high',
      category: 'bulk_quote',
    })
    expect(body.ticketRef).toBe('61B69961')
    expect(body.customerFirstName).toBe('Sam')
    expect(body.subject).toBe('Do you print hoodies in navy?')
    expect(body.message.length).toBe(603)
    expect(body.message.endsWith('...')).toBe(true)
  })

  it('leaves a missing name empty instead of inventing one', () => {
    expect(supportPingBody({ kind: 'live_chat', ticketId: ID, subject: 's', message: 'm' }).customerFirstName).toBeNull()
  })
})

describe('pingChristinaAboutTicket', () => {
  it('does nothing without the bridge token', async () => {
    vi.stubEnv('PRINT_BRIDGE_TOKEN', '')
    const fetchImpl = vi.fn()
    expect(await pingChristinaAboutTicket({ kind: 'ticket', ticketId: ID, subject: 's', message: 'm' }, fetchImpl)).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(christinaReachable()).toBe(false)
  })

  it('posts to the support-ping route with the bridge token', async () => {
    vi.stubEnv('PRINT_BRIDGE_TOKEN', 'tok')
    vi.stubEnv('WATCHTOWER_URL', 'https://example.test/')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    expect(await pingChristinaAboutTicket({ kind: 'chat_message', ticketId: ID, subject: 's', message: 'still there?' }, fetchImpl)).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://example.test/api/phone/support-ping')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'chat_message', ticketId: ID, message: 'still there?' })
    expect(christinaReachable()).toBe(true)
  })

  it('never throws when the phone side is down', async () => {
    vi.stubEnv('PRINT_BRIDGE_TOKEN', 'tok')
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await pingChristinaAboutTicket({ kind: 'ticket', ticketId: ID, subject: 's', message: 'm' }, fetchImpl)).toBe(false)
  })
})

describe('pickTicket', () => {
  const open = [{ id: ID }, { id: '47e92e20-4a7b-4382-946f-fa71161d5856' }]

  it('takes the newest when no reference is given', () => {
    expect(pickTicket('', open)?.id).toBe(ID)
  })

  it('matches the short reference in any case, with or without #', () => {
    expect(pickTicket('#47E92E20', open)?.id).toBe(open[1].id)
    expect(pickTicket(ticketRef(open[1].id).toLowerCase(), open)?.id).toBe(open[1].id)
  })

  it('returns null for a reference that matches nothing open', () => {
    expect(pickTicket('deadbeef', open)).toBeNull()
  })
})

describe('escapeHtml', () => {
  it('keeps her words as text in the reply email', () => {
    expect(escapeHtml('Navy is <b>$35</b> & ships Friday')).toBe('Navy is &lt;b&gt;$35&lt;/b&gt; &amp; ships Friday')
  })
})
