/**
 * 3D Models API Routes
 *
 * Endpoints for creating, managing, and downloading AI-generated 3D figurines.
 * Pipeline: Text → NanoBanana Concept → Approval → Multi-View → TRELLIS 3D → GLB/STL
 */

import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { validatePrompt, Style3D, STYLES } from '../services/nano-banana-3d.js'
import { SIZE_TIERS, PrintSizeTier } from '../services/tripo3d.js'
import { requireRole } from '../middleware/supabaseAuth.js'

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ITC costs (loaded from imagination_pricing table, with fallbacks)
const ITC_COSTS = {
  concept: 20,
  angles: 30,
  convert: 50,
  download_personal: 200,   // Personal use download
  download_commercial: 500  // Commercial use download
}

// Print pricing - simplified to PLA grey only
const PRINT_PRICING = {
  base_price: 25,       // Grey PLA print
  paint_kit_addon: 15   // Paint kit add-on for family fun projects
}

// Middleware to extract user from auth header
const requireAuth = async (req: Request, res: Response, next: Function): Promise<void> => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const token = authHeader.split(' ')[1]
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  ;(req as any).user = user
  next()
}

/**
 * Load ITC pricing from database
 */
async function loadPricing(): Promise<void> {
  try {
    const { data } = await supabase
      .from('imagination_pricing')
      .select('feature_key, current_cost')
      .in('feature_key', ['3d_concept', '3d_angles', '3d_convert'])

    if (data) {
      for (const row of data) {
        if (row.feature_key === '3d_concept') ITC_COSTS.concept = row.current_cost
        if (row.feature_key === '3d_angles') ITC_COSTS.angles = row.current_cost
        if (row.feature_key === '3d_convert') ITC_COSTS.convert = row.current_cost
      }
    }
  } catch (e) {
    console.log('[3d-models] Using default pricing')
  }
}

// Load pricing on startup
loadPricing()

/**
 * POST /api/3d-models/create
 * Start a new 3D model job with text prompt
 */
router.post('/create', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { prompt, style: rawStyle = 'realistic', source, toy_parts, color_mode: rawColorMode = 'grey' } = req.body

    // Validate color_mode
    const colorMode: 'grey' | 'color4' = rawColorMode === 'color4' ? 'color4' : 'grey'

    // Toy-creator mode: force cartoon style
    const isToyCreator = source === 'toy_creator'
    const style: Style3D = isToyCreator ? 'cartoon' : (rawStyle as Style3D)

    // Validate prompt
    const validation = validatePrompt(prompt)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    // Validate style (after possible toy override)
    if (!STYLES[style]) {
      return res.status(400).json({
        error: 'Invalid style',
        validStyles: Object.keys(STYLES)
      })
    }

    // Check ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single()

    if (walletError || !wallet) {
      return res.status(400).json({ error: 'Wallet not found' })
    }

    if (wallet.itc_balance < ITC_COSTS.concept) {
      return res.status(402).json({
        error: 'Insufficient ITC balance',
        required: ITC_COSTS.concept,
        current: wallet.itc_balance
      })
    }

    // Build metadata — always include color_mode; merge toy_creator fields when applicable
    const metadata: Record<string, any> = {
      color_mode: colorMode,
      ...(isToyCreator ? { source: 'toy_creator', toy_parts: toy_parts ?? null } : {})
    }

    // Create model record
    const insertPayload: Record<string, any> = {
      user_id: user.id,
      prompt: prompt.trim(),
      style,
      status: 'queued',
      itc_charged: 0,
      metadata
    }

    const { data: model, error: createError } = await supabase
      .from('user_3d_models')
      .insert(insertPayload)
      .select()
      .single()

    if (createError) {
      console.error('[3d-models] Create error:', createError)
      return res.status(500).json({ error: 'Failed to create model record' })
    }

    // Queue job for async processing
    await supabase.from('ai_jobs').insert({
      type: '3d_model_concept',
      status: 'queued',
      input: {
        model_id: model.id,
        user_id: user.id,
        prompt: prompt.trim(),
        style
      },
      output: {},
      created_at: new Date().toISOString()
    })

    console.log('[3d-models] Created model:', model.id, 'for user:', user.id, isToyCreator ? '(toy_creator)' : '')

    res.status(201).json({
      ok: true,
      model,
      costs: {
        concept: ITC_COSTS.concept,
        angles: ITC_COSTS.angles,
        convert: ITC_COSTS.convert,
        total: ITC_COSTS.concept + ITC_COSTS.angles + ITC_COSTS.convert
      }
    })
  } catch (error: any) {
    console.error('[3d-models] Create error:', error.message)
    res.status(500).json({ error: 'Failed to create 3D model job' })
  }
})

