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
// Pricing is not the model's job: every pack carries an anchor price by garment
// — $25 for tees (ETSY_ANCHOR_PRICE), $40 for hoodies
// (ETSY_HOODIE_ANCHOR_PRICE). What shoppers actually pay comes off a 40% shop
// sale David runs in Shop Manager (Etsy has no API for sales events), so a tee
// listing shows ~~$25~~ $15 and a hoodie ~~$40~~ $24.
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
import { COLORS, type ColorId } from '../shared/catalog-capability.js'
import { resolvedKindOf, toKindStamp, type ProductKind } from '../shared/product-kind.js'
import { resolveProductKind } from './product-kind-jev.js'

// OpenRouter-first since 2026-08-20 (David's cost pass): copy is a text job
// Gemini Flash handles for ~nothing, and it rides a SEPARATE wallet — the
// first Mrs. Imagine batch saw OpenAI credits hit zero mid-run, which on this
// client would silently degrade every pack to the mechanical fallback.
// ETSY_SEO_MODEL still overrides on either client (use an OpenRouter slug,
// e.g. "google/gemini-2.5-flash", when OPENROUTER_API_KEY is set).
const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY
// Exported so the repair pass (services/etsy-copy-repair.ts) runs on the SAME
// model and wallet rather than growing a second config that drifts from this one.
export const COMPOSER_MODEL = process.env.ETSY_SEO_MODEL || (USE_OPENROUTER ? 'google/gemini-2.5-flash' : 'gpt-5.6-terra')
// gpt-5.x/o-series reasoning models reject the legacy `max_tokens` param —
// verified live during the sibling design-assistant.ts migration (see
// handoff-joshua-knight-1785113728792.json).
const isReasoningModel = /^(o[1-9]|gpt-5)/.test(COMPOSER_MODEL)
export const ETSY_ANCHOR_PRICE = Number(process.env.ETSY_ANCHOR_PRICE || 25)
/**
 * A hoodie is not a tee and must not be listed like one. David set the anchors
 * on 2026-09-07: "shirts are 25, hoodies 40" (this opened at $35 on 09-03).
 * Both sit inside `PRICE_BANDS` in presentation-qa.ts ($28-$95 for hoodies), so
 * this is a pricing call, not a gate fix.
 *
 * This matters because the publisher prefers the PACK's price over the
 * product's: services/etsy.ts resolves `pack?.price ?? product.price`, so a
 * flat anchor here silently overrides a $35 hoodie and lists it at the tee
 * price. Checked across the catalogue when this was found: 57 of 60 composed
 * packs carried $25 regardless of what the product actually sells for. None
 * were live yet, so nothing was mispriced ON Etsy — the next post would have
 * been.
 */
export const ETSY_HOODIE_ANCHOR_PRICE = Number(process.env.ETSY_HOODIE_ANCHOR_PRICE || 40)

/**
 * Is this product a hoodie/sweatshirt, whichever way it was created? One
 * answer with the rest of the pipeline (shared/product-kind.ts): the admin's
 * pick, else the kind stamped by the last compose/repair, else the floor —
 * category hoodies, a hoodie garment, or a word-bounded "hoodie"/"sweatshirt"
 * in the name (a TEE whose design mentions a hooded figure is still a tee, and
 * must not silently pick up the hoodie anchor).
 */
export function isHoodieProduct(product: { category?: unknown; name?: unknown; metadata?: any }): boolean {
  return resolvedKindOf(product) === 'hoodie'
}

/**
 * The Etsy anchor for a product. Deliberately an ANCHOR and not the storefront
 * price: David runs a standing 40% shop sale in Shop Manager (Etsy has no API
 * for sale events), so the listing reads ~~$25~~ $15. Metal art keeps the base
 * anchor on purpose — its size variations carry the real ladder, and its
 * storefront 4x6 price is far below what the Etsy listing should open at.
 */
export function etsyAnchorPriceFor(
  product: { category?: unknown; name?: unknown; metadata?: any },
  kind: ProductKind | null = resolvedKindOf(product)
): number {
  if (String(product.category ?? '') === 'metal-art' || kind === 'metal') return ETSY_ANCHOR_PRICE
  return kind === 'hoodie' ? ETSY_HOODIE_ANCHOR_PRICE : ETSY_ANCHOR_PRICE
}

