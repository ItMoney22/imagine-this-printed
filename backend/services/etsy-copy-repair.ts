// ---------------------------------------------------------------------------
// Mrs. Imagine's copy repair — the half of "she fixes it herself" that owns
// title, tags and description.
//
// WHY THIS IS NOT JUST "COMPOSE AGAIN"
// David hit the Etsy step on 2026-09-08 with a 32-character title and ZERO
// tags. That pair is a signature, not a coincidence: it is exactly what
// `mechanicalPack()` in etsy-seo-composer.ts emits when the composer model is
// unavailable and `search_keywords` is empty — the product name, verbatim, and
// nothing else. Re-running the same composer against the same missing key
// produces the same two failures forever, so the flow would loop instead of
// clearing.
//
// So repair is TWO layers, in this order:
//   1. one targeted model call that is TOLD what the gate objected to
//   2. `repairCopy()` — pure, deterministic, no network — which rewrites
//      whatever it is handed until the gate's own SEO rules are satisfied
// Layer 2 is the one that must never fail. It is why this module is pure and
// separately tested: with no API key at all, the Step Flow still clears.
//
// It writes nothing it cannot support. Every factual claim it can add (soft
// unisex tee, DTF ink, made to order in Rockmart GA, wash cold inside out,
// the metal substrate and sizes) is already a sanctioned claim in the
// composer's own system prompt or in shared/metal-art.ts. It never invents
// materials, shipping promises or sizes.
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import { MAX_TAGS, MAX_TAG_LEN, MAX_TITLE_LEN, toEtsyTag, toEtsyTags } from './etsy-listing-fields.js'
import {
  COMPOSER_MODEL,
  composerClient,
  etsyAnchorPriceFor,
  isHoodieProduct,
  type EtsyPack,
} from './etsy-seo-composer.js'
import {
  DESCRIPTION_MIN_CHARS,
  FILLER_TAGS,
  HOOK_MAX_CHARS,
  MAX_TITLE_COMMAS,
  SEO_RULES,
  checkSeo,
  type Channel,
} from './presentation-qa.js'
import { METAL_ART_MOUNTING_COPY, METAL_ART_SIZES, METAL_ART_SUBSTRATE, ETSY_SIZE_KEYS } from '../shared/metal-art.js'

const EMOJI_GLOBAL = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/gu

const squash = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()
const normalise = (s: string): string => squash(s).toLowerCase().replace(/[^a-z0-9 ]/g, '')

/** What the repairer needs to know about the listing. Deliberately a plain
 *  value object with no DB types in it, so the rules can be tested directly. */
export interface CopySubject {
  channel: Channel
  /** The product's own name — the design's identity, and the one thing the
   *  repairer treats as given rather than rewritable. */
  name: string
  category: string | null
  /** step_flow.garment / metadata.garment, when known ('tshirt', 'hoodie'…). */
  garment?: string | null
  /** Catalogue `search_keywords`, the free source of real buyer phrases. */
  keywords?: string | null
  title: string
  description: string
  tags: string[]
}

export interface RepairedCopy {
  title: string
  tags: string[]
  description: string
  /** One plain sentence per thing that actually changed, for David to read. */
  changes: string[]
}

// ---------------------------------------------------------------------------
// Product nouns and phrase banks.
//
// These are the ONLY vocabulary the deterministic path can reach for, so each
// entry has to be true of the thing being sold, not merely plausible.
// ---------------------------------------------------------------------------
type Kind = 'hoodie' | 'tee' | 'metal' | 'transfer' | 'other'

export function kindOf(subject: Pick<CopySubject, 'category' | 'garment' | 'name'>): Kind {
  const category = String(subject.category ?? '')
  if (category === 'metal-art') return 'metal'
  if (category === 'dtf-transfers') return 'transfer'
  if (category === 'hoodies') return 'hoodie'
  if (isHoodieProduct({ category: subject.category, name: subject.name, metadata: { garment: subject.garment } })) {
    return 'hoodie'
  }
  if (category === 'shirts') return 'tee'
  if (/tee|shirt/i.test(String(subject.garment ?? ''))) return 'tee'
  return 'other'
}

const PRODUCT_NOUN: Record<Kind, string> = {
  hoodie: 'Unisex Hoodie',
  tee: 'Unisex Graphic Tee',
  metal: 'Metal Print Wall Art',
  transfer: 'DTF Transfer',
  other: 'Print',
}

/** The tail that turns a bare design name into a listing title. Every clause
 *  is a fact ITP can stand behind (see the composer's system prompts). */
