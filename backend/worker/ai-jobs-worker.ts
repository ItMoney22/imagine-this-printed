import { supabase } from '../lib/supabase.js'
import { generateProductImage, generateMockup, removeBackground, upscaleImage, getPrediction, generateGhostMannequin, GHOST_MANNEQUIN_SUPPORTED_CATEGORIES, GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES } from '../services/replicate.js'
import { removeBackgroundWithRemoveBg } from '../services/removebg.js'
import { uploadImageFromUrl, uploadImageFromBase64, uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { optimizeForDTF, type DTFOptimizationOptions } from '../services/dtf-optimizer.js'
import { generateMockup as generateGeminiMockup } from '../services/vertex-ai-mockup.js'
import { buildConceptPrompt, buildAnglePrompt, getAngleOrder, type Style3D } from '../services/nano-banana-3d.js'
import { generate3DModel } from '../services/trellis-client.js'
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

// Helper to auto-queue mockup job after image generation
async function autoQueueMockupJob(imageJob: any) {
  try {
    console.log('[worker] 🎭 Auto-queueing Mr. Imagine mockup job for product:', imageJob.product_id)

    // Get product category for mockup type
    const { data: product } = await supabase
      .from('products')
      .select('category')
      .eq('id', imageJob.product_id)
      .single()

    // Check if mockup job already exists for this product
    const { data: existingMockupJobs } = await supabase
      .from('ai_jobs')
      .select('id')
      .eq('product_id', imageJob.product_id)
      .eq('type', 'replicate_mockup')
      .limit(1)

    if (existingMockupJobs && existingMockupJobs.length > 0) {
      console.log('[worker] ⏭️ Mockup job already exists, skipping auto-queue')
      return
    }

    // Create mockup job with Mr. Imagine
    const mockupJob = {
      product_id: imageJob.product_id,
      type: 'replicate_mockup',
      status: 'queued',
      input: {
        template: 'flat_lay',
        product_type: product?.category || 'shirts',
        // Pass DTF settings from original image job
        productType: imageJob.input?.productType || 'tshirt',
        shirtColor: imageJob.input?.shirtColor || 'black',
        printPlacement: imageJob.input?.printPlacement || 'front-center',
      },
    }

    const { data: createdJob, error: jobError } = await supabase
      .from('ai_jobs')
      .insert(mockupJob)
      .select()
      .single()

    if (jobError) {
      console.error('[worker] ❌ Failed to auto-queue mockup job:', jobError)
    } else {
      console.log('[worker] ✅ Auto-queued Mr. Imagine mockup job:', createdJob.id)
    }
  } catch (error: any) {
    console.error('[worker] ❌ Error auto-queueing mockup job:', error.message)
  }
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

  if (job.type === 'replicate_image') {
    // Generate product image with multiple models
    await updateJobProgress(job.id, '🎨 Sending design to AI models (Flux Fast, Imagen 4, Lucid Origin)...', 1, 4)
    const result = await generateProductImage(job.input)

    // Check if this is a multi-model result
    if (result.isMultiModel && result.outputs) {
      console.log('[worker] 🎨 Multi-model generation result:', result.outputs.length, 'models')

      // Store the multi-model output metadata
      await supabase
        .from('ai_jobs')
        .update({
          prediction_id: result.id,
          output: {
            isMultiModel: true,
            outputs: result.outputs,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      // Process synchronous results immediately (Imagen 4)
      await updateJobProgress(job.id, '⚡ Processing AI model results...', 2, 4)
      for (const modelOutput of result.outputs) {
        if (modelOutput.isSynchronous && modelOutput.url) {
          console.log(`[worker] 🚀 Processing synchronous result from ${modelOutput.modelName}`)
          await updateJobProgress(job.id, `📥 Downloading image from ${modelOutput.modelName}...`, 2, 4)

          // Upload immediately to GCS
          const productSlug = await getProductSlug(job.product_id)
          const timestamp = Date.now()
          const modelSlug = modelOutput.modelName.toLowerCase().replace(/\s+/g, '-')
          const filename = `${productSlug}-${modelSlug}-${timestamp}.png`
          const gcsPath = `graphics/${productSlug}/original/${filename}`

          console.log('[worker] 📤 Uploading synchronous image to GCS:', gcsPath)

          // Upload to Google Cloud Storage
          const { publicUrl, path } = await uploadImageFromUrl(modelOutput.url, gcsPath)

          console.log('[worker] ✅ Synchronous image uploaded to GCS:', publicUrl)

          // Save to product_assets with model metadata
          const { error: assetError } = await supabase
            .from('product_assets')
            .insert({
              product_id: job.product_id,
              kind: 'source',
              path: path,
              url: publicUrl,
              width: 1024,
              height: 1024,
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
            console.error('[worker] ❌ Error saving synchronous asset:', assetError)
          } else {
            console.log(`[worker] ✅ Saved asset for ${modelOutput.modelName}:`, publicUrl)
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

              // Save DTF-optimized asset
              await supabase
                .from('product_assets')
                .insert({
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
                    model_id: modelOutput.modelId,
                    model_name: modelOutput.modelName,
                    shirt_color: dtfOptions.shirtColor,
                    print_style: dtfOptions.printStyle,
                    optimized_at: new Date().toISOString(),
                  },
                })

              console.log(`[worker] ✅ DTF-optimized asset saved for ${modelOutput.modelName}:`, dtfUrl)
            } catch (dtfError: any) {
              console.error('[worker] ❌ DTF optimization failed:', dtfError.message)
              // Don't fail the job, just log the error
            }
          }
        } else if (modelOutput.predictionId) {
          console.log(`[worker] ⏳ Async prediction created for ${modelOutput.modelName}:`, modelOutput.predictionId)
        }
      }

      // Check if all models completed (either succeeded or failed) - we don't want to hang if one fails
      const allSyncProcessed = result.outputs.every((o: any) => o.isSynchronous && (o.status === 'succeeded' || o.status === 'failed'))
      const successCount = result.outputs.filter((o: any) => o.status === 'succeeded').length

      if (allSyncProcessed && successCount > 0) {
        // At least one model succeeded - mark job as succeeded so flow can continue
        console.log('[worker] ✅ Multi-model generation processed (Success:', successCount, '/', result.outputs.length, ')')
        console.log('[worker] 🎨 User will now select from', successCount, 'images before mockup generation')

        await supabase
          .from('ai_jobs')
          .update({
            status: 'succeeded',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        // NOTE: Do NOT auto-queue mockup job here!
        // User must first select their preferred image from the 3 generated options.
        // The frontend will call /api/admin/products/ai/:id/select-image
        // which creates the mockup job with the selected asset.
      } else if (allSyncProcessed && successCount === 0) {
        // All failed
        console.error('[worker] ❌ All models failed synchronous generation')
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: 'All models failed to generate images',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      } else {
        console.log('[worker] ⏳ Multi-model generation in progress - waiting for async models or user selection')
      }
    } else {
      // Legacy single-model result (backward compatibility)
      await supabase
        .from('ai_jobs')
        .update({
          prediction_id: result.id,
          output: { prediction_id: result.id },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log('[worker] ✅ Image generation started:', result.id)
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
      // Remove background using Remove.bg (returns image directly)
      await updateJobProgress(job.id, '✂️ Removing background with AI (Remove.bg)...', 2, 3)
      const base64Image = await removeBackgroundWithRemoveBg(sourceAsset.url)

      // Generate organized path for GCS
      const productSlug = await getProductSlug(job.product_id)
      const timestamp = Date.now()
      const filename = `${productSlug}-transparent-${timestamp}.png`
      const gcsPath = `graphics/${productSlug}/transparent/${filename}`

      console.log('[worker] 📤 Uploading no-background image to GCS:', gcsPath)
      await updateJobProgress(job.id, '📤 Uploading transparent PNG to cloud storage...', 3, 3)

      // Upload to Google Cloud Storage
      const { publicUrl, path } = await uploadImageFromBase64(base64Image, gcsPath)

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
  } else if (job.type === 'replicate_mockup') {
    // Wait for source image to complete
    const { data: sourceImageJob } = await supabase
      .from('ai_jobs')
      .select('status')
      .eq('product_id', job.product_id)
      .eq('type', 'replicate_image')
      .single()

    if (!sourceImageJob || sourceImageJob.status !== 'succeeded') {
      // Reset to queued, will try again next cycle
      await supabase
        .from('ai_jobs')
        .update({
          status: 'queued',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      console.log('[worker] ⏳ Source image job not completed yet (status:', sourceImageJob?.status || 'not found', '), will retry...')
      return
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

      if (!sourceAsset) {
        console.error('[worker] ❌ Source image not found!')
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

      garmentImageUrl = sourceAsset.url
      console.log('[worker] 📸 Using source image for mockup (no optimization):', garmentImageUrl)
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

    const shirtColor = imageJob?.input?.shirtColor
    const productType = imageJob?.input?.productType
    const printPlacement = imageJob?.input?.printPlacement

    // Generate mockup with Gemini (synchronous - returns image directly)
    const template = job.input?.template || 'flat_lay'
    const templateName = template === 'mr_imagine' ? 'Mr. Imagine mascot' :
                         template === 'flat_lay' ? 'professional flat lay' : template
    await updateJobProgress(job.id, `🎭 Generating ${templateName} mockup with Gemini AI...`, 1, 3)
    console.log('[worker] 🎭 Starting Gemini mockup generation...')
    const geminiResult = await generateGeminiMockup({
      designImageUrl: garmentImageUrl!, // Safe: we would have returned early if not set
      template: job.input.template,
      productType: productType || 'tshirt',
      shirtColor: shirtColor || 'black',
      printPlacement: printPlacement || 'front-center',
    })

    if (!geminiResult.success || !geminiResult.imageBase64) {
      console.error('[worker] ❌ Gemini mockup generation failed:', geminiResult.error)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: geminiResult.error || 'Mockup generation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return
    }

    console.log('[worker] ✅ Gemini mockup generated successfully')
    await updateJobProgress(job.id, `📤 Uploading ${templateName} mockup to cloud storage...`, 2, 3)

    // Upload the mockup image to GCS
    const productSlug = await getProductSlug(job.product_id)
    const timestamp = Date.now()
    // Note: template already defined above
    const filename = `${productSlug}-${template}-${timestamp}.png`
    const gcsPath = `mockups/${productSlug}/${template}/${filename}`

    console.log('[worker] 📤 Uploading mockup to GCS:', gcsPath)

    const { publicUrl, path } = await uploadImageFromBase64(
      `data:${geminiResult.mimeType};base64,${geminiResult.imageBase64}`,
      gcsPath
    )

    console.log('[worker] ✅ Mockup uploaded to GCS:', publicUrl)

    // Determine asset_role and display_order based on template
    // Mr. Imagine is PRIMARY (display first), then flat_lay, ghost_mannequin
    // Order: mr_imagine(1) PRIMARY -> flat_lay(2) -> ghost_mannequin(3)
    const assetRole = template === 'flat_lay' ? 'mockup_flat_lay' :
                      template === 'mr_imagine' ? 'mockup_mr_imagine' :
                      'mockup_flat_lay'
    const displayOrder = template === 'mr_imagine' ? 1 :
                         template === 'flat_lay' ? 2 :
                         2
    const isPrimary = template === 'mr_imagine' // Mr. Imagine is the primary/main product image

    // If this is the primary image (Mr. Imagine), unset any existing primary images first
    if (isPrimary) {
      console.log('[worker] 🌟 Mr. Imagine mockup will be set as PRIMARY image')
      await supabase
        .from('product_assets')
        .update({ is_primary: false })
        .eq('product_id', job.product_id)
        .eq('is_primary', true)
    }

    // Save to product_assets
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
          generated_with: 'gemini',
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

    // Generate ghost mannequin with ITP Enhance Engine
    const shirtColor = job.input?.shirtColor || 'black'
    await updateJobProgress(job.id, '🎨 Rendering invisible mannequin effect with ITP Enhance Engine AI...', 2, 4)

    try {
      const result = await generateGhostMannequin({
        designImage: designImageUrl!, // Safe: we would have returned early if not set
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
    // Convert images to 3D model using TRELLIS
    await process3DModelTrellis(job)
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

    // Log transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      amount: -amount,
      balance_after: wallet.itc_balance - amount,
      type: 'debit',
      description: `3D Model: ${description}`,
      reference_type: '3d_model',
      created_at: new Date().toISOString()
    })

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

    await supabase.from('itc_transactions').insert({
      user_id: userId,
      amount: amount,
      balance_after: wallet.itc_balance + amount,
      type: 'credit',
      description: `Refund: ${description}`,
      reference_type: '3d_model_refund',
      created_at: new Date().toISOString()
    })

    console.log('[worker] 💸 Refunded', amount, 'ITC for', description)
  } catch (error: any) {
    console.error('[worker] ❌ ITC refund error:', error.message)
  }
}

/**
 * Process 3D model concept generation job
 */
async function process3DModelConcept(job: any) {
  const { model_id, user_id, prompt, style } = job.input
  console.log('[worker] 🎨 Starting 3D concept generation for model:', model_id)

  try {
    // Deduct ITC
    const deducted = await deductItc(user_id, ITC_3D_COSTS.concept, 'Concept generation')
    if (!deducted) {
      throw new Error('Insufficient ITC balance')
    }

    // Update model status
    await supabase
      .from('user_3d_models')
      .update({ status: 'generating_concept', updated_at: new Date().toISOString() })
      .eq('id', model_id)

    await updateJobProgress(job.id, '🎨 Generating 3D figurine concept with NanoBanana...', 1, 2)

    // Build prompt for NanoBanana
    const conceptPrompt = buildConceptPrompt(prompt, style as Style3D)
    console.log('[worker] 📝 Concept prompt:', conceptPrompt.substring(0, 100) + '...')

    // Generate with NanoBanana (google/nano-banana on Replicate)
    // Use predictions.create with wait to ensure we get the result
    console.log('[worker] 🚀 Creating NanoBanana prediction...')

    let prediction = await replicate.predictions.create({
      model: 'google/nano-banana',
      input: {
        prompt: conceptPrompt,
        aspect_ratio: '1:1',
        output_format: 'png'
      }
    })

    console.log('[worker] ⏳ Prediction created:', prediction.id, 'status:', prediction.status)

    // Wait for the prediction to complete
    prediction = await replicate.wait(prediction)

    console.log('[worker] ✅ Prediction completed:', prediction.id, 'status:', prediction.status)
    console.log('[worker] 🔍 NanoBanana output:', JSON.stringify(prediction.output).substring(0, 500))

    if (prediction.status === 'failed') {
      throw new Error(`NanoBanana prediction failed: ${prediction.error || 'Unknown error'}`)
    }

    if (prediction.status === 'canceled') {
      throw new Error('NanoBanana prediction was canceled')
    }

    // Extract URL from output
    let imageUrl: string
    const output = prediction.output

    if (typeof output === 'string') {
      imageUrl = output
    } else if (Array.isArray(output) && output.length > 0) {
      imageUrl = output[0] as string
    } else if (output && typeof output === 'object') {
      // Handle object response
      const obj = output as Record<string, any>
      imageUrl = obj.url || obj.image || obj.output
      if (!imageUrl) {
        const values = Object.values(obj)
        const urlValue = values.find(v => typeof v === 'string' && v.startsWith('http'))
        imageUrl = urlValue as string
      }
    } else {
      throw new Error(`Unexpected output format from NanoBanana: ${JSON.stringify(output).substring(0, 200)}`)
    }

    if (!imageUrl) {
      throw new Error(`No image URL in NanoBanana output: ${JSON.stringify(output).substring(0, 200)}`)
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

    // Mark job as succeeded
    await supabase
      .from('ai_jobs')
      .update({
        status: 'succeeded',
        output: { concept_url: publicUrl },
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)

    console.log('[worker] ✅ 3D concept job completed:', model_id)
  } catch (error: any) {
    console.error('[worker] ❌ 3D concept generation failed:', error.message)

    // Refund ITC on failure
    await refundItc(user_id, ITC_3D_COSTS.concept, 'Concept generation failed')

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

    // Convert GLB to STL
    await updateJobProgress(job.id, '🔧 Converting GLB to STL for 3D printing...', 3, 3)

    const { stlBuffer, triangleCount } = await convertGlbToStl(glbPublicUrl)

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

export function startWorker() {
  console.log('[worker] 🚀 Starting AI jobs worker')

  setInterval(async () => {
    await processQueuedJobs()
  }, POLL_INTERVAL)

  // Process immediately on start
  processQueuedJobs()
}
