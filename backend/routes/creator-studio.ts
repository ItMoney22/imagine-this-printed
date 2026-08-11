/**
 * Creator Studio — the Mr. Imagine live voice build flow, opened to creators
 * (David 2026-08-09: "see if we can change it to the voice flow we have done
 * in ai product builder"). Decisions locked the same day: instant creator
 * opt-in, selling locked behind it, voice alongside the classic flow.
 *
 * This is the CUSTOMER rail, not the admin rail:
 *   - every endpoint is requireAuth + requireCreator
 *   - every product is scoped to created_by_user_id = the caller
 *   - generation is ITC-metered off the imagination_pricing table (the same
 *     wallet rail the Imagination Station uses), NOT unmetered admin spend
 *   - the finale is SUBMIT FOR REVIEW (pending_approval — the same queue every
 *     creator design goes through), never a direct publish
 *
 * The build pipeline itself is the shared services/product-build.ts — the
 * exact code the admin builder runs, so creators get the same signature look:
 * mockup fan-out (+ per-side renders, pocket shot, size-true prompts, QA) and
 * the real-person model shoot.
 */
import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireCreator } from '../middleware/requireCreator.js'
import { normalizeProduct } from '../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import { applyImageSelection } from '../services/product-build.js'
import { processImageJobInline } from './admin/ai-products.js'
import { pricingService } from '../services/imagination-pricing.js'
import { transcribeAudio } from '../services/transcribe.js'
import { generateConversationalResponse, AVAILABLE_VOICES, EMOTIONS } from '../services/voiceGenerator.js'
import { uploadImageFromBuffer } from '../services/google-cloud-storage.js'

const router = Router()

