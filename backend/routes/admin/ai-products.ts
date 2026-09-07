import { Router, Request, Response, NextFunction } from 'express'
import Replicate from 'replicate'
import { runOpenAIImage } from '../../services/image-flow/providers/openai-image.js'
import { supabase } from '../../lib/supabase.js'
import { normalizeProduct, PRODUCT_CATEGORY_SLUGS } from '../../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../../utils/slugify.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { searchForContext } from '../../services/serpapi-search.js'
import { getPrediction, AVAILABLE_MODELS, GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES, MR_IMAGINE_SUPPORTED_PRODUCT_TYPES } from '../../services/replicate.js'
import { runImageFlowMultiGenerate } from '../../services/image-flow/worker-helpers.js'
import { houseDesignRoster, DEFAULT_GENERATE_MODEL } from '../../services/image-flow/models.js'
import { startModelShots } from '../../services/etsy-model-shots.js'
import stepFlowRouter from './ai-products-step-flow.js'
import { uploadImageFromUrl, uploadImageFromBuffer } from '../../services/google-cloud-storage.js'
import { addWatermark } from '../../services/watermark.js'
import { suggestProductTrends, suggestSimpleWordPhrases, type TrendFamily, type TrendSource } from '../../services/product-trends.js'
import { applyImageSelection, createWatermarkedDesignAsset } from '../../services/product-build.js'

const replicateClient = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! })

// Per-user rate limiter for the expensive AI generation endpoints. In-memory
// (resets on deploy) — enough to stop runaway scripts and double-submits from
// burning real model spend.
const aiRateBuckets = new Map<string, number[]>()
function rateLimitAI(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.user?.sub || req.ip || 'anon'
    const windowStart = Date.now() - 60_000
    const hits = (aiRateBuckets.get(key) || []).filter((t) => t > windowStart)
    if (hits.length >= maxPerMinute) {
      res.status(429).json({ error: `Rate limit: max ${maxPerMinute} AI generations per minute — try again shortly` })
      return
    }
    hits.push(Date.now())
    aiRateBuckets.set(key, hits)
    next()
  }
}

function parseSourceImageDataUrl(dataUrl: unknown): { buffer: Buffer; contentType: string; extension: string } | null {
  if (typeof dataUrl !== 'string' || !dataUrl.trim()) return null

  const matches = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!matches) {
    throw new Error('Source image must be a base64 PNG, JPG, or WEBP data URL')
  }

  const contentType = matches[1]
  const buffer = Buffer.from(matches[2], 'base64')
  const maxBytes = 12 * 1024 * 1024
  if (buffer.length > maxBytes) {
    throw new Error('Source image is too large; max is 12MB')
  }

  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.replace('image/', '')
  return { buffer, contentType, extension }
}

// createWatermarkedDesignAsset moved to services/product-build.ts (shared
// with the creator studio) — imported above.

/**
 * Process a multi-model image job inline (in the API process) instead of via the worker queue.
 * Avoids the race condition where the production worker (running old code) grabs queued jobs.
 */
export async function processImageJobInline(job: any): Promise<void> {
  console.log('[ai-products] 🆕 INLINE MULTI-MODEL FAN-OUT — job:', job.id)
  const promptInput = job.input?.prompt
  if (!promptInput) throw new Error('job missing input.prompt')

  // Look up product slug + category for prompt wrapping + storage paths
  const { data: product } = await supabase
    .from('products')
    .select('slug, name, category')
    .eq('id', job.product_id)
    .single()

  const productSlug = product?.slug || product?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || job.product_id.substring(0, 8)

  const updateProgress = async (message: string, step: number, total: number) => {
    const { data: existing } = await supabase.from('ai_jobs').select('output').eq('id', job.id).single()
    await supabase
      .from('ai_jobs')
      .update({
        output: { ...(existing?.output || {}), message, step, total_steps: total, updated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
  }

  try {
    // SHOULD-FIX #12 (2026-09-01 review): `modelIds` wins when present — the
    // Step Flow's `takes:2|3` builds a `modelIds` array of the SAME model
    // repeated N times alongside `forceSingleModel` (see POST /create
    // below), and the old priority here checked `forceSingleModel` FIRST and
    // collapsed that back down to a single-element `[modelId]` roster,
    // silently dropping takes 2 and 3. `[job.input.modelId]` is now only the
    // fallback for a forceSingleModel job that has no modelIds at all.
    const roster =
      (job.input?.modelIds as string[] | undefined) ??
      (job.input?.forceSingleModel && job.input?.modelId ? [job.input.modelId] : undefined) ??
      // House rule (David 2026-08-20): ITP-sold designs generate on
      // gpt-image-2 only, OpenAI-direct — N independently-enhanced takes
      // instead of the 4-vendor Replicate fan-out. Creator-studio jobs never
      // reach this inline processor, so their roster is untouched.
      houseDesignRoster()
    await updateProgress(`🧠 Tailoring your prompt, then generating ${roster.length} take${roster.length === 1 ? '' : 's'} in parallel...`, 1, 3)
    const results = await runImageFlowMultiGenerate({
      prompt: promptInput,
      modelIds: roster,
      category: product?.category ?? job.input?.category,
      shirtColor: job.input?.shirtColor,
      printStyle: job.input?.printStyle,
      imageStyle: job.input?.imageStyle,
      rawPrompt: Boolean(job.input?.rawPrompt),
      backgroundClause: typeof job.input?.backgroundClause === 'string' ? job.input.backgroundClause : undefined,
      // Metal prints' portrait 2:3 generation (design doc §14) — set on the
      // job by POST /create as `extra: { aspect_ratio: '2:3' }`; forwarded
      // straight through to the OpenAI-direct provider's real request size
      // (services/image-flow/worker-helpers.ts's houseOpenAISize).
      extra: job.input?.extra && typeof job.input.extra === 'object' ? job.input.extra : undefined,
    })

    const succeeded = results.filter((r) => r.status === 'succeeded' && r.url)
    console.log('[ai-products] 🎨 Multi-model results:', results.map((r) => `${r.modelLabel}=${r.status}`).join(', '))

    if (succeeded.length === 0) {
      const errs = results.map((r) => `${r.modelLabel}: ${r.error}`).join('; ')
      throw new Error(`All ${results.length} models failed: ${errs}`)
    }

    await updateProgress(`📤 Uploading ${succeeded.length} variants to cloud storage...`, 2, 3)

    // Same-model takes (the gpt-image-2 house roster) get numbered labels so
    // the picker still shows distinguishable variants.
    const takeCounts = new Map<string, number>()
    for (const r of succeeded) {
      try {
        const take = (takeCounts.get(r.modelId) ?? 0) + 1
        takeCounts.set(r.modelId, take)
        const dupes = succeeded.filter((s) => s.modelId === r.modelId).length > 1
        const ts = Date.now()
        const safeModel = r.modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
        const filename = `${productSlug}-${safeModel}-${dupes ? `take${take}-` : ''}${ts}.png`
        const gcsPath = `graphics/${productSlug}/original/${filename}`
        const { publicUrl, path: storagePath } = await uploadImageFromUrl(r.url!, gcsPath)
        await supabase.from('product_assets').insert({
          product_id: job.product_id,
          kind: 'source',
          path: storagePath,
          url: publicUrl,
          // Reflects the job's real requested size — 1024x1536 for a Step
          // Flow metal portrait generation (see POST /create), 1024x1024 for
          // everything else. Falls back to 1024x1024 for any caller that
          // never set these (every pre-existing call site).
          width: Number(job.input?.width) || 1024,
          height: Number(job.input?.height) || 1024,
          asset_role: 'design',
          is_primary: false,
          display_order: 99,
          metadata: {
            model_id: r.modelId,
            model_name: dupes ? `${r.modelLabel} · Take ${take}` : r.modelLabel,
            provider: r.modelId.startsWith('openai/') ? 'openai' : 'replicate',
            original_prompt: promptInput,
            tailored_prompt: r.tailoredPrompt ?? null,
            multi_model: true,
            generated_at: new Date().toISOString(),
          },
        })
        console.log('[ai-products] ✅ Saved variant:', r.modelLabel, publicUrl)
      } catch (e: any) {
        console.error('[ai-products] ❌ Failed to save variant', r.modelLabel, e.message)
      }
    }

    await updateProgress(`✅ ${succeeded.length}/${results.length} variants ready — pick your favorite`, 3, 3)
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: {
          multiModel: true,
          results: results.map((r) => ({
            modelId: r.modelId,
            modelLabel: r.modelLabel,
            status: r.status,
            error: r.error ?? null,
          })),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log('[ai-products] ✅ Inline generation completed:', job.id, succeeded.length, '/', results.length)
  } catch (err: any) {
    console.error('[ai-products] ❌ Inline generation failed:', err.message)
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
  }
}

const router = Router()

// Imagine Studio Step Flow (David 2026-09-01: replace the classic wizard with
// a step-by-step, approve-per-step flow). Routes live in their own file —
// see ai-products-step-flow.ts — and are mounted here so they share this
// router's base path (/api/admin/products/ai).
router.use(stepFlowRouter)

// GET /api/admin/products/ai/models - Get available image generation models
router.get('/models', requireAuth, async (req: Request, res: Response): Promise<any> => {
  res.json({
    models: AVAILABLE_MODELS,
    default: AVAILABLE_MODELS[0].id
  })
})

// POST /api/admin/products/ai/trends - Find market-backed product ideas
router.post('/trends', requireAuth, requireAdmin, rateLimitAI(12), async (req: Request, res: Response): Promise<any> => {
  try {
    const { source = 'all', family = 'all', seed = '', limit = 6 } = req.body || {}
    const allowedSources = new Set(['all', 'tiktok', 'etsy', 'amazon'])
    const allowedFamilies = new Set(['all', 'apparel', 'tumblers', 'dtf-transfers', 'stickers', 'metal-art', '3d-toys'])

    if (!allowedSources.has(source)) {
      return res.status(400).json({ error: 'Invalid trend source' })
    }
    if (!allowedFamilies.has(family)) {
      return res.status(400).json({ error: 'Invalid product family' })
    }

    req.log?.info({ source, family, hasSeed: Boolean(String(seed).trim()) }, '[ai-products/trends] Searching product trends')
    const result = await suggestProductTrends({
      source: source as TrendSource,
      family: family as TrendFamily,
      seed: typeof seed === 'string' ? seed : '',
      limit: Number(limit) || 6,
    })
    res.json(result)
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products/trends] Error')
    res.status(500).json({ error: error.message || 'Failed to find product trends' })
  }
})

// POST /api/admin/products/ai/trends/phrases - Generate short text-only shirt phrases
router.post('/trends/phrases', requireAuth, requireAdmin, rateLimitAI(12), async (req: Request, res: Response): Promise<any> => {
  try {
    const { source = 'all', seed = '', limit = 10 } = req.body || {}
    const allowedSources = new Set(['all', 'tiktok', 'etsy', 'amazon'])

    if (!allowedSources.has(source)) {
      return res.status(400).json({ error: 'Invalid trend source' })
    }

    req.log?.info({ source, hasSeed: Boolean(String(seed).trim()) }, '[ai-products/trends/phrases] Generating phrase ideas')
    const result = await suggestSimpleWordPhrases({
      source: source as TrendSource,
      seed: typeof seed === 'string' ? seed : '',
      limit: Number(limit) || 10,
    })
    res.json(result)
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products/trends/phrases] Error')
    res.status(500).json({ error: error.message || 'Failed to generate phrase ideas' })
  }
})

// Middleware to verify admin/manager role
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', req.user.sub)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    res.status(403).json({ error: 'Forbidden: Admin access required' })
    return
  }

  next()
}

