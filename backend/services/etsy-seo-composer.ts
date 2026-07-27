// ---------------------------------------------------------------------------
// Etsy listing composer — per-product, opt-in, Etsy-native copy.
//
// The first 17 drafts (2026-07-25) were built by squeezing ITP's *website* SEO
// fields (meta_title, search_keywords) into Etsy's format. David rejected all
// of them: the copy reads like website metadata, not like a listing a shopper
// would click. This composer writes the listing FOR Etsy instead — a stacked
// 140-char search title, 13 whole-phrase buyer tags, and a shopper-facing
// description — and stores the pack on products.metadata.etsy_pack, where the
// publisher (services/etsy.ts) prefers it over the mechanical field mapping.
//
// Pricing is not the model's job: every pack carries the $25 anchor price
// (ETSY_ANCHOR_PRICE). The $15 shoppers actually pay comes from a 40% shop
// sale David runs in Shop Manager (Etsy has no API for sales events), so the
// listing shows ~~$25~~ $15.
//
// Model: ETSY_SEO_MODEL. Default routes through OpenRouter to
// google/gemini-2.5-flash-lite ($0.10/$1M in, $0.40/$1M out) — a 25x cost cut
// against the old gpt-4o default ($2.50/$10.00) that also gets us off a model
// OpenAI has slated for retirement. Copy quality was the reason this call
// stepped above the cost-first rule in the first place, so the migration was
// A/B'd against gpt-4o on real products before flipping (see
// docs/2026-07-26-etsy-seo-model-migration.md).
//
// Two tiers, then mechanical:
//   1. OPENROUTER_API_KEY set -> ETSY_SEO_MODEL (google/gemini-2.5-flash-lite)
//   2. OPENAI_API_KEY set     -> ETSY_SEO_FALLBACK_MODEL (gpt-5.4-nano)
//   3. neither, or both failed -> mechanicalPack()
// Tier 2 is a RUNTIME retry, not just a config default, because the failure we
// actually hit is a live-but-rejected OpenRouter key (the repo's own .env was
// carrying a rotated-out key that 401s "User not found" on 2026-07-26). With a
// single tier that 401 is swallowed by the catch below and every listing
// quietly degrades to mechanical copy — which is exactly the failure mode that
// killed draft batch 1.
// ---------------------------------------------------------------------------
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { MAX_TAGS, MAX_TITLE_LEN, toEtsyTag, toEtsyTags, toEtsyTitle } from './etsy-listing-fields.js'
import { completionTokenParam } from './model-compat.js'

const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY
const COMPOSER_MODEL =
  process.env.ETSY_SEO_MODEL || (USE_OPENROUTER ? 'google/gemini-2.5-flash-lite' : 'gpt-5.4-nano')
const FALLBACK_MODEL = process.env.ETSY_SEO_FALLBACK_MODEL || 'gpt-5.4-nano'
export const ETSY_ANCHOR_PRICE = Number(process.env.ETSY_ANCHOR_PRICE || 25)

// Same client shape as routes/ai/chat.ts and services/imagine-brain.ts:
// OpenRouter speaks the OpenAI SDK dialect, so only the model string changes.
const openrouter = USE_OPENROUTER
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://imaginethisprinted.com',
        'X-Title': 'ImagineThisPrinted - Etsy Listing Composer'
      }
    })
  : null
const openaiDirect = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// Ordered attempt list, built once. Empty => no key at all => mechanical only.
const MODEL_TIERS: { client: OpenAI, model: string }[] = [
  ...(openrouter ? [{ client: openrouter, model: COMPOSER_MODEL }] : []),
  ...(openaiDirect ? [{ client: openaiDirect, model: openrouter ? FALLBACK_MODEL : COMPOSER_MODEL }] : [])
]

export interface EtsyPack {
  title: string
  tags: string[]
  description: string
  price: number
  /** Shirt colors offered as an Etsy Color variation (buyer picks). First one
   *  is the lead color; model shots rotate through the list. */
  colors: string[]
  composed_at: string
  model: string
  edited_at?: string
}

// ITP's DTF-safe tee palette — panel edits are validated against nothing (any
// string Etsy accepts is fine), this is just the sensible default source.
const DEFAULT_SECOND_COLOR = 'Black'

const titleCaseColor = (c: string) => c.trim().replace(/\s+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())

export function defaultColorsFor(product: any): string[] {
  const own = titleCaseColor(String(
    product?.metadata?.shirt_color || product?.metadata?.dtf_settings?.shirt_color || 'Black'
  ))
  return [...new Set([own, DEFAULT_SECOND_COLOR])]
}

