// ---------------------------------------------------------------------------
// Etsy model shots — AI on-model photos for listing images.
//
// David 2026-07-26: listing images should be model mockups, not the mascot
// (Mr. Imagine stays in shop branding). Each candidate gets a small set of
// on-model photos with the ACTUAL design composited via the same nano-banana
// virtual try-on the realistic-mockups route uses: a stock model base photo +
// the raw design art as reference images, with the prompt hammering exact
// design reproduction (AI re-drawing a print garbles text, and Etsy requires
// photos to accurately show the product).
//
// Results land in products.metadata.etsy_shots = {status, images[], ...}.
// The publisher (services/etsy.ts) uploads these FIRST so the hero image on
// Etsy is a model shot, then falls back to the product's flat mockups.
//
// Generation is fire-and-forget: the admin route returns 202 immediately and
// the panel polls candidates until status flips to done/failed (~30-60s/shot,
// shots run sequentially to stay rate-limit friendly).
// ---------------------------------------------------------------------------
import Replicate from 'replicate'
import { supabase } from '../lib/supabase.js'
import * as gcsStorage from './gcs-storage.js'

const NANO_BANANA = 'google/nano-banana:858e56734846d24469ed35a07ca2161aaf4f83588d7060e32964926e1b73b7be'
const STOCK_MODEL_BASE = 'https://storage.googleapis.com/imagine-this-printed-media/stock-models'

const replicate = process.env.REPLICATE_API_TOKEN ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN }) : null

export interface EtsyShots {
  status: 'generating' | 'done' | 'failed'
  images: string[]
  started_at?: string
  generated_at?: string
  error?: string
}

// Two looks per listing: a clean studio hero and a candid lifestyle shot.
// Different models/scenes so the listing doesn't read as one photoshoot clone.
const SHOT_SPECS = [
  {
    key: 'hero',
    model: 'female-caucasian-athletic',
    scene: 'clean bright studio background with soft even daylight, front-facing, relaxed confident pose'
  },
  {
    key: 'lifestyle',
    model: 'male-caucasian-athletic',
    scene: 'casual city street at golden hour, natural candid pose, shallow depth of field'
  }
] as const

function buildPrompt(scene: string, shirtColor: string): string {
  return (
    `Professional ecommerce fashion photograph: a model wearing a ${shirtColor} crew neck t-shirt, ${scene}. ` +
    'Show the full torso from shoulders to waist with realistic fabric texture, natural drape, and true-to-life lighting. ' +
    'Apply the exact graphic artwork from the reference design image onto the chest print area of the shirt. ' +
    'CRITICAL: reproduce the design precisely as provided — do not redraw, restyle, distort, crop, or alter any letters, ' +
    'words, lines, or colors in the artwork. The print must match the reference image exactly. ' +
    'High-resolution product photography suitable for an online marketplace listing.'
  )
}

