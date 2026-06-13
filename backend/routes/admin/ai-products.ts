import { Router, Request, Response, NextFunction } from 'express'
import Replicate from 'replicate'
import OpenAI from 'openai'
import { supabase } from '../../lib/supabase.js'
import { normalizeProduct } from '../../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../../utils/slugify.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { searchForContext } from '../../services/serpapi-search.js'
import { getPrediction, AVAILABLE_MODELS, GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../../services/replicate.js'
import { runImageFlowMultiGenerate } from '../../services/image-flow/worker-helpers.js'
import { uploadImageFromUrl, uploadImageFromBase64, uploadImageFromBuffer } from '../../services/google-cloud-storage.js'
import { addWatermark } from '../../services/watermark.js'

const replicateClient = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! })
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

/**
 * Gallery contract slot 4: a watermarked copy of the chosen design for
 * storefront display — the raw design never ships unprotected. Exactly one
 * per product (replaces any prior design_watermarked asset).
 */
async function createWatermarkedDesignAsset(
  productId: string,
  sourceAsset: { id: string; url: string },
): Promise<void> {
  try {
    const watermarked = await addWatermark(sourceAsset.url)
    const { data: product } = await supabase
      .from('products')
      .select('slug')
      .eq('id', productId)
      .single()
    const slug = product?.slug || productId.substring(0, 8)
    const gcsPath = `graphics/${slug}/watermarked/${slug}-design-watermarked-${Date.now()}.png`
    const { publicUrl, path } = await uploadImageFromBuffer(watermarked, gcsPath, 'image/png')

    await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', productId)
      .eq('asset_role', 'design_watermarked')

    const { error } = await supabase.from('product_assets').insert({
      product_id: productId,
      kind: 'design_preview',
      path,
      url: publicUrl,
      asset_role: 'design_watermarked',
      is_primary: false,
      display_order: 4,
      metadata: {
        parent_asset_id: sourceAsset.id,
        watermarked_at: new Date().toISOString(),
      },
    })
    if (error) throw new Error(error.message)
    console.log('[ai-products] 🔒 Watermarked design asset created for product:', productId)
  } catch (err: any) {
    console.error('[ai-products] ⚠️ Watermarked design asset failed:', err.message)
  }
}

/**
 * Process a multi-model image job inline (in the API process) instead of via the worker queue.
 * Avoids the race condition where the production worker (running old code) grabs queued jobs.
 */