const openai = USE_OPENROUTER
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://imaginethisprinted.com', 'X-Title': 'ITP Etsy Composer' },
    })
  : process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

/** The configured client, or null when neither wallet has a key. Same
 *  instance the composer itself uses. */
export const composerClient = (): OpenAI | null => openai

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

/** A Step Flow `ColorId` (e.g. 'heather-grey') to its Etsy-facing display
 *  label ('Heather Grey') — falls back to title-casing the raw id itself so
 *  an unrecognized value still reads as a color instead of vanishing. */
const colorIdToLabel = (id: string): string => titleCaseColor(COLORS[id as ColorId]?.label ?? id)

export function defaultColorsFor(product: any): string[] {
  // Step Flow is the source of truth for what a listing actually sells in —
  // `colors.primary` plus every approved `colors.extras` — so a product built
  // through the flow lists every color it offers, not just a guessed pair.
  // Older/non-Step-Flow products (or a Step Flow draft with no colors set
  // yet) fall back to the single shirt_color metadata field plus the old
  // default second color, exactly as before.
  const stepFlowColors = product?.metadata?.step_flow?.colors
  if (stepFlowColors?.primary) {
    const extras: string[] = Array.isArray(stepFlowColors.extras) ? stepFlowColors.extras : []
    const all = [stepFlowColors.primary, ...extras].map((id: string) => colorIdToLabel(String(id)))
    return [...new Set(all)]
  }

  const own = titleCaseColor(String(
    product?.metadata?.shirt_color || product?.metadata?.dtf_settings?.shirt_color || 'Black'
  ))
  return [...new Set([own, DEFAULT_SECOND_COLOR])]
}

// What the listing is selling, per kind — the only facts the non-metal prompt
// may state. Before task 28ab467c there was ONE garment prompt and it said
// "soft unisex tees" for everything that was not metal-art, so every hoodie,
// DTF transfer and 3D figurine got tee copy (the 2026-10-12 dry run counted 34).
interface KindCopyFacts {
  selling: string
  example: string
  item: string
  sizing: string | null
  care: string
}

const KIND_COPY: Record<Exclude<ProductKind, 'metal'>, KindCopyFacts> = {
  tee: {
    selling: 'soft unisex tees with DTF-printed designs',
    example: 'Simply Be You Retro Varsity T-Shirt | Unisex Graphic Tee',
    item: 'the shirt (soft unisex tee, vibrant DTF print)',
    sizing: 'a sizing nudge (size up for an oversized fit)',
    care: 'care (machine wash cold, inside out)',
  },
  hoodie: {
    selling: 'soft unisex hoodies with DTF-printed designs',
    example: 'Simply Be You Retro Varsity Hoodie | Unisex Graphic Sweatshirt',
    item: 'the hoodie (soft unisex hoodie, vibrant DTF print)',
    sizing: 'a sizing nudge (size up for an oversized fit)',
    care: 'care (machine wash cold, inside out)',
  },
  youth_tee: {
    selling: 'soft youth tees for kids with DTF-printed designs',
    example: 'Simply Be You Retro Varsity Kids T-Shirt | Youth Graphic Tee',
    item: "the shirt (soft youth tee cut in kids' sizes, vibrant DTF print)",
    sizing: 'a sizing nudge (check the youth size chart)',
    care: 'care (machine wash cold, inside out)',
  },
  transfer: {
    selling: 'ready-to-press DTF heat transfers (the printed film only, no garment included)',
    example: 'Simply Be You Retro Varsity DTF Transfer | Ready to Press Heat Transfer',
    item: 'the transfer (full-color DTF film for cotton, polyester or blends; the garment is NOT included)',
    sizing: 'how to press (heat press at 300-320F for 10-15 seconds with medium pressure)',
    care: 'storage (keep flat and out of direct sunlight until pressed)',
  },
  '3d': {
    selling: 'made-to-order 3D printed collectible figures',
    example: 'Simply Be You Retro Varsity Figure | 3D Printed Collectible',
    item: 'the piece (3D printed to order, a collectible for a desk or a shelf)',
    sizing: null,
    care: 'care (dust with a soft dry cloth)',
  },
  tumbler: {
    selling: 'drinkware printed with original designs',
    example: 'Simply Be You Retro Varsity Tumbler | Made to Order Drinkware',
    item: 'the tumbler (state only what the given name and description say about it)',
    sizing: null,
    care: 'care (only what the given description says; otherwise leave care out)',
  },
  other: {
    selling: 'original designs on made-to-order products',
    example: 'Simply Be You Retro Varsity Design | Made to Order Gift',
    item: 'the item (state only what the given name and description say it is, and never call it a shirt unless they do)',
    sizing: null,
    care: 'care (only what the given description says; otherwise leave care out)',
  },
}

