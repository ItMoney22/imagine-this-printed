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
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import * as gcsStorage from './gcs-storage.js'
import { sniffImageContentType, extForImageContentType } from './google-cloud-storage.js'
import { editOpenAIImage } from './image-flow/providers/openai-image.js'
import { ETSY_SIZE_KEYS, metalScaleAnchor, type MetalArtSizeKey } from '../shared/metal-art.js'
// David 2026-09-01: hoodies were being shot on-model as a "crew neck
// t-shirt" — the wording was hardcoded. Garment-aware wording (and the
// Step Flow's shootOneModelShot) reads from the one capability boundary.
import { COLORS, normalizeGarment, getGarment, type GarmentId, type ColorId } from '../shared/catalog-capability.js'

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

// Fidelity QA reads two images, so it uses the shared vision var the rest of the
// backend reads (routes/admin/products.ts, routes/ai/mr-imagine-chat.ts).
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reject a non-default temperature and want max_completion_tokens.
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

export interface EtsyShots {
  status: 'generating' | 'done' | 'failed'
  images: string[]
  /** Number of shots this run will produce (progress denominator). */
  total?: number
  /** Human-readable progress stage shown in the admin panel while generating. */
  stage?: string
  /** Who actually got cast, in shot order — shown in the panel after the shoot. */
  cast?: string[]
  /** Per-shot design-fidelity verdicts, parallel to `images`. */
  checks?: ShotCheck[]
  started_at?: string
  generated_at?: string
  error?: string
}

/**
 * Result of the post-render fidelity check (David 2026-07-31: "the DESIGN needs
 * to stay TRUE"). `ok: false` means the render survived a retry and still does
 * not match the source art — it lands flagged rather than silently shipping.
 */
export interface ShotCheck {
  ok: boolean
  reason?: string
  /** True when the shot needed a second render to pass. */
  retried?: boolean
}

// ---------------------------------------------------------------------------
// Casting — David 2026-07-26: "I want the models to change all the time …
// diff people, diff backgrounds, so we are inclusive, like have a goth teen
// wearing our clothes". With no cast specified a shoot randomly picks two
// DIFFERENT archetypes in two DIFFERENT scenes, so no two listings look like
// the same photoshoot and the shop reads as for-everyone.
//
// David 2026-07-30: random casting put a GRANDMA in a kids' back-to-school
// listing. The admin can now pick the subject(s) up front (see ShotCast below);
// random stays the default for the many listings where any face works.
//
// David 2026-07-31: "the Model needs to be unique, look like everyday ppl. The
// prompt for 2 must change everytime." An archetype used to BE a fixed sentence,
// so casting "goth" twice sent the identical 22-word description and got back
// effectively the same face. Now an archetype is only a spine — a role plus its
// own look details — that gets dressed at shoot time from independent trait
// pools (age band, build, heritage, presentation, a real-person feature,
// expression, pose). Every shoot draws fresh, so "goth" is a different, ordinary
// looking human every time and no two prompts are ever byte-identical.
//
// `keywords` drives the panel's suggested cast — it matches the product name
// and the composed Etsy tags so an obvious audience is pre-selected instead of
// left to chance.
//
// All archetypes are adult on purpose: image-model and marketplace policies are
// strict about generating minors, and the aesthetics (goth, skater, etc.) read
// fine on a twenty-something. A youth listing gets a student/teacher/parent
// subject — never an actual child.
// ---------------------------------------------------------------------------

// Age bands are phrased as adjectives ("a late-twenties Black woman") so no
// gendered pronoun ever has to agree with the drawn presentation.
const AGES_YOUNG = ['early-twenties', 'mid-twenties', 'late-twenties'] as const
const AGES_ADULT = ['late-twenties', 'early-thirties', 'mid-thirties', 'late-thirties', 'forty-something'] as const
const AGES_MATURE = ['thirty-something', 'forty-something', 'fifty-something'] as const
const AGES_SENIOR = ['sixty-something', 'seventy-something'] as const

// Shared trait pools. These are what make the same archetype a different human
// on every shoot — and, deliberately, what make the shop look like real life.
const PRESENTATIONS = ['woman', 'man', 'person'] as const

const HERITAGE = [
  'Black', 'white', 'Latin American', 'East Asian', 'South Asian', 'Southeast Asian',
  'Middle Eastern', 'Indigenous American', 'Pacific Islander', 'mixed-race'
] as const

// Deliberately presentation-neutral: these are drawn against every archetype,
// including the ones locked to "grandfather" or "dad".
const BUILDS = [
  'slim', 'average-build', 'athletic', 'stocky', 'plus-size', 'tall and lanky',
  'small-framed', 'broad-shouldered', 'soft-bodied', 'heavyset'
] as const

// "Everyday people" lives here — the small imperfections a catalog model never
// has. One is drawn per shot (David 2026-07-31: real but clean, not amateur).
const EVERYDAY_FEATURES = [
  'light freckles across the nose', 'a small gap between the front teeth',
  'laugh lines at the eyes', 'a faint scar through one eyebrow',
  'a beauty mark on one cheek', 'slightly crooked front teeth',
  'a few flyaway hairs the brush missed', 'faint under-eye shadows from a real morning',
  'a healed piercing hole in one ear', 'sun-weathered skin across the cheekbones',
  'light acne scarring on the jaw', 'a small birthmark on the neck',
  'eyebrows that do not quite match', 'a slightly asymmetric smile',
  'a chipped front tooth', 'a farmer tan at the sleeve line'
] as const

const EXPRESSIONS = [
  'a small closed-mouth smile', 'caught mid-laugh with the eyes crinkled',
  'a calm neutral look straight down the lens', 'glancing off-camera, half-smiling',
  'eyebrows up like they were mid-sentence', 'a quiet, settled confidence',
  'an easy open grin', 'chin slightly down, warm and unbothered'
] as const

const POSES = [
  'hands in their pockets', 'arms hanging loose at their sides',
  'one hand tugging the shirt hem straight', 'a shoulder leaned against whatever is behind them',
  'weight shifted onto one hip', 'arms crossed loosely',
  'thumbs hooked in their belt loops', 'one hand up adjusting their hair'
] as const

