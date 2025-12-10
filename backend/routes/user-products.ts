import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { normalizeProduct } from '../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { getPrediction, GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../services/replicate.js'
import { sendEmail } from '../utils/email.js'

const router = Router()

// Cost in ITC to generate a design
const GENERATION_COST_ITC = 50

/**
 * POST /api/user-products/create
 * Create a user-submitted product using the AI Product Builder
 * Product goes to pending_approval status, needs admin approval
 *
 * Requires 50 ITC credits per generation to prevent abuse
 */
router.post('/create', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const {
      prompt,
      imageStyle,
      shirtColor = 'black',
      printStyle = 'dtf',
      productType = 'tshirt',
      printPlacement = 'front-center',
      modelId = 'google/imagen-4-ultra'
    } = req.body

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    console.log('[user-products] 🚀 User creating product:', { userId, prompt: prompt.substring(0, 50) })

    // ============================================
    // ITC Credit Check and Deduction
    // ============================================

    // Step 0a: Check user's ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('id, itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      console.error('[user-products] ❌ Wallet not found for user:', userId)
      return res.status(402).json({
        error: 'Wallet not found',
        required: GENERATION_COST_ITC,
        current: 0,
        message: 'Please set up your wallet before creating designs'
      })
    }

    if (wallet.itc_balance < GENERATION_COST_ITC) {
      console.log('[user-products] ⚠️ Insufficient ITC credits:', {
        userId,
        balance: wallet.itc_balance,
        required: GENERATION_COST_ITC
      })
      return res.status(402).json({
        error: 'Insufficient ITC credits',
        required: GENERATION_COST_ITC,
        current: wallet.itc_balance,
        message: `You need ${GENERATION_COST_ITC} ITC credits to generate a design. Current balance: ${wallet.itc_balance} ITC`
      })
    }

    // Step 0b: Deduct ITC credits BEFORE generation starts
    const newBalance = wallet.itc_balance - GENERATION_COST_ITC
    const { error: deductError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    if (deductError) {
      console.error('[user-products] ❌ Failed to deduct ITC credits:', deductError)
      return res.status(500).json({ error: 'Failed to process payment' })
    }

    // Step 0c: Log the transaction
    const { error: txError } = await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        type: 'usage',
        amount: -GENERATION_COST_ITC,
        balance_after: newBalance,
        reference_type: 'design_generation',
        description: `Design generation: ${prompt.substring(0, 50)}...`,
        metadata: {
          reason: 'Design generation',
          prompt_preview: prompt.substring(0, 100),
          product_type: productType,
        }
      })

    if (txError) {
      console.error('[user-products] ⚠️ Failed to log transaction (non-blocking):', txError)
      // Non-blocking - continue even if transaction logging fails
    }

    console.log('[user-products] 💰 ITC deducted:', {
      userId,
      amount: GENERATION_COST_ITC,
      newBalance
    })

    // Step 1: Normalize with GPT (same as admin flow)
    const normalized = await normalizeProduct({
      prompt,
      priceTarget: 2500, // $25 default
      mockupStyle: 'realistic',
      background: 'transparent',
      tone: 'casual',
      imageStyle,
      productType,
      shirtColor,
      printPlacement,
    })

    // Step 2: Upsert category
    const { data: category, error: catError } = await supabase
      .from('product_categories')
      .upsert({
        slug: normalized.category_slug,
        name: normalized.category_name,
      }, {
        onConflict: 'slug',
      })
      .select()
      .single()

    if (catError) {
      console.error('[user-products] ❌ Category error:', catError)
      return res.status(500).json({ error: 'Failed to create category' })
    }

    // Step 3: Generate unique slug
    const baseSlug = slugify(normalized.title)
    const { data: existingProducts } = await supabase
      .from('products')
      .select('slug')
      .like('slug', `${baseSlug}%`)

    const existingSlugs = existingProducts?.map((p: any) => p.slug).filter(Boolean) || []
    const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)

    // Step 4: Create product with USER-SUBMITTED metadata
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        category_id: category.id,
        name: normalized.title,
        slug: uniqueSlug,
        description: normalized.description,
        price: normalized.suggested_price_cents / 100,
        status: 'pending_approval', // User products need admin approval
        images: [],
        category: normalized.category_slug,
        // Use proper columns for user-generated tracking (for royalties)
        is_user_generated: true,
        created_by_user_id: userId,
        metadata: {
          ai_generated: true,
          user_submitted: true, // Mark as user-submitted
          creator_id: userId, // Track who created it
          original_prompt: prompt,
          image_prompt: normalized.image_prompt,
          mockup_style: 'realistic',
          background: 'transparent',
          tone: 'casual',
          image_style: imageStyle,
          // DTF Print Settings
          product_type: productType,
          shirt_color: shirtColor,
          print_placement: printPlacement,
          print_style: printStyle,
          model_id: modelId,
          // Royalty settings
          creator_royalty_percent: 10, // 10% royalty on each sale
          submitted_at: new Date().toISOString(),
        },
      })
      .select()
      .single()

    if (productError) {
      console.error('[user-products] ❌ Product error:', productError)
      return res.status(500).json({ error: 'Failed to create product', details: productError.message })
    }

    console.log('[user-products] ✅ Product created:', product.id)

    // Step 5: Create tags
    if (normalized.tags.length > 0) {
      await supabase
        .from('product_tags')
        .insert(normalized.tags.map(tag => ({
          product_id: product.id,
          tag,
        })))
    }

    // Step 6: Create image generation job
    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert({
        product_id: product.id,
        type: 'replicate_image',
        status: 'queued',
        input: {
          prompt: normalized.image_prompt,
          width: 1024,
          height: 1024,
          background: 'transparent',
          productType,
          shirtColor,
          printPlacement,
          printStyle,
          imageStyle,
          modelId,
        },
      })
      .select()

    if (jobsError) {
      console.error('[user-products] ❌ Jobs error:', jobsError)
    }

    console.log('[user-products] ✅ Image generation job created')

    res.json({
      productId: product.id,
      product: {
        ...product,
        normalized,
      },
      jobs: createdJobs,
    })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/user-products/:id/status
 * Get status of a user's product (checks ownership)
 */
