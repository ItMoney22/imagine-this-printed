// Mrs. Imagine — the house's autonomous designer (David 2026-08-20: "create a
// misses imagine… she needs to go on etsy and look for realtime data to find
// the right designs to make, then she must complete all steps: after she
// designs she must approve her work by looking at it, the mockups and all,
// then she walks the design right into the etsy drafts").
//
// This is scripts/design-e2e.ts productionized — every stage is the same real
// service the storefront uses, wired end-to-end with research in front and
// Etsy queueing behind:
//
//   RESEARCH   etsy-market-research (realtime public marketplace data)
//   BRIEF      MRS_IMAGINE_BRAIN_MODEL turns signals into buyer-named briefs
//   GENERATE   gpt-image-2, OpenAI-direct, quality high
//   COPY       listing copy written to the QA gate's own thresholds
//   PRODUCT    draft row + source asset
//   REMBG      851-labs transparency pass (garments; gpt-image-2 has no alpha)
//   MOCKUPS    replicate_mockup_v2 jobs — the WORKER renders them
//   QA         submitForQa('storefront') — the vision agent IS her look at the
//              work; a blocking verdict buys exactly one corrective regen
//   ETSY       composeEtsyPack + copyright gate + model shots + QA('etsy')
//   PUBLISH    storefront activate + etsy_listings state='queued' → the
//              etsy-jobs-worker walks each tier into a DRAFT listing
//   TIKTOK     social_outbox draft (review-gated rail)
//
// David's only remaining act per design: hit ACTIVE in Etsy Shop Manager.
//
// Batch state lives on an ai_jobs row (type 'mrs_imagine_batch') — no new
// tables, no prod DDL. The batch runs inline on the API process
// (fire-and-forget, same pattern as processImageJobInline); a deploy mid-batch
// kills the loop but every completed design is already durable in products.

import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { runOpenAIImage } from './image-flow/providers/openai-image.js'
import { submitForQa, checkGate } from './design-qa-gate.js'
import { composeEtsyPack } from './etsy-seo-composer.js'
import { runCopyrightGate } from './etsy-copyright-gate.js'
import { startModelShots } from './etsy-model-shots.js'
import { tiersForCategory } from '../shared/etsy-tiers.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import {
  GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES,
  MR_IMAGINE_SUPPORTED_PRODUCT_TYPES,
} from './replicate.js'
import {
  researchCategory,
  isEtsyResearchConfigured,
  type MarketSignal,
  type ResearchCategory,
} from './etsy-market-research.js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const BRAIN_MODEL = process.env.MRS_IMAGINE_BRAIN_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
const GARMENT_COUNT = () => Math.min(20, Math.max(1, Number(process.env.MRS_IMAGINE_GARMENT_COUNT) || 10))
const METAL_COUNT = () => Math.min(10, Math.max(0, Number(process.env.MRS_IMAGINE_METAL_COUNT) || 5))
const AUTO_ACTIVATE = () => process.env.MRS_IMAGINE_AUTO_ACTIVATE !== 'false'
const AUTO_QUEUE_ETSY = () => process.env.MRS_IMAGINE_AUTO_QUEUE_ETSY !== 'false'
const WANT_MODEL_SHOTS = () => process.env.MRS_IMAGINE_MODEL_SHOTS !== 'false'
const MOCKUP_TIMEOUT_MS = Number(process.env.MRS_IMAGINE_MOCKUP_TIMEOUT_MS || 12 * 60 * 1000)
const REMBG_TIMEOUT_MS = Number(process.env.MRS_IMAGINE_REMBG_TIMEOUT_MS || 4 * 60 * 1000)
const SHOTS_TIMEOUT_MS = Number(process.env.MRS_IMAGINE_SHOTS_TIMEOUT_MS || 10 * 60 * 1000)
const DESIGN_CONCURRENCY = Math.min(4, Math.max(1, Number(process.env.MRS_IMAGINE_CONCURRENCY) || 3))

export type GarmentType = 'tshirt' | 'hoodie' | 'polo'

export interface DesignBrief {
  key: string
  kind: 'garment' | 'metal'
  garment?: GarmentType
  buyer: string
  prompt: string
  priceUsd: number
  trendBasis: string
}

