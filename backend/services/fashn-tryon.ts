// ---------------------------------------------------------------------------
// FASHN Virtual Try-On v1.6 client.
//
// Watchtower task 3b362203 — buyer-side try-on. This module is ONLY the
// transport: submit a prediction, poll it, hand back a URL and what it cost.
// The token gate, daily cap and analytics live in services/virtual-tryon.ts.
//
// API shape (verified 2026-08-16 against docs.fashn.ai):
//   POST https://api.fashn.ai/v1/run          { model_name, inputs }  -> { id }
//   GET  https://api.fashn.ai/v1/status/{id}                          -> { status, output[], error }
//   Authorization: Bearer <FASHN_API_KEY>
//   statuses: starting | in_queue | processing | completed | failed
//
// COST: 1 credit per successful OUTPUT (so num_samples multiplies it).
// $0.075/credit on-demand, $0.0488 at commitment tier III. Failed predictions
// do not consume credits — which is why chargeback/refund in virtual-tryon.ts
// keys off `status === 'failed'` rather than off any HTTP error.
//
// DELIBERATELY NOT USED FOR CATALOG OR ON-MODEL PHOTOGRAPHY. At $0.075 this is
// ~2.5x a gpt-image-2 1K render; services/etsy-model-shots.ts already does
// listing photography for less. This client is buyer-facing only.
// ---------------------------------------------------------------------------

const FASHN_BASE_URL = process.env.FASHN_BASE_URL || 'https://api.fashn.ai/v1'
const FASHN_MODEL_NAME = process.env.FASHN_MODEL_NAME || 'tryon-v1.6'

/**
 * What one FASHN credit costs us in USD. Defaults to the on-demand rate; drop
 * it to 0.0488 in the environment once we're on commitment tier III so the
 * cost-per-conversion report in /api/tryon/analytics stays honest.
 */
export const FASHN_COST_PER_CREDIT_USD = Number(process.env.FASHN_COST_PER_CREDIT_USD) || 0.075

/** Master kill switch. The feature is dark until BOTH of these are set. */
export function isTryOnEnabled(): boolean {
  return Boolean(process.env.FASHN_API_KEY) && process.env.TRYON_ENABLED !== 'false'
}

export type FashnMode = 'performance' | 'balanced' | 'quality'
export type FashnCategory = 'auto' | 'tops' | 'bottoms' | 'one-pieces'

export interface TryOnTier {
  /** imagination_pricing.feature_key — the admin panel retunes cost by this. */
  featureKey: 'tryon_standard' | 'tryon_premium'
  label: string
  mode: FashnMode
  /** FASHN bills per output, so this is also the credit count. 1..4. */
  numSamples: number
  /** Fallback ITC price if the imagination_pricing row is missing. */
  fallbackItcCost: number
}

/**
 * The two tiers a shopper can pick. Both are real cost differences, not
 * cosmetic: premium runs `quality` mode and returns two poses, which is two
 * FASHN credits.
 */
export const TRYON_TIERS: Record<'standard' | 'premium', TryOnTier> = {
  standard: {
    featureKey: 'tryon_standard',
    label: 'Standard',
    mode: 'balanced',
    numSamples: 1,
    fallbackItcCost: 10
  },
  premium: {
    featureKey: 'tryon_premium',
    label: 'Premium',
    mode: 'quality',
    numSamples: 2,
    fallbackItcCost: 25
  }
}

export type TryOnTierName = keyof typeof TRYON_TIERS

export function resolveTier(name: unknown): TryOnTier {
  return name === 'premium' ? TRYON_TIERS.premium : TRYON_TIERS.standard
}

/** The free daily try-on is always the cheapest possible call. */
export const FREE_TIER: TryOnTier = {
  featureKey: 'tryon_standard',
  label: 'Daily free',
  mode: 'performance',
  numSamples: 1,
  fallbackItcCost: 0
}

export interface RunTryOnParams {
  /** The shopper's photo — https URL or a data: URI. */
  modelImage: string
  /** The garment — the product's flat mockup, as an https URL or data: URI. */
  garmentImage: string
  mode: FashnMode
  numSamples: number
  category?: FashnCategory
  /** 'flat-lay' for our product mockups, 'model' for lifestyle shots. */
  garmentPhotoType?: 'auto' | 'flat-lay' | 'model'
  seed?: number
}

