/**
 * Vendor payout endpoints — the real ledger behind /vendor/payouts.
 *
 * Stripe Connect *account* concerns (status, create-account, onboarding-link)
 * are deliberately NOT duplicated here: one Express account per user already
 * lives in stripe_connect_accounts and is served by /api/wallet/connect/*,
 * which the vendor page calls directly. Only the vendor money movement — which
 * draws on sales earnings rather than an ITC wallet balance — is new.
 */

import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireVendorOrAdmin } from '../middleware/requireVendorOrAdmin.js'
import {
  accrueVendorPayouts,
  listVendorPayouts,
  summarizeVendorPayouts,
  getVendorPayoutAnalytics,
  processVendorPayout,
  payoutConfig
} from '../services/vendor-payouts.js'

const router = Router()

/**
 * Accrual is lazy, so every read sweeps first. A sweep failure must not blank
 * the page — the already-recorded ledger is still worth showing.
 */
async function sweep(vendorId: string, req: Request): Promise<void> {
  try {
    const created = await accrueVendorPayouts(vendorId)
    if (created > 0) {
      req.log?.info?.({ vendorId, created }, '[vendor-payouts] accrued new ledger rows')
    }
  } catch (error: any) {
    req.log?.error?.({ err: error, vendorId }, '[vendor-payouts] accrual sweep failed')
  }
}

/** GET /api/vendor/payouts — real payout ledger for the signed-in vendor. */
router.get('/payouts', requireAuth, requireVendorOrAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const vendorId = req.user!.sub
    await sweep(vendorId, req)

    const { status, startDate, endDate, limit, offset } = req.query
    const payouts = await listVendorPayouts(vendorId, {
      status: typeof status === 'string' && status !== 'all' ? status : undefined,
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    })

    return res.json({ ok: true, payouts })
  } catch (error: any) {
    req.log?.error?.({ err: error }, '[vendor-payouts] list failed')
    return res.status(500).json({ error: error.message || 'Failed to load payouts' })
  }
})

/** GET /api/vendor/payouts/summary — totals + fee config, all from the ledger. */
router.get('/payouts/summary', requireAuth, requireVendorOrAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const vendorId = req.user!.sub
    await sweep(vendorId, req)
    const summary = await summarizeVendorPayouts(vendorId)
    return res.json({ ok: true, summary })
  } catch (error: any) {
    req.log?.error?.({ err: error }, '[vendor-payouts] summary failed')
    return res.status(500).json({ error: error.message || 'Failed to load payout summary' })
  }
})

/** GET /api/vendor/payouts/analytics?period=week|month|year */
router.get('/payouts/analytics', requireAuth, requireVendorOrAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const vendorId = req.user!.sub
    const raw = String(req.query.period || 'week')
    const period = raw === 'month' || raw === 'year' ? raw : 'week'
    const analytics = await getVendorPayoutAnalytics(vendorId, period)
    return res.json({ ok: true, analytics })
  } catch (error: any) {
    req.log?.error?.({ err: error }, '[vendor-payouts] analytics failed')
    return res.status(500).json({ error: error.message || 'Failed to load payout analytics' })
  }
})

/** POST /api/vendor/payouts/request — real Stripe Connect transfer + payout. */
router.post('/payouts/request', requireAuth, requireVendorOrAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const vendorId = req.user!.sub
    await sweep(vendorId, req)

    const raw = req.body?.amount
    const amount = raw === undefined || raw === null || raw === '' ? undefined : Number(raw)
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ error: 'Invalid payout amount' })
    }

    const result = await processVendorPayout(vendorId, amount)
    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    req.log?.info?.(
      { vendorId, batchId: result.batchId, amount: result.amount, transferId: result.transferId },
      '[vendor-payouts] payout processed'
    )

    return res.json({
      ok: true,
      batchId: result.batchId,
      transferId: result.transferId,
      payoutId: result.payoutId,
      amount: result.amount,
      payoutCount: result.payoutCount,
      warning: result.warning,
      message: result.warning
        || `Payout of $${(result.amount || 0).toFixed(2)} sent to your Stripe account.`
    })
  } catch (error: any) {
    req.log?.error?.({ err: error }, '[vendor-payouts] request failed')
    return res.status(500).json({ error: error.message || 'Failed to request payout' })
  }
})

/** GET /api/vendor/payouts/config — fee split + minimum, so the UI never hardcodes them. */
router.get('/payouts/config', requireAuth, requireVendorOrAdmin, async (_req: Request, res: Response): Promise<any> => {
  return res.json({ ok: true, config: payoutConfig() })
})

export default router
