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
import { editOpenAIImage } from './image-flow/providers/openai-image.js'
import { ETSY_SIZE_KEYS, metalScaleAnchor, type MetalArtSizeKey } from '../shared/metal-art.js'

const NANO_BANANA = 'google/nano-banana:858e56734846d24469ed35a07ca2161aaf4f83588d7060e32964926e1b73b7be'
const STOCK_MODEL_BASE = 'https://storage.googleapis.com/imagine-this-printed-media/stock-models'

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
  /** Who actually got cast, in shot order — shown in the panel after the shoot. */
  cast?: string[]
  started_at?: string
  generated_at?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Casting — David 2026-07-26: "I want the models to change all the time …
// diff people, diff backgrounds, so we are inclusive, like have a goth teen
// wearing our clothes". With no cast specified a shoot randomly picks two
// DIFFERENT personas in two DIFFERENT scenes, so no two listings look like the
// same photoshoot and the shop reads as for-everyone.
//
// David 2026-07-30: random casting put a GRANDMA in a kids' back-to-school
// listing. The admin can now pick the subject(s) up front (see ShotCast below);
// random stays the default for the many listings where any face works.
//
// `keywords` drives the panel's suggested cast — it matches the product name
// and the composed Etsy tags so an obvious audience is pre-selected instead of
// left to chance.
//
// All personas are written adult-presenting on purpose: image-model and
// marketplace policies are strict about generating minors, and the aesthetics
// (goth, skater, etc.) read fine on a twenty-something. A youth listing gets a
// student/teacher/parent subject — never an actual child.
// ---------------------------------------------------------------------------
export interface ShotSubject {
  id: string
  /** Short display name; also the progress text ("Shooting the grandma look…"). */
  label: string
  persona: string
  keywords: readonly string[]
}

const PERSONAS: readonly ShotSubject[] = [
  { id: 'goth', label: 'goth', persona: 'a goth young woman in her early twenties with dark eyeliner, dyed black hair, silver rings and a leather choker', keywords: ['goth', 'spooky', 'horror', 'halloween', 'skull', 'dark', 'emo', 'witch'] },
  { id: 'streetwear', label: 'streetwear', persona: 'a young Black man with short locs and a relaxed confident streetwear style', keywords: ['street', 'streetwear', 'hype', 'urban', 'sneaker', 'hip hop', 'rap', 'graffiti'] },
  { id: 'skater', label: 'skater', persona: 'a young woman with a skater style, beanie, and a laid-back grin', keywords: ['skate', 'skater', 'skateboard', 'punk', 'board'] },
  { id: 'classic', label: 'classic', persona: 'a Latina woman in her thirties with wavy hair and a warm easy smile', keywords: [] },
  { id: 'dad', label: 'dad', persona: 'a middle-aged man with a gray-flecked beard and a friendly dad-energy smile', keywords: ['dad', 'father', 'papa', 'grill', 'bbq', 'fishing', 'golf', 'lawn'] },
  { id: 'mom', label: 'mom', persona: 'a young mom in her late twenties with a relaxed ponytail and a warm everyday smile', keywords: ['mom', 'mama', 'mother', 'mommy', 'momlife', 'nurse'] },
  { id: 'curvy', label: 'curvy fashion', persona: 'a plus-size Black woman with natural curls and confident model posture', keywords: ['curvy', 'plus size', 'body positive', 'confidence'] },
  { id: 'student', label: 'student', persona: 'a college student in her early twenties with a backpack over one shoulder and bright campus-morning energy', keywords: ['school', 'student', 'back to school', 'class', 'grade', 'campus', 'college', 'university', 'academy', 'homework', 'kid', 'kids', 'youth', 'teen', 'junior', 'graduate', 'senior'] },
  { id: 'teacher', label: 'teacher', persona: 'a friendly schoolteacher in her thirties with glasses and a warm welcoming smile', keywords: ['teacher', 'teach', 'classroom', 'educator', 'professor', 'principal', 'apple'] },
  { id: 'studious', label: 'studious', persona: 'a South Asian man in his twenties with glasses and a thoughtful look', keywords: ['nerd', 'geek', 'gamer', 'gaming', 'math', 'science', 'book', 'read', 'library', 'chess', 'coder', 'code'] },
  { id: 'artsy', label: 'artsy', persona: 'an East Asian woman with a short modern haircut and minimalist artsy style', keywords: ['art', 'artist', 'paint', 'creative', 'aesthetic', 'design', 'craft'] },
  { id: 'gym', label: 'gym', persona: 'an athletic Latino man in his twenties with an energetic posture', keywords: ['gym', 'lift', 'workout', 'fitness', 'run', 'muscle', 'protein', 'athlete', 'sport', 'coach'] },
  { id: 'grandma', label: 'grandma', persona: 'a silver-haired grandmother with bright eyes and a proud playful smile', keywords: ['grandma', 'grandmother', 'nana', 'mimi', 'granny', 'grandparent', 'retired', 'retirement'] },
  { id: 'tattooed', label: 'tattooed', persona: 'a tattooed young woman with a septum piercing and an edgy alternative style', keywords: ['tattoo', 'ink', 'alt', 'rock', 'metal', 'biker', 'motorcycle'] },
  { id: 'country', label: 'country', persona: 'a young white man with a trucker cap and an easygoing country style', keywords: ['country', 'farm', 'ranch', 'truck', 'cowboy', 'hunting', 'southern', 'rodeo', 'horse'] }
] as const