// Photography treatment is drawn per shot too, so even a repeat scene never
// renders with the same light twice.
const TREATMENTS = [
  'shot on a 50mm lens at f/2.8 in natural window light',
  'shot on a 35mm lens under soft overcast daylight, gentle contrast',
  'shot on an 85mm portrait lens in warm late-afternoon sun with a creamy background blur',
  'available-light documentary style with a trace of fine film grain',
  'clean two-light setup with a soft key and a subtle rim, neutral white balance',
  'bright bounced daylight, airy and low-contrast',
  'golden backlight with a soft fill on the face',
  'crisp midday shade, cool neutral tones'
] as const

/** An archetype is a spine, not a finished description. */
interface ShotArchetype {
  id: string
  /** Short display name; also the progress text ("Shooting the grandma look…"). */
  label: string
  /** The identity that must survive every reroll — appended after the drawn traits. */
  role: string
  /** Look details unique to this archetype; two are drawn per shot. */
  details: readonly string[]
  ages: readonly string[]
  /** Overrides the PRESENTATIONS draw where the archetype is inherently gendered. */
  presentations?: readonly string[]
  keywords: readonly string[]
}

const ARCHETYPES: readonly ShotArchetype[] = [
  {
    id: 'goth', label: 'goth', role: 'with an alternative goth style', ages: AGES_YOUNG,
    details: ['dyed black hair with grown-out roots', 'heavy smudged eyeliner', 'a leather choker', 'chipped black nail polish', 'stacked silver rings', 'a blunt fringe', 'dark plum lipstick', 'a stick-and-poke tattoo on the forearm'],
    keywords: ['goth', 'spooky', 'horror', 'halloween', 'skull', 'dark', 'emo', 'witch']
  },
  {
    id: 'streetwear', label: 'streetwear', role: 'with a relaxed streetwear style', ages: AGES_YOUNG,
    details: ['short locs', 'a fitted cap worn backwards', 'a thin gold chain', 'box braids pulled up', 'a fresh line-up fade', 'chunky sneakers just in frame', 'a wrist full of beaded bracelets'],
    keywords: ['street', 'streetwear', 'hype', 'urban', 'sneaker', 'hip hop', 'rap', 'graffiti']
  },
  {
    id: 'skater', label: 'skater', role: 'with a skater look', ages: AGES_YOUNG,
    details: ['a slouchy beanie', 'shaggy hair over the ears', 'scraped-up knuckles', 'a worn-in flannel tied at the waist', 'a bleached buzzcut growing out', 'a skateboard held at their side'],
    keywords: ['skate', 'skater', 'skateboard', 'punk', 'board']
  },
  {
    id: 'classic', label: 'classic', role: 'with an easy everyday style', ages: AGES_ADULT,
    details: ['loose wavy hair', 'a simple pair of studs', 'a neat low bun', 'a thin everyday necklace', 'hair tucked behind one ear', 'a plain leather watch'],
    keywords: []
  },
  {
    id: 'dad', label: 'dad', role: 'with unmistakable dad energy', ages: AGES_MATURE, presentations: ['dad'],
    details: ['a gray-flecked beard', 'a receding hairline he stopped fighting', 'reading glasses pushed up on the head', 'a wedding band', 'a well-worn ball cap', 'forearms tanned from yard work', 'two days of stubble'],
    keywords: ['dad', 'father', 'papa', 'grill', 'bbq', 'fishing', 'golf', 'lawn']
  },
  {
    id: 'mom', label: 'mom', role: 'with everyday mom energy', ages: AGES_ADULT, presentations: ['mom'],
    details: ['a ponytail redone one-handed', 'a hair tie around the wrist', 'sunglasses pushed up on the head', 'a tiny handprint smudge on the sleeve', 'a delicate name necklace', 'no makeup and no apology for it'],
    keywords: ['mom', 'mama', 'mother', 'mommy', 'momlife', 'nurse']
  },
  {
    id: 'curvy', label: 'curvy fashion', role: 'with confident curvy-fashion styling', ages: AGES_ADULT,
    details: ['big natural curls', 'bold hoop earrings', 'a bright manicure', 'a silk headwrap', 'a long straight blowout', 'a stack of thin bangles'],
    keywords: ['curvy', 'plus size', 'body positive', 'confidence']
  },
  {
    id: 'student', label: 'student', role: 'with college-student energy', ages: AGES_YOUNG,
    details: ['a backpack over one shoulder', 'a messy topknot', 'a lanyard tucked into the collar', 'earbuds in one ear', 'a spiral notebook under the arm', 'a hoodie tied around the waist'],
    keywords: ['school', 'student', 'back to school', 'class', 'grade', 'campus', 'college', 'university', 'academy', 'homework', 'kid', 'kids', 'youth', 'teen', 'junior', 'graduate', 'senior']
  },
  {
    id: 'teacher', label: 'teacher', role: 'with warm schoolteacher energy', ages: AGES_ADULT,
    details: ['tortoiseshell glasses', 'a lanyard of classroom keys', 'a cardigan over the shoulders', 'a pen tucked behind the ear', 'a neat shoulder-length cut', 'chalk dust on one cuff'],
    keywords: ['teacher', 'teach', 'classroom', 'educator', 'professor', 'principal', 'apple']
  },
  {
    id: 'studious', label: 'studious', role: 'with a thoughtful, studious look', ages: AGES_YOUNG,
    details: ['wire-frame glasses', 'a slightly overgrown haircut', 'a paperback in one hand', 'a headset around the neck', 'ink on the side of the hand', 'a subtle enamel pin on the collar'],
    keywords: ['nerd', 'geek', 'gamer', 'gaming', 'math', 'science', 'book', 'read', 'library', 'chess', 'coder', 'code']
  },
  {
    id: 'artsy', label: 'artsy', role: 'with a minimalist artsy style', ages: AGES_ADULT,
    details: ['a short modern crop', 'a fleck of dried paint on the wrist', 'one architectural earring', 'a blunt bob', 'round wire glasses', 'ink-stained fingertips'],
    keywords: ['art', 'artist', 'paint', 'creative', 'aesthetic', 'design', 'craft']
  },
  {
    id: 'gym', label: 'gym', role: 'with an athletic, energetic build', ages: AGES_YOUNG,
    details: ['a sweat-damp hairline', 'a fitness tracker on the wrist', 'a towel over one shoulder', 'a high tight ponytail', 'lifting-chalk dust on the hands', 'a shaker bottle in hand'],
    keywords: ['gym', 'lift', 'workout', 'fitness', 'run', 'muscle', 'protein', 'athlete', 'sport', 'coach']
  },
  // Split from one "grandparent" archetype on purpose: the chip label is a
  // promise. Picking "grandma" and getting a grandfather is the same class of
  // miss as the kids' tee that started all this.
  {
    id: 'grandma', label: 'grandma', role: 'with proud, playful energy', ages: AGES_SENIOR, presentations: ['grandmother'],
    details: ['soft silver hair set that morning', 'bright reading glasses on a beaded chain', 'a small pearl earring', 'deep smile lines', 'a cardigan buttoned at the top', 'a wedding band worn thin'],
    keywords: ['grandma', 'grandmother', 'nana', 'mimi', 'granny', 'retired', 'retirement']
  },
  {
    id: 'grandpa', label: 'grandpa', role: 'with proud, playful energy', ages: AGES_SENIOR, presentations: ['grandfather'],
    details: ['a neat white beard', 'reading glasses low on the nose', 'a flat cap', 'deep smile lines', 'a cardigan buttoned at the top', 'a few days of white stubble', 'a wedding band worn thin'],
    keywords: ['grandpa', 'grandfather', 'papa', 'pops', 'gramps', 'grandparent', 'veteran']
  },
  {
    id: 'tattooed', label: 'tattooed', role: 'with a heavily tattooed alternative style', ages: AGES_ADULT,
    details: ['a septum ring', 'a full sleeve of faded traditional tattoos', 'stretched earlobes', 'an undercut with the top pulled back', 'knuckle tattoos', 'a hand-poked tattoo on the throat'],
    keywords: ['tattoo', 'ink', 'alt', 'rock', 'metal', 'biker', 'motorcycle']
  },
  {
    id: 'country', label: 'country', role: 'with an easygoing country style', ages: AGES_ADULT,
    details: ['a well-shaped trucker cap', 'a sunburned neck', 'a big belt buckle just in frame', 'work-callused hands', 'a braid over one shoulder', 'a straw hat pushed back'],
    keywords: ['country', 'farm', 'ranch', 'truck', 'cowboy', 'hunting', 'southern', 'rodeo', 'horse']
  }
] as const