export interface RunTryOnResult {
  ok: boolean
  predictionId: string | null
  /** Output image URLs, one per sample. */
  images: string[]
  /** Credits actually consumed — 0 on a failed prediction (FASHN doesn't bill those). */
  creditsUsed: number
  costUsd: number
  latencyMs: number
  error?: string
}

/** Injected in tests so no suite ever hits the live API. */
export interface FashnTransport {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const defaultTransport: FashnTransport = {
  fetch: (...args) => fetch(...(args as Parameters<typeof fetch>)),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now()
}

const POLL_INTERVAL_MS = Number(process.env.FASHN_POLL_INTERVAL_MS) || 1500
const POLL_TIMEOUT_MS = Number(process.env.FASHN_POLL_TIMEOUT_MS) || 90_000

/**
 * Submit a try-on and poll it to a terminal state.
 *
 * Never throws for an API-level failure — a shopper who gets a 500 from FASHN
 * must not be charged, and the caller decides that from `ok`/`creditsUsed`.
 * It only throws if the module is misconfigured (no API key), which is a
 * deploy problem, not a shopper problem.
 */
export async function runTryOn(
  params: RunTryOnParams,
  transport: FashnTransport = defaultTransport
): Promise<RunTryOnResult> {
  const apiKey = process.env.FASHN_API_KEY
  if (!apiKey) throw new Error('FASHN_API_KEY is not configured')

  const startedAt = transport.now()
  const fail = (error: string, predictionId: string | null = null): RunTryOnResult => ({
    ok: false,
    predictionId,
    images: [],
    creditsUsed: 0,
    costUsd: 0,
    latencyMs: transport.now() - startedAt,
    error
  })

  let predictionId: string | null = null

  try {
    const runRes = await transport.fetch(`${FASHN_BASE_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model_name: FASHN_MODEL_NAME,
        inputs: {
          model_image: params.modelImage,
          garment_image: params.garmentImage,
          category: params.category || 'auto',
          mode: params.mode,
          num_samples: params.numSamples,
          garment_photo_type: params.garmentPhotoType || 'flat-lay',
          // 'conservative' is the strictest setting FASHN offers. This endpoint
          // takes photographs of real customers, so we take the strictest one.
          moderation_level: 'conservative',
          output_format: 'jpeg',
          ...(params.seed !== undefined ? { seed: params.seed } : {})
        }
      })
    })

    if (!runRes.ok) {
      const body = await runRes.text().catch(() => '')
      return fail(`FASHN run failed (HTTP ${runRes.status}): ${body.slice(0, 300)}`)
    }

    const runJson: any = await runRes.json().catch(() => null)
    predictionId = runJson?.id ? String(runJson.id) : null
    if (!predictionId) return fail('FASHN returned no prediction id')

    // Poll to a terminal state.
    const deadline = startedAt + POLL_TIMEOUT_MS
    while (transport.now() < deadline) {
      await transport.sleep(POLL_INTERVAL_MS)

      const statusRes = await transport.fetch(`${FASHN_BASE_URL}/status/${predictionId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })

      if (!statusRes.ok) {
        // A transient 5xx on a poll is not a dead prediction — keep polling
        // until the deadline rather than throwing away a paid render.
        if (statusRes.status >= 500) continue
        const body = await statusRes.text().catch(() => '')
        return fail(`FASHN status failed (HTTP ${statusRes.status}): ${body.slice(0, 300)}`, predictionId)
      }

      const statusJson: any = await statusRes.json().catch(() => null)
      const status = String(statusJson?.status || '')

      if (status === 'completed') {
        const images: string[] = Array.isArray(statusJson?.output)
          ? statusJson.output.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
          : []
        if (!images.length) return fail('FASHN completed with no output image', predictionId)

        // Bill on outputs actually produced, not on what we asked for.
        const creditsUsed = images.length
        return {
          ok: true,
          predictionId,
          images,
          creditsUsed,
          costUsd: Number((creditsUsed * FASHN_COST_PER_CREDIT_USD).toFixed(5)),
          latencyMs: transport.now() - startedAt
        }
      }

      if (status === 'failed' || status === 'canceled') {
        const err = typeof statusJson?.error === 'string'
          ? statusJson.error
          : JSON.stringify(statusJson?.error ?? status)
        return fail(`FASHN prediction ${status}: ${String(err).slice(0, 300)}`, predictionId)
      }
      // starting | in_queue | processing -> keep polling
    }

    return fail('FASHN prediction timed out', predictionId)
  } catch (err: any) {
    return fail(`FASHN request error: ${err?.message || String(err)}`, predictionId)
  }
}