/**
 * GET /api/3d-models/list
 * List user's 3D models with optional status filter
 */
router.get('/list', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { status, limit = 20, offset = 0 } = req.query

    let query = supabase
      .from('user_3d_models')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (status && typeof status === 'string') {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[3d-models] List error:', error)
      return res.status(500).json({ error: 'Failed to fetch models' })
    }

    res.json({
      ok: true,
      models: data || [],
      count: data?.length || 0
    })
  } catch (error: any) {
    console.error('[3d-models] List error:', error.message)
    res.status(500).json({ error: 'Failed to fetch models' })
  }
})

/**
 * GET /api/3d-models/pricing
 * Get current ITC and print pricing for 3D generation
 */
router.get('/pricing', async (req: Request, res: Response) => {
  await loadPricing()

  res.json({
    ok: true,
    costs: {
      concept: ITC_COSTS.concept,
      angles: ITC_COSTS.angles,
      convert: ITC_COSTS.convert,
      total: ITC_COSTS.concept + ITC_COSTS.angles + ITC_COSTS.convert,
      download_personal: ITC_COSTS.download_personal,
      download_commercial: ITC_COSTS.download_commercial
    },
    print: {
      base_price: PRINT_PRICING.base_price,
      paint_kit_addon: PRINT_PRICING.paint_kit_addon,
      material: 'PLA',
      color: 'Grey'
    },
    styles: Object.entries(STYLES).map(([key, value]) => ({
      key,
      name: value.name,
      descriptor: value.descriptor
    }))
  })
})

/**
 * GET /api/3d-models/size-tiers
 * Public — returns the size tier catalog with ITC + print pricing.
 * MUST be declared before the /:id route below to avoid matching as an ID.
 */
router.get('/size-tiers', async (_req: Request, res: Response): Promise<any> => {
  res.json({ tiers: Object.values(SIZE_TIERS) })
})

// ---------------------------------------------------------------------------
// Admin — Toy Lab endpoints
// IMPORTANT: These /admin/* routes must be declared BEFORE /:id so Express
// does not capture the literal string "admin" as a model id parameter.
// ---------------------------------------------------------------------------

/**
 * GET /api/3d-models/admin/list
 * Admin-only: list all 3D models across all users.
 * Query params: status?, source? ('toy_creator' → metadata->>source filter),
 *               limit (default 50, max 100), offset (default 0)
 * Response: { ok, models, count }
 *   Each model has owner_email and owner_username joined from user_profiles
 *   via a separate query (avoiding PGRST200 FK-hint issues).
 */
router.get(
  '/admin/list',
  requireAuth,
  requireRole(['admin']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const rawLimit = Math.min(Number(req.query.limit ?? 50), 100)
      const offset = Number(req.query.offset ?? 0)
      const { status, source } = req.query

      let query = supabase
        .from('user_3d_models')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + rawLimit - 1)

      if (status && typeof status === 'string') {
        query = query.eq('status', status)
      }
      if (source === 'toy_creator') {
        query = query.eq('metadata->>source', 'toy_creator')
      }

      const { data: models, error, count } = await query

      if (error) {
        console.error('[3d-models] admin/list error:', error)
        return res.status(500).json({ error: 'Failed to fetch models' })
      }

      // Join owner info — separate query to avoid PGRST200 FK-hint issues
      const ownerMap: Record<string, { email?: string; username?: string }> = {}
      if (models && models.length > 0) {
        const userIds = [...new Set(models.map((m: any) => m.user_id).filter(Boolean))]
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, email, username')
          .in('id', userIds)
        if (profiles) {
          for (const p of profiles) {
            ownerMap[p.id] = { email: p.email, username: p.username }
          }
        }
      }

      const enriched = (models ?? []).map((m: any) => ({
        ...m,
        owner_email: ownerMap[m.user_id]?.email ?? null,
        owner_username: ownerMap[m.user_id]?.username ?? null
      }))

      res.json({ ok: true, models: enriched, count: count ?? enriched.length })
    } catch (error: any) {
      console.error('[3d-models] admin/list error:', error.message)
      res.status(500).json({ error: 'Failed to fetch models' })
    }
  }
)