/** The non-metal system prompt for a kind. The tee prompt is byte-for-byte the
 *  one every listing before 2026-10-12 was written with. */
export function composerPromptFor(kind: Exclude<ProductKind, 'metal'>): string {
  const f = KIND_COPY[kind]
  return (
    `You write Etsy listing copy for ImagineThisPrinted, a custom print shop selling ${f.selling}, ` +
    'made to order in Rockmart, Georgia. Respond ONLY with JSON: ' +
    '{"title": string, "tags": string[], "description": string}. Rules: ' +
    'TITLE: clear and human-readable — Etsy\'s current quality guidance explicitly penalizes keyword-stuffed, ' +
    'comma-stacked titles (their own listing feedback rewrites them). Format: the design name, one or two ' +
    'natural style descriptors, the product type, then optionally ONE "|" separator and a short audience/fit ' +
    `phrase. Example shape: "${f.example}". Aim for 50-90 ` +
    'characters. No comma-separated keyword lists, no repeated synonyms, no emoji, no ALL-CAPS words, no ' +
    'quotes. Every search phrase you would have stacked in the title belongs in the tags instead. ' +
    'TAGS (exactly 13): 2-3 word lowercase buyer phrases, each <=20 characters, no duplicates or ' +
    'near-duplicates, no bare generic words like "shirt". Spread across: style/aesthetic, audience, ' +
    'occasion/season, gift phrasing, and the design subject. ' +
    'DESCRIPTION: first line is a hook <=155 chars saying what it is and who it is for (that is the ' +
    `mobile preview). Then short scannable sections: the design; ${f.item}; ` +
    (f.sizing ? `${f.sizing}; ` : '') +
    `made to order + printed in Rockmart, Georgia; ${f.care}. Friendly and concrete. Never invent facts, ` +
    'materials, or shipping promises.'
  )
}

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

  // What is being sold decides the prompt, the anchor and the colour axis —
  // the admin's pick, else Jev (when on and sure), else the floor. A product
  // nothing identifies is not composed as a tee: it waits for its category.
  const kindDecision = await resolveProductKind(product)
  if (!kindDecision.kind) throw new Error(kindDecision.note)
  const kind = kindDecision.kind
  const isGarment = kind === 'tee' || kind === 'hoodie' || kind === 'youth_tee'
  let fields: { title: string, tags: string[], description: string } | null = null
  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: COMPOSER_MODEL,
        response_format: { type: 'json_object' },
        ...(isReasoningModel ? { max_completion_tokens: 900 } : { max_tokens: 900 }),
        messages: [
          { role: 'system', content: kind === 'metal' ? METAL_SYSTEM_PROMPT : composerPromptFor(kind) },
          {
            role: 'user',
            content: JSON.stringify({
              name: product.name,
              description: product.description,
              category: product.category,
              product_kind: kind,
              existing_keywords: product.search_keywords,
              original_prompt: (product as any).metadata?.original_prompt || (product as any).metadata?.image_prompt || null
            })
          }
        ]
      })
      const rawText = completion.choices[0]?.message?.content
      // Gemini via OpenRouter sometimes fences JSON despite response_format.
      const unfenced = rawText?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
      if (unfenced) fields = sanitizePack(JSON.parse(unfenced), product)
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
    // Garments anchor by what they are — a hoodie at the tee price is margin
    // handed away on every sale.
    price: etsyAnchorPriceFor(product as any, kind),
    // Only a garment has a shirt colour to pick; a panel, transfer or figure does not.
    colors: !isGarment ? [] : (existingColors?.length ? existingColors : defaultColorsFor(product)),
    composed_at: new Date().toISOString(),
    model: openai ? COMPOSER_MODEL : 'mechanical'
  }

  const { error: updErr } = await supabase
    .from('products')
    .update({ metadata: { ...((product as any).metadata || {}), etsy_pack: pack, product_kind: toKindStamp(kindDecision, product) } })
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