export interface DesignOutcome {
  key: string
  kind: 'garment' | 'metal'
  productId?: string
  slug?: string
  status: 'live' | 'draft_rework' | 'error'
  detail?: string
  storefrontScore?: number
  etsyScore?: number
  etsyQueued?: string[]
  tiktokOutboxId?: string
  attempts: number
}

// --- Brief generation --------------------------------------------------------

const GARMENT_BRIEF_RULES =
  'Each garment brief MUST describe a CONTAINED SUBJECT — an emblem, badge, or ' +
  'isolated character with dead air around it — NEVER a full-bleed scene or a ' +
  'background panel. (Full-bleed garment art prints as a colored rectangle on ' +
  'the shirt: the cheap-POD look. This rule was learned the expensive way.) ' +
  'The artwork must contain NO lettering unless the concept is a typography ' +
  'design, in which case wrap the exact wording in double quotes. NEVER use ' +
  'any third-party brand, franchise, team, or celebrity name.'

const METAL_BRIEF_RULES =
  'Metal-print briefs are full-bleed wall art: complete scenes with edge-to-edge ' +
  'composition ARE correct here (the panel is the canvas). Aim for pieces that ' +
  'read from across a room. NO third-party brands or franchises.'

/** Turn realtime market signals into buyer-named design briefs. */
export async function writeBriefs(
  signals: MarketSignal[],
  counts: { garments: number; metal: number }
): Promise<DesignBrief[]> {
  const res = await openai.chat.completions.create({
    model: BRAIN_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are Mrs. Imagine, the design director of a US print-on-demand shop. You are handed ' +
          'REALTIME Etsy marketplace data (top tags, title phrases, price bands, and the hottest ' +
          'listings by favorites-per-day). Your job: pick the niches that are moving RIGHT NOW and ' +
          `write design briefs a buyer would stop scrolling for. ${GARMENT_BRIEF_RULES} ${METAL_BRIEF_RULES} ` +
          'Reply with JSON only: {"garments": [{"key": string(kebab-case), "garment": "tshirt"|"hoodie"|"polo", ' +
          '"buyer": string (who buys this, specific), "prompt": string (60-120 words of concrete visual ' +
          'description: subject, composition, palette, art style, print texture), "priceUsd": number, ' +
          '"trendBasis": string (one sentence citing the data that justifies this brief)}], ' +
          '"metal": [same shape without "garment"]}. ' +
          'Every brief targets a DIFFERENT niche — no two briefs may share a buyer. Spread the garment ' +
          'mix across tshirt, hoodie, and polo with at least one hoodie and one polo. Price within the ' +
          'researched band for that category.',
      },
      {
        role: 'user',
        content:
          `Market data (fetched ${signals[0]?.fetchedAt ?? 'now'}):\n` +
          JSON.stringify(signals, null, 1) +
          `\n\nWrite exactly ${counts.garments} garment briefs and ${counts.metal} metal-print briefs.`,
      },
    ],
    response_format: { type: 'json_object' },
  })
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
  const garments: DesignBrief[] = (Array.isArray(parsed.garments) ? parsed.garments : [])
    .slice(0, counts.garments)
    .map((b: any, i: number) => ({
      key: slugify(String(b.key || `garment-${i + 1}`)).slice(0, 40),
      kind: 'garment' as const,
      garment: (['tshirt', 'hoodie', 'polo'] as const).includes(b.garment) ? b.garment : 'tshirt',
      buyer: String(b.buyer || 'shoppers'),
      prompt: String(b.prompt || ''),
      priceUsd: clampPrice(Number(b.priceUsd), b.garment === 'hoodie' ? [34.99, 49.99] : [19.99, 34.99]),
      trendBasis: String(b.trendBasis || ''),
    }))
  const metal: DesignBrief[] = (Array.isArray(parsed.metal) ? parsed.metal : [])
    .slice(0, counts.metal)
    .map((b: any, i: number) => ({
      key: slugify(String(b.key || `metal-${i + 1}`)).slice(0, 40),
      kind: 'metal' as const,
      buyer: String(b.buyer || 'shoppers'),
      prompt: String(b.prompt || ''),
      priceUsd: clampPrice(Number(b.priceUsd), [25, 65]),
      trendBasis: String(b.trendBasis || ''),
    }))
  const all = [...garments, ...metal].filter((b) => b.prompt.length > 40)
  if (!all.length) throw new Error('Mrs. Imagine brain returned no usable briefs')
  return all
}

