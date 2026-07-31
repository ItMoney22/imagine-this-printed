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

const router = Router()

// Rows carrying the fields the print-quality gate needs.
const SELECT_FOR_GATE = 'id, name, status, metadata'

/** What the admin grid needs to render a design's print verdict. */
const annotate = (product: any) => {
  const verdict = canActivate(product.metadata)
  return {
    ...product,
    print_check: verdict.check,
    quarantine: product.metadata?.quarantine ?? null,
    can_activate: verdict.allowed
  }
}

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

// GET /api/admin/design-library/collections — counts per collection
router.get('/collections', async (_req: Request, res: Response) => {
  try {
    const collections: Record<string, { draft: number; active: number; other: number }> = {}
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
        collections[c] = collections[c] || { draft: 0, active: 0, other: 0 }
        if (p.status === 'draft') collections[c].draft++
        else if (p.status === 'active') collections[c].active++
        else collections[c].other++
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

// GET /api/admin/design-library/products?collection=Gaming&status=draft&offset=0
router.get('/products', async (req: Request, res: Response) => {
  try {
    const collection = String(req.query.collection || '')
    if (!collection) return res.status(400).json({ error: 'collection is required' })
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const pageSize = 60

    let query = supabase
      .from('products')
      .select('id, name, slug, price, status, images, metadata', { count: 'exact' })
      .eq('metadata->>import_source', 'design-library')
      .eq('metadata->>collection', collection)
      .order('name')
      .range(offset, offset + pageSize - 1)
    if (req.query.status && req.query.status !== 'all') query = query.eq('status', String(req.query.status))

    const { data, error, count } = await query
    if (error) throw error
    return res.json({
      products: (data || []).map(annotate),
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

      const { allowed, blocked } = partitionForActivation(candidates || [])

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

      if (!allowed.length) {
        return res.status(422).json({
          error: blocked.length
            ? `All ${blocked.length} design(s) are below print quality and were not activated.`
            : 'Nothing to activate.',
          updated: 0,
          blocked: blocked.map(b => ({ id: b.id, name: b.name, reason: b.check.reason, code: b.check.code }))
        })
      }

      const { data, error } = await supabase
        .from('products')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .in('id', allowed.map(a => a.id))
        .select('id')
      if (error) throw error

      return res.json({
        updated: data?.length ?? 0,
        blocked: blocked.map(b => ({ id: b.id, name: b.name, reason: b.check.reason, code: b.check.code })),
        note: blocked.length
          ? `Live. ${blocked.length} design(s) held back as too low-resolution to print — see the red badge for why. ` +
            'SEO packs + TikTok outbox drafts generate on the worker within the hour.'
          : 'Live. SEO packs + TikTok outbox drafts generate on the worker within the hour.'
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
