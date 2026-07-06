// Design-library browser: the imported design bundle grouped by collection
// (metadata.collection, e.g. Gaming / Cats / Christmas) with draft/active
// counts, per-collection product grids, and bulk activate/deactivate.
// Companion to backend/scripts/import-designs.mjs.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

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
    return res.json({ products: data || [], total: count ?? 0, offset, page_size: pageSize })
  } catch (error: any) {
    console.error('[design-library] products failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/design-library/set-status
// { status: 'active' | 'draft', collection?: string, product_ids?: string[] }
router.post('/set-status', async (req: Request, res: Response) => {
  try {
    const status = req.body?.status === 'active' ? 'active' : req.body?.status === 'draft' ? 'draft' : null
    if (!status) return res.status(400).json({ error: 'status must be active or draft' })

    let query = supabase
      .from('products')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('metadata->>import_source', 'design-library')
      .neq('status', status)
    if (Array.isArray(req.body?.product_ids) && req.body.product_ids.length > 0) {
      query = query.in('id', req.body.product_ids.slice(0, 500))
    } else if (req.body?.collection) {
      query = query.eq('metadata->>collection', String(req.body.collection))
    } else {
      return res.status(400).json({ error: 'collection or product_ids required' })
    }

    const { data, error } = await query.select('id')
    if (error) throw error
    return res.json({
      updated: data?.length ?? 0,
      note: status === 'active'
        ? 'Live. SEO packs + TikTok outbox drafts generate on the worker within the hour.'
        : 'Back to draft (hidden from storefront).'
    })
  } catch (error: any) {
    console.error('[design-library] set-status failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
