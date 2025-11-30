import { supabase } from '../lib/supabase.js'
import { generateProductImage, generateMockup, removeBackground, upscaleImage, getPrediction } from '../services/replicate.js'
import { removeBackgroundWithRemoveBg } from '../services/removebg.js'
import { uploadImageFromUrl, uploadImageFromBase64 } from '../services/google-cloud-storage.js'

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
      console.log('[worker] 📋 Processing', queuedJobs.length, 'queued jobs')
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
        } else if (modelOutput.predictionId) {
          console.log(`[worker] ⏳ Async prediction created for ${modelOutput.modelName}:`, modelOutput.predictionId)
        }
      }

      console.log('[worker] ✅ Multi-model generation processed')
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
    // Remove background from source image - get the most recent source image
    const { data: sourceAsset } = await supabase
      .from('product_assets')
      .select('url')
      .eq('product_id', job.product_id)
      .eq('kind', 'source')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

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

    // Try to get the no-background asset first (if background removal was done)
    const { data: nobgAsset } = await supabase
      .from('product_assets')
      .select('url')
      .eq('product_id', job.product_id)
      .eq('kind', 'nobg')
      .single()

    // If no nobg asset, fall back to source image (for "Skip to Mockups" workflow)
    let garmentImageUrl: string
    if (nobgAsset) {
      garmentImageUrl = nobgAsset.url
      console.log('[worker] 📸 Using no-background image for mockup:', garmentImageUrl)
    } else {
      // Get the most recent source image
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
      console.log('[worker] 📸 Using source image for mockup (background removal skipped):', garmentImageUrl)
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

    // Generate mockup with the selected image
    const prediction = await generateMockup({
      garment_image: garmentImageUrl,
      template: job.input.template,
      product_type: job.input.product_type,
    })

    // Update job with prediction ID
    await supabase
      .from('ai_jobs')
      .update({
        prediction_id: prediction.id,
        output: { prediction_id: prediction.id },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log('[worker] ✅ Mockup generation started:', prediction.id)
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
