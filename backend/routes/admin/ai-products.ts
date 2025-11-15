import { Router, Request, Response } from 'express'
import { supabase } from '../../lib/supabase.js'
import { normalizeProduct } from '../../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../../utils/slugify.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { searchForContext } from '../../services/serpapi-search.js'

const router = Router()

// Middleware to verify admin/manager role
async function requireAdmin(req: Request, res: Response, next: any): Promise<any> {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', req.user.sub)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' })
  }

  next()
}

// POST /api/admin/products/ai/create
router.post('/create', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { prompt, priceTarget, mockupStyle, background, tone, imageStyle, useSearch = true } = req.body

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
      imageStyle, // realistic or cartoon
      searchContext,
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
router.get('/:id/status', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params

    // Get product with related data
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Get assets
    const { data: assets } = await supabase
      .from('product_assets')
      .select('*')
      .eq('product_id', id)

    // Get jobs
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: true })

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

    req.log?.info({ productId: id }, '[ai-products] 🔄 Creating background removal job')

    // Create background removal job
    const { data: job, error: jobError } = await supabase
      .from('ai_jobs')
      .insert({
        product_id: id,
        type: 'replicate_rembg',
        status: 'queued',
        input: {},
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
