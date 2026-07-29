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
import { sniffImageContentType, extForImageContentType } from './google-cloud-storage.js'
import { editOpenAIImage } from './image-flow/providers/openai-image.js'

// Unpinned on purpose: the old `google/nano-banana:858e567…` pin froze this
// service on a single v1 build and made model upgrades invisible here. Track
// the model, not a version hash — Replicate resolves the latest build.
//
// 2026-07-26: swapped v1 → nano-banana-2-lite. 12.8% cheaper ($0.034 vs
// $0.039/image), ~2x faster, and on the A/B it reproduced the design's outline
// strokes more faithfully than v1 did. See image-flow/models.ts for the data.
// NOTE: lite ignores `output_format` and always returns JPEG, so uploads below
// sniff the real bytes instead of assuming PNG.
const NANO_BANANA = 'google/nano-banana-2-lite'
const STOCK_MODEL_BASE = 'https://storage.googleapis.com/imagine-this-printed-media/stock-models'

/**
 * Replicate serves lite's JPEG bytes from a `.png` delivery URL with an
 * `image/png` content-type header, so neither the extension nor the header can
 * be trusted. Sniff the magic bytes — Etsy validates uploaded image types, and
 * a JPEG mislabeled as PNG in GCS is exactly the kind of thing it rejects.
 */
function sniffImageType(buffer: Buffer): { contentType: string; ext: string } {
  const contentType = sniffImageContentType(buffer) || 'image/png'
  return { contentType, ext: extForImageContentType(contentType) }
}

// Engine: gpt-image (OpenAI-direct, the codebase's premium compositor — best
// design/text fidelity, and its known empty-garment wearer-drift bug doesn't
// apply here because a wearer is exactly what we want) with nano-banana as the
// per-shot fallback. ETSY_SHOTS_MODEL=nano-banana flips the primary.
const SHOTS_ENGINE = process.env.ETSY_SHOTS_MODEL === 'nano-banana' ? 'nano-banana' : 'gpt-image'

const replicate = process.env.REPLICATE_API_TOKEN ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN }) : null

