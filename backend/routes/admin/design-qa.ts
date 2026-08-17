// ---------------------------------------------------------------------------
// Design QA gate API — mounted at /api/admin/design-qa.
//
// This is the contract the design pipeline is built against. Three audiences,
// one surface:
//
//   THE DESIGNER AGENT (Watchtower f95ad58d) — the feedback loop.
//     GET  /rework            what failed and exactly what to change
//     POST /submit/:productId resubmit after rework (creates submission N+1)
//     GET  /rules             the thresholds, so it can self-check before
//                             spending a render on something that will bounce
//
//   THE ETSY SCOUT AGENT (Watchtower 12d1c31d) — same endpoints, channel=etsy.
//
//   AN ADMIN — the same data, plus /override for the call only a human makes.
//
// The agents authenticate with DESIGN_AGENT_TOKEN + x-agent-id; admins with
// their normal session. See middleware/requireQaActor.ts.
//
// NOTE there is deliberately no endpoint that MARKS a design as passed. The
// only way to pass is to be reviewed, which is why design_qa_reviews carries no
// INSERT grant for `authenticated`.
// ---------------------------------------------------------------------------
import { Router, Request, Response } from 'express'
import { requireQaActor } from '../../middleware/requireQaActor.js'
import { supabase } from '../../lib/supabase.js'
import {
  submitForQa,
  reviewHistory,
  overrideQa,
  checkGate,
  type Channel
} from '../../services/design-qa-gate.js'
import {
  CRITERIA,
  SEO_RULES,
  PRICE_BANDS,
  DEFAULT_PRICE_BAND,
  MIN_SHORT_EDGE_PX,
  WARN_SHORT_EDGE_PX,
  MIN_SHARPNESS,
  WARN_SHARPNESS,
  MIN_MOCKUPS,
  WARN_MOCKUPS,
  HOOK_MAX_CHARS,
  DESCRIPTION_MIN_CHARS,
  MAX_TAG_CHARS,
  MAX_TITLE_COMMAS,
  VISION_REQUIRED
} from '../../services/presentation-qa.js'

const router = Router()
router.use(requireQaActor)

const channelOf = (v: unknown): Channel => (String(v) === 'etsy' ? 'etsy' : 'storefront')

/**
 * GET /api/admin/design-qa/rules
 *
 * The gate's published criteria. An agent that reads this before rendering
 * spends nothing on work that was always going to bounce, and — more
 * importantly — there is exactly ONE definition of "good enough" in the system
 * rather than one per agent that quietly drift apart.
 */
router.get('/rules', (_req: Request, res: Response) => {
  return res.json({
    criteria: CRITERIA,
    images: {
      min_short_edge_px: MIN_SHORT_EDGE_PX,
      recommended_short_edge_px: WARN_SHORT_EDGE_PX,
      min_sharpness: MIN_SHARPNESS,
      warn_sharpness: WARN_SHARPNESS,
      min_photos: MIN_MOCKUPS,
      recommended_photos: WARN_MOCKUPS,
      sharpness_note:
        'Variance of the Laplacian measured at a 512px short edge. Calibrated against the live catalogue ' +
        '(median ~900, worst real image 186); a visibly blurred or heavily upscaled render lands under 100.'
    },
    seo: {
      ...SEO_RULES,
      hook_max_chars: HOOK_MAX_CHARS,
      description_min_chars: DESCRIPTION_MIN_CHARS,
      max_tag_chars: MAX_TAG_CHARS,
      max_title_commas: MAX_TITLE_COMMAS
    },
    pricing: { bands: PRICE_BANDS, default_band: DEFAULT_PRICE_BAND },
    vision_required: VISION_REQUIRED
  })
})

/**
 * POST /api/admin/design-qa/submit/:productId
 * Body: { channel?: 'storefront' | 'etsy' }
 *
 * Submit — or RESUBMIT — a design presentation for review. Every call creates a
 * new numbered submission, so the history shows the rework rounds.
 */