// POST /api/admin/products/ai/create
router.post('/create', requireAuth, requireAdmin, rateLimitAI(5), async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      prompt,
      priceTarget,
      mockupStyle,
      background,
      tone,
      imageStyle,
      useSearch = false, // Default OFF - only enable for pop culture/trending
      category: requestedCategory,
      // DTF Print Settings
      productType = 'tshirt',
      shirtColor = 'black',
      printPlacement = 'front-center',
      printStyle = 'clean',
      printSizeInches = 11,
      // Model Selection - defaults to GPT Image 2 (image-flow)
      modelId = 'openai/gpt-image-2',
      forceSingleModel = false,
      imagePromptOverride,
      skipImageGeneration = false,
      sourceImageDataUrl,
      deterministicTextDesign,
      // Step Flow (David 2026-09-01): `takes` overrides how many candidates
      // this call generates (1-3, cost-first default is 1 take of
      // gpt-image-2); `stepFlow` carries the idea + brief written in Step 1
      // through to `metadata.step_flow` so the flow can resume from any point.
      takes,
      stepFlow,
    } = req.body

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    // Step Flow `takes` override — clamped 1-3 (gpt-image-2 is the priciest
    // model in the stack; cost-first). Absent/invalid -> undefined, meaning
    // "use the normal houseDesignRoster() length", unchanged from before.
    const takesRequested = Number(takes)
    const takesClamped = Number.isFinite(takesRequested) && takesRequested > 0
      ? Math.min(3, Math.max(1, Math.round(takesRequested)))
      : null

    // T-shirt multi-select print placements → products.print_locations.
    // Keep only known values; the final shirts-need->=1 guard is applied below,
    // once the resolved category is known (matches the DB CHECK constraint).
    const VALID_PRINT_LOCATIONS = ['front_image', 'back_image', 'pocket']
    const requestedPrintLocations: string[] = Array.from(
      new Set(
        (Array.isArray(req.body.print_locations) ? req.body.print_locations : [])
          .filter((v: unknown): v is string => typeof v === 'string' && VALID_PRINT_LOCATIONS.includes(v))
      )
    )

    // Metal prints lane (design doc §14, David 2026-09-02) — computed early
    // (stepFlow itself is destructured from req.body above) since `metalSize`
    // just below needs it. A step-flow metal brief has NOT reached the Sizes
    // step yet at creation time (Idea/Design precede Sizes) — this is a
    // placeholder value POST /:id/step/sizes overwrites with the real
    // largest-selected size once the admin picks sizes.
    const stepProductKindEarly: 'garment' | 'metal' =
      stepFlow && typeof stepFlow === 'object' && stepFlow.brief?.productKind === 'metal' ? 'metal' : 'garment'

    // Metal art panel size (4x6 | 8x10) → metadata.metal_size. Drives the
    // size-accurate mockup scale anchors (David 2026-07-28: a 4x6 must never
    // be mocked up looking massive on a wall). Step Flow metal creation
    // always starts at '8x10' (see comment above) — the classic wizard's
    // req.body.metal_size selector still drives the non-step-flow path.
    const metalSize: '4x6' | '8x10' =
      stepProductKindEarly === 'metal' ? '8x10' : req.body.metal_size === '8x10' ? '8x10' : '4x6'

    // Only a slug we actually recognize counts as a selection; anything else is
    // treated as "not specified" so the model's answer still gets a chance.
    const wizardCategory = PRODUCT_CATEGORY_SLUGS.includes(requestedCategory)
      ? requestedCategory as string
      : null

    req.log?.info({ prompt, useSearch, wizardCategory }, '[ai-products] 🚀 Creating product from prompt')

    // Step 0: Optionally search for context using SerpAPI
    let searchContext = ''
    if (useSearch) {
      req.log?.info({ query: prompt }, '[ai-products] 🔍 Calling SerpAPI to search for context...')
      const searchResult = await searchForContext(prompt)
      searchContext = searchResult.context
      req.log?.info({
        hasContext: searchResult.context.length > 0,
        contextLength: searchResult.context.length,
        contextPreview: searchResult.context.substring(0, 200),
        sources: searchResult.sources.length
      }, '[ai-products] 🔍 Search context obtained')
    } else {
      req.log?.info('[ai-products] ⏭️ Skipping web search (useSearch = false)')
    }

    // Step 1: Normalize with GPT (with optional search context)
    const normalized = await normalizeProduct({
      prompt,
      priceTarget,
      mockupStyle,
      background,
      tone,
      imageStyle, // realistic, cartoon, or semi-realistic
      searchContext,
      category: wizardCategory ?? undefined,
      // DTF settings for context
      productType,
      shirtColor,
      printPlacement,
    })

    if (typeof imagePromptOverride === 'string' && imagePromptOverride.trim()) {
      normalized.image_prompt = imagePromptOverride.trim()
    }

    // Step Flow: the brief's designPrompt IS the image prompt. The normalizer
    // still writes title/description/tags, but must not rewrite the art brief.
    const stepBriefPrompt: string | null =
      stepFlow && typeof stepFlow === 'object' && typeof stepFlow.brief?.designPrompt === 'string' && stepFlow.brief.designPrompt.trim()
        ? stepFlow.brief.designPrompt.trim()
        : null
    if (stepBriefPrompt && !(typeof imagePromptOverride === 'string' && imagePromptOverride.trim())) {
      normalized.image_prompt = stepBriefPrompt
    }

    // Metal prints lane (design doc §14, David 2026-09-02): the Step Flow
    // Idea step carries `stepFlow.brief.productKind === 'metal'` for a metal
    // wall-art brief — full-bleed portrait art, never the DTF solid-background
    // rule. Only meaningful when a step-flow brief is actually present.
    const stepProductKind: 'garment' | 'metal' = stepBriefPrompt ? stepProductKindEarly : 'garment'

    const stepBackground: 'white' | 'black' | null =
      stepBriefPrompt && stepProductKind === 'garment' && (stepFlow.brief?.background === 'white' || stepFlow.brief?.background === 'black')
        ? stepFlow.brief.background
        : null
    const stepBackgroundClause = stepBriefPrompt
      ? stepProductKind === 'metal'
        // No solid-background rule for metal — a full-bleed scene fills the
        // whole panel edge to edge instead (design doc §14: "portrait 2:3,
        // fills the frame").
        ? 'Full-bleed, portrait 2:3, fills the frame edge to edge — no border, no vignette, no letterboxing, no solid-color margin.'
        : stepBackground
          ? `Render the artwork on a SOLID, FLAT, uniform ${stepBackground} background that fills the entire canvas edge to edge. No gradient, no vignette, no drop shadow, no checkerboard, no simulated or painted transparency, no border, no frame.`
          : undefined
      : undefined

    // Photo-template products (Imagine Studio, 2026-07-31): the caller pins the
    // category instead of letting normalization guess. Whitelisted — this is
    // the only slug the override may force; absent param = behavior unchanged.
    // It wins over the wizard dropdown because it is a different caller
    // entirely (Imagine Studio never sends a wizard category).
    const isTemplate = req.body.category_slug_override === 'templates'

    // Otherwise the admin's dropdown wins. The category used to be inferred by
    // the model from prompt prose, sitting next to a block headed "DTF Print
    // Settings" — so shirts were landing as `dtf-transfers` at random, which
    // then blocked them at the Etsy taxonomy check. An unrecognized slug also
    // falls back here rather than upserting a junk category row.
    //
    // Step Flow metal prints (design doc §14) win over everything else here —
    // the brief itself declared productKind:'metal', a stronger signal than
    // either the admin dropdown or isTemplate, neither of which the Step Flow
    // studio ever sends alongside a metal brief.
    if (stepProductKind === 'metal') {
      normalized.category_slug = 'metal-art'
      normalized.category_name = 'Metal Art'
    } else if (isTemplate) {
      normalized.category_slug = 'templates'
      normalized.category_name = 'Templates'
    } else if (wizardCategory) {
      if (normalized.category_slug !== wizardCategory) {
        req.log?.warn(
          { model: normalized.category_slug, requested: wizardCategory },
          '[ai-products] ⚠️ model category overridden by the admin selection'
        )
      }
      normalized.category_slug = wizardCategory
    } else if (!PRODUCT_CATEGORY_SLUGS.includes(normalized.category_slug as any)) {
      req.log?.warn({ model: normalized.category_slug }, '[ai-products] ⚠️ unknown category slug → shirts')
      normalized.category_slug = 'shirts'
    }
    if (normalized.category_slug !== normalized.category_name) {
      const known: Record<string, string> = {
        shirts: 'Shirts', hoodies: 'Hoodies', tumblers: 'Tumblers',
        'dtf-transfers': 'DTF Transfers', 'metal-art': 'Metal Art'
      }
      if (known[normalized.category_slug]) normalized.category_name = known[normalized.category_slug]
    }

    // Step 2: Upsert category
    const { data: category, error: catError } = await supabase
      .from('product_categories')
      .upsert({
        slug: normalized.category_slug,
        name: normalized.category_name,
      }, {
        onConflict: 'slug',
      })
      .select()
      .single()

    if (catError) {
      req.log?.error({ error: catError }, '[ai-products] ❌ Category error')
      return res.status(500).json({ error: 'Failed to create category' })
    }

    // Step 3: Generate unique slug
    const baseSlug = slugify(normalized.title)
    const { data: existingProducts } = await supabase
      .from('products')
      .select('slug')
      .like('slug', `${baseSlug}%`)

    const existingSlugs = existingProducts?.map((p: any) => p.slug).filter(Boolean) || []
    const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)

    // Resolve print_locations against the final category. The DB CHECK requires
    // >= 1 placement for 'shirts'. When the admin didn't pick locations
    // explicitly, derive them from the print placement so a back or pocket
    // product doesn't ship advertising only a front print.
    const PLACEMENT_DEFAULT_LOCATIONS: Record<string, string[]> = {
      'front-center': ['front_image'],
      'left-pocket': ['pocket'],
      'back-only': ['back_image'],
      'front-back': ['front_image', 'back_image'],
      'pocket-front-back-full': ['pocket', 'back_image'],
    }
    const printLocations =
      normalized.category_slug === 'shirts' && requestedPrintLocations.length === 0
        ? (PLACEMENT_DEFAULT_LOCATIONS[printPlacement] || ['front_image'])
        : requestedPrintLocations

    // Step 4: Create product (draft) with AI metadata
    const { data: product, error: productError} = await supabase
      .from('products')
      .insert({
        category_id: category.id,
        name: normalized.title,
        slug: uniqueSlug,
        description: normalized.description,
        // Defensive: GPT sometimes returns dollars in suggested_price_cents instead of cents.
        price: normalized.suggested_price_cents < 100
          ? normalized.suggested_price_cents
          : normalized.suggested_price_cents / 100,
        status: 'draft',
        images: [],
        category: normalized.category_slug,
        print_locations: printLocations,
        metadata: {
          ai_generated: true,
          original_prompt: prompt,
          image_prompt: normalized.image_prompt,
          mockup_style: mockupStyle,
          background,
          tone,
          image_style: imageStyle,
          created_with_search: useSearch,
          search_context: searchContext ? searchContext.substring(0, 500) : null,
          // DTF Print Settings — Step Flow metal (design doc §14) stamps its
          // own product_type/print_placement instead of the garment builder's
          // request-body defaults ('tshirt'/'front-center'), since a metal
          // panel is neither.
          product_type: stepProductKind === 'metal' ? 'metal-art' : productType,
          shirt_color: shirtColor,
          print_placement: stepProductKind === 'metal' ? 'not-applicable' : printPlacement,
          print_style: printStyle,
          // Physical print width (inches) — drives explicit scale language in
          // the mockup prompts and the QA coverage gate. Garments only.
          ...(normalized.category_slug === 'metal-art'
            ? {}
            : { print_size_inches: Math.min(16, Math.max(3, Math.round(Number(printSizeInches) || 11))) }),
          // Metal art: physical panel size (drives size-accurate mockups)
          ...(normalized.category_slug === 'metal-art' ? { metal_size: metalSize } : {}),
          // Model used for image generation
          model_id: modelId,
          // Personalizable template: design ships with an EMPTY photo slot;
          // staff drop the customer's photo in per order (Etsy flow).
          ...(isTemplate ? { is_template: true, personalization: 'customer_photo' } : {}),
          // Step Flow (David 2026-09-01): Step 1's idea + brief, so the flow
          // can resume from GET /:id/step at any point. Absent when this
          // product was created outside the step flow (classic wizard, etc).
          ...(stepFlow && typeof stepFlow === 'object'
            ? {
                step_flow: {
                  version: 1,
                  idea: typeof stepFlow.idea === 'string' ? stepFlow.idea : '',
                  brief: stepFlow.brief ?? null,
                  // Inspiration (David 2026-09-02): the reference breakdown + keep/change
                  // choices ride along so the flow can resume and the listing can cite it.
                  inspiration: stepFlow.inspiration && typeof stepFlow.inspiration === 'object' ? stepFlow.inspiration : null,
                  shots: {},
                  approvals: {},
                },
              }
            : {}),
        },
      })
      .select()
      .single()

    if (productError) {
      req.log?.error({ error: productError }, '[ai-products] ❌ Product error')
      return res.status(500).json({ error: 'Failed to create product', details: productError.message })
    }

    req.log?.info({ productId: product.id }, '[ai-products] ✅ Product created')

    // Step 5: Create tags
    if (normalized.tags.length > 0) {
      await supabase
        .from('product_tags')
        .insert(normalized.tags.map(tag => ({
          product_id: product.id,
          tag,
        })))
    }

    // Step 6: Create variants
    if (normalized.variants.length > 0) {
      await supabase
        .from('product_variants')
        .insert(normalized.variants.map(variant => ({
          product_id: product.id,
          name: variant.name,
          price_cents: normalized.suggested_price_cents + (variant.priceDeltaCents || 0),
          stock: 0,
        })))
    }

    const sourceImage = parseSourceImageDataUrl(sourceImageDataUrl)
    if (sourceImage) {
      const filename = `${uniqueSlug}-text-design-${Date.now()}.${sourceImage.extension}`
      const gcsPath = `graphics/${uniqueSlug}/original/${filename}`
      const { publicUrl, path: storagePath } = await uploadImageFromBuffer(sourceImage.buffer, gcsPath, sourceImage.contentType)

      const { error: assetError } = await supabase.from('product_assets').insert({
        product_id: product.id,
        kind: 'source',
        path: storagePath,
        url: publicUrl,
        width: 2048,
        height: 2048,
        asset_role: 'design',
        is_primary: false,
        display_order: 1,
        metadata: {
          deterministic_text_design: true,
          original_prompt: prompt,
          text_design: deterministicTextDesign ?? null,
          generated_at: new Date().toISOString(),
        },
      })

      if (assetError) {
        req.log?.error({ error: assetError }, '[ai-products] âŒ Text source asset error')
        return res.status(500).json({ error: 'Failed to save text design asset', details: assetError.message })
      }

      const { data: createdJobs, error: jobsError } = await supabase
        .from('ai_jobs')
        .insert([{
          product_id: product.id,
          type: 'replicate_image_v2',
          status: 'succeeded',
          input: {
            prompt: normalized.image_prompt,
            width: 2048,
            height: 2048,
            background: 'transparent',
            productType,
            shirtColor,
            printPlacement,
            printStyle,
            imageStyle,
            deterministicTextDesign: true,
            multiModel: false,
          },
          output: {
            message: 'Plain text design ready',
            deterministicTextDesign: true,
          },
        }])
        .select()

      if (jobsError) {
        req.log?.error({ error: jobsError }, '[ai-products] âŒ Text design job error')
      }

      req.log?.info({ count: createdJobs?.length }, '[ai-products] âœ… Text design source created')
      return res.json({
        productId: product.id,
        product: {
          ...product,
          normalized,
        },
        jobs: createdJobs,
      })
    }

    if (skipImageGeneration) {
      return res.status(400).json({ error: 'A source image is required when image generation is skipped' })
    }

    // Step 7: Create source image job.
    // Admin builder uses multi-model fan-out — 4 models in parallel, user picks the best.
    // type: 'replicate_image_v2' so the production worker (running old compiled code that
    // only handles 'replicate_image') won't race to process it. Local worker handles both.
    //
    // CRITICAL: Insert with status='running' (NOT 'queued'). Production worker filters
    // queued jobs only — by inserting with status='running' from the get-go, production
    // never sees it. Local API processes the job immediately in the background.
    const jobs = [
      {
        product_id: product.id,
        type: 'replicate_image_v2',
        status: 'running', // pre-claimed so production worker won't race
        input: {
          prompt: normalized.image_prompt,
          // Metal (design doc §14) generates portrait 2:3 — gpt-image-2's
          // native aspect_ratio sizes are 1024x1024 / 1536x1024 / 1024x1536
          // (see services/image-flow/models.ts); 1024x1536 is the 2:3
          // portrait size. `extra.aspect_ratio` below is what actually
          // drives the OpenAI-direct provider's real request size
          // (services/image-flow/worker-helpers.ts's houseOpenAISize) — these
          // width/height fields are informational (they also seed the saved
          // product_assets row's width/height in processImageJobInline).
          width: stepProductKind === 'metal' ? 1024 : 1024,
          height: stepProductKind === 'metal' ? 1536 : 1024,
          background: normalized.background,
          productType,
          shirtColor,
          printPlacement,
          printStyle,
          imageStyle,
          modelId,
          forceSingleModel: Boolean(forceSingleModel),
          multiModel: true,
          // House roster pinned ON the job so even a worker-side pickup (e.g.
          // a manual requeue after an inline failure) stays gpt-image-2-only.
          // Step Flow's `takes` override (clamped 1-3 above) replaces the
          // roster length in both branches when the caller passed one;
          // absent `takes`, behaviour is exactly what it was before.
          modelIds: forceSingleModel && modelId
            ? Array.from({ length: takesClamped ?? 1 }, () => modelId)
            : (takesClamped ? Array.from({ length: takesClamped }, () => DEFAULT_GENERATE_MODEL) : houseDesignRoster()),
          // Step Flow: verbatim brief + solid-background clause (see
          // runImageFlowMultiGenerate.rawPrompt for why the DTF wrap is skipped).
          ...(stepBriefPrompt ? { rawPrompt: true, backgroundClause: stepBackgroundClause } : {}),
          // Metal portrait generation — forwarded to runImageFlowMultiGenerate's
          // opts.extra by processImageJobInline below, which resolves to
          // gpt-image-2's 1024x1536 real request size.
          ...(stepProductKind === 'metal' ? { extra: { aspect_ratio: '2:3' } } : {}),
        },
      },
    ]

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobs)
      .select()

    if (jobsError) {
      req.log?.error({ error: jobsError }, '[ai-products] ❌ Jobs error')
    }

    req.log?.info({ count: createdJobs?.length }, '[ai-products] ✅ Jobs created')

    // Fire-and-forget: process the job inline in this Node process so we don't
    // depend on the worker's poll loop racing with production. The function
    // resolves on its own; we don't await so the HTTP response returns immediately.
    if (createdJobs && createdJobs.length > 0) {
      const imageJob = createdJobs[0]
      void processImageJobInline(imageJob).catch((err: any) => {
        req.log?.error({ jobId: imageJob.id, err: err.message }, '[ai-products] ❌ inline job failed')
      })
    }

    res.json({
      productId: product.id,
      product: {
        ...product,
        normalized,
      },
      jobs: createdJobs,
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/products/ai/one-shot
 *
 * Lightweight 1-click product image generation. Bypasses the multi-model
 * fan-out, SerpAPI search, and GPT prompt-normalization steps in /create —
 * just takes a raw user prompt, wraps it with the DTF-shirt design rules,
 * runs a single openai/gpt-image-2 call, persists to GCS, and creates a
 * draft `products` row the admin can edit afterward.
 *
 * Body: {
 *   prompt: string,                          // user-supplied subject ("a wolf howling at the moon")
 *   productType?: 'tshirt' | 'hoodie' | …    // shapes the system prompt (default 'tshirt')
 *   shirtColor?: string,                     // 'black' | 'white' | etc — for safe-contrast hint
 * }
 *
 * Returns: { product: { id, name, image_url }, processingTimeSec }
 */
router.post('/one-shot', requireAuth, requireAdmin, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  const t0 = Date.now()
  try {
    const { prompt, productType = 'tshirt', shirtColor = 'black', style } = req.body
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Prompt must be at least 3 characters' })
    }

    req.log?.info({ promptLen: prompt.length, productType, style }, '[ai-products/one-shot] 🎯 Starting 1-shot generation (OpenAI direct)')

    const product = await generateOneShotViaOpenAI(prompt, productType, shirtColor, style)
    const processingTimeSec = (Date.now() - t0) / 1000
    req.log?.info({ productId: product.id, processingTimeSec }, '[ai-products/one-shot] ✅ Done')

    return res.json({ product, processingTimeSec })
  } catch (error: any) {
    req.log?.error({ error: error?.message ?? error }, '[ai-products/one-shot] ❌ Error')
    return res.status(500).json({ error: error?.message ?? 'One-shot generation failed' })
  }
})