export interface EtsyShots {
  status: 'generating' | 'done' | 'failed'
  images: string[]
  /** Number of shots this run will produce (progress denominator). */
  total?: number
  /** Human-readable progress stage shown in the admin panel while generating. */
  stage?: string
  started_at?: string
  generated_at?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Casting — David 2026-07-26: "I want the models to change all the time …
// diff people, diff backgrounds, so we are inclusive, like have a goth teen
// wearing our clothes". Every shoot randomly casts two DIFFERENT personas in
// two DIFFERENT scenes, so no two listings look like the same photoshoot and
// the shop reads as for-everyone. Reshoot = a fresh cast.
//
// All personas are written adult-presenting on purpose: image-model and
// marketplace policies are strict about generating minors, and the aesthetics
// (goth, skater, etc.) read fine on a twenty-something.
// ---------------------------------------------------------------------------
const PERSONAS = [
  { label: 'goth look', persona: 'a goth young woman in her early twenties with dark eyeliner, dyed black hair, silver rings and a leather choker' },
  { label: 'streetwear look', persona: 'a young Black man with short locs and a relaxed confident streetwear style' },
  { label: 'skater look', persona: 'a young woman with a skater style, beanie, and a laid-back grin' },
  { label: 'classic look', persona: 'a Latina woman in her thirties with wavy hair and a warm easy smile' },
  { label: 'dad look', persona: 'a middle-aged man with a gray-flecked beard and a friendly dad-energy smile' },
  { label: 'curvy fashion look', persona: 'a plus-size Black woman with natural curls and confident model posture' },
  { label: 'studious look', persona: 'a South Asian man in his twenties with glasses and a thoughtful look' },
  { label: 'artsy look', persona: 'an East Asian woman with a short modern haircut and minimalist artsy style' },
  { label: 'gym look', persona: 'an athletic Latino man in his twenties with an energetic posture' },
  { label: 'grandma look', persona: 'a silver-haired grandmother with bright eyes and a proud playful smile' },
  { label: 'tattooed look', persona: 'a tattooed young woman with a septum piercing and an edgy alternative style' },
  { label: 'country look', persona: 'a young white man with a trucker cap and an easygoing country style' }
] as const

const SCENES = [
  'in a clean bright studio with soft even daylight, front-facing, relaxed confident pose',
  'on a casual city street at golden hour, natural candid pose, shallow depth of field',
  'against a weathered brick wall with soft afternoon shade, urban editorial feel',
  'in a cozy coffee shop by a big window, warm natural light, candid seated pose',
  'at a skate park at dusk, casual stance, warm low sun',
  'on a neon-lit city street at night, moody colorful glow, cinematic depth of field',
  'in a leafy park in autumn, golden leaves softly out of focus behind them',
  'in a record store aisle, shelves of vinyl blurred behind them, tungsten light',
  'on a beach boardwalk on a bright breezy day, ocean softly blurred behind',
  'in a sunlit doorway of an old building, film-photo warmth, relaxed lean'
] as const

// Metal art gets room scenes, not people — the product hangs on a wall.
const METAL_SCENES = [
  { label: 'living room scene', scene: 'displayed on a bright modern living room gallery wall above a sofa, soft daylight' },
  { label: 'home office scene', scene: 'standing on a wooden home-office shelf beside a few books and a small plant, warm light' },
  { label: 'entryway scene', scene: 'on a styled entryway console table, leaning against the wall, morning light' },
  { label: 'bedroom scene', scene: 'above a neutral bedroom dresser with minimal decor, calm natural light' },
  { label: 'kitchen scene', scene: 'on open kitchen shelving among ceramics and a small plant, bright airy light' }
] as const

interface ShotPlan {
  key: string
  label: string
  persona: string | null   // null = product scene (metal art), no human model
  scene: string
}

const pickTwo = <T,>(pool: readonly T[]): [T, T] => {
  const a = Math.floor(Math.random() * pool.length)
  let b = Math.floor(Math.random() * (pool.length - 1))
  if (b >= a) b += 1
  return [pool[a], pool[b]]
}

// Randomly cast two distinct looks: personas+scenes for apparel, room scenes
// for metal art.
function buildShotPlan(category: string): ShotPlan[] {
  if (category === 'metal-art') {
    const [r1, r2] = pickTwo(METAL_SCENES)
    return [
      { key: 'shot1', label: r1.label, persona: null, scene: r1.scene },
      { key: 'shot2', label: r2.label, persona: null, scene: r2.scene }
    ]
  }
  const [p1, p2] = pickTwo(PERSONAS)
  const [s1, s2] = pickTwo(SCENES)
  return [
    { key: 'shot1', label: p1.label, persona: p1.persona, scene: s1 },
    { key: 'shot2', label: p2.label, persona: p2.persona, scene: s2 }
  ]
}

const PROMPT_TAIL =
  'Show the full torso from shoulders to waist with realistic fabric texture, natural drape, and true-to-life lighting; ' +
  'the print conforms to the fabric folds like a real DTF transfer on cotton. The model is clearly an adult. ' +
  "CRITICAL: preserve the graphic design's letters, words, shapes, colors, and proportions EXACTLY — do not redraw, " +
  'restyle, distort, crop, or reinterpret the artwork in any way. ' +
  'High-resolution product photography suitable for an online marketplace listing.'

const METAL_PROMPT_TAIL =
  'Natural perspective, tasteful minimal decor, photorealistic interior-design photography. ' +
  "CRITICAL: reproduce the artwork's letters, words, shapes, colors, and proportions EXACTLY — do not redraw, " +
  'restyle, distort, crop, or reinterpret it in any way. ' +
  'High-resolution product photography suitable for an online marketplace listing.'

// gpt-image-2 casts the model straight from the persona text — the only image
// input is the design itself, so casting variety is unlimited (no stock-photo
// library required). Metal art gets a room scene instead of a person.
function buildGptPrompt(plan: ShotPlan, shirtColor: string): string {
  if (!plan.persona) {
    return (
      `The INPUT image is a piece of artwork. Task: a professional interior photograph of that artwork ` +
      `reproduced as a thin, frameless, glossy aluminum metal print panel with clean edges, ${plan.scene}. ` +
      METAL_PROMPT_TAIL
    )
  }
  return (
    `The INPUT image is a flat 2D graphic design (a DTF print artwork). ` +
    `Task: a professional ecommerce fashion photograph of ${plan.persona} wearing a ${shirtColor} crew neck t-shirt ` +
    `with the graphic from the INPUT printed on the chest, ${plan.scene}. ` +
    PROMPT_TAIL
  )
}

// nano-banana fallback keeps a stock base photo as its anchor (its compositing
// works best with a person to preserve) and restyles toward the persona as far
// as the anchor allows. Metal art needs no anchor — design only.
function buildNanoPrompt(plan: ShotPlan, shirtColor: string): string {
  if (!plan.persona) {
    return (
      `The INPUT image is a piece of artwork. Task: a professional interior photograph of that artwork ` +
      `reproduced as a thin, frameless, glossy aluminum metal print panel with clean edges, ${plan.scene}. ` +
      METAL_PROMPT_TAIL
    )
  }
  return (
    `INPUT 1 is a photo of a model. INPUT 2 is a flat 2D graphic design (a DTF print artwork). ` +
    `Task: a professional ecommerce fashion photograph based on the model in INPUT 1, restyled as ${plan.persona}, ` +
    `wearing a ${shirtColor} crew neck t-shirt with the graphic from INPUT 2 printed on the chest, ${plan.scene}. ` +
    PROMPT_TAIL
  )
}

// One shot via the primary engine, falling back to the other on failure.
// Returns a durable GCS public URL either way.
async function generateOneShot(
  plan: ShotPlan,
  designUrl: string,
  shirtColor: string,
  productId: string,
  userId: string
): Promise<string> {
  const viaGptImage = async (): Promise<string> => {
    const { url, modelId } = await editOpenAIImage({
      sourceUrl: designUrl,
      prompt: buildGptPrompt(plan, shirtColor),
      size: '1024x1536', // portrait, matches the 3:4 listing crop
      quality: 'high',
      userId,
      objectPath: `users/${userId}/mockups/etsy_shot_${productId}_${plan.key}_${Date.now()}.png`
    })
    console.log(`[etsy-shots] ${productId} ${plan.key} (${plan.label}) via ${modelId} → ${url}`)
    return url
  }

  const viaNanoBanana = async (): Promise<string> => {
    if (!replicate) throw new Error('REPLICATE_API_TOKEN is not configured')
    const inputImages = plan.persona
      ? [await stockModelUrl(plan.key === 'shot1' ? 'female-caucasian-athletic' : 'male-caucasian-athletic'), designUrl]
      : [designUrl] // metal art: no human anchor, just the artwork
    const output = await replicate.run(NANO_BANANA as any, {
      input: {
        prompt: buildNanoPrompt(plan, shirtColor),
        image_input: inputImages,
        output_format: 'png',
        aspect_ratio: '3:4'
      }
    })
    const buffer = await outputToBuffer(output)
    const { contentType, ext } = sniffImageType(buffer)
    const upload = await gcsStorage.uploadFile(buffer, {
      userId,
      folder: 'mockups',
      filename: `etsy_shot_${productId}_${plan.key}_${Date.now()}.${ext}`,
      contentType,
      metadata: { productId, shot: plan.key, persona: plan.label, purpose: 'etsy-listing' }
    })
    console.log(`[etsy-shots] ${productId} ${plan.key} (${plan.label}) via nano-banana → ${upload.publicUrl}`)
    return upload.publicUrl
  }

  const [primary, fallback] = SHOTS_ENGINE === 'gpt-image' ? [viaGptImage, viaNanoBanana] : [viaNanoBanana, viaGptImage]
  try {
    return await primary()
  } catch (err: any) {
    console.warn(`[etsy-shots] ${productId} ${plan.key} primary engine failed (${err?.message}) — trying fallback`)
    return await fallback()
  }
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
      .select('id, name, images, metadata, category')
      .eq('id', productId)
      .maybeSingle()
    if (error || !product) throw new Error(error?.message || 'product not found')

    const designUrl = await designReferenceUrl(product)
    if (!designUrl) throw new Error('No design art or product image to composite')

    const baseColor = String(
      (product as any).metadata?.shirt_color || (product as any).metadata?.dtf_settings?.shirt_color || 'black'
    )
    // If the pack offers a Color variation, the shots rotate through those
    // colors so the listing photos show the range the buyer can pick.
    const packColors: string[] = Array.isArray((product as any).metadata?.etsy_pack?.colors)
      ? (product as any).metadata.etsy_pack.colors.filter((c: unknown): c is string => typeof c === 'string' && !!c)
      : []
    const colorFor = (i: number) => (packColors.length ? packColors[i % packColors.length] : baseColor).toLowerCase()

    const plan = buildShotPlan(String((product as any).category || ''))
    const images: string[] = []
    for (const [i, shot] of plan.entries()) {
      const stage = shot.persona
        ? `Shooting the ${shot.label} in ${colorFor(i)} (${i + 1} of ${plan.length})…`
        : `Staging the ${shot.label} (${i + 1} of ${plan.length})…`
      await saveShotsState(productId, { stage })
      const url = await generateOneShot(shot, designUrl, colorFor(i), productId, userId)
      images.push(url)
      // Persist incrementally so a failure on shot 2 still keeps shot 1 — and
      // so the panel shows each thumbnail the moment it exists.
      await saveShotsState(productId, { images: [...images] })
    }

    await saveShotsState(productId, { status: 'done', images, stage: undefined, generated_at: new Date().toISOString(), error: undefined })
  } catch (err: any) {
    console.error(`[etsy-shots] generation failed for ${productId}:`, err?.message || err)
    await saveShotsState(productId, { status: 'failed', stage: undefined, error: String(err?.message || err).slice(0, 300) })
  }
}

// Kick off generation in the background. Returns immediately; the panel polls
// candidates until metadata.etsy_shots.status is done/failed.
export async function startModelShots(productId: string, userId: string): Promise<EtsyShots> {
  if (!process.env.OPENAI_API_KEY && !replicate) {
    throw new Error('Neither OPENAI_API_KEY nor REPLICATE_API_TOKEN is configured — no shot engine available')
  }

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

  const state: EtsyShots = {
    status: 'generating',
    images: [],
    total: 2, // buildShotPlan always casts two shots
    stage: 'Casting the models…',
    started_at: new Date().toISOString()
  }
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