/** Catalog for the admin picker — the persona text doubles as the chip tooltip. */
export function listShotSubjects(): ShotSubject[] {
  return PERSONAS.map(p => ({ ...p, keywords: [...p.keywords] }))
}

/**
 * What the admin picked before hitting "Shoot". Empty/absent = random cast
 * (the original behavior). One subject = both shots use it in different scenes;
 * two = one each. `custom` is free text appended to that list.
 */
export interface ShotCast {
  subjects?: string[]
  custom?: string
}

type CastMember = { label: string; persona: string }

/** A rejected cast is the admin's input problem, not a server fault — routes map this to 400. */
export class ShotCastError extends Error {}

// Image models and Etsy both prohibit depicting minors, and PROMPT_TAIL already
// pins "the model is clearly an adult" — so a custom subject that asks for a
// child is rejected loudly at kickoff instead of quietly producing an adult and
// confusing the admin about why.
const MINOR_TERMS =
  /\b(child|children|kid|kids|toddler|baby|babies|infant|newborn|pre-?teen|tween|minor|underage|schoolboy|schoolgirl|elementary|kindergarten|preschool|middle school|junior high|boy|boys|girl|girls|son|daughter|grandchild|youngster|juvenile|little one)\b/i
const MINOR_AGE = /\b(?:[1-9]|1[0-7])\s*(?:-|–|\s)?\s*(?:year|yr)s?[\s-]*old\b/i

function sanitizeCustomSubject(raw?: string): string | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)
  if (!text) return null
  if (MINOR_TERMS.test(text) || MINOR_AGE.test(text)) {
    throw new ShotCastError(
      'Model shots can only depict adults — image-model and Etsy policy both forbid generating minors. ' +
      'Describe an adult subject instead (e.g. "a college student in her early twenties with a backpack").'
    )
  }
  return text
}

/** Resolve the admin's picks into at most two cast members. Throws on a bad custom subject. */
export function resolveCast(cast?: ShotCast): CastMember[] {
  const members: CastMember[] = []
  for (const id of cast?.subjects ?? []) {
    const match = PERSONAS.find(p => p.id === id)
    if (!match) throw new ShotCastError(`Unknown model subject "${id}"`)
    members.push({ label: match.label, persona: match.persona })
  }
  const custom = sanitizeCustomSubject(cast?.custom)
  if (custom) members.push({ label: 'custom', persona: custom })
  return members.slice(0, 2)
}

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

// Metal art gets room scenes, not people — and each scene is bound to a REAL
// panel size with scale anchors (David 2026-07-28: a 4x6 must never be staged
// looking like massive wall art). Shot 1 stages the 4x6, shot 2 the 8x10, so
// the listing honestly shows both buyable sizes.
const METAL_SCENES_SMALL = [
  { label: 'desk scene', scene: 'standing on a styled wooden desk next to a coffee mug and a small potted plant, warm daylight' },
  { label: 'bedside scene', scene: 'on a bedside table beside a small lamp and a paperback book, calm morning light' },
  { label: 'bookshelf scene', scene: 'tucked between books on a bookshelf, leaning against the shelf back, cozy light' },
  { label: 'entryway scene', scene: 'on a styled entryway console close-up, leaning against the wall beside keys and a small plant' }
] as const

