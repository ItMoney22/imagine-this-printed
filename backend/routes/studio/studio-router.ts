/**
 * The studio router — Mr. Imagine's live voice build flow, as a FACTORY.
 *
 * One implementation, mounted once per lane (backend/routes/creator-studio.ts,
 * backend/routes/customer-studio.ts). It was a single creator-only file until
 * David 2026-09-03: "copy our step flow for AI Product builder ... i want to
 * pass that on to our customers in the My Design tab ... minus the etsy flow at
 * the end". Copying the file would have left two 700-line rails to keep in
 * sync; the differences are all data, so they became a config.
 *
 * What every lane shares, and must keep sharing:
 *   - requireAuth, plus whatever extra gate the lane declares
 *   - every product scoped to created_by_user_id = the caller
 *   - ITC metered off the imagination_pricing table (the same wallet rail the
 *     Imagination Station uses), NOT unmetered admin spend
 *   - the finale is SUBMIT FOR REVIEW (pending_approval), never a direct publish
 *   - the build pipeline is the shared services/product-build.ts, the exact
 *     code the admin builder runs
 *
 * What a lane chooses: its gate, whether the real-person model shoot runs,
 * its categories, its ITC ledger prefix, Mr. Imagine's brief, and his voice.
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express'
import multer from 'multer'
import OpenAI from 'openai'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { normalizeProduct } from '../../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../../utils/slugify.js'
import { applyImageSelection } from '../../services/product-build.js'
import { processImageJobInline } from '../admin/ai-products.js'
import { pricingService } from '../../services/imagination-pricing.js'
import { transcribeAudio } from '../../services/transcribe.js'
import { generateConversationalResponse, EMOTIONS } from '../../services/voiceGenerator.js'
import { uploadImageFromBuffer } from '../../services/google-cloud-storage.js'

export interface StudioLaneConfig {
  /** Short lane id. Namespaces the rate-limit buckets and the audio uploads. */
  key: string
  /** Prefix on every log line, e.g. '[creator-studio]'. */
  logPrefix: string
  /** Extra middleware after requireAuth. Empty means any signed-in user. */
  gate: RequestHandler[]
  /**
   * Run the real-person model shoot (services/etsy-model-shots.ts) after a
   * build. It is the Etsy listing pipeline: expensive, slow, and aimed at a
   * marketplace listing rather than at the person who just made the thing.
   */
  modelShots: boolean
  /** Categories this lane may build. */
  categories: readonly string[]
  /** products.metadata flag stamped on everything this lane creates. */
  metadataFlag: string
  /** Prefix for itc_transactions references, e.g. 'creator_studio'. */
  itcPrefix: string
  /** Env var naming the per-request pick ceiling. */
  maxPicksEnv: string
  /** Mr. Imagine's system prompt for this lane. */
  systemPrompt: string
  /**
   * Fallback product type, used when he locks a brief without ever having
   * called set_product_type. See the guard in /turn.
   */
  defaultLane: string
  /** MiniMax voice id he speaks in. */
  voiceId: string
  /**
   * Refuse a conversational turn below this wallet balance.
   *
   * A turn is transcription + a chat model + speech synthesis: it costs the
   * business real money and charges the person nothing, which is fine for a
   * gated lane and an open invitation on an ungated one. Requiring enough
   * credits to actually build something means the people talking to him are
   * the people who can finish. Omit for no floor.
   */
  minBalanceToTalk?: number
}