// Exported so scripts/compare-etsy-seo-models.ts can A/B a candidate model
// against the EXACT production prompt instead of a drifting copy of it.
export const SYSTEM_PROMPT =
  'You write Etsy listing copy for ImagineThisPrinted, a custom print shop selling soft unisex tees ' +
  'with DTF-printed designs, made to order in Rockmart, Georgia. Respond ONLY with JSON: ' +
  '{"title": string, "tags": string[], "description": string}. Rules: ' +
  'TITLE: clear and human-readable — Etsy\'s current quality guidance explicitly penalizes keyword-stuffed, ' +
  'comma-stacked titles (their own listing feedback rewrites them). Format: the design name, one or two ' +
  'natural style descriptors, the product type, then optionally ONE "|" separator and a short audience/fit ' +
  'phrase. Example shape: "Simply Be You Retro Varsity T-Shirt | Unisex Graphic Tee". Aim for 50-90 ' +
  'characters. No comma-separated keyword lists, no repeated synonyms, no emoji, no ALL-CAPS words, no ' +
  'quotes. Every search phrase you would have stacked in the title belongs in the tags instead. ' +
  'TAGS (exactly 13): 2-3 word lowercase buyer phrases, each <=20 characters, no duplicates or ' +
  'near-duplicates, no bare generic words like "shirt". Spread across: style/aesthetic, audience, ' +
  'occasion/season, gift phrasing, and the design subject. ' +
  'DESCRIPTION: first line is a hook <=155 chars saying what it is and who it is for (that is the ' +
  'mobile preview). Then short scannable sections: the design; the shirt (soft unisex tee, vibrant ' +
  'DTF print); a sizing nudge (size up for an oversized fit); made to order + printed in Rockmart, ' +
  'Georgia; care (machine wash cold, inside out). Friendly and concrete. Never invent facts, ' +
  'materials, or shipping promises.'

// Metal art variant — same JSON contract, wall-art copy instead of apparel.
export const METAL_SYSTEM_PROMPT =
  'You write Etsy listing copy for ImagineThisPrinted, a custom print shop selling dye-sublimated ' +
  'ALUMINUM METAL PRINT wall-art panels — vivid high-gloss prints infused into lightweight metal, ' +
  'fade- and scratch-resistant, made to order in Rockmart, Georgia, offered in 4x6 and 8x10 inches. ' +
  'Respond ONLY with JSON: {"title": string, "tags": string[], "description": string}. Rules: ' +
  'TITLE: clear and human-readable, NOT keyword-stuffed. Format: the artwork name, one or two natural ' +
  'descriptors, then "Metal Print" and optionally ONE "|" separator with a short phrase like ' +
  '"Aluminum Wall Art". Aim for 50-90 characters, no comma keyword lists, no emoji, no ALL-CAPS. ' +
  'TAGS (exactly 13): 2-3 word lowercase buyer phrases, each <=20 characters, no duplicates — cover: ' +
  'metal wall art, aluminum print, the artwork subject, room/style phrases (living room decor, office ' +
  'wall art), aesthetic, and gift phrasing. ' +
  'DESCRIPTION: first line is a hook <=155 chars saying what it is and who it is for. Then short ' +
  'scannable sections: the artwork; the panel (glossy aluminum, vivid sublimated print, fade- and ' +
  'scratch-resistant, lightweight); sizes offered (4x6 and 8x10 inches — pick your size at checkout); ' +
  'display (light enough for a shelf, easel, or your preferred wall mounting); made to order in ' +
  'Rockmart, Georgia; care (wipe clean with a soft dry cloth). Never invent facts, mounting hardware ' +
  'claims, or shipping promises.'

// Sanitize whatever the model returned through the same hard limits the
// publisher enforces, backfilling tags from existing keywords if it came up short.
export function sanitizePack(raw: any, product: any): { title: string, tags: string[], description: string } | null {
  const title = String(raw?.title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN)
  const description = String(raw?.description || '').trim()
  if (!title || !description) return null

  const seen = new Set<string>()
  const tags: string[] = []
  const push = (phrase: string) => {
    const tag = toEtsyTag(phrase)
    if (!tag) return
    const key = tag.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    if (tags.length < MAX_TAGS) tags.push(tag)
  }
  if (Array.isArray(raw?.tags)) raw.tags.forEach((t: unknown) => push(String(t)))
  // Model under-delivered? Top up from the website keywords rather than pad with junk.
  if (tags.length < MAX_TAGS) toEtsyTags(product.search_keywords).forEach(push)

  return tags.length ? { title, tags, description } : null
}