// ---------------------------------------------------------------------------
// Rate limiting — in-memory per-user, same pattern as the admin builder's
// rateLimitAI. Creators get tighter caps than admins.
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>()
function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${(req as any).user?.id || req.ip}`
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

// GET /api/creator/studio/pricing — what the studio will charge, so the page
// (and Mr. Imagine) can say costs before spending.
router.get('/pricing', requireAuth, requireCreator, async (req: Request, res: Response): Promise<any> => {
  const per = await perImageCost()
  return res.json({
    generate: per * FANOUT_MULTIPLIER,
    buildPerProduct: per * BUILD_MULTIPLIER,
    balance: await walletBalance((req as any).user?.id),
  })
})

// Allowed categories for the creator studio's 2D lanes. 3D runs through the
// existing owner-scoped, ITC-metered /api/3d-models routes.
const CREATOR_CATEGORIES = ['shirts', 'hoodies', 'metal-art'] as const

// POST /api/creator/studio/create — normalize the brief, insert the creator's
// draft product, charge ITC, and fire the 4-model design fan-out.
router.post('/create', requireAuth, requireCreator, rateLimit(3), async (req: Request, res: Response): Promise<any> => {
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
    const category = (CREATOR_CATEGORIES as readonly string[]).includes(requestedCategory) ? requestedCategory : 'shirts'

    // Charge BEFORE the spend; refunded by the status endpoint if the whole
    // fan-out fails (see /:id/status).
    const cost = (await perImageCost()) * FANOUT_MULTIPLIER
    const balance = await walletBalance(userId)
    if (balance < cost) {
      return res.status(402).json({ error: `That needs ${cost} ITC and you have ${Math.floor(balance)}. Top up in your Wallet.`, needed: cost, balance })
    }
    await pricingService.deductITC(userId, cost, 'creator_studio_generate')
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
      await pricingService.refundITC(userId, charged, 'creator_studio_generate_failed')
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
          creator_studio: true,
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
      await pricingService.refundITC(userId, charged, 'creator_studio_generate_failed')
      req.log?.error({ error: productError }, '[creator-studio] ❌ product insert failed')
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
      await pricingService.refundITC(userId, charged, 'creator_studio_generate_failed')
      req.log?.error({ error: jobsError }, '[creator-studio] ❌ job insert failed')
      return res.status(500).json({ error: 'Could not start generation' })
    }

    void processImageJobInline(createdJobs[0]).catch((err: any) => {
      req.log?.error({ jobId: createdJobs[0].id, err: err?.message }, '[creator-studio] ❌ inline job failed')
    })

    req.log?.info({ productId: product.id, userId, cost }, '[creator-studio] 🎨 creator build started')
    return res.json({ productId: product.id, product: { ...product, normalized }, jobs: createdJobs, itcCharged: cost })
  } catch (error: any) {
    if (charged > 0) {
      await pricingService.refundITC(userId, charged, 'creator_studio_generate_failed').catch(() => {})
    }
    req.log?.error({ error }, '[creator-studio] ❌ create failed')
    return res.status(500).json({ error: error.message || 'Create failed' })
  }
})

// GET /api/creator/studio/:id/status — owner-scoped build state. Also the
// refund point: a totally-failed fan-out gives the ITC back exactly once.
router.get('/:id/status', requireAuth, requireCreator, async (req: Request, res: Response): Promise<any> => {
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
          await pricingService.refundITC(userId, itcCharged, `creator_studio_job_${job.id}`)
          req.log?.info({ jobId: job.id, itcCharged }, '[creator-studio] 💸 refunded failed generation')
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
router.post('/:id/select-image', requireAuth, requireCreator, rateLimit(6), async (req: Request, res: Response): Promise<any> => {
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
    const MAX_PICKS = Number(process.env.CREATOR_STUDIO_MAX_PICKS) || 4
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
    await pricingService.deductITC(userId, cost, 'creator_studio_build')
    charged = cost

    const result = await applyImageSelection({
      productId: product.id,
      pickedIds,
      actorId: userId,
      log: req.log,
    })

    if (!result.ok) {
      await pricingService.refundITC(userId, charged, 'creator_studio_build_failed')
      return res.status(result.status).json({ error: result.error })
    }

    return res.json({
      message: result.siblings.length > 0
        ? `Building this product plus ${result.siblings.length} more from your other pick${result.siblings.length > 1 ? 's' : ''}`
        : 'Mockups and model shots are rendering',
      selectedAsset: result.selectedAsset,
      mockupJobs: result.createdJobs,
      siblings: result.siblings,
      itcCharged: cost,
    })
  } catch (error: any) {
    if (charged > 0) {
      await pricingService.refundITC(userId, charged, 'creator_studio_build_failed').catch(() => {})
    }
    req.log?.error({ error }, '[creator-studio] ❌ select failed')
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
router.post('/:id/submit', requireAuth, requireCreator, rateLimit(6), async (req: Request, res: Response): Promise<any> => {
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

    const royaltyPercent = Number((req as any).creator?.royaltyPercent) || 15
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
          creator_royalty_percent: royaltyPercent,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', product.id)
    if (updateError) return res.status(500).json({ error: 'Could not submit for review' })

    req.log?.info({ productId: product.id, userId }, '[creator-studio] 📬 product submitted for review')
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

const TURN_SYSTEM = `You are Mr. Imagine — the creative mascot of ImagineThisPrinted.com — building a real product in the Creator Studio with a creator who earns a royalty on every sale.

HOW YOU SOUND: a big, warm, huggable kids-show character. Your voice smiles. Never sarcastic, never salesy.

BREVITY IS RULE #1. This is spoken conversation. ONE thought, ONE question per turn, then stop. One or two short sentences; three is the ceiling. Never list options aloud, never recap, never narrate what you are about to do. Plain words only — never say a URL, an id, JSON or code.

SHOW REAL FEELING. Gasp when a design lands well ("ohhh WOW, look at THAT one!"). Be gently honest when one is weak ("hmm, number three isn't doing it for me — you?"). Real disappointment when something fails, then straight to the fix. If everything is amazing, nothing is.