// ---------------------------------------------------------------------------
// Rate limiting — in-memory per-user, same pattern as the admin builder's
// rateLimitAI. Creators get tighter caps than admins.
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>()
function rateLimit(lane: string, maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${lane}:${(req as any).user?.id || req.ip}`
    const windowStart = Date.now() - 60_000
    const hits = (buckets.get(key) || []).filter((t) => t > windowStart)
    if (hits.length >= maxPerMinute) {
      res.status(429).json({ error: `Easy there — max ${maxPerMinute} of those per minute.` })
      return
    }
    hits.push(Date.now())
    buckets.set(key, hits)
    next()
  }
}

// ---------------------------------------------------------------------------
// ITC metering — priced off the same imagination_pricing table the station
// uses ('generate' = one image). The studio fan-out paints 4 candidates, and
// a build (mockups + model shoot) is ~5 renders + QA, so both are multiples
// of the single-image price. Env-tunable without a deploy of the pricing row.
// ---------------------------------------------------------------------------
const FANOUT_MULTIPLIER = Number(process.env.CREATOR_STUDIO_FANOUT_MULTIPLIER) || 4
const BUILD_MULTIPLIER = Number(process.env.CREATOR_STUDIO_BUILD_MULTIPLIER) || 5

async function perImageCost(): Promise<number> {
  try {
    const pricing = await pricingService.getPricing('generate')
    const cost = Number(pricing?.current_cost)
    if (Number.isFinite(cost) && cost > 0) return cost
  } catch { /* fall through to default */ }
  return 10
}

async function walletBalance(userId: string): Promise<number> {
  const { data } = await supabase.from('user_wallets').select('itc_balance').eq('user_id', userId).single()
  return Number(data?.itc_balance) || 0
}

/** Load a studio product ONLY if the caller owns it. */
async function ownedProduct(productId: string, userId: string) {
  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('created_by_user_id', userId)
    .maybeSingle()
  return data || null
}

// NOTE: this lane deliberately has NO xAI realtime token endpoint.
// It was removed 2026-08-11 — realtime bills per wall-clock minute and the
// browser holds the socket directly, so once a token was minted the server
// could not cap session length, concurrency, or minutes for a pool of users
// that is "anyone who signed up". Creators talk to Mr. Imagine through
// POST /turn below instead: per-utterance cost, server in the middle of every
// turn, idle time free. The ADMIN studio keeps realtime (routes/ai/realtime.ts),
// where the pool is a handful of trusted staff.

export function createStudioRouter(cfg: StudioLaneConfig): Router {
  const router = Router()

  // GET /api/creator/studio/pricing — what the studio will charge, so the page
  // (and Mr. Imagine) can say costs before spending.
  router.get('/pricing', requireAuth, ...cfg.gate, async (req: Request, res: Response): Promise<any> => {
    const per = await perImageCost()
    return res.json({
      generate: per * FANOUT_MULTIPLIER,
      buildPerProduct: per * BUILD_MULTIPLIER,
      balance: await walletBalance((req as any).user?.id),
    })
  })

  // POST /api/creator/studio/create — normalize the brief, insert the creator's
  // draft product, charge ITC, and fire the 4-model design fan-out.
  router.post('/create', requireAuth, ...cfg.gate, rateLimit(cfg.key, 3), async (req: Request, res: Response): Promise<any> => {
    const userId = (req as any).user?.id
    let charged = 0
    try {
      const {
        prompt,
        category: requestedCategory,
        productType = 'tshirt',
        shirtColor = 'black',
        printPlacement = 'front-center',
        printSizeInches = 11,
        metalSize,
        style,
        tone,
      } = req.body

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
        return res.status(400).json({ error: 'Tell me what we are making first (prompt required).' })
      }
      const category = cfg.categories.includes(requestedCategory) ? requestedCategory : 'shirts'

      // Charge BEFORE the spend; refunded by the status endpoint if the whole
      // fan-out fails (see /:id/status).
      const cost = (await perImageCost()) * FANOUT_MULTIPLIER
      const balance = await walletBalance(userId)
      if (balance < cost) {
        return res.status(402).json({ error: `That needs ${cost} ITC and you have ${Math.floor(balance)}. Top up in your Wallet.`, needed: cost, balance })
      }
      await pricingService.deductITC(userId, cost, `${cfg.itcPrefix}_generate`)
      charged = cost

      const fullPrompt = [prompt.trim(), style ? `Style: ${style}.` : '', tone ? `Mood: ${tone}.` : ''].filter(Boolean).join(' ')
      const normalized = await normalizeProduct({
        prompt: fullPrompt,
        category,
        productType,
        shirtColor,
        printPlacement,
      })
      normalized.category_slug = category
      const KNOWN_NAMES: Record<string, string> = { shirts: 'Shirts', hoodies: 'Hoodies', 'metal-art': 'Metal Art' }
      normalized.category_name = KNOWN_NAMES[category] || normalized.category_name

      const { data: categoryRow, error: catError } = await supabase
        .from('product_categories')
        .upsert({ slug: normalized.category_slug, name: normalized.category_name }, { onConflict: 'slug' })
        .select()
        .single()
      if (catError) {
        await pricingService.refundITC(userId, charged, `${cfg.itcPrefix}_generate_failed`)
        return res.status(500).json({ error: 'Could not set up the product category' })
      }

      const baseSlug = slugify(normalized.title)
      const { data: slugRows } = await supabase.from('products').select('slug').like('slug', `${baseSlug}%`)
      const uniqueSlug = generateUniqueSlug(baseSlug, (slugRows || []).map((p: any) => p.slug).filter(Boolean))

      const PLACEMENT_DEFAULT_LOCATIONS: Record<string, string[]> = {
        'front-center': ['front_image'],
        'left-pocket': ['pocket'],
        'back-only': ['back_image'],
        'front-back': ['front_image', 'back_image'],
        'pocket-front-back-full': ['pocket', 'back_image'],
      }

      const { data: product, error: productError } = await supabase
        .from('products')
        .insert({
          category_id: categoryRow.id,
          name: normalized.title,
          slug: uniqueSlug,
          description: normalized.description,
          price: normalized.suggested_price_cents < 100
            ? normalized.suggested_price_cents
            : normalized.suggested_price_cents / 100,
          status: 'draft',
          is_active: false,
          images: [],
          category: normalized.category_slug,
          ...(category === 'shirts' ? { print_locations: PLACEMENT_DEFAULT_LOCATIONS[printPlacement] || ['front_image'] } : {}),
          created_by_user_id: userId,
          is_user_generated: true,
          metadata: {
            ai_generated: true,
            [cfg.metadataFlag]: true,
            creator_id: userId,
            original_prompt: prompt,
            image_prompt: normalized.image_prompt,
            product_type: productType,
            shirt_color: shirtColor,
            print_placement: printPlacement,
            print_style: 'clean',
            ...(category === 'metal-art'
              ? { metal_size: metalSize === '8x10' ? '8x10' : '4x6' }
              : { print_size_inches: Math.min(16, Math.max(3, Math.round(Number(printSizeInches) || 11))) }),
          },
        })
        .select()
        .single()

      if (productError || !product) {
        await pricingService.refundITC(userId, charged, `${cfg.itcPrefix}_generate_failed`)
        req.log?.error({ error: productError }, `${cfg.logPrefix} ❌ product insert failed`)
        return res.status(500).json({ error: 'Could not create the product draft' })
      }

      const { data: createdJobs, error: jobsError } = await supabase
        .from('ai_jobs')
        .insert([{
          product_id: product.id,
          type: 'replicate_image_v2',
          status: 'running', // pre-claimed so the prod worker can't race the inline processor
          input: {
            prompt: normalized.image_prompt,
            width: 1024,
            height: 1024,
            productType,
            shirtColor,
            printPlacement,
            printSizeInches,
            multiModel: true,
            itcCharged: cost, // read by /:id/status to refund a total failure
          },
        }])
        .select()

      if (jobsError || !createdJobs?.length) {
        await pricingService.refundITC(userId, charged, `${cfg.itcPrefix}_generate_failed`)
        req.log?.error({ error: jobsError }, `${cfg.logPrefix} ❌ job insert failed`)
        return res.status(500).json({ error: 'Could not start generation' })
      }

      void processImageJobInline(createdJobs[0]).catch((err: any) => {
        req.log?.error({ jobId: createdJobs[0].id, err: err?.message }, `${cfg.logPrefix} ❌ inline job failed`)
      })

      req.log?.info({ productId: product.id, userId, cost }, `${cfg.logPrefix} 🎨 creator build started`)
      return res.json({ productId: product.id, product: { ...product, normalized }, jobs: createdJobs, itcCharged: cost })
    } catch (error: any) {
      if (charged > 0) {
        await pricingService.refundITC(userId, charged, `${cfg.itcPrefix}_generate_failed`).catch(() => {})
      }
      req.log?.error({ error }, `${cfg.logPrefix} ❌ create failed`)
      return res.status(500).json({ error: error.message || 'Create failed' })
    }
  })

  // GET /api/creator/studio/:id/status — owner-scoped build state. Also the
  // refund point: a totally-failed fan-out gives the ITC back exactly once.
  router.get('/:id/status', requireAuth, ...cfg.gate, async (req: Request, res: Response): Promise<any> => {
    try {
      const userId = (req as any).user?.id
      const product = await ownedProduct(req.params.id, userId)
      if (!product) return res.status(404).json({ error: 'Product not found' })

      const { data: assets } = await supabase
        .from('product_assets')
        .select('*')
        .eq('product_id', product.id)

      const { data: jobs } = await supabase
        .from('ai_jobs')
        .select('*')
        .eq('product_id', product.id)
        .order('created_at', { ascending: true })

      // Refund a total generation failure (all four models died) exactly once.
      // The .is() filter makes the update a no-op if another poll already
      // claimed the refund.
      for (const job of jobs || []) {
        const itcCharged = Number(job.input?.itcCharged)
        if (job.status === 'failed' && itcCharged > 0 && !job.output?.itc_refunded) {
          const { data: claimed } = await supabase
            .from('ai_jobs')
            .update({ output: { ...(job.output || {}), itc_refunded: true } })
            .eq('id', job.id)
            .is('output->>itc_refunded', null)
            .select('id')
          if (claimed && claimed.length > 0) {
            await pricingService.refundITC(userId, itcCharged, `${cfg.itcPrefix}_job_${job.id}`)
            req.log?.info({ jobId: job.id, itcCharged }, `${cfg.logPrefix} 💸 refunded failed generation`)
          }
        }
      }

      return res.json({ product, assets: assets || [], jobs: jobs || [] })
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Status failed' })
    }
  })

  // POST /api/creator/studio/:id/select-image — multi-pick; runs the SHARED
  // build pipeline (mockups + model shoot, sibling product per extra pick).
  router.post('/:id/select-image', requireAuth, ...cfg.gate, rateLimit(cfg.key, 6), async (req: Request, res: Response): Promise<any> => {
    const userId = (req as any).user?.id
    let charged = 0
    try {
      const product = await ownedProduct(req.params.id, userId)
      if (!product) return res.status(404).json({ error: 'Product not found' })

      // Replay guard: every call fires 4-6 Replicate renders per pick plus a
      // model shoot, and nothing about the product changes in a way that would
      // make a second identical call fail — so without this, the endpoint is a
      // repeatable render bomb. A rebuild has to start from a fresh generation.
      if (product.status === 'pending_approval' || product.status === 'active') {
        return res.status(409).json({ error: 'This product has already been submitted.', code: 'already_submitted' })
      }
      const { data: builtAlready } = await supabase
        .from('product_assets')
        .select('id')
        .eq('product_id', product.id)
        .eq('kind', 'mockup')
        .limit(1)
      if (builtAlready && builtAlready.length > 0) {
        return res.status(409).json({ error: 'This design is already built — generate fresh designs to build again.', code: 'already_built' })
      }

      const { selectedAssetId, selectedAssetIds } = req.body
      const pickedIds: string[] = Array.from(new Set(
        (Array.isArray(selectedAssetIds) && selectedAssetIds.length > 0 ? selectedAssetIds : [selectedAssetId])
          .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
      ))
      if (pickedIds.length === 0) return res.status(400).json({ error: 'Pick at least one design' })
      // Hard ceiling: each pick spawns a whole product with its own render
      // fan-out and model shoot, all inside this one request.
      const MAX_PICKS = Number(process.env[cfg.maxPicksEnv]) || 4
      if (pickedIds.length > MAX_PICKS) {
        return res.status(400).json({ error: `You can build up to ${MAX_PICKS} designs at once.` })
      }

      // Each picked design becomes its own product with its own full mockup
      // fan-out + model shoot, so the build charge is per pick.
      const cost = (await perImageCost()) * BUILD_MULTIPLIER * pickedIds.length
      const balance = await walletBalance(userId)
      if (balance < cost) {
        return res.status(402).json({ error: `Building ${pickedIds.length} product${pickedIds.length > 1 ? 's' : ''} needs ${cost} ITC and you have ${Math.floor(balance)}. Top up in your Wallet.`, needed: cost, balance })
      }
      await pricingService.deductITC(userId, cost, `${cfg.itcPrefix}_build`)
      charged = cost

      const result = await applyImageSelection({
        productId: product.id,
        pickedIds,
        actorId: userId,
        log: req.log,
        modelShots: cfg.modelShots,
      })

      if (!result.ok) {
        await pricingService.refundITC(userId, charged, `${cfg.itcPrefix}_build_failed`)
        return res.status(result.status).json({ error: result.error })
      }

      return res.json({
        message: result.siblings.length > 0
          ? `Building this product plus ${result.siblings.length} more from your other pick${result.siblings.length > 1 ? 's' : ''}`
          : cfg.modelShots ? 'Mockups and model shots are rendering' : 'Your product shots are rendering',
        selectedAsset: result.selectedAsset,
        mockupJobs: result.createdJobs,
        siblings: result.siblings,
        itcCharged: cost,
      })
    } catch (error: any) {
      if (charged > 0) {
        await pricingService.refundITC(userId, charged, `${cfg.itcPrefix}_build_failed`).catch(() => {})
      }
      req.log?.error({ error }, `${cfg.logPrefix} ❌ select failed`)
      return res.status(500).json({ error: error.message || 'Selection failed' })
    }
  })

  // Server-side mirror of the frontend gallery contract (src/lib/product-gallery.ts):
  // one image per role, in this order. Kept minimal on purpose — the submit only
  // needs a sane images[] for the approval queue and the storefront.
  const SUBMIT_ROLE_ORDER = [
    'mockup_ghost_mannequin',
    'mockup_flat_lay',
    'mockup_back',
    'mockup_mr_imagine',
    'mockup_model_1',
    'mockup_model_2',
    'mockup_pocket',
    'design_watermarked',
  ]

  // POST /api/creator/studio/:id/submit — send the build to the approval queue.
  // NEVER publishes directly: pending_approval is the same human gate every
  // creator design passes through.
  router.post('/:id/submit', requireAuth, ...cfg.gate, rateLimit(cfg.key, 6), async (req: Request, res: Response): Promise<any> => {
    try {
      const userId = (req as any).user?.id
      const product = await ownedProduct(req.params.id, userId)
      if (!product) return res.status(404).json({ error: 'Product not found' })
      if (product.status === 'pending_approval') {
        return res.json({ ok: true, alreadySubmitted: true, message: 'Already in review' })
      }
      if (product.status === 'active') {
        return res.status(400).json({ error: 'This product is already live' })
      }

      const { data: assets } = await supabase
        .from('product_assets')
        .select('asset_role, url, created_at')
        .eq('product_id', product.id)

      const images: string[] = []
      for (const role of SUBMIT_ROLE_ORDER) {
        const candidates = (assets || []).filter((a) => a.asset_role === role && a.url)
        if (candidates.length === 0) continue
        candidates.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        images.push(candidates[0].url)
      }
      if (images.length === 0) {
        return res.status(400).json({ error: 'Nothing to submit yet — build the mockups first' })
      }

      // Only a lane with the creator gate has req.creator, and only a creator
      // has agreed to the royalty terms — an ungated customer submission must
      // not stamp a royalty it never signed up for.
      const creator = (req as any).creator
      const { error: updateError } = await supabase
        .from('products')
        .update({
          status: 'pending_approval',
          is_active: false,
          images,
          metadata: {
            ...(product.metadata || {}),
            user_submitted: true,
            submitted_at: new Date().toISOString(),
            creator_id: userId,
            ...(creator ? { creator_royalty_percent: Number(creator.royaltyPercent) || 15 } : {}),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id)
      if (updateError) return res.status(500).json({ error: 'Could not submit for review' })

      req.log?.info({ productId: product.id, userId }, `${cfg.logPrefix} 📬 product submitted for review`)
      return res.json({ ok: true, message: 'Sent to the print shop for review', images })
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Submit failed' })
    }
  })

  // ---------------------------------------------------------------------------
  // THE MINIMAX TURN LANE (David 2026-08-10: "i like his minimax voice better
  // then grok … we keep the studio but make it clean").
  //
  // This replaces xAI Grok realtime for CREATORS. The admin studio keeps Grok.
  //
  // WHY, beyond the voice preference: Grok realtime bills per wall-clock MINUTE
  // the socket is open, and the browser talks to xAI directly — so once the
  // server mints a token it cannot cap the session length, the concurrency, or
  // the minutes. An idle tab bills. Here the server is in the middle of every
  // turn: cost is per UTTERANCE, idle is free, and every turn is rate-limited,
  // attributable and logged.
  //
  // Division of labour — deliberately: this endpoint is Mr. Imagine's BRAIN and
  // VOICE only. When he decides to spend money, he returns an `action` and the
  // BROWSER calls the existing /create, /select-image, /submit endpoints, which
  // already carry the ITC charges, the creator gate and the ownership scoping.
  // One money path, not two.
  // ---------------------------------------------------------------------------
  const turnUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 }, // ~10 min of webm/opus speech
  })

  const openaiTurn = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const TURN_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano'
  const isReasoningTurnModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

  /** Compact, plain-language view of the board handed to the model each turn. */
  function describeState(s: any, cfg: StudioLaneConfig): string {
    const bits: string[] = []
    bits.push(`product type: ${s?.lane || 'not chosen yet'}`)
    if (s?.lane === 'metal-art') bits.push(`panel size: ${s?.metalSize || 'not chosen'}`)
    bits.push(`brief: ${s?.brief?.prompt ? `"${String(s.brief.prompt).slice(0, 200)}"` : 'not locked yet'}`)
    if (s?.brief?.printPlacement) bits.push(`print placement: ${s.brief.printPlacement}`)
    if (s?.brief?.printSizeInches) bits.push(`print size: ${s.brief.printSizeInches} inch`)
    bits.push(`designs on screen: ${Number(s?.candidateCount) || 0}`)
    bits.push(`design chosen: ${s?.selectedAssetId ? 'yes' : 'no'}`)
    bits.push(`product shots ready: ${Number(s?.mockupCount) || 0}`)
    if (cfg.modelShots) bits.push(`model photos ready: ${Number(s?.modelShotCount) || 0}`)
    bits.push(`submitted for review: ${s?.submitted ? 'yes' : 'no'}`)
    if (s?.generating) bits.push('something is still rendering right now')
    return bits.join('; ')
  }

  const TURN_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'set_product_type',
        description: 'Lock what we are building. Call the moment they say it.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['shirt', 'metal-art', '3d-print'] },
            metal_size: { type: 'string', enum: ['4x6', '8x10'] },
          },
          required: ['type'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_design_brief',
        description: 'Lock the creative brief once they confirm it.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The confirmed design description, written to generate well.' },
            style: { type: 'string' },
            tone: { type: 'string' },
            shirt_color: { type: 'string', enum: ['black', 'white', 'gray'] },
            print_placement: { type: 'string', enum: ['front-center', 'left-pocket', 'back-only', 'front-back', 'pocket-front-back-full'] },
            print_size_inches: { type: 'integer', description: '8 youth, 11 adult standard, 13 XL.' },
          },
          required: ['prompt'],
        },
      },
    },
    {
      type: 'function',
      function: { name: 'get_pricing', description: 'Current ITC costs and their wallet balance. Call before quoting any cost.', parameters: { type: 'object', properties: {} } },
    },
    {
      type: 'function',
      function: { name: 'generate_designs', description: 'Start the design generation. SPENDS ITC — quote the cost and get a yes first.', parameters: { type: 'object', properties: {} } },
    },
    {
      type: 'function',
      function: {
        name: 'select_designs',
        description: 'Build product(s) from the numbered designs. Pass every number they love — each extra becomes its own product. SPENDS ITC per pick.',
        parameters: {
          type: 'object',
          properties: { indexes: { type: 'array', items: { type: 'integer' }, description: '1-based numbers as shown on screen.' } },
          required: ['indexes'],
        },
      },
    },
    {
      type: 'function',
      function: { name: 'submit_product', description: 'Send the finished build to the print shop for human review.', parameters: { type: 'object', properties: {} } },
    },
  ]

  /** Tools the BROWSER executes against the existing money endpoints. */
  const CLIENT_ACTIONS = new Set(['generate_designs', 'select_designs', 'submit_product'])

  // POST /api/creator/studio/turn
  // multipart form: audio (optional) | fields: text, state (JSON), history (JSON)
  router.post('/turn', requireAuth, ...cfg.gate, rateLimit(cfg.key, 20), turnUpload.single('audio'), async (req: Request, res: Response): Promise<any> => {
    const userId = (req as any).user?.id
    try {
      if (cfg.minBalanceToTalk != null && (await walletBalance(userId)) < cfg.minBalanceToTalk) {
        return res.status(402).json({
          error: `Top up your wallet to keep talking — you need at least ${cfg.minBalanceToTalk} to build anything.`,
          code: 'insufficient_balance',
        })
      }

      const parseJson = (v: unknown, fallback: any) => {
        if (typeof v !== 'string' || !v.trim()) return fallback
        try { return JSON.parse(v) } catch { return fallback }
      }
      const state = parseJson(req.body?.state, {})
      const history: Array<{ role: string; content: string }> = parseJson(req.body?.history, []).slice(-8)

      // ---- 1. What did they say? (dictation, or typed fallback)
      let userText = String(req.body?.text || '').trim()
      if (!userText && req.file) {
        const ext = (req.file.originalname?.split('.').pop() || 'webm').toLowerCase()
        const { publicUrl } = await uploadImageFromBuffer(
          req.file.buffer,
          `audio/${cfg.key}-studio/${userId}-${Date.now()}.${ext}`,
          req.file.mimetype || 'audio/webm'
        )
        const result = await transcribeAudio({
          audioUrl: publicUrl,
          prompt: 'Custom apparel and print-on-demand design studio. Terms: t-shirt, hoodie, pocket print, back print, metal art, 3D print, mockup.',
        })
        userText = String(result?.text || '').trim()
      }
      if (!userText) {
        return res.status(400).json({ error: "I didn't catch that — try again?", code: 'empty_turn' })
      }

      // ---- 2. Think (with tools)
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: `${cfg.systemPrompt}\n\nTHE BOARD RIGHT NOW: ${describeState(state, cfg)}` },
        ...history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: userText },
      ]

      const completion = await openaiTurn.chat.completions.create({
        model: TURN_MODEL,
        messages,
        tools: TURN_TOOLS,
        ...(isReasoningTurnModel(TURN_MODEL) ? { max_completion_tokens: 700 } : { max_tokens: 220, temperature: 0.8 }),
      })

      const choice = completion.choices[0]?.message
      let reply = String(choice?.content || '').trim()
      const statePatch: Record<string, unknown> = {}
      let action: { name: string; args: Record<string, unknown> } | null = null

      const toolResults: Array<{ id: string; result: unknown }> = []

      for (const call of choice?.tool_calls || []) {
        const fn = (call as any).function
        if (!fn?.name) continue
        const args = (() => { try { return JSON.parse(fn.arguments || '{}') } catch { return {} } })()
        let result: unknown = { ok: true }

        if (fn.name === 'set_product_type') {
          statePatch.lane = args.type
          if (args.metal_size) statePatch.metalSize = args.metal_size
        } else if (fn.name === 'set_design_brief') {
          statePatch.brief = {
            prompt: String(args.prompt || '').trim(),
            style: args.style ? String(args.style) : undefined,
            tone: args.tone ? String(args.tone) : undefined,
            shirtColor: ['black', 'white', 'gray'].includes(String(args.shirt_color)) ? args.shirt_color : 'black',
            printPlacement: ['front-center', 'left-pocket', 'back-only', 'front-back', 'pocket-front-back-full'].includes(String(args.print_placement))
              ? args.print_placement : undefined,
            printSizeInches: Number.isFinite(Number(args.print_size_inches)) && Number(args.print_size_inches) > 0
              ? Math.round(Number(args.print_size_inches)) : undefined,
          }
        } else if (fn.name === 'get_pricing') {
          const per = await perImageCost()
          statePatch.pricing = {
            generate: per * FANOUT_MULTIPLIER,
            buildPerProduct: per * BUILD_MULTIPLIER,
            balance: await walletBalance(userId),
          }
          result = statePatch.pricing
        } else if (CLIENT_ACTIONS.has(fn.name)) {
          // The browser runs this against the ITC-metered endpoints.
          action = { name: fn.name, args }
          result = { ok: true, started: true }
        }

        toolResults.push({ id: (call as any).id, result })
      }

      // He treats set_product_type as optional when the type feels obvious —
      // "make me a t shirt" often locks the brief with no product type at all,
      // measured 2026-09-03. The board then has no lane, so generate_designs
      // refuses and he cheerfully announces a build that never starts. If a
      // brief exists and nothing has set a lane, set one.
      if (statePatch.brief && !statePatch.lane && !state?.lane) {
        statePatch.lane = cfg.defaultLane
      }

      // A tool-only turn comes back with no words at all, and it is the most
      // important turn to hear him on — it is the one where something just got
      // locked in. Measured 2026-09-03: on a tool turn the model reliably
      // returns content: null, so the canned fallbacks below were most of what
      // anyone heard at the start of a build. Feed the tool results back and
      // let him actually react, which is the whole charm of this flow.
      if (!reply && toolResults.length > 0) {
        try {
          const followUp = await openaiTurn.chat.completions.create({
            model: TURN_MODEL,
            messages: [
              ...messages,
              choice as OpenAI.Chat.Completions.ChatCompletionMessageParam,
              ...toolResults.map((t) => ({
                role: 'tool' as const,
                tool_call_id: t.id,
                content: JSON.stringify(t.result),
              })),
            ],
            // No tools on this pass: he has already acted, now he speaks.
            ...(isReasoningTurnModel(TURN_MODEL) ? { max_completion_tokens: 700 } : { max_tokens: 220, temperature: 0.8 }),
          })
          reply = String(followUp.choices[0]?.message?.content || '').trim()
        } catch (err: any) {
          req.log?.warn?.({ err: err?.message }, `${cfg.logPrefix} follow-up reply failed`)
        }
      }

      // Belt and braces — never leave him mute.
      if (!reply) {
        reply = action
          ? 'On it!'
          : statePatch.brief
            ? "Locked it in! Ready when you are."
            : 'Got it!'
      }
      reply = reply.slice(0, 600)

      // ---- 3. Speak it in his own (MiniMax cloned) voice
      let audioUrl: string | null = null
      try {
        audioUrl = await generateConversationalResponse(reply, {
          voiceId: cfg.voiceId,
          emotion: EMOTIONS.AUTO,
          speed: 0.98,
        })
      } catch (err: any) {
        // Voice is a nicety — a TTS outage must never break the build.
        console.warn(`${cfg.logPrefix} TTS unavailable for this turn:`, err?.message)
      }

      req.log?.info({ userId, hasAudio: !!req.file, action: action?.name || null }, `${cfg.logPrefix} 🎙️ turn`)
      return res.json({ userText, reply, audioUrl, statePatch, action })
    } catch (error: any) {
      req.log?.error({ error }, `${cfg.logPrefix} ❌ turn failed`)
      return res.status(500).json({ error: error?.message || 'That turn did not go through' })
    }
  })

  return router
}