/**
 * POST /api/3d-models/admin/:id/retry
 * Admin-only: requeue a failed model. No ITC re-charge.
 * - If concept_image_url is missing → requeue as '3d_model_concept'
 * - Otherwise → requeue as '3d_model_tripo_v2' (same payload as /generate-3d)
 * Response: { ok, requeued: '<job type>' }
 */
router.post(
  '/admin/:id/retry',
  requireAuth,
  requireRole(['admin']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params

      const { data: model, error: fetchError } = await supabase
        .from('user_3d_models')
        .select('*')
        .eq('id', id)
        .single()

      if (fetchError || !model) {
        return res.status(404).json({ error: 'Model not found' })
      }

      if (model.status !== 'failed') {
        return res.status(400).json({
          error: 'Only failed models can be retried',
          currentStatus: model.status
        })
      }

      // Determine which job type to re-insert
      const needsConcept = !model.concept_image_url
      const jobType = needsConcept ? '3d_model_concept' : '3d_model_tripo_v2'

      const jobInput: Record<string, any> = needsConcept
        ? {
            model_id: model.id,
            user_id: model.user_id,
            prompt: model.prompt,
            style: model.style
          }
        : {
            model_id: model.id,
            user_id: model.user_id,
            source_image_url: model.concept_image_url,
            size_tier: model.size_tier ?? 'small'
          }

      // Reset model row
      await supabase
        .from('user_3d_models')
        .update({
          status: 'queued',
          error_message: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      // Insert fresh job
      await supabase.from('ai_jobs').insert({
        type: jobType,
        status: 'queued',
        input: jobInput,
        output: {},
        created_at: new Date().toISOString()
      })

      console.log('[3d-models] admin/retry — requeued model:', id, 'as', jobType)
      res.json({ ok: true, requeued: jobType })
    } catch (error: any) {
      console.error('[3d-models] admin/retry error:', error.message)
      res.status(500).json({ error: 'Failed to retry model' })
    }
  }
)

/**
 * POST /api/3d-models/admin/:id/promote
 * Admin-only: promote a 'ready' model to a product listing.
 * Body: { price_usd?: number }
 * Creates a products row with is_active: false (admin activates later).
 * Response: { ok, product_id }
 */
router.post(
  '/admin/:id/promote',
  requireAuth,
  requireRole(['admin']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params
      const { price_usd } = req.body

      const { data: model, error: fetchError } = await supabase
        .from('user_3d_models')
        .select('*')
        .eq('id', id)
        .single()

      if (fetchError || !model) {
        return res.status(404).json({ error: 'Model not found' })
      }

      if (model.status !== 'ready') {
        return res.status(400).json({
          error: 'Only ready models can be promoted to products',
          currentStatus: model.status
        })
      }

      // Title-case the prompt, truncate to ~60 chars, prefix "Toy: "
      const rawTitle = model.prompt
        .trim()
        .replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .substring(0, 55)
      const productName = `Toy: ${rawTitle}`

      const price = typeof price_usd === 'number' && price_usd > 0
        ? price_usd
        : (model.print_price_usd ?? PRINT_PRICING.base_price)

      const description =
        `A 3D-printed collectible toy figure printed in grey PLA. ` +
        `Add a paint kit at checkout for a fun family painting project! ` +
        `Generated from: "${model.prompt.substring(0, 120)}"`

      const { data: product, error: insertError } = await supabase
        .from('products')
        .insert({
          name: productName,
          description,
          category: '3d-prints',
          price,
          images: model.concept_image_url ? [model.concept_image_url] : [],
          status: 'draft',
          is_active: false,
          // Credit the original creator: the royalty webhook keys on these two
          // fields — without them a promoted toy sells with NO 15% payout to
          // the user who designed it.
          is_user_generated: true,
          created_by_user_id: model.user_id,
          metadata: {
            print3d: {
              enabled: true,
              glb_url: model.glb_url ?? null,
              stl_url: model.stl_url ?? null,
              source_model_id: model.id,
              print_height_mm: model.print_height_mm ?? null,
              color_mode: (model.metadata as any)?.color_mode ?? 'grey',
              magnet_sockets: 2
            },
            source: 'toy_creator_promotion'
          }
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('[3d-models] admin/promote insert error:', insertError)
        return res.status(500).json({ error: 'Failed to create product', details: insertError.message })
      }

      console.log('[3d-models] admin/promote — created product:', product.id, 'from model:', id)
      res.json({ ok: true, product_id: product.id })
    } catch (error: any) {
      console.error('[3d-models] admin/promote error:', error.message)
      res.status(500).json({ error: 'Failed to promote model to product' })
    }
  }
)

/**
 * POST /api/3d-models/admin/:id/nfc
 * Admin-only: set or update NFC experience metadata for a model.
 * Body: { experience_url?: string | null, video_url?: string | null, written?: boolean, enabled?: boolean }
 * Merges into model metadata.nfc — never overwrites unrelated metadata fields.
 * Response: { ok, nfc }
 */
router.post(
  '/admin/:id/nfc',
  requireAuth,
  requireRole(['admin']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { id } = req.params
      const { experience_url, video_url, written, enabled } = req.body

      const { data: model, error: fetchError } = await supabase
        .from('user_3d_models')
        .select('id, metadata')
        .eq('id', id)
        .single()

      if (fetchError || !model) {
        return res.status(404).json({ error: 'Model not found' })
      }

      const existingMeta: Record<string, any> = (model.metadata && typeof model.metadata === 'object') ? { ...model.metadata } : {}
      const existingNfc: Record<string, any> = (existingMeta.nfc && typeof existingMeta.nfc === 'object') ? { ...existingMeta.nfc } : {}

      // Merge supplied fields — only update keys that were explicitly provided
      const updatedNfc: Record<string, any> = {
        ...existingNfc,
        ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
        ...(experience_url !== undefined ? { experience_url: experience_url ?? null } : {}),
        ...(video_url !== undefined ? { video_url: video_url ?? null } : {}),
        ...(written !== undefined ? { written: Boolean(written) } : {}),
        updated_at: new Date().toISOString()
      }

      const updatedMeta = { ...existingMeta, nfc: updatedNfc }

      const { error: updateError } = await supabase
        .from('user_3d_models')
        .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (updateError) {
        console.error('[3d-models] admin/nfc update error:', updateError)
        return res.status(500).json({ error: 'Failed to update NFC metadata' })
      }

      console.log('[3d-models] admin/nfc — updated model:', id)
      res.json({ ok: true, nfc: updatedNfc })
    } catch (error: any) {
      console.error('[3d-models] admin/nfc error:', error.message)
      res.status(500).json({ error: 'Failed to update NFC metadata' })
    }
  }
)