router.get('/:id/status', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params

    // Get product and verify ownership
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Verify user owns this product or is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single()

    const isOwner = product.metadata?.creator_id === userId
    const isAdmin = profile?.role === 'admin' || profile?.role === 'manager'

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Get assets
    const { data: assets } = await supabase
      .from('product_assets')
      .select('*')
      .eq('product_id', id)
      .order('display_order', { ascending: true })

    // Get jobs and poll Replicate for status updates
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: true })

    // Poll Replicate for running jobs
    if (jobs && jobs.length > 0) {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]
        if ((job.status === 'queued' || job.status === 'running') && job.replicate_id) {
          try {
            const prediction = await getPrediction(job.replicate_id)

            let newStatus = job.status
            let output = job.output
            let error = job.error

            if (prediction.status === 'succeeded') {
              newStatus = 'succeeded'
              output = prediction.output
            } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
              newStatus = 'failed'
              error = prediction.error
            } else if (prediction.status === 'processing' || prediction.status === 'starting') {
              newStatus = 'running'
            }

            if (newStatus !== job.status) {
              const { data: updatedJob } = await supabase
                .from('ai_jobs')
                .update({
                  status: newStatus,
                  output: output,
                  error: error,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)
                .select()
                .single()

              if (updatedJob) {
                jobs[i] = updatedJob
              }
            }
          } catch (err: any) {
            console.error('[user-products] ⚠️ Failed to sync job with Replicate:', err.message)
          }
        }
      }
    }

    res.json({
      product,
      assets: assets || [],
      jobs: jobs || [],
    })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/user-products/:id/select-image
 * Select an image and trigger mockup generation
 */
