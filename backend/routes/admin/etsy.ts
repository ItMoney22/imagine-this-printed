// Admin Etsy integration routes: OAuth connect/status, setup lookups
// (taxonomy, shipping profiles, return policies), and product publishing.
// Mounted at /api/admin/etsy. Full flow: docs/plans/2026-07-24-etsy-integration-plan.md
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import {
  buildAuthUrl,
  getConnectionStatus,
  getReturnPolicies,
  getShippingProfiles,
  getTaxonomyNodes,
  handleOAuthCallback,
  isEtsyConfigured,
  listEtsyListings,
  publishProductToEtsy,
  taxonomyIdFor
} from '../../services/etsy.js'
import { composeEtsyPack, saveEtsyPackEdits } from '../../services/etsy-seo-composer.js'
import { startModelShots, reshootModelShot, setModelShots, listShotSubjects, ShotCastError } from '../../services/etsy-model-shots.js'
import { audienceForGarment } from '../../shared/catalog-capability.js'
import { runCopyrightGate } from '../../services/etsy-copyright-gate.js'
import { checkGate } from '../../services/design-qa-gate.js'
import { supabase } from '../../lib/supabase.js'
import { type EtsyTier, isEtsyTier, tiersForCategory } from '../../shared/etsy-tiers.js'

const router = Router()

// OAuth callback MUST stay above the auth gate: Etsy redirects the admin's
// browser here without our JWT. The persisted `state` token is the CSRF check.
router.get('/callback', async (req: Request, res: Response) => {
  const frontend = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'
  try {
    const { code, state, error: oauthError } = req.query as Record<string, string>
    if (oauthError) return res.redirect(`${frontend}/admin?etsy=denied`)
    if (!code || !state) return res.status(400).json({ error: 'Missing code/state' })
    const { shopId, shopName } = await handleOAuthCallback(code, state)
    console.log(`[etsy] connected — shop ${shopName ?? 'none yet'} (${shopId ?? 'n/a'})`)
    return res.redirect(`${frontend}/admin?etsy=connected`)
  } catch (error: any) {
    console.error('[etsy] OAuth callback failed:', error)
    return res.redirect(`${frontend}/admin?etsy=error`)
  }
})

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