function clampPrice(n: number, [lo, hi]: [number, number]): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.round(n * 100) / 100))
}

// --- Stage helpers (mirrors of scripts/design-e2e.ts, service-shaped) --------

function dtfPrompt(brief: DesignBrief): string {
  return (
    `${brief.prompt}\n\n` +
    'Render as a standalone screen-print graphic on a fully transparent background, ' +
    'centred with even margins, high contrast, crisp edges suitable for DTF transfer ' +
    'printing at 300 DPI on a black garment. The artwork fills the frame edge to edge.'
  )
}

function metalPrompt(brief: DesignBrief): string {
  return (
    `${brief.prompt}\n\n` +
    'Render as premium metal wall-art: full-bleed edge-to-edge composition, rich ' +
    'saturated color, high dynamic range, crisp detail that holds up printed on an ' +
    'aluminum panel. Portrait orientation.'
  )
}

const GARMENT_NOUN: Record<GarmentType, string> = { tshirt: 't-shirt', hoodie: 'hoodie', polo: 'polo shirt' }

async function writeCopy(brief: DesignBrief): Promise<{ title: string; description: string; tags: string[] }> {
  const productNoun = brief.kind === 'metal' ? 'metal wall-art print' : GARMENT_NOUN[brief.garment ?? 'tshirt']
  const res = await openai.chat.completions.create({
    model: BRAIN_MODEL,
    messages: [
      {
        role: 'system',
        content:
          `You write product listings for a US print-on-demand shop. This listing sells a ${productNoun}. ` +
          'You write for a specific buyer, never in generic marketplace filler. Reply with JSON only: ' +
          '{"title": string, "description": string, "tags": string[]}. ' +
          'HARD RULES: title is 35-68 characters, plain readable English, no emoji, no commas stacked ' +
          'as keywords, and it does NOT contain any third-party brand or franchise name. description ' +
          'is AT LEAST 340 characters and at most 900. It MUST open with a single short sentence under ' +
          '140 characters that ends in a period and stands alone as the mobile search preview, then a ' +
          'blank line, then the rest. tags is exactly 13 lowercase tags, each under 20 characters, and ' +
          'at least four of them must also appear as words in the title or description.',
      },
      {
        role: 'user',
        content: `The design: ${brief.prompt}\n\nThe buyer: ${brief.buyer}\n\nTrend basis: ${brief.trendBasis}\n\nWrite the listing.`,
      },
    ],
    response_format: { type: 'json_object' },
  })
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
  const tags: string[] = Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t)) : []
  return {
    title: String(parsed.title ?? '').trim(),
    description: String(parsed.description ?? '').trim(),
    tags: tags.filter(Boolean).slice(0, 13),
  }
}

interface ProductRefs {
  productId: string
  slug: string
  sourceAssetId: string
}

async function createProduct(
  brief: DesignBrief,
  copy: { title: string; description: string; tags: string[] },
  designUrl: string,
  objectPath: string,
  batchId: string
): Promise<ProductRefs> {
  const baseSlug = slugify(copy.title.slice(0, 60))
  const { data: existing } = await supabase.from('products').select('slug').like('slug', `${baseSlug}%`)
  const slug = generateUniqueSlug(baseSlug, (existing ?? []).map((p: any) => p.slug).filter(Boolean))

  const isMetal = brief.kind === 'metal'
  const garment = brief.garment ?? 'tshirt'
  // Polos file under 'shirts' (no polo category exists); shirts requires >=1
  // print location by CHECK constraint. Tees use 't-shirts', hoodies 'hoodies'.
  const category = isMetal ? 'metal-art' : garment === 'tshirt' ? 't-shirts' : garment === 'polo' ? 'shirts' : 'hoodies'

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name: copy.title,
      slug,
      description: copy.description,
      price: brief.priceUsd,
      status: 'draft',
      is_active: false,
      images: [designUrl],
      category,
      ...(category === 'shirts' ? { print_locations: ['front_image'] } : {}),
      search_keywords: copy.tags.join(', '),
      metadata: {
        ai_generated: true,
        mrs_imagine: true,
        mrs_imagine_batch: batchId,
        brief_key: brief.key,
        target_buyer: brief.buyer,
        trend_basis: brief.trendBasis,
        original_prompt: brief.prompt,
        model_id: 'openai/gpt-image-2',
        product_type: isMetal ? 'metal-art' : garment,
        ...(isMetal ? { metal_size: '8x10' } : { shirt_color: 'black', print_placement: 'front-center', print_size_inches: 11 }),
      },
    })
    .select('id, slug')
    .single()
  if (error) throw new Error(`product insert failed: ${error.message}`)

  const { data: asset, error: assetErr } = await supabase
    .from('product_assets')
    .insert({
      product_id: product.id,
      // MUST be 'source': the worker's mockup resolution walks
      // selected > dtf > nobg > source and its precheck looks for kind='source'.
      kind: 'source',
      path: objectPath,
      url: designUrl,
      is_primary: true,
      display_order: 0,
      metadata: { model_id: 'openai/gpt-image-2', provider: 'openai', mrs_imagine: true },
    })
    .select('id')
    .single()
  if (assetErr) throw new Error(`design asset insert failed: ${assetErr.message}`)

  return { productId: product.id, slug: product.slug, sourceAssetId: asset.id as string }
}