// Normalize Replicate output (string | array | async iterator, URL or raw
// bytes) into a Buffer — same quirks the realistic-mockups route handles.
async function outputToBuffer(output: any): Promise<Buffer> {
  let value: string | null = null
  if (typeof output === 'string') {
    value = output
  } else if (Array.isArray(output) && output.length > 0) {
    value = typeof output[0] === 'string' ? output[0] : output[0]?.url ?? String(output[0])
  } else if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
    const chunks: string[] = []
    for await (const item of output as AsyncIterable<any>) {
      if (typeof item === 'string') chunks.push(item)
      else if (item && typeof item === 'object' && 'url' in item) chunks.push(item.url)
      else if (item != null) chunks.push(String(item))
    }
    if (chunks.length) {
      value = chunks[0]?.match(/^137,80,78,71/) ? chunks.join(',') : chunks[0]
    }
  } else if (output && typeof output === 'object' && 'url' in output) {
    value = typeof (output as any).url === 'function' ? String((output as any).url()) : String((output as any).url)
  }
  if (!value) throw new Error('No usable output from the image model')

  if (value.startsWith('http://') || value.startsWith('https://')) {
    const res = await fetch(value)
    if (!res.ok) throw new Error(`Failed to download generated shot (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }
  // Raw comma-separated byte stream (chunked binary quirk)
  return Buffer.from(value.split(',').map(b => parseInt(b.trim(), 10)))
}

async function stockModelUrl(preferred: string): Promise<string> {
  const chain = [
    `${STOCK_MODEL_BASE}/${preferred}.jpg`,
    `${STOCK_MODEL_BASE}/female-caucasian-athletic.jpg`,
    `${STOCK_MODEL_BASE}/male-caucasian-athletic.jpg`
  ]
  for (const url of chain) {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) return url
    } catch { /* try next */ }
  }
  return chain[0]
}

// The design reference the model "wears": prefer the raw source art, fall back
// to the product's hero mockup (better than nothing — the art is on it).
async function designReferenceUrl(product: any): Promise<string | null> {
  const { data: assets } = await supabase
    .from('product_assets')
    .select('url, kind, is_primary, display_order')
    .eq('product_id', product.id)
    .eq('kind', 'source')
    .order('is_primary', { ascending: false })
    .order('display_order', { ascending: true })
    .limit(1)
  if (assets?.[0]?.url) return assets[0].url
  return Array.isArray(product.images) ? product.images[0] ?? null : null
}

async function saveShotsState(productId: string, patch: Partial<EtsyShots>): Promise<void> {
  // Re-read metadata at write time so a compose that finished mid-generation
  // isn't clobbered (single-admin flow; last-write-wins is acceptable here).
  const { data: product } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  const metadata = (product as any)?.metadata || {}
  const current: EtsyShots = metadata.etsy_shots || { status: 'generating', images: [] }
  await supabase
    .from('products')
    .update({ metadata: { ...metadata, etsy_shots: { ...current, ...patch } } })
    .eq('id', productId)
}

async function generateShots(productId: string, userId: string): Promise<void> {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('id, name, images, metadata')
      .eq('id', productId)
      .maybeSingle()
    if (error || !product) throw new Error(error?.message || 'product not found')

    const designUrl = await designReferenceUrl(product)
    if (!designUrl) throw new Error('No design art or product image to composite')

    const shirtColor = String(
      (product as any).metadata?.shirt_color || (product as any).metadata?.dtf_settings?.shirt_color || 'black'
    )

    const images: string[] = []
    for (const spec of SHOT_SPECS) {
      const modelUrl = await stockModelUrl(spec.model)
      const output = await replicate!.run(NANO_BANANA as any, {
        input: {
          prompt: buildPrompt(spec.scene, shirtColor),
          image_input: [modelUrl, designUrl],
          output_format: 'png',
          aspect_ratio: '3:4'
        }
      })
      const buffer = await outputToBuffer(output)
      const upload = await gcsStorage.uploadFile(buffer, {
        userId,
        folder: 'mockups',
        filename: `etsy_shot_${productId}_${spec.key}_${Date.now()}.png`,
        contentType: 'image/png',
        metadata: { productId, shot: spec.key, purpose: 'etsy-listing' }
      })
      images.push(upload.publicUrl)
      // Persist incrementally so a failure on shot 2 still keeps shot 1.
      await saveShotsState(productId, { images: [...images] })
      console.log(`[etsy-shots] ${productId} ${spec.key} → ${upload.publicUrl}`)
    }

    await saveShotsState(productId, { status: 'done', images, generated_at: new Date().toISOString(), error: undefined })
  } catch (err: any) {
    console.error(`[etsy-shots] generation failed for ${productId}:`, err?.message || err)
    await saveShotsState(productId, { status: 'failed', error: String(err?.message || err).slice(0, 300) })
  }
}

// Kick off generation in the background. Returns immediately; the panel polls
// candidates until metadata.etsy_shots.status is done/failed.
export async function startModelShots(productId: string, userId: string): Promise<EtsyShots> {
  if (!replicate) throw new Error('REPLICATE_API_TOKEN is not configured')

  const { data: product, error } = await supabase
    .from('products')
    .select('id, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const existing: EtsyShots | undefined = (product as any).metadata?.etsy_shots
  if (existing?.status === 'generating') {
    // Stale claims (crashed process) unlock after 10 minutes.
    const age = Date.now() - new Date(existing.started_at || 0).getTime()
    if (age < 10 * 60 * 1000) return existing
  }

  const state: EtsyShots = { status: 'generating', images: [], started_at: new Date().toISOString() }
  await supabase
    .from('products')
    .update({ metadata: { ...((product as any).metadata || {}), etsy_shots: state } })
    .eq('id', productId)

  void generateShots(productId, userId).catch(err =>
    console.error(`[etsy-shots] unhandled generation error for ${productId}:`, err)
  )
  return state
}

// Replace the shot list (panel prune: admin removed a bad image). Empty array
// clears the shots entirely.
export async function setModelShots(productId: string, images: string[]): Promise<EtsyShots> {
  const clean = images.map(String).filter(u => u.startsWith('http://') || u.startsWith('https://'))
  const { data: product, error } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const metadata = (product as any).metadata || {}
  const state: EtsyShots = {
    ...(metadata.etsy_shots || {}),
    status: clean.length ? 'done' : (metadata.etsy_shots?.status === 'generating' ? 'generating' : 'done'),
    images: clean
  }
  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...metadata, etsy_shots: state } })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to persist shots: ${updErr.message}`)
  return state
}