/**
 * GET /api/3d-models/public/:id/ar
 * Public (no auth) — AR/NFC landing for kids scanning a toy.
 * Returns 404 unless the model exists AND metadata.nfc.enabled === true.
 * Response: { ok, name, glb_url, concept_image_url, video_url }
 * IMPORTANT: declared before the authed GET /:id so Express does not swallow
 * the literal "public" as a model id.
 */
router.get('/public/:id/ar', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params

    const { data: model, error } = await supabase
      .from('user_3d_models')
      .select('id, prompt, glb_url, concept_image_url, metadata')
      .eq('id', id)
      .single()

    if (error || !model) {
      return res.status(404).json({ error: 'Not found' })
    }

    const nfc = (model.metadata as any)?.nfc
    if (!nfc?.enabled) {
      return res.status(404).json({ error: 'Not found' })
    }

    // Derive a short display name from the prompt — no internal ids or full prompt text
    const rawPrompt: string = model.prompt || ''
    const displayName = rawPrompt.trim().substring(0, 60) || 'Custom Figurine'

    res.json({
      ok: true,
      name: displayName,
      glb_url: model.glb_url ?? null,
      concept_image_url: model.concept_image_url ?? null,
      video_url: nfc.video_url ?? null
    })
  } catch (error: any) {
    console.error('[3d-models] public/ar error:', error.message)
    res.status(500).json({ error: 'Failed to fetch AR data' })
  }
})