// Style suffix lookup. Keep keys in sync with the frontend OneShot/Bulk
// modals' STYLE_OPTIONS list. Missing keys silently mean "no extra style
// hint" — base DTF constraints still apply.
const STYLE_SUFFIXES: Record<string, string> = {
  realistic:  'photorealistic, high detail, professional photography',
  cartoon:    'cartoon style, vibrant colors, bold outlines',
  minimalist: 'minimalist design, clean lines, simple shapes',
  vintage:    'vintage style, retro, aged paper texture, nostalgic',
  cyberpunk:  'cyberpunk style, neon glow, futuristic, dark atmosphere, holographic accents',
  fantasy:    'fantasy art style, ethereal lighting, magical, mythical creatures, painterly detail',
  vaporwave:  'vaporwave aesthetic, neon colors, 80s retro futurism',
  tattoo:     'traditional tattoo flash, bold blackwork outlines, limited palette, classic Americana',
  streetwear: 'streetwear graphic, bold typography vibes, modern urban illustration',
}

/**
 * Build the shared DTF-shirt system prompt. Phrased with POSITIVE descriptors
 * (image models follow "do this" much better than "don't do that"). The
 * transparent-background hint stays in the prompt text because OpenAI's
 * images.generate API rejects `background:'transparent'` as a top-level param
 * for gpt-image-2 ("Transparent background is not supported for this model.").
 *
 * Optional `style` adds a style-suffix lookup at the end, so admin selections
 * in the UI map directly through.
 */