// No-model fallback so the flow still works without OPENAI_API_KEY — identical
// to the mechanical mapping the publisher would apply anyway.
function mechanicalPack(product: any): { title: string, tags: string[], description: string } {
  return {
    title: toEtsyTitle(product.meta_title || product.name || '', product.search_keywords),
    tags: toEtsyTags(product.search_keywords),
    description: product.description || product.meta_description || product.name || ''
  }
}

export async function composeEtsyPack(productId: string): Promise<EtsyPack> {
  const { data: product, error } = await supabase
    .from('products')
    .select('id, name, description, category, price, meta_title, meta_description, search_keywords, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const isMetal = String(product.category) === 'metal-art'
  let fields: { title: string, tags: string[], description: string } | null = null
  let usedModel: string | null = null

  for (const tier of MODEL_TIERS) {
    try {
      const completion = await tier.client.chat.completions.create({
        model: tier.model,
        response_format: { type: 'json_object' },
        ...completionTokenParam(tier.model, 900),
        messages: [
          { role: 'system', content: isMetal ? METAL_SYSTEM_PROMPT : SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              name: product.name,
              description: product.description,
              category: product.category,
              existing_keywords: product.search_keywords,
              original_prompt: (product as any).metadata?.original_prompt || (product as any).metadata?.image_prompt || null
            })
          }
        ]
      })
      const rawText = completion.choices[0]?.message?.content
      if (rawText) fields = sanitizePack(JSON.parse(rawText), product)
      if (fields) {
        usedModel = tier.model
        break
      }
      console.error(`[etsy-composer] ${tier.model} returned unusable copy for ${productId}`)
    } catch (err: any) {
      console.error(`[etsy-composer] ${tier.model} call failed for ${productId}:`, err?.message || err)
    }
  }
  if (!fields) {
    console.error(`[etsy-composer] all ${MODEL_TIERS.length} model tier(s) failed for ${productId} — using mechanical copy`)
    fields = mechanicalPack(product)
  }

  const existingColors: string[] | undefined = (product as any).metadata?.etsy_pack?.colors
  const pack: EtsyPack = {
    ...fields,
    // Metal art: base price is the 4x6 anchor; the 8x10 price rides on the
    // Size variation (services/etsy.ts METAL_SIZES). No color axis.
    price: ETSY_ANCHOR_PRICE,
    colors: isMetal ? [] : (existingColors?.length ? existingColors : defaultColorsFor(product)),
    composed_at: new Date().toISOString(),
    // Record what actually produced this copy. Previously this stored the
    // configured model even when the call had failed and mechanicalPack() wrote
    // the fields, so a shelf of mechanical packs looked model-composed.
    model: usedModel || 'mechanical'
  }

  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...((product as any).metadata || {}), etsy_pack: pack } })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to persist etsy_pack: ${updErr.message}`)

  return pack
}

// Persist admin edits to a pack (panel "Save" button). Runs the same limits as
// compose so hand-edited copy can never exceed what Etsy accepts.
export async function saveEtsyPackEdits(
  productId: string,
  edits: { title?: string, tags?: string[], description?: string, price?: number, colors?: string[] }
): Promise<EtsyPack> {
  const { data: product, error } = await supabase
    .from('products')
    .select('id, metadata, search_keywords')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!product) throw new Error(`Product ${productId} not found`)

  const existing = (product as any).metadata?.etsy_pack as EtsyPack | undefined
  if (!existing) throw new Error('No composed pack to edit — compose the listing first')

  const merged = sanitizePack(
    {
      title: edits.title ?? existing.title,
      tags: edits.tags ?? existing.tags,
      description: edits.description ?? existing.description
    },
    product
  )
  if (!merged) throw new Error('Edited pack is invalid — title, description, and at least one tag are required')

  const price = Number(edits.price ?? existing.price)
  const editedColors = Array.isArray(edits.colors)
    ? [...new Set(edits.colors.map(c => titleCaseColor(String(c))).filter(c => c.length >= 3 && c.length <= 30))].slice(0, 4)
    : undefined
  // An explicitly empty list is valid (metal art has no color axis) — only
  // fall back to the stored colors when the field wasn't sent at all.
  const colors = editedColors !== undefined ? editedColors : (existing.colors ?? [])
  const pack: EtsyPack = {
    ...existing,
    ...merged,
    price: Number.isFinite(price) && price >= 0.2 ? price : existing.price,
    colors,
    edited_at: new Date().toISOString()
  }

  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...((product as any).metadata || {}), etsy_pack: pack } })
    .eq('id', productId)
  if (updErr) throw new Error(`Failed to persist etsy_pack edits: ${updErr.message}`)

  return pack
}