/** Queue the rembg stage and wait for the nobg asset (garments only). */
async function removeBackground(productId: string, sourceAssetId: string): Promise<{ url: string; assetId: string } | null> {
  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({ product_id: productId, type: 'replicate_rembg', status: 'queued', input: { selected_asset_id: sourceAssetId } })
    .select('id')
    .single()
  if (error) return null

  const deadline = Date.now() + REMBG_TIMEOUT_MS
  for (;;) {
    const { data: asset } = await supabase
      .from('product_assets')
      .select('id, url')
      .eq('product_id', productId)
      .eq('kind', 'nobg')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (asset?.url) return { url: asset.url as string, assetId: asset.id as string }

    const { data: row } = await supabase.from('ai_jobs').select('status').eq('id', job.id).maybeSingle()
    if (row?.status === 'failed' || Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 4000))
  }
}

async function enqueueMockups(brief: DesignBrief, productId: string, designAssetId: string): Promise<number> {
  const jobs: any[] = []
  if (brief.kind === 'metal') {
    for (const template of ['metal_shelf', 'metal_wall']) {
      jobs.push({
        product_id: productId,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: { product_type: 'metal-art', template, metalSize: '8x10', selected_asset_id: designAssetId },
      })
    }
  } else {
    const garment = brief.garment ?? 'tshirt'
    const baseInput = {
      product_type: garment === 'tshirt' ? 'shirts' : garment === 'polo' ? 'shirts' : 'hoodies',
      productType: garment,
      shirtColor: 'black',
      printPlacement: 'front-center',
      printSizeInches: 11,
      selected_asset_id: designAssetId,
    }
    jobs.push({ product_id: productId, type: 'replicate_mockup_v2', status: 'queued', input: { ...baseInput, template: 'flat_lay' } })
    if (GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(garment)) {
      jobs.push({ product_id: productId, type: 'replicate_mockup_v2', status: 'queued', input: { ...baseInput, template: 'ghost_mannequin' } })
    }
    if (MR_IMAGINE_SUPPORTED_PRODUCT_TYPES.includes(garment)) {
      jobs.push({ product_id: productId, type: 'replicate_mockup_v2', status: 'queued', input: { ...baseInput, template: 'mr_imagine' } })
    }
    jobs.push({ product_id: productId, type: 'replicate_mockup_v2', status: 'queued', input: { ...baseInput, template: 'flat_lay', printPlacement: 'left-pocket' } })
  }
  const { error } = await supabase.from('ai_jobs').insert(jobs)
  if (error) throw new Error(`mockup enqueue failed: ${error.message}`)
  return jobs.length
}

async function waitForMockups(productId: string): Promise<string[]> {
  const deadline = Date.now() + MOCKUP_TIMEOUT_MS
  for (;;) {
    const { data: assets } = await supabase
      .from('product_assets')
      .select('url')
      .eq('product_id', productId)
      .eq('kind', 'mockup')
      .order('display_order', { ascending: true })
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('status')
      .eq('product_id', productId)
      .eq('type', 'replicate_mockup_v2')
    const urls = (assets ?? []).map((a: any) => a.url).filter((u: any): u is string => typeof u === 'string')
    const settled = (jobs ?? []).filter((j: any) => j.status === 'succeeded' || j.status === 'failed').length
    if (jobs?.length && settled >= jobs.length) return urls
    if (Date.now() > deadline) return urls
    await new Promise((r) => setTimeout(r, 5000))
  }
}

