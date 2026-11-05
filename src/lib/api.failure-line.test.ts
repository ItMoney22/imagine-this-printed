// The Imagination Station toasts show failureLine(err). They used to read
// err.response.data.error, which this client never sets, so every failure said
// "Please try again." and a customer out of ITC was never told why.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const { failureLine, imaginationApi } = await import('./api')

function serverAnswers(status: number, body: object) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

async function failureOfRemoveBg(): Promise<unknown> {
  return imaginationApi.removeBackground({ imageUrl: 'https://cdn.test/a.png' }).catch((err) => err)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('failureLine', () => {
  it('shows what the server said, word for word', async () => {
    serverAnswers(500, { error: 'Insufficient ITC balance. Need 5 ITC.' })

    expect(failureLine(await failureOfRemoveBg())).toBe('Insufficient ITC balance. Need 5 ITC.')
  })

  it('falls back when the server gave no line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))

    expect(failureLine(await failureOfRemoveBg())).toBe('Request failed')
  })

  it('does not show the browser its own connection error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    expect(failureLine(await failureOfRemoveBg())).toBe('Please try again.')
  })

  it('handles something that is not an Error', () => {
    expect(failureLine('nope')).toBe('Please try again.')
  })
})