const TITLE_TAIL: Record<Kind, string[]> = {
  hoodie: ['Cozy Graphic Sweatshirt', 'Made to Order Gift Idea'],
  tee: ['Soft Graphic T-Shirt', 'Made to Order Gift Idea'],
  metal: [`Glossy ${METAL_ART_SUBSTRATE.charAt(0).toUpperCase()}${METAL_ART_SUBSTRATE.slice(1)} Wall Decor`, 'Ready to Hang Art Print'],
  transfer: ['Ready to Press Heat Transfer', 'Made to Order'],
  other: ['Made to Order Print'],
}

/** Buyer phrases by product kind, in the order they are worth having. Filler
 *  words ("shirt", "gift", "art") never appear alone — the gate blocks those
 *  outright, and it is right to: they rank for nothing. */
const PHRASE_BANK: Record<Kind, string[]> = {
  hoodie: [
    'graphic hoodie', 'unisex hoodie', 'cozy sweatshirt', 'streetwear hoodie', 'pullover hoodie',
    'gift for her', 'gift for him', 'birthday gift idea', 'christmas gift idea',
    'oversized sweatshirt', 'statement hoodie', 'everyday hoodie', 'crewneck alternative',
  ],
  tee: [
    'graphic tee', 'unisex t shirt', 'statement tee', 'soft cotton tee', 'streetwear tee',
    'gift for her', 'gift for him', 'birthday gift idea', 'christmas gift idea',
    'oversized tee', 'everyday outfit', 'summer graphic tee', 'aesthetic tee',
  ],
  metal: [
    'metal wall art', `${METAL_ART_SUBSTRATE} wall art`, 'wall decor print', 'living room decor',
    'office wall art', 'bedroom wall decor', 'gift for art lover', 'housewarming gift',
    'ready to hang art', 'modern wall decor', 'glossy art print', 'statement wall art',
    'birthday gift idea',
  ],
  transfer: [
    'dtf transfer', 'ready to press', 'heat transfer print', 'iron on transfer',
    'diy shirt transfer', 'craft supply print', 'small business supply', 'full color transfer',
    'gift for crafter', 'sublimation alternative', 'apparel transfer', 'press ready design',
    'custom transfer print',
  ],
  other: [
    'made to order', 'gift for her', 'gift for him', 'birthday gift idea', 'christmas gift idea',
    'home decor print', 'statement piece', 'custom print design', 'small shop find',
    'handmade shop gift', 'unique wall decor', 'everyday essential', 'modern print design',
  ],
}

/** Words that carry no subject meaning, so they must not seed a tag on their own. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'your', 'my',
  'is', 'it', 'that', 'this', 'you', 'we', 'at', 'by', 'from', 'be', 'are',
])

const isFiller = (tag: string): boolean => FILLER_TAGS.has(normalise(tag))

/** Subject phrases pulled out of the design's own name — the tags that are
 *  actually about THIS design rather than about the product category. */
export function subjectPhrases(name: string, kind: Kind): string[] {
  const words = normalise(name).split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w))
  if (!words.length) return []
  const noun = kind === 'metal' ? 'wall art' : kind === 'hoodie' ? 'hoodie' : kind === 'transfer' ? 'transfer' : 'shirt'
  const out: string[] = []
  // Longest first: a two-word subject ("cherry blossom") is a better tag than
  // either word alone, and pairing it with the product noun is the shape
  // shoppers actually search in.
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`)
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]} ${noun}`)
  for (const w of words) out.push(`${w} ${noun}`)
  return out
}

// ---------------------------------------------------------------------------
// TITLE
// ---------------------------------------------------------------------------
function repairTitle(subject: CopySubject, changes: string[]): string {
  const rules = SEO_RULES[subject.channel]
  const kind = kindOf(subject)
  let title = squash(subject.title).replace(EMOJI_GLOBAL, '')
  title = squash(title)
  if (title !== squash(subject.title)) changes.push('Stripped emoji from the title — they do not index on Etsy.')

  // A comma-stacked keyword list is a blocking failure. The stacked phrases are
  // not worthless, they are just in the wrong field: keep the first segment as
  // the title and let the tag repair pick the rest up from `keywords`.
  if ((title.match(/,/g) || []).length > MAX_TITLE_COMMAS) {
    title = squash(title.split(',')[0])
    changes.push('Rewrote the comma-stacked title as a readable phrase — Etsy penalises keyword lists.')
  }

  const base = title || squash(subject.name)
  const noun = PRODUCT_NOUN[kind]

  if (base.length < rules.titleMin) {
    const parts = [base]
    if (!normalise(base).includes(normalise(noun))) parts.push(noun)
    let next = parts.join(' ')
    for (const tail of TITLE_TAIL[kind]) {
      if (next.length >= rules.titleIdeal[0]) break
      const candidate = `${next} | ${tail}`
      if (candidate.length <= rules.titleIdeal[1]) next = candidate
    }
    // Still short only if the design name is a couple of characters; the noun
    // and one tail clause always clear 40 in practice, and a title under the
    // minimum is better than an invented one.
    title = next
    changes.push(`Grew the title from ${base.length} to ${title.length} characters (Etsy wants at least ${rules.titleMin}).`)
  } else if (base.length > rules.titleMax) {
    const words = base.split(' ')
    let cut = ''
    for (const w of words) {
      const nextCut = cut ? `${cut} ${w}` : w
      if (nextCut.length > rules.titleIdeal[1]) break
      cut = nextCut
    }
    title = cut || base.slice(0, rules.titleIdeal[1])
    changes.push(`Cut the title to ${title.length} characters (the maximum is ${rules.titleMax}).`)
  } else {
    title = base
  }

  return title.slice(0, MAX_TITLE_LEN)
}