/** What the panel's picker shows. `persona` is the archetype blurb, not a fixed cast. */
export interface ShotSubject {
  id: string
  label: string
  persona: string
  keywords: readonly string[]
}

/** Catalog for the admin picker — the blurb doubles as the chip tooltip. */
export function listShotSubjects(): ShotSubject[] {
  return ARCHETYPES.map(a => ({
    id: a.id,
    label: a.label,
    persona: `Someone ${a.role} — a different person every shoot`,
    keywords: [...a.keywords]
  }))
}

const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)]

/** Two distinct members of a pool (pool must have ≥2 entries). */
const pickTwo = <T,>(pool: readonly T[]): [T, T] => {
  const a = Math.floor(Math.random() * pool.length)
  let b = Math.floor(Math.random() * (pool.length - 1))
  if (b >= a) b += 1
  return [pool[a], pool[b]]
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

/** A cast slot: an archetype to dress at shoot time, or the admin's own words. */
type CastMember = { label: string; archetype: ShotArchetype | null; custom: string | null }

/** A rejected cast is the admin's input problem, not a server fault — routes map this to 400. */
export class ShotCastError extends Error {}

/**
 * Dress a cast slot into a one-off description. Called per SHOT, never cached —
 * the whole point is that two shots of the same archetype are two different
 * people. A custom subject keeps the admin's words verbatim and only varies the
 * human detail around them.
 */
export function composeSubject(member: CastMember): { persona: string; signature: string } {
  const feature = pick(EVERYDAY_FEATURES)
  const expression = pick(EXPRESSIONS)
  const pose = pick(POSES)

  if (member.custom || !member.archetype) {
    const base = member.custom || 'an everyday adult'
    return {
      persona: `${base}, with ${feature}, ${expression}, ${pose}`,
      signature: ['custom', feature, expression, pose].join(' · ')
    }
  }

  const a = member.archetype
  const age = pick(a.ages)
  const build = pick(BUILDS)
  const heritage = pick(HERITAGE)
  const presentation = pick(a.presentations ?? PRESENTATIONS)
  const [d1, d2] = a.details.length > 1 ? pickTwo(a.details) : [a.details[0], null]

  const looks = [d1, d2].filter(Boolean).join(' and ')
  const article = /^[aeiou]/i.test(age) ? 'an' : 'a'
  const persona =
    `${article} ${age} ${build} ${heritage} ${presentation} ${a.role}, ${looks}, with ${feature}, ${expression}, ${pose}`
  return {
    persona,
    signature: [a.id, age, build, heritage, presentation, looks, feature].join(' · ')
  }
}

/** Resolve the admin's picks into at most two cast slots. Throws on a bad custom subject. */
export function resolveCast(cast?: ShotCast): CastMember[] {
  const members: CastMember[] = []
  for (const id of cast?.subjects ?? []) {
    const match = ARCHETYPES.find(a => a.id === id)
    if (!match) throw new ShotCastError(`Unknown model subject "${id}"`)
    members.push({ label: match.label, archetype: match, custom: null })
  }
  const custom = sanitizeCustomSubject(cast?.custom)
  if (custom) members.push({ label: 'custom', archetype: null, custom })
  return members.slice(0, 2)
}

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

export interface ShotPlan {
  key: string
  label: string
  persona: string | null   // null = product scene (metal art), no human model
  scene: string
  /** Photography treatment, drawn per shot so a repeat scene never repeats its light. */
  treatment: string
  /** Trait fingerprint of this cast — logged and stored so a bad shot is explainable. */
  signature: string
  /** Per-shot nonce: guarantees no two prompts are ever byte-identical. */
  variant: string
  /** Metal art only — which physical panel size this shot stages. */
  metalSize?: MetalArtSizeKey
  /** Set on the second attempt: what the QA pass said went wrong the first time. */
  retryNote?: string
}

/** Short random slate id, e.g. "K7QM2A" — burned into the prompt as a casting slate. */
const slateId = (): string =>
  Math.random().toString(36).slice(2, 8).toUpperCase()

/** Dress one cast slot into a full shot. Fresh traits every call, by design. */
function castShot(key: string, member: CastMember, scene: string): ShotPlan {
  const { persona, signature } = composeSubject(member)
  return { key, label: member.label, persona, scene, treatment: pick(TREATMENTS), signature, variant: slateId() }
}

// Build the two-shot plan: the admin's chosen cast (or a random pair of distinct
// archetypes) in two distinct scenes for apparel, and room scenes for metal art
// (one shot per buyable size, scale-anchored — metal art has no human subject,
// so the panel never offers a cast picker for it).
function buildShotPlan(category: string, cast: CastMember[] = []): ShotPlan[] {
  if (category === 'metal-art') {
    const small = pick(METAL_SCENES_SMALL)
    const medium = pick(METAL_SCENES_MEDIUM)
    const [smallKey, mediumKey] = ETSY_SIZE_KEYS
    return [
      { key: 'shot1', label: `${small.label} (${smallKey})`, persona: null, scene: small.scene, treatment: pick(TREATMENTS), signature: `metal · ${smallKey}`, variant: slateId(), metalSize: smallKey },
      { key: 'shot2', label: `${medium.label} (${mediumKey})`, persona: null, scene: medium.scene, treatment: pick(TREATMENTS), signature: `metal · ${mediumKey}`, variant: slateId(), metalSize: mediumKey }
    ]
  }
  // Chosen subjects win; unfilled slots fall back to a random distinct pair. One
  // pick means the admin wants that archetype — it fills both slots, but each
  // slot is dressed separately, so it's the same TYPE of person, not the same
  // person twice (different scene, different traits, different slate).
  const [r1, r2] = pickTwo(ARCHETYPES)
  const toMember = (a: ShotArchetype): CastMember => ({ label: a.label, archetype: a, custom: null })
  const m1 = cast[0] ?? toMember(r1)
  const m2 = cast[1] ?? cast[0] ?? toMember(r2)
  const [s1, s2] = pickTwo(SCENES)
  return [castShot('shot1', m1, s1), castShot('shot2', m2, s2)]
}

// ---------------------------------------------------------------------------
// Design fidelity — David 2026-07-31: "the DESIGN needs to stay TRUE!". The old
// prompt asked for this in one sentence; image models routinely re-typeset text
// they think they can improve. These are enumerated hard rules stated as the
// job's acceptance criteria, plus an explicit list of the failures we actually
// see (re-drawn lettering, invented extra text, the graphic half-hidden behind
// an arm), and the shot is verified against the source art after it renders.
// ---------------------------------------------------------------------------
// Rule 7 (placement/scale) is derived from the product's ACTUAL print
// placement and size — it was a hardcoded "11-inch front print" for every
// garment, which mis-briefed pocket and back products and ignored the size
// the admin picked (David 2026-08-09).
const shotPlacementRule = (placement: string, sizeInches: number): string => {
  const inches = Math.min(16, Math.max(3, Math.round(Number(sizeInches) || 11)))
  switch (placement) {
    case 'left-pocket':
      return 'Placement: a small pocket-scale print about 4 inches wide, high on the LEFT chest like a pocket ' +
        'logo — the rest of the shirt stays blank.'
    case 'back-only':
      return `Placement: printed LARGE across the upper back, about ${inches} inches wide, centered between the ` +
        'shoulder blades.'
    case 'pocket-front-back-full':
      return 'Placement: a small pocket print about 4 inches wide on the left chest (this product also has a ' +
        'large back print, but only the front is visible in this photo).'
    default: // front-center, front-back (front side shown)
      return `Placement: centered on the chest, top edge about two inches below the collar, sized like a standard ` +
        `${inches}-inch adult front print — never enlarged into an all-over print.`
  }
}

const designFidelityRules = (placement: string, sizeInches: number): string =>
  'DESIGN FIDELITY — this outranks every aesthetic choice in this brief:\n' +
  '1. Reproduce the INPUT artwork EXACTLY. Every letter, word, number and punctuation mark keeps its spelling, ' +
  'its typeface, its weight, its letter spacing and its line breaks.\n' +
  '2. Same colors, same gradients, same outlines, same internal proportions and the same overall aspect ratio.\n' +
  '3. Do NOT redraw, re-letter, re-typeset, restyle, translate, "fix", complete, crop, mirror, rotate, recolor, ' +
  'or add a frame, border or background to the artwork.\n' +
  '4. Do NOT add ANY element the INPUT does not contain — no extra words, no logos, no brand marks, no watermarks, ' +
  'no signatures, no icons, no sparkles, no drop shadows.\n' +
  '5. The whole graphic stays visible: nothing covers it — not hands, hair, arms, bag straps, jackets or shadow.\n' +
  '6. The ONLY permitted deformation is real fabric behavior — the print follows the shirt\'s folds and the ' +
  'curve of the body like a genuine DTF transfer, slightly matte, ink sitting on the weave.\n' +
  `7. ${shotPlacementRule(placement, sizeInches)}\n` +
  'If any part of the artwork is ambiguous, reproduce it as-is. Never invent a cleaner version.'

const METAL_FIDELITY_RULES =
  'DESIGN FIDELITY — this outranks every aesthetic choice in this brief:\n' +
  '1. Reproduce the INPUT artwork EXACTLY: every letter, word and number keeps its spelling, typeface, spacing ' +
  'and line breaks; same colors, same outlines, same internal proportions and aspect ratio.\n' +
  '2. Do NOT redraw, re-letter, restyle, translate, "fix", crop, mirror, recolor or reinterpret it.\n' +
  '3. Do NOT add any element the INPUT does not contain — no extra text, logos, watermarks or signatures.\n' +
  '4. The whole artwork is visible and unobstructed on the panel face.\n' +
  'If any part of the artwork is ambiguous, reproduce it as-is. Never invent a cleaner version.'

// David 2026-07-31: "The Model needs to be unique look like everyday ppl."
// Real person, professional photograph — the imperfection is in the human, not
// in the picture.
const EVERYDAY_REALISM =
  'THE MODEL: a real, ordinary person — NOT a polished catalog or runway model. Natural unretouched skin with ' +
  'visible pores and texture, real body proportions, hair that is done but not perfect, a genuine unposed-feeling ' +
  'expression, natural asymmetry in the face. No airbrushing, no plastic skin, no beauty filter, no impossible ' +
  'jawline. The PHOTOGRAPH, by contrast, is professional: correctly exposed, sharp focus on the model, clean ' +
  'color, no motion blur and no noise. Everyday person, expert photography.'

const promptTail = (placement: string, sizeInches: number): string =>
  'Show the full torso from shoulders to waist with realistic fabric texture, natural drape and true-to-life ' +
  'lighting. The model is clearly an adult. High-resolution product photography suitable for an online ' +
  'marketplace listing.\n' +
  EVERYDAY_REALISM + '\n' +
  designFidelityRules(placement, sizeInches)

// How the "wearing a shirt with the graphic printed …" clause reads per
// placement — a back-only product is shot FROM BEHIND, which the old
// hardcoded "printed on the chest" made impossible.
const wearingClause = (placement: string): string => {
  switch (placement) {
    case 'left-pocket':
    case 'pocket-front-back-full':
      return 'printed small at pocket scale on the left chest'
    case 'back-only':
      return 'printed large across the upper back — the model is photographed from behind so the back print is clearly visible'
    default:
      return 'printed on the chest'
  }
}

const METAL_PROMPT_TAIL =
  'Natural perspective, tasteful minimal decor, photorealistic interior-design photography. ' +
  'High-resolution product photography suitable for an online marketplace listing.\n' +
  METAL_FIDELITY_RULES

/**
 * Prepended on a retry so the second attempt is told exactly what it botched,
 * instead of being an identical roll of the dice at the same price.
 */
const retryPreamble = (plan: ShotPlan): string =>
  plan.retryNote
    ? `RETRY. The previous attempt at this photograph FAILED design-fidelity QA: ${plan.retryNote} ` +
      `Fix precisely that, and follow the DESIGN FIDELITY rules below to the letter.\n`
    : ''

/** Per-shot uniqueness clause — the reason no two prompts are ever the same string. */
const castingSlate = (plan: ShotPlan): string =>
  `Casting slate ${plan.variant}: this is one specific individual with their own bone structure, skin tone and ` +
  `hair — not a stock face, and deliberately different from the default person you would otherwise produce. ` +
  `Photography: ${plan.treatment}.`

// gpt-image-2 casts the model straight from the persona text — the only image
// input is the design itself, so casting variety is unlimited (no stock-photo
// library required). Metal art gets a room scene instead of a person.
//
// garmentNoun defaults to 'crew neck t-shirt' for callers that don't pass one
// (metal art never reaches the wearing clause at all — see the `!plan.persona`
// branch below).
export function buildGptPrompt(
  plan: ShotPlan,
  shirtColor: string,
  placement: string,
  sizeInches: number,
  garmentNoun: string = 'crew neck t-shirt'
): string {
  if (!plan.persona) {
    return (
      retryPreamble(plan) +
      `The INPUT image is a piece of artwork. Task: a professional interior photograph of that artwork ` +
      `reproduced as a thin, frameless, glossy aluminum metal print panel with clean edges, ${plan.scene}. ` +
      `${metalScaleAnchor(plan.metalSize ?? '4x6')} ${plan.treatment}.\n` +
      METAL_PROMPT_TAIL
    )
  }
  return (
    retryPreamble(plan) +
    `The INPUT image is a flat 2D graphic design (a DTF print artwork). ` +
    `Task: a professional ecommerce fashion photograph of ${plan.persona} wearing a ${shirtColor} ${garmentNoun} ` +
    `with the graphic from the INPUT ${wearingClause(placement)}, ${plan.scene}.\n` +
    `${castingSlate(plan)}\n` +
    promptTail(placement, sizeInches)
  )
}

// nano-banana fallback keeps a stock base photo as its anchor (its compositing
// works best with a person to preserve). The anchor is a POSE and FRAMING
// reference only — there are just two stock faces, so without an explicit
// instruction to discard the reference identity every fallback shot came back
// wearing one of the same two faces, which is exactly what the casting rework
// exists to kill. Metal art needs no anchor — design only.
export function buildNanoPrompt(
  plan: ShotPlan,
  shirtColor: string,
  placement: string,
  sizeInches: number,
  garmentNoun: string = 'crew neck t-shirt'
): string {
  if (!plan.persona) {
    return (
      retryPreamble(plan) +
      `The INPUT image is a piece of artwork. Task: a professional interior photograph of that artwork ` +
      `reproduced as a thin, frameless, glossy aluminum metal print panel with clean edges, ${plan.scene}. ` +
      `${metalScaleAnchor(plan.metalSize ?? '4x6')} ${plan.treatment}.\n` +
      METAL_PROMPT_TAIL
    )
  }
  return (
    retryPreamble(plan) +
    `INPUT 1 is a framing reference only. INPUT 2 is a flat 2D graphic design (a DTF print artwork). ` +
    `Task: a professional ecommerce fashion photograph of ${plan.persona} wearing a ${shirtColor} ${garmentNoun} ` +
    `with the graphic from INPUT 2 ${wearingClause(placement)}, ${plan.scene}.\n` +
    `Use INPUT 1 ONLY for camera distance, crop and body angle. DISCARD the person in INPUT 1 entirely — their ` +
    `face, hair, skin tone, age and build must NOT carry over. The subject is the person described above.\n` +
    `${castingSlate(plan)}\n` +
    promptTail(placement, sizeInches)
  )
}

// One shot via the primary engine, falling back to the other on failure.
// Returns a durable GCS public URL either way.
async function generateOneShot(
  plan: ShotPlan,
  designUrl: string,
  shirtColor: string,
  productId: string,
  userId: string,
  placement: string = 'front-center',
  sizeInches: number = 11,
  garmentNoun: string = 'crew neck t-shirt'
): Promise<string> {
  const viaGptImage = async (): Promise<string> => {
    const { url, modelId } = await editOpenAIImage({
      sourceUrl: designUrl,
      prompt: buildGptPrompt(plan, shirtColor, placement, sizeInches, garmentNoun),
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
        prompt: buildNanoPrompt(plan, shirtColor, placement, sizeInches, garmentNoun),
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

// ---------------------------------------------------------------------------
// Fidelity QA — David 2026-07-31 asked for the design to stay TRUE, and prompt
// language alone can't guarantee that. Every finished shot is compared against
// the source artwork by a vision model; a fail buys exactly ONE corrective
// re-render, then the shot lands flagged so the panel can warn instead of the
// bad print quietly becoming an Etsy hero image.
//
// The checker is deliberately generous: it only fails on things a buyer would
// call a wrong product (misspelled/re-drawn text, wrong colors, invented
// elements, the graphic obscured). Fabric folds, lighting and crop are fine.
// If the checker itself errors or isn't configured, the shot passes — QA
// trouble must never cost a paid render.
// ---------------------------------------------------------------------------
async function verifyDesignFidelity(designUrl: string, shotUrl: string): Promise<ShotCheck | null> {
  if (!openai) return null
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_VISION_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a print-shop QA inspector. You compare a source artwork against a photo of that artwork ' +
            'printed on a product, and you report only defects a customer would consider the WRONG product.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'IMAGE 1 is the source artwork. IMAGE 2 is a generated product photo that is supposed to show ' +
                'IMAGE 1 printed on the item.\n\n' +
                'FAIL the photo if any of these are true:\n' +
                '- Any text differs: misspelled, different wording, re-drawn in a different typeface, different ' +
                'line breaks, or letters that are garbled/illegible.\n' +
                '- The artwork was restyled, redrawn, or re-illustrated rather than reproduced.\n' +
                '- Colors are clearly different from the source.\n' +
                '- Elements were added that are not in the source (extra text, logos, watermarks, icons).\n' +
                '- Part of the artwork is missing, cropped off, or hidden behind an arm, hair or object.\n\n' +
                'PASS the photo if the artwork is faithfully reproduced. Do NOT fail it for fabric folds ' +
                'distorting the print, lighting, shadow across the print, perspective, the model, the ' +
                'background, or the print being small in frame.\n\n' +
                'Respond in JSON: {"matches": true|false, "issue": "one short sentence naming the single worst ' +
                'defect, or empty string when it passes"}'
            },
            { type: 'image_url', image_url: { url: designUrl, detail: 'high' } },
            { type: 'image_url', image_url: { url: shotUrl, detail: 'high' } }
          ]
        }
      ],
      ...(isReasoningModel(OPENAI_VISION_MODEL)
        ? { max_completion_tokens: 900 }
        : { max_tokens: 200, temperature: 0 }),
      response_format: { type: 'json_object' }
    })
    const content = response.choices[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content)
    const ok = parsed?.matches !== false
    return ok ? { ok: true } : { ok: false, reason: String(parsed?.issue || 'design did not match the source art').slice(0, 200) }
  } catch (err: any) {
    // Our QA problem, not the shot's — never burn a retry on it.
    console.warn(`[etsy-shots] fidelity check unavailable (${err?.message || err}) — accepting the shot`)
    return null
  }
}

