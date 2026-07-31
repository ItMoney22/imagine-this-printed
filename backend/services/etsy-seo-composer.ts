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
// Model: ETSY_SEO_MODEL, default gpt-5.6-terra (gpt-4o is retired — hard
// shutdown 2026-10-23 for the gpt-4 family). This deliberately steps above
// the cost-first cheap-tier rule because bad copy is exactly what killed
// batch 1, volume is one call per opted-in product, and the delta is ~a
// cent a listing.
// ---------------------------------------------------------------------------
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { MAX_TAGS, MAX_TITLE_LEN, toEtsyTag, toEtsyTags, toEtsyTitle } from './etsy-listing-fields.js'
import { METAL_ART_SIZES, METAL_ART_SUBSTRATE, METAL_ART_MOUNTING_COPY, ETSY_SIZE_KEYS } from '../shared/metal-art.js'

const COMPOSER_MODEL = process.env.ETSY_SEO_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reasoning models reject the legacy `max_tokens` param —
// verified live during the sibling design-assistant.ts migration (see
// handoff-joshua-knight-1785113728792.json).
const isReasoningModel = /^(o[1-9]|gpt-5)/.test(COMPOSER_MODEL)
export const ETSY_ANCHOR_PRICE = Number(process.env.ETSY_ANCHOR_PRICE || 25)

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

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

const SYSTEM_PROMPT =
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
//
// Substrate + sizes come from shared/metal-art.ts (single source of truth
// with the storefront studio — see that file's "THE CONFLICT" note: the
// studio canvas is built for 8x11, not 8x10, so if this is the same physical
// panel as the website sells, this prompt's size claim may be wrong). Do not
// hardcode "aluminum" or "4x6 and 8x10" here again — change the shared module
// instead once David confirms the physical panel.
const METAL_SIZE_LIST_TEXT =
  ETSY_SIZE_KEYS.map(k => `${METAL_ART_SIZES[k].widthIn}x${METAL_ART_SIZES[k].heightIn}`).join(' and ') + ' inches'
const METAL_SUBSTRATE_UPPER = METAL_ART_SUBSTRATE.toUpperCase()
const METAL_SUBSTRATE_TITLECASE = METAL_ART_SUBSTRATE.charAt(0).toUpperCase() + METAL_ART_SUBSTRATE.slice(1)

const METAL_SYSTEM_PROMPT =
  'You write Etsy listing copy for ImagineThisPrinted, a custom print shop selling dye-sublimated ' +
  `${METAL_SUBSTRATE_UPPER} METAL PRINT wall-art panels — vivid high-gloss prints infused into lightweight metal, ` +
  `fade- and scratch-resistant, made to order in Rockmart, Georgia, offered in ${METAL_SIZE_LIST_TEXT}. ` +
  'Respond ONLY with JSON: {"title": string, "tags": string[], "description": string}. Rules: ' +
  'TITLE: clear and human-readable, NOT keyword-stuffed. Format: the artwork name, one or two natural ' +
  'descriptors, then "Metal Print" and optionally ONE "|" separator with a short phrase like ' +
  `"${METAL_SUBSTRATE_TITLECASE} Wall Art". Aim for 50-90 characters, no comma keyword lists, no emoji, no ALL-CAPS. ` +
  'TAGS (exactly 13): 2-3 word lowercase buyer phrases, each <=20 characters, no duplicates — cover: ' +
  `metal wall art, ${METAL_ART_SUBSTRATE} print, the artwork subject, room/style phrases (living room decor, office ` +
  'wall art), aesthetic, and gift phrasing. ' +
  'DESCRIPTION: first line is a hook <=155 chars saying what it is and who it is for. Then short ' +
  `scannable sections: the artwork; the panel (glossy ${METAL_ART_SUBSTRATE}, vivid sublimated print, fade- and ` +
  `scratch-resistant, lightweight); sizes offered (${METAL_SIZE_LIST_TEXT} — pick your size at checkout); ` +
  `display (${METAL_ART_MOUNTING_COPY} — also light enough for a shelf or easel); made to order in ` +
  'Rockmart, Georgia; care (wipe clean with a soft dry cloth). Never invent facts beyond these, and no ' +
  'shipping promises.'

// Sanitize whatever the model returned through the same hard limits the
// publisher enforces, backfilling tags from existing keywords if it came up short.
function sanitizePack(raw: any, product: any): { title: string, tags: string[], description: string } | null {
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
  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: COMPOSER_MODEL,
        response_format: { type: 'json_object' },
        ...(isReasoningModel ? { max_completion_tokens: 900 } : { max_tokens: 900 }),
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
    } catch (err: any) {
      console.error(`[etsy-composer] model call failed for ${productId} (falling back to mechanical):`, err?.message || err)
    }
  }
  if (!fields) fields = mechanicalPack(product)

  const existingColors: string[] | undefined = (product as any).metadata?.etsy_pack?.colors
  const pack: EtsyPack = {
    ...fields,
    // Metal art: base price is the 4x6 anchor; the 8x10 price rides on the
    // Size variation (services/etsy.ts METAL_SIZES). No color axis.
    price: ETSY_ANCHOR_PRICE,
    colors: isMetal ? [] : (existingColors?.length ? existingColors : defaultColorsFor(product)),
    composed_at: new Date().toISOString(),
    model: openai ? COMPOSER_MODEL : 'mechanical'
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
