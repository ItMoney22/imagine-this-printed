import { describe, it, expect, vi } from 'vitest'
import { verifyTurnstile, readTurnstileToken, TURNSTILE_VERIFY_URL } from './turnstile'

const reply = (status: number, json: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => json }))

describe('verifyTurnstile', () => {
  it('does nothing until a secret is configured', async () => {
    const fetchImpl = reply(200, { success: false })
    expect(await verifyTurnstile('tok', '1.2.3.4', { secret: '', fetchImpl })).toEqual({ ok: true, skipped: true, reason: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a post with no token once the secret is set (a bot posting straight to the API)', async () => {
    const fetchImpl = reply(200, { success: true })
    const r = await verifyTurnstile('', '1.2.3.4', { secret: 's', fetchImpl })
    expect(r).toEqual({ ok: false, skipped: false, reason: 'missing_token' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes a token Cloudflare accepts, sending secret, token and ip', async () => {
    const fetchImpl = reply(200, { success: true })
    expect(await verifyTurnstile('good', '1.2.3.4', { secret: 's', fetchImpl })).toEqual({ ok: true, skipped: false })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams }]
    expect(url).toBe(TURNSTILE_VERIFY_URL)
    expect(Object.fromEntries(init.body)).toEqual({ secret: 's', response: 'good', remoteip: '1.2.3.4' })
  })

  it('refuses a token Cloudflare rejects (forged, expired or replayed)', async () => {
    const fetchImpl = reply(200, { success: false, 'error-codes': ['timeout-or-duplicate'] })
    expect(await verifyTurnstile('old', undefined, { secret: 's', fetchImpl })).toEqual({ ok: false, skipped: false, reason: 'timeout-or-duplicate' })
  })

  it('fails open when Cloudflare is down, so a customer message is never lost to an outage', async () => {
    const down = vi.fn(async () => { throw new Error('ECONNRESET') })
    expect((await verifyTurnstile('t', undefined, { secret: 's', fetchImpl: down })).ok).toBe(true)
    expect((await verifyTurnstile('t', undefined, { secret: 's', fetchImpl: reply(503, {}) })).ok).toBe(true)
  })

  it('fails open on our own bad secret instead of blocking every customer', async () => {
    const r = await verifyTurnstile('t', undefined, { secret: 'wrong', fetchImpl: reply(200, { success: false, 'error-codes': ['invalid-input-secret'] }) })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
  })
})

describe('readTurnstileToken', () => {
  it('reads our field and the widget default field, ignores junk', () => {
    expect(readTurnstileToken({ captchaToken: ' abc ' })).toBe('abc')
    expect(readTurnstileToken({ 'cf-turnstile-response': 'xyz' })).toBe('xyz')
    expect(readTurnstileToken({ captchaToken: 42 })).toBe('')
    expect(readTurnstileToken(null)).toBe('')
  })
})