/**
 * GET /api/3d-models/:id
 * Get single model details
 */
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params

    const { data: model, error } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    res.json({ ok: true, model })
  } catch (error: any) {
    console.error('[3d-models] Get error:', error.message)
    res.status(500).json({ error: 'Failed to fetch model' })
  }
})

/**
 * POST /api/3d-models/:id/approve
 * Approve concept image. Tripo3D works directly from the concept — no angles needed.
 * After approval the model sits in `awaiting_3d_generation` so the user can pick a
 * size tier and trigger the actual 3D conversion via /generate-3d.
 */
router.post('/:id/approve', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params

    const { data: model, error: fetchError } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    if (model.status !== 'awaiting_approval') {
      return res.status(400).json({
        error: 'Model not ready for approval',
        currentStatus: model.status,
      })
    }

    // No angle generation, no extra ITC charge — concept is enough for Tripo3D.
    // Move to a holding state where the size picker is shown.
    await supabase
      .from('user_3d_models')
      .update({
        status: 'awaiting_3d_generation',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    console.log('[3d-models] Approved model:', id, '- ready for size pick + Tripo3D conversion')

    res.json({
      ok: true,
      message: 'Concept approved — pick a print size to start 3D generation',
      cost: 0,
    })
  } catch (error: any) {
    console.error('[3d-models] Approve error:', error.message)
    res.status(500).json({ error: 'Failed to approve concept' })
  }
})

/**
 * POST /api/3d-models/:id/generate-3d
 * Trigger Tripo3D conversion at a chosen size tier.
 * Body: { size: 'mini' | 'small' | 'medium' | 'large' }
 */
router.post('/:id/generate-3d', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params
    const requestedTier = (req.body?.size || 'small') as PrintSizeTier
    const tierConfig = SIZE_TIERS[requestedTier]

    if (!tierConfig) {
      return res.status(400).json({
        error: 'Invalid size tier',
        validTiers: Object.keys(SIZE_TIERS),
      })
    }

    // Get model — we now drive Tripo3D from the concept image directly,
    // so angles are no longer required (saving 30 ITC and ~60s).
    const { data: model, error: fetchError } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    // Need a concept image to feed Tripo3D
    const sourceImage = model.concept_image_url || model.angle_images?.front
    if (!sourceImage) {
      return res.status(400).json({
        error: 'Concept image not ready',
        currentStatus: model.status,
      })
    }

    // Check ITC balance for the chosen tier
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single()

    if (!wallet || wallet.itc_balance < tierConfig.itcCost) {
      return res.status(402).json({
        error: `Insufficient ITC for ${tierConfig.label} size (${tierConfig.itcCost} ITC required)`,
        required: tierConfig.itcCost,
        current: wallet?.itc_balance || 0,
      })
    }

    // Update status + persist chosen tier on the row.
    // size_tier / print_height_mm may not exist on older schemas — try, then fall back
    // to status-only so the job still kicks off cleanly.
    const updatedAt = new Date().toISOString()
    const fullUpdate = await supabase
      .from('user_3d_models')
      .update({
        status: 'generating_3d',
        size_tier: requestedTier,
        print_height_mm: tierConfig.printHeightMm,
        updated_at: updatedAt,
      })
      .eq('id', id)
    if (fullUpdate.error) {
      console.warn('[3d-models] tier columns missing on row — falling back to status-only update:', fullUpdate.error.message)
      await supabase
        .from('user_3d_models')
        .update({ status: 'generating_3d', updated_at: updatedAt })
        .eq('id', id)
    }

    // Queue Tripo3D conversion job.
    // NOTE: Type is '3d_model_tripo_v2' so the production Render worker (which
    // still has the old TRIPO_API_KEY 'tcli_*' Studio token) ignores it. Local
    // worker recognizes both '3d_model_tripo' and '_v2'. Once Render's env is
    // updated with a 'tsk_*' Platform key, this rename becomes unnecessary.
    await supabase.from('ai_jobs').insert({
      type: '3d_model_tripo_v2',
      status: 'queued',
      input: {
        model_id: id,
        user_id: user.id,
        source_image_url: sourceImage,
        size_tier: requestedTier,
      },
      output: {},
      created_at: new Date().toISOString(),
    })

    console.log('[3d-models] Starting Tripo3D', requestedTier, 'conversion for model:', id)

    res.json({
      ok: true,
      message: `${tierConfig.label} 3D conversion started (~${tierConfig.approxSeconds}s)`,
      tier: requestedTier,
      cost: tierConfig.itcCost,
      printPriceUsd: tierConfig.printPriceUsd,
      printHeightMm: tierConfig.printHeightMm,
    })
  } catch (error: any) {
    console.error('[3d-models] Generate-3d error:', error.message)
    res.status(500).json({ error: 'Failed to start 3D conversion' })
  }
})