async function processImageJobInline(job: any): Promise<void> {
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
    await updateProgress('🧠 Tailoring your prompt per model, then generating with the 4 best-fit models in parallel...', 1, 3)
    const results = await runImageFlowMultiGenerate({
      prompt: promptInput,
      category: product?.category ?? job.input?.category,
      shirtColor: job.input?.shirtColor,
      printStyle: job.input?.printStyle,
      imageStyle: job.input?.imageStyle,
    })

    const succeeded = results.filter((r) => r.status === 'succeeded' && r.url)
    console.log('[ai-products] 🎨 Multi-model results:', results.map((r) => `${r.modelLabel}=${r.status}`).join(', '))

    if (succeeded.length === 0) {
      const errs = results.map((r) => `${r.modelLabel}: ${r.error}`).join('; ')
      throw new Error(`All ${results.length} models failed: ${errs}`)
    }

    await updateProgress(`📤 Uploading ${succeeded.length} variants to cloud storage...`, 2, 3)

    for (const r of succeeded) {
      try {
        const ts = Date.now()
        const safeModel = r.modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
        const filename = `${productSlug}-${safeModel}-${ts}.png`
        const gcsPath = `graphics/${productSlug}/original/${filename}`
        const { publicUrl, path: storagePath } = await uploadImageFromUrl(r.url!, gcsPath)
        await supabase.from('product_assets').insert({
          product_id: job.product_id,
          kind: 'source',
          path: storagePath,
          url: publicUrl,
          width: 1024,
          height: 1024,
          asset_role: 'design',
          is_primary: false,
          display_order: 99,
          metadata: {
            model_id: r.modelId,
            model_name: r.modelLabel,
            provider: 'replicate',
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

// GET /api/admin/products/ai/models - Get available image generation models
router.get('/models', requireAuth, async (req: Request, res: Response): Promise<any> => {
  res.json({
    models: AVAILABLE_MODELS,
    default: AVAILABLE_MODELS[0].id
  })
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
      // DTF Print Settings
      productType = 'tshirt',
      shirtColor = 'black',
      printPlacement = 'front-center',
      printStyle = 'clean',
      // Model Selection - defaults to GPT Image 2 (image-flow)
      modelId = 'openai/gpt-image-2'
    } = req.body

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    req.log?.info({ prompt, useSearch }, '[ai-products] 🚀 Creating product from prompt')

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
      // DTF settings for context
      productType,
      shirtColor,
      printPlacement,
    })

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
          // DTF Print Settings
          product_type: productType,
          shirt_color: shirtColor,
          print_placement: printPlacement,
          print_style: printStyle,
          // Model used for image generation
          model_id: modelId,
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
          width: 1024,
          height: 1024,
          background: normalized.background,
          productType,
          shirtColor,
          printPlacement,
          printStyle,
          imageStyle,
          modelId,
          multiModel: true, // fan out to ADMIN_MULTI_MODEL_IDS
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
      category: productType === 'tshirt' ? 't-shirts' : productType,
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

  // Note: OpenAI's images.generate doesn't accept `background: 'transparent'`
  // for gpt-image-2 — returns "400 Transparent background is not supported for
  // this model." The transparent-bg constraint is enforced via the prompt text
  // itself (buildDtfPrompt → "isolated artwork on transparent background").
  let response: any
  let usedModel = 'gpt-image-2'
  try {
    response = await openaiClient.images.generate({
      model: 'gpt-image-2',
      prompt: dtfSystemPrompt,
      size: '1024x1024',
      quality: 'high',
      n: 1,
    } as any)
  } catch (err: any) {
    const msg = err?.error?.message || err?.message || ''
    // Fall back to gpt-image-1 if 2 isn't accessible (model-not-found,
    // pre-release access required, etc).
    if (/gpt-image-2|model.*not.*found|does not exist|invalid model/i.test(msg)) {
      console.warn('[ai-products/one-shot] gpt-image-2 unavailable, falling back to gpt-image-1:', msg)
      response = await openaiClient.images.generate({
        model: 'gpt-image-1',
        prompt: dtfSystemPrompt,
        size: '1024x1024',
        quality: 'high',
        n: 1,
      } as any)
      usedModel = 'gpt-image-1'
    } else {
      throw err
    }
  }

  const item = response?.data?.[0]
  if (!item?.b64_json) throw new Error('OpenAI images.generate returned no b64_json payload')

  const dataUrl = `data:image/png;base64,${item.b64_json}`
  const objectPath = `ai-products/one-shot/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const { publicUrl: gcsUrl } = await uploadImageFromBase64(dataUrl, objectPath)

  return saveDraftProductRow({
    prompt,
    productType,
    shirtColor,
    gcsUrl,
    modelId: `openai/${usedModel}`,
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

    // Get product to get category slug
    const { data: product } = await supabase
      .from('products')
      .select('category')
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

    // Get image job for DTF settings
    const { data: imageJob } = await supabase
      .from('ai_jobs')
      .select('input')
      .eq('product_id', id)
      .eq('type', 'replicate_image')
      .single()

    const baseInput = {
      product_type: product.category || 'shirts',
      productType: imageJob?.input?.productType || 'tshirt',
      shirtColor: imageJob?.input?.shirtColor || 'black',
      printPlacement: imageJob?.input?.printPlacement || 'front-center',
      selected_asset_id: selectedAssetId, // Pass selected asset to worker
    }

    console.log('[ai-products] 🎯 Using selected asset for mockups:', selectedAssetId || 'none (will use fallback)')

    // Create mockup jobs: flat_lay + ghost_mannequin (for garments) + mr_imagine
    const jobs: any[] = [
      {
        product_id: id,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: {
          ...baseInput,
          template: 'flat_lay',
        },
      },
    ]

    // Add ghost mannequin job only for supported garment types
    const productCategory = product.category || 'shirts'
    const productType = imageJob?.input?.productType || 'tshirt'
    if (GHOST_MANNEQUIN_SUPPORTED_CATEGORIES.includes(productCategory) ||
        GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(productType)) {
      jobs.push({
        product_id: id,
        type: 'replicate_mockup_v2',  // Unified type - all mockups use replicate_mockup
        status: 'queued',
        input: {
          ...baseInput,
          template: 'ghost_mannequin',  // Template determines the mockup style
        },
      })
      console.log('[ai-products] 👻 Adding ghost mannequin job for garment type:', productType)
    }

    // Always add Mr. Imagine mockup
    jobs.push({
      product_id: id,
      type: 'replicate_mockup_v2',
      status: 'queued',
      input: {
        ...baseInput,
        template: 'mr_imagine',
      },
    })

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
    req.log?.info({ count: createdJobs?.length }, '[ai-products] ✅ Mockup jobs created (flat_lay + ghost_mannequin + mr_imagine)')

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
// Select an image from the 3 generated options and trigger mockup generation
router.post('/:id/select-image', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { selectedAssetId } = req.body

    if (!selectedAssetId) {
      return res.status(400).json({ error: 'selectedAssetId is required' })
    }

    req.log?.info({ productId: id, selectedAssetId }, '[ai-products] 🎨 User selected image')

    // Get the selected asset
    const { data: selectedAsset, error: assetError } = await supabase
      .from('product_assets')
      .select('*')
      .eq('id', selectedAssetId)
      .eq('product_id', id)
      .single()

    if (assetError || !selectedAsset) {
      return res.status(404).json({ error: 'Selected asset not found' })
    }

    // Mark the selected asset as primary with explicit fields
    await supabase
      .from('product_assets')
      .update({
        is_primary: true,
        asset_role: 'design',
        display_order: 1,
        metadata: {
          ...selectedAsset.metadata,
          is_selected: true,
          selected_at: new Date().toISOString()
        }
      })
      .eq('id', selectedAssetId)

    // Watermarked design copy for the storefront gallery (fire-and-forget —
    // it's ready long before the admin reaches Approve).
    void createWatermarkedDesignAsset(id, { id: selectedAsset.id, url: selectedAsset.url })

    // DELETE non-selected source and DTF images
    // Keep: selected source asset + its corresponding DTF asset (matching model_id)
    // Delete: other source assets + their DTF assets
    console.log('[ai-products] 🗑️ Deleting non-selected assets for product:', id, '(keeping selected:', selectedAssetId, ')')

    // Get the model_id from the selected asset to match with DTF
    const selectedModelId = selectedAsset.metadata?.model_id

    // Get all source and DTF assets for this product
    const { data: allAssets } = await supabase
      .from('product_assets')
      .select('id, kind, metadata')
      .eq('product_id', id)
      .in('kind', ['source', 'dtf'])

    // Find IDs to delete (not selected source, and not DTF matching selected model)
    const idsToDelete = (allAssets || [])
      .filter(asset => {
        // Keep the selected source asset
        if (asset.id === selectedAssetId) return false
        // Keep the DTF asset that matches the selected source's model
        if (asset.kind === 'dtf' && asset.metadata?.model_id === selectedModelId) return false
        // Delete everything else
        return true
      })
      .map(a => a.id)

    if (idsToDelete.length > 0) {
      const { data: deletedAssets, error: deleteError } = await supabase
        .from('product_assets')
        .delete()
        .in('id', idsToDelete)
        .select('id')

      if (deleteError) {
        console.error('[ai-products] ❌ Failed to delete non-selected assets:', deleteError)
        req.log?.warn({ error: deleteError }, '[ai-products] ⚠️ Failed to delete non-selected assets')
      } else {
        console.log('[ai-products] ✅ Deleted', deletedAssets?.length || 0, 'non-selected assets:', deletedAssets?.map(a => a.id))
        req.log?.info({ deletedCount: deletedAssets?.length || 0 }, '[ai-products] 🗑️ Deleted non-selected assets')
      }
    } else {
      console.log('[ai-products] ℹ️ No non-selected assets to delete')
    }

    // Clean up ALL existing mockup JOBS (including succeeded) to prevent duplicate generation
    const { data: deletedMockupJobs, error: deleteMockupJobsError } = await supabase
      .from('ai_jobs')
      .delete()
      .eq('product_id', id)
      .in('type', ['replicate_mockup', 'replicate_mockup_v2'])  // delete BOTH legacy + v2 (clears prod-orphan dupes)
      .select('id')

    if (deleteMockupJobsError) {
      console.warn('[ai-products] ⚠️ Failed to delete existing mockup jobs:', deleteMockupJobsError)
    } else if (deletedMockupJobs && deletedMockupJobs.length > 0) {
      console.log('[ai-products] 🗑️ Deleted', deletedMockupJobs.length, 'existing mockup jobs before regenerating')
    }

    // Clean up existing mockup assets to prevent accumulation
    const { data: deletedMockupsSelect, error: deleteMockupsError } = await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', id)
      .eq('kind', 'mockup')
      .select('id')

    if (deleteMockupsError) {
      console.warn('[ai-products] ⚠️ Failed to delete existing mockups:', deleteMockupsError)
    } else if (deletedMockupsSelect && deletedMockupsSelect.length > 0) {
      console.log('[ai-products] 🗑️ Deleted', deletedMockupsSelect.length, 'existing mockup assets before regenerating')
    }

    // Get the image generation job to extract DTF settings
    const { data: imageJob } = await supabase
      .from('ai_jobs')
      .select('input')
      .eq('product_id', id)
      .eq('type', 'replicate_image')
      .single()

    // Get product category
    const { data: product } = await supabase
      .from('products')
      .select('category')
      .eq('id', id)
      .single()

    // Create THREE mockup jobs:
    // 1. Flat lay mockup (shirt on surface)
    // 2. Ghost mannequin mockup (invisible mannequin) - only for garments
    // 3. Mr. Imagine mockup (mascot wearing shirt)
    const baseInput = {
      product_type: product?.category || 'shirts',
      productType: imageJob?.input?.productType || 'tshirt',
      shirtColor: imageJob?.input?.shirtColor || 'black',
      printPlacement: imageJob?.input?.printPlacement || 'front-center',
      selected_asset_id: selectedAssetId,
    }

    const mockupJobs: any[] = [
      {
        product_id: id,
        type: 'replicate_mockup_v2',
        status: 'queued',
        input: {
          ...baseInput,
          template: 'flat_lay',
        },
      },
    ]

    // Add ghost mannequin job only for supported garment types
    const productCategory = product?.category || 'shirts'
    const productType = imageJob?.input?.productType || 'tshirt'
    if (GHOST_MANNEQUIN_SUPPORTED_CATEGORIES.includes(productCategory) ||
        GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(productType)) {
      mockupJobs.push({
        product_id: id,
        type: 'replicate_mockup_v2',  // Unified type - all mockups use replicate_mockup
        status: 'queued',
        input: {
          ...baseInput,
          template: 'ghost_mannequin',  // Template determines the mockup style
        },
      })
      console.log('[ai-products] 👻 Adding ghost mannequin job for garment type:', productType)
    }

    // Always add Mr. Imagine mockup
    mockupJobs.push({
      product_id: id,
      type: 'replicate_mockup_v2',
      status: 'queued',
      input: {
        ...baseInput,
        template: 'mr_imagine',
      },
    })

    console.log('[ai-products] 🎨 Creating mockup jobs:', mockupJobs.map(j => ({ type: j.type, template: j.input?.template || j.type })))

    const { data: createdJobs, error: jobError } = await supabase
      .from('ai_jobs')
      .insert(mockupJobs)
      .select()

    if (jobError) {
      console.error('[ai-products] ❌ Mockup job creation error:', jobError)
      req.log?.error({ error: jobError }, '[ai-products] ❌ Mockup job creation error')
      return res.status(500).json({ error: 'Failed to create mockup jobs' })
    }

    console.log('[ai-products] ✅ Successfully created', createdJobs?.length, 'mockup jobs:', createdJobs?.map(j => ({ id: j.id, type: j.type, template: j.input?.template })))
    req.log?.info({ jobCount: createdJobs?.length }, '[ai-products] ✅ Mockup jobs created (flat_lay + ghost_mannequin + mr_imagine)')

    res.json({
      message: 'Image selected and mockup generation started',
      selectedAsset,
      mockupJobs: createdJobs
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/regenerate-images
// Regenerate images for an AI-generated product using stored metadata
router.post('/:id/regenerate-images', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
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
