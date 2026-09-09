// Design-library browser: the imported design bundle grouped by collection
// (metadata.collection, e.g. Gaming / Cats / Christmas) with draft/active
// counts, per-collection product grids, and bulk activate/deactivate.
// Companion to backend/scripts/import-designs.mjs.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'
import {
  checkPrintability,
  canActivate,
  partitionForActivation,
  quarantineRecord,
  releaseQuarantine,
  requiredShortEdgePx,
  minDpiFor,
  MIN_PRINT_INCHES
} from '../../services/design-library-quality.js'
import { partitionByQa, evaluateGate } from '../../services/design-qa-gate.js'
// "Which of these am I already part-way through building?" — see that module
// for why the rules mirror the builder's own step gate.
import { isInStepFlow, stepFlowStage, STAGE_LABELS, type StepFlowStage } from '../../services/step-flow/progress.js'

const router = Router()

// Rows carrying the fields the print-quality gate needs.
const SELECT_FOR_GATE = 'id, name, status, metadata'

/** What the admin grid needs to render a design's print + presentation verdicts.
 *  `hasNobg` says whether this design's background-removal output exists — the
 *  grid's caller looks that up for the whole page in one query (see below),
 *  because it is what separates "still cutting" from "ready to pick a shirt". */
const annotate = (product: any, hasNobg = false) => {
  const verdict = canActivate(product.metadata)
  const qa = evaluateGate(product.metadata, 'storefront')
  const stage = stepFlowStage(product.metadata, product.status, hasNobg)
  return {
    ...product,
    print_check: verdict.check,
    quarantine: product.metadata?.quarantine ?? null,
    qa_gate: { allowed: qa.allowed, code: qa.code, reason: qa.reason, stamp: qa.stamp },
    // Both gates must pass. They are reported separately because the fixes are
    // completely different: re-export the artwork bigger vs rewrite the listing.
    can_activate: verdict.allowed && qa.allowed,
    // Null for a design nobody has started on. Non-null means it has left the
    // "to do" pile and is a build in progress (or finished) — the grid shows
    // where to pick it back up instead of offering it again as fresh work.
    step_flow: stage ? { stage, label: STAGE_LABELS[stage as StepFlowStage] } : null
  }
}

/** Which of these products have a background-removal output — one query for a
 *  whole page rather than one per card. */
async function nobgProductIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data } = await supabase.from('product_assets').select('product_id').eq('kind', 'nobg').in('product_id', ids)
  return new Set((data || []).map((r: any) => r.product_id))
}

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