/**
 * POST /api/3d-models/:id/purchase-download
 * Purchase download rights for GLB/STL file with ITC
 * license_type: 'personal' (200 ITC) or 'commercial' (500 ITC)
 */
router.post('/:id/purchase-download', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params
    const { license_type = 'personal' } = req.body

    if (!['personal', 'commercial'].includes(license_type)) {
      return res.status(400).json({
        error: 'Invalid license type',
        validTypes: ['personal', 'commercial']
      })
    }

    const { data: model, error } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    if (model.status !== 'ready') {
      return res.status(400).json({
        error: 'Model not ready for download',
        currentStatus: model.status
      })
    }

    // Check if already purchased this license type
    const purchasedLicenses = model.purchased_licenses || []
    if (purchasedLicenses.includes(license_type)) {
      return res.status(400).json({
        error: `Already purchased ${license_type} license`,
        canDownload: true
      })
    }

    // Calculate cost
    const cost = license_type === 'commercial'
      ? ITC_COSTS.download_commercial
      : ITC_COSTS.download_personal

    // Check ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single()

    if (!wallet || wallet.itc_balance < cost) {
      return res.status(402).json({
        error: 'Insufficient ITC balance',
        required: cost,
        current: wallet?.itc_balance || 0
      })
    }

    // Deduct ITC
    await supabase.rpc('deduct_itc', {
      p_user_id: user.id,
      p_amount: cost,
      p_reason: `3D model ${license_type} download license`
    })

    // Update model with purchased license
    const newLicenses = [...purchasedLicenses, license_type]
    await supabase
      .from('user_3d_models')
      .update({
        purchased_licenses: newLicenses,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    console.log('[3d-models] License purchased:', license_type, 'for model:', id, 'cost:', cost, 'ITC')

    res.json({
      ok: true,
      license_type,
      cost,
      message: `${license_type} license purchased successfully`
    })
  } catch (error: any) {
    console.error('[3d-models] Purchase download error:', error.message)
    res.status(500).json({ error: 'Failed to purchase download' })
  }
})

/**
 * GET /api/3d-models/:id/download/:format
 * Get download URL for GLB or STL file (requires purchased license)
 */
router.get('/:id/download/:format', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id, format } = req.params

    if (!['glb', 'stl'].includes(format)) {
      return res.status(400).json({
        error: 'Invalid format',
        validFormats: ['glb', 'stl']
      })
    }

    const { data: model, error } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    if (model.status !== 'ready') {
      return res.status(400).json({
        error: 'Model not ready for download',
        currentStatus: model.status
      })
    }

    // Check if user has purchased a license
    const purchasedLicenses = model.purchased_licenses || []
    if (purchasedLicenses.length === 0) {
      return res.status(402).json({
        error: 'Download license required',
        message: 'Purchase a personal (200 ITC) or commercial (500 ITC) license to download',
        pricing: {
          personal: ITC_COSTS.download_personal,
          commercial: ITC_COSTS.download_commercial
        }
      })
    }

    const url = format === 'glb' ? model.glb_url : model.stl_url

    if (!url) {
      return res.status(404).json({
        error: `${format.toUpperCase()} file not available`
      })
    }

    res.json({
      ok: true,
      format,
      downloadUrl: url,
      filename: `figurine-${id.slice(0, 8)}.${format}`,
      license: purchasedLicenses.includes('commercial') ? 'commercial' : 'personal'
    })
  } catch (error: any) {
    console.error('[3d-models] Download error:', error.message)
    res.status(500).json({ error: 'Failed to get download URL' })
  }
})