interface ShotContext {
  designUrl: string
  productId: string
  userId: string
  /** The product's print placement — drives the pose and fidelity rule 7. */
  placement: string
  /** Physical print width in inches (garments). */
  sizeInches: number
  /** Garment-true noun for the wearing clause ("pullover hoodie", not "crew neck t-shirt"). */
  garmentNoun: string
  onStage: (stage: string) => Promise<void>
}

/**
 * Render one shot, verify the design survived, and buy one corrective retry if
 * it didn't. Returns whichever render we're keeping plus its verdict.
 */
async function renderVerifiedShot(plan: ShotPlan, shirtColor: string, ctx: ShotContext): Promise<{ url: string; check: ShotCheck }> {
  const url = await generateOneShot(plan, ctx.designUrl, shirtColor, ctx.productId, ctx.userId, ctx.placement, ctx.sizeInches, ctx.garmentNoun)
  const verdict = await verifyDesignFidelity(ctx.designUrl, url)
  if (!verdict || verdict.ok) return { url, check: { ok: true } }

  console.warn(`[etsy-shots] ${ctx.productId} ${plan.key} failed fidelity QA: ${verdict.reason} — one retry`)
  await ctx.onStage(`Design came back wrong (${verdict.reason}) — reshooting…`)

  // Fresh slate id so the retry is a genuinely different roll, plus the note
  // telling the model what to fix.
  const retryPlan: ShotPlan = { ...plan, variant: slateId(), retryNote: verdict.reason }
  const retryUrl = await generateOneShot(retryPlan, ctx.designUrl, shirtColor, ctx.productId, ctx.userId, ctx.placement, ctx.sizeInches, ctx.garmentNoun)
  const retryVerdict = await verifyDesignFidelity(ctx.designUrl, retryUrl)
  if (!retryVerdict || retryVerdict.ok) return { url: retryUrl, check: { ok: true, retried: true } }

  console.warn(`[etsy-shots] ${ctx.productId} ${plan.key} still failing after retry: ${retryVerdict.reason}`)
  return { url: retryUrl, check: { ok: false, reason: retryVerdict.reason, retried: true } }
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

/**
 * Everything a shoot needs off the product row — shared by full shoots and
 * single reshoots. `override.garment` lets a caller that already knows the
 * garment (the Step Flow, via shootOneModelShot — which may run before
 * metadata.product_type is even written) skip the metadata guess entirely.
 */
async function loadShotContext(productId: string, userId: string, override?: { garment?: GarmentId }) {
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

  const garment: GarmentId = override?.garment ?? normalizeGarment((product as any).metadata?.product_type) ?? 'tshirt'
  const garmentNoun = getGarment(garment)?.noun ?? 'crew neck t-shirt'

  return {
    category: String((product as any).category || ''),
    colorFor: (i: number) => (packColors.length ? packColors[i % packColors.length] : baseColor).toLowerCase(),
    ctx: {
      designUrl,
      productId,
      userId,
      placement: String((product as any).metadata?.print_placement || 'front-center'),
      sizeInches: Number((product as any).metadata?.print_size_inches) || 11,
      garmentNoun,
      onStage: (stage: string) => saveShotsState(productId, { stage })
    } as ShotContext
  }
}

const stageFor = (shot: ShotPlan, color: string, i: number, total: number) =>
  shot.persona
    ? `Shooting the ${shot.label} look in ${color} (${i + 1} of ${total})…`
    : `Staging the ${shot.label} (${i + 1} of ${total})…`

async function generateShots(productId: string, userId: string, cast: CastMember[] = []): Promise<void> {
  try {
    const { category, colorFor, ctx } = await loadShotContext(productId, userId)

    const plan = buildShotPlan(category, cast)
    // Record the cast up front so the panel can show who is being shot even
    // while the first image is still rendering.
    await saveShotsState(productId, { cast: plan.map(p => p.label) })

    const images: string[] = []
    const checks: ShotCheck[] = []
    for (const [i, shot] of plan.entries()) {
      console.log(`[etsy-shots] ${productId} ${shot.key} cast: ${shot.signature} [slate ${shot.variant}]`)
      await saveShotsState(productId, { stage: stageFor(shot, colorFor(i), i, plan.length) })
      const { url, check } = await renderVerifiedShot(shot, colorFor(i), ctx)
      images.push(url)
      checks.push(check)
      // Persist incrementally so a failure on shot 2 still keeps shot 1 — and
      // so the panel shows each thumbnail the moment it exists.
      await saveShotsState(productId, { images: [...images], checks: [...checks] })
    }

    await saveShotsState(productId, { status: 'done', images, checks, stage: undefined, generated_at: new Date().toISOString(), error: undefined })
    await mirrorShotsToProductAssets(productId, images, checks)
  } catch (err: any) {
    console.error(`[etsy-shots] generation failed for ${productId}:`, err?.message || err)
    await saveShotsState(productId, { status: 'failed', stage: undefined, error: String(err?.message || err).slice(0, 300) })
  }
}

/**
 * Mirror finished model shots into `product_assets` as mockups (David
 * 2026-08-09: "add the two mockups from the etsy flow" to the builder's three).
 *
 * They are stored ONLY on products.metadata.etsy_shots otherwise, which means
 * nothing that reads mockups — the storefront gallery, the Order Management
 * download panel, the product card — can see them. Mirroring gives them the
 * same shape as every other mockup.
 *
 * A shot that FAILED QA is deliberately not mirrored: it stays in the Etsy
 * panel where an admin can see the flag and reshoot it, but it must not quietly
 * join the product's mockup set. Skips are logged rather than silent.
 *
 * Best-effort throughout — the shoot itself already succeeded, so a mirroring
 * failure must never mark it failed.
 */
async function mirrorShotsToProductAssets(productId: string, images: string[], checks: ShotCheck[]): Promise<void> {
  try {
    const keep = images
      .map((url, i) => ({ url, i, ok: checks[i]?.ok !== false }))
      .filter(s => typeof s.url === 'string' && /^https?:\/\//.test(s.url))

    const denied = keep.filter(s => !s.ok)
    if (denied.length) {
      console.warn(`[etsy-shots] ${productId}: ${denied.length} shot(s) failed QA and were NOT added to the product mockups`)
    }

    // Roles are positional and stable, so a re-shoot replaces its own slot
    // rather than accumulating duplicates.
    const roles = keep.filter(s => s.ok).map(s => ({ ...s, role: `mockup_model_${s.i + 1}` }))
    if (roles.length === 0) return

    await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', productId)
      .in('asset_role', roles.map(r => r.role))

    const { error } = await supabase.from('product_assets').insert(
      roles.map(r => ({
        product_id: productId,
        kind: 'mockup',
        // GCS public URLs are .../<bucket>/<path>; keep the object path when we
        // can so these rows look like every other asset row.
        path: (() => { try { return new URL(r.url).pathname.split('/').slice(2).join('/') || null } catch { return null } })(),
        url: r.url,
        width: 1024,
        height: 1024,
        asset_role: r.role,
        // Never primary: the ghost mannequin owns the hero slot.
        is_primary: false,
        display_order: 5 + r.i,
        metadata: {
          template: 'etsy_model_shot',
          generated_with: 'etsy-model-shots',
          generated_at: new Date().toISOString(),
          qa_ok: true,
        },
      }))
    )
    if (error) {
      console.error(`[etsy-shots] ${productId}: mirroring shots to product_assets failed:`, error.message)
      return
    }
    console.log(`[etsy-shots] ${productId}: mirrored ${roles.length} model shot(s) into product_assets`)
  } catch (err: any) {
    console.error(`[etsy-shots] ${productId}: mirroring threw (non-fatal):`, err?.message || err)
  }
}

// Replace exactly one shot, keeping the others (David 2026-07-31: "i need a way
// to reshoot as well if i dont like the model"). Rejecting a face should cost
// one render, not a whole new shoot.
async function reshootOne(productId: string, userId: string, index: number, cast: CastMember[]): Promise<void> {
  try {
    const { category, colorFor, ctx } = await loadShotContext(productId, userId)

    let plan: ShotPlan
    if (category === 'metal-art') {
      // Each metal slot is bound to a physical panel size — rebuild the plan and
      // take this slot so the reshot photo still stages the size it should.
      plan = buildShotPlan(category)[index] ?? buildShotPlan(category)[0]
    } else {
      const { data: row } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
      const keptLabels = (((row as any)?.metadata?.etsy_shots?.cast as string[] | undefined) ?? [])
        .filter((_, i) => i !== index)
      // No pick = "just give me someone else", so avoid the archetype that's
      // still sitting in the other slot rather than rolling a possible twin.
      const member = cast[0] ?? (() => {
        const pool = ARCHETYPES.filter(a => !keptLabels.includes(a.label))
        const a = pick(pool.length ? pool : ARCHETYPES)
        return { label: a.label, archetype: a, custom: null } as CastMember
      })()
      plan = castShot(`shot${index + 1}`, member, pick(SCENES))
    }

    console.log(`[etsy-shots] ${productId} reshoot #${index + 1} cast: ${plan.signature} [slate ${plan.variant}]`)
    await saveShotsState(productId, { stage: stageFor(plan, colorFor(index), index, index + 1) })
    const { url, check } = await renderVerifiedShot(plan, colorFor(index), ctx)

    // Re-read at write time: the admin may have pruned another shot while this ran.
    const { data: fresh } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
    const current: EtsyShots = (fresh as any)?.metadata?.etsy_shots || { status: 'generating', images: [] }
    const images = [...current.images]
    const castLabels = [...(current.cast ?? [])]
    const checks = [...(current.checks ?? [])]
    // The list shrank under us — append rather than write past the end.
    const at = index < images.length ? index : images.length
    images[at] = url
    castLabels[at] = plan.label
    checks[at] = check

    await saveShotsState(productId, {
      status: 'done',
      images,
      cast: castLabels,
      checks,
      stage: undefined,
      generated_at: new Date().toISOString(),
      error: undefined
    })
    // Keep the mirrored mockups in step with the reshoot, or the product would
    // keep showing the model the admin just rejected.
    await mirrorShotsToProductAssets(productId, images, checks)
  } catch (err: any) {
    console.error(`[etsy-shots] reshoot failed for ${productId} #${index + 1}:`, err?.message || err)
    await saveShotsState(productId, { status: 'failed', stage: undefined, error: String(err?.message || err).slice(0, 300) })
  }
}

/**
 * Kick off a single-shot reshoot (fire-and-forget, same polling contract as a
 * full shoot). `cast` is optional — omit it for "anyone but this person".
 */
export async function reshootModelShot(
  productId: string,
  userId: string,
  index: number,
  cast?: ShotCast
): Promise<EtsyShots> {
  if (!process.env.OPENAI_API_KEY && !replicate) {
    throw new Error('Neither OPENAI_API_KEY nor REPLICATE_API_TOKEN is configured — no shot engine available')
  }
  const resolved = resolveCast(cast)

  const { data: product, error } = await supabase
    .from('products')
    .select('id, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const existing: EtsyShots | undefined = (product as any).metadata?.etsy_shots
  if (!existing?.images?.length) throw new ShotCastError('There are no shots to reshoot yet — run a shoot first')
  if (!Number.isInteger(index) || index < 0 || index >= existing.images.length) {
    throw new ShotCastError(`No photo #${index + 1} to reshoot`)
  }
  if (existing.status === 'generating') {
    const age = Date.now() - new Date(existing.started_at || 0).getTime()
    if (age < 10 * 60 * 1000) return existing
  }

  const state: EtsyShots = {
    ...existing,
    status: 'generating',
    stage: `Recasting photo ${index + 1}${resolved.length ? ` as ${resolved.map(c => c.label).join(' + ')}` : ''}…`,
    started_at: new Date().toISOString(),
    error: undefined
  }
  await supabase
    .from('products')
    .update({ metadata: { ...((product as any).metadata || {}), etsy_shots: state } })
    .eq('id', productId)

  void reshootOne(productId, userId, index, resolved).catch(err =>
    console.error(`[etsy-shots] unhandled reshoot error for ${productId}:`, err)
  )
  return state
}

/**
 * Render exactly ONE verified on-model shot and append it to
 * `metadata.etsy_shots.images` — the Step Flow's `model` shot key (plan
 * 2026-09-01-imagine-studio-step-flow-plan.md, Track A #4). Unlike
 * `startModelShots` / `reshootModelShot`, this is AWAITED directly by its
 * caller (a step-flow job renders one shot per call, not a two-shot casting
 * session), so it does none of their "already generating" fire-and-forget
 * bookkeeping — it renders, records, and returns.
 *
 * `opts.garment` lets the caller pass the garment before it's necessarily
 * written to `metadata.product_type` yet (loadShotContext falls back to
 * `normalizeGarment(metadata.product_type)` → 'tshirt' otherwise).
 * `opts.shirtColor` overrides the product's/pack's color for this one shot.
 * `opts.nonce` is folded into the shot key purely for log traceability across
 * retries/redos — casting itself is already always fresh (see castShot).
 */
export async function shootOneModelShot(
  productId: string,
  userId: string,
  opts: { shirtColor?: ColorId; garment?: GarmentId; cast?: ShotCast; nonce?: string; mirror?: boolean } = {}
): Promise<{ url: string; check: ShotCheck }> {
  if (!process.env.OPENAI_API_KEY && !replicate) {
    throw new Error('Neither OPENAI_API_KEY nor REPLICATE_API_TOKEN is configured — no shot engine available')
  }
  const resolved = resolveCast(opts.cast)
  const { colorFor, ctx } = await loadShotContext(productId, userId, { garment: opts.garment })

  const member: CastMember = resolved[0] ?? (() => {
    const a = pick(ARCHETYPES)
    return { label: a.label, archetype: a, custom: null }
  })()
  const plan = castShot(`step-model${opts.nonce ? `-${opts.nonce}` : ''}`, member, pick(SCENES))
  const shirtColor = opts.shirtColor ? (COLORS[opts.shirtColor]?.label.toLowerCase() ?? opts.shirtColor) : colorFor(0)

  console.log(`[etsy-shots] ${productId} ${plan.key} (step-flow single shot) cast: ${plan.signature} [slate ${plan.variant}]`)
  const { url, check } = await renderVerifiedShot(plan, shirtColor, ctx)

  // Re-read at write time (same pattern as reshootOne/saveShotsState) and
  // APPEND — never clobber whatever the object already held.
  const { data: fresh } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  const metadata = (fresh as any)?.metadata || {}
  const current: EtsyShots | undefined = metadata.etsy_shots
  const images = [...(current?.images ?? []), url]
  const checks = [...(current?.checks ?? []), check]
  const cast = [...(current?.cast ?? []), plan.label]
  const { error: updErr } = await supabase
    .from('products')
    .update({
      metadata: {
        ...metadata,
        etsy_shots: {
          ...(current ?? { status: 'done', images: [] }),
          // Create fresh as 'done' (a single awaited shot is already a
          // finished result); if the object already existed, leave its
          // status exactly as it was rather than assuming a state.
          status: current?.status ?? 'done',
          images,
          checks,
          cast,
          generated_at: new Date().toISOString(),
        },
      },
    })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to record the step-flow model shot: ${updErr.message}`)

  // Mirroring is opt-in here. mirrorShotsToProductAssets assigns roles by
  // POSITION over the whole accumulated etsy_shots.images, so a caller that
  // also writes its own mockup_model_1 row (the step flow does, per redo)
  // would end up with the same shot under two roles. The caller owns the row.
  if (opts.mirror) await mirrorShotsToProductAssets(productId, images, checks)
  return { url, check }
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
    checks: [], // a fresh shoot never inherits the last run's QA verdicts
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
  const previous: EtsyShots | undefined = metadata.etsy_shots
  // The cast and QA verdicts are positional, so pruning an image has to prune
  // its row too — otherwise photo 2 inherits the removed photo's warning.
  const keptIndexes = clean.map(url => (previous?.images ?? []).indexOf(url)).filter(i => i >= 0)
  const realign = <T,>(list: T[] | undefined): T[] | undefined =>
    list?.length ? keptIndexes.map(i => list[i]).filter((v): v is T => v !== undefined) : undefined

  const state: EtsyShots = {
    ...(previous || {}),
    status: clean.length ? 'done' : (previous?.status === 'generating' ? 'generating' : 'done'),
    images: clean,
    cast: realign(previous?.cast),
    checks: realign(previous?.checks)
  }
  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...metadata, etsy_shots: state } })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to persist shots: ${updErr.message}`)
  return state
}
