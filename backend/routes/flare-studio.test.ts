// A failed run must refund the wallet and must not hand a customer the raw error,
// which can name the model. The engine is "Imagination" to anyone who is not the team.
import { afterAll, beforeAll, describe, it, expect, beforeEach, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'

const role = vi.hoisted(() => ({ value: 'customer' as string | null }))
const runFlare = vi.hoisted(() => vi.fn())
const refundITC = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: 'user-1' }
    next()
  },
}))
vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async () => role.value }))
vi.mock('../services/imagination-pricing.js', () => ({
  pricingService: { deductITC: vi.fn(async () => {}), refundITC },
}))
vi.mock('../services/lettering-check.js', () => ({ readLettering: async () => null }))
vi.mock('../services/flare-studio.js', async (original) => ({
  ...(await original<typeof import('../services/flare-studio.js')>()),
  runFlare,
}))

const { default: router } = await import('./flare-studio.js')

const app = express()
app.use(express.json())
app.use('/flare', router)

const body = { op: 'edit', imageUrl: 'https://cdn.test/a.png', prompt: 'add a hat', quality: 'high' }

let server: Server
beforeAll(() => { server = app.listen(0) })
afterAll(() => { server.close() })

async function run(): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/flare/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}
const named = 'gpt-image-2.6-flare edit: no image returned'

beforeEach(() => {
  role.value = 'customer'
  runFlare.mockReset()
  refundITC.mockClear()
})

describe('POST /flare/run when the model call fails', () => {
  it('tells a customer plainly, names no model, and refunds them', async () => {
    runFlare.mockRejectedValueOnce(new Error(named))

    const res = await run()

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('That edit could not be finished. Please try again.')
    expect(JSON.stringify(res.body)).not.toMatch(/gpt|openai|flare/i)
    expect(refundITC).toHaveBeenCalledWith('user-1', 40, 'flare_edit_failed')
  })

  it('names no model when the edit is declined either', async () => {
    runFlare.mockRejectedValueOnce(new Error('rejected by the safety system (model: gpt-image-2.6-flare)'))

    const res = await run()

    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).not.toMatch(/gpt|openai|flare|image model/i)
  })

  it('gives the team the raw error, because they are the ones who fix it', async () => {
    role.value = 'admin'
    runFlare.mockRejectedValueOnce(new Error(named))

    const res = await run()

    expect(res.body.error).toBe(named)
  })
})
