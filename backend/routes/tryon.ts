// ---------------------------------------------------------------------------
// Buyer-side virtual try-on. Watchtower task 3b362203.
//
//   GET    /api/tryon/config           what this shopper can do right now
//   POST   /api/tryon/generate         upload a photo, run FASHN, charge ITC
//   POST   /api/tryon/events           funnel instrumentation (card view, ATC)
//   GET    /api/tryon/history          this shopper's past try-ons
//   DELETE /api/tryon/:id              delete a try-on AND its stored photos
//   GET    /api/tryon/analytics        admin: the keep-or-kill report
//
// SECURITY NOTES THAT MATTER HERE
//  * The garment image is resolved SERVER-SIDE from the products row. The
//    client sends a product id and an index into the gallery, never a URL — a
//    client-supplied garment URL would let anyone spend our FASHN credits on
//    arbitrary images.
//  * Photos are uploaded to a private GCS prefix and referenced by signed URL.
//  * requireAuth on everything. There is no anonymous try-on: the daily free
//    cap is only enforceable against an account.
// ---------------------------------------------------------------------------

import express, { type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  sniffImageContentType,
  extForImageContentType,
  uploadImageFromBuffer,
  uploadImageFromUrl,
  deleteImage,
  getSignedUrl
} from '../services/google-cloud-storage.js'
import {
  isTryOnEnabled,
  runTryOn,
  resolveTier,
  TRYON_TIERS,
  FASHN_COST_PER_CREDIT_USD,
  type FashnCategory
} from '../services/fashn-tryon.js'
import {
  openGate,
  settleFailure,
  priceFor,
  storeDateString,
  summarizeConversion,
  DAILY_FREE_TRYONS,
  TRYON_TIMEZONE,
  type TryOnDeps,
  type LedgerEntry
} from '../services/virtual-tryon.js'

const router = express.Router()

// A try-on photo is one still image. 10 MB covers any phone camera JPEG and
// stops someone shovelling video-sized payloads through the endpoint.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
})

const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Each generate call can cost real money even when it's the free one, so the
// endpoint gets its own bucket on top of the daily cap (which only limits the
// FREE run — a whale with ITC could otherwise hammer it).
const buckets = new Map<string, number[]>()
const PER_MINUTE = Number(process.env.TRYON_LIMIT_PER_MIN) || 6
function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = String(req.user?.id || req.ip)
  const windowStart = Date.now() - 60_000
  const hits = (buckets.get(key) || []).filter((t) => t > windowStart)
  if (hits.length >= PER_MINUTE) {
    res.status(429).json({ error: 'Easy there — give the last try-on a moment to finish.' })
    return
  }
  hits.push(Date.now())
  buckets.set(key, hits)
  next()
}

