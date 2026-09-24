// Flare Lab — POST /api/imagination-station/flare/run
//
// One endpoint, one tool per call (services/flare-studio.ts holds the recipes).
// Mounted under /api/imagination-station so the aiLimiter family limit in
// index.ts already covers it.
//
// Billing mirrors the other Imagination Station tools: ITC is taken up front
// and refunded in full if the model call fails, so nobody pays for an error.
// Admins run it free — it is the house authoring tool (team templates, product
// clean-up) as much as a customer one.
import express, { type Request, type Response } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { getCachedRole } from '../lib/role-cache.js'
import { pricingService } from '../services/imagination-pricing.js'
import { flareCost, runFlare, validateFlareRequest, FLARE_ITC, MAX_REFS, MAX_VARIATIONS } from '../services/flare-studio.js'
import { readLettering } from '../services/lettering-check.js'

const router = express.Router()

/** GET /pricing — the per-image ITC by quality tier, so the UI prices before it asks. */
router.get('/pricing', (_req: Request, res: Response) => {
  res.json({ perImage: FLARE_ITC, largeMultiplier: 1.5, maxRefs: MAX_REFS, maxVariations: MAX_VARIATIONS })
})

router.post('/run', requireAuth, async (req: Request, res: Response): Promise<any> => {
  const userId = req.user?.sub
  if (!userId) return res.status(401).json({ error: 'Sign in to use Flare Lab' })

  const parsed = validateFlareRequest(req.body)
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })
  const flare = parsed.req

  const role = await getCachedRole(userId).catch(() => null)
  const cost = role === 'admin' ? 0 : flareCost(flare)

  if (cost > 0) {
    try {
      await pricingService.deductITC(userId, cost, `flare_${flare.op}_${flare.quality}`)
    } catch (err: any) {
      const insufficient = /insufficient/i.test(err?.message ?? '')
      return res
        .status(insufficient ? 402 : 500)
        .json({ error: insufficient ? `This needs ${cost} ITC — top up your wallet to run it.` : 'Could not charge your wallet', cost })
    }
  }

  try {
    const started = Date.now()
    const result = await runFlare(flare, userId)
    req.log?.info?.(
      { op: flare.op, quality: flare.quality, n: result.images.length, size: result.size, ms: Date.now() - started, model: result.images[0]?.modelId },
      'flare-lab run'
    )
    // Fewer images than asked (the API can return short) — refund the difference.
    const short = flare.variations - result.images.length
    let charged = cost
    if (cost > 0 && short > 0) {
      const refund = Math.floor((cost / flare.variations) * short)
      if (refund > 0) {
        await pricingService.refundITC(userId, refund, `flare_${flare.op}_short`)
        charged -= refund
      }
    }
    // Text Swap is about spelling — read every result back (live 2026-09-24
    // Flare drew "SMTH" for "SMITH"). The operator sees the verdict per image.
    if (flare.op === 'text' && flare.textTo) {
      const verdicts = await Promise.all(result.images.map((i) => readLettering(i.url, [flare.textTo])))
      result.images = result.images.map((i, k) => ({ ...i, lettering: verdicts[k] }))
    }
    return res.json({ ...result, op: flare.op, cost: charged })
  } catch (err: any) {
    if (cost > 0) await pricingService.refundITC(userId, cost, `flare_${flare.op}_failed`).catch(() => {})
    req.log?.error?.({ err, op: flare.op }, 'flare-lab run failed')
    const msg = String(err?.message ?? 'Flare could not finish that')
    const blocked = /safety|moderation|content_policy/i.test(msg)
    return res.status(blocked ? 422 : 500).json({
      error: blocked ? 'The image model declined this edit. Try rewording it.' : msg,
      refunded: cost,
    })
  }
})

export default router
