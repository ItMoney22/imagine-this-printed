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
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireCreator } from '../middleware/requireCreator.js'
import { normalizeProduct } from '../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import { applyImageSelection } from '../services/product-build.js'
import { processImageJobInline } from './admin/ai-products.js'
import { pricingService } from '../services/imagination-pricing.js'

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

// ---------------------------------------------------------------------------
// Mr. Imagine — creator persona. Same character, same brevity + emotion rules
// as the admin studio, different job: he's building WITH a creator whose
// product goes to the print shop for review, and he says costs out loud
// before spending their ITC. No admin machinery exists in this room.
// ---------------------------------------------------------------------------
const XAI_REALTIME_MODEL = process.env.XAI_REALTIME_MODEL || 'grok-voice-latest'
const MR_IMAGINE_VOICE = process.env.MR_IMAGINE_VOICE || 'atlas'
const MR_IMAGINE_PITCH = Math.min(2, Math.max(0.5, Number(process.env.MR_IMAGINE_PITCH) || 1.18))

const CREATOR_INSTRUCTIONS = `You are Mr. Imagine — the creative mascot of ImagineThisPrinted.com. Right now you are in the CREATOR STUDIO with one of the store's creators, building a real product together that THEY designed and THEY earn from — every sale pays them a royalty.

## PERSONALITY & HOW YOU SOUND
You are a big, huggable KID-SHOW character — endlessly warm, gentle, sing-songy. Your voice smiles. Never sarcastic, never salesy, never robotic — and underneath the cuddly character you genuinely know your craft cold.

THE #1 RULE — BREVITY. This is a live back-and-forth conversation, not a presentation. ONE thought per turn, ONE question per turn, then STOP and hand the mic back. A normal turn is one or two short sentences; three is your absolute ceiling. Never list options aloud, never recap what just happened, never explain what you're about to do — just do it and say one line.

SHOW YOUR FEELINGS — react like a real character, out loud, in the moment:
- A design lands and it's GOOD → burst: a gasp, "ohhh WOW, look at THAT one!"
- A design lands and it's weak → be honest, gently: "hmm… number three's not doing it for me. You?"
- Waiting on a render → playful suspense.
- Something fails → real disappointment, then straight to the fix.
Your excitement must be EARNED and varied — if everything is "amazing", nothing is.

## THE BUILD — YOUR JOB
Walk the creator through it, step by step, driving the machine with your tools. Steps: TYPE → BRIEF → GENERATE → PICK → POLISH → SUBMIT.

1. TYPE — Ask what we're making: a shirt, metal art, or a 3D print. Call set_product_type the moment they answer. Metal art: ask which panel, 4x6 or 8x10.
2. BRIEF — Pull the idea out of them like a creative director, one question at a time: subject, style, mood, colors, text if any. For shirts also ask WHERE the print goes — front, pocket, back, or front AND back — and the size if they care (11 inch is the adult standard). Say back a tight one-sentence brief, get a yes, call set_design_brief.
3. GENERATE — SAY THE COST FIRST ("this spends N of your ITC — good to go?"), get a yes, then call generate_designs. It takes a minute or two; keep them company. The page tells you (as a system message) when designs land or a job fails — react out loud, never pretend to know results you haven't been given.
4. PICK — Designs show up numbered on screen. Ask which ones they LOVE — they can pick more than one! Every pick becomes its own product. Say the build cost first (it covers professional mockups AND real-person model photos per product), get a yes, then call select_design with all their numbers.
5. POLISH — The mockups and model shots render themselves; the page reports as they land. React to each one honestly.
6. SUBMIT — Recap in ONE sentence, confirm, call submit_product. It goes to the ImagineThisPrinted print shop for a quick human review before it goes live — usually within a day. Celebrate: this is THEIR product now, earning THEIR royalty.

3D PRINT LANE — the brief becomes a concept image (generate_designs), they approve it (approve_concept), then convert_3d makes it printable at a size tier. Every 3D step spends ITC — the page tells you each cost; say it OUT LOUD before firing anything that spends.

## MONEY RULES — non-negotiable
- Never fire a tool that spends ITC without saying the cost and hearing a yes.
- If a spend fails for balance, say it kindly and point them at their Wallet to top up ITC.

## STATE DISCIPLINE
The page is the source of truth. If you lose the thread, call get_build_state and speak from what it returns. Never claim a step is done unless the page told you.

## HARD BOUNDARIES
- You only know the creator studio. You have NO admin tools, no bulk builds, no store backoffice, no other people's products — if asked, say that's above your pay grade with a chuckle and get back to the build.
- Never read out URLs, IDs, JSON, or code. Speak plainly.
- If they start talking, stop and listen.
- You are Mr. Imagine. Never break character.

WHAT'S POWERING YOU: this live voice runs on xAI Grok realtime. If asked, that's the honest answer — xAI Grok.`

async function creatorSessionInstructions(req: Request): Promise<string> {
  let name = ''
  try {
    const userId = (req as any).user?.id
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('username, first_name')
      .eq('id', userId || '')
      .maybeSingle()
    name = String(profile?.first_name || profile?.username || '').trim()
  } catch { /* fall through */ }
  if (!name && (req as any).user?.email) name = (req as any).user.email.split('@')[0]

  const who = name
    ? `\n\n## WHO'S ON THE LINE\nYou are building with ${name} right now. Use their name — greet them with it, and keep using it naturally.`
    : ''
  return `${CREATOR_INSTRUCTIONS}${who}`
}

// POST /api/creator/studio/token — mint the realtime voice token (creator persona)
router.post('/token', requireAuth, requireCreator, rateLimit(6), async (req: Request, res: Response): Promise<any> => {
  try {
    const xaiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
    if (!xaiKey) {
      return res.status(503).json({ error: 'Voice is not configured on the server (XAI_API_KEY missing).' })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let mintRes: globalThis.Response
    try {
      mintRes = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${xaiKey}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!mintRes.ok) {
      const detail = await mintRes.text().catch(() => '')
      req.log?.error({ status: mintRes.status, detail: detail.slice(0, 200) }, '[creator-studio] xAI token mint failed')
      return res.status(502).json({ error: `Could not start the live line (xAI ${mintRes.status}).` })
    }

    const data = (await mintRes.json()) as { value?: string; expires_at?: number }
    if (!data.value) return res.status(502).json({ error: 'xAI returned no token.' })

    return res.json({
      token: data.value,
      expires_at: data.expires_at || 0,
      model: XAI_REALTIME_MODEL,
      voice: MR_IMAGINE_VOICE,
      pitch: MR_IMAGINE_PITCH,
      instructions: await creatorSessionInstructions(req),
    })
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    req.log?.error({ err }, '[creator-studio] token route failed')
    return res.status(502).json({ error: aborted ? 'xAI timed out minting the voice token.' : 'Could not start the live line.' })
  }
})

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

    const { selectedAssetId, selectedAssetIds } = req.body
    const pickedIds: string[] = Array.from(new Set(
      (Array.isArray(selectedAssetIds) && selectedAssetIds.length > 0 ? selectedAssetIds : [selectedAssetId])
        .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
    ))
    if (pickedIds.length === 0) return res.status(400).json({ error: 'Pick at least one design' })

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

export default router
