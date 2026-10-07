import { describe, it, expect } from 'vitest'
import {
  ProviderOutOfCreditError,
  creditProviderOf,
  isOpenAIOutOfCredit,
  isReplicateOutOfCredit,
} from './provider-credit.js'

// Every string below is copied from a real ai_jobs.error in production
// (read-only query, 2026-10-07). The classifier is only as good as its
// agreement with what the providers actually send.
const BODY =
  '{"title":"Insufficient credit","detail":"You have insufficient credit to run this model. Go to https://replicate.com/account/billing#billing to purchase credit. Once you purchase credit, please wait a few minutes before trying again.","status":402}\n'
const PROD = {
  imageFlow402: `replicate google/imagen-4-fast 402: ${BODY}`,
  nanoBanana402: `replicate google/nano-banana-2-lite 402: ${BODY}`,
  sdk402: `Request to https://api.replicate.com/v1/predictions failed with status 402 : ${BODY}.`,
  sdkThrottle429:
    'Request to https://api.replicate.com/v1/predictions failed with status 429 : {"detail":"Request was throttled. Your rate limit for creating predictions is reduced to 6 requests per minute with a burst of 1 requests while you have less than $5.0 in credit. Your rate limit resets in ~7s.","status":429,"retry_after":7}\n.',
  openaiNoCredits:
    '429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
}

describe('isReplicateOutOfCredit', () => {
  it('recognises the image-flow provider 402 (where all 65 failed mockups came from)', () => {
    expect(isReplicateOutOfCredit(new Error(PROD.imageFlow402))).toBe(true)
    expect(isReplicateOutOfCredit(new Error(PROD.nanoBanana402))).toBe(true)
  })

  it('recognises the Replicate SDK 402 (the 12 failed background cuts)', () => {
    expect(isReplicateOutOfCredit(new Error(PROD.sdk402))).toBe(true)
  })

  it('recognises an SDK ApiError by status even without the body text', () => {
    const err = Object.assign(new Error('Payment Required'), {
      response: { status: 402 },
      request: { url: 'https://api.replicate.com/v1/predictions' },
    })
    expect(isReplicateOutOfCredit(err)).toBe(true)
  })

  it('does NOT treat the low-credit 429 throttle as out of credit — that account still has money', () => {
    expect(isReplicateOutOfCredit(new Error(PROD.sdkThrottle429))).toBe(false)
  })

  it('does not claim a 402 from some other service', () => {
    expect(isReplicateOutOfCredit(Object.assign(new Error('Payment Required'), { status: 402 }))).toBe(false)
  })

  it('ignores ordinary generation failures', () => {
    expect(isReplicateOutOfCredit(new Error('replicate black-forest-labs/flux-2-pro failed: E005 sensitive content'))).toBe(false)
    expect(isReplicateOutOfCredit(new Error('replicate google/imagen-4-fast 404: {"detail":"Not found"}'))).toBe(false)
  })
})

describe('isOpenAIOutOfCredit', () => {
  it('recognises the empty-wallet 429 production recorded', () => {
    expect(isOpenAIOutOfCredit(Object.assign(new Error(PROD.openaiNoCredits), { status: 429 }))).toBe(true)
  })

  it('recognises the documented codes', () => {
    expect(isOpenAIOutOfCredit({ status: 429, code: 'insufficient_quota', message: 'x' })).toBe(true)
    expect(isOpenAIOutOfCredit({ status: 400, error: { code: 'billing_hard_limit_reached', message: 'x' } })).toBe(true)
    expect(isOpenAIOutOfCredit(new Error('429 You exceeded your current quota, please check your plan and billing details.'))).toBe(true)
  })

  it('does NOT treat a plain rate limit as out of credit', () => {
    expect(isOpenAIOutOfCredit({ status: 429, code: 'rate_limit_exceeded', message: 'Rate limit reached for gpt-image-2' })).toBe(false)
  })

  it('ignores moderation blocks and missing models', () => {
    expect(isOpenAIOutOfCredit({ status: 400, code: 'moderation_blocked', message: 'Your request was rejected by the safety system' })).toBe(false)
    expect(isOpenAIOutOfCredit({ status: 404, code: 'model_not_found', message: 'The model gpt-image-2.5-flare does not exist' })).toBe(false)
  })
})

describe('creditProviderOf', () => {
  it('reads the typed error first', () => {
    expect(creditProviderOf(new ProviderOutOfCreditError('openai', 'anything'))).toBe('openai')
    expect(creditProviderOf(new ProviderOutOfCreditError('replicate', 'anything'))).toBe('replicate')
  })

  it('still finds the provider in a credit error that was wrapped on the way up', () => {
    expect(creditProviderOf(new Error(`Flare couldn't render this shot: ${PROD.openaiNoCredits}`))).toBe('openai')
    expect(creditProviderOf(new Error(`All 4 models failed: Flux 2 Pro: ${PROD.imageFlow402}; Grok: timeout`))).toBe('replicate')
  })

  it('returns null for an ordinary failure', () => {
    expect(creditProviderOf(new Error('No source image available for mockup generation'))).toBeNull()
    expect(creditProviderOf(new Error(PROD.sdkThrottle429))).toBeNull()
    expect(creditProviderOf(undefined)).toBeNull()
  })

  it('keeps the provider text as the error message so logs read as before', () => {
    const err = new ProviderOutOfCreditError('replicate', PROD.imageFlow402, { status: 402 })
    expect(err.message).toBe(PROD.imageFlow402)
    expect(err.code).toBe('PROVIDER_OUT_OF_CREDIT')
    expect(err.status).toBe(402)
  })
})
