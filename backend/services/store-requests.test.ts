import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fileStoreRequest, requestAllowed, requestBody, REQUESTS_PER_HOUR } from './store-requests.js'

const ctx = { slug: 'crystal', storeName: 'Crystal’s Shirts and More', ownerFirst: 'Crystal', ownerEmail: 'ctrin82@yahoo.com' }
const ask = { title: 'Add a gift-wrap option', details: 'She wants buyers to be able to add gift wrap at checkout.' }

beforeEach(() => { process.env.WATCHTOWER_INTERNAL_SECRET = 'test-secret' })
afterEach(() => { vi.restoreAllMocks(); delete process.env.WATCHTOWER_INTERNAL_SECRET })

describe('store requests to the board', () => {
  it('posts to the internal board endpoint on the ITP project, unassigned, with who asked', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'task-1' }), { status: 200 }))
    const r = await fileStoreRequest({ ...ctx, slug: 'req-a' }, ask)
    expect(r).toEqual({ ok: true, id: 'task-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/tasks\/internal$/)
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBe('test-secret')
    const body = JSON.parse(String(init.body))
    expect(body.project).toBe('imagine-this-printed')
    expect(body.title).toBe('Crystal’s Shirts and More: Add a gift-wrap option')
    expect(body.assigned_agent).toBeUndefined()
    expect(body.description).toMatch(/Requested by Crystal.*through her store assistant Rico/)
  })
  it('says so when the board refuses or is unreachable, and never throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'nope' }), { status: 500 }))
    expect(await fileStoreRequest({ ...ctx, slug: 'req-b' }, ask)).toEqual({ ok: false, error: 'nope' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'))
    expect(await fileStoreRequest({ ...ctx, slug: 'req-c' }, ask)).toEqual({ ok: false, error: 'offline' })
  })
  it('does nothing without the board secret', async () => {
    delete process.env.WATCHTOWER_INTERNAL_SECRET
    const f = vi.spyOn(globalThis, 'fetch')
    expect((await fileStoreRequest({ ...ctx, slug: 'req-d' }, ask)).ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
  it('caps a store at a few requests an hour', () => {
    const t = Date.now()
    for (let i = 0; i < REQUESTS_PER_HOUR; i++) expect(requestAllowed('req-e', t)).toBe(true)
    expect(requestAllowed('req-e', t)).toBe(false)
    expect(requestAllowed('req-e', t + 3_700_000)).toBe(true)
  })
  it('keeps her email out of the title', () => { expect(requestBody(ctx, ask).title).not.toMatch(/@/) })
})
