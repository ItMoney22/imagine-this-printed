import { supabase } from '../lib/supabase.js'
import { generateProductImage, generateMockup, removeBackground, upscaleImage, getPrediction } from '../services/replicate.js'
import { removeBackgroundWithRemoveBg } from '../services/removebg.js'
import { uploadImageFromUrl, uploadImageFromBase64, uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { optimizeForDTF, type DTFOptimizationOptions } from '../services/dtf-optimizer.js'
import { generateMockup as generateGeminiMockup } from '../services/vertex-ai-mockup.js'

const POLL_INTERVAL = 5000 // 5 seconds

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
      for (const modelOutput of result.outputs) {
        if (modelOutput.isSynchronous && modelOutput.url) {
          console.log(`[worker] 🚀 Processing synchronous result from ${modelOutput.modelName}`)

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
      const base64Image = await removeBackgroundWithRemoveBg(sourceAsset.url)

      // Generate organized path for GCS
      const productSlug = await getProductSlug(job.product_id)
      const timestamp = Date.now()
      const filename = `${productSlug}-transparent-${timestamp}.png`
      const gcsPath = `graphics/${productSlug}/transparent/${filename}`

      console.log('[worker] 📤 Uploading no-background image to GCS:', gcsPath)

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

    // Upload the mockup image to GCS
    const productSlug = await getProductSlug(job.product_id)
    const timestamp = Date.now()
    const template = job.input?.template || 'default'
    const filename = `${productSlug}-${template}-${timestamp}.png`
    const gcsPath = `mockups/${productSlug}/${template}/${filename}`

    console.log('[worker] 📤 Uploading mockup to GCS:', gcsPath)

    const { publicUrl, path } = await uploadImageFromBase64(
      `data:${geminiResult.mimeType};base64,${geminiResult.imageBase64}`,
      gcsPath
    )

    console.log('[worker] ✅ Mockup uploaded to GCS:', publicUrl)

    // Determine asset_role and display_order based on template
    const assetRole = template === 'flat_lay' ? 'mockup_flat_lay' :
                      template === 'mr_imagine' ? 'mockup_mr_imagine' :
                      'mockup_flat_lay'
    const displayOrder = template === 'flat_lay' ? 2 :
                         template === 'mr_imagine' ? 3 :
                         2

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
        is_primary: false,
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
    // For mockups, nano-banana returns multiple variations - only use the first one
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