async function syncGallery(productId: string, designUrl: string, mockupUrls: string[]): Promise<void> {
  // images[0] must stay the artwork; the QA gate reads it this way.
  const { error } = await supabase.from('products').update({ images: [designUrl, ...mockupUrls] }).eq('id', productId)
  if (error) throw new Error(`gallery sync failed: ${error.message}`)
}

async function waitForModelShots(productId: string): Promise<'ready' | 'error' | 'timeout'> {
  const deadline = Date.now() + SHOTS_TIMEOUT_MS
  for (;;) {
    const { data } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
    const status = (data as any)?.metadata?.etsy_shots?.status
    if (status === 'ready') return 'ready'
    if (status === 'error') return 'error'
    if (Date.now() > deadline) return 'timeout'
    await new Promise((r) => setTimeout(r, 6000))
  }
}

/** Mirror of the admin queue route's upsert (routes/admin/etsy.ts) — gate-checked. */
async function queueEtsyTiers(productId: string, category: string): Promise<string[]> {
  const qa = await checkGate(productId, 'etsy')
  if (!qa.allowed) return []
  const tiers = tiersForCategory(category)
  const { data: existingRows } = await supabase.from('etsy_listings').select('tier, listing_id, state').eq('product_id', productId)
  const byTier = new Map((existingRows ?? []).map((r: any) => [r.tier, r]))
  const queued: string[] = []
  for (const tier of tiers) {
    const existing = byTier.get(tier)
    if (existing?.listing_id && existing.state !== 'error' && existing.state !== 'removed') continue
    const { error } = await supabase.from('etsy_listings').upsert(
      { product_id: productId, tier, state: 'queued', last_error: null, updated_at: new Date().toISOString() },
      { onConflict: 'product_id,tier' }
    )
    if (!error) queued.push(tier)
  }
  return queued
}

async function stageTikTok(
  productId: string,
  copy: { title: string; description: string; tags: string[] },
  mockupUrls: string[],
  brief: DesignBrief
): Promise<string | null> {
  const hook = copy.description.split(/(?<=[.!?])\s/)[0] ?? copy.title
  const { data, error } = await supabase
    .from('social_outbox')
    .insert({
      product_id: productId,
      platform: 'tiktok',
      kind: 'post',
      caption: `${hook}\n\nMade for ${brief.buyer.split(' who ')[0]}.`,
      hashtags: copy.tags.slice(0, 8).map((t) => `#${t.replace(/[^a-z0-9]/gi, '')}`),
      media_urls: mockupUrls.slice(0, 4),
      status: 'draft',
    })
    .select('id')
    .single()
  if (error) return null
  return data.id as string
}

// --- One design, all the way through -----------------------------------------

