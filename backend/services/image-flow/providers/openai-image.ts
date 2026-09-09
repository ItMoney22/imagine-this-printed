// OpenAI-direct image provider. The canonical "gpt-image flow" used everywhere
// we'd otherwise pay Replicate's margin + queue latency for GPT image work: the
// Imagination Station PREMIUM tier (generate), the admin product builder
// (one-shot generate + refine/edit), the metal mockups, and the Step Flow's
// on-person shots.
//
// Direct OpenAI is cheaper (no Replicate markup), dodges Replicate's <$5
// burst-1 rate limit entirely, and gpt-image returns base64 which we upload to
// GCS and hand back as a signed URL — same shape as the other providers.
//
// MODEL CHAIN, NOT A HARDCODED MODEL
// OpenAI ships image models faster than this account gets access to them: this
// file has already been rewritten once for gpt-image-1 -> gpt-image-2, and
// gpt-image-2.5 (2026-09) makes three. So the preference order is data, not
// control flow — every house pipeline comes through the two functions below,
// and each one walks the chain until a model this account can actually see
// answers. Making a just-announced model the default is therefore safe before
// access lands: it falls through, and the log line says which model ran.
//
// The chain is ONLY walked for "this account cannot use that model" errors.
// A moderation block or a rate limit is re-raised immediately — sending a
// rejected prompt down the chain just pays for the same rejection three times.

import OpenAI, { toFile } from 'openai'
import { uploadImageFromBase64 } from '../../google-cloud-storage.js'

// Lazy: the OpenAI SDK throws at construction when the key is unset, and this
// module is now in the import graph of worker-helpers (every worker/test that
// never touches OpenAI). Only a call site that actually generates should need
// the key.
let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

/**
 * `xhigh` and `max` are GPT Image 2.5 additions. They cost more and take
 * longer; nothing defaults to them, but a call site that needs the detail (a
 * print-resolution design, a hero shot) can now ask without a code change.
 */
type Quality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto'
type Background = 'opaque' | 'transparent' | 'auto'
/**
 * The three named sizes every gpt-image model supports, plus any
 * `WIDTHxHEIGHT` string — GPT Image 2.5 accepts arbitrary dimensions as long as
 * both sides are multiples of 16 and the aspect ratio stays between 1:3 and
 * 3:1. The loose arm is deliberately `(string & {})` so the three literals
 * still autocomplete.
 */
type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto' | (string & {})

/**
 * Preference order, best-first. Flare is OpenAI's fast, high-quality default
 * (better output than GPT Image 2 at roughly half the latency), and the two
 * behind it are what this account was already running — so if 2.5 access is not
 * on the key yet, every pipeline quietly degrades to what it had yesterday
 * instead of failing.
 */
export const DEFAULT_OPENAI_IMAGE_CHAIN = ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1'] as const

/**
 * The precision half of the 2.5 pair — slower, aimed at detailed creative work.
 * Named here rather than sprinkled through call sites so there is one place to
 * change when the next one ships. Not a default: the on-person shot already
 * takes minutes, and Sunburst would make that worse.
 */
export const OPENAI_IMAGE_PRECISION_MODEL = 'gpt-image-2.5-sunburst'

/** `OPENAI_IMAGE_MODELS=a,b,c` overrides the order without a deploy. */
function parseChain(raw: string | undefined): string[] {
  const parsed = (raw || '').split(',').map((s) => s.trim()).filter(Boolean)
  return parsed.length ? parsed : [...DEFAULT_OPENAI_IMAGE_CHAIN]
}

export const OPENAI_IMAGE_MODEL_CHAIN: string[] = parseChain(process.env.OPENAI_IMAGE_MODELS)

/** The order to try for one call: a pinned model first, then the rest as fallbacks. */
export function resolveModelChain(pinned?: string, chain: string[] = OPENAI_IMAGE_MODEL_CHAIN): string[] {
  if (!pinned) return [...chain]
  return [pinned, ...chain.filter((m) => m !== pinned)]
}

/**
 * True only for "this account cannot use that model".
 *
 * The predicate this replaced matched the literal string `gpt-image-2` anywhere
 * in the message, which meant any error that happened to quote the model name —
 * a safety rejection, most obviously — was treated as a missing model and sent
 * the same prompt down the chain to be paid for again. Availability is a 404
 * (`model_not_found`), so that is what is matched.
 */