/**
 * POST /api/3d-models/:id/order
 * Create cart-compatible product for 3D print ordering.
 * Body (all optional):
 *   include_paint_kit?: boolean   — paint kit add-on (grey mode only, default false)
 *   color_mode?: 'grey' | 'color4' — defaults to model's metadata.color_mode ?? 'grey'
 *                                    'color4' adds 30% premium on the tier print price.
 *
 * All orders include two hidden magnet sockets (standard feature).
 */
router.post('/:id/order', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params
    const {
      include_paint_kit: rawPaintKit = false,
      color_mode: rawColorMode
    } = req.body

    const { data: model, error } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    if (model.status !== 'ready') {
      return res.status(400).json({
        error: 'Model not ready for ordering',
        currentStatus: model.status
      })
    }

    // Resolve color_mode: body > model metadata > default grey
    const modelColorMode: 'grey' | 'color4' = (model.metadata as any)?.color_mode === 'color4' ? 'color4' : 'grey'
    const colorMode: 'grey' | 'color4' = rawColorMode === 'color4' ? 'color4' : rawColorMode === 'grey' ? 'grey' : modelColorMode

    // Paint kit only applies for grey mode
    const include_paint_kit = colorMode === 'grey' ? Boolean(rawPaintKit) : false

    // Pricing: base tier print price; color4 adds 30% premium, rounded to .99
    const tierPrintPrice: number = (model as any).print_price_usd ?? PRINT_PRICING.base_price
    const basePrice = colorMode === 'color4'
      ? Math.ceil(tierPrintPrice * 1.3) - 0.01
      : tierPrintPrice
    const paintKitPrice = include_paint_kit ? PRINT_PRICING.paint_kit_addon : 0
    const totalPrice = basePrice + paintKitPrice

    // Build name with color suffix
    const shortPrompt = model.prompt.substring(0, 40) + (model.prompt.length > 40 ? '...' : '')
    const name = colorMode === 'color4'
      ? `Custom 3D Figurine: ${shortPrompt} (Full Color)`
      : `Custom 3D Figurine: ${shortPrompt}`

    // Build description
    const magnetLine = 'Includes two hidden magnet sockets in the base/back — snap-on accessories coming soon.'
    let description: string
    if (colorMode === 'color4') {
      description = `3D printed figurine in up to 4 colors, ${model.style} style. ${magnetLine}`
    } else if (include_paint_kit) {
      description = `3D printed figurine in grey PLA with paint kit - a fun family project! ${magnetLine}`
    } else {
      description = `3D printed figurine in grey PLA, ${model.style} style. ${magnetLine}`
    }

    // Return cart-compatible product structure
    const product = {
      id: `3d-print-${model.id}`,
      name,
      description,
      category: '3d-prints',
      price: totalPrice,
      images: [model.concept_image_url].filter(Boolean),
      metadata: {
        model_id: model.id,
        stl_url: model.stl_url,
        glb_url: model.glb_url,
        material: 'pla',
        color: colorMode === 'color4' ? 'color4' : 'grey',
        color_mode: colorMode,
        include_paint_kit,
        magnet_sockets: 2,
        style: model.style,
        prompt: model.prompt
      }
    }

    console.log('[3d-models] Order product created for model:', id, 'colorMode:', colorMode, 'paint kit:', include_paint_kit, 'price:', totalPrice)

    res.json({ ok: true, product })
  } catch (error: any) {
    console.error('[3d-models] Order error:', error.message)
    res.status(500).json({ error: 'Failed to create order product' })
  }
})

/**
 * POST /api/3d-models/:id/remix
 * Reimagine an existing creature concept while preserving its character.
 *
 * Requirements:
 *   - Model must belong to the authenticated user.
 *   - Model must have status 'ready' | 'awaiting_3d_generation' | 'awaiting_approval'
 *     AND a non-null concept_image_url.
 *   - Body: { instruction: string }  (3..500 chars)
 *
 * Charges the same ITC concept cost as /create.
 * Creates a NEW user_3d_models row (remixed_from metadata pointer to original).
 * Queues a 3d_model_concept job with source_image_url so the worker uses the
 * gpt-image-2 image-edit (i2i) path.
 *
 * Response: { ok: true, model, cost }
 */
