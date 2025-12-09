import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../../lib/supabase.js'
import { normalizeProduct } from '../../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../../utils/slugify.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { searchForContext } from '../../services/serpapi-search.js'
import { getPrediction, AVAILABLE_MODELS } from '../../services/replicate.js'

const router = Router()

// GET /api/admin/products/ai/models - Get available image generation models
router.get('/models', requireAuth, async (req: Request, res: Response): Promise<any> => {
  res.json({
    models: AVAILABLE_MODELS,
    default: AVAILABLE_MODELS[0].id
  })
})

// Middleware to verify admin/manager role
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', req.user.sub)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    res.status(403).json({ error: 'Forbidden: Admin access required' })
    return
  }

  next()
}

// POST /api/admin/products/ai/create
router.post('/create', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      prompt,
      priceTarget,
      mockupStyle,
      background,
      tone,
      imageStyle,
      useSearch = false, // Default OFF - only enable for pop culture/trending
      // DTF Print Settings
      productType = 'tshirt',
      shirtColor = 'black',
      printPlacement = 'front-center',
      printStyle = 'clean',
      // Model Selection - defaults to Imagen 4 Ultra
      modelId = 'google/imagen-4-ultra'
    } = req.body

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' })
    }

    req.log?.info({ prompt, useSearch }, '[ai-products] 🚀 Creating product from prompt')

    // Step 0: Optionally search for context using SerpAPI
    let searchContext = ''
    if (useSearch) {
      req.log?.info({ query: prompt }, '[ai-products] 🔍 Calling SerpAPI to search for context...')
      const searchResult = await searchForContext(prompt)
      searchContext = searchResult.context
      req.log?.info({
        hasContext: searchResult.context.length > 0,
        contextLength: searchResult.context.length,
        contextPreview: searchResult.context.substring(0, 200),
        sources: searchResult.sources.length
      }, '[ai-products] 🔍 Search context obtained')
    } else {
      req.log?.info('[ai-products] ⏭️ Skipping web search (useSearch = false)')
    }

    // Step 1: Normalize with GPT (with optional search context)
    const normalized = await normalizeProduct({
      prompt,
      priceTarget,
      mockupStyle,
      background,
      tone,
      imageStyle, // realistic, cartoon, or semi-realistic
      searchContext,
      // DTF settings for context
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
      req.log?.error({ error: catError }, '[ai-products] ❌ Category error')
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

    // Step 4: Create product (draft) with AI metadata
    const { data: product, error: productError} = await supabase
      .from('products')
      .insert({
        category_id: category.id,
        name: normalized.title,
        slug: uniqueSlug,
        description: normalized.description,
        price: normalized.suggested_price_cents / 100,
        status: 'draft',
        images: [],
        category: normalized.category_slug,
        metadata: {
          ai_generated: true,
          original_prompt: prompt,
          image_prompt: normalized.image_prompt,
          mockup_style: mockupStyle,
          background,
          tone,
          image_style: imageStyle,
          created_with_search: useSearch,
          search_context: searchContext ? searchContext.substring(0, 500) : null,
          // DTF Print Settings
          product_type: productType,
          shirt_color: shirtColor,
          print_placement: printPlacement,
          print_style: printStyle,
          // Model used for image generation
          model_id: modelId,
        },
      })
      .select()
      .single()

    if (productError) {
      req.log?.error({ error: productError }, '[ai-products] ❌ Product error')
      return res.status(500).json({ error: 'Failed to create product', details: productError.message })
    }

    req.log?.info({ productId: product.id }, '[ai-products] ✅ Product created')

    // Step 5: Create tags
    if (normalized.tags.length > 0) {
      await supabase
        .from('product_tags')
        .insert(normalized.tags.map(tag => ({
          product_id: product.id,
          tag,
        })))
    }

    // Step 6: Create variants
    if (normalized.variants.length > 0) {
      await supabase
        .from('product_variants')
        .insert(normalized.variants.map(variant => ({
          product_id: product.id,
          name: variant.name,
          price_cents: normalized.suggested_price_cents + (variant.priceDeltaCents || 0),
          stock: 0,
        })))
    }

    // Step 7: Create ONLY source image job (manual workflow)
    const jobs = [
      {
        product_id: product.id,
        type: 'replicate_image',
        status: 'queued',
        input: {
          // Use GPT-generated detailed image prompt
          prompt: normalized.image_prompt,
          width: 1024,
          height: 1024,
          background: normalized.background,
          // DTF Print Settings
          productType,
          shirtColor,
          printPlacement,
          printStyle,
          // Art style for image generation
          imageStyle,
          // Model selection
          modelId,
        },
      },
    ]

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobs)
      .select()

    if (jobsError) {
      req.log?.error({ error: jobsError }, '[ai-products] ❌ Jobs error')
    }

    req.log?.info({ count: createdJobs?.length }, '[ai-products] ✅ Jobs created')

    res.json({
      productId: product.id,
      product: {
        ...product,
        normalized,
      },
      jobs: createdJobs,
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// GET /api/admin/products/ai/:id/status
// Query params:
//   display=true - Returns only display assets (primary design + mockups), ordered by display_order
router.get('/:id/status', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const displayOnly = req.query.display === 'true'

    // Get product with related data
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Get assets - filter for display if requested
    let assetsQuery = supabase
      .from('product_assets')
      .select('*')
      .eq('product_id', id)

    if (displayOnly) {
      // Only get primary design and mockup assets for storefront display
      assetsQuery = assetsQuery.or('is_primary.eq.true,asset_role.like.mockup_%')
      assetsQuery = assetsQuery.order('display_order', { ascending: true })
    }

    const { data: assets } = await assetsQuery

    // Get jobs
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: true })

    // ACTIVE CHECK: If any job is running or queued, check Replicate status
    // This is crucial for local development where webhooks might fail
    if (jobs && jobs.length > 0) {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if ((job.status === 'queued' || job.status === 'running') && job.replicate_id) {
          try {
            req.log?.info({ jobId: job.id, replicateId: job.replicate_id }, '[ai-products] 📡 Polling Replicate for job status');
            const prediction = await getPrediction(job.replicate_id);
            
            let newStatus = job.status;
            let output = job.output;
            let error = job.error;

            if (prediction.status === 'succeeded') {
              newStatus = 'succeeded';
              output = prediction.output;
            } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
              newStatus = 'failed';
              error = prediction.error;
            } else if (prediction.status === 'processing' || prediction.status === 'starting') {
              newStatus = 'running';
            }

            if (newStatus !== job.status) {
              req.log?.info({ jobId: job.id, oldStatus: job.status, newStatus: newStatus }, '[ai-products] 🔄 Updating job status in DB');
              
              const { data: updatedJob, error: updateError } = await supabase
                .from('ai_jobs')
                .update({ 
                  status: newStatus,
                  output: output,
                  error: error,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)
                .select()
                .single();

              if (updateError) {
                req.log?.error({ updateError }, '[ai-products] ❌ Error updating job status');
              } else if (updatedJob) {
                jobs[i] = updatedJob; // Update the job in the array being sent back
              }
            }
          } catch (err: any) {
            req.log?.error({ jobId: job.id, err: err.message }, '[ai-products] ⚠️ Failed to sync job with Replicate');
          }
        }
      }
    }

    res.json({
      product: product,
      assets: assets || [],
      jobs: jobs || [],
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/remove-background
router.post('/:id/remove-background', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { selectedAssetId } = req.body

    req.log?.info({ productId: id, selectedAssetId }, '[ai-products] 🔄 Creating background removal job')

    // Create background removal job with selected asset ID
    const { data: job, error: jobError } = await supabase
      .from('ai_jobs')
      .insert({
        product_id: id,
        type: 'replicate_rembg',
        status: 'queued',
        input: {
          selected_asset_id: selectedAssetId, // Pass the specific asset to process
        },
      })
      .select()
      .single()

    if (jobError) {
      req.log?.error({ error: jobError }, '[ai-products] ❌ Job creation error')
      return res.status(500).json({ error: 'Failed to create background removal job' })
    }

    req.log?.info({ jobId: job.id }, '[ai-products] ✅ Background removal job created')

    res.json({ job })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/create-mockups
router.post('/:id/create-mockups', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params

    req.log?.info({ productId: id }, '[ai-products] 🔄 Creating mockup jobs')

    // Get product to get category slug
    const { data: product } = await supabase
      .from('products')
      .select('category')
      .eq('id', id)
      .single()

    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Create 2 mockup jobs
    const jobs = [
      {
        product_id: id,
        type: 'replicate_mockup',
        status: 'queued',
        input: {
          template: 'flat_lay',
          product_type: product.category,
        },
      },
      {
        product_id: id,
        type: 'replicate_mockup',
        status: 'queued',
        input: {
          template: 'lifestyle',
          product_type: product.category,
        },
      },
    ]

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobs)
      .select()

    if (jobsError) {
      req.log?.error({ error: jobsError }, '[ai-products] ❌ Jobs creation error')
      return res.status(500).json({ error: 'Failed to create mockup jobs' })
    }

    req.log?.info({ count: createdJobs?.length }, '[ai-products] ✅ Mockup jobs created')

    res.json({ jobs: createdJobs })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/select-image
// Select an image from the 3 generated options and trigger mockup generation
router.post('/:id/select-image', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { selectedAssetId } = req.body

    if (!selectedAssetId) {
      return res.status(400).json({ error: 'selectedAssetId is required' })
    }

    req.log?.info({ productId: id, selectedAssetId }, '[ai-products] 🎨 User selected image')

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

    // Mark the selected asset as primary with explicit fields
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

    // DELETE non-selected source and DTF images (keep only the selected one)
    // This ensures only 3 final images: selected design + 2 mockups
    console.log('[ai-products] 🗑️ Deleting non-selected assets for product:', id, '(keeping selected:', selectedAssetId, ')')

    const { data: deletedAssets, error: deleteError } = await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', id)
      .in('kind', ['source', 'dtf']) // Delete source and DTF assets
      .neq('id', selectedAssetId) // But NOT the selected one
      .select('id')

    if (deleteError) {
      console.error('[ai-products] ❌ Failed to delete non-selected assets:', deleteError)
      req.log?.warn({ error: deleteError }, '[ai-products] ⚠️ Failed to delete non-selected assets')
    } else {
      console.log('[ai-products] ✅ Deleted', deletedAssets?.length || 0, 'non-selected assets:', deletedAssets?.map(a => a.id))
      req.log?.info({ deletedCount: deletedAssets?.length || 0 }, '[ai-products] 🗑️ Deleted non-selected assets')
    }

    // Get the image generation job to extract DTF settings
    const { data: imageJob } = await supabase
      .from('ai_jobs')
      .select('input')
      .eq('product_id', id)
      .eq('type', 'replicate_image')
      .single()

    // Get product category
    const { data: product } = await supabase
      .from('products')
      .select('category')
      .eq('id', id)
      .single()

    // Create TWO mockup jobs:
    // 1. Flat lay mockup (shirt on surface)
    // 2. Mr. Imagine mockup (mascot wearing shirt)
    const baseInput = {
      product_type: product?.category || 'shirts',
      productType: imageJob?.input?.productType || 'tshirt',
      shirtColor: imageJob?.input?.shirtColor || 'black',
      printPlacement: imageJob?.input?.printPlacement || 'front-center',
      selected_asset_id: selectedAssetId,
    }

    const mockupJobs = [
      {
        product_id: id,
        type: 'replicate_mockup',
        status: 'queued',
        input: {
          ...baseInput,
          template: 'flat_lay',
        },
      },
      {
        product_id: id,
        type: 'replicate_mockup',
        status: 'queued',
        input: {
          ...baseInput,
          template: 'mr_imagine',
        },
      },
    ]

    console.log('[ai-products] 🎨 Creating mockup jobs:', mockupJobs.map(j => ({ type: j.type, template: j.input.template })))

    const { data: createdJobs, error: jobError } = await supabase
      .from('ai_jobs')
      .insert(mockupJobs)
      .select()

    if (jobError) {
      console.error('[ai-products] ❌ Mockup job creation error:', jobError)
      req.log?.error({ error: jobError }, '[ai-products] ❌ Mockup job creation error')
      return res.status(500).json({ error: 'Failed to create mockup jobs' })
    }

    console.log('[ai-products] ✅ Successfully created', createdJobs?.length, 'mockup jobs:', createdJobs?.map(j => ({ id: j.id, template: j.input?.template })))
    req.log?.info({ jobCount: createdJobs?.length }, '[ai-products] ✅ Mockup jobs created (flat_lay + mr_imagine)')

    res.json({
      message: 'Image selected and mockup generation started',
      selectedAsset,
      mockupJobs: createdJobs
    })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/products/ai/:id/regenerate-images
// Regenerate images for an AI-generated product using stored metadata
router.post('/:id/regenerate-images', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params

    // Get product with metadata
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    if (!product.metadata?.ai_generated || !product.metadata?.image_prompt) {
      return res.status(400).json({ error: 'Product was not AI-generated or missing image prompt metadata' })
    }

    req.log?.info({ productId: id }, '[ai-products] 🔄 Regenerating images for product')

    // Create new image generation job using stored metadata
    const job = {
      product_id: product.id,
      type: 'replicate_image',
      status: 'queued',
      input: {
        prompt: product.metadata.image_prompt,
        width: 1024,
        height: 1024,
        background: product.metadata.background || 'transparent',
      },
    }

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert([job])
      .select()

    if (jobsError) {
      req.log?.error({ error: jobsError }, '[ai-products] ❌ Job creation error')
      return res.status(500).json({ error: 'Failed to create regeneration job' })
    }

    req.log?.info({ jobId: createdJobs[0].id }, '[ai-products] ✅ Regeneration job created')

    res.json({ job: createdJobs[0] })
  } catch (error: any) {
    req.log?.error({ error }, '[ai-products] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

export default router