router.post('/:id/select-image', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params
    const { selectedAssetId } = req.body

    if (!selectedAssetId) {
      return res.status(400).json({ error: 'selectedAssetId is required' })
    }

    // Verify ownership
    const { data: product } = await supabase
      .from('products')
      .select('metadata, category')
      .eq('id', id)
      .single()

    if (!product || product.metadata?.creator_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Get the selected asset
    const { data: selectedAsset, error: assetError } = await supabase
      .from('product_assets')
      .select('*')
      .eq('id', selectedAssetId)
      .eq('product_id', id)
      .single()

    if (assetError || !selectedAsset) {
      return res.status(404).json({ error: 'Selected asset not found' })
    }

    // Mark as primary
    await supabase
      .from('product_assets')
      .update({
        is_primary: true,
        asset_role: 'design',
        display_order: 1,
        metadata: {
          ...selectedAsset.metadata,
          is_selected: true,
          selected_at: new Date().toISOString()
        }
      })
      .eq('id', selectedAssetId)

    // Delete non-selected images
    await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', id)
      .in('kind', ['source', 'dtf'])
      .neq('id', selectedAssetId)

    // Get image job for DTF settings
    const { data: imageJob } = await supabase
      .from('ai_jobs')
      .select('input')
      .eq('product_id', id)
      .eq('type', 'replicate_image')
      .single()

    // Create mockup jobs (flat_lay + ghost_mannequin for garments + mr_imagine)
    const baseInput = {
      product_type: product.category || 'shirts',
      productType: imageJob?.input?.productType || 'tshirt',
      shirtColor: imageJob?.input?.shirtColor || 'black',
      printPlacement: imageJob?.input?.printPlacement || 'front-center',
      selected_asset_id: selectedAssetId,
    }

    const mockupJobs: any[] = [
      {
        product_id: id,
        type: 'replicate_mockup',
        status: 'queued',
        input: { ...baseInput, template: 'flat_lay' },
      },
    ]

    // Add ghost mannequin job only for supported garment types
    const productCategory = product.category || 'shirts'
    const productType = imageJob?.input?.productType || 'tshirt'
    if (GHOST_MANNEQUIN_SUPPORTED_CATEGORIES.includes(productCategory) ||
        GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(productType)) {
      mockupJobs.push({
        product_id: id,
        type: 'ghost_mannequin',
        status: 'queued',
        input: baseInput,
      })
      console.log('[user-products] 👻 Adding ghost mannequin job for garment type:', productType)
    }

    // Always add Mr. Imagine mockup
    mockupJobs.push({
      product_id: id,
      type: 'replicate_mockup',
      status: 'queued',
      input: { ...baseInput, template: 'mr_imagine' },
    })

    const { data: createdJobs, error: jobError } = await supabase
      .from('ai_jobs')
      .insert(mockupJobs)
      .select()

    if (jobError) {
      console.error('[user-products] ❌ Mockup job error:', jobError)
      return res.status(500).json({ error: 'Failed to create mockup jobs' })
    }

    console.log('[user-products] ✅ Mockup jobs created')

    res.json({
      message: 'Image selected and mockup generation started',
      selectedAsset,
      mockupJobs: createdJobs
    })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Cost for design variations (discounted from full generation)
const VARIATION_COST_ITC = 25

/**
 * POST /api/user-products/:id/variations
 * Generate design variations from an existing product
 * Costs 25 ITC per batch of 3 variations (discounted from 50)
 */
router.post('/:id/variations', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params
    const { variationType = 'style' } = req.body // style, color, composition

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    // Get product and verify ownership
    const { data: product } = await supabase
      .from('products')
      .select('*, metadata')
      .eq('id', id)
      .single()

    if (!product || product.metadata?.creator_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Check ITC balance
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (!wallet || wallet.itc_balance < VARIATION_COST_ITC) {
      return res.status(402).json({
        error: 'Insufficient ITC credits',
        required: VARIATION_COST_ITC,
        current: wallet?.itc_balance || 0
      })
    }

    // Deduct credits
    const newBalance = wallet.itc_balance - VARIATION_COST_ITC
    await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    // Log transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'usage',
      amount: -VARIATION_COST_ITC,
      balance_after: newBalance,
      reference_type: 'design_variation',
      description: `Design variations (${variationType}) for product`,
      metadata: { product_id: id, variation_type: variationType }
    })

    // Get original prompt
    const originalPrompt = product.metadata?.original_prompt || product.metadata?.image_prompt || product.description

    // Generate variation prompts based on type
    const variationPrompts: string[] = []
    const baseStyle = product.metadata?.image_style || 'realistic'

    switch (variationType) {
      case 'color':
        variationPrompts.push(
          `${originalPrompt}, with vibrant neon colors`,
          `${originalPrompt}, in warm sunset tones`,
          `${originalPrompt}, with cool blue and purple palette`
        )
        break
      case 'composition':
        variationPrompts.push(
          `${originalPrompt}, close-up detailed view`,
          `${originalPrompt}, zoomed out with more background`,
          `${originalPrompt}, dynamic angle perspective`
        )
        break
      case 'style':
      default:
        variationPrompts.push(
          `${originalPrompt}, ${baseStyle === 'realistic' ? 'bold graphic art style' : 'hyper-realistic photo style'}`,
          `${originalPrompt}, retro vintage aesthetic`,
          `${originalPrompt}, minimalist clean design`
        )
    }

    // Create variation jobs
    const jobsToCreate = variationPrompts.map((prompt, idx) => ({
      product_id: id,
      type: 'replicate_image',
      status: 'queued',
      input: {
        prompt,
        width: 1024,
        height: 1024,
        background: 'transparent',
        productType: product.metadata?.product_type || 'tshirt',
        shirtColor: product.metadata?.shirt_color || 'black',
        printPlacement: product.metadata?.print_placement || 'front-center',
        printStyle: product.metadata?.print_style || 'dtf',
        imageStyle: product.metadata?.image_style || 'realistic',
        modelId: product.metadata?.model_id || 'black-forest-labs/flux-1.1-pro-ultra',
        is_variation: true,
        variation_index: idx,
        variation_type: variationType,
        original_prompt: originalPrompt,
      },
    }))

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobsToCreate)
      .select()

    if (jobsError) {
      console.error('[user-products] ❌ Variation jobs error:', jobsError)
      // Refund on failure
      await supabase
        .from('user_wallets')
        .update({ itc_balance: wallet.itc_balance })
        .eq('user_id', userId)
      return res.status(500).json({ error: 'Failed to create variation jobs' })
    }

    console.log('[user-products] ✅ Variation jobs created:', createdJobs?.length)

    res.json({
      message: `${variationPrompts.length} variations queued`,
      jobs: createdJobs,
      cost: VARIATION_COST_ITC,
      newBalance,
      variationType
    })
  } catch (error: any) {
    console.error('[user-products] ❌ Variation error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/user-products/:id/submit-for-approval
 * Submit completed product for admin approval
 */
router.post('/:id/submit-for-approval', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params

    // Verify ownership
    const { data: product } = await supabase
      .from('products')
      .select('*, metadata')
      .eq('id', id)
      .single()

    if (!product || product.metadata?.creator_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Verify product has images
    const { data: assets } = await supabase
      .from('product_assets')
      .select('id')
      .eq('product_id', id)
      .eq('is_primary', true)

    if (!assets || assets.length === 0) {
      return res.status(400).json({ error: 'Product must have a selected image before submission' })
    }

    // Update status to pending_approval
    const { error: updateError } = await supabase
      .from('products')
      .update({
        status: 'pending_approval',
        metadata: {
          ...product.metadata,
          submitted_for_approval_at: new Date().toISOString(),
        }
      })
      .eq('id', id)

    if (updateError) {
      return res.status(500).json({ error: 'Failed to submit for approval' })
    }

    console.log('[user-products] ✅ Product submitted for approval:', id)

    res.json({ message: 'Product submitted for approval' })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/user-products/my-products
 * Get all products created by the current user
 */
router.get('/my-products', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('metadata->>creator_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch products' })
    }

    res.json({ products: products || [] })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/user-products/my-earnings
 * Get earnings summary for the current user
 */
router.get('/my-earnings', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    // Get user's products
    const { data: products } = await supabase
      .from('products')
      .select('id, name, price, status')
      .eq('metadata->>creator_id', userId)

    if (!products || products.length === 0) {
      return res.json({
        totalEarnings: 0,
        pendingEarnings: 0,
        paidEarnings: 0,
        productCount: 0,
        salesCount: 0,
      })
    }

    const productIds = products.map(p => p.id)

    // Get sales from order_items where product is user's
    const { data: sales } = await supabase
      .from('order_items')
      .select('quantity, unit_price, order_id')
      .in('product_id', productIds)

    // Get creator royalties
    const { data: royalties } = await supabase
      .from('creator_royalties')
      .select('*')
      .eq('creator_id', userId)

    const totalEarnings = royalties?.reduce((sum, r) => sum + (r.amount_cents || 0), 0) || 0
    const pendingEarnings = royalties?.filter(r => r.status === 'pending').reduce((sum, r) => sum + (r.amount_cents || 0), 0) || 0
    const paidEarnings = royalties?.filter(r => r.status === 'paid').reduce((sum, r) => sum + (r.amount_cents || 0), 0) || 0

    res.json({
      totalEarnings: totalEarnings / 100,
      pendingEarnings: pendingEarnings / 100,
      paidEarnings: paidEarnings / 100,
      productCount: products.length,
      salesCount: sales?.length || 0,
      products: products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        status: p.status,
      })),
      royalties: royalties || [],
    })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

// ==============================================
// DESIGN SESSIONS (Drafts & History)
// ==============================================

/**
 * GET /api/user-products/design-sessions
 * Get all design sessions for current user
 */
router.get('/design-sessions', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    const { data: sessions, error } = await supabase
      .from('user_design_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[user-products] ❌ Design sessions error:', error)
      return res.status(500).json({ error: 'Failed to fetch design sessions' })
    }

    res.json({ sessions: sessions || [] })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/user-products/design-sessions/drafts
 * Get only draft sessions (in-progress)
 */
router.get('/design-sessions/drafts', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    const { data: drafts, error } = await supabase
      .from('user_design_sessions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['draft', 'generating'])
      .order('updated_at', { ascending: false })
      .limit(10)

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch drafts' })
    }

    res.json({ drafts: drafts || [] })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/user-products/design-sessions/:id
 * Get a specific design session
 */
router.get('/design-sessions/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params

    const { data: session, error } = await supabase
      .from('user_design_sessions')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    res.json({ session })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/user-products/design-sessions
 * Create a new design session (draft)
 */
router.post('/design-sessions', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { prompt, style, color, product_type, step = 'welcome' } = req.body

    const { data: session, error } = await supabase
      .from('user_design_sessions')
      .insert({
        user_id: userId,
        status: 'draft',
        prompt,
        style,
        color,
        product_type: product_type || 't-shirt',
        step,
        conversation_history: [],
        generated_images: [],
      })
      .select()
      .single()

    if (error) {
      console.error('[user-products] ❌ Create session error:', error)
      return res.status(500).json({ error: 'Failed to create session' })
    }

    console.log('[user-products] ✅ Design session created:', session.id)
    res.json({ session })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/user-products/design-sessions/:id
 * Update a design session (save draft progress)
 */
router.patch('/design-sessions/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params
    const { prompt, style, color, product_type, step, status, conversation_history, generated_images, selected_image_url, product_id } = req.body

    // Build update object with only provided fields
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (prompt !== undefined) updates.prompt = prompt
    if (style !== undefined) updates.style = style
    if (color !== undefined) updates.color = color
    if (product_type !== undefined) updates.product_type = product_type
    if (step !== undefined) updates.step = step
    if (status !== undefined) updates.status = status
    if (conversation_history !== undefined) updates.conversation_history = conversation_history
    if (generated_images !== undefined) updates.generated_images = generated_images
    if (selected_image_url !== undefined) updates.selected_image_url = selected_image_url
    if (product_id !== undefined) updates.product_id = product_id

    const { data: session, error } = await supabase
      .from('user_design_sessions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      console.error('[user-products] ❌ Update session error:', error)
      return res.status(500).json({ error: 'Failed to update session' })
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    res.json({ session })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/user-products/design-sessions/:id
 * Delete a design session
 */
router.delete('/design-sessions/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params

    const { error } = await supabase
      .from('user_design_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) {
      console.error('[user-products] ❌ Delete session error:', error)
      return res.status(500).json({ error: 'Failed to delete session' })
    }

    res.json({ message: 'Session deleted' })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/user-products/design-sessions/:id/remix
 * Create a new session from an existing one (remix)
 */
router.post('/design-sessions/:id/remix', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params

    // Get original session
    const { data: original, error: fetchError } = await supabase
      .from('user_design_sessions')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !original) {
      return res.status(404).json({ error: 'Original session not found' })
    }

    // Create new session with same prompt but reset status
    const { data: session, error } = await supabase
      .from('user_design_sessions')
      .insert({
        user_id: userId,
        status: 'draft',
        prompt: original.prompt,
        style: original.style,
        color: original.color,
        product_type: original.product_type,
        step: 'prompt', // Start at prompt step with pre-filled prompt
        conversation_history: [],
        generated_images: [],
      })
      .select()
      .single()

    if (error) {
      console.error('[user-products] ❌ Remix session error:', error)
      return res.status(500).json({ error: 'Failed to remix session' })
    }

    console.log('[user-products] ✅ Session remixed:', original.id, '->', session.id)
    res.json({ session, original_id: id })
  } catch (error: any) {
    console.error('[user-products] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
