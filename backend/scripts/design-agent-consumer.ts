import '../load-env.js'
import { supabase } from '../lib/supabase.js'
import { runDesignBriefScout } from '../services/design-brief-scout.js'
import { normalizeProduct } from '../services/ai-product.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'
import { processImageJobInline } from '../routes/admin/ai-products.js'

async function consumeNextBrief() {
  console.log('[design-agent] 🎨 Starting design agent consumer...')
  console.log('[design-agent] SUPABASE_URL:', process.env.SUPABASE_URL)
  console.log('[design-agent] SUPABASE_SERVICE_ROLE_KEY suffix:', process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-10))
  console.log('[design-agent] DATABASE_URL suffix:', process.env.DATABASE_URL?.slice(-20))


  // 1. Fetch next pending brief from DB
  const { data: briefs, error: selectError } = await supabase
    .from('scout_design_briefs')
    .select('*')
    .eq('status', 'pending')
    .order('score', { ascending: false })
    .limit(1)

  if (selectError) {
    console.error('[design-agent] ❌ Failed to fetch pending briefs:', selectError.message)
    process.exit(1)
  }

  if (!briefs || briefs.length === 0) {
    console.log('[design-agent] ⏭️ No pending design briefs found. Running scout to populate/refresh...')
    const queue = await runDesignBriefScout({ minBriefs: 10 })
    console.log(`[design-agent] Generated ${queue.briefs.length} briefs. Persisting and retrying fetch...`)
    
    // Clear and insert
    await supabase.from('scout_design_briefs').delete().neq('id', '')
    const dbRows = queue.briefs.map((b) => ({
      id: b.id,
      rank: b.rank,
      score: b.score,
      theme: b.theme,
      saying: b.saying,
      style_notes: b.styleNotes,
      target_holiday: b.targetHoliday,
      target_date: b.targetDate,
      niche: b.niche,
      audience: b.audience,
      product_type: b.productType,
      evidence: b.evidence,
      saturation: b.saturation,
      risk_flags: b.riskFlags,
      source_queries: b.sourceQueries,
      status: 'pending',
    }))
    await supabase.from('scout_design_briefs').insert(dbRows)

    // Re-query
    const { data: refetched, error: refetchError } = await supabase
      .from('scout_design_briefs')
      .select('*')
      .eq('status', 'pending')
      .order('score', { ascending: false })
      .limit(1)

    if (refetchError || !refetched || refetched.length === 0) {
      console.log('[design-agent] ⏭️ Still no briefs available. Exiting.')
      return
    }
    briefs.push(refetched[0])
  }

  const brief = briefs[0]
  console.log(`[design-agent] 🎯 Processing brief: "${brief.theme}" (saying: "${brief.saying}", score: ${brief.score})`)

  // 2. Mark as processing
  const { error: updateError } = await supabase
    .from('scout_design_briefs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', brief.id)

  if (updateError) {
    console.error('[design-agent] ❌ Failed to update brief status:', updateError.message)
    process.exit(1)
  }

  try {
    // 3. Construct product creation inputs
    const prompt = `A professional graphic apparel design in the ${brief.niche} niche. The main graphic text on the shirt must read: "${brief.saying}". Style direction: ${brief.style_notes}. Target audience: ${brief.audience}.`
    const productType = brief.product_type || 'tshirt'
    const shirtColor = 'black'
    const printPlacement = 'front-center'
    const printStyle = 'clean'

    console.log('[design-agent] 🧠 Normalizing design brief into a structured product layout...')
    const normalized = await normalizeProduct({
      prompt,
      category: 'shirts',
      productType: productType as any,
      shirtColor,
      printPlacement,
    })

    // Upsert Category
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
      throw new Error(`Failed to upsert category: ${catError.message}`)
    }

    // Generate unique slug
    const baseSlug = slugify(normalized.title)
    const { data: existingProducts } = await supabase
      .from('products')
      .select('slug')
      .like('slug', `${baseSlug}%`)

    const existingSlugs = existingProducts?.map((p: any) => p.slug).filter(Boolean) || []
    const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)

    // Resolve print locations
    const printLocations = ['front_image']

    console.log(`[design-agent] 📦 Creating product draft: "${normalized.title}" (slug: ${uniqueSlug})`)
    
    // 4. Create product draft
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        category_id: category.id,
        name: normalized.title,
        slug: uniqueSlug,
        description: normalized.description,
        price: normalized.suggested_price_cents < 100
          ? normalized.suggested_price_cents
          : normalized.suggested_price_cents / 100,
        status: 'draft',
        images: [],
        category: normalized.category_slug,
        print_locations: printLocations,
        metadata: {
          ai_generated: true,
          original_prompt: prompt,
          image_prompt: normalized.image_prompt,
          mockup_style: 'realistic',
          background: 'transparent',
          tone: 'bold',
          image_style: 'semi-realistic',
          created_with_search: false,
          product_type: productType,
          shirt_color: shirtColor,
          print_placement: printPlacement,
          print_style: printStyle,
          print_size_inches: 11,
          model_id: 'openai/gpt-image-2',
          design_brief_id: brief.id,
          created_by_agent: 'itp-mr-imagine',
        },
      })
      .select()
      .single()

    if (productError) {
      throw new Error(`Failed to create product row: ${productError.message}`)
    }

    // 5. Insert tags
    if (normalized.tags.length > 0) {
      await supabase
        .from('product_tags')
        .insert(normalized.tags.map(tag => ({
          product_id: product.id,
          tag,
        })))
    }

    // 6. Insert variants
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

    // 7. Insert AI image generation job
    console.log('[design-agent] 🚀 Submitting image generation job to queue...')
    const jobs = [
      {
        product_id: product.id,
        type: 'replicate_image_v2',
        status: 'running', // pre-claimed for inline processing
        input: {
          prompt: normalized.image_prompt,
          width: 1024,
          height: 1024,
          background: normalized.background,
          productType,
          shirtColor,
          printPlacement,
          printStyle,
          imageStyle: 'semi-realistic',
          modelId: 'openai/gpt-image-2',
          forceSingleModel: false,
          multiModel: true,
        },
      },
    ]

    const { data: createdJobs, error: jobsError } = await supabase
      .from('ai_jobs')
      .insert(jobs)
      .select()

    if (jobsError) {
      throw new Error(`Failed to create AI jobs: ${jobsError.message}`)
    }

    // 8. Run processing inline
    if (createdJobs && createdJobs.length > 0) {
      const imageJob = createdJobs[0]
      console.log(`[design-agent] 🎨 Processing image job ${imageJob.id} inline...`)
      await processImageJobInline(imageJob)
      console.log('[design-agent] ✅ Image generation complete!')
    }

    // 9. Mark brief as completed
    await supabase
      .from('scout_design_briefs')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', brief.id)

    console.log(`[design-agent] 🎉 Successfully processed and completed brief "${brief.theme}"!`)
  } catch (err: any) {
    console.error(`[design-agent] ❌ Error processing brief "${brief.theme}":`, err.message || err)
    
    // Mark as failed
    await supabase
      .from('scout_design_briefs')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', brief.id)
  }
}

consumeNextBrief()
  .then(() => {
    console.log('[design-agent] Done.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('[design-agent] Fatal error:', err)
    process.exit(1)
  })