function buildDtfPrompt(prompt: string, productType: string, shirtColor: string, style?: string): string {
  const styleHint = style && STYLE_SUFFIXES[style] ? ` ${STYLE_SUFFIXES[style]}.` : ''
  return [
    `${prompt.trim()}.`,
    `Standalone graphic illustration on a fully transparent background, isolated artwork only — no t-shirt, no hoodie, no garment, no mockup, no model wearing it.`,
    `Bold, high-contrast, screen-print-ready style with sharp clean edges and a limited palette.`,
    `Vivid colors that pop against a ${shirtColor} shirt; avoid colors that match the shirt color.`,
    `Square 1:1 composition, centered subject with clear silhouette, edges fully transparent.${styleHint}`,
  ].join(' ')
}

/**
 * Persist a generated image (already uploaded to GCS) to a fresh draft
 * `products` row. Returns the slim shape the modals consume.
 */
async function saveDraftProductRow(opts: {
  prompt: string
  productType: string
  shirtColor: string
  gcsUrl: string
  modelId: string
  dtfSystemPrompt: string
}): Promise<{ id: string; name: string; slug: string; image_url: string }> {
  const { prompt, productType, shirtColor, gcsUrl, modelId, dtfSystemPrompt } = opts
  const baseSlug = slugify(prompt.slice(0, 60))
  // generateUniqueSlug expects (baseSlug, existingSlugs[]) — passing the
  // supabase client by mistake here was triggering "Converting circular
  // structure to JSON" via the SupabaseAuthClient.mfa.webauthn.client cycle
  // when something tried to coerce the client to a primitive. Always query
  // the existing slugs explicitly, mirror the /create flow at line 235.
  const { data: existingProducts } = await supabase
    .from('products')
    .select('slug')
    .like('slug', `${baseSlug}%`)
  const existingSlugs = existingProducts?.map((p: any) => p.slug).filter(Boolean) || []
  const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)
  const draftName = prompt.split(/[.\n]/)[0].slice(0, 80).trim() || 'Untitled AI Design'

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name: draftName,
      slug: uniqueSlug,
      description: prompt.trim(),
      price: 25.00,
      status: 'draft',
      images: [gcsUrl],
      // Polos file under the established 'shirts' category (there is no polo
      // category); shirts requires >=1 print location by CHECK constraint.
      category: productType === 'tshirt' ? 't-shirts' : productType === 'polo' ? 'shirts' : productType,
      ...(productType === 'polo' ? { print_locations: ['front_image'] } : {}),
      metadata: {
        ai_generated: true,
        one_shot: true,
        original_prompt: prompt,
        model_id: modelId,
        product_type: productType,
        shirt_color: shirtColor,
        dtf_system_prompt: dtfSystemPrompt,
      },
    })
    .select()
    .single()
  if (error) throw error
  return { id: product.id, name: product.name, slug: product.slug, image_url: gcsUrl }
}

