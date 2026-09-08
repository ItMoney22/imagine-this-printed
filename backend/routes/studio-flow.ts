/**
 * Studio Step Flow — the CUSTOMER lane.
 *
 * David, 2026-09-08: "look at our step flow which is really good i wanted our
 * customers to have the same flow on design studio but its diff it needs to
 * match … minus the etsy step ofc."
 *
 * So this is deliberately NOT a second implementation of the flow. It is the
 * admin router (routes/admin/ai-products-step-flow.ts) mounted a second time
 * behind a different gate — one set of step logic, one set of bugs, one place
 * to fix them. What this file adds is everything that must NOT be shared:
 *
 *   1. the gate — requireAuth + requireCreator (instant opt-in, same as the
 *      rest of the creator rail), instead of admin/manager;
 *   2. ownership — every `/:id/...` request must be for a product the caller
 *      created, checked BEFORE the shared router ever sees it;
 *   3. money — generation and the mockup fan-out are ITC-metered off the same
 *      imagination_pricing rail the Station and Creator Studio use, where the
 *      admin lane spends the house's money unmetered;
 *   4. the lane flag the shared router reads (`req.studioLane`), which is what
 *      turns "publish live" into "submit for review" and scopes the resume
 *      list. It is set HERE, never by the client.
 *
 * Base: /api/studio  (see backend/index.ts). The Etsy step has no route on
 * this lane at all — not hidden in the UI, absent from the server.
 */
import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireCreator } from '../middleware/requireCreator.js'
import { pricingService } from '../services/imagination-pricing.js'
import stepFlowRouter from './admin/ai-products-step-flow.js'
import { handleAIProductCreate } from './admin/ai-products.js'

const router = Router()

function userId(req: Request): string {
  return ((req as any).user?.id || (req as any).user?.sub) as string
}

// ---------------------------------------------------------------------------
// Rate limiting — per user, in memory. Same shape as the admin builder's
// rateLimitAI; the caps are tighter because this pool is "anyone who signed
// up" rather than a handful of staff.
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>()
function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = userId(req) || req.ip || 'anon'
    const windowStart = Date.now() - 60_000
    const hits = (buckets.get(key) || []).filter((t) => t > windowStart)
    if (hits.length >= maxPerMinute) {
      res.status(429).json({ error: `Easy there — max ${maxPerMinute} of those a minute.` })
      return
    }
    hits.push(Date.now())
    buckets.set(key, hits)
    next()
  }
}

// ---------------------------------------------------------------------------
// ITC metering. Priced off the same `imagination_pricing` row ('generate' =
// one image) the Imagination Station uses, multiplied for the two steps that
// actually fan out into several paid renders. Env-tunable without a deploy.
// ---------------------------------------------------------------------------
const GENERATE_MULTIPLIER = Number(process.env.STUDIO_FLOW_GENERATE_MULTIPLIER) || 1
const SHOTS_MULTIPLIER = Number(process.env.STUDIO_FLOW_SHOTS_MULTIPLIER) || 5

async function perImageCost(): Promise<number> {
  try {
    const pricing = await pricingService.getPricing('generate')
    const cost = Number(pricing?.current_cost)
    if (Number.isFinite(cost) && cost > 0) return cost
  } catch {
    /* fall through to the default below */
  }
  return 10
}

async function walletBalance(uid: string): Promise<number> {
  const { data } = await supabase.from('user_wallets').select('itc_balance').eq('user_id', uid).maybeSingle()
  return Number(data?.itc_balance) || 0
}

/**
 * Charge before the spend, refund if the step it paid for failed.
 *
 * The refund hangs off the response rather than a try/catch because the
 * handlers this wraps own their own error responses — they answer 4xx/5xx
 * instead of throwing, so a catch block would never see the failure and the
 * customer would silently eat the charge for a step that did nothing.
 */
function meterITC(reason: string, multiplier: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const uid = userId(req)
    const cost = Math.round((await perImageCost()) * multiplier)
    if (cost <= 0) {
      next()
      return
    }
    const balance = await walletBalance(uid)
    if (balance < cost) {
      res.status(402).json({
        error: `That step costs ${cost} ITC and you have ${Math.floor(balance)}. Top up in your Wallet.`,
        needed: cost,
        balance,
      })
      return
    }
    await pricingService.deductITC(uid, cost, reason)
    ;(req as any).itcCharged = cost

    let settled = false
    res.on('finish', () => {
      if (settled) return
      settled = true
      if (res.statusCode >= 400) {
        void pricingService.refundITC(uid, cost, `${reason}_failed`).catch(() => {})
      }
    })
    next()
  }
}

// ---------------------------------------------------------------------------
// Gate. Order matters: authenticate, confirm the creator opt-in, THEN mark the
// lane — the shared router skips its admin check on a request marked
// 'customer', so the flag must never be reachable before those two have run.
// ---------------------------------------------------------------------------
function markCustomerLane(req: Request, _res: Response, next: NextFunction): void {
  ;(req as any).studioLane = 'customer'
  next()
}

router.use(requireAuth, requireCreator, markCustomerLane)