export function isModelUnavailable(err: any): boolean {
  const status = err?.status ?? err?.response?.status
  const code = err?.error?.code || err?.code || ''
  if (code === 'model_not_found') return true
  if (status && status !== 404) return false
  const msg = err?.error?.message || err?.message || ''
  return /does not exist|do not have access|model.*not.*found|invalid model|unknown model/i.test(msg)
}

/** True for the GPT Image 2.5 family, which is what gained xhigh/max and free-form sizes. */
function isGpt25(model: string): boolean {
  return /gpt-image-2\.5/.test(model)
}

/**
 * Re-shape one request for the model that is actually about to run.
 *
 * The chain means a request built for GPT Image 2.5 can end up at GPT Image 2,
 * which rejects both of 2.5's additions — the `xhigh`/`max` quality tiers and
 * arbitrary `WIDTHxHEIGHT` sizes. Downgrading here keeps the fallback a
 * DEGRADE (a slightly less detailed image at a standard size) instead of a
 * hard failure, which is the whole promise the chain makes to its callers.
 */
export function paramsForModel(model: string, params: Record<string, unknown>): Record<string, unknown> {
  if (isGpt25(model)) return params
  const out = { ...params }

  if (out.quality === 'xhigh' || out.quality === 'max') out.quality = 'high'

  const size = typeof out.size === 'string' ? out.size : ''
  const NAMED = ['1024x1024', '1536x1024', '1024x1536', 'auto']
  if (size && !NAMED.includes(size)) {
    const [w, h] = size.split('x').map(Number)
    // Nearest standard frame in the same orientation — a landscape request must
    // not silently come back portrait.
    out.size = !w || !h ? '1024x1024' : w > h ? '1536x1024' : h > w ? '1024x1536' : '1024x1024'
  }
  return out
}

/**
 * Models this key has been told it cannot use, and when we were told.
 *
 * Without this, leading the chain with a model the account lacks would add a
 * wasted 404 round-trip to EVERY image call in the system — on pipelines that
 * already take minutes and that this repo is actively trying to make faster.
 * Verified live 2026-09-09: this key sees gpt-image-1/1.5/2 but not 2.5, so
 * that is the live path, not a hypothetical one.
 *
 * The entry EXPIRES rather than being permanent, so a long-running worker picks
 * up newly-granted access on its own — access lands on OpenAI's side with no
 * deploy on ours, and nobody should have to remember to restart a worker to
 * benefit from it.
 */
const unavailableUntil = new Map<string, number>()
const UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000

/** Exposed for tests; also handy from a REPL after an access change. */
export function clearModelAvailabilityCache(): void {
  unavailableUntil.clear()
}

function isKnownUnavailable(model: string, now: number): boolean {
  const until = unavailableUntil.get(model)
  if (until === undefined) return false
  if (until > now) return true
  unavailableUntil.delete(model)
  return false
}

/**
 * Walk the chain until a model answers. `call` is invoked once per model, so it
 * must be cheap to re-run — every caller below prepares its inputs (including
 * fetching source images) BEFORE handing the closure over.
 */
async function withModelChain<T>(
  chain: string[],
  call: (model: string) => Promise<T>,
  /**
   * A model the caller named explicitly. Always tried, even if it is cached as
   * unavailable: pinning is a deliberate act — typically the way someone checks
   * whether access has landed — and a cache that could not be challenged would
   * only clear itself on a TTL or a restart.
   */
  pinned?: string
): Promise<{ res: T; usedModel: string }> {
  const now = Date.now()
  // Never skip the last model either: if every entry is cached-unavailable (a
  // bad OPENAI_IMAGE_MODELS, or a key that lost access entirely) we still make
  // one real call and surface the real API error, rather than failing on stale
  // local bookkeeping.
  const live = chain.filter((m, i) => m === pinned || i === chain.length - 1 || !isKnownUnavailable(m, now))
  let lastErr: any
  for (const model of live) {
    try {
      const res = await call(model)
      // Answered — so any stale "unavailable" note about it is wrong.
      unavailableUntil.delete(model)
      return { res, usedModel: model }
    } catch (err: any) {
      if (!isModelUnavailable(err)) throw err
      if (!unavailableUntil.has(model)) {
        console.warn(`[openai-image] ${model} is not available on this key — falling back (rechecking in 6h)`)
      }
      unavailableUntil.set(model, Date.now() + UNAVAILABLE_TTL_MS)
      lastErr = err
    }
  }
  throw lastErr ?? new Error('no OpenAI image model configured')
}