router.post('/submit/:productId', async (req: Request, res: Response) => {
  try {
    const channel = channelOf(req.body?.channel)
    const result = await submitForQa({
      productId: req.params.productId,
      channel,
      submittedBy: req.qaActor?.id || 'unknown'
    })
    return res.status(result.verdict.status === 'passed' ? 200 : 422).json({
      product_id: req.params.productId,
      channel,
      review_id: result.reviewId,
      submission_no: result.submissionNo,
      status: result.verdict.status,
      score: result.verdict.score,
      blocking: result.verdict.blockingCount,
      warnings: result.verdict.warningCount,
      criteria: result.verdict.criteria,
      rework: result.verdict.rework,
      model: result.verdict.model,
      duration_ms: result.verdict.durationMs
    })
  } catch (error: any) {
    console.error('[design-qa] submit failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/design-qa/submit
 * Body: { product_ids: string[], channel?: 'storefront' | 'etsy' }
 *
 * Batch submission for the daily designer's end-of-run sweep. Reviews run
 * SEQUENTIALLY on purpose: each one makes up to two vision calls, and firing
 * fifty at once would rate-limit the same key the render pipeline is using.
 */
router.post('/submit', async (req: Request, res: Response) => {
  try {
    const channel = channelOf(req.body?.channel)
    const ids: string[] = Array.isArray(req.body?.product_ids) ? req.body.product_ids.slice(0, 50) : []
    if (!ids.length) return res.status(400).json({ error: 'product_ids required (max 50)' })

    const results: any[] = []
    for (const productId of ids) {
      try {
        const r = await submitForQa({ productId, channel, submittedBy: req.qaActor?.id || 'unknown' })
        results.push({
          product_id: productId,
          review_id: r.reviewId,
          submission_no: r.submissionNo,
          status: r.verdict.status,
          score: r.verdict.score,
          rework: r.verdict.rework
        })
      } catch (e: any) {
        results.push({ product_id: productId, status: 'error', error: String(e?.message || e).slice(0, 300) })
      }
    }

    return res.json({
      channel,
      reviewed: results.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      errored: results.filter(r => r.status === 'error').length,
      results
    })
  } catch (error: any) {
    console.error('[design-qa] batch submit failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/design-qa/rework?channel=etsy&limit=25&agent=daily-designer
 *
 * THE FEEDBACK LOOP. Every design whose latest review failed, newest first,
 * with the exact actionable items. A designer agent's run loop is:
 *   GET /rework -> fix the top item -> POST /submit/:id -> repeat.
 *
 * `agent` filters to submissions that agent made, so the daily designer works
 * its own backlog instead of the scout's.
 */
router.get('/rework', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel ? channelOf(req.query.channel) : null
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25))
    const agent = req.query.agent ? String(req.query.agent) : null

    // Pull recent reviews and keep only the latest per (product, channel) —
    // an older failure that has since been fixed is not rework.
    let query = supabase
      .from('design_qa_reviews')
      .select('id, product_id, channel, submission_no, status, score, rework, submitted_by, created_at')
      .order('created_at', { ascending: false })
      .limit(600)
    if (channel) query = query.eq('channel', channel)
    if (agent) query = query.eq('submitted_by', agent)
    const { data, error } = await query
    if (error) throw error

    const latest = new Map<string, any>()
    for (const row of data ?? []) {
      const key = `${row.product_id}:${row.channel}`
      if (!latest.has(key)) latest.set(key, row)
    }
    const failing = [...latest.values()].filter(r => r.status === 'failed').slice(0, limit)
    if (!failing.length) return res.json({ total: 0, items: [] })

    const { data: products } = await supabase
      .from('products')
      .select('id, name, slug, status, category, images')
      .in('id', failing.map(r => r.product_id))
    const byId = new Map((products ?? []).map(p => [p.id, p]))

    return res.json({
      total: failing.length,
      items: failing.map(r => {
        const product = byId.get(r.product_id)
        const items: any[] = Array.isArray(r.rework) ? r.rework : []
        return {
          product_id: r.product_id,
          name: product?.name ?? null,
          slug: product?.slug ?? null,
          category: product?.category ?? null,
          thumbnail: Array.isArray(product?.images) ? product?.images[0] ?? null : null,
          channel: r.channel,
          review_id: r.id,
          submission_no: r.submission_no,
          score: r.score,
          failed_at: r.created_at,
          last_submitted_by: r.submitted_by,
          // Blocking items are the ones that must be fixed to pass; warnings
          // ride along because a designer already in the file may as well fix
          // both, but they are labelled so nothing is confused about which is
          // holding the design back.
          blocking: items.filter(i => i.severity === 'block'),
          warnings: items.filter(i => i.severity !== 'block'),
          resubmit: `POST /api/admin/design-qa/submit/${r.product_id}`
        }
      })
    })
  } catch (error: any) {
    console.error('[design-qa] rework queue failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/design-qa/product/:productId?channel=etsy
 *
 * One design's full audit trail: current gate verdict plus every submission.
 */
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel ? channelOf(req.query.channel) : undefined
    const [history, gate] = await Promise.all([
      reviewHistory(req.params.productId, channel),
      checkGate(req.params.productId, channel ?? 'storefront')
    ])
    return res.json({
      product_id: req.params.productId,
      gate: { allowed: gate.allowed, code: gate.code, reason: gate.reason, stamp: gate.stamp },
      submissions: history.length,
      history
    })
  } catch (error: any) {
    console.error('[design-qa] history failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/design-qa/summary?channel=storefront
 *
 * Counts for the admin header: how much is waiting, how much is clean, and
 * whether the pass rate is moving.
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel ? channelOf(req.query.channel) : null
    let query = supabase
      .from('design_qa_reviews')
      .select('product_id, channel, status, score, created_at, submission_no')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (channel) query = query.eq('channel', channel)
    const { data, error } = await query
    if (error) throw error

    const latest = new Map<string, any>()
    for (const row of data ?? []) {
      const key = `${row.product_id}:${row.channel}`
      if (!latest.has(key)) latest.set(key, row)
    }
    const rows = [...latest.values()]
    const passed = rows.filter(r => r.status === 'passed')
    const scored = rows.filter(r => Number.isFinite(Number(r.score)))

    return res.json({
      channel: channel ?? 'all',
      designs_reviewed: rows.length,
      passed: passed.length,
      failed: rows.filter(r => r.status === 'failed').length,
      overridden: rows.filter(r => r.status === 'overridden').length,
      pass_rate: rows.length ? Math.round((passed.length / rows.length) * 100) : null,
      average_score: scored.length ? Math.round(scored.reduce((a, r) => a + Number(r.score), 0) / scored.length) : null,
      // First-pass rate is the number that actually says whether the pipeline
      // is producing good work, as opposed to eventually being beaten into it.
      first_pass_rate: rows.length
        ? Math.round((rows.filter(r => r.status === 'passed' && r.submission_no === 1).length / rows.length) * 100)
        : null,
      total_submissions: (data ?? []).length
    })
  } catch (error: any) {
    console.error('[design-qa] summary failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/design-qa/override/:productId
 * Body: { reason: string, channel?: 'storefront' | 'etsy' }
 *
 * A human knowingly ships a failure. Admins only — an agent must never be able
 * to wave its own work through, which would make the gate ornamental. The
 * original findings are preserved on the new row alongside who overrode them.
 */
router.post('/override/:productId', async (req: Request, res: Response) => {
  try {
    if (req.qaActor?.kind !== 'admin') {
      return res.status(403).json({ error: 'Only a human admin can override the QA gate.' })
    }
    const reason = String(req.body?.reason || '').trim()
    if (reason.length < 10) {
      return res.status(400).json({ error: 'reason required (at least 10 characters) — record why this ships despite failing.' })
    }
    const result = await overrideQa({
      productId: req.params.productId,
      channel: channelOf(req.body?.channel),
      by: req.qaActor.id,
      reason
    })
    return res.json({
      product_id: req.params.productId,
      review_id: result.reviewId,
      submission_no: result.submissionNo,
      status: 'overridden',
      note: 'This design may now go live. The original findings are kept on the record.'
    })
  } catch (error: any) {
    console.error('[design-qa] override failed:', error)
    return res.status(400).json({ error: error.message })
  }
})

export default router
