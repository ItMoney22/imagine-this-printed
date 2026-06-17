// OpenAI-direct image provider (gpt-image-2). The canonical "new gpt-image-2
// flow" used everywhere we'd otherwise pay Replicate's margin + queue latency
// for GPT image work: the Imagination Station PREMIUM tier (generate) and the
// admin product builder (one-shot generate + refine/edit).
//
// Direct OpenAI is cheaper (no Replicate markup), dodges Replicate's <$5
// burst-1 rate limit entirely, and gpt-image returns base64 which we upload to
// GCS and hand back as a signed URL — same shape as the other providers.
// Falls back to gpt-image-1 if gpt-image-2 isn't accessible on the account.

import OpenAI, { toFile } from 'openai'
import { uploadImageFromBase64 } from '../../google-cloud-storage.js'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type Quality = 'low' | 'medium' | 'high' | 'auto'
type Background = 'opaque' | 'transparent' | 'auto'

function isModelMissing(err: any): boolean {
  const msg = err?.error?.message || err?.message || ''
  return /gpt-image-2|model.*not.*found|does not exist|invalid model/i.test(msg)
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
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
  quality?: Quality
}

/** Text-to-image via OpenAI gpt-image-2 (falls back to gpt-image-1). */
export async function runOpenAIImage(opts: OpenAIImageOpts): Promise<{ url: string; modelId: string }> {
  const base = {
    prompt: opts.prompt,
    n: 1,
    size: opts.size || '1024x1024',
    quality: opts.quality || 'high',
    background: opts.background || 'opaque',
    output_format: 'png',
  }
  let usedModel = 'gpt-image-2'
  let res: any
  try {
    res = await client.images.generate({ model: 'gpt-image-2', ...base } as any)
  } catch (err: any) {
    if (!isModelMissing(err)) throw err
    usedModel = 'gpt-image-1'
    res = await client.images.generate({ model: 'gpt-image-1', ...base } as any)
  }
  const b64 = res.data?.[0]?.b64_json
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
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
  quality?: Quality
}

async function urlToFile(url: string, idx: number): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`edit source fetch ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const ct = resp.headers.get('content-type') || 'image/png'
  const ext = ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png'
  return toFile(buf, `edit-src-${idx}.${ext}`, { type: ct })
}

/** Image+prompt edit / compositing via OpenAI gpt-image-2 (falls back to gpt-image-1). */
export async function editOpenAIImage(opts: OpenAIEditOpts): Promise<{ url: string; path: string; modelId: string }> {
  const urls = [opts.sourceUrl, ...(opts.refUrls ?? [])]
  const files = await Promise.all(urls.map((u, i) => urlToFile(u, i)))
  const base: Record<string, unknown> = {
    image: files.length === 1 ? files[0] : files,
    prompt: opts.prompt,
    n: 1,
    size: opts.size || '1024x1024',
    quality: opts.quality || 'high',
  }
  if (opts.background) base.background = opts.background

  let usedModel = 'gpt-image-2'
  let res: any
  try {
    res = await client.images.edit({ model: 'gpt-image-2', ...base } as any)
  } catch (err: any) {
    if (!isModelMissing(err)) throw err
    usedModel = 'gpt-image-1'
    res = await client.images.edit({ model: 'gpt-image-1', ...base } as any)
  }
  const b64 = res.data?.[0]?.b64_json
  if (!b64) throw new Error(`${usedModel} edit: no image returned`)
  const path = opts.objectPath || `users/${opts.userId || 'anon'}/edited/edit-${rand()}.png`
  const { publicUrl } = await uploadImageFromBase64(`data:image/png;base64,${b64}`, path)
  return { url: publicUrl, path, modelId: `openai/${usedModel}` }
}