/**
 * One-shot path — OpenAI Images API direct (gpt-image-2). Replaces the prior
 * Replicate-hosted call which was throwing "Converting circular structure to
 * JSON" errors via the Replicate SDK. Direct OpenAI returns base64 in
 * `data[0].b64_json`; we upload it to GCS so the public URL is stable.
 *
 * If gpt-image-2 isn't available on the account, falls back to gpt-image-1.
 */
async function generateOneShotViaOpenAI(
  prompt: string,
  productType: string,
  shirtColor: string,
  style?: string
): Promise<{ id: string; name: string; slug: string; image_url: string }> {
  const dtfSystemPrompt = buildDtfPrompt(prompt, productType, shirtColor, style)

  // Uses the shared OpenAI-direct gpt-image-2 flow (with built-in gpt-image-1
  // fallback) — the same provider the Imagination Station premium tier uses.
  // background:'transparent' - gpt-image-2 accepts it and returns real alpha
  // (verified live 2026-09-03). It used to be 'auto' on the belief that the
  // parameter was rejected, which left every design needing a lossy
  // background-removal pass to recover a cutout it could have been born with.
  // buildDtfPrompt still carries the intent in text for the fallback models.
  const objectPath = `ai-products/one-shot/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const { url: gcsUrl, modelId } = await runOpenAIImage({
    prompt: dtfSystemPrompt,
    objectPath,
    quality: 'high',
    background: 'transparent',
  })

  return saveDraftProductRow({
    prompt,
    productType,
    shirtColor,
    gcsUrl,
    modelId,
    dtfSystemPrompt,
  })
}

/**
 * Bulk path — Replicate google/imagen-4-ultra. Imagen 4 Ultra is faster
 * and cheaper than gpt-image-2 for parallel fan-out, and Replicate's URL
 * output works with `uploadImageFromUrl` directly (no b64 round-trip).
 * Input shape mirrors backend/services/image-flow/input-builder.ts:84.
 */
async function generateBulkViaImagen4Ultra(
  prompt: string,
  productType: string,
  shirtColor: string,
  style?: string
): Promise<{ id: string; name: string; slug: string; image_url: string }> {
  const dtfSystemPrompt = buildDtfPrompt(prompt, productType, shirtColor, style)

  const output = await replicateClient.run(
    'google/imagen-4-ultra' as `${string}/${string}`,
    { input: { prompt: dtfSystemPrompt, aspect_ratio: '1:1' } }
  )

  let replicateUrl = ''
  if (typeof output === 'string') {
    replicateUrl = output
  } else if (Array.isArray(output) && output[0]) {
    const first: any = output[0]
    replicateUrl = typeof first === 'string'
      ? first
      : (typeof first?.url === 'function' ? String(first.url()) : (first?.href ?? ''))
  } else if (output && typeof (output as any).url === 'function') {
    const u = (output as any).url()
    replicateUrl = typeof u === 'string' ? u : String(u?.href ?? u)
  }
  if (!replicateUrl) throw new Error('imagen-4-ultra returned no image URL')

  const objectPath = `ai-products/bulk/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const { publicUrl: gcsUrl } = await uploadImageFromUrl(replicateUrl, objectPath)

  return saveDraftProductRow({
    prompt,
    productType,
    shirtColor,
    gcsUrl,
    modelId: 'google/imagen-4-ultra',
    dtfSystemPrompt,
  })
}

/**
 * Run an array of async tasks with a concurrency cap. Replicate has per-account
 * rate limits and gpt-image-2 is the priciest model in the stack — firing 20
 * parallel calls would saturate the queue and balloon cost spikes. 5 at a time
 * is a sweet spot: ~4 batches for a 20-prompt run = ~2 min wallclock.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function next(): Promise<void> {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next())
  await Promise.all(workers)
  return results
}

/**
 * POST /api/admin/products/ai/bulk
 *
 * Run the same DTF-shirt 1-shot pipeline on a list of prompts in parallel.
 * Capped at 20 prompts per request so a typo can't 4-figure-spend the budget.
 * Concurrency limited to 5 so we don't slam Replicate's queue.
 *
 * Body: {
 *   prompts: string[],          // one design idea per item, 1-20 entries
 *   productType?: string,       // applied to all (default 'tshirt')
 *   shirtColor?: string,        // applied to all (default 'black')
 * }
 *
 * Returns: {
 *   results: Array<
 *     { ok: true,  prompt: string, product: { id, name, slug, image_url } }
 *   | { ok: false, prompt: string, error: string }
 *   >,
 *   succeeded: number,
 *   failed: number,
 *   processingTimeSec: number,
 * }
 *
 * Partial failures don't fail the whole request — failed rows come back with
 * `ok: false` so the admin sees which prompts hit OpenAI safety filters / rate
 * limits / etc and can retry just those.
 */
router.post('/bulk', requireAuth, requireAdmin, rateLimitAI(2), async (req: Request, res: Response): Promise<any> => {
  const t0 = Date.now()
  try {
    const { prompts, productType = 'tshirt', shirtColor = 'black', style } = req.body
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: 'prompts must be a non-empty array' })
    }
    const cleaned = prompts
      .map((p: unknown) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p: string) => p.length >= 3)
    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'No valid prompts (each must be at least 3 characters)' })
    }
    if (cleaned.length > 20) {
      return res.status(400).json({ error: 'Max 20 prompts per bulk request' })
    }

    req.log?.info({ count: cleaned.length, productType, style }, '[ai-products/bulk] 🎯 Starting bulk generation (Imagen 4 Ultra)')

    const results = await runWithConcurrency(cleaned, 5, async (prompt, i) => {
      try {
        const product = await generateBulkViaImagen4Ultra(prompt, productType, shirtColor, style)
        req.log?.info({ i, promptLen: prompt.length, productId: product.id }, '[ai-products/bulk] ✓')
        return { ok: true as const, prompt, product }
      } catch (err: any) {
        const msg = err?.message ?? 'generation failed'
        req.log?.warn({ i, promptLen: prompt.length, err: msg }, '[ai-products/bulk] ✗')
        return { ok: false as const, prompt, error: msg }
      }
    })

    const succeeded = results.filter((r) => r.ok).length
    const failed = results.length - succeeded
    const processingTimeSec = (Date.now() - t0) / 1000
    req.log?.info({ succeeded, failed, processingTimeSec }, '[ai-products/bulk] ✅ Done')

    return res.json({ results, succeeded, failed, processingTimeSec })
  } catch (error: any) {
    req.log?.error({ error: error?.message ?? error }, '[ai-products/bulk] ❌ Error')
    return res.status(500).json({ error: error?.message ?? 'Bulk generation failed' })
  }
})

