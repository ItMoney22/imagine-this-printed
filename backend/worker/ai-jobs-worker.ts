import { supabase } from '../lib/supabase.js'
import { generateMockup, removeBackgroundSync, upscaleImage, getPrediction, GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../services/replicate.js'
import { runImageFlowGenerate, runImageFlowMockup, runImageFlowMultiGenerate } from '../services/image-flow/worker-helpers.js'
import { uploadImageFromUrl, uploadImageFromBase64, uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { optimizeForDTF, type DTFOptimizationOptions } from '../services/dtf-optimizer.js'
import { buildConceptPrompt, buildAnglePrompt, getAngleOrder, TOY_MODE_CLAUSE, COLOR4_CLAUSE, type Style3D } from '../services/nano-banana-3d.js'
import { generate3DModel } from '../services/trellis-client.js'
import { generateTripo3D, SIZE_TIERS, type PrintSizeTier } from '../services/tripo3d.js'
import { convertGlbToStl } from '../services/glb-to-stl.js'
import { addWatermark } from '../services/watermark.js'
import Replicate from 'replicate'

// Initialize Replicate client for NanoBanana
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

const POLL_INTERVAL = 5000 // 5 seconds

// Helper to update job progress message (visible to admin in real-time)
async function updateJobProgress(jobId: string, message: string, step?: number, totalSteps?: number) {
  const progress: any = {
    message,
    updated_at: new Date().toISOString(),
  }
  if (step !== undefined) progress.step = step
  if (totalSteps !== undefined) progress.total_steps = totalSteps

  // First fetch existing output to merge with progress
  const { data: existingJob } = await supabase
    .from('ai_jobs')
    .select('output')
    .eq('id', jobId)
    .single()

  const mergedOutput = { ...(existingJob?.output || {}), ...progress }

  await supabase
    .from('ai_jobs')
    .update({
      output: mergedOutput,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  console.log(`[worker] 📝 Progress: ${message}`)
}

export async function processQueuedJobs() {
  try {
    // Recover orphaned 'running' jobs: only when they've been stuck >12 min with no
    // updates AND aren't 3D Tripo jobs (those legitimately run 2-10 min on fal).
    // Skipping 3d_model_tripo prevents yanking an actively-running Tripo job mid-execution.
    const twelveMinAgo = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    const { data: stuck } = await supabase
      .from('ai_jobs')
      .select('id, type, updated_at')
      .eq('status', 'running')
      .is('prediction_id', null)
      .lt('updated_at', twelveMinAgo)
      .neq('type', '3d_model_tripo')
      .limit(20)
    if (stuck && stuck.length > 0) {
      console.log('[worker] 🔁 Resetting', stuck.length, 'stuck running jobs to queued')
      for (const j of stuck) {
        await supabase
          .from('ai_jobs')
          .update({ status: 'queued', updated_at: new Date().toISOString() })
          .eq('id', j.id)
      }
    }

    // Hard 30-min ceiling for 3D Tripo jobs. The 12-min sweep above intentionally
    // skips these because Tripo legitimately runs 2-10 min, but a hung fal.ai
    // task can squat in 'running' indefinitely. Past 30 min, mark FAILED (not
    // requeued) so we don't trigger the fal.ai cost spiral that the auto-retry
    // sweep used to cause. User can manually retry from the UI.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: hung3d } = await supabase
      .from('ai_jobs')
      .select('id, updated_at')
      .eq('status', 'running')
      .in('type', ['3d_model_tripo', '3d_model_tripo_v2'])
      .lt('updated_at', thirtyMinAgo)
      .limit(20)
    if (hung3d && hung3d.length > 0) {
      console.warn('[worker] ⏱️ Failing', hung3d.length, '3D Tripo jobs stuck >30 min')
      for (const j of hung3d) {
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: 'Generation timed out after 30 minutes. The 3D service may be backed up — please try again.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', j.id)
      }
    }

    // (Auto-retry sweep removed — was looping due to fal.ai Tripo3D being slow.
    //  User can manually retry from the UI if needed.)

    // Fetch queued jobs (not started yet)
    const { data: queuedJobs, error: queuedError } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(10)

    if (queuedError) {
      console.error('[worker] ❌ Error fetching queued jobs:', queuedError)
    }

    if (queuedJobs && queuedJobs.length > 0) {
      console.log('[worker] 📋 Processing', queuedJobs.length, 'queued jobs:', queuedJobs.map(j => ({ id: j.id.substring(0, 8), type: j.type, template: j.input?.template })))
      for (const job of queuedJobs) {
        try {
          await startJob(job)
        } catch (error: any) {
          console.error('[worker] ❌ Error starting job:', job.id, error)
          await supabase
            .from('ai_jobs')
            .update({
              status: 'failed',
              error: error.message,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
        }
      }
    }

    // Fetch running jobs (need to poll Replicate)
    const { data: runningJobs, error: runningError } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('status', 'running')
      .not('prediction_id', 'is', null)
      .order('created_at', { ascending: true })

    if (runningError) {
      console.error('[worker] ❌ Error fetching running jobs:', runningError)
    }

    if (runningJobs && runningJobs.length > 0) {
      console.log('[worker] 🔍 Checking', runningJobs.length, 'running jobs')
      for (const job of runningJobs) {
        try {
          await checkJobStatus(job)
        } catch (error: any) {
          console.error('[worker] ❌ Error checking job:', job.id, error)
        }
      }
    }
  } catch (error) {
    console.error('[worker] ❌ Worker error:', error)
  }
}

// Helper to get product slug for organized folder structure
async function getProductSlug(productId: string): Promise<string> {
  const { data: product } = await supabase
    .from('products')
    .select('slug, name')
    .eq('id', productId)
    .single()

  // Use slug if available, otherwise create from name or use id
  if (product?.slug) return product.slug
  if (product?.name) {
    return product.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }
  return productId.substring(0, 8) // Fallback to short ID
}

// Helper to apply DTF optimization and upload optimized PNG
async function optimizeAndUploadDTF(
  sourceUrl: string,
  productSlug: string,
  options: DTFOptimizationOptions
): Promise<{ publicUrl: string; path: string }> {
  console.log('[worker] 🎨 Applying DTF optimization:', options)

  // Apply DTF optimization
  const optimizedBuffer = await optimizeForDTF(sourceUrl, options)

  // Upload optimized PNG to GCS
  const timestamp = Date.now()
  const styleSlug = options.printStyle === 'clean' ? '' : `-${options.printStyle}`
  const filename = `${productSlug}-dtf-${options.shirtColor}${styleSlug}-${timestamp}.png`
  const gcsPath = `graphics/${productSlug}/dtf-optimized/${filename}`

  console.log('[worker] 📤 Uploading DTF-optimized PNG to GCS:', gcsPath)

  // Upload buffer directly to GCS
  const { publicUrl, path } = await uploadImageFromBuffer(optimizedBuffer, gcsPath, 'image/png')

  console.log('[worker] ✅ DTF-optimized PNG uploaded:', publicUrl)

  return { publicUrl, path }
}

async function startJob(job: any) {
  console.log('[worker] 🔄 Starting job:', job.id, job.type)

  // Mark as running
  await supabase
    .from('ai_jobs')
    .update({
      status: 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)

  if (job.type === 'replicate_image' || job.type === 'replicate_image_v2') {
    const promptInput = job.input?.prompt
    if (!promptInput) {
      throw new Error('replicate_image job missing input.prompt')
    }

    const productSlug = await getProductSlug(job.product_id)
    const isMulti = job.input?.multiModel === true

    if (isMulti) {
      // Fan out to all admin models in parallel; user picks the best in the wizard.
      // gpt-image-2 is reserved for editing (slower / pricier).
      console.log('[worker] 🆕 NEW MULTI-MODEL FAN-OUT — job:', job.id)
      await updateJobProgress(job.id, '🎨 Generating with 4 models in parallel (Recraft V4, Grok Imagine, Imagen 4 Ultra, Wan 2.7 Pro)...', 1, 3)

      // Look up product category so DTF-aware prompt wrapping can kick in for garments.
      const { data: productRow } = await supabase
        .from('products')
        .select('category')
        .eq('id', job.product_id)
        .single()

      const results = await runImageFlowMultiGenerate({
        prompt: promptInput,
        category: productRow?.category ?? job.input?.category,
        shirtColor: job.input?.shirtColor,
        printStyle: job.input?.printStyle,
      })

      const succeeded = results.filter(r => r.status === 'succeeded' && r.url)
      console.log('[worker] 🎨 Multi-model results:', results.map(r => `${r.modelLabel}=${r.status}`).join(', '))

      if (succeeded.length === 0) {
        const errs = results.map(r => `${r.modelLabel}: ${r.error}`).join('; ')
        throw new Error(`All 4 models failed: ${errs}`)
      }

      await updateJobProgress(job.id, `📤 Uploading ${succeeded.length} variants to cloud storage...`, 2, 3)

      // Upload each successful variant + insert asset row
      for (const r of succeeded) {
        try {
          const ts = Date.now()
          const safeModel = r.modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
          const filename = `${productSlug}-${safeModel}-${ts}.png`
          const gcsPath = `graphics/${productSlug}/original/${filename}`
          const { publicUrl, path: storagePath } = await uploadImageFromUrl(r.url!, gcsPath)

          await supabase.from('product_assets').insert({
            product_id: job.product_id,
            kind: 'source',
            path: storagePath,
            url: publicUrl,
            width: 1024,
            height: 1024,
            asset_role: 'design',
            is_primary: false,
            display_order: 99,
            metadata: {
              model_id: r.modelId,
              model_name: r.modelLabel,
              provider: 'replicate',
              original_prompt: promptInput,
              multi_model: true,
              generated_at: new Date().toISOString(),
            },
          })
          console.log('[worker] ✅ Saved variant:', r.modelLabel, publicUrl)
        } catch (e: any) {
          console.error('[worker] ❌ Failed to save variant', r.modelLabel, e.message)
        }
      }

      await updateJobProgress(job.id, `✅ ${succeeded.length}/${results.length} variants ready — pick your favorite`, 3, 3)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          output: {
            multiModel: true,
            results: results.map(r => ({
              modelId: r.modelId,
              modelLabel: r.modelLabel,
              status: r.status,
              error: r.error ?? null,
            })),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log('[worker] ✅ Multi-model generation completed:', job.id, succeeded.length, '/', results.length)
    } else {
      // Single-model path (default for non-admin callers).
      await updateJobProgress(job.id, '🎨 Generating design with GPT Image 2...', 1, 3)

      const { url: temporaryUrl, modelId: usedModelId } = await runImageFlowGenerate({
        prompt: promptInput,
        modelId: job.input?.modelId,
      })

      const ts = Date.now()
      const filename = `${productSlug}-${ts}.png`
      const gcsPath = `graphics/${productSlug}/original/${filename}`

      await updateJobProgress(job.id, '📤 Uploading design to cloud storage...', 2, 3)
      const { publicUrl, path: storagePath } = await uploadImageFromUrl(temporaryUrl, gcsPath)

      const { error: assetError } = await supabase.from('product_assets').insert({
        product_id: job.product_id,
        kind: 'source',
        path: storagePath,
        url: publicUrl,
        width: 1024,
        height: 1024,
        asset_role: 'design',
        is_primary: false,
        display_order: 99,
        metadata: {
          model_id: usedModelId,
          provider: 'replicate',
          original_prompt: promptInput,
          generated_at: new Date().toISOString(),
        },
      })

      if (assetError) {
        console.error('[worker] ❌ Error saving design asset:', assetError)
        throw assetError
      }

      // Apply DTF optimization if DTF parameters are present
      if (job.input?.shirtColor || job.input?.printStyle) {
        try {
          const dtfOptions: DTFOptimizationOptions = {
            shirtColor: job.input.shirtColor || 'black',
            printStyle: job.input.printStyle || 'clean',
          }
          const { publicUrl: dtfUrl, path: dtfPath } = await optimizeAndUploadDTF(
            publicUrl,
            productSlug,
            dtfOptions
          )
          await supabase.from('product_assets').insert({
            product_id: job.product_id,
            kind: 'dtf',
            path: dtfPath,
            url: dtfUrl,
            width: 1024,
            height: 1024,
            asset_role: 'design',
            is_primary: false,
            display_order: 99,
            metadata: {
              model_id: usedModelId,
              shirt_color: dtfOptions.shirtColor,
              print_style: dtfOptions.printStyle,
              optimized_at: new Date().toISOString(),
            },
          })
          console.log('[worker] ✅ DTF-optimized asset saved:', dtfUrl)
        } catch (dtfError: any) {
          console.error('[worker] ❌ DTF optimization failed:', dtfError.message)
        }
      }

      await updateJobProgress(job.id, '✅ Design generated', 3, 3)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          output: { url: publicUrl, gcs_path: storagePath, model_id: usedModelId },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log('[worker] ✅ Design generation completed:', job.id, publicUrl)
    }
  } else if (job.type === 'replicate_rembg') {
    // Remove background from source image
    await updateJobProgress(job.id, '🔍 Locating selected design image...', 1, 3)
    // If user selected a specific asset, use that one; otherwise get the most recent source image
    let sourceAsset: { url: string } | null = null

    if (job.input?.selected_asset_id) {
      console.log('[worker] 🎯 Using user-selected asset for background removal:', job.input.selected_asset_id)

      const { data: selectedAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('id', job.input.selected_asset_id)
        .single()

      if (selectedAsset) {
        sourceAsset = selectedAsset
        console.log('[worker] ✅ Found selected asset:', selectedAsset.url)
      } else {
        console.warn('[worker] ⚠️ Selected asset not found, falling back to most recent source')
      }
    }

    // Fallback: get the most recent source image
    if (!sourceAsset) {
      const { data: fallbackAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'source')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      sourceAsset = fallbackAsset
    }

    if (!sourceAsset) {
      console.error('[worker] ❌ Source image not found for background removal!')
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: 'Source image asset not found',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return
    }

    try {
      // Remove background via Replicate 851-labs (returns a URL). Switched off
      // Remove.bg — that account has 0 credits so every call 402'd. Replicate is
      // already in the bill (~$0.001/call) and gives full-res RGBA output.
      await updateJobProgress(job.id, '✂️ Removing background with AI...', 2, 3)
      const rembgUrl = await removeBackgroundSync(sourceAsset.url)

      // Generate organized path for GCS
      const productSlug = await getProductSlug(job.product_id)
      const timestamp = Date.now()
      const filename = `${productSlug}-transparent-${timestamp}.png`
      const gcsPath = `graphics/${productSlug}/transparent/${filename}`

      console.log('[worker] 📤 Uploading no-background image to GCS:', gcsPath)
      await updateJobProgress(job.id, '📤 Uploading transparent PNG to cloud storage...', 3, 3)

      // Persist the Replicate output to Google Cloud Storage
      const { publicUrl, path } = await uploadImageFromUrl(rembgUrl, gcsPath)

      console.log('[worker] ✅ No-background image uploaded to GCS:', publicUrl)

      // Save to product_assets
      const { error: assetError } = await supabase
        .from('product_assets')
        .insert({
          product_id: job.product_id,
          kind: 'nobg',
          path: path,
          url: publicUrl,
          width: 1024,
          height: 1024,
          asset_role: 'auxiliary',
          is_primary: false,
          display_order: 99,
        })

      if (assetError) {
        console.error('[worker] ❌ Error saving asset:', assetError)
        throw assetError
      }

      // Update job as succeeded
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          output: { url: publicUrl, gcs_path: path },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log('[worker] ✅ Background removal completed:', job.id, publicUrl)
    } catch (error: any) {
      console.error('[worker] ❌ Background removal failed:', error.message)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: error.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
    }
  } else if (job.type === 'replicate_mockup' || job.type === 'replicate_mockup_v2') {
    // Check if source image job exists and its status
    const { data: sourceImageJob } = await supabase
      .from('ai_jobs')
      .select('status')
      .eq('product_id', job.product_id)
      .eq('type', 'replicate_image')
      .single()

    // If source image job exists but hasn't completed, wait for it
    if (sourceImageJob && sourceImageJob.status !== 'succeeded' && sourceImageJob.status !== 'failed') {
      // Reset to queued, will try again next cycle
      await supabase
        .from('ai_jobs')
        .update({
          status: 'queued',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      console.log('[worker] ⏳ Source image job still processing (status:', sourceImageJob.status, '), will retry...')
      return
    }

    // If no source image job exists, check if product has a source asset directly
    // This handles manually uploaded products or products from Imagination Station
    if (!sourceImageJob) {
      const { data: sourceAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'source')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!sourceAsset) {
        // Also check for products.images array as fallback
        const { data: product } = await supabase
          .from('products')
          .select('images')
          .eq('id', job.product_id)
          .single()

        if (!product?.images?.length) {
          console.error('[worker] ❌ No source image job and no source asset found for product')
          await supabase
            .from('ai_jobs')
            .update({
              status: 'failed',
              error: 'No source image available for mockup generation',
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
          return
        }
        console.log('[worker] 📸 No source image job, but product has images array - proceeding with mockup')
      } else {
        console.log('[worker] 📸 No source image job, but found source asset - proceeding with mockup')
      }
    }

    // Check if background removal job exists (optional)
    const { data: rembgJob } = await supabase
      .from('ai_jobs')
      .select('status')
      .eq('product_id', job.product_id)
      .eq('type', 'replicate_rembg')
      .single()

    // If background removal job exists and is still running, wait for it
    // BUT if it failed, proceed anyway (we'll use source image for mockup)
    if (rembgJob && (rembgJob.status === 'queued' || rembgJob.status === 'running')) {
      // Reset to queued, will try again next cycle
      await supabase
        .from('ai_jobs')
        .update({
          status: 'queued',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      console.log('[worker] ⏳ Background removal job is still processing (status:', rembgJob.status, '), will retry...')
      return
    }

    // If rembg job failed, log it but proceed with mockup using source image
    if (rembgJob && rembgJob.status === 'failed') {
      console.log('[worker] ⚠️ Background removal failed, will use source image for mockup')
    }

    // Priority order: Selected asset > DTF-optimized > no-background > source
    let garmentImageUrl: string | undefined

    // If user selected a specific asset, use that one
    if (job.input?.selected_asset_id) {
      console.log('[worker] 🎯 Using user-selected asset:', job.input.selected_asset_id)

      // Get the selected asset
      const { data: selectedAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('id', job.input.selected_asset_id)
        .single()

      if (selectedAsset) {
        garmentImageUrl = selectedAsset.url
        console.log('[worker] ✅ Using selected image for mockup:', garmentImageUrl)
      } else {
        console.error('[worker] ❌ Selected asset not found, falling back to default priority')
      }
    }

    // If no selected asset or not found, fall back to priority order
    if (!garmentImageUrl) {
      // Try DTF-optimized asset first (if DTF optimization was done)
      const { data: dtfAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'dtf')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (dtfAsset) {
        garmentImageUrl = dtfAsset.url
        console.log('[worker] 🎨 Using DTF-optimized image for mockup:', garmentImageUrl)
      }
    }

    if (!garmentImageUrl) {
      // Try to get the no-background asset (if background removal was done)
      const { data: nobgAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'nobg')
        .single()

      if (nobgAsset) {
        garmentImageUrl = nobgAsset.url
        console.log('[worker] 📸 Using no-background image for mockup:', garmentImageUrl)
      }
    }

    if (!garmentImageUrl) {
      // Get the most recent source image (for "Skip to Mockups" workflow)
      const { data: sourceAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'source')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (sourceAsset) {
        garmentImageUrl = sourceAsset.url
        console.log('[worker] 📸 Using source image for mockup (no optimization):', garmentImageUrl)
      }
    }

    // Final fallback: use products.images array (for manually created products)
    if (!garmentImageUrl) {
      const { data: product } = await supabase
        .from('products')
        .select('images')
        .eq('id', job.product_id)
        .single()

      if (product?.images?.length) {
        garmentImageUrl = product.images[0]
        console.log('[worker] 📸 Using product.images[0] for mockup:', garmentImageUrl)
      } else {
        console.error('[worker] ❌ No source image found anywhere!')
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: 'No source image available for mockup generation',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        return
      }
    }

    // If garmentImageUrl is a base64 data URL, upload to GCS first
    // (Gemini and other APIs require HTTP(S) URLs)
    if (garmentImageUrl && garmentImageUrl.startsWith('data:')) {
      console.log('[worker] 📤 Converting base64 image to GCS URL...')
      try {
        const productSlug = await getProductSlug(job.product_id)
        const uploadResult = await uploadImageFromBase64(
          garmentImageUrl,
          `products/${productSlug}/source-${Date.now()}.png`
        )
        console.log('[worker] ✅ Base64 converted to GCS URL:', uploadResult.publicUrl.substring(0, 80) + '...')
        garmentImageUrl = uploadResult.publicUrl

        // Also update the product's images array to use the permanent URL
        const { data: product } = await supabase
          .from('products')
          .select('images')
          .eq('id', job.product_id)
          .single()

        if (product?.images?.length && product.images[0].startsWith('data:')) {
          await supabase
            .from('products')
            .update({ images: [uploadResult.publicUrl, ...product.images.slice(1)] })
            .eq('id', job.product_id)
          console.log('[worker] ✅ Updated product.images with permanent GCS URL')
        }
      } catch (uploadError: any) {
        console.error('[worker] ❌ Failed to upload base64 image:', uploadError.message)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: `Failed to upload source image: ${uploadError.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        return
      }
    }

    // Store template info in job metadata for organized upload later
    await supabase
      .from('ai_jobs')
      .update({
        input: {
          ...job.input,
          garment_image_url: garmentImageUrl, // Store for reference
        },
      })
      .eq('id', job.id)

    // Get DTF settings from original image generation job
    const { data: imageJob } = await supabase
      .from('ai_jobs')
      .select('input')
      .eq('product_id', job.product_id)
      .eq('type', 'replicate_image')
      .single()

    const shirtColor = imageJob?.input?.shirtColor || job.input?.shirtColor || 'black'
    const productType = imageJob?.input?.productType || job.input?.productType || 'tshirt'
    const printPlacement = imageJob?.input?.printPlacement || job.input?.printPlacement || 'front-center'
    const productCategory = job.input?.product_type || 'shirts'

    // Get template type - determines which mockup style to generate
    const template = job.input?.template || 'flat_lay'
    const templateName = template === 'mr_imagine' ? 'Mr. Imagine mascot' :
                         template === 'flat_lay' ? 'professional flat lay' :
                         template === 'ghost_mannequin' ? 'ghost mannequin' : template

    await updateJobProgress(job.id, `🎭 Generating ${templateName} mockup with Replicate AI...`, 1, 3)
    console.log('[worker] 🎭 Starting Replicate mockup generation for template:', template)

    let mockupImageUrl: string
    let mockupModelId: string = 'google/nano-banana'

    try {
      // Template routing (see worker-helpers.runImageFlowMockup):
      //   - mr_imagine        → single call to google/nano-banana with [character, design]
      //   - flat_lay          → 2-step: google/imagen-4-fast (empty garment) → google/nano-banana (composite)
      //   - ghost_mannequin   → 2-step: google/imagen-4-fast (empty garment) → google/nano-banana (composite)
      // The 2-step path exists specifically to defeat Money's recurring
      // "all three mockups come back as Mr. Imagine" bug — gpt-image-2 used
      // to handle both halves and kept hallucinating the mascot.
      let characterImageUrl: string | undefined
      if (template === 'mr_imagine') {
        const siteUrl = process.env.FRONTEND_URL || process.env.APP_ORIGIN || 'https://imaginethisprinted.com'
        const side = printPlacement === 'back-only' ? 'back' : 'front'
        const colorKey = shirtColor === 'grey' ? 'gray' : shirtColor
        // Path mirrors the legacy MR_IMAGINE_MOCKUPS map in services/replicate.ts.
        const path = `/mr-imagine/mockups/mr-imagine-${productType}-${colorKey}-${side}.png`
        characterImageUrl = `${siteUrl}${path}`
      }

      console.log('[worker] 🎭 Generating', template, 'via image-flow (Imagen 4 Fast + Nano Banana for flat_lay/ghost_mannequin, Nano Banana for mr_imagine)')
      await updateJobProgress(job.id, `🎭 Generating ${templateName} mockup...`, 1, 3)

      const mockupResult = await runImageFlowMockup({
        template: template as 'flat_lay' | 'ghost_mannequin' | 'mr_imagine',
        designImageUrl: garmentImageUrl!,
        productType: productType as 'tshirt' | 'hoodie' | 'tank',
        shirtColor: shirtColor as 'black' | 'white' | 'gray' | 'grey',
        characterImageUrl,
        printPlacement: printPlacement as any,
      })

      mockupImageUrl = mockupResult.url
      mockupModelId = mockupResult.modelId
      console.log('[worker] ✅', template, 'generated via', mockupResult.modelId, ':', mockupImageUrl.substring(0, 80) + '...')
    } catch (mockupError: any) {
      console.error('[worker] ❌ Mockup generation failed:', mockupError.message)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: mockupError.message || 'Mockup generation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return
    }

    console.log('[worker] ✅ Replicate mockup generated successfully')
    await updateJobProgress(job.id, `📤 Uploading ${templateName} mockup to cloud storage...`, 2, 3)

    // Upload the mockup image to GCS (from Replicate URL)
    const productSlug = await getProductSlug(job.product_id)
    const timestamp = Date.now()
    const filename = `${productSlug}-${template}-${timestamp}.png`
    const gcsPath = `mockups/${productSlug}/${template}/${filename}`

    console.log('[worker] 📤 Uploading mockup to GCS:', gcsPath)

    const { publicUrl, path } = await uploadImageFromUrl(mockupImageUrl, gcsPath)

    console.log('[worker] ✅ Mockup uploaded to GCS:', publicUrl)

    // Determine asset_role and display_order based on template
    // Ghost mannequin is PRIMARY (display first), then flat_lay, mr_imagine
    // Order: ghost_mannequin(1) PRIMARY -> flat_lay(2) -> mr_imagine(3)
    const assetRole = template === 'flat_lay' ? 'mockup_flat_lay' :
                      template === 'mr_imagine' ? 'mockup_mr_imagine' :
                      template === 'ghost_mannequin' ? 'mockup_ghost_mannequin' :
                      'mockup_flat_lay'
    const displayOrder = template === 'ghost_mannequin' ? 1 :
                         template === 'flat_lay' ? 2 :
                         template === 'mr_imagine' ? 3 :
                         2
    const isPrimary = template === 'ghost_mannequin' // Ghost mannequin is the primary/main product image

    // If this is the primary image (ghost mannequin), unset any existing primary images first
    if (isPrimary) {
      console.log('[worker] 🌟 Ghost mannequin mockup will be set as PRIMARY image')
      await supabase
        .from('product_assets')
        .update({ is_primary: false })
        .eq('product_id', job.product_id)
        .eq('is_primary', true)
    }

    // One asset per mockup role, ever — replace any prior asset for this role
    // (kills the "duplicate Mr. Imagine mockups" accumulation when mockups re-run).
    await supabase
      .from('product_assets')
      .delete()
      .eq('product_id', job.product_id)
      .eq('asset_role', assetRole)

    // Save to product_assets — record the model that actually produced the
    // final image (mockupResult.modelId), not a hardcoded value. The
    // 2-step pipeline returns the composite model (google/nano-banana) for
    // flat_lay/ghost_mannequin; mr_imagine also returns google/nano-banana.
    const { error: assetError } = await supabase
      .from('product_assets')
      .insert({
        product_id: job.product_id,
        kind: 'mockup',
        path: path,
        url: publicUrl,
        width: 1024,
        height: 1024,
        asset_role: assetRole,
        is_primary: isPrimary,
        display_order: displayOrder,
        metadata: {
          template: template,
          generated_with: 'image-flow',
          model_id: mockupModelId,
          generated_at: new Date().toISOString(),
        },
      })

    if (assetError) {
      console.error('[worker] ❌ Error saving mockup asset:', assetError)
      throw assetError
    }

    // Update job as succeeded
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: { url: publicUrl, gcs_path: path },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log('[worker] ✅ Mockup job completed:', job.id, publicUrl)
  } else if (job.type === 'ghost_mannequin') {
    // Generate ghost mannequin mockup using ITP Enhance Engine
    await updateJobProgress(job.id, '👻 Starting ghost mannequin mockup generation...', 1, 4)
    console.log('[worker] 👻 Starting ghost mannequin generation for product:', job.product_id)

    // Check if product type supports ghost mannequin
    const productType = job.input?.productType || 'tshirt'
    const productCategory = job.input?.product_type || 'shirts'

    if (!GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES.includes(productType) &&
        !GHOST_MANNEQUIN_SUPPORTED_CATEGORIES.includes(productCategory)) {
      console.log('[worker] ⏭️ Skipping ghost mannequin - unsupported product type:', productType, productCategory)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'skipped',
          error: `Ghost mannequin not supported for product type: ${productType}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return
    }

    // Get the design image (same priority as regular mockups)
    let designImageUrl: string | undefined

    // If user selected a specific asset, use that one
    if (job.input?.selected_asset_id) {
      const { data: selectedAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('id', job.input.selected_asset_id)
        .single()

      if (selectedAsset) {
        designImageUrl = selectedAsset.url
        console.log('[worker] 👻 Using selected image for ghost mannequin:', designImageUrl)
      }
    }

    // Fallback priority: DTF > nobg > source
    if (!designImageUrl) {
      const { data: dtfAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'dtf')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (dtfAsset) {
        designImageUrl = dtfAsset.url
        console.log('[worker] 👻 Using DTF image for ghost mannequin:', designImageUrl)
      }
    }

    if (!designImageUrl) {
      const { data: nobgAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'nobg')
        .single()

      if (nobgAsset) {
        designImageUrl = nobgAsset.url
        console.log('[worker] 👻 Using no-background image for ghost mannequin:', designImageUrl)
      }
    }

    if (!designImageUrl) {
      const { data: sourceAsset } = await supabase
        .from('product_assets')
        .select('url')
        .eq('product_id', job.product_id)
        .eq('kind', 'source')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!sourceAsset) {
        console.error('[worker] ❌ No source image found for ghost mannequin!')
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: 'Source image asset not found',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        return
      }

      designImageUrl = sourceAsset.url
      console.log('[worker] 👻 Using source image for ghost mannequin:', designImageUrl)
    }

    // Generate ghost mannequin via image-flow (gpt-image-2)
    const shirtColor = job.input?.shirtColor || 'black'
    await updateJobProgress(job.id, '🎨 Rendering invisible mannequin effect with GPT Image 2...', 2, 4)

    try {
      const result = await runImageFlowMockup({
        template: 'ghost_mannequin',
        designImageUrl: designImageUrl!, // Safe: we would have returned early if not set
        productType: productType as 'tshirt' | 'hoodie' | 'tank',
        shirtColor: shirtColor as 'black' | 'white' | 'gray',
      })

      if (!result.url) {
        throw new Error('Ghost mannequin generation returned no URL')
      }

      // Upload to GCS
      await updateJobProgress(job.id, '📤 Uploading ghost mannequin mockup to cloud storage...', 3, 4)
      const productSlug = await getProductSlug(job.product_id)
      const timestamp = Date.now()
      const filename = `${productSlug}-ghost-mannequin-${timestamp}.png`
      const gcsPath = `mockups/${productSlug}/ghost-mannequin/${filename}`

      console.log('[worker] 📤 Uploading ghost mannequin to GCS:', gcsPath)

      const { publicUrl, path } = await uploadImageFromUrl(result.url, gcsPath)

      console.log('[worker] ✅ Ghost mannequin uploaded to GCS:', publicUrl)

      // Save to product_assets with display_order 3 (between flat_lay:2 and mr_imagine:4)
      const { error: assetError } = await supabase
        .from('product_assets')
        .insert({
          product_id: job.product_id,
          kind: 'mockup',
          path: path,
          url: publicUrl,
          width: 1024,
          height: 1024,
          asset_role: 'mockup_ghost_mannequin',
          is_primary: false,
          display_order: 3,
          metadata: {
            template: 'ghost_mannequin',
            generated_with: 'itp-enhance',
            generated_at: new Date().toISOString(),
            productType: productType,
            shirtColor: shirtColor,
          },
        })

      if (assetError) {
        console.error('[worker] ❌ Error saving ghost mannequin asset:', assetError)
        throw assetError
      }

      // Update job as succeeded
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          output: { url: publicUrl, gcs_path: path },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log('[worker] 👻 Ghost mannequin job completed:', job.id, publicUrl)
    } catch (error: any) {
      console.error('[worker] ❌ Ghost mannequin generation failed:', error.message)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: error.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
    }
  } else if (job.type === 'replicate_upscale') {
    // Upscale the most recent source or nobg image
    const { data: assets } = await supabase
      .from('product_assets')
      .select('url, kind')
      .eq('product_id', job.product_id)
      .in('kind', ['source', 'nobg'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (!assets || assets.length === 0) {
      console.error('[worker] ❌ No source or nobg image found for upscaling!')
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: 'No source or nobg image found for upscaling',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return
    }

    const imageToUpscale = assets[0].url
    console.log('[worker] 📈 Upscaling image:', imageToUpscale)

    const prediction = await upscaleImage(imageToUpscale)

    // Update job with prediction ID
    await supabase
      .from('ai_jobs')
      .update({
        prediction_id: prediction.id,
        output: { prediction_id: prediction.id },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log('[worker] ✅ Image upscale started:', prediction.id)
  } else if (job.type === '3d_model_concept') {
    // Generate 3D figurine concept image using NanoBanana
    await process3DModelConcept(job)
  } else if (job.type === '3d_model_angles') {
    // Generate 4 angle views for 3D model
    await process3DModelAngles(job)
  } else if (job.type === '3d_model_trellis') {
    // Legacy: TRELLIS (kept for in-flight jobs from before the Tripo3D switch)
    await process3DModelTrellis(job)
  } else if (job.type === '3d_model_tripo' || job.type === '3d_model_tripo_v2') {
    // Tripo3D v2.5 — size-tier driven, image-to-3D in one shot
    await process3DModelTripo(job)
  }
}

// ITC costs for 3D model generation (with fallbacks)
const ITC_3D_COSTS = {
  concept: 20,
  angles: 30,
  convert: 50
}

/**
 * Deduct ITC from user's wallet
 */
async function deductItc(userId: string, amount: number, description: string): Promise<boolean> {
  try {
    // Get current balance
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (fetchError || !wallet || wallet.itc_balance < amount) {
      console.error('[worker] ❌ Insufficient ITC balance for', description)
      return false
    }

    // Deduct ITC
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: wallet.itc_balance - amount,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[worker] ❌ Failed to deduct ITC:', updateError)
      return false
    }

    // Log transaction — live itc_transactions schema is
    // (user_id, type, amount, reference, balance_after, metadata, created_at).
    // The old insert wrote description/reference_type (nonexistent cols) with
    // the error swallowed, so every 3D-model charge silently skipped the ledger.
    const { error: ledgerError } = await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'debit',
      amount: -amount,
      balance_after: wallet.itc_balance - amount,
      reference: '3d_model',
      metadata: { source: '3d_model', description: `3D Model: ${description}`, status: 'completed' }
    })
    if (ledgerError) console.error('[worker] ❌ ITC deduct ledger insert failed:', ledgerError.message)

    console.log('[worker] 💰 Deducted', amount, 'ITC for', description)
    return true
  } catch (error: any) {
    console.error('[worker] ❌ ITC deduction error:', error.message)
    return false
  }
}

/**
 * Refund ITC to user's wallet on failure
 */
async function refundItc(userId: string, amount: number, description: string): Promise<void> {
  try {
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (!wallet) return

    await supabase
      .from('user_wallets')
      .update({
        itc_balance: wallet.itc_balance + amount,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)

    const { error: refundLedgerError } = await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'credit',
      amount: amount,
      balance_after: wallet.itc_balance + amount,
      reference: '3d_model_refund',
      metadata: { source: '3d_model', description: `Refund: ${description}`, status: 'refund' }
    })
    if (refundLedgerError) console.error('[worker] ❌ ITC refund ledger insert failed:', refundLedgerError.message)

    console.log('[worker] 💸 Refunded', amount, 'ITC for', description)
  } catch (error: any) {
    console.error('[worker] ❌ ITC refund error:', error.message)
  }
}

/**
 * Process 3D model concept generation job
 *
 * Uses openai/gpt-image-2 on Replicate for both the fresh text-to-image path
 * and the remix image-to-image path (when input.source_image_url is present).
 *
 * gpt-image-2 input schema:
 *   prompt           string
 *   quality          'low' | 'medium' | 'high' | 'auto'
 *   aspect_ratio     '1:1' | ...
 *   output_format    'png' | 'webp' | 'jpeg'
 *   background       'auto' | 'opaque'
 *   input_images?    string[]   — present for remix/i2i path
 *   number_of_images number     — we always request 1
 *
 * Output is an array of image URLs (same shape the existing extraction handles).
 */
async function process3DModelConcept(job: any) {
  const { model_id, user_id, prompt, style, source_image_url } = job.input
  const isRemix = !!source_image_url
  console.log('[worker] 🎨 Starting 3D concept generation for model:', model_id, isRemix ? '(remix)' : '(fresh)')

  try {
    // Deduct ITC
    const deducted = await deductItc(user_id, ITC_3D_COSTS.concept, isRemix ? 'Concept remix' : 'Concept generation')
    if (!deducted) {
      throw new Error('Insufficient ITC balance')
    }

    // Update model status
    await supabase
      .from('user_3d_models')
      .update({ status: 'generating_concept', updated_at: new Date().toISOString() })
      .eq('id', model_id)

    await updateJobProgress(job.id, `🎨 ${isRemix ? 'Remixing' : 'Generating'} 3D figurine concept with gpt-image-2...`, 1, 3)

    // Check if this is a toy-creator job so we can apply toy-optimized prompt language
    const { data: modelRow } = await supabase
      .from('user_3d_models')
      .select('metadata')
      .eq('id', model_id)
      .single()
    const toyMode = (modelRow?.metadata as any)?.source === 'toy_creator'
    const colorMode: 'grey' | 'color4' = (modelRow?.metadata as any)?.color_mode === 'color4' ? 'color4' : 'grey'

    // Build the prompt sent to gpt-image-2.
    // Remix path: use a preservation-framed instruction so the model edits the
    //   source image rather than generating from scratch.  Toy/color4 safety
    //   clauses are appended identically on both paths.
    // Fresh path: use the full t2i buildConceptPrompt framing.
    let finalPrompt: string
    if (isRemix) {
      const clauses: string[] = [
        `Edit the provided character concept image. Requested change: ${prompt}. Keep everything else IDENTICAL to the original character — same overall creature, same pose, same style, same proportions`
      ]
      if (toyMode) clauses.push(TOY_MODE_CLAUSE)
      if (colorMode === 'color4') clauses.push(COLOR4_CLAUSE)
      finalPrompt = clauses.join('. ')
    } else {
      finalPrompt = buildConceptPrompt(prompt, style as Style3D, { toyMode, colorMode })
    }

    console.log('[worker] 📝 Concept prompt (toyMode=' + toyMode + ', colorMode=' + colorMode + ', remix=' + isRemix + '):', finalPrompt.substring(0, 120) + '...')

    // Build gpt-image-2 input — conditionally include input_images for remix
    const replicateInput: Record<string, any> = {
      prompt: finalPrompt,
      quality: 'high',
      aspect_ratio: '1:1',
      output_format: 'png',
      background: 'auto',
      number_of_images: 1,
    }
    if (isRemix) {
      replicateInput.input_images = [source_image_url]
    }

    console.log('[worker] 🚀 Creating gpt-image-2 prediction...')

    let prediction = await replicate.predictions.create({
      model: 'openai/gpt-image-2',
      input: replicateInput
    })

    console.log('[worker] ⏳ Prediction created:', prediction.id, 'status:', prediction.status)

    // Wait for the prediction to complete
    prediction = await replicate.wait(prediction)

    console.log('[worker] ✅ Prediction completed:', prediction.id, 'status:', prediction.status)
    console.log('[worker] 🔍 gpt-image-2 output:', JSON.stringify(prediction.output).substring(0, 500))

    if (prediction.status === 'failed') {
      throw new Error(`gpt-image-2 prediction failed: ${prediction.error || 'Unknown error'}`)
    }

    if (prediction.status === 'canceled') {
      throw new Error('gpt-image-2 prediction was canceled')
    }

    // Extract URL from output.
    // gpt-image-2 returns an array of image URLs; fall back to string/object
    // shapes for forward-compatibility with any schema variation.
    let imageUrl: string
    const output = prediction.output

    if (Array.isArray(output) && output.length > 0) {
      imageUrl = output[0] as string
    } else if (typeof output === 'string') {
      imageUrl = output
    } else if (output && typeof output === 'object') {
      const obj = output as Record<string, any>
      imageUrl = obj.url || obj.image || obj.output
      if (!imageUrl) {
        const values = Object.values(obj)
        const urlValue = values.find(v => typeof v === 'string' && v.startsWith('http'))
        imageUrl = urlValue as string
      }
    } else {
      throw new Error(`Unexpected output format from gpt-image-2: ${JSON.stringify(output).substring(0, 200)}`)
    }

    if (!imageUrl) {
      throw new Error(`No image URL in gpt-image-2 output: ${JSON.stringify(output).substring(0, 200)}`)
    }

    console.log('[worker] 📸 Concept image generated:', imageUrl.substring(0, 80) + '...')

    await updateJobProgress(job.id, '🔒 Adding watermark to concept image...', 2, 3)

    // Add watermark to protect the image
    const watermarkedBuffer = await addWatermark(imageUrl)

    await updateJobProgress(job.id, '📤 Uploading concept image...', 3, 3)

    // Upload watermarked image to GCS
    const gcsPath = `3d-models/${model_id}/concept.png`
    const { publicUrl } = await uploadImageFromBuffer(watermarkedBuffer, gcsPath, 'image/png')

    console.log('[worker] ✅ Watermarked concept uploaded to GCS:', publicUrl)

    // Update model with concept image
    await supabase
      .from('user_3d_models')
      .update({
        concept_image_url: publicUrl,
        status: 'awaiting_approval',
        itc_charged: ITC_3D_COSTS.concept,
        updated_at: new Date().toISOString()
      })
      .eq('id', model_id)

    // Mark job as succeeded — record the generating model in metadata
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: { concept_url: publicUrl, model: 'openai/gpt-image-2' },
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)

    console.log('[worker] ✅ 3D concept job completed:', model_id, isRemix ? '(remix)' : '')
  } catch (error: any) {
    console.error('[worker] ❌ 3D concept generation failed:', error.message)

    // Refund ITC on failure
    await refundItc(user_id, ITC_3D_COSTS.concept, isRemix ? 'Concept remix failed' : 'Concept generation failed')

    // Update model status
    await supabase
      .from('user_3d_models')
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', model_id)

    // Mark job as failed
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)
  }
}

/**
 * Process 3D model angle views generation job
 */
async function process3DModelAngles(job: any) {
  const { model_id, user_id, style, concept_image_url } = job.input
  console.log('[worker] 🔄 Starting 3D angle generation for model:', model_id)

  try {
    // Deduct ITC
    const deducted = await deductItc(user_id, ITC_3D_COSTS.angles, 'Multi-view generation')
    if (!deducted) {
      throw new Error('Insufficient ITC balance')
    }

    // Get current model to access itc_charged
    const { data: model } = await supabase
      .from('user_3d_models')
      .select('itc_charged')
      .eq('id', model_id)
      .single()

    const angles = getAngleOrder() // ['front', 'back', 'left', 'right']
    const angleImages: Record<string, string> = {}

    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i]
      await updateJobProgress(job.id, `🎨 Generating ${angle} view (${i + 1}/${angles.length})...`, i + 1, angles.length + 1)

      // Build angle prompt
      const anglePrompt = buildAnglePrompt(style as Style3D, angle as any)
      console.log(`[worker] 📝 ${angle} prompt:`, anglePrompt.substring(0, 80) + '...')

      // Generate with NanoBanana image-to-image using predictions API
      let prediction = await replicate.predictions.create({
        model: 'google/nano-banana',
        input: {
          prompt: anglePrompt,
          image_input: [concept_image_url],
          aspect_ratio: '1:1',
          output_format: 'png'
        }
      })

      console.log(`[worker] ⏳ ${angle} prediction created:`, prediction.id)

      // Wait for completion
      prediction = await replicate.wait(prediction)

      console.log(`[worker] ✅ ${angle} prediction completed:`, prediction.status)

      if (prediction.status === 'failed') {
        throw new Error(`${angle} view generation failed: ${prediction.error || 'Unknown error'}`)
      }

      // Extract URL from output
      let imageUrl: string
      const output = prediction.output

      if (typeof output === 'string') {
        imageUrl = output
      } else if (Array.isArray(output) && output.length > 0) {
        imageUrl = output[0] as string
      } else if (output && typeof output === 'object') {
        const obj = output as Record<string, any>
        imageUrl = obj.url || obj.image || obj.output
        if (!imageUrl) {
          const values = Object.values(obj)
          const urlValue = values.find(v => typeof v === 'string' && v.startsWith('http'))
          imageUrl = urlValue as string
        }
      } else {
        throw new Error(`Unexpected output format for ${angle} view: ${JSON.stringify(output).substring(0, 100)}`)
      }

      if (!imageUrl) {
        throw new Error(`No image URL for ${angle} view: ${JSON.stringify(output).substring(0, 100)}`)
      }

      // Add watermark to protect the image
      const watermarkedBuffer = await addWatermark(imageUrl)

      // Upload watermarked image to GCS
      const gcsPath = `3d-models/${model_id}/${angle}.png`
      const { publicUrl } = await uploadImageFromBuffer(watermarkedBuffer, gcsPath, 'image/png')

      angleImages[angle] = publicUrl
      console.log(`[worker] ✅ ${angle} view (watermarked) uploaded:`, publicUrl.substring(0, 60) + '...')
    }

    await updateJobProgress(job.id, '✅ All angle views generated', angles.length + 1, angles.length + 1)

    // Update model with angle images
    await supabase
      .from('user_3d_models')
      .update({
        angle_images: angleImages,
        itc_charged: (model?.itc_charged || 0) + ITC_3D_COSTS.angles,
        updated_at: new Date().toISOString()
      })
      .eq('id', model_id)

    // Mark job as succeeded
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: { angle_images: angleImages },
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)

    console.log('[worker] ✅ 3D angles job completed:', model_id)
  } catch (error: any) {
    console.error('[worker] ❌ 3D angle generation failed:', error.message)

    // Refund ITC on failure
    await refundItc(user_id, ITC_3D_COSTS.angles, 'Angle generation failed')

    // Update model status
    await supabase
      .from('user_3d_models')
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', model_id)

    // Mark job as failed
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)
  }
}

/**
 * Process 3D model TRELLIS conversion job
 */
async function process3DModelTrellis(job: any) {
  const { model_id, user_id, angle_images } = job.input
  console.log('[worker] 🎲 Starting TRELLIS 3D conversion for model:', model_id)

  try {
    // Deduct ITC
    const deducted = await deductItc(user_id, ITC_3D_COSTS.convert, '3D conversion')
    if (!deducted) {
      throw new Error('Insufficient ITC balance')
    }

    // Get current model to access itc_charged
    const { data: model } = await supabase
      .from('user_3d_models')
      .select('itc_charged')
      .eq('id', model_id)
      .single()

    await updateJobProgress(job.id, '🎲 Converting images to 3D model with TRELLIS...', 1, 3)

    // Prepare images for TRELLIS (order: front, back, left, right)
    const images = [
      angle_images.front,
      angle_images.back,
      angle_images.left,
      angle_images.right
    ]

    // Call TRELLIS for multi-view 3D generation
    const { glbUrl, processingTime } = await generate3DModel({
      images,
      meshFormat: 'glb',
      textureResolution: 1024 // TRELLIS supports 512-2048
    })

    console.log('[worker] ✅ TRELLIS GLB generated in', processingTime.toFixed(2), 'seconds')

    await updateJobProgress(job.id, '📤 Uploading GLB and converting to STL...', 2, 3)

    // Upload GLB to GCS
    const glbPath = `3d-models/${model_id}/model.glb`
    const { publicUrl: glbPublicUrl } = await uploadImageFromUrl(glbUrl, glbPath)

    console.log('[worker] ✅ GLB uploaded:', glbPublicUrl.substring(0, 60) + '...')

    // Convert GLB to STL. Legacy TRELLIS path doesn't carry a size tier; default
    // to 100mm (matches the "small" tier on the modern Tripo flow) and apply the
    // same Z-up + ground-on-buildplate transforms.
    await updateJobProgress(job.id, '🔧 Converting GLB to STL for 3D printing...', 3, 3)

    const { stlBuffer, triangleCount } = await convertGlbToStl(glbPublicUrl, {
      targetHeightMm: 100,
      yUpToZUp: true,
      centerAndGround: true,
    })

    console.log('[worker] ✅ STL converted:', triangleCount, 'triangles')

    // Upload STL to GCS
    const stlPath = `3d-models/${model_id}/model.stl`
    const { publicUrl: stlPublicUrl } = await uploadImageFromBuffer(stlBuffer, stlPath, 'model/stl')

    console.log('[worker] ✅ STL uploaded:', stlPublicUrl.substring(0, 60) + '...')

    // Update model with 3D files
    await supabase
      .from('user_3d_models')
      .update({
        glb_url: glbPublicUrl,
        stl_url: stlPublicUrl,
        status: 'ready',
        itc_charged: (model?.itc_charged || 0) + ITC_3D_COSTS.convert,
        updated_at: new Date().toISOString()
      })
      .eq('id', model_id)

    // Mark job as succeeded
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: {
          glb_url: glbPublicUrl,
          stl_url: stlPublicUrl,
          processing_time: processingTime,
          triangle_count: triangleCount
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)

    console.log('[worker] ✅ 3D TRELLIS job completed:', model_id)
  } catch (error: any) {
    console.error('[worker] ❌ TRELLIS conversion failed:', error.message)

    // Refund ITC on failure
    await refundItc(user_id, ITC_3D_COSTS.convert, '3D conversion failed')

    // Update model status
    await supabase
      .from('user_3d_models')
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', model_id)

    // Mark job as failed
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)
  }
}

/**
 * Tripo3D v2.5 — single-image to 3D, with size-tier driven quality.
 * Replaces the legacy concept→angles→TRELLIS pipeline. Faster + cleaner meshes.
 */
async function process3DModelTripo(job: any) {
  const { model_id, user_id, source_image_url, size_tier } = job.input as {
    model_id: string
    user_id: string
    source_image_url: string
    size_tier: PrintSizeTier
  }

  const tier = SIZE_TIERS[size_tier] || SIZE_TIERS.small
  console.log('[worker] 🎲 Tripo3D job —', tier.label, 'tier — model:', model_id)

  try {
    const deducted = await deductItc(user_id, tier.itcCost, `3D ${tier.label} conversion`)
    if (!deducted) throw new Error('Insufficient ITC balance')

    const { data: model } = await supabase
      .from('user_3d_models')
      .select('itc_charged')
      .eq('id', model_id)
      .single()

    await updateJobProgress(job.id, `🎲 Tripo3D ${tier.label} — generating mesh (~${tier.approxSeconds}s)...`, 1, 4)

    // Generate via Tripo3D
    const { glbUrl: tripoGlbUrl, processingTimeSec, modelMetadata, pbrUrl, rendererPreviewUrl } = await generateTripo3D({
      imageUrl: source_image_url,
      tier: size_tier,
      orientation: 'align_image',
    })

    console.log('[worker] ✅ Tripo3D mesh ready in', processingTimeSec.toFixed(1) + 's')

    // Upload GLB to GCS for permanent hosting
    await updateJobProgress(job.id, '📤 Uploading GLB to cloud storage...', 2, 4)
    const glbPath = `3d-models/${model_id}/model.glb`
    const { publicUrl: glbPublicUrl } = await uploadImageFromUrl(tripoGlbUrl, glbPath)

    // Convert to STL (print-ready). Pass tier height + Bambu-friendly options
    // so the STL imports at the right size, oriented Z-up, sitting on the build plate.
    await updateJobProgress(job.id, '🔧 Converting to STL for 3D printing...', 3, 4)
    const { stlBuffer, triangleCount } = await convertGlbToStl(glbPublicUrl, {
      targetHeightMm: tier.printHeightMm,
      yUpToZUp: true,
      centerAndGround: true,
    })
    const stlPath = `3d-models/${model_id}/model.stl`
    const { publicUrl: stlPublicUrl } = await uploadImageFromBuffer(stlBuffer, stlPath, 'model/stl')

    console.log('[worker] ✅ STL ready —', triangleCount, 'triangles')

    await updateJobProgress(job.id, '✅ Print-ready mesh complete', 4, 4)

    // Update model row with full result + print metadata.
    // Try the rich update first; fall back to a minimal one if optional columns are missing.
    const updatedAt = new Date().toISOString()
    const richUpdate = await supabase
      .from('user_3d_models')
      .update({
        glb_url: glbPublicUrl,
        stl_url: stlPublicUrl,
        status: 'ready',
        size_tier,
        print_height_mm: tier.printHeightMm,
        print_price_usd: tier.printPriceUsd,
        triangle_count: triangleCount,
        itc_charged: (model?.itc_charged || 0) + tier.itcCost,
        metadata: {
          provider: modelMetadata.provider,
          face_limit: modelMetadata.faceLimit,
          texture: modelMetadata.texture,
          quad: modelMetadata.quad,
          auto_sized: modelMetadata.autoSized,
          pbr_url: pbrUrl,
          preview_url: rendererPreviewUrl,
          processing_time_sec: processingTimeSec,
        },
        updated_at: updatedAt,
      })
      .eq('id', model_id)
    if (richUpdate.error) {
      console.warn('[worker] tier columns missing on row — minimal update:', richUpdate.error.message)
      await supabase
        .from('user_3d_models')
        .update({
          glb_url: glbPublicUrl,
          stl_url: stlPublicUrl,
          status: 'ready',
          itc_charged: (model?.itc_charged || 0) + tier.itcCost,
          updated_at: updatedAt,
        })
        .eq('id', model_id)
    }

    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: {
          glb_url: glbPublicUrl,
          stl_url: stlPublicUrl,
          tier: size_tier,
          print_height_mm: tier.printHeightMm,
          triangle_count: triangleCount,
          processing_time_sec: processingTimeSec,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log('[worker] ✅ Tripo3D job completed:', model_id)
  } catch (error: any) {
    console.error('[worker] ❌ Tripo3D conversion failed:', error.message)
    await refundItc(user_id, tier.itcCost, `3D ${tier.label} conversion failed`)
    await supabase
      .from('user_3d_models')
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', model_id)
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
  }
}

async function checkJobStatus(job: any) {
  if (!job.prediction_id) return

  console.log('[worker] 🔍 Checking job:', job.id, 'prediction:', job.prediction_id)

  // Check if this is a multi-model job
  if (job.prediction_id.startsWith('multi-model-') && job.output?.isMultiModel) {
    console.log('[worker] 🎨 Multi-model job detected, checking async predictions')

    // Get async predictions that haven't been processed yet
    const asyncOutputs = job.output.outputs.filter((o: any) => !o.isSynchronous && o.predictionId)

    if (asyncOutputs.length === 0) {
      console.log('[worker] ✅ All multi-model outputs processed (synchronous only or all async complete)')

      // Mark job as succeeded if all outputs are done
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      return
    }

    // Check each async prediction
    let allCompleted = true
    const updatedOutputs = [...job.output.outputs]

    for (let i = 0; i < updatedOutputs.length; i++) {
      const modelOutput = updatedOutputs[i]

      if (!modelOutput.isSynchronous && modelOutput.predictionId && modelOutput.status !== 'succeeded') {
        try {
          console.log(`[worker] 🔍 Checking async prediction for ${modelOutput.modelName}:`, modelOutput.predictionId)

          const prediction = await getPrediction(modelOutput.predictionId)

          if (prediction.status === 'succeeded') {
            console.log(`[worker] ✅ Async prediction succeeded for ${modelOutput.modelName}`)

            // Get the output URL
            let replicateUrl: string
            if (Array.isArray(prediction.output)) {
              replicateUrl = prediction.output[0]
            } else {
              replicateUrl = prediction.output
            }

            if (!replicateUrl) {
              console.error(`[worker] ❌ No output URL for ${modelOutput.modelName}`)
              updatedOutputs[i].status = 'failed'
              updatedOutputs[i].error = 'No output URL in prediction'
              continue
            }

            console.log(`[worker] 📸 ${modelOutput.modelName} output URL:`, replicateUrl)

            // Upload to GCS
            const productSlug = await getProductSlug(job.product_id)
            const timestamp = Date.now()
            const modelSlug = modelOutput.modelName.toLowerCase().replace(/\s+/g, '-')
            const filename = `${productSlug}-${modelSlug}-${timestamp}.png`
            const gcsPath = `graphics/${productSlug}/original/${filename}`

            console.log(`[worker] 📤 Uploading ${modelOutput.modelName} image to GCS:`, gcsPath)

            const { publicUrl, path } = await uploadImageFromUrl(replicateUrl, gcsPath)

            console.log(`[worker] ✅ ${modelOutput.modelName} image uploaded to GCS:`, publicUrl)

            // Save to product_assets with model metadata
            const { error: assetError } = await supabase
              .from('product_assets')
              .insert({
                product_id: job.product_id,
                kind: 'source',
                path: path,
                url: publicUrl,
                width: (prediction as any).output_width || 1024,
                height: (prediction as any).output_height || 1024,
                asset_role: 'design',
                is_primary: false,
                display_order: 99,
                metadata: {
                  model_id: modelOutput.modelId,
                  model_name: modelOutput.modelName,
                  generated_at: new Date().toISOString(),
                },
              })

            if (assetError) {
              console.error(`[worker] ❌ Error saving ${modelOutput.modelName} asset:`, assetError)
              updatedOutputs[i].status = 'failed'
              updatedOutputs[i].error = assetError.message
            } else {
              console.log(`[worker] ✅ Saved asset for ${modelOutput.modelName}:`, publicUrl)
              updatedOutputs[i].status = 'succeeded'
              updatedOutputs[i].url = publicUrl
              updatedOutputs[i].gcs_path = path

              // Apply DTF optimization if DTF parameters are present
              if (job.input?.shirtColor || job.input?.printStyle) {
                try {
                  const dtfOptions: DTFOptimizationOptions = {
                    shirtColor: job.input.shirtColor || 'black',
                    printStyle: job.input.printStyle || 'clean',
                  }

                  const { publicUrl: dtfUrl, path: dtfPath } = await optimizeAndUploadDTF(
                    publicUrl,
                    productSlug,
                    dtfOptions
                  )

                  // Save DTF-optimized asset
                  await supabase
                    .from('product_assets')
                    .insert({
                      product_id: job.product_id,
                      kind: 'dtf',
                      path: dtfPath,
                      url: dtfUrl,
                      width: (prediction as any).output_width || 1024,
                      height: (prediction as any).output_height || 1024,
                      asset_role: 'design',
                      is_primary: false,
                      display_order: 99,
                      metadata: {
                        model_id: modelOutput.modelId,
                        model_name: modelOutput.modelName,
                        shirt_color: dtfOptions.shirtColor,
                        print_style: dtfOptions.printStyle,
                        optimized_at: new Date().toISOString(),
                      },
                    })

                  console.log(`[worker] ✅ DTF-optimized asset saved for ${modelOutput.modelName}:`, dtfUrl)
                  updatedOutputs[i].dtf_url = dtfUrl
                } catch (dtfError: any) {
                  console.error('[worker] ❌ DTF optimization failed:', dtfError.message)
                  // Don't fail the job, just log the error
                }
              }
            }

          } else if (prediction.status === 'failed') {
            console.error(`[worker] ❌ ${modelOutput.modelName} prediction failed:`, prediction.error)
            updatedOutputs[i].status = 'failed'
            updatedOutputs[i].error = prediction.error?.toString() || 'Prediction failed'

          } else if (prediction.status === 'canceled') {
            console.warn(`[worker] ⚠️ ${modelOutput.modelName} prediction canceled`)
            updatedOutputs[i].status = 'failed'
            updatedOutputs[i].error = 'Prediction was canceled'

          } else {
            console.log(`[worker] ⏳ ${modelOutput.modelName} still processing:`, prediction.status)
            allCompleted = false
          }

        } catch (error: any) {
          console.error(`[worker] ❌ Error checking ${modelOutput.modelName} prediction:`, error.message)
          allCompleted = false
        }
      }
    }

    // Update job with latest output statuses
    await supabase
      .from('ai_jobs')
      .update({
        output: {
          isMultiModel: true,
          outputs: updatedOutputs,
        },
        status: allCompleted ? 'succeeded' : 'running',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    if (allCompleted) {
      console.log('[worker] ✅ All multi-model outputs completed')
      // NOTE: Mockup jobs are now created by the /select-image endpoint when user selects their favorite image.
      // This ensures:
      // 1. User can choose which image they like before mockup generation
      // 2. Non-selected images are deleted
      // 3. Both flat_lay and mr_imagine mockups are created
      console.log('[worker] 🎨 Ready for user selection - mockups will be created via /select-image endpoint')
    }

    return
  }

  // Legacy single-prediction handling (for old jobs or non-multi-model jobs)
  console.log('[worker] 🔍 Checking single prediction:', job.prediction_id)

  const prediction = await getPrediction(job.prediction_id)

  if (prediction.status === 'succeeded') {
    console.log('[worker] ✅ Prediction succeeded:', job.prediction_id)

    // Get the output URL - Replicate returns array of URLs
    // For mockups, ITP Enhance Engine returns multiple variations - only use the first one
    let replicateUrl: string

    if (Array.isArray(prediction.output)) {
      console.log(`[worker] 📊 Prediction returned ${prediction.output.length} outputs`)
      replicateUrl = prediction.output[0]
    } else {
      replicateUrl = prediction.output
    }

    if (!replicateUrl) {
      throw new Error('No output URL in prediction')
    }

    console.log(`[worker] 📸 Using first output URL for ${job.type}:`, replicateUrl)

    // Determine asset kind based on job type
    const assetKind = job.type === 'replicate_image' ? 'source' :
      job.type === 'replicate_rembg' ? 'nobg' :
        job.type === 'replicate_upscale' ? 'upscaled' :
          'mockup'

    // Get product slug for organized folder structure
    const productSlug = await getProductSlug(job.product_id)
    const timestamp = Date.now()

    // Generate organized path based on asset type
    let gcsPath: string
    let filename: string

    if (assetKind === 'source') {
      // graphics/{slug}/original/
      filename = `${productSlug}-original-${timestamp}.png`
      gcsPath = `graphics/${productSlug}/original/${filename}`
    } else if (assetKind === 'nobg') {
      // graphics/{slug}/transparent/
      filename = `${productSlug}-transparent-${timestamp}.png`
      gcsPath = `graphics/${productSlug}/transparent/${filename}`
    } else if (assetKind === 'upscaled') {
      // upscaled/{slug}/
      filename = `${productSlug}-upscaled-${timestamp}.png`
      gcsPath = `upscaled/${productSlug}/${filename}`
    } else {
      // mockups/{slug}/{template}/
      const template = job.input?.template || 'default'
      filename = `${productSlug}-${template}-${timestamp}.png`
      gcsPath = `mockups/${productSlug}/${template}/${filename}`
    }

    console.log('[worker] 📤 Uploading image to GCS:', gcsPath)

    // Upload to Google Cloud Storage
    const { publicUrl, path } = await uploadImageFromUrl(replicateUrl, gcsPath)

    console.log('[worker] ✅ Image uploaded to GCS:', publicUrl)

    // Determine asset_role and display_order based on kind
    let legacyAssetRole: string
    let legacyDisplayOrder: number
    if (assetKind === 'source') {
      legacyAssetRole = 'design'
      legacyDisplayOrder = 99
    } else if (assetKind === 'mockup') {
      const template = job.input?.template || 'flat_lay'
      legacyAssetRole = template === 'mr_imagine' ? 'mockup_mr_imagine' : 'mockup_flat_lay'
      legacyDisplayOrder = template === 'mr_imagine' ? 3 : 2
    } else {
      legacyAssetRole = 'auxiliary'
      legacyDisplayOrder = 99
    }

    // One asset per mockup role, ever — replace any prior asset for this role
    if (assetKind === 'mockup') {
      await supabase
        .from('product_assets')
        .delete()
        .eq('product_id', job.product_id)
        .eq('asset_role', legacyAssetRole)
    }

    // Save to product_assets with GCS URL
    const { error: assetError } = await supabase
      .from('product_assets')
      .insert({
        product_id: job.product_id,
        kind: assetKind,
        path: path,
        url: publicUrl,
        width: (prediction as any).output_width || 1024,
        height: (prediction as any).output_height || 1024,
        asset_role: legacyAssetRole,
        is_primary: false,
        display_order: legacyDisplayOrder,
      })

    if (assetError) {
      console.error('[worker] ❌ Error saving asset:', assetError)
      throw assetError
    }

    // Update job as succeeded
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: { url: publicUrl, gcs_path: path, replicate_url: replicateUrl, prediction: prediction },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log('[worker] ✅ Job completed:', job.id, assetKind, publicUrl)

  } else if (prediction.status === 'failed') {
    console.error('[worker] ❌ Prediction failed:', job.prediction_id, prediction.error)

    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: prediction.error?.toString() || 'Prediction failed',
        output: { prediction },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

  } else if (prediction.status === 'canceled') {
    console.warn('[worker] ⚠️ Prediction canceled:', job.prediction_id)

    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error: 'Prediction was canceled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

  } else {
    // Still processing (starting, processing)
    console.log('[worker] ⏳ Prediction still processing:', prediction.status)
  }
}

// Cleanup interval: 1 hour
const CLEANUP_INTERVAL = 60 * 60 * 1000

// Delete incomplete orders older than 10 days
async function cleanupIncompleteOrders() {
  console.log('[worker] 🧹 Running cleanup for incomplete orders...')
  try {
    // Calculate date 10 days ago
    const tenDaysAgo = new Date()
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

    // Find and delete orders with pending payment status older than 10 days
    const { data: oldOrders, error: fetchError } = await supabase
      .from('orders')
      .select('id, order_number, created_at')
      .eq('payment_status', 'pending')
      .lt('created_at', tenDaysAgo.toISOString())

    if (fetchError) {
      console.error('[worker] Error fetching old orders:', fetchError)
      return
    }

    if (!oldOrders || oldOrders.length === 0) {
      console.log('[worker] No incomplete orders to clean up')
      return
    }

    console.log(`[worker] Found ${oldOrders.length} incomplete orders to delete`)

    // Delete the orders
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .in('id', oldOrders.map(o => o.id))

    if (deleteError) {
      console.error('[worker] Error deleting old orders:', deleteError)
      return
    }

    console.log(`[worker] ✅ Cleaned up ${oldOrders.length} incomplete orders older than 10 days`)

    // Log to audit
    await supabase.from('audit_logs').insert({
      action: 'cleanup_incomplete_orders',
      metadata: {
        deleted_count: oldOrders.length,
        order_numbers: oldOrders.map(o => o.order_number),
        cleanup_date: new Date().toISOString()
      }
    })
  } catch (error) {
    console.error('[worker] Error in cleanup:', error)
  }
}

// Delete expired design sessions (drafts) older than 14 days
async function cleanupExpiredDesignSessions() {
  console.log('[worker] 🧹 Running cleanup for expired design sessions...')
  try {
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const { data: expiredSessions, error: fetchError } = await supabase
      .from('design_sessions')
      .select('id')
      .lt('updated_at', fourteenDaysAgo.toISOString())

    if (fetchError) {
      console.error('[worker] Error fetching expired sessions:', fetchError)
      return
    }

    if (!expiredSessions || expiredSessions.length === 0) {
      console.log('[worker] No expired design sessions to clean up')
      return
    }

    const { error: deleteError } = await supabase
      .from('design_sessions')
      .delete()
      .in('id', expiredSessions.map(s => s.id))

    if (deleteError) {
      console.error('[worker] Error deleting expired sessions:', deleteError)
      return
    }

    console.log(`[worker] ✅ Cleaned up ${expiredSessions.length} expired design sessions`)
  } catch (error) {
    console.error('[worker] Error in session cleanup:', error)
  }
}

export function startWorker() {
  console.log('[worker] 🚀 Starting AI jobs worker')

  // AI job processing (every 5 seconds)
  setInterval(async () => {
    await processQueuedJobs()
  }, POLL_INTERVAL)

  // Cleanup tasks (every hour)
  setInterval(async () => {
    await cleanupIncompleteOrders()
    await cleanupExpiredDesignSessions()
  }, CLEANUP_INTERVAL)

  // Process immediately on start
  processQueuedJobs()

  // Run cleanup once on start (delayed by 1 minute to let server fully start)
  setTimeout(async () => {
    await cleanupIncompleteOrders()
    await cleanupExpiredDesignSessions()
  }, 60000)
}