const METAL_SCENES_MEDIUM = [
  { label: 'shelf scene', scene: 'standing on a wooden shelf leaning against the wall, books and a small plant beside it, warm light' },
  { label: 'desk-wall scene', scene: 'hanging on the wall just above a home-office desk, monitor and lamp nearby for scale' },
  { label: 'dresser scene', scene: 'leaning on a neutral bedroom dresser against the wall, minimal decor, calm natural light' },
  { label: 'kitchen scene', scene: 'on open kitchen shelving among ceramics and a small plant, bright airy light' }
] as const

interface ShotPlan {
  key: string
  label: string
  persona: string | null   // null = product scene (metal art), no human model
  scene: string
  /** Metal art only — which physical panel size this shot stages. */
  metalSize?: MetalArtSizeKey
}

const pickTwo = <T,>(pool: readonly T[]): [T, T] => {
  const a = Math.floor(Math.random() * pool.length)
  let b = Math.floor(Math.random() * (pool.length - 1))
  if (b >= a) b += 1
  return [pool[a], pool[b]]
}

// Build the two-shot plan: the admin's chosen cast (or a random pair of distinct
// looks) in two distinct scenes for apparel, and room scenes for metal art (one
// shot per buyable size, scale-anchored — metal art has no human subject, so the
// panel never offers a cast picker for it).
function buildShotPlan(category: string, cast: CastMember[] = []): ShotPlan[] {
  if (category === 'metal-art') {
    const small = METAL_SCENES_SMALL[Math.floor(Math.random() * METAL_SCENES_SMALL.length)]
    const medium = METAL_SCENES_MEDIUM[Math.floor(Math.random() * METAL_SCENES_MEDIUM.length)]
    const [smallKey, mediumKey] = ETSY_SIZE_KEYS
    return [
      { key: 'shot1', label: `${small.label} (${smallKey})`, persona: null, scene: small.scene, metalSize: smallKey },
      { key: 'shot2', label: `${medium.label} (${mediumKey})`, persona: null, scene: medium.scene, metalSize: mediumKey }
    ]
  }
  const [p1, p2] = pickTwo(PERSONAS)
  // Chosen subjects win; unfilled slots fall back to the random pair. One pick
  // means the admin wants that person — reuse them for both shots (the scenes
  // still differ), rather than pairing them with a random stranger.
  const c1 = cast[0] ?? p1
  const c2 = cast[1] ?? cast[0] ?? p2
  const [s1, s2] = pickTwo(SCENES)
  return [
    { key: 'shot1', label: c1.label, persona: c1.persona, scene: s1 },
    { key: 'shot2', label: c2.label, persona: c2.persona, scene: s2 }
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
      `${metalScaleAnchor(plan.metalSize ?? '4x6')} ` +
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
      `${metalScaleAnchor(plan.metalSize ?? '4x6')} ` +
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
    const upload = await gcsStorage.uploadFile(buffer, {
      userId,
      folder: 'mockups',
      filename: `etsy_shot_${productId}_${plan.key}_${Date.now()}.png`,
      contentType: 'image/png',
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

async function generateShots(productId: string, userId: string, cast: CastMember[] = []): Promise<void> {
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

    const plan = buildShotPlan(String((product as any).category || ''), cast)
    // Record the cast up front so the panel can show who is being shot even
    // while the first image is still rendering.
    await saveShotsState(productId, { cast: plan.map(p => p.label) })

    const images: string[] = []
    for (const [i, shot] of plan.entries()) {
      const stage = shot.persona
        ? `Shooting the ${shot.label} look in ${colorFor(i)} (${i + 1} of ${plan.length})…`
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
export async function startModelShots(productId: string, userId: string, cast?: ShotCast): Promise<EtsyShots> {
  if (!process.env.OPENAI_API_KEY && !replicate) {
    throw new Error('Neither OPENAI_API_KEY nor REPLICATE_API_TOKEN is configured — no shot engine available')
  }

  // Resolve BEFORE the 202 so a bad subject id or a disallowed custom subject
  // surfaces as an immediate error instead of a silent async failure.
  const resolved = resolveCast(cast)

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
    stage: resolved.length ? `Casting ${resolved.map(c => c.label).join(' + ')}…` : 'Casting the models…',
    cast: resolved.length ? resolved.map(c => c.label) : undefined,
    started_at: new Date().toISOString()
  }
  await supabase
    .from('products')
    .update({ metadata: { ...((product as any).metadata || {}), etsy_shots: state } })
    .eq('id', productId)

  void generateShots(productId, userId, resolved).catch(err =>
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