/**
 * POST /api/admin/products/ai/promo/bulk
 *
 * Set or clear a flat promo price across many products. Admin-only.
 *
 * Apply mode: stash the current `price` into `metadata.original_price` (only
 * if not already set — re-running an apply doesn't trample the original) and
 * set `price = promoPrice`. All existing cart/checkout code continues to read
 * `product.price` and automatically picks up the discount.
 *
 * Clear mode: restore `price = metadata.original_price` and remove the
 * `original_price` key. Products with no `original_price` are skipped (they
 * were never on promo).
 *
 * Body: {
 *   action: 'apply' | 'clear',
 *   productIds: string[],   // up to 200 per request
 *   promoPrice?: number,    // required when action === 'apply'
 * }
 *
 * Returns: { applied: number, cleared: number, skipped: number, errors: [] }
 */
router.post('/promo/bulk', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { action, productIds, promoPrice } = req.body
    if (action !== 'apply' && action !== 'clear') {
      return res.status(400).json({ error: "action must be 'apply' or 'clear'" })
    }
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds must be a non-empty array' })
    }
    if (productIds.length > 200) {
      return res.status(400).json({ error: 'Max 200 products per bulk promo request' })
    }
    if (action === 'apply') {
      if (typeof promoPrice !== 'number' || promoPrice <= 0) {
        return res.status(400).json({ error: 'promoPrice must be a positive number' })
      }
    }

    // Pull current rows so we know the existing price + metadata before we
    // mutate. Doing this in one query is much faster than N round trips.
    const { data: products, error: fetchError } = await supabase
      .from('products')
      .select('id, price, metadata')
      .in('id', productIds)
    if (fetchError) {
      req.log?.error({ err: fetchError.message }, '[promo/bulk] fetch error')
      return res.status(500).json({ error: fetchError.message })
    }

    let applied = 0
    let cleared = 0
    let skipped = 0
    const errors: { id: string; reason: string }[] = []

    for (const p of products ?? []) {
      const meta = (p.metadata as any) ?? {}
      try {
        if (action === 'apply') {
          // If price is already AT promoPrice and original_price already saved,
          // the request is a no-op — skip without writing.
          if (p.price === promoPrice && typeof meta.original_price === 'number') {
            skipped++
            continue
          }
          // Preserve the FIRST seen original_price across repeated applies so
          // a second promo doesn't overwrite it with the previously-discounted
          // value. If meta.original_price is missing OR <= promoPrice (stale),
          // refresh it to the current live price.
          const newOriginal =
            typeof meta.original_price === 'number' && meta.original_price > p.price
              ? meta.original_price
              : p.price
          const { error } = await supabase
            .from('products')
            .update({
              price: promoPrice,
              metadata: { ...meta, original_price: newOriginal },
            })
            .eq('id', p.id)
          if (error) throw error
          applied++
        } else {
          // clear
          if (typeof meta.original_price !== 'number') {
            skipped++ // never had a promo
            continue
          }
          const { original_price, ...metaRest } = meta
          const { error } = await supabase
            .from('products')
            .update({
              price: original_price,
              metadata: metaRest,
            })
            .eq('id', p.id)
          if (error) throw error
          cleared++
        }
      } catch (err: any) {
        errors.push({ id: p.id, reason: err?.message ?? 'unknown' })
      }
    }

    req.log?.info({ action, applied, cleared, skipped, errors: errors.length }, '[promo/bulk] ✅ Done')
    return res.json({ applied, cleared, skipped, errors })
  } catch (error: any) {
    req.log?.error({ error: error?.message ?? error }, '[promo/bulk] ❌ Error')
    return res.status(500).json({ error: error?.message ?? 'Bulk promo update failed' })
  }
})

/**
 * DELETE /api/admin/products/ai/:id
 *
 * Hard-delete a draft product. Used by the bulk-generation modal to discard
 * unwanted 1-shots without leaving stranded `status='draft'` rows. Admin-only.
 * Cascades: products row + product_assets rows for that id.
 */
router.delete('/:id', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    if (!id) return res.status(400).json({ error: 'product id required' })

    // Drop child assets first to avoid FK orphans (products has product_assets refs).
    const { error: assetsError } = await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', id)
    if (assetsError) {
      // Not fatal — products may not have any assets — but log it.
      req.log?.warn({ id, err: assetsError.message }, '[ai-products/delete] asset cleanup warning')
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
    if (error) {
      req.log?.error({ id, err: error.message }, '[ai-products/delete] failed')
      return res.status(500).json({ error: error.message })
    }

    req.log?.info({ id }, '[ai-products/delete] ✅ Deleted')
    return res.json({ ok: true, id })
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'Delete failed' })
  }
})