async function buildOneDesign(brief: DesignBrief, batchId: string, note: (m: string) => Promise<void>): Promise<DesignOutcome> {
  const outcome: DesignOutcome = { key: brief.key, kind: brief.kind, status: 'error', attempts: 0 }
  const isMetal = brief.kind === 'metal'

  const copy = await writeCopy(brief)
  let refs: ProductRefs | null = null
  let reworkNote = ''

  for (let attempt = 1; attempt <= 2; attempt++) {
    outcome.attempts = attempt
    const genPrompt = (isMetal ? metalPrompt(brief) : dtfPrompt(brief)) + (reworkNote ? `\n\nThe previous attempt was rejected by review for: ${reworkNote}. Correct exactly these issues.` : '')
    const objectPath = `ai-products/mrs-imagine/${batchId}/${brief.key}-a${attempt}-${Date.now()}.png`
    await note(`${brief.key}: generating (gpt-image-2, take ${attempt})`)
    const { url: designUrl } = await runOpenAIImage({
      prompt: genPrompt,
      objectPath,
      quality: (process.env.HOUSE_GPT_IMAGE_QUALITY as any) || 'high',
      size: isMetal ? '1024x1536' : '1024x1024',
      // background:'transparent' is rejected by gpt-image-2 outright; the rembg
      // stage below is what guarantees garment transparency.
      background: 'auto',
      // Standard filter false-positives on benign stylized design work.
      moderation: 'low',
    })

    if (!refs) {
      refs = await createProduct(brief, copy, designUrl, objectPath, batchId)
      outcome.productId = refs.productId
      outcome.slug = refs.slug
    } else {
      // Retry: register the corrected render as the new primary source asset.
      const { data: asset } = await supabase
        .from('product_assets')
        .insert({ product_id: refs.productId, kind: 'source', path: objectPath, url: designUrl, is_primary: true, display_order: 0, metadata: { model_id: 'openai/gpt-image-2', provider: 'openai', mrs_imagine: true, retry: true } })
        .select('id')
        .single()
      if (asset?.id) refs.sourceAssetId = asset.id as string
      // Clear settled mockup jobs so the new fan-out isn't counted against old ones.
      await supabase.from('ai_jobs').delete().eq('product_id', refs.productId).eq('type', 'replicate_mockup_v2')
    }

    let printUrl = designUrl
    let printAssetId = refs.sourceAssetId
    if (!isMetal) {
      await note(`${brief.key}: rembg transparency pass`)
      const nobg = await removeBackground(refs.productId, refs.sourceAssetId)
      if (nobg) {
        printUrl = nobg.url
        printAssetId = nobg.assetId
      }
    }

    await note(`${brief.key}: mockups rendering on the worker`)
    await enqueueMockups(brief, refs.productId, printAssetId)
    const mockupUrls = await waitForMockups(refs.productId)
    await syncGallery(refs.productId, printUrl, mockupUrls)

    await note(`${brief.key}: Mrs. Imagine reviews her work (storefront QA)`)
    const store = await submitForQa({ productId: refs.productId, channel: 'storefront', submittedBy: 'mrs-imagine' })
    outcome.storefrontScore = store.verdict.score
    if (store.verdict.status === 'passed') break

    reworkNote = store.verdict.rework
      .filter((r: any) => r.severity === 'block')
      .map((r: any) => `${r.criterion}: ${r.issue}`)
      .join('; ')
      .slice(0, 500)
    if (attempt === 2) {
      outcome.status = 'draft_rework'
      outcome.detail = `storefront QA blocked twice: ${reworkNote}`
      await note(`${brief.key}: left as draft for rework — ${reworkNote.slice(0, 120)}`)
      return outcome
    }
    await note(`${brief.key}: QA blocked (${store.verdict.score}/100) — corrective regeneration`)
  }

  if (!refs) throw new Error('no product created')

  // Etsy leg: copyright gate → pack → model shots → etsy QA → queue tiers.
  const gate = runCopyrightGate({ name: copy.title, description: copy.description, tags: copy.tags, aiGenerated: true })
  if (!gate.pass) {
    outcome.status = 'draft_rework'
    outcome.detail = `copyright gate: ${gate.reasons.join('; ')}`
    return outcome
  }

  await composeEtsyPack(refs.productId)

  if (WANT_MODEL_SHOTS() && !isMetal) {
    await note(`${brief.key}: on-model Etsy shots`)
    try {
      await startModelShots(refs.productId, 'mrs-imagine')
      await waitForModelShots(refs.productId)
    } catch (e: any) {
      await note(`${brief.key}: model shots skipped (${String(e?.message).slice(0, 80)})`)
    }
  }

  const etsy = await submitForQa({ productId: refs.productId, channel: 'etsy', submittedBy: 'mrs-imagine' })
  outcome.etsyScore = etsy.verdict.score

  const { data: productRow } = await supabase.from('products').select('category').eq('id', refs.productId).maybeSingle()

  if (AUTO_ACTIVATE()) {
    await supabase.from('products').update({ status: 'active', is_active: true }).eq('id', refs.productId)
  }
  if (AUTO_QUEUE_ETSY() && etsy.verdict.status === 'passed') {
    outcome.etsyQueued = await queueEtsyTiers(refs.productId, productRow?.category ?? '')
    await note(`${brief.key}: queued to Etsy as ${outcome.etsyQueued.join('+') || 'nothing (gate)'}`)
  }

  const { data: mockupAssets } = await supabase
    .from('product_assets')
    .select('url')
    .eq('product_id', refs.productId)
    .eq('kind', 'mockup')
    .order('display_order', { ascending: true })
  const tikTok = await stageTikTok(refs.productId, copy, (mockupAssets ?? []).map((a: any) => a.url).filter(Boolean), brief)
  if (tikTok) outcome.tiktokOutboxId = tikTok

  outcome.status = 'live'
  return outcome
}