// ---------------------------------------------------------------------------
// TAGS
// ---------------------------------------------------------------------------
function repairTags(subject: CopySubject, title: string, changes: string[]): string[] {
  const rules = SEO_RULES[subject.channel]
  const kind = kindOf(subject)
  const before = subject.tags.length

  const seen = new Set<string>()
  const out: string[] = []
  let dropped = 0
  const push = (raw: string, countDrop = false): void => {
    if (out.length >= MAX_TAGS) return
    const tag = subject.channel === 'etsy' ? toEtsyTag(raw) : squash(raw)
    if (!tag) { if (countDrop) dropped++; return }
    if (subject.channel === 'etsy' && tag.length > MAX_TAG_LEN) { if (countDrop) dropped++; return }
    if (isFiller(tag)) { if (countDrop) dropped++; return }
    const key = normalise(tag)
    if (!key || seen.has(key)) { if (countDrop) dropped++; return }
    seen.add(key)
    out.push(tag)
  }

  // 1. Whatever is already there, cleaned.
  for (const t of subject.tags) push(t, true)
  // 2. Phrases about THIS design, so the tags are not generic category filler.
  for (const p of subjectPhrases(subject.name, kind)) push(p)
  // 3. The catalogue's own keywords — real phrases someone already chose.
  for (const t of toEtsyTags(subject.keywords)) push(t)
  // 4. The category bank, last, as the top-up that guarantees a legal count.
  for (const p of PHRASE_BANK[kind]) push(p)

  if (dropped > 0) changes.push(`Dropped ${dropped} unusable tag(s) — duplicates, filler words, or over Etsy's ${MAX_TAG_LEN}-character limit.`)
  if (out.length > before) changes.push(`Filled the tags out to ${out.length} of ${rules.tagsIdeal} — every empty slot is a search the listing cannot appear in.`)

  // Tag/copy agreement: Etsy weighs it, and the gate warns when nothing lines
  // up. The subject phrases come from the name, which is in the title, so this
  // normally holds already — this is the guard for a hand-edited title.
  const haystack = normalise(title)
  if (out.length && !out.some(t => normalise(t).length > 3 && haystack.includes(normalise(t)))) {
    const anchor = subjectPhrases(subject.name, kind)[0]
    if (anchor) {
      const tag = toEtsyTag(anchor)
      if (tag && !seen.has(normalise(tag))) {
        out.pop()
        out.push(tag)
      }
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// DESCRIPTION
// ---------------------------------------------------------------------------
const METAL_SIZE_TEXT = ETSY_SIZE_KEYS.map(k => `${METAL_ART_SIZES[k].widthIn}x${METAL_ART_SIZES[k].heightIn}`).join(' and ') + ' inches'

function bodyFor(kind: Kind, name: string): string {
  if (kind === 'metal') {
    return [
      'The artwork',
      `${name}, printed edge to edge so the colours stay vivid under the gloss.`,
      '',
      'The panel',
      `A dye-sublimated ${METAL_ART_SUBSTRATE} panel — the ink is infused into the surface, so it is fade- and scratch-resistant and stays light enough to hang anywhere.`,
      '',
      'Sizes',
      `Offered in ${METAL_SIZE_TEXT}. Pick your size at checkout.`,
      '',
      'Display',
      `${METAL_ART_MOUNTING_COPY} — light enough for a shelf or an easel too.`,
      '',
      'Made to order',
      'Every panel is printed by hand in Rockmart, Georgia once you order.',
      '',
      'Care',
      'Wipe clean with a soft dry cloth.',
    ].join('\n')
  }
  if (kind === 'transfer') {
    return [
      'The design',
      `${name}, printed as a full-colour DTF transfer film ready for your own press.`,
      '',
      'What you get',
      'A printed transfer sheet — the design only, not a finished garment.',
      '',
      'Made to order',
      'Printed by hand in Rockmart, Georgia once you order.',
      '',
      'Care',
      'Store flat and out of direct sunlight until you press it.',
    ].join('\n')
  }
  const garmentWord = kind === 'hoodie' ? 'hoodie' : 'tee'
  return [
    'The design',
    `${name}, printed with vivid DTF ink so the colours stay bright wash after wash.`,
    '',
    kind === 'hoodie' ? 'The hoodie' : 'The shirt',
    `A soft unisex ${garmentWord} with a classic fit. Size up if you like it roomy and oversized.`,
    '',
    'Made to order',
    `Every ${garmentWord} is printed by hand in Rockmart, Georgia once you order.`,
    '',
    'Care',
    'Machine wash cold, inside out, and tumble dry low. Do not iron directly on the print.',
  ].join('\n')
}

function repairDescription(subject: CopySubject, changes: string[]): string {
  const kind = kindOf(subject)
  const existing = String(subject.description ?? '').trim()
  const firstLine = existing.split('\n').map(l => l.trim()).find(Boolean) ?? ''

  let hook = firstLine
  if (!hook) {
    hook =
      kind === 'metal'
        ? `${squash(subject.name)} on a glossy ${METAL_ART_SUBSTRATE} panel, made to order and ready to hang.`
        : kind === 'transfer'
          ? `${squash(subject.name)} as a ready-to-press DTF transfer, printed to order for your own garments.`
          : `${squash(subject.name)} printed on a soft unisex ${kind === 'hoodie' ? 'hoodie' : 'tee'}, made to order in Rockmart, Georgia.`
  }
  if (hook.length > HOOK_MAX_CHARS) {
    // The mobile preview cuts at ~155 characters, so a too-long opener is
    // trimmed to the last whole sentence (or word) that fits, and the rest
    // survives as the paragraph under it.
    const sentences = hook.match(/[^.!?]+[.!?]?/g) ?? [hook]
    let cut = ''
    for (const s of sentences) {
      if ((cut + s).trim().length > HOOK_MAX_CHARS) break
      cut += s
    }
    const trimmed = cut.trim() || hook.slice(0, HOOK_MAX_CHARS).replace(/\s+\S*$/, '')
    changes.push(`Shortened the opening line to ${trimmed.length} characters so it survives Etsy's mobile preview.`)
    hook = trimmed
  }

  if (existing.length >= DESCRIPTION_MIN_CHARS && hook === firstLine) return existing

  const rest = existing.split('\n').slice(1).join('\n').trim()
  const description = [hook, '', rest, rest ? '' : null, bodyFor(kind, squash(subject.name))]
    .filter(v => v !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (existing.length < DESCRIPTION_MIN_CHARS) {
    changes.push(
      `Grew the description from ${existing.length} to ${description.length} characters — the sections buyers look for (the design, the product, made to order, care).`
    )
  }
  return description
}

/**
 * Rewrite a listing's copy until the gate's own SEO rules are satisfied. Pure:
 * no network, no database, no model. This is the floor the whole self-repair
 * loop stands on — if it cannot fix a listing, nothing automated can.
 */
export function repairCopy(subject: CopySubject): RepairedCopy {
  const changes: string[] = []
  const title = repairTitle(subject, changes)
  const tags = repairTags(subject, title, changes)
  const description = repairDescription(subject, changes)
  return { title, tags, description, changes }
}

// ---------------------------------------------------------------------------
// The model pass. One call, and it is TOLD what the gate objected to — the
// difference between "write me a listing" (which is what already failed) and
// "this listing was rejected for these three reasons, fix them".
// ---------------------------------------------------------------------------
const REPAIR_SYSTEM =
  'You are fixing an Etsy listing that a quality gate REJECTED. You are given the current title, tags and ' +
  'description and the exact objections. Rewrite all three so every objection is resolved, and keep everything ' +
  'the gate did not object to. Respond ONLY with JSON: {"title": string, "tags": string[], "description": string}. ' +
  'TITLE: 50-90 characters, readable, no comma-stacked keyword lists, no emoji, no ALL-CAPS words. ' +
  'TAGS: exactly 13 lowercase buyer phrases of 2-3 words, each 20 characters or fewer, no duplicates, no bare ' +
  'generic words like "shirt" or "gift". DESCRIPTION: at least 320 characters; the first line is a standalone ' +
  'hook under 155 characters. Never invent materials, sizes, or shipping promises — use only what you are given.'

async function modelRepair(subject: CopySubject, objections: string[]): Promise<Partial<CopySubject> | null> {
  const client = composerClient()
  if (!client) return null
  try {
    const completion = await client.chat.completions.create({
      model: COMPOSER_MODEL,
      response_format: { type: 'json_object' },
      ...(/^(o[1-9]|gpt-5)/.test(COMPOSER_MODEL) ? { max_completion_tokens: 900 } : { max_tokens: 900 }),
      messages: [
        { role: 'system', content: REPAIR_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            product_name: subject.name,
            category: subject.category,
            current_title: subject.title,
            current_tags: subject.tags,
            current_description: subject.description,
            objections,
          }),
        },
      ],
    })
    const raw = completion.choices[0]?.message?.content
    const unfenced = raw?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    if (!unfenced) return null
    const parsed = JSON.parse(unfenced)
    return {
      title: typeof parsed?.title === 'string' ? parsed.title : subject.title,
      description: typeof parsed?.description === 'string' ? parsed.description : subject.description,
      tags: Array.isArray(parsed?.tags) ? parsed.tags.map((t: unknown) => String(t)) : subject.tags,
    }
  } catch (err: any) {
    // Not fatal, and deliberately not surfaced as an error: the deterministic
    // pass below is a complete fix on its own.
    console.warn(`[copy-repair] model pass failed (${err?.message || err}) — deterministic repair only`)
    return null
  }
}

export interface PackRepairResult {
  repaired: boolean
  changes: string[]
  /** SEO objections still standing after the repair — normally empty. */
  stillBlocking: string[]
  pack: EtsyPack | null
  usedModel: boolean
}

/**
 * Repair the stored Etsy pack for one product and persist it.
 *
 * Order is model-then-deterministic on purpose: the model writes better copy
 * when it can, and `repairCopy` then holds whatever came back to the same
 * measurable rules, so a lazy or truncated model answer cannot ship.
 */
export async function repairEtsyPack(productId: string, objections: string[]): Promise<PackRepairResult> {
  const { data: product, error } = await supabase
    .from('products')
    .select('id, name, description, category, price, meta_title, meta_description, search_keywords, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const metadata: Record<string, any> = (product as any).metadata ?? {}
  const existing: EtsyPack | undefined = metadata.etsy_pack
  const subject: CopySubject = {
    channel: 'etsy',
    name: squash(product.name),
    category: product.category ?? null,
    garment: metadata.step_flow?.garment ?? metadata.garment ?? null,
    keywords: (product as any).search_keywords ?? null,
    title: squash(existing?.title || (product as any).meta_title || product.name || ''),
    description: String(existing?.description || product.description || (product as any).meta_description || '').trim(),
    tags: Array.isArray(existing?.tags) ? existing!.tags.map(String) : toEtsyTags((product as any).search_keywords),
  }

  const fromModel = await modelRepair(subject, objections)
  const repaired = repairCopy(fromModel ? { ...subject, ...fromModel } : subject)

  // Grade the repair through the SAME function the gate uses, so "fixed" here
  // and "passes" there can never mean two different things.
  const verdict = checkSeo({
    channel: 'etsy',
    title: repaired.title,
    description: repaired.description,
    tags: repaired.tags,
  })
  const stillBlocking = verdict.findings.filter(f => f.severity === 'block').map(f => f.issue)

  const changed =
    repaired.title !== subject.title ||
    repaired.description !== subject.description ||
    repaired.tags.join(' ') !== subject.tags.join(' ')

  if (!changed) {
    return { repaired: false, changes: [], stillBlocking, pack: existing ?? null, usedModel: !!fromModel }
  }

  const pack: EtsyPack = {
    ...(existing ?? {
      price: etsyAnchorPriceFor(product as any),
      colors: [],
      composed_at: new Date().toISOString(),
      model: 'repair',
    }),
    title: repaired.title,
    tags: repaired.tags,
    description: repaired.description,
    model: fromModel ? `${COMPOSER_MODEL}+repair` : 'deterministic-repair',
    edited_at: new Date().toISOString(),
  } as EtsyPack

  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...metadata, etsy_pack: pack } })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to persist the repaired pack: ${updErr.message}`)

  const changes = fromModel
    ? ['Rewrote the listing copy against the review\'s objections.', ...repaired.changes]
    : repaired.changes
  return { repaired: true, changes, stillBlocking, pack, usedModel: !!fromModel }
}
