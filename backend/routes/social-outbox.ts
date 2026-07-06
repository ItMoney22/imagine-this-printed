// Social outbox — the review-gated TikTok queue.
//
// Flow: designs going active auto-enqueue a DRAFT (see services/seo-pack.ts);
// David edits/approves items in the admin Outbox tab; Rico (Watchtower browser
// agent) claims APPROVED items through the bridge endpoints, posts / edits the
// Shop listing in a real browser, and reports the result back.
//
// Admin endpoints:  requireAuth + admin/manager.
// Bridge endpoints: Bearer PRINT_BRIDGE_TOKEN (same seam as the print factory).
import { Router, Request, Response, NextFunction } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

function requireBridgeAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.PRINT_BRIDGE_TOKEN
  if (!token) {
    res.status(500).json({ error: 'PRINT_BRIDGE_TOKEN not configured' })
    return
  }
  if ((req.headers.authorization || '') !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// ---------------------------------------------------------------------------
// Bridge (Rico) — declared before the admin router.use guards
// ---------------------------------------------------------------------------

// GET /api/social-outbox/bridge/next?kind=post|listing — claim oldest approved
router.get('/bridge/next', requireBridgeAuth, async (req: Request, res: Response) => {
  try {
    const kind = req.query.kind === 'listing' ? 'listing' : req.query.kind === 'post' ? 'post' : null
    let query = supabase
      .from('social_outbox')
      .select('*, products(name, slug, price, images, description)')
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .limit(1)
    if (kind) query = query.eq('kind', kind)
    const { data, error } = await query
    if (error) throw error
    const item = data?.[0]
    if (!item) return res.json({ item: null })

    const { error: claimError } = await supabase
      .from('social_outbox')
      .update({ status: 'claimed', claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'approved') // lost race → someone else claimed
    if (claimError) throw claimError
    return res.json({ item: { ...item, status: 'claimed' } })
  } catch (error: any) {
    console.error('[social-outbox] bridge/next failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social-outbox/bridge/:id/result  { ok, post_url?, note? }
router.post('/bridge/:id/result', requireBridgeAuth, async (req: Request, res: Response) => {
  try {
    const ok = Boolean(req.body?.ok)
    const updates: Record<string, any> = {
      status: ok ? 'posted' : 'failed',
      result_note: req.body?.note ? String(req.body.note).slice(0, 500) : null,
      updated_at: new Date().toISOString()
    }
    if (ok) {
      updates.posted_at = new Date().toISOString()
      if (req.body?.post_url) updates.post_url = String(req.body.post_url)
    }
    const { data, error } = await supabase
      .from('social_outbox')
      .update(updates)
      .eq('id', req.params.id)
      .eq('status', 'claimed')
      .select('id')
    if (error) throw error
    if (!data?.length) return res.status(409).json({ error: 'Item not in claimed state' })
    return res.json({ success: true })
  } catch (error: any) {
    console.error('[social-outbox] bridge/result failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Stale-claim recovery: claimed > 2h without a result → back to approved.
// Called opportunistically from the admin list endpoint (no cron needed).
async function requeueStaleClaims(): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('social_outbox')
    .update({ status: 'approved', claimed_at: null, updated_at: new Date().toISOString() })
    .eq('status', 'claimed')
    .lt('claimed_at', twoHoursAgo)
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

// GET /api/social-outbox?status=draft
router.get('/', async (req: Request, res: Response) => {
  try {
    await requeueStaleClaims()
    let query = supabase
      .from('social_outbox')
      .select('*, products(name, slug, images)')
      .order('created_at', { ascending: false })
      .limit(200)
    if (req.query.status) query = query.eq('status', String(req.query.status))
    const { data, error } = await query
    if (error) throw error

    const { data: all } = await supabase.from('social_outbox').select('status')
    const counts: Record<string, number> = {}
    for (const row of all || []) counts[row.status] = (counts[row.status] || 0) + 1
    return res.json({ items: data || [], counts })
  } catch (error: any) {
    console.error('[social-outbox] list failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// PUT /api/social-outbox/:id — edit caption/hashtags/listing while draft/approved/failed
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if ('caption' in req.body) updates.caption = String(req.body.caption ?? '')
    if ('hashtags' in req.body && Array.isArray(req.body.hashtags)) updates.hashtags = req.body.hashtags.map(String)
    if ('listing' in req.body && req.body.listing && typeof req.body.listing === 'object') updates.listing = req.body.listing
    if ('kind' in req.body && ['post', 'listing'].includes(req.body.kind)) updates.kind = req.body.kind

    const { data, error } = await supabase
      .from('social_outbox')
      .update(updates)
      .eq('id', req.params.id)
      .in('status', ['draft', 'approved', 'failed'])
      .select()
      .single()
    if (error) throw error
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[social-outbox] update failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social-outbox/:id/approve — David's gate
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('social_outbox')
      .update({
        status: 'approved',
        approved_by: req.user?.sub ?? null,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .in('status', ['draft', 'failed'])
      .select()
      .single()
    if (error) throw error
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[social-outbox] approve failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social-outbox/:id/unapprove — pull it back before Rico claims it
router.post('/:id/unapprove', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('social_outbox')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('status', 'approved')
      .select()
      .single()
    if (error) throw error
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[social-outbox] unapprove failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// DELETE /api/social-outbox/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('social_outbox').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (error: any) {
    console.error('[social-outbox] delete failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/social-outbox/enqueue-missing — draft an outbox post for every
// active product with marketing hooks that isn't queued yet (backfill button)
router.post('/enqueue-missing', async (_req: Request, res: Response) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, slug, price, description, images, metadata')
      .eq('status', 'active')
      .limit(2000)
    if (error) throw error

    const { data: queued } = await supabase.from('social_outbox').select('product_id')
    const queuedIds = new Set((queued || []).map(q => q.product_id))

    const candidates = (products || []).filter(p => p.metadata?.marketing_hooks && !queuedIds.has(p.id))
    if (candidates.length === 0) return res.json({ enqueued: 0 })

    const rows = candidates.map(p => {
      const hooks = p.metadata.marketing_hooks
      return {
        product_id: p.id,
        platform: 'tiktok',
        kind: 'post',
        caption: `${hooks.captions?.[0] || p.name} ${hooks.product_url || ''}`.trim(),
        hashtags: hooks.hashtags || [],
        media_urls: p.images || [],
        listing: {
          title: p.name,
          description: p.description,
          price: p.price,
          product_url: hooks.product_url || null
        },
        status: 'draft'
      }
    })
    const { error: insertError, data: inserted } = await supabase
      .from('social_outbox')
      .upsert(rows, { onConflict: 'product_id,platform,kind', ignoreDuplicates: true })
      .select('id')
    if (insertError) throw insertError
    return res.json({ enqueued: inserted?.length ?? 0 })
  } catch (error: any) {
    console.error('[social-outbox] enqueue-missing failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
