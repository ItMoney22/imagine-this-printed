// "The provider has no money" vs "the image went wrong" — told apart in one place.
//
// 2026-10-07 (task dbce13a8): 77 ai_jobs failed in 90 days on a Replicate 402
// "Insufficient credit" (65 mockups + 12 background cuts, 8/24-8/30), and all 6
// failed Mrs. Imagine batches were an empty OpenAI wallet. Every one of those
// was a job that would have rendered fine an hour later, recorded as a failure.
// The queue can only pause instead of failing if it can recognise the outage,
// so the two providers' "no credit" shapes live here, as data, next to the
// error type their call sites now throw.
//
// Pure and dependency-free on purpose: the worker, the image-flow providers and
// the tests all import it, and none of them should have to construct an SDK
// client (or hold an API key) just to read an error.

export type CreditProvider = 'replicate' | 'openai'

export const CREDIT_PROVIDER_LABEL: Record<CreditProvider, string> = {
  replicate: 'Replicate',
  openai: 'OpenAI',
}

/**
 * What a credit probe learned. 'inconclusive' (network error, a 5xx, a throttle)
 * never resumes the queue: only a call the provider actually accepted does.
 */
export interface CreditProbeResult {
  outcome: 'ok' | 'out_of_credit' | 'inconclusive'
  detail: string
}

/**
 * Thrown by provider call sites (services/replicate.ts, image-flow's replicate
 * provider, openai-image.ts) when the account is out of credit. The message is
 * the provider's own text, unchanged, so logs and anything that already greps
 * error strings read exactly as before.
 */
export class ProviderOutOfCreditError extends Error {
  readonly code = 'PROVIDER_OUT_OF_CREDIT'
  readonly provider: CreditProvider
  readonly status?: number

  constructor(provider: CreditProvider, message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message)
    this.name = 'ProviderOutOfCreditError'
    this.provider = provider
    this.status = opts.status
    if (opts.cause !== undefined) (this as any).cause = opts.cause
  }
}

function messageOf(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  const e = err as any
  return String(e?.error?.message || e?.message || '')
}

function statusOf(err: unknown): number | undefined {
  const e = err as any
  const s = e?.status ?? e?.response?.status
  return typeof s === 'number' ? s : undefined
}

/**
 * Replicate's out-of-credit answer, in every shape production has recorded:
 *   image-flow fetch:  `replicate google/imagen-4-fast 402: {"title":"Insufficient credit",...}`
 *   replicate SDK:     `Request to https://api.replicate.com/v1/predictions failed with status 402 : {...}`
 * Matched on the body's "Insufficient credit" title, or on a 402 that names
 * Replicate. A 429 "less than $5.0 in credit" throttle is NOT this — that
 * account still has money and the call is worth retrying.
 */
export function isReplicateOutOfCredit(err: unknown): boolean {
  const msg = messageOf(err)
  if (/insufficient credit/i.test(msg)) return true
  const url = String((err as any)?.request?.url ?? '')
  if (statusOf(err) === 402 && /replicate/i.test(`${msg} ${url}`)) return true
  return /replicate[^\n]*?\b402\b/i.test(msg)
}

/**
 * OpenAI's no-money answers. Production saw `429 You have no credits remaining`
 * (prepaid balance at zero); the API's documented codes are `insufficient_quota`
 * (429) and `billing_hard_limit_reached` (400). A plain 429 rate limit is NOT
 * this — it has money and only needs to slow down — so status alone never counts.
 */
export function isOpenAIOutOfCredit(err: unknown): boolean {
  const e = err as any
  const code = String(e?.code || e?.error?.code || e?.error?.type || '')
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return true
  return /no credits remaining|exceeded your current quota|insufficient_quota|billing hard limit/i.test(messageOf(err))
}

/**
 * Which provider ran dry, or null for an ordinary failure. Reads the typed
 * error first, then falls back to the text — a credit error that was wrapped on
 * the way up (`Flare couldn't render this shot: 429 ...`, or the multi-model
 * `All 4 models failed: ...` join) still has to pause, not fail.
 */
export function creditProviderOf(err: unknown): CreditProvider | null {
  if (err instanceof ProviderOutOfCreditError) return err.provider
  const e = err as any
  if (e?.code === 'PROVIDER_OUT_OF_CREDIT' && (e.provider === 'replicate' || e.provider === 'openai')) return e.provider
  if (isReplicateOutOfCredit(err)) return 'replicate'
  if (isOpenAIOutOfCredit(err)) return 'openai'
  return null
}