// GET /api/admin/design-library/collections — counts per collection
router.get('/collections', async (_req: Request, res: Response) => {
  try {
    // `todo` and `in_flow` split what `draft` used to lump together, so the
    // sidebar count agrees with the grid's default view instead of promising
    // 50 designs to work on when three of them are already half-built.
    // `draft` is kept as the raw column total for the unchanged Draft view.
    const collections: Record<string, { draft: number; todo: number; in_flow: number; active: number; other: number }> = {}
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from('products')
        .select('status, metadata')
        .eq('metadata->>import_source', 'design-library')
        .range(from, from + 999)
      if (error) throw error
      for (const p of data || []) {
        const c = p.metadata?.collection || 'Uncategorized'
        collections[c] = collections[c] || { draft: 0, todo: 0, in_flow: 0, active: 0, other: 0 }
        const inFlow = isInStepFlow(p.metadata)
        if (p.status === 'draft') {
          collections[c].draft++
          if (inFlow) collections[c].in_flow++
          else collections[c].todo++
        } else if (p.status === 'active') {
          collections[c].active++
        } else {
          collections[c].other++
          if (inFlow) collections[c].in_flow++
        }
      }
      if (!data || data.length < 1000) break
      from += 1000
    }
    const list = Object.entries(collections)
      .map(([name, counts]) => ({ name, ...counts, total: counts.draft + counts.active + counts.other }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return res.json({ collections: list })
  } catch (error: any) {
    console.error('[design-library] collections failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// The jsonb path `approvals.design` is stamped the moment a design is selected,
// so it is the same signal isInStepFlow() reads — expressed here as a filter so
// the exclusion happens IN SQL. Doing it after the fact would corrupt both the
// page count and the paging, since `.range()` has already been applied.
//
// The last hop is `->>` (text) rather than `->` (jsonb) deliberately: that is
// the extraction form already proven against this project's PostgREST by the
// `metadata->>import_source` filter two lines below every use of it. Either
// reads as SQL NULL when any level of the path is missing, which is exactly
// what "never entered the flow" looks like.
const IN_FLOW_PATH = 'metadata->step_flow->approvals->>design'

/** Real `products.status` values the grid may be asked to filter on directly. */
const RAW_STATUSES = new Set(['draft', 'active', 'pending_approval', 'incomplete', 'rejected'])

// GET /api/admin/design-library/products?collection=Gaming&status=todo&offset=0
//
// `status` is the grid's view, not the raw products.status column:
//   todo     designs nobody has started — draft AND not in the Step Flow.
//            This is the default and the one that answers David's "so we dont
//            do the same ones twice": a design leaves this pile the instant it
//            is pulled into the flow.
//   in_flow  part-way through a build; the grid shows where to pick it up.
//   active   live on the storefront.
//   draft    the raw column, in-flow ones included (the old behaviour).
//   all      everything, with an in-flow badge to tell them apart.
router.get('/products', async (req: Request, res: Response) => {
  try {
    const collection = String(req.query.collection || '')
    if (!collection) return res.status(400).json({ error: 'collection is required' })
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const pageSize = 60
    const view = String(req.query.status || 'all')

    let query = supabase
      .from('products')
      .select('id, name, slug, price, status, images, metadata', { count: 'exact' })
      .eq('metadata->>import_source', 'design-library')
      .eq('metadata->>collection', collection)
      .order('name')
      .range(offset, offset + pageSize - 1)

    if (view === 'todo') {
      query = query.eq('status', 'draft').is(IN_FLOW_PATH, null)
    } else if (view === 'in_flow') {
      // Published builds are no longer "in progress" — they show under active.
      query = query.not(IN_FLOW_PATH, 'is', null).neq('status', 'active')
    } else if (RAW_STATUSES.has(view)) {
      query = query.eq('status', view)
    }
    // Anything else (including a view name from a NEWER frontend than this
    // API) deliberately falls through to "all". Filtering on an unrecognized
    // value would answer with an empty grid and no error, which reads as "my
    // designs are gone" — showing everything is the safe failure.

    const { data, error, count } = await query
    if (error) throw error
    const rows = data || []
    const nobg = await nobgProductIds(rows.map((r: any) => r.id))
    return res.json({
      products: rows.map((r: any) => annotate(r, nobg.has(r.id))),
      total: count ?? 0,
      offset,
      page_size: pageSize,
      print_rule: { min_dpi: minDpiFor(), min_print_inches: MIN_PRINT_INCHES, required_px: requiredShortEdgePx() }
    })
  } catch (error: any) {
    console.error('[design-library] products failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/design-library/set-status
// { status: 'active' | 'draft', collection?: string, product_ids?: string[] }
//
// Going ACTIVE runs the print-quality gate first: artwork with too few pixels
// to print at the print type's minDPI is held back and stamped with the reason,
// so a bulk "Activate collection" can never push a design a customer would
// receive blurry. Going back to DRAFT needs no gate.
router.post('/set-status', async (req: Request, res: Response) => {
  try {
    const status = req.body?.status === 'active' ? 'active' : req.body?.status === 'draft' ? 'draft' : null
    if (!status) return res.status(400).json({ error: 'status must be active or draft' })

    const productIds: string[] = Array.isArray(req.body?.product_ids) ? req.body.product_ids.slice(0, 500) : []
    const collection = req.body?.collection ? String(req.body.collection) : null
    if (!productIds.length && !collection) {
      return res.status(400).json({ error: 'collection or product_ids required' })
    }

    const scope = <T extends { eq: any; in: any }>(q: T): T =>
      (productIds.length ? q.in('id', productIds) : q.eq('metadata->>collection', collection)) as T

    if (status === 'active') {
      const { data: candidates, error: readError } = await scope(
        supabase
          .from('products')
          .select(SELECT_FOR_GATE)
          .eq('metadata->>import_source', 'design-library')
          .neq('status', 'active')
      ).limit(1000)
      if (readError) throw readError

      const { allowed: printOk, blocked } = partitionForActivation(candidates || [])

      // Stamp WHY on every held-back row so it is discoverable later instead of
      // the design just quietly never going live.
      const actor = req.user?.email || req.user?.id || 'admin'
      for (const row of blocked) {
        const { error: stampError } = await supabase
          .from('products')
          .update({
            metadata: { ...(row.product.metadata || {}), quarantine: quarantineRecord(row.check, actor) },
            updated_at: new Date().toISOString()
          })
          .eq('id', row.id)
        if (stampError) console.error(`[design-library] quarantine stamp failed for ${row.id}:`, stampError.message)
      }

      // SECOND GATE: presentation QA. A design can print beautifully and still
      // be a listing nobody clicks — blurry mockups, an off-centre print,
      // keyword-stuffed copy, a price with a slipped decimal. Watchtower task
      // 9ec9444a: nothing goes live without passing this too. Reported as its
      // own list because "re-export the art bigger" and "rewrite the listing"
      // go to different people.
      const { allowed, blocked: qaBlocked } = partitionByQa(printOk, 'storefront')

      const heldBack = [
        ...blocked.map(b => ({ id: b.id, name: b.name, reason: b.check.reason, code: b.check.code, gate: 'print' as const })),
        ...qaBlocked.map(b => ({ id: b.id, name: b.name, reason: b.reason, code: b.code, gate: 'presentation' as const }))
      ]

      if (!allowed.length) {
        return res.status(422).json({
          error: heldBack.length
            ? `All ${heldBack.length} design(s) were held back — ${blocked.length} below print quality, ${qaBlocked.length} not through the presentation QA gate.`
            : 'Nothing to activate.',
          updated: 0,
          blocked: heldBack
        })
      }

      const { data, error } = await supabase
        .from('products')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .in('id', allowed.map(a => a.id))
        .select('id')
      if (error) throw error

      const notes: string[] = ['Live.']
      if (blocked.length) notes.push(`${blocked.length} held back as too low-resolution to print — see the red badge for why.`)
      if (qaBlocked.length) notes.push(`${qaBlocked.length} held back by the presentation QA gate — run QA from the design's QA panel to see what to fix.`)
      notes.push('SEO packs + TikTok outbox drafts generate on the worker within the hour.')

      return res.json({
        updated: data?.length ?? 0,
        blocked: heldBack,
        note: notes.join(' ')
      })
    }

    const { data, error } = await scope(
      supabase
        .from('products')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('metadata->>import_source', 'design-library')
        .neq('status', status)
    ).select('id')
    if (error) throw error
    return res.json({ updated: data?.length ?? 0, blocked: [], note: 'Back to draft (hidden from storefront).' })
  } catch (error: any) {
    console.error('[design-library] set-status failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/admin/design-library/quarantined — every library design that cannot
// go live, with the reason. The "where did my design go" answer.
router.get('/quarantined', async (_req: Request, res: Response) => {
  try {
    const blocked: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, slug, status, images, metadata')
        .eq('metadata->>import_source', 'design-library')
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      for (const product of data || []) {
        const verdict = canActivate(product.metadata)
        if (verdict.allowed) continue
        blocked.push({
          id: product.id,
          name: product.name,
          slug: product.slug,
          status: product.status,
          images: product.images,
          collection: product.metadata?.collection ?? null,
          image: product.metadata?.image ?? null,
          quarantine: product.metadata?.quarantine ?? null,
          print_check: verdict.check
        })
      }
      if (!data || data.length < 1000) break
      from += 1000
    }
    return res.json({
      products: blocked,
      total: blocked.length,
      print_rule: { min_dpi: minDpiFor(), min_print_inches: MIN_PRINT_INCHES, required_px: requiredShortEdgePx() }
    })
  } catch (error: any) {
    console.error('[design-library] quarantined failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/design-library/quarantine/release
// { product_ids: string[], reason: string }
// Reversible by design: the override is recorded alongside the original reason,
// never instead of it.
router.post('/quarantine/release', async (req: Request, res: Response) => {
  try {
    const productIds: string[] = Array.isArray(req.body?.product_ids) ? req.body.product_ids.slice(0, 500) : []
    const reason = String(req.body?.reason || '').trim()
    if (!productIds.length) return res.status(400).json({ error: 'product_ids required' })
    if (reason.length < 4) return res.status(400).json({ error: 'reason required — record why this design may print small' })

    const { data, error } = await supabase
      .from('products')
      .select(SELECT_FOR_GATE)
      .eq('metadata->>import_source', 'design-library')
      .in('id', productIds)
    if (error) throw error

    const actor = req.user?.email || req.user?.id || 'admin'
    let released = 0
    for (const product of data || []) {
      const metadata = product.metadata || {}
      const record = releaseQuarantine(
        metadata.quarantine ?? quarantineRecord(checkPrintability(metadata), actor),
        actor,
        reason
      )
      const { error: updateError } = await supabase
        .from('products')
        .update({ metadata: { ...metadata, quarantine: record }, updated_at: new Date().toISOString() })
        .eq('id', product.id)
      if (updateError) console.error(`[design-library] release failed for ${product.id}:`, updateError.message)
      else released++
    }

    return res.json({ released, note: 'These designs can now be activated. The original reason is kept on the record.' })
  } catch (error: any) {
    console.error('[design-library] quarantine release failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