// ---------------------------------------------------------------------------
// Supabase-backed implementation of the injectable gate dependencies.
// ---------------------------------------------------------------------------
const deps: TryOnDeps = {
  async getPricing(featureKey) {
    const { data } = await supabase
      .from('imagination_pricing')
      .select('current_cost, promo_end_time')
      .eq('feature_key', featureKey)
      .single()
    return data ? { current_cost: data.current_cost, promo_end_time: data.promo_end_time } : null
  },

  async getWalletBalance(userId) {
    const { data } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()
    return Number(data?.itc_balance) || 0
  },

  async applyDeduction(userId, expectedBalance, amount) {
    const { data } = await supabase
      .from('user_wallets')
      .update({ itc_balance: expectedBalance - amount })
      .eq('user_id', userId)
      .eq('itc_balance', expectedBalance) // optimistic lock
      .select('itc_balance')
    return Array.isArray(data) && data.length > 0
  },

  async creditWallet(userId, amount) {
    const { data } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()
    const next = (Number(data?.itc_balance) || 0) + amount
    await supabase.from('user_wallets').update({ itc_balance: next }).eq('user_id', userId)
    return next
  },

  async writeLedger(entry: LedgerEntry) {
    // Live itc_transactions shape is (user_id, type, amount, balance_after,
    // reference, metadata) — see 20260727_fix_itc_wallet_schema_drift.sql.
    // Anything else silently no-ops the insert.
    const { error } = await supabase.from('itc_transactions').insert({
      user_id: entry.userId,
      type: entry.type,
      amount: entry.amount,
      balance_after: entry.balanceAfter,
      reference: entry.reference,
      metadata: entry.metadata
    })
    if (error) console.error('[tryon] ledger insert failed:', error.message)
  },

  async claimFreeUse(userId, usageDate) {
    // The UNIQUE(user_id, usage_date) constraint IS the lock. Whoever's insert
    // lands gets a row back; the loser gets an empty array, not an error.
    const { data, error } = await supabase
      .from('virtual_tryon_daily_usage')
      .insert({ user_id: userId, usage_date: usageDate, free_used: true, paid_count: 0 })
      .select('id')
    if (error) {
      // 23505 = unique violation = someone already took today's free slot.
      if ((error as any).code === '23505') return false
      console.error('[tryon] free-claim insert failed:', error.message)
      return false
    }
    return Array.isArray(data) && data.length > 0
  },

  async releaseFreeUse(userId, usageDate) {
    // Give the day back on a failed render. paid_count survives — only the
    // free flag is being undone, and a row with free_used=false lets the next
    // claim's INSERT still conflict, so re-grant by flipping the flag.
    const { data } = await supabase
      .from('virtual_tryon_daily_usage')
      .select('paid_count')
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
      .single()

    if (!data || Number(data.paid_count) === 0) {
      await supabase
        .from('virtual_tryon_daily_usage')
        .delete()
        .eq('user_id', userId)
        .eq('usage_date', usageDate)
      return
    }
    await supabase
      .from('virtual_tryon_daily_usage')
      .update({ free_used: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
  },

  async hasClaimedFreeUse(userId, usageDate) {
    const { data } = await supabase
      .from('virtual_tryon_daily_usage')
      .select('free_used')
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
      .maybeSingle()
    return Boolean(data?.free_used)
  },

  async incrementPaidCount(userId, usageDate) {
    const { data } = await supabase
      .from('virtual_tryon_daily_usage')
      .select('paid_count')
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
      .maybeSingle()

    if (!data) {
      await supabase
        .from('virtual_tryon_daily_usage')
        .insert({ user_id: userId, usage_date: usageDate, free_used: false, paid_count: 1 })
      return
    }
    await supabase
      .from('virtual_tryon_daily_usage')
      .update({ paid_count: (Number(data.paid_count) || 0) + 1, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
  },

  now: () => new Date()
}

/**
 * Server-side gallery resolution — the same preference order the storefront
 * uses in src/lib/product-kind.ts (contextual mockup first, then clean art,
 * then raw images), minus the download-only deliverables.
 */
function resolveGarmentGallery(product: any): string[] {
  const assets = (product?.metadata?.assets && typeof product.metadata.assets === 'object')
    ? product.metadata.assets
    : {}
  const deliverables = new Set([assets.halftone, assets.dtf].filter(Boolean) as string[])
  if (assets.display && assets.clean) deliverables.add(assets.clean)

  const out: string[] = []
  const push = (u?: unknown) => {
    if (typeof u === 'string' && /^https?:\/\//i.test(u) && !out.includes(u) && !deliverables.has(u)) out.push(u)
  }
  push(assets.display)
  ;(Array.isArray(assets.mockups) ? assets.mockups : []).forEach(push)
  push(product?.metadata?.mockup_url)
  push(assets.clean)
  ;(Array.isArray(product?.images) ? product.images : []).forEach(push)
  return out
}

/** FASHN garment categories, mapped off the product's own category text. */
function inferCategory(product: any): FashnCategory {
  const hay = `${product?.category || ''} ${product?.name || ''}`.toLowerCase()
  if (/\b(dress|jumpsuit|romper|one[- ]?piece|gown|overall)\b/.test(hay)) return 'one-pieces'
  if (/\b(pant|jean|short|legging|jogger|trouser|skirt|sweatpant)\b/.test(hay)) return 'bottoms'
  if (/\b(shirt|tee|t-shirt|hoodie|sweatshirt|crewneck|tank|jacket|long sleeve|pullover)\b/.test(hay)) return 'tops'
  return 'auto'
}

/**
 * Fire-and-forget funnel write. Instrumentation must never be able to fail a
 * shopper's request, so every call is caught and logged.
 */
async function recordEvent(row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase.from('virtual_tryon_events').insert(row)
    if (error) console.error('[tryon] event insert failed:', error.message)
  } catch (err: any) {
    console.error('[tryon] event insert threw:', err?.message || String(err))
  }
}

// ---------------------------------------------------------------------------
// GET /api/tryon/enabled — public. The storefront needs to know whether to
// render the card at all BEFORE a shopper signs in, and /config can't answer
// that without a token. Carries no per-user data.
// ---------------------------------------------------------------------------
router.get('/enabled', async (_req: Request, res: Response): Promise<any> => {
  return res.json({ enabled: isTryOnEnabled(), dailyFreeCap: DAILY_FREE_TRYONS })
})

// ---------------------------------------------------------------------------
// GET /api/tryon/config
// ---------------------------------------------------------------------------
router.get('/config', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id
    const usageDate = storeDateString()
    const enabled = isTryOnEnabled()

    if (!enabled) {
      return res.json({
        enabled: false,
        reason: 'Virtual try-on is not switched on yet.',
        dailyFreeCap: DAILY_FREE_TRYONS,
        timezone: TRYON_TIMEZONE
      })
    }

    const [freeUsed, itcBalance, standardCost, premiumCost] = await Promise.all([
      deps.hasClaimedFreeUse(userId, usageDate),
      deps.getWalletBalance(userId),
      priceFor(deps, TRYON_TIERS.standard),
      priceFor(deps, TRYON_TIERS.premium)
    ])

    return res.json({
      enabled: true,
      dailyFreeCap: DAILY_FREE_TRYONS,
      freeUsedToday: freeUsed,
      freeRemainingToday: freeUsed ? 0 : DAILY_FREE_TRYONS,
      usageDate,
      timezone: TRYON_TIMEZONE,
      itcBalance,
      tiers: {
        standard: { label: TRYON_TIERS.standard.label, itcCost: standardCost, poses: TRYON_TIERS.standard.numSamples },
        premium: { label: TRYON_TIERS.premium.label, itcCost: premiumCost, poses: TRYON_TIERS.premium.numSamples }
      }
    })
  } catch (err: any) {
    console.error('[tryon] config failed:', err?.message || String(err))
    return res.status(500).json({ error: 'Could not load try-on settings' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/tryon/generate  (multipart/form-data: photo + productId + tier)
// ---------------------------------------------------------------------------
router.post(
  '/generate',
  requireAuth,
  rateLimit,
  upload.single('photo'),
  async (req: Request, res: Response): Promise<any> => {
    const userId = req.user!.id

    if (!isTryOnEnabled()) {
      return res.status(503).json({ error: 'Virtual try-on is not switched on yet.' })
    }

    const file = (req as any).file as { buffer: Buffer; mimetype: string; size: number } | undefined
    if (!file?.buffer?.length) {
      return res.status(400).json({ error: 'A photo is required.' })
    }

    // Trust the bytes, not the declared mimetype — the extension and the header
    // are both client-controlled.
    const sniffed = sniffImageContentType(file.buffer)
    if (!sniffed || !ALLOWED_UPLOAD_TYPES.has(sniffed)) {
      return res.status(400).json({ error: 'Upload a JPEG, PNG or WebP photo.' })
    }

    const productId = String(req.body?.productId || '').trim()
    if (!productId) return res.status(400).json({ error: 'productId is required.' })

    const tierName = req.body?.tier === 'premium' ? 'premium' : 'standard'
    const requestedIndex = Number.parseInt(String(req.body?.garmentImageIndex ?? '0'), 10)

    // Resolve the garment from OUR data, never from the request body.
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, category, images, metadata')
      .eq('id', productId)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found.' })
    }

    const gallery = resolveGarmentGallery(product)
    if (!gallery.length) {
      return res.status(422).json({ error: 'This product has no image we can put on you yet.' })
    }
    const garmentImage = gallery[Number.isFinite(requestedIndex) && requestedIndex >= 0 && requestedIndex < gallery.length
      ? requestedIndex
      : 0]

    // --- money gate -------------------------------------------------------
    const gate = await openGate(deps, { userId, tierName })
    if (!gate.allowed) {
      return res.status(402).json({
        error: gate.reason,
        itcCost: gate.itcCost,
        itcBalance: gate.balanceBefore,
        freeUsedToday: true
      })
    }

    const ext = extForImageContentType(sniffed)
    const photoPath = `tryon/${userId}/${crypto.randomUUID()}-model.${ext}`
    let runId: string | null = null

    try {
      await uploadImageFromBuffer(file.buffer, photoPath, sniffed)
      // 60 minutes is all FASHN needs to fetch it. Nothing longer-lived than
      // that is ever handed out for a customer's own photo.
      const modelPhotoUrl = await getSignedUrl(photoPath, 60)

      const { data: runRow } = await supabase
        .from('virtual_tryon_runs')
        .insert({
          user_id: userId,
          product_id: productId,
          tier: gate.tier.featureKey,
          mode: gate.tier.mode,
          status: 'pending',
          model_photo_path: photoPath,
          garment_image_url: garmentImage,
          itc_charged: gate.itcCost,
          used_free_daily: gate.usedFree
        })
        .select('id')
        .single()
      runId = runRow?.id || null

      await recordEvent({
        user_id: userId,
        product_id: productId,
        event_type: 'tryon_started',
        tryon_id: runId,
        metadata: { tier: gate.tier.featureKey, used_free: gate.usedFree }
      })

      const result = await runTryOn({
        modelImage: modelPhotoUrl,
        garmentImage,
        mode: gate.tier.mode,
        numSamples: gate.tier.numSamples,
        category: inferCategory(product),
        garmentPhotoType: 'flat-lay'
      })

      if (!result.ok || !result.images.length) {
        // Nobody pays for a failure — FASHN doesn't bill failed predictions
        // and neither do we.
        await settleFailure(deps, gate)
        if (runId) {
          await supabase
            .from('virtual_tryon_runs')
            .update({
              status: 'failed',
              prediction_id: result.predictionId,
              error: result.error?.slice(0, 500) || 'unknown',
              latency_ms: result.latencyMs,
              completed_at: new Date().toISOString()
            })
            .eq('id', runId)
        }
        await recordEvent({
          user_id: userId,
          product_id: productId,
          event_type: 'tryon_failed',
          tryon_id: runId,
          metadata: { error: result.error?.slice(0, 200) }
        })
        // Clean the photo up rather than leaving a customer's face in a bucket
        // attached to nothing.
        await deleteImage(photoPath).catch(() => {})

        console.error('[tryon] render failed:', result.error)
        return res.status(502).json({
          error: 'The try-on could not be generated. You were not charged.',
          itcBalance: await deps.getWalletBalance(userId)
        })
      }

      // Copy the result into our own bucket — FASHN's CDN URLs expire, and a
      // shopper's try-on history that 404s a week later is worse than none.
      const stored: string[] = []
      const storedPaths: string[] = []
      for (let i = 0; i < result.images.length; i++) {
        try {
          const resultPath = `tryon/${userId}/${crypto.randomUUID()}-result-${i}.jpg`
          const copied = await uploadImageFromUrl(result.images[i], resultPath)
          stored.push(copied.publicUrl)
          storedPaths.push(copied.path)
        } catch {
          stored.push(result.images[i]) // fall back to FASHN's own URL
        }
      }

      const itcBalance = await deps.getWalletBalance(userId)

      if (runId) {
        await supabase
          .from('virtual_tryon_runs')
          .update({
            status: 'completed',
            prediction_id: result.predictionId,
            result_url: stored[0],
            result_urls: stored,
            result_paths: storedPaths,
            credits_used: result.creditsUsed,
            cost_usd: result.costUsd,
            latency_ms: result.latencyMs,
            completed_at: new Date().toISOString()
          })
          .eq('id', runId)
      }

      await recordEvent({
        user_id: userId,
        product_id: productId,
        event_type: 'tryon_completed',
        tryon_id: runId,
        cost_usd: result.costUsd,
        metadata: { tier: gate.tier.featureKey, latency_ms: result.latencyMs, credits: result.creditsUsed }
      })

      return res.json({
        tryonId: runId,
        images: stored,
        imageUrl: stored[0],
        usedFree: gate.usedFree,
        itcCharged: gate.itcCost,
        itcBalance,
        freeRemainingToday: 0,
        tier: gate.tier.featureKey,
        latencyMs: result.latencyMs
      })
    } catch (err: any) {
      await settleFailure(deps, gate).catch(() => {})
      if (runId) {
        await supabase
          .from('virtual_tryon_runs')
          .update({ status: 'failed', error: String(err?.message || err).slice(0, 500) })
          .eq('id', runId)
          .then(() => undefined, () => undefined)
      }
      await deleteImage(photoPath).catch(() => {})
      console.error('[tryon] generate threw:', err?.message || String(err))
      return res.status(500).json({ error: 'The try-on could not be generated. You were not charged.' })
    }
  }
)

// ---------------------------------------------------------------------------
// POST /api/tryon/events — funnel instrumentation from the storefront.
//
// Only the funnel event types are accepted, and cost/value are computed
// server-side; a client that could post its own cost figures could poison the
// exact report the kill decision reads.
// ---------------------------------------------------------------------------
const CLIENT_EVENTS = new Set(['tryon_card_viewed', 'add_to_cart'])

router.post('/events', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id
    const eventType = String(req.body?.eventType || '')
    if (!CLIENT_EVENTS.has(eventType)) {
      return res.status(400).json({ error: 'Unsupported event type.' })
    }

    const productId = req.body?.productId ? String(req.body.productId) : null
    const tryonId = req.body?.tryonId ? String(req.body.tryonId) : null
    const secondsSince = Number.isFinite(Number(req.body?.secondsSinceTryon))
      ? Math.max(0, Math.round(Number(req.body.secondsSinceTryon)))
      : null

    await recordEvent({
      user_id: userId,
      session_id: req.body?.sessionId ? String(req.body.sessionId).slice(0, 100) : null,
      product_id: productId,
      event_type: eventType,
      tryon_id: tryonId,
      attributed_to_tryon: Boolean(tryonId),
      seconds_since_tryon: secondsSince,
      value_usd: 0,
      metadata: { source: 'storefront' }
    })

    return res.json({ ok: true })
  } catch (err: any) {
    console.error('[tryon] events failed:', err?.message || String(err))
    // Instrumentation is never allowed to break the storefront.
    return res.json({ ok: false })
  }
})

// ---------------------------------------------------------------------------
// GET /api/tryon/history
// ---------------------------------------------------------------------------
router.get('/history', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { data } = await supabase
      .from('virtual_tryon_runs')
      .select('id, product_id, result_url, tier, status, created_at')
      .eq('user_id', req.user!.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(20)
    return res.json({ tryons: data || [] })
  } catch (err: any) {
    console.error('[tryon] history failed:', err?.message || String(err))
    return res.status(500).json({ error: 'Could not load your try-ons' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/tryon/:id — the shopper's own delete button. Removes the stored
// photo bytes, not just the row: the UI promises this, so it has to be true.
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id
    const { data: run } = await supabase
      .from('virtual_tryon_runs')
      .select('id, user_id, model_photo_path, result_paths')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single()

    if (!run) return res.status(404).json({ error: 'Try-on not found.' })

    const paths = [run.model_photo_path, ...(Array.isArray(run.result_paths) ? run.result_paths : [])]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    for (const path of paths) {
      await deleteImage(path).catch((e: any) =>
        console.error('[tryon] object delete failed:', path, e?.message || String(e))
      )
    }
    await supabase.from('virtual_tryon_runs').delete().eq('id', run.id).eq('user_id', userId)
    return res.json({ ok: true })
  } catch (err: any) {
    console.error('[tryon] delete failed:', err?.message || String(err))
    return res.status(500).json({ error: 'Could not delete that try-on' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/tryon/analytics — admin. The keep-or-kill report.
// ---------------------------------------------------------------------------
router.get('/analytics', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const [{ data: events }, { data: runs }] = await Promise.all([
      supabase
        .from('virtual_tryon_events')
        .select('user_id, product_id, event_type, value_usd')
        .gte('created_at', since)
        .limit(50_000),
      supabase
        .from('virtual_tryon_runs')
        .select('cost_usd, status, used_free_daily, itc_charged')
        .gte('created_at', since)
        .limit(50_000)
    ])

    const report = summarizeConversion(events || [], runs || [])
    return res.json({
      windowDays: days,
      since,
      fashnCostPerCreditUsd: FASHN_COST_PER_CREDIT_USD,
      ...report
    })
  } catch (err: any) {
    console.error('[tryon] analytics failed:', err?.message || String(err))
    return res.status(500).json({ error: 'Could not build the try-on report' })
  }
})

export default router
