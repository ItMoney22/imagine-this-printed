// Transport tests for the FASHN try-on client — Watchtower task 3b362203.
//
// Every case injects a fake transport, so this suite never reaches the network
// and never spends a credit. What matters here is that a failure reports zero
// credits used: services/virtual-tryon.ts refunds off that number, and a client
// that over-reports would charge shoppers for renders FASHN never billed us for.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runTryOn, resolveTier, isTryOnEnabled, TRYON_TIERS, type FashnTransport } from './fashn-tryon.js'

const BASE_PARAMS = {
  modelImage: 'https://example.test/shopper.jpg',
  garmentImage: 'https://example.test/tee.jpg',
  mode: 'balanced' as const,
  numSamples: 1
}

/** Fake transport: scripted responses, an instant clock, no sleeping. */
function makeTransport(responses: Array<{ status: number; body: any }>) {
  const calls: Array<{ url: string; init?: any }> = []
  let tick = 0
  const transport: FashnTransport = {
    fetch: (async (url: any, init?: any) => {
      calls.push({ url: String(url), init })
      const next = responses.shift()
      if (!next) throw new Error(`unexpected fetch to ${url}`)
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
        text: async () => JSON.stringify(next.body)
      } as any
    }) as any,
    sleep: async () => { tick += 1500 },
    now: () => 1_000_000 + tick
  }
  return { transport, calls }
}

describe('runTryOn', () => {
  beforeEach(() => { process.env.FASHN_API_KEY = 'test-key' })
  afterEach(() => { delete process.env.FASHN_API_KEY })

  it('submits tryon-v1.6 and polls to completion', async () => {
    const { transport, calls } = makeTransport([
      { status: 200, body: { id: 'pred-1' } },
      { status: 200, body: { status: 'in_queue' } },
      { status: 200, body: { status: 'processing' } },
      { status: 200, body: { status: 'completed', output: ['https://cdn.fashn.ai/out_0.png'] } }
    ])

    const result = await runTryOn(BASE_PARAMS, transport)

    expect(result.ok).toBe(true)
    expect(result.images).toEqual(['https://cdn.fashn.ai/out_0.png'])
    expect(result.predictionId).toBe('pred-1')
    expect(calls[0].url).toMatch(/\/run$/)
    expect(JSON.parse(calls[0].init.body).model_name).toBe('tryon-v1.6')
    expect(calls[1].url).toMatch(/\/status\/pred-1$/)
  })

  it('bills per OUTPUT, not per requested sample', async () => {
    const { transport } = makeTransport([
      { status: 200, body: { id: 'pred-2' } },
      { status: 200, body: { status: 'completed', output: ['a.png', 'b.png'] } }
    ])

    const result = await runTryOn({ ...BASE_PARAMS, numSamples: 4 }, transport)
    expect(result.creditsUsed).toBe(2)
    expect(result.costUsd).toBeCloseTo(0.15, 5)
  })

  it('reports ZERO credits when the prediction fails', async () => {
    const { transport } = makeTransport([
      { status: 200, body: { id: 'pred-3' } },
      { status: 200, body: { status: 'failed', error: 'PoseError' } }
    ])

    const result = await runTryOn(BASE_PARAMS, transport)
    expect(result.ok).toBe(false)
    expect(result.creditsUsed).toBe(0)
    expect(result.costUsd).toBe(0)
    expect(result.error).toMatch(/PoseError/)
  })

  it('reports zero credits when the submit itself is rejected', async () => {
    const { transport } = makeTransport([{ status: 402, body: { error: 'out of credits' } }])

    const result = await runTryOn(BASE_PARAMS, transport)
    expect(result.ok).toBe(false)
    expect(result.creditsUsed).toBe(0)
    expect(result.error).toMatch(/HTTP 402/)
  })

  it('rides out a transient 5xx on a poll instead of discarding the render', async () => {
    const { transport } = makeTransport([
      { status: 200, body: { id: 'pred-4' } },
      { status: 503, body: {} },
      { status: 200, body: { status: 'completed', output: ['ok.png'] } }
    ])

    const result = await runTryOn(BASE_PARAMS, transport)
    expect(result.ok).toBe(true)
    expect(result.images).toEqual(['ok.png'])
  })

  it('fails closed when a completed prediction carries no image', async () => {
    const { transport } = makeTransport([
      { status: 200, body: { id: 'pred-5' } },
      { status: 200, body: { status: 'completed', output: [] } }
    ])

    const result = await runTryOn(BASE_PARAMS, transport)
    expect(result.ok).toBe(false)
    expect(result.creditsUsed).toBe(0)
  })

  it('sends the strictest moderation level — these are photos of real customers', async () => {
    const { transport, calls } = makeTransport([
      { status: 200, body: { id: 'pred-6' } },
      { status: 200, body: { status: 'completed', output: ['x.png'] } }
    ])

    await runTryOn(BASE_PARAMS, transport)
    expect(JSON.parse(calls[0].init.body).inputs.moderation_level).toBe('conservative')
  })

  it('throws only on missing configuration, never on a shopper-visible failure', async () => {
    delete process.env.FASHN_API_KEY
    const { transport } = makeTransport([])
    await expect(runTryOn(BASE_PARAMS, transport)).rejects.toThrow(/FASHN_API_KEY/)
  })
})

describe('tier + flag resolution', () => {
  afterEach(() => {
    delete process.env.FASHN_API_KEY
    delete process.env.TRYON_ENABLED
  })

  it('defaults an unknown tier name to standard', () => {
    expect(resolveTier(undefined)).toBe(TRYON_TIERS.standard)
    expect(resolveTier('nonsense')).toBe(TRYON_TIERS.standard)
    expect(resolveTier('premium')).toBe(TRYON_TIERS.premium)
  })

  it('stays dark without an API key', () => {
    expect(isTryOnEnabled()).toBe(false)
    process.env.FASHN_API_KEY = 'k'
    expect(isTryOnEnabled()).toBe(true)
  })

  it('can be killed with TRYON_ENABLED=false even with a key present', () => {
    process.env.FASHN_API_KEY = 'k'
    process.env.TRYON_ENABLED = 'false'
    expect(isTryOnEnabled()).toBe(false)
  })
})