/**
 * Ownership. Every path on this lane is either `/step/...` (no product exists
 * yet) or `/:productId/step/...`. Anything of the second shape must belong to
 * the caller, and that is settled here, once, rather than in twenty handlers
 * that each might forget.
 *
 * A product someone else owns answers 404, not 403 — a customer has no
 * business learning which product ids exist in the shop.
 */
async function requireOwnBuild(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Keyed on the SECOND segment being the literal 'step', which is the shape
  // of every product-scoped path here and of nothing else — testing the first
  // segment instead would send `/pricing` off to look up a product called
  // "pricing" and 404 the page's own price call.
  const parts = req.path.split('/').filter(Boolean)
  if (parts.length < 2 || parts[1] !== 'step') {
    next()
    return
  }
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('id', parts[0])
    .eq('created_by_user_id', userId(req))
    .maybeSingle()
  if (error || !data) {
    res.status(404).json({ error: 'Build not found' })
    return
  }
  next()
}

router.use(requireOwnBuild)

// GET /api/studio/pricing — what the flow will charge, so the page can show it
// before the customer commits (and so "not enough ITC" is never a surprise
// mid-build).
router.get('/pricing', async (req: Request, res: Response): Promise<any> => {
  const per = await perImageCost()
  const balance = await walletBalance(userId(req))
  return res.json({
    generate: Math.round(per * GENERATE_MULTIPLIER),
    shots: Math.round(per * SHOTS_MULTIPLIER),
    balance,
  })
})

// POST /api/studio/step/create — the Idea step's "Write my prompt" → generate.
// The admin lane calls POST /api/admin/products/ai/create for this; that route
// is admin-gated, so the customer lane calls the SAME handler here with the
// owner stamped on the request and the ITC meter in front of it.
router.post(
  '/step/create',
  rateLimit(6),
  meterITC('studio_flow_generate', GENERATE_MULTIPLIER),
  async (req: Request, res: Response): Promise<any> => {
    ;(req as any).studioOwnerId = userId(req)
    return handleAIProductCreate(req, res)
  }
)

// DELETE /api/studio/:id/step/draft — throw away a scratch draft. The Design
// step's "Tweak" starts a FRESH product from the edited prompt and hands the
// old one to this; without it every tweak would strand a paid-for orphan in
// the customer's own resume list. The admin lane does the same cleanup through
// DELETE /api/admin/products/ai/:id, which is staff-only.
//
// Deliberately narrow: only a draft, only one the ownership guard above has
// already proven belongs to the caller. Anything submitted or live is refused
// — a customer must not be able to erase a design that is in review or on sale.
router.delete('/:id/step/draft', async (req: Request, res: Response): Promise<any> => {
  const { data: product } = await supabase.from('products').select('id, status').eq('id', req.params.id).maybeSingle()
  if (!product) return res.status(404).json({ error: 'Build not found' })
  if (product.status !== 'draft') {
    return res.status(400).json({ error: 'That one is already submitted — it can only be discarded while it is still a draft.' })
  }
  await supabase.from('product_assets').delete().eq('product_id', product.id)
  await supabase.from('ai_jobs').delete().eq('product_id', product.id)
  const { error } = await supabase.from('products').delete().eq('id', product.id)
  if (error) return res.status(500).json({ error: 'Could not discard that draft' })
  return res.json({ ok: true })
})

/**
 * The mockup fan-out, charged ONCE per build.
 *
 * The Mockups step doesn't fire in a single call: it queues whatever keys are
 * missing, and more can go missing later (an extra colour approved on the
 * Garment step adds a `color:<id>` shot). A flat per-call meter would bill the
 * whole 5x fan-out again for a single extra render — so the charge is recorded
 * on the product and never taken twice. Redoes and extra model shots below are
 * priced per render, because that IS one render each.
 */
async function meterShotsOnce(req: Request, res: Response, next: NextFunction): Promise<void> {
  const productId = req.params.id
  const { data: product } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  if ((product?.metadata as any)?.studio_billing?.shots) {
    next()
    return
  }
  await meterITC('studio_flow_shots', SHOTS_MULTIPLIER)(req, res, async () => {
    // Stamp only on a response that actually queued something; a failure has
    // already been refunded by the meter's own finish handler.
    res.on('finish', () => {
      if (res.statusCode >= 400) return
      void supabase
        .from('products')
        .update({ metadata: { ...(product?.metadata || {}), studio_billing: { ...((product?.metadata as any)?.studio_billing || {}), shots: new Date().toISOString() } } })
        .eq('id', productId)
        .then(undefined, () => {})
    })
    next()
  })
}

// The steps that spend. Matched by path here rather than inside the shared
// router so all of this lane's money decisions stay in one readable place.
router.post('/:id/step/shots', rateLimit(6), meterShotsOnce)
router.post('/:id/step/shots/model', rateLimit(6), meterITC('studio_flow_model_shot', 1))
router.post('/:id/step/shots/:key/redo', rateLimit(10), meterITC('studio_flow_redo_shot', 1))

// Everything else — brief, phrases, inspiration, select-design, colour advice,
// garments, sizes, the shot approvals, the listing copy, the finish — is the
// admin router, verbatim.
router.use(stepFlowRouter)

export default router