// GET /api/admin/products/ai/:id/status
// Query params:
//   display=true - Returns only display assets (primary design + mockups), ordered by display_order
router.get('/:id/status', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const displayOnly = req.query.display === 'true'

    // Get product with related data
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Get assets - filter for display if requested
    let assetsQuery = supabase
      .from('product_assets')
      .select('*')
      .eq('product_id', id)

    if (displayOnly) {
      // Only get primary design and mockup assets for storefront display
      assetsQuery = assetsQuery.or('is_primary.eq.true,asset_role.like.mockup_%')
      assetsQuery = assetsQuery.order('display_order', { ascending: true })
    }

    const { data: assets } = await assetsQuery

    // Get jobs
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: true })

    // ACTIVE CHECK: If any job is running or queued, check Replicate status
    // This is crucial for local development where webhooks might fail
    if (jobs && jobs.length > 0) {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if ((job.status === 'queued' || job.status === 'running') && job.replicate_id) {
          try {
            req.log?.info({ jobId: job.id, replicateId: job.replicate_id }, '[ai-products] 📡 Polling Replicate for job status');
            const prediction = await getPrediction(job.replicate_id);
            
            let newStatus = job.status;
            let output = job.output;
            let error = job.error;

            if (prediction.status === 'succeeded') {
              newStatus = 'succeeded';
              output = prediction.output;
            } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
              newStatus = 'failed';
              error = prediction.error;
            } else if (prediction.status === 'processing' || prediction.status === 'starting') {
              newStatus = 'running';
            }

            if (newStatus !== job.status) {
              req.log?.info({ jobId: job.id, oldStatus: job.status, newStatus: newStatus }, '[ai-products] 🔄 Updating job status in DB');
              
              const { data: updatedJob, error: updateError } = await supabase
                .from('ai_jobs')
                .update({ 
                  status: newStatus,
                  output: output,
                  error: error,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)
                .select()
                .single();

              if (updateError) {
                req.log?.error({ updateError }, '[ai-products] ❌ Error updating job status');
              } else if (updatedJob) {
                jobs[i] = updatedJob; // Update the job in the array being sent back
              }
            }
          } catch (err: any) {
            req.log?.error({ jobId: job.id, err: err.message }, '[ai-products] ⚠️ Failed to sync job with Replicate');
          }
        }
      }
    }

    res.json({
      product: product,
      assets: assets || [],
      jobs: jobs || [],
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/remove-background
router.post('/:id/remove-background', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { selectedAssetId } = req.body

    req.log?.info({ productId: id, selectedAssetId }, '[ai-products] 🔄 Creating background removal job')

    // Create background removal job with selected asset ID
    const { data: job, error: jobError } = await supabase
      .from('ai_jobs')
      .insert({
        product_id: id,
        type: 'replicate_rembg',
        status: 'queued',
        input: {
          selected_asset_id: selectedAssetId, // Pass the specific asset to process
        },
      })
      .select()
      .single()

    if (jobError) {
      req.log?.error({ error: jobError }, '[ai-products] ❌ Job creation error')
      return res.status(500).json({ error: 'Failed to create background removal job' })
    }

    req.log?.info({ jobId: job.id }, '[ai-products] ✅ Background removal job created')

    res.json({ job })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/create-mockups
// Creates 3 mockup jobs: flat_lay + ghost_mannequin (for garments) + mr_imagine
router.post('/:id/create-mockups', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { selectedAssetId } = req.body

    req.log?.info({ productId: id, selectedAssetId }, '[ai-products] 🔄 Creating mockup jobs')

    // Clean up ALL existing mockup JOBS (including succeeded) to prevent duplicate generation
    const { data: deletedJobs, error: deleteJobsError } = await supabase
      .from('ai_jobs')
      .delete()
      .eq('product_id', id)
      .in('type', ['replicate_mockup', 'replicate_mockup_v2'])  // delete BOTH legacy + v2 (clears prod-orphan dupes)
      .select('id')

    if (deleteJobsError) {
      console.warn('[ai-products] ⚠️ Failed to delete existing mockup jobs:', deleteJobsError)
    } else if (deletedJobs && deletedJobs.length > 0) {
      console.log('[ai-products] 🗑️ Deleted', deletedJobs.length, 'existing mockup jobs before regenerating')
    }

    // Clean up existing mockup assets to prevent accumulation
    const { data: deletedMockups, error: deleteError } = await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', id)
      .eq('kind', 'mockup')
      .select('id')

    if (deleteError) {
      console.warn('[ai-products] ⚠️ Failed to delete existing mockups:', deleteError)
    } else if (deletedMockups && deletedMockups.length > 0) {
      console.log('[ai-products] 🗑️ Deleted', deletedMockups.length, 'existing mockup assets before regenerating')
    }

    // Get product to get category slug + the DTF settings saved at creation time.
    const { data: product } = await supabase
      .from('products')
      .select('category, metadata')
      .eq('id', id)
      .single()

    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Refresh the watermarked design copy alongside the mockups (fire-and-forget).
    {
      let designAsset: { id: string; url: string } | null = null
      if (selectedAssetId) {
        const { data } = await supabase
          .from('product_assets')
          .select('id, url')
          .eq('id', selectedAssetId)
          .single()
        if (data?.url) designAsset = data
      }
      if (!designAsset) {
        const { data } = await supabase
          .from('product_assets')
          .select('id, url')
          .eq('product_id', id)
          .eq('kind', 'source')
          .eq('is_primary', true)
          .limit(1)
          .maybeSingle()
        if (data?.url) designAsset = data
      }
      if (designAsset) void createWatermarkedDesignAsset(id, designAsset)
    }

    // Get image job for DTF settings. The admin builder creates these as
    // 'replicate_image_v2' (only the legacy worker used plain 'replicate_image'),
    // so we must match BOTH — otherwise the lookup returns null and every DTF
    // setting silently falls back to its default. That stale single-type filter
    // is exactly why a "white shirt" pick was getting mocked up on black.
    const { data: imageJob } = await supabase
      .from('ai_jobs')
      .select('input')
      .eq('product_id', id)
      .in('type', ['replicate_image', 'replicate_image_v2'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Product metadata is the authoritative source for DTF settings — every
    // create path (multi-model, deterministic text design, one-shot, bulk)
    // writes shirt_color / product_type / print_placement onto products.metadata.
    // The image job input is a secondary fallback for older rows; hard defaults last.
    const meta = (product.metadata as any) || {}
    const resolvedProductType = meta.product_type || imageJob?.input?.productType || 'tshirt'
    const resolvedShirtColor = meta.shirt_color || imageJob?.input?.shirtColor || 'black'
    const resolvedPrintPlacement = meta.print_placement || imageJob?.input?.printPlacement || 'front-center'
    const resolvedPrintSize = Number(meta.print_size_inches) || Number(imageJob?.input?.printSizeInches) || 11

    const baseInput = {
      product_type: product.category || 'shirts',
      productType: resolvedProductType,
      shirtColor: resolvedShirtColor,
      printPlacement: resolvedPrintPlacement,
      printSizeInches: resolvedPrintSize,
      selected_asset_id: selectedAssetId, // Pass selected asset to worker
    }

    console.log('[ai-products] 🎯 Mockup DTF settings:', {
      shirtColor: resolvedShirtColor,
      productType: resolvedProductType,
      printPlacement: resolvedPrintPlacement,
      selectedAssetId: selectedAssetId || 'none (will use fallback)',
    })

    // Create mockup jobs. Metal art gets size-accurate scene templates
    // (metal_shelf + metal_wall, scale-anchored to metadata.metal_size — David
    // 2026-07-28: a 4x6 must never be mocked up looking massive); garments get
    // flat_lay + ghost_mannequin + mr_imagine.
    const productCategory = product.category || 'shirts'
    const jobs: any[] = []
    if (productCategory === 'metal-art') {
      const metalSize = meta.metal_size === '8x10' ? '8x10' : '4x6'
      for (const template of ['metal_shelf', 'metal_wall']) {
        jobs.push({
          product_id: id,
          type: 'replicate_mockup_v2',
          status: 'queued',
          input: { ...baseInput, template, metalSize },
        })
      }
      console.log(`[ai-products] 🖼️ Metal-art mockup jobs (size ${metalSize}): metal_shelf + metal_wall`)
    } else {
      // Two-sided products render each side as its OWN job (mirrors the
      // /select-image fan-out — keep the two in lockstep).
      const isTwoSided = resolvedPrintPlacement === 'front-back'
      const frontPlacement = isTwoSided ? 'front-center' : resolvedPrintPlacement

      jobs.push({
        product_id: id,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: {
          ...baseInput,
          template: 'flat_lay',
          printPlacement: frontPlacement,
        },
      })

      // Add ghost mannequin job only for supported garment types
      const productType = resolvedProductType
      if (GHOST_MANNEQUIN_SUPPORTED_CATEGORIES.includes(productCategory) ||
          GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(productType)) {
        jobs.push({
          product_id: id,
          type: 'replicate_mockup_v2',  // Unified type - all mockups use replicate_mockup
          status: 'queued',
          input: {
            ...baseInput,
            template: 'ghost_mannequin',  // Template determines the mockup style
            printPlacement: frontPlacement,
          },
        })
        console.log('[ai-products] 👻 Adding ghost mannequin job for garment type:', productType)
      }

      // Mr. Imagine mockup — only for garment types that have a static
      // character base (polos don't; see MR_IMAGINE_SUPPORTED_PRODUCT_TYPES).
      if (MR_IMAGINE_SUPPORTED_PRODUCT_TYPES.includes(productType)) {
        jobs.push({
          product_id: id,
          type: 'replicate_mockup_v2',
          status: 'queued',
          input: {
            ...baseInput,
            template: 'mr_imagine',
            printPlacement: frontPlacement,
          },
        })
      }

      // Back view for two-sided products — mockupRole pins the asset role so
      // it never fights the front flat lay for the mockup_flat_lay slot.
      if (isTwoSided) {
        jobs.push({
          product_id: id,
          type: 'replicate_mockup_v2',
          status: 'queued',
          input: {
            ...baseInput,
            template: 'flat_lay',
            printPlacement: 'back-only',
            mockupRole: 'mockup_back',
          },
        })
        console.log('[ai-products] 🔄 Adding back-view mockup job (two-sided product)')
      }

      // Pocket shot (David 2026-08-09): customers can pick a left-chest pocket
      // print, and a front-scale mockup badly misrepresents what that looks
      // like. Same flat_lay template, rendered at pocket scale — the worker
      // gives it asset_role 'mockup_pocket' so it does NOT evict the front
      // flat_lay via the delete-by-role. Skipped when the product is ALREADY a
      // pocket print (the front shots are pocket-scale in that case) and when
      // the design is back-only.
      const alreadyPocketScale = resolvedPrintPlacement === 'left-pocket'
      const backOnly = resolvedPrintPlacement === 'back-only'
      if (!alreadyPocketScale && !backOnly) {
        jobs.push({
          product_id: id,
          type: 'replicate_mockup_v2',
          status: 'queued',
          input: {
            ...baseInput,
            template: 'flat_lay',
            printPlacement: 'left-pocket',
          },
        })
        console.log('[ai-products] 👕 Adding pocket-scale mockup job')
      }
    }

    console.log('[ai-products] 🎨 Creating mockup jobs:', jobs.map(j => ({ type: j.type, template: j.input?.template || j.type })))

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobs)
      .select()

    if (jobsError) {
      req.log?.error({ error: jobsError }, '[ai-products] ❌ Jobs creation error')
      return res.status(500).json({ error: 'Failed to create mockup jobs' })
    }

    console.log('[ai-products] ✅ Successfully created', createdJobs?.length, 'mockup jobs')
    req.log?.info({ count: createdJobs?.length }, '[ai-products] ✅ Mockup jobs created (flat_lay + ghost_mannequin + mr_imagine + pocket)')

    // Two real-person model shots (David 2026-08-09: "add the two mockups from
    // the etsy flow"). They run on their own async pipeline and mirror
    // themselves into product_assets when they pass QA, so they join the same
    // mockup set as the jobs above rather than living only on the Etsy panel.
    //
    // Fire-and-forget on purpose: the shoot takes far longer than this request,
    // and a shoot failure must not fail mockup creation. Garments only — the
    // shot plan casts people, which makes no sense for metal art.
    if (productCategory !== 'metal-art') {
      startModelShots(id, (req as any).user?.id || 'system')
        .then(() => console.log('[ai-products] 📸 model shots kicked off for', id))
        .catch((e: any) => console.warn('[ai-products] model shots did not start:', e?.message))
    }

    res.json({ jobs: createdJobs })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/duplicate
// Clone a product as a draft copy: fields, variants, tags, and asset rows
// (assets reference the same GCS files — no file copy needed).
router.post('/:id/duplicate', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()
    if (error || !product) return res.status(404).json({ error: 'Product not found' })

    const baseSlug = slugify(`${product.name} copy`)
    const { data: slugRows } = await supabase
      .from('products')
      .select('slug')
      .like('slug', `${baseSlug}%`)
    const slug = generateUniqueSlug(baseSlug, (slugRows || []).map((r: any) => r.slug))

    const { id: _oldId, created_at: _c, updated_at: _u, ...rest } = product
    const { data: newProduct, error: insErr } = await supabase
      .from('products')
      .insert({
        ...rest,
        name: `${product.name} (Copy)`,
        slug,
        status: 'draft',
        is_active: false,
        metadata: {
          ...(product.metadata || {}),
          duplicated_from: id,
          duplicated_at: new Date().toISOString(),
        },
      })
      .select()
      .single()
    if (insErr || !newProduct) {
      return res.status(500).json({ error: insErr?.message || 'Failed to insert copy' })
    }

    const copyChildRows = async (table: string) => {
      const { data: rows } = await supabase.from(table).select('*').eq('product_id', id)
      if (rows && rows.length > 0) {
        const clones = rows.map(({ id: _i, created_at: _cc, updated_at: _uu, ...r }: any) => ({
          ...r,
          product_id: newProduct.id,
        }))
        const { error: cErr } = await supabase.from(table).insert(clones)
        if (cErr) console.warn(`[ai-products] ⚠️ duplicate: ${table} copy failed:`, cErr.message)
      }
    }
    await copyChildRows('product_variants')
    await copyChildRows('product_tags')
    await copyChildRows('product_assets')

    req.log?.info({ from: id, to: newProduct.id }, '[ai-products] 📋 Product duplicated')
    return res.json({ product: newProduct })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Duplicate error')
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/jobs/:jobId/retry
// Reset a failed job so it runs again. Worker-processed types go back to
// 'queued' (the worker picks them up within one poll cycle); inline
// multi-model image jobs reprocess in this process.
router.post('/jobs/:jobId/retry', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { jobId } = req.params

    const { data: job, error } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('id', jobId)
      .single()
    if (error || !job) return res.status(404).json({ error: 'Job not found' })
    if (job.status !== 'failed') {
      return res.status(400).json({ error: `Only failed jobs can be retried (status: ${job.status})` })
    }

    const isInline = job.type === 'replicate_image_v2'
    const { data: updated, error: upErr } = await supabase
      .from('ai_jobs')
      .update({
        status: isInline ? 'running' : 'queued',
        error: null,
        prediction_id: null,
        output: { message: '🔁 Retrying…', retried_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single()
    if (upErr) return res.status(500).json({ error: upErr.message })

    if (isInline) {
      void processImageJobInline(updated).catch(async (e: any) => {
        await supabase
          .from('ai_jobs')
          .update({ status: 'failed', error: e.message || 'Retry failed', updated_at: new Date().toISOString() })
          .eq('id', jobId)
      })
    }

    req.log?.info({ jobId, type: job.type, inline: isInline }, '[ai-products] 🔁 Job retry queued')
    return res.json({ job: updated })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Job retry error')
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/select-image
// Select one or more of the generated candidates and trigger mockup
// generation. Thin wrapper — the multi-pick + sibling-clone + fan-out core
// lives in services/product-build.ts, SHARED with the creator studio, so
// there is exactly one build pipeline to maintain.
router.post('/:id/select-image', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { selectedAssetId, selectedAssetIds } = req.body
    const pickedIds: string[] = Array.isArray(selectedAssetIds) && selectedAssetIds.length > 0
      ? selectedAssetIds
      : [selectedAssetId]

    const result = await applyImageSelection({
      productId: id,
      pickedIds,
      actorId: (req as any).user?.id || 'system',
      log: req.log,
    })

    if (!result.ok) return res.status(result.status).json({ error: result.error })

    res.json({
      message: result.siblings.length > 0
        ? 'Image selected — building this product plus ' + result.siblings.length + ' more from your other pick' + (result.siblings.length > 1 ? 's' : '')
        : 'Image selected and mockup generation started',
      selectedAsset: result.selectedAsset,
      mockupJobs: result.createdJobs,
      siblings: result.siblings,
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})


// POST /api/admin/products/ai/:id/regenerate-images
// Regenerate images for an AI-generated product using stored metadata
// SHOULD-FIX #10 (2026-09-01 review): rate-limited like /one-shot — this
// triggers a real paid model call (Step Flow's "Try another" and the legacy
// regenerate path both do) and had no limiter at all.
router.post('/:id/regenerate-images', requireAuth, requireAdmin, rateLimitAI(10), async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params

    // Get product with metadata
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    if (!product.metadata?.ai_generated || !product.metadata?.image_prompt) {
      return res.status(400).json({ error: 'Product was not AI-generated or missing image prompt metadata' })
    }

    req.log?.info({ productId: id }, '[ai-products] 🔄 Regenerating images for product')

    // Step Flow "Try another" (David 2026-09-01): ONE more take on the same
    // single model with the same verbatim brief, processed inline exactly like
    // /create — never the 3-take house roster or a worker fan-out.
    const stepFlowMeta = product.metadata?.step_flow
    if (stepFlowMeta && typeof stepFlowMeta === 'object') {
      const priorJob = await supabase
        .from('ai_jobs')
        .select('input')
        .eq('product_id', product.id)
        .eq('type', 'replicate_image_v2')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const prior = (priorJob.data?.input ?? {}) as Record<string, unknown>
      const stepModelId = (typeof prior.modelId === 'string' && prior.modelId) || product.metadata.modelId || DEFAULT_GENERATE_MODEL
      const stepJob = {
        product_id: product.id,
        type: 'replicate_image_v2',
        status: 'running',
        input: {
          ...prior,
          prompt: product.metadata.image_prompt,
          width: 1024,
          height: 1024,
          modelId: stepModelId,
          forceSingleModel: true,
          multiModel: true,
          modelIds: [stepModelId],
          rawPrompt: true,
          nonce: Date.now().toString(36),
        },
      }
      const { data: stepJobs, error: stepErr } = await supabase.from('ai_jobs').insert([stepJob]).select()
      if (stepErr || !stepJobs?.[0]) {
        req.log?.error({ error: stepErr }, '[ai-products] ❌ Step Flow regen job creation error')
        return res.status(500).json({ error: 'Failed to create regeneration job' })
      }
      void processImageJobInline(stepJobs[0]).catch((err: any) => {
        req.log?.error({ error: err?.message ?? err, jobId: stepJobs[0].id }, '[ai-products] ❌ Step Flow regen failed')
      })
      req.log?.info({ jobId: stepJobs[0].id, model: stepModelId }, '[ai-products] ✅ Step Flow regeneration take started')
      return res.json({ job: stepJobs[0] })
    }

    // Create new image generation job using stored metadata
    const job = {
      product_id: product.id,
      type: 'replicate_image',
      status: 'queued',
      input: {
        prompt: product.metadata.image_prompt,
        width: 1024,
        height: 1024,
        background: product.metadata.background || 'transparent',
      },
    }

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert([job])
      .select()

    if (jobsError) {
      req.log?.error({ error: jobsError }, '[ai-products] ❌ Job creation error')
      return res.status(500).json({ error: 'Failed to create regeneration job' })
    }

    req.log?.info({ jobId: createdJobs[0].id }, '[ai-products] ✅ Regeneration job created')

    res.json({ job: createdJobs[0] })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/generate-text - Generate GPT name/description for existing product
router.post('/:id/generate-text', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { prompt } = req.body // Optional custom prompt, otherwise use existing metadata

    console.log('[ai-products] 🤖 generate-text called for product:', id)
    req.log?.info({ productId: id, prompt }, '[ai-products] 🤖 Generating text for product')

    // Fetch the product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Determine the prompt to use
    const textPrompt = prompt || product.metadata?.original_prompt || product.metadata?.image_prompt || product.name || 'Custom design'

    // Generate normalized product text using GPT
    const normalized = await normalizeProduct({
      prompt: textPrompt,
      priceTarget: Math.round((product.price || 25) * 100),
      imageStyle: product.metadata?.image_style || 'semi-realistic',
    })

    req.log?.info({
      productId: id,
      newTitle: normalized.title,
      newDescription: normalized.description
    }, '[ai-products] ✅ Generated text')

    // Return the generated text without saving (let frontend decide)
    res.json({
      title: normalized.title,
      description: normalized.description,
      summary: normalized.summary,
      tags: normalized.tags,
      seo_title: normalized.seo_title,
      seo_description: normalized.seo_description,
    })
  } catch (error: any) {
    console.error('[ai-products] ❌ Error generating text:', error)
    req.log?.error({ error }, '[ai-products] ❌ Error generating text')
    res.status(500).json({ error: error.message })
  }
})

export default router