// Enqueue a product for Rico's Etsy flow (copyright gate → draft → notify Christina).
// Async: the etsy-jobs-worker picks up state='queued' rows. Does NOT publish (draft only).
// Body: { tiers?: ('primary'|'transfer'|'download')[] } — defaults to ['primary'].
// David 2026-07-31 wants this opt-in per design ("SOME i want to offer the
// physical transfer"), so the panel sends exactly the tiers he ticked. One
// ledger row per tier; a tier already live on Etsy is reported as skipped
// rather than failing the whole request, so ticking all three on a design that
// already has a tee posts the two that are missing.
router.post('/queue/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params

    const { data: product } = await supabase
      .from('products')
      .select('category')
      .eq('id', productId)
      .maybeSingle()
    if (!product) return res.status(404).json({ error: 'Product not found' })

    // Presentation QA gate (Watchtower 9ec9444a) — refuse at the QUEUE, not at
    // the worker, so the admin finds out here instead of watching the row go
    // 'blocked' minutes later with no panel context.
    const qa = await checkGate(productId, 'etsy')
    if (!qa.allowed) {
      return res.status(422).json({
        error: `Presentation QA gate: ${qa.reason}`,
        qa_gate: { code: qa.code, stamp: qa.stamp },
        next_step: `POST /api/admin/design-qa/submit/${productId} with { "channel": "etsy" }`
      })
    }

    const allowed = tiersForCategory(product.category)
    const requested: EtsyTier[] = Array.isArray(req.body?.tiers) && req.body.tiers.length
      ? [...new Set(req.body.tiers.filter(isEtsyTier))] as EtsyTier[]
      : ['primary']

    const rejected = requested.filter(t => !allowed.includes(t))
    if (rejected.length) {
      return res.status(400).json({
        error: `Category "${product.category}" cannot be sold as: ${rejected.join(', ')} (allowed: ${allowed.join(', ')})`
      })
    }

    const { data: existingRows } = await supabase
      .from('etsy_listings')
      .select('tier, listing_id, state')
      .eq('product_id', productId)
    const byTier = new Map((existingRows ?? []).map(r => [r.tier as EtsyTier, r]))

    const queued: EtsyTier[] = []
    const skipped: Array<{ tier: EtsyTier; reason: string }> = []
    for (const tier of requested) {
      const existing = byTier.get(tier)
      if (existing?.listing_id && existing.state !== 'error' && existing.state !== 'removed') {
        skipped.push({ tier, reason: `already has an Etsy listing (${existing.state})` })
        continue
      }
      const { error } = await supabase.from('etsy_listings').upsert(
        { product_id: productId, tier, state: 'queued', last_error: null, updated_at: new Date().toISOString() },
        { onConflict: 'product_id,tier' }
      )
      if (error) { skipped.push({ tier, reason: error.message }); continue }
      queued.push(tier)
    }

    if (!queued.length) {
      return res.status(409).json({ error: skipped.map(s => `${s.tier}: ${s.reason}`).join(' | '), skipped })
    }
    return res.status(202).json({ ok: true, productId, queued, skipped, state: 'queued' })
  } catch (error: any) {
    console.error('[etsy] queue failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Etsy flow v2 (2026-07-25): opt-in per shirt. Every ACTIVE storefront product
// with no live ledger row is a candidate; the panel composes an Etsy-native
// pack, David reviews/edits, then queues. Gate + taxonomy checks run here too
// so problems show up in the review queue, not as worker errors later.
router.get('/candidates', async (_req: Request, res: Response) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, description, price, images, category, meta_title, meta_description, search_keywords, metadata, created_at')
      .eq('status', 'active')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)

    // Per-tier ledger state. A design stays a candidate while ANY of its
    // eligible tiers is still unposted — the tee going live must not hide the
    // design before its transfer and download listings exist.
    const { data: listed } = await supabase.from('etsy_listings').select('product_id, state, tier')
    const tierStates = new Map<string, Record<string, string>>()
    for (const l of listed ?? []) {
      const row = tierStates.get(l.product_id) ?? {}
      row[(l.tier as string) || 'primary'] = l.state
      tierStates.set(l.product_id, row)
    }
    const isOpenState = (s?: string) => !s || s === 'error' || s === 'removed'

    // The download tier sells product_assets kind='source'. Fetched once for the
    // whole page rather than per product, so the panel can grey out the
    // Download checkbox instead of letting the worker fail 15s later.
    const { data: sourceAssets } = await supabase
      .from('product_assets')
      .select('product_id')
      .eq('kind', 'source')
      .in('product_id', (products ?? []).map(p => p.id))
    const sourceFileProductIds = new Set((sourceAssets ?? []).map(a => a.product_id))

    const results = (products ?? [])
      .filter(p => {
        const states = tierStates.get(p.id) ?? {}
        return tiersForCategory(p.category).some(t => isOpenState(states[t]))
      })
      .map(p => {
        const tags = String(p.search_keywords || '').split(',').map(t => t.trim()).filter(Boolean)
        const gate = runCopyrightGate({
          name: p.meta_title || p.name,
          description: p.description || p.meta_description,
          tags,
          aiGenerated: (p as any).metadata?.ai_generated === false ? false : true
        })
        return {
          id: p.id,
          name: p.name,
          category: p.category,
          price: p.price,
          hero_image: Array.isArray(p.images) ? p.images[0] ?? null : null,
          image_count: Array.isArray(p.images) ? p.images.length : 0,
          taxonomy_mapped: taxonomyIdFor(p.category) !== null,
          // Which of the three listings this design can have, which are already
          // posted, and whether the download tier has a file to sell.
          eligible_tiers: tiersForCategory(p.category),
          tier_states: tierStates.get(p.id) ?? {},
          has_source_file: sourceFileProductIds.has(p.id),
          gate_pass: gate.pass,
          gate_reasons: gate.reasons,
          etsy_pack: (p as any).metadata?.etsy_pack ?? null,
          etsy_shots: (p as any).metadata?.etsy_shots ?? null,
          created_at: p.created_at
        }
      })
    return res.json({ count: results.length, results })
  } catch (error: any) {
    console.error('[etsy] candidates failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Compose (or recompose) the Etsy listing pack for one product.
router.post('/compose/:productId', async (req: Request, res: Response) => {
  try {
    const pack = await composeEtsyPack(req.params.productId)
    return res.json({ ok: true, productId: req.params.productId, pack })
  } catch (error: any) {
    console.error('[etsy] compose failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Casting catalog for the panel's subject picker (ids + keywords for the
// suggested cast). Every subject carries its `audience`, and an optional
// ?garment= narrows the list to what is actually castable on that garment —
// the youth (kid) subjects only exist on the youth tee, and offering them on
// an adult listing would just earn a 400 from resolveCast (David 2026-09-03).
// Omitting the param returns the full catalog, exactly as before.
router.get('/shot-subjects', (req: Request, res: Response) => {
  const garment = typeof req.query.garment === 'string' ? req.query.garment : undefined
  return res.json({ subjects: listShotSubjects(garment ? audienceForGarment(garment) : undefined) })
})

// Kick off AI model-shot generation for one product (fire-and-forget; the
// panel polls /candidates until metadata.etsy_shots.status is done/failed).
// Optional body { subjects: string[], custom: string } picks who wears it;
// omit both for the original random cast.
router.post('/model-shots/:productId', async (req: Request, res: Response) => {
  try {
    const userId = ((req as any).user?.id as string | undefined) || 'admin'
    const subjects = Array.isArray(req.body?.subjects) ? req.body.subjects.map(String) : undefined
    const custom = typeof req.body?.custom === 'string' ? req.body.custom : undefined
    const state = await startModelShots(req.params.productId, userId, { subjects, custom })
    return res.status(202).json({ ok: true, productId: req.params.productId, shots: state })
  } catch (error: any) {
    if (error instanceof ShotCastError) return res.status(400).json({ error: error.message })
    console.error('[etsy] model-shots kickoff failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Recast ONE photo in place, keeping the others (the admin didn't like that
// model). Body { index, subjects?, custom? } — omit the subject to just get a
// different person. Same fire-and-forget contract as a full shoot.
router.post('/model-shots/:productId/reshoot', async (req: Request, res: Response) => {
  try {
    const userId = ((req as any).user?.id as string | undefined) || 'admin'
    const index = Number(req.body?.index)
    if (!Number.isInteger(index)) return res.status(400).json({ error: 'index is required' })
    const subjects = Array.isArray(req.body?.subjects) ? req.body.subjects.map(String) : undefined
    const custom = typeof req.body?.custom === 'string' ? req.body.custom : undefined
    const state = await reshootModelShot(req.params.productId, userId, index, { subjects, custom })
    return res.status(202).json({ ok: true, productId: req.params.productId, shots: state })
  } catch (error: any) {
    if (error instanceof ShotCastError) return res.status(400).json({ error: error.message })
    console.error('[etsy] model-shots reshoot failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Replace the shot list (prune a bad image; empty array clears all shots).
router.put('/model-shots/:productId', async (req: Request, res: Response) => {
  try {
    const images: string[] = Array.isArray(req.body?.images) ? req.body.images.map(String) : []
    const state = await setModelShots(req.params.productId, images)
    return res.json({ ok: true, productId: req.params.productId, shots: state })
  } catch (error: any) {
    console.error('[etsy] model-shots update failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Save admin edits to a composed pack (re-runs the same Etsy limits).
router.put('/pack/:productId', async (req: Request, res: Response) => {
  try {
    const { title, tags, description, price, colors } = req.body || {}
    const pack = await saveEtsyPackEdits(req.params.productId, {
      title: typeof title === 'string' ? title : undefined,
      tags: Array.isArray(tags) ? tags.map(String) : undefined,
      description: typeof description === 'string' ? description : undefined,
      price: price !== undefined ? Number(price) : undefined,
      colors: Array.isArray(colors) ? colors.map(String) : undefined
    })
    return res.json({ ok: true, productId: req.params.productId, pack })
  } catch (error: any) {
    console.error('[etsy] pack save failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Mark ledger rows 'removed' for listings deleted on Etsy's side (e.g. the
// 2026-07-25 batch David deletes in Shop Manager). Takes EXPLICIT product ids —
// no clear-all — so a future real draft can't be swept up by accident. State
// 'removed' also frees the per-product dedupe for re-listing under the new flow.
router.post('/listings/mark-removed', async (req: Request, res: Response) => {
  try {
    const productIds: string[] = Array.isArray(req.body?.productIds) ? req.body.productIds.map(String) : []
    if (!productIds.length) return res.status(400).json({ error: 'productIds[] is required' })
    const { data, error } = await supabase
      .from('etsy_listings')
      .update({ state: 'removed', updated_at: new Date().toISOString() })
      .in('product_id', productIds)
      .select('product_id')
    if (error) throw new Error(error.message)
    return res.json({ ok: true, marked: (data ?? []).length })
  } catch (error: any) {
    console.error('[etsy] mark-removed failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Connection + config state for the admin panel.
router.get('/status', async (_req: Request, res: Response) => {
  try {
    return res.json(await getConnectionStatus())
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Start the OAuth consent flow: returns the Etsy authorize URL for the admin
// to open (frontend does window.location = url).
router.get('/connect', async (req: Request, res: Response) => {
  try {
    if (!isEtsyConfigured()) {
      return res.status(503).json({ error: 'ETSY_KEYSTRING not configured — create the Etsy app first' })
    }
    const userId = (req as any).user?.id as string | undefined
    const url = await buildAuthUrl(userId)
    return res.json({ url })
  } catch (error: any) {
    console.error('[etsy] connect failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Setup lookups so taxonomy/shipping/return ids are picked, never guessed.
router.get('/taxonomy', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').toLowerCase()
    const nodes = await getTaxonomyNodes()
    const flat: Array<{ id: number, name: string, path: string }> = []
    const walk = (list: any[], trail: string[]) => {
      for (const n of list || []) {
        const path = [...trail, n.name]
        flat.push({ id: n.id, name: n.name, path: path.join(' > ') })
        walk(n.children, path)
      }
    }
    walk(nodes, [])
    const results = q ? flat.filter(n => n.path.toLowerCase().includes(q)) : flat
    return res.json({ count: results.length, results: results.slice(0, 200) })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

router.get('/shipping-profiles', async (_req: Request, res: Response) => {
  try {
    return res.json({ results: await getShippingProfiles() })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

router.get('/return-policies', async (_req: Request, res: Response) => {
  try {
    return res.json({ results: await getReturnPolicies() })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Post one ITP product to Etsy. Creates a DRAFT by default; body.publish=true
// activates it (visible + $0.20 listing fee).
router.post('/publish/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params
    const { taxonomyId, shippingProfileId, returnPolicyId, quantity, publish, priceOverride } = req.body || {}

    // The direct publish path bypasses the queue, so it needs the same gate —
    // otherwise "post it now" is a documented way around QA.
    const qa = await checkGate(productId, 'etsy')
    if (!qa.allowed) {
      return res.status(422).json({
        ok: false,
        error: `Presentation QA gate: ${qa.reason}`,
        qa_gate: { code: qa.code, stamp: qa.stamp },
        next_step: `POST /api/admin/design-qa/submit/${productId} with { "channel": "etsy" }`
      })
    }

    const result = await publishProductToEtsy(productId, {
      taxonomyId: taxonomyId ? Number(taxonomyId) : undefined,
      shippingProfileId: shippingProfileId ? Number(shippingProfileId) : undefined,
      returnPolicyId: returnPolicyId ? Number(returnPolicyId) : undefined,
      quantity: quantity ? Number(quantity) : undefined,
      priceOverride: priceOverride ? Number(priceOverride) : undefined,
      publish: publish === true
    })
    return res.status(result.ok ? 200 : 422).json(result)
  } catch (error: any) {
    console.error('[etsy] publish failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Sync-state ledger (etsy_listings) for the admin panel.
router.get('/listings', async (_req: Request, res: Response) => {
  try {
    return res.json({ results: await listEtsyListings() })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

export default router
