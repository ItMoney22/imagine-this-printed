import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { normalizeProduct } from '../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { getPrediction, GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../services/replicate.js'
import { sendEmail } from '../utils/email.js'

const router = Router()

/**
 * POST /api/user-products/create
 * Create a user-submitted product using the AI Product Builder
 * Product goes to pending_approval status, needs admin approval
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

export default router