function rand(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

async function persistB64(b64: string, objectPath?: string, userId?: string): Promise<string> {
  const path = objectPath || `users/${userId || 'anon'}/ai-generated/premium-${rand()}.png`
  const { publicUrl } = await uploadImageFromBase64(`data:image/png;base64,${b64}`, path)
  return publicUrl
}

export interface OpenAIImageOpts {
  prompt: string
  userId?: string
  /** Custom GCS object path; defaults to users/<userId>/ai-generated/...  */
  objectPath?: string
  background?: Background
  size?: ImageSize
  quality?: Quality
  /**
   * OpenAI content filter strictness. The standard ('auto') filter
   * false-positives on benign stylized design work (verified live 2026-08-20:
   * it blocked an edit referencing our own mascot PNG). House pipelines pass
   * 'low'; consumer-facing paths keep the default.
   */
  moderation?: 'auto' | 'low'
  /** Try this model first (e.g. OPENAI_IMAGE_PRECISION_MODEL); the chain stays as the fallback. */
  model?: string
}

/** Text-to-image, walking the model chain (see the header). */
export async function runOpenAIImage(opts: OpenAIImageOpts): Promise<{ url: string; modelId: string }> {
  const base = {
    prompt: opts.prompt,
    n: 1,
    size: opts.size || '1024x1024',
    quality: opts.quality || 'high',
    background: opts.background || 'opaque',
    output_format: 'png',
    ...(opts.moderation ? { moderation: opts.moderation } : {}),
  }
  const { res, usedModel } = await withModelChain(
    resolveModelChain(opts.model),
    (model) => client().images.generate({ model, ...paramsForModel(model, base) } as any),
    opts.model
  )
  const b64 = (res as any).data?.[0]?.b64_json
  if (!b64) throw new Error(`${usedModel}: no image returned`)
  const url = await persistB64(b64, opts.objectPath, opts.userId)
  return { url, modelId: `openai/${usedModel}` }
}

export interface OpenAIEditOpts {
  /** Source image (the design to edit). */
  sourceUrl: string
  /** Optional extra reference images (multi-image compositing). */
  refUrls?: string[]
  prompt: string
  userId?: string
  objectPath?: string
  /** Edits omit background by default so the source's background is preserved. */
  background?: Background
  size?: ImageSize
  quality?: Quality
  /** See OpenAIImageOpts.moderation. */
  moderation?: 'auto' | 'low'
  /** Try this model first (e.g. OPENAI_IMAGE_PRECISION_MODEL); the chain stays as the fallback. */
  model?: string
}

async function urlToFile(url: string, idx: number): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`edit source fetch ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const ct = resp.headers.get('content-type') || 'image/png'
  const ext = ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png'
  return toFile(buf, `edit-src-${idx}.${ext}`, { type: ct })
}

/** Image+prompt edit / compositing, walking the model chain (see the header). */
export async function editOpenAIImage(opts: OpenAIEditOpts): Promise<{ url: string; path: string; modelId: string }> {
  const urls = [opts.sourceUrl, ...(opts.refUrls ?? [])]
  // Fetched ONCE, ahead of the chain: a fallback that re-downloaded every
  // reference image would triple the egress on a compositing call.
  const files = await Promise.all(urls.map((u, i) => urlToFile(u, i)))
  const base: Record<string, unknown> = {
    image: files.length === 1 ? files[0] : files,
    prompt: opts.prompt,
    n: 1,
    size: opts.size || '1024x1024',
    quality: opts.quality || 'high',
  }
  if (opts.background) base.background = opts.background
  if (opts.moderation) base.moderation = opts.moderation

  const { res, usedModel } = await withModelChain(
    resolveModelChain(opts.model),
    (model) => client().images.edit({ model, ...paramsForModel(model, base) } as any),
    opts.model
  )
  const b64 = (res as any).data?.[0]?.b64_json
  if (!b64) throw new Error(`${usedModel} edit: no image returned`)
  const path = opts.objectPath || `users/${opts.userId || 'anon'}/edited/edit-${rand()}.png`
  const { publicUrl } = await uploadImageFromBase64(`data:image/png;base64,${b64}`, path)
  return { url: publicUrl, path, modelId: `openai/${usedModel}` }
}