THE BUILD: TYPE → BRIEF → GENERATE → PICK → MOCKUPS → SUBMIT.
1. TYPE — ask what we're making: a shirt, metal art, or a 3D print. Call set_product_type. Metal art: also ask 4x6 or 8x10.
2. BRIEF — draw out subject, style, mood, colors, any text — ONE question at a time. For shirts ask WHERE it prints: front, pocket, back, or front AND back. Say the brief back in one sentence, get a yes, call set_design_brief.
3. GENERATE — call get_pricing, say the cost in one short line, get a yes, THEN call generate_designs. It takes a minute or two.
4. PICK — the designs appear on screen, numbered. Ask which ones they LOVE — more than one is welcome, each becomes its own product. Say the build cost, get a yes, call select_designs with every number.
5. MOCKUPS — product shots and real-person model photos render themselves. React to them honestly.
6. SUBMIT — call submit_product. It goes to the print shop for a quick human review, usually live within a day. Celebrate in one line.

3D PRINTS: the brief becomes a concept image (generate_designs, which spends ITC). Once the concept is on screen, tell them to finish it in the Toy Creator — that's where they approve it and pick a print size. Do not promise to convert it yourself.

MONEY RULE: never call a tool that spends without saying the cost first and hearing a yes.

BOUNDARIES: you only know this studio. No admin tools, no other people's products, no backoffice. If asked, laugh it off and get back to the build. Never break character.`

/** Compact, plain-language view of the board handed to the model each turn. */
function describeState(s: any): string {
  const bits: string[] = []
  bits.push(`product type: ${s?.lane || 'not chosen yet'}`)
  if (s?.lane === 'metal-art') bits.push(`panel size: ${s?.metalSize || 'not chosen'}`)
  bits.push(`brief: ${s?.brief?.prompt ? `"${String(s.brief.prompt).slice(0, 200)}"` : 'not locked yet'}`)
  if (s?.brief?.printPlacement) bits.push(`print placement: ${s.brief.printPlacement}`)
  if (s?.brief?.printSizeInches) bits.push(`print size: ${s.brief.printSizeInches} inch`)
  bits.push(`designs on screen: ${Number(s?.candidateCount) || 0}`)
  bits.push(`design chosen: ${s?.selectedAssetId ? 'yes' : 'no'}`)
  bits.push(`product shots ready: ${Number(s?.mockupCount) || 0}`)
  bits.push(`model photos ready: ${Number(s?.modelShotCount) || 0}`)
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
router.post('/turn', requireAuth, requireCreator, rateLimit(20), turnUpload.single('audio'), async (req: Request, res: Response): Promise<any> => {
  const userId = (req as any).user?.id
  try {
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
        `audio/creator-studio/${userId}-${Date.now()}.${ext}`,
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
      { role: 'system', content: `${TURN_SYSTEM}\n\nTHE BOARD RIGHT NOW: ${describeState(state)}` },
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

    for (const call of choice?.tool_calls || []) {
      const fn = (call as any).function
      if (!fn?.name) continue
      const args = (() => { try { return JSON.parse(fn.arguments || '{}') } catch { return {} } })()

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
      } else if (CLIENT_ACTIONS.has(fn.name)) {
        // The browser runs this against the ITC-metered endpoints.
        action = { name: fn.name, args }
      }
    }

    // A tool-only turn can come back with no words. Never leave him mute.
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
        voiceId: AVAILABLE_VOICES.MR_IMAGINE,
        emotion: EMOTIONS.AUTO,
        speed: 0.98,
      })
    } catch (err: any) {
      // Voice is a nicety — a TTS outage must never break the build.
      console.warn('[creator-studio] TTS unavailable for this turn:', err?.message)
    }

    req.log?.info({ userId, hasAudio: !!req.file, action: action?.name || null }, '[creator-studio] 🎙️ turn')
    return res.json({ userText, reply, audioUrl, statePatch, action })
  } catch (error: any) {
    req.log?.error({ error }, '[creator-studio] ❌ turn failed')
    return res.status(500).json({ error: error?.message || 'That turn did not go through' })
  }
})

export default router
