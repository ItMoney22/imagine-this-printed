/**
 * 3D Models API Routes
 *
 * Endpoints for creating, managing, and downloading AI-generated 3D figurines.
 * Pipeline: Text → NanoBanana Concept → Approval → Multi-View → TRELLIS 3D → GLB/STL
 */

import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { validatePrompt, Style3D, STYLES } from '../services/nano-banana-3d.js'

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
    const { prompt, style = 'realistic' } = req.body

    // Validate prompt
    const validation = validatePrompt(prompt)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    // Validate style
    if (!STYLES[style as Style3D]) {
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

    // Create model record
    const { data: model, error: createError } = await supabase
      .from('user_3d_models')
      .insert({
        user_id: user.id,
        prompt: prompt.trim(),
        style,
        status: 'queued',
        itc_charged: 0
      })
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

    console.log('[3d-models] Created model:', model.id, 'for user:', user.id)

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
 * Approve concept image and trigger angle generation
 */
router.post('/:id/approve', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params

    // Get model
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
        currentStatus: model.status
      })
    }

    // Check ITC balance for angles
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single()

    if (!wallet || wallet.itc_balance < ITC_COSTS.angles) {
      return res.status(402).json({
        error: 'Insufficient ITC for angle generation',
        required: ITC_COSTS.angles,
        current: wallet?.itc_balance || 0
      })
    }

    // Update status
    await supabase
      .from('user_3d_models')
      .update({ status: 'generating_angles', updated_at: new Date().toISOString() })
      .eq('id', id)

    // Queue angle generation job
    await supabase.from('ai_jobs').insert({
      type: '3d_model_angles',
      status: 'queued',
      input: {
        model_id: id,
        user_id: user.id,
        style: model.style,
        concept_image_url: model.concept_image_url
      },
      output: {},
      created_at: new Date().toISOString()
    })

    console.log('[3d-models] Approved model:', id, '- starting angle generation')

    res.json({
      ok: true,
      message: 'Concept approved, generating angle views',
      cost: ITC_COSTS.angles
    })
  } catch (error: any) {
    console.error('[3d-models] Approve error:', error.message)
    res.status(500).json({ error: 'Failed to approve concept' })
  }
})

/**
 * POST /api/3d-models/:id/generate-3d
 * Trigger TRELLIS 3D conversion after angles are ready
 */
router.post('/:id/generate-3d', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params

    // Get model with angle images
    const { data: model, error: fetchError } = await supabase
      .from('user_3d_models')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !model) {
      return res.status(404).json({ error: 'Model not found' })
    }

    // Verify angles are complete
    const angles = model.angle_images || {}
    const hasAllAngles = angles.front && angles.back && angles.left && angles.right

    if (!hasAllAngles) {
      return res.status(400).json({
        error: 'Angle views not ready',
        currentAngles: Object.keys(angles),
        required: ['front', 'back', 'left', 'right']
      })
    }

    // Check ITC balance for 3D conversion
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', user.id)
      .single()

    if (!wallet || wallet.itc_balance < ITC_COSTS.convert) {
      return res.status(402).json({
        error: 'Insufficient ITC for 3D conversion',
        required: ITC_COSTS.convert,
        current: wallet?.itc_balance || 0
      })
    }

    // Update status
    await supabase
      .from('user_3d_models')
      .update({ status: 'generating_3d', updated_at: new Date().toISOString() })
      .eq('id', id)

    // Queue TRELLIS conversion job
    await supabase.from('ai_jobs').insert({
      type: '3d_model_trellis',
      status: 'queued',
      input: {
        model_id: id,
        user_id: user.id,
        angle_images: angles
      },
      output: {},
      created_at: new Date().toISOString()
    })

    console.log('[3d-models] Starting TRELLIS conversion for model:', id)

    res.json({
      ok: true,
      message: '3D conversion started',
      cost: ITC_COSTS.convert
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
 * Create cart-compatible product for 3D print ordering
 * Simplified options: PLA grey only, optional paint kit addon
 */
router.post('/:id/order', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const user = (req as any).user
    const { id } = req.params
    const { include_paint_kit = false } = req.body

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

    // Calculate price: base PLA grey print + optional paint kit
    const basePrice = PRINT_PRICING.base_price
    const paintKitPrice = include_paint_kit ? PRINT_PRICING.paint_kit_addon : 0
    const totalPrice = basePrice + paintKitPrice

    // Build description
    const description = include_paint_kit
      ? `3D printed figurine in grey PLA with paint kit - a fun family project!`
      : `3D printed figurine in grey PLA, ${model.style} style`

    // Return cart-compatible product structure
    const product = {
      id: `3d-print-${model.id}`,
      name: `Custom 3D Figurine: ${model.prompt.substring(0, 40)}${model.prompt.length > 40 ? '...' : ''}`,
      description,
      category: '3d-prints',
      price: totalPrice,
      images: [model.concept_image_url].filter(Boolean),
      metadata: {
        model_id: model.id,
        stl_url: model.stl_url,
        glb_url: model.glb_url,
        material: 'pla',
        color: 'grey',
        include_paint_kit,
        style: model.style,
        prompt: model.prompt
      }
    }

    console.log('[3d-models] Order product created for model:', id, 'paint kit:', include_paint_kit, 'price:', totalPrice)

    res.json({ ok: true, product })
  } catch (error: any) {
    console.error('[3d-models] Order error:', error.message)
    res.status(500).json({ error: 'Failed to create order product' })
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
