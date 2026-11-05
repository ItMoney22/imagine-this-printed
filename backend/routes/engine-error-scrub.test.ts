// A failed image call goes through the real routers here, so taking
// router.use(scrubEngineErrors) out of either one turns these red.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'

const ai = vi.hoisted(() => ({ removeBackground: vi.fn(), generateImagesMulti: vi.fn() }))
const replicateRun = vi.hoisted(() => vi.fn())

// Roles are keyed on the id, so an admin only reads as one if the scrub looks the
// user up the way each router's auth really sets it.
vi.mock('../lib/role-cache.js', () => ({
  getCachedRole: async (id: string) => {
    if (id === 'role-lookup-down') throw new Error('db down')
    return id === 'admin-1' ? 'admin' : 'customer'
  },
}))

// imagination-station's own requireAuth: a Supabase user, with .id and no .sub,
// whose role is always "authenticated".
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => ({ data: { user: { id: token, role: 'authenticated' } }, error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { itc_balance: 100 }, error: null }) }) }),
    }),
  }),
}))

// mockups' shared requireAuth.
vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const id = String(req.headers.authorization).replace('Bearer ', '')
    req.user = { id, sub: id }
    next()
  },
}))
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../services/imagination-ai.js', () => ({ aiService: ai }))
vi.mock('../services/imagine-brain.js', () => ({ brainstormDesign: vi.fn(), randomDesignIdea: vi.fn() }))
vi.mock('replicate', () => ({
  default: class {
    run = replicateRun
  },
}))

const { default: station } = await import('./imagination-station.js')
const { default: mockups } = await import('./mockups.js')
const { ENGINE_DECLINED_LINE, ENGINE_FAILED_LINE } = await import('../middleware/engine-error-scrub.js')

const app = express()
app.use(express.json())
app.use('/api/imagination-station', station)
app.use('/api/mockups', mockups)

let server: Server
beforeAll(() => {
  server = app.listen(0)
})
afterAll(() => {
  server.close()
})

async function post(path: string, userId: string, body: object): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

const removeBg = (userId: string) =>
  post('/api/imagination-station/ai/remove-bg', userId, { imageUrl: 'https://cdn.test/a.png' })
const generate = (userId: string) => post('/api/imagination-station/ai/generate', userId, { prompt: 'a red fox' })
const mockup = (userId: string) =>
  post('/api/mockups/itp-enhance', userId, { design_url: 'https://cdn.test/a.png', product_type: 'tshirt-black' })

const ENGINE = /gpt|openai|replicate|flux|flare|banana|851-labs/i

beforeEach(() => {
  ai.removeBackground.mockReset()
  ai.generateImagesMulti.mockReset()
  replicateRun.mockReset()
})

describe('a failed Remove BG', () => {
  const raw = 'Request to https://api.replicate.com/v1/predictions failed: 851-labs/background-remover crashed'

  it('reaches a customer with no engine word', async () => {
    ai.removeBackground.mockRejectedValueOnce(new Error(raw))

    const res = await removeBg('customer-1')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe(ENGINE_FAILED_LINE)
    expect(JSON.stringify(res.body)).not.toMatch(ENGINE)
  })

  it('reaches an admin with the raw text', async () => {
    ai.removeBackground.mockRejectedValueOnce(new Error(raw))

    const res = await removeBg('admin-1')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe(raw)
  })
})

describe('a failed generate', () => {
  const raw = 'gpt-image-2.6-flare: no image returned'

  it('reaches a customer with no engine word', async () => {
    ai.generateImagesMulti.mockRejectedValueOnce(new Error(raw))

    const res = await generate('customer-1')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe(ENGINE_FAILED_LINE)
    expect(JSON.stringify(res.body)).not.toMatch(ENGINE)
  })

  it('reaches an admin with the raw text', async () => {
    ai.generateImagesMulti.mockRejectedValueOnce(new Error(raw))

    const res = await generate('admin-1')

    expect(res.body.error).toBe(raw)
  })

  it('tells a refused customer to reword, not to pay for the same refusal again', async () => {
    ai.generateImagesMulti.mockRejectedValueOnce(new Error('rejected by the safety system (model: gpt-image-2.6-flare)'))

    const res = await generate('customer-1')

    expect(res.body.error).toBe(ENGINE_DECLINED_LINE)
  })

  it('treats a failed role lookup as a customer', async () => {
    ai.generateImagesMulti.mockRejectedValueOnce(new Error(raw))

    const res = await generate('role-lookup-down')

    expect(res.body.error).toBe(ENGINE_FAILED_LINE)
  })

  it('does not let "insufficient" carry an engine name through', async () => {
    ai.generateImagesMulti.mockRejectedValueOnce(new Error('Replicate: insufficient credit'))

    const res = await generate('customer-1')

    expect(res.body.error).toBe(ENGINE_FAILED_LINE)
  })
})

describe('a failed mockup', () => {
  const raw = 'google/nano-banana-2-lite: prediction failed'

  it('reaches a customer with no engine word', async () => {
    replicateRun.mockRejectedValueOnce(new Error(raw))

    const res = await mockup('customer-1')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe(ENGINE_FAILED_LINE)
  })

  it('reaches an admin with the raw text', async () => {
    replicateRun.mockRejectedValueOnce(new Error(raw))

    const res = await mockup('admin-1')

    expect(res.body.error).toBe(raw)
  })
})

describe('a message that names no engine', () => {
  it.each([
    'Insufficient ITC',
    'Insufficient ITC balance. Need 5 ITC.',
    'Not enough ITC: need 8, have 2',
    'All image generations failed. You were not charged.',
  ])('reaches a customer word for word at the same status: %s', async (message) => {
    ai.generateImagesMulti.mockRejectedValueOnce(new Error(message))
    ai.removeBackground.mockRejectedValueOnce(new Error(message))

    const [generated, removed] = [await generate('customer-1'), await removeBg('customer-1')]

    expect(generated).toEqual({ status: 500, body: { error: message } })
    expect(removed).toEqual({ status: 500, body: { error: message } })
  })

  it('keeps a plain 400 as it was', async () => {
    const res = await post('/api/imagination-station/ai/remove-bg', 'customer-1', {})

    expect(res).toEqual({ status: 400, body: { error: 'imageUrl is required' } })
  })
})

describe('a good answer', () => {
  it('goes out untouched, even when a field names the model', async () => {
    ai.generateImagesMulti.mockResolvedValueOnce({
      images: [{ url: 'https://cdn.test/out.png', modelId: 'openai/gpt-image-2', modelLabel: 'Imagination' }],
      cost: 1,
      perImageCost: 1,
      freeTrialUsed: false,
      failures: [],
    })

    const res = await generate('customer-1')

    expect(res.status).toBe(200)
    expect(res.body.images[0].modelId).toBe('openai/gpt-image-2')
  })
})