// --- Batch -------------------------------------------------------------------

export interface BatchOptions {
  garments?: number
  metal?: number
  requestedBy?: string
}

export async function previewResearch(): Promise<MarketSignal[]> {
  const cats: ResearchCategory[] = ['shirts', 'hoodies', 'polos', 'metal-art']
  const out: MarketSignal[] = []
  for (const c of cats) out.push(await researchCategory(c))
  return out
}

/**
 * Create the batch job row and run the whole batch. Call without awaiting
 * (fire-and-forget) from the route; progress is readable off the ai_jobs row.
 */
export async function startMrsImagineBatch(opts: BatchOptions = {}): Promise<{ batchId: string }> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
  if (!isEtsyResearchConfigured()) throw new Error('ETSY_KEYSTRING is not configured — Mrs. Imagine cannot research without it')

  const counts = {
    garments: Math.min(20, Math.max(0, opts.garments ?? GARMENT_COUNT())),
    metal: Math.min(10, Math.max(0, opts.metal ?? METAL_COUNT())),
  }
  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      type: 'mrs_imagine_batch',
      // 'running' from birth: this row is a progress ledger for the inline
      // orchestrator, never a queue entry — the worker must not claim it.
      status: 'running',
      input: { ...counts, requestedBy: opts.requestedBy ?? null },
      output: { stage: 'research', progress: [], designs: [] },
    })
    .select('id')
    .single()
  if (error) throw new Error(`batch job insert failed: ${error.message}`)

  void runBatch(job.id as string, counts).catch(async (e: any) => {
    await supabase
      .from('ai_jobs')
      .update({ status: 'failed', error: String(e?.message ?? e).slice(0, 800), updated_at: new Date().toISOString() })
      .eq('id', job.id)
  })

  return { batchId: job.id as string }
}

async function runBatch(batchId: string, counts: { garments: number; metal: number }): Promise<void> {
  const progress: string[] = []
  const designs: DesignOutcome[] = []
  const save = async (stage: string) => {
    await supabase
      .from('ai_jobs')
      .update({ output: { stage, progress: progress.slice(-80), designs }, updated_at: new Date().toISOString() })
      .eq('id', batchId)
  }
  const note = async (m: string) => {
    progress.push(`${new Date().toISOString()} ${m}`)
    console.log('[mrs-imagine]', m)
    await save('designing')
  }

  await note(`batch ${batchId} — realtime Etsy research`)
  const signals: MarketSignal[] = []
  const cats: ResearchCategory[] = counts.garments > 0 ? ['shirts', 'hoodies', 'polos'] : []
  if (counts.metal > 0) cats.push('metal-art')
  for (const c of cats) {
    signals.push(await researchCategory(c))
    await note(`research: ${c} sampled ${signals[signals.length - 1].sampled} live listings`)
  }

  await save('briefing')
  const briefs = await writeBriefs(signals, counts)
  await note(`briefs written: ${briefs.map((b) => b.key).join(', ')}`)

  // Bounded concurrency — enough to overlap the long mockup waits without
  // hammering the worker or the OpenAI org limit.
  let cursor = 0
  const workers = Array.from({ length: Math.min(DESIGN_CONCURRENCY, briefs.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= briefs.length) return
      const brief = briefs[i]
      try {
        const outcome = await buildOneDesign(brief, batchId, note)
        designs.push(outcome)
      } catch (e: any) {
        designs.push({ key: brief.key, kind: brief.kind, status: 'error', detail: String(e?.message ?? e).slice(0, 300), attempts: 1 })
        await note(`${brief.key}: ERROR ${String(e?.message ?? e).slice(0, 160)}`)
      }
      await save('designing')
    }
  })
  await Promise.all(workers)

  const live = designs.filter((d) => d.status === 'live').length
  await note(`batch done: ${live}/${designs.length} live, ${designs.filter((d) => d.status === 'draft_rework').length} rework, ${designs.filter((d) => d.status === 'error').length} errors`)
  await supabase
    .from('ai_jobs')
    .update({ status: 'succeeded', output: { stage: 'done', progress: progress.slice(-80), designs }, updated_at: new Date().toISOString() })
    .eq('id', batchId)
}