router.post('/:id/remix', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params
    const { instruction } = req.body ?? {}

    // Validate instruction
    if (typeof instruction !== 'string' || instruction.trim().length < 3 || instruction.trim().length > 500) {
      return res.status(400).json({ error: 'instruction must be between 3 and 500 characters' })
    }

    // Fetch the original model — must belong to caller
    const { data: original, error: fetchError } = await supabase
      .from('user_3d_models')
      .select('id, user_id, prompt, style, status, concept_image_url, metadata')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !original) {
      return res.status(404).json({ error: 'Model not found' })
    }

    // Status gate: must have a concept to remix
    const remixableStatuses = ['ready', 'awaiting_3d_generation', 'awaiting_approval']
    if (!remixableStatuses.includes(original.status)) {
      return res.status(400).json({
        error: 'Model cannot be remixed in its current status',
        currentStatus: original.status,
        remixableStatuses
      })
    }

    if (!original.concept_image_url) {
      return res.status(400).json({ error: 'Model has no concept image to remix from' })
    }

    // Refresh pricing in case it has changed
    await loadPricing()
    const cost = ITC_COSTS.concept

    // Check ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single()

    if (walletError || !wallet) {
      return res.status(400).json({ error: 'Wallet not found' })
    }

    if (wallet.itc_balance < cost) {
      return res.status(402).json({
        error: 'Insufficient ITC balance',
        required: cost,
        current: wallet.itc_balance
      })
    }

    // Inherit color_mode and toy metadata from the original
    const originalMeta = (original.metadata as Record<string, any>) ?? {}
    const remixMetadata: Record<string, any> = {
      color_mode: originalMeta.color_mode ?? 'grey',
      remixed_from: original.id,
      ...(originalMeta.source ? { source: originalMeta.source } : {}),
      ...(originalMeta.toy_parts ? { toy_parts: originalMeta.toy_parts } : {}),
    }

    // Create the new remixed model record
    const { data: remixedModel, error: createError } = await supabase
      .from('user_3d_models')
      .insert({
        user_id: user.id,
        prompt: `${original.prompt} — remixed: ${instruction.trim()}`,
        style: original.style,
        status: 'queued',
        itc_charged: 0,
        metadata: remixMetadata,
      })
      .select()
      .single()

    if (createError || !remixedModel) {
      console.error('[3d-models] remix create error:', createError)
      return res.status(500).json({ error: 'Failed to create remix model record' })
    }

    // Queue the concept job — worker detects source_image_url to use i2i path
    await supabase.from('ai_jobs').insert({
      type: '3d_model_concept',
      status: 'queued',
      input: {
        model_id: remixedModel.id,
        user_id: user.id,
        prompt: instruction.trim(),
        style: original.style,
        source_image_url: original.concept_image_url,
      },
      output: {},
      created_at: new Date().toISOString(),
    })

    console.log('[3d-models] Remix queued:', remixedModel.id, 'from original:', original.id, 'for user:', user.id)

    return res.status(201).json({ ok: true, model: remixedModel, cost })
  } catch (error: any) {
    console.error('[3d-models] Remix error:', error.message)
    return res.status(500).json({ error: 'Failed to queue remix job' })
  }
})

/**
 * DELETE /api/3d-models/:id
 * Delete a 3D model (only allowed if not in processing states)
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params

    const { data: model, error: fetchError } = await supabase
      .from('user_3d_models')
      .select('status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    // Don't allow deletion while processing
    const processingStates = ['generating_concept', 'generating_angles', 'generating_3d']
    if (processingStates.includes(model.status)) {
      return res.status(400).json({
        error: 'Cannot delete model while processing',
        currentStatus: model.status
      })
    }

    const { error: deleteError } = await supabase
      .from('user_3d_models')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (deleteError) {
      return res.status(500).json({ error: 'Failed to delete model' })
    }

    console.log('[3d-models] Deleted model:', id)

    res.json({ ok: true, message: 'Model deleted' })
  } catch (error: any) {
    console.error('[3d-models] Delete error:', error.message)
    res.status(500).json({ error: 'Failed to delete model' })
  }
})

export default router
