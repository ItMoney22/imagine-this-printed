/**
 * Realistic Mockup Generation API Routes
 * Handles AI-powered realistic mockup generation with Nano Banana virtual try-on
 */

import express, { Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import * as gcsStorage from '../services/gcs-storage.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import Replicate from 'replicate'

const router = express.Router()

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!
})

interface MockupGenerationRequest {
  designImageUrl: string // data URL or public URL
  designElements: any[] // Konva elements
  productTemplate: 'shirts' | 'hoodies' | 'tumblers'
  modelDescription: {
    garmentColor: string
    shirtType?: string
    gender: string
    ethnicity: string
    hairColor: string
    eyeColor: string
    bodyType: string
    additionalDetails?: string
  }
}

/**
 * POST /api/realistic-mockups/generate
 * Generate realistic mockup using Nano Banana virtual try-on
 */
router.post('/generate', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const {
      designImageUrl,
      designElements,
      productTemplate,
      modelDescription
    } = req.body as MockupGenerationRequest

    // Validate required fields
    if (!designImageUrl || !productTemplate || !modelDescription) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: designImageUrl, productTemplate, modelDescription'
      })
    }

    // Check user's ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      return res.status(500).json({ ok: false, error: 'Failed to fetch wallet balance' })
    }

    const GENERATION_COST = 25

    if (wallet.itc_balance < GENERATION_COST) {
      return res.status(402).json({
        ok: false,
        error: `Insufficient ITC balance. Required: ${GENERATION_COST}, Available: ${wallet.itc_balance}`
      })
    }

    // Create mockup_generations record
    const { data: generation, error: genError } = await supabase
      .from('mockup_generations')
      .insert({
        user_id: userId,
        design_snapshot: designElements,
        model_description: modelDescription,
        product_template: productTemplate,
        status: 'generating',
        generation_cost: GENERATION_COST
      })
      .select()
      .single()

    if (genError || !generation) {
      console.error('[realistic-mockups] Error creating generation:', genError)
      return res.status(500).json({ ok: false, error: 'Failed to create generation record' })
    }

    // Deduct ITC from wallet
    const newBalance = wallet.itc_balance - GENERATION_COST

    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    if (updateError) {
      // Rollback generation record
      await supabase
        .from('mockup_generations')
        .delete()
        .eq('id', generation.id)

      return res.status(500).json({ ok: false, error: 'Failed to deduct ITC' })
    }

    // Log transaction
    await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        transaction_type: 'mockup_generation',
        amount: -GENERATION_COST,
        balance_before: wallet.itc_balance,
        balance_after: newBalance,
        reference_id: generation.id,
        reference_type: 'mockup',
        description: `Realistic mockup generation for ${productTemplate}`
      })

    // Upload design to GCS temp storage
    let designGcsUrl: string
    try {
      const uploadResult = await gcsStorage.uploadFromDataUrl(designImageUrl, {
        userId,
        folder: 'temp',
        filename: `design_${generation.id}.png`
      })
      designGcsUrl = uploadResult.publicUrl
    } catch (uploadError: any) {
      console.error('[realistic-mockups] GCS upload error:', uploadError)

      // Refund and mark as failed
      await refundGeneration(userId, generation.id, wallet.itc_balance, GENERATION_COST)
      await supabase
        .from('mockup_generations')
        .update({ status: 'failed', error_message: 'Failed to upload design' })
        .eq('id', generation.id)

      return res.status(500).json({ ok: false, error: 'Failed to upload design to storage' })
    }

    // Start async generation process
    generateMockupAsync(generation.id, userId, designGcsUrl, modelDescription, productTemplate)
      .catch(error => {
        console.error('[realistic-mockups] Async generation error:', error)
      })

    // Return immediately with generation ID
    return res.json({
      ok: true,
      generationId: generation.id,
      status: 'generating',
      cost: GENERATION_COST,
      newBalance,
      estimatedTime: 45 // seconds
    })

  } catch (error: any) {
    console.error('[realistic-mockups] Generate error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
})

/**
 * GET /api/realistic-mockups/:generationId/status
 * Check status of mockup generation
 */
router.get('/:generationId/status', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { generationId } = req.params

    const { data: generation, error } = await supabase
      .from('mockup_generations')
      .select('*')
      .eq('id', generationId)
      .eq('user_id', userId)
      .single()

    if (error || !generation) {
      return res.status(404).json({ ok: false, error: 'Generation not found' })
    }

    return res.json({
      ok: true,
      generationId: generation.id,
      status: generation.status,
      mockupUrl: generation.mockup_url,
      errorMessage: generation.error_message,
      createdAt: generation.created_at
    })

  } catch (error: any) {
    console.error('[realistic-mockups] Get status error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
})

/**
 * POST /api/realistic-mockups/:generationId/select
 * Accept mockup and move from temp to permanent storage
 */
router.post('/:generationId/select', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { generationId } = req.params

    // Get generation
    const { data: generation, error: genError } = await supabase
      .from('mockup_generations')
      .select('*')
      .eq('id', generationId)
      .eq('user_id', userId)
      .single()

    if (genError || !generation) {
      return res.status(404).json({ ok: false, error: 'Generation not found' })
    }

    if (generation.status !== 'completed') {
      return res.status(400).json({ ok: false, error: 'Mockup not ready for selection' })
    }

    console.log(`[realistic-mockups] Moving mockup from temp to permanent storage: ${generation.gcs_path}`)

    // Move file from temp to permanent mockups folder
    const tempPath = generation.gcs_path
    const permanentPath = tempPath.replace('/temp/', '/mockups/')

    try {
      await gcsStorage.moveFile(tempPath, permanentPath)
      console.log(`[realistic-mockups] File moved successfully to: ${permanentPath}`)
    } catch (moveError: any) {
      console.error('[realistic-mockups] Failed to move file:', moveError)
      return res.status(500).json({ ok: false, error: 'Failed to move mockup to permanent storage' })
    }

    // Update generation record with new path
    await supabase
      .from('mockup_generations')
      .update({
        status: 'selected',
        gcs_path: permanentPath,
        mockup_url: generation.mockup_url.replace('/temp/', '/mockups/')
      })
      .eq('id', generationId)

    // Create user_media record
    const { data: media, error: mediaError } = await supabase
      .from('user_media')
      .insert({
        user_id: userId,
        media_type: 'mockup',
        file_url: generation.mockup_url.replace('/temp/', '/mockups/'),
        gcs_path: permanentPath,
        source_generation_id: generationId,
        metadata: {
          productTemplate: generation.product_template,
          modelDescription: generation.model_description
        }
      })
      .select()
      .single()

    if (mediaError || !media) {
      console.error('[realistic-mockups] Media creation error:', mediaError)
      return res.status(500).json({ ok: false, error: 'Failed to create media record' })
    }

    // Return public mockup URL for download
    const downloadUrl = generation.mockup_url.replace('/temp/', '/mockups/')

    return res.json({
      ok: true,
      mediaId: media.id,
      downloadUrl,
      message: 'Mockup accepted and saved to your profile'
    })

  } catch (error: any) {
    console.error('[realistic-mockups] Select error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
})

/**
 * POST /api/realistic-mockups/:generationId/discard
 * Reject mockup, delete from temp storage, and refund ITC
 */
router.post('/:generationId/discard', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { generationId } = req.params

    // Get generation
    const { data: generation, error: genError } = await supabase
      .from('mockup_generations')
      .select('*')
      .eq('id', generationId)
      .eq('user_id', userId)
      .single()

    if (genError || !generation) {
      return res.status(404).json({ ok: false, error: 'Generation not found' })
    }

    // Check if already refunded or selected
    if (generation.refunded) {
      return res.status(400).json({ ok: false, error: 'Already refunded' })
    }

    if (generation.status === 'selected') {
      return res.status(400).json({ ok: false, error: 'Cannot refund selected mockup' })
    }

    // Delete temp file from GCS
    if (generation.gcs_path) {
      try {
        await gcsStorage.deleteFile(generation.gcs_path)
        console.log(`[realistic-mockups] Deleted temp mockup: ${generation.gcs_path}`)
      } catch (deleteError: any) {
        console.error('[realistic-mockups] Failed to delete temp file:', deleteError)
        // Continue with refund even if delete fails
      }
    }

    // Get current balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      return res.status(500).json({ ok: false, error: 'Failed to fetch wallet' })
    }

    const REFUND_AMOUNT = generation.generation_cost
    const newBalance = wallet.itc_balance + REFUND_AMOUNT

    // Update wallet
    await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    // Log refund transaction
    await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        transaction_type: 'mockup_refund',
        amount: REFUND_AMOUNT,
        balance_before: wallet.itc_balance,
        balance_after: newBalance,
        reference_id: generationId,
        reference_type: 'mockup',
        description: 'Mockup rejected - refund'
      })

    // Update generation record
    await supabase
      .from('mockup_generations')
      .update({
        status: 'discarded',
        refunded: true
      })
      .eq('id', generationId)

    return res.json({
      ok: true,
      refunded: true,
      refundAmount: REFUND_AMOUNT,
      newBalance,
      message: 'Mockup rejected and ITC refunded'
    })

  } catch (error: any) {
    console.error('[realistic-mockups] Discard error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
})

/**
 * GET /api/realistic-mockups/gallery
 * Get user's mockup gallery
 */
router.get('/gallery', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const mediaType = req.query.type as string // 'mockup', 'design', 'upload', 'all'

    const offset = (page - 1) * limit

    // Build query
    let query = supabase
      .from('user_media')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)

    if (mediaType && mediaType !== 'all') {
      query = query.eq('media_type', mediaType)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false })

    const { data: items, error, count } = await query

    if (error) {
      console.error('[realistic-mockups] Gallery fetch error:', error)
      return res.status(500).json({ ok: false, error: 'Failed to fetch gallery' })
    }

    return res.json({
      ok: true,
      items: items || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })

  } catch (error: any) {
    console.error('[realistic-mockups] Gallery error:', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
})

/**
 * Async function to generate mockup with Nano Banana
 */
async function generateMockupAsync(
  generationId: string,
  userId: string,
  designUrl: string,
  modelDescription: any,
  productTemplate: string
): Promise<void> {
  try {
    console.log(`[Mockup ${generationId}] Starting generation with Nano Banana`)

    // Build prompt for virtual try-on
    const garmentDescription = buildGarmentDescription(modelDescription, productTemplate)

    console.log(`[Mockup ${generationId}] Garment description:`, garmentDescription)

    // Call Replicate Nano Banana API (Google image editing model) for virtual try-on
    const nanoBananaModel = "google/nano-banana:858e56734846d24469ed35a07ca2161aaf4f83588d7060e32964926e1b73b7be"
    console.log(`[Mockup ${generationId}] Using Nano Banana model:`, nanoBananaModel)

    // Build prompt for Nano Banana to perform virtual try-on
    const stockModelUrl = await getStockModelUrlWithFallback(modelDescription)
    const prompt = `Professional product photography of a front-facing full body ${modelDescription.gender} model wearing a ${modelDescription.garmentColor} ${garmentDescription}. The model is ${modelDescription.ethnicity} with ${modelDescription.bodyType} body type, facing directly towards the camera in a straight-on front view. Apply the custom graphic design from the reference images seamlessly onto the ${garmentDescription}. Show the complete garment from shoulders to waist with realistic fabric texture, proper lighting, and natural shadows. Front view only, full torso view, not turned to the side, not just a headshot. High quality professional fashion photography.`

    console.log(`[Mockup ${generationId}] Prompt:`, prompt)
    console.log(`[Mockup ${generationId}] Stock model URL:`, stockModelUrl)
    console.log(`[Mockup ${generationId}] Design URL:`, designUrl)

    const output = await replicate.run(
      nanoBananaModel as any,
      {
        input: {
          prompt: prompt,
          image_input: [stockModelUrl, designUrl],
          output_format: "png",
          aspect_ratio: "3:4"
        }
      }
    )

    // Update prediction ID
    await supabase
      .from('mockup_generations')
      .update({ replicate_prediction_id: String((output as any)?.id || 'unknown') })
      .eq('id', generationId)

    // Handle Nano Banana output (async iterator or direct response)
    let outputUrl: string | null = null

    if (typeof output === 'string') {
      outputUrl = output
    } else if (Array.isArray(output) && output.length > 0) {
      outputUrl = output[0]
    } else if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
      // Handle async iterator
      console.log(`[Mockup ${generationId}] Processing async iterator output`)
      const outputs: string[] = []
      for await (const item of output as AsyncIterable<any>) {
        if (typeof item === 'string') {
          outputs.push(item)
        } else if (item && typeof item === 'object') {
          // Check if it's a FileOutput object
          if ('url' in item) {
            outputs.push(item.url)
          } else if ('toString' in item) {
            outputs.push(item.toString())
          }
        }
      }
      if (outputs.length > 0) {
        // If first chunk looks like binary data (starts with PNG header bytes), concatenate all chunks
        const firstChunk = outputs[0]
        if (firstChunk && firstChunk.match(/^137,80,78,71/)) {
          console.log(`[Mockup ${generationId}] Detected chunked binary data, concatenating ${outputs.length} chunks...`)
          outputUrl = outputs.join(',')
        } else {
          // It's a URL or single-chunk response
          outputUrl = outputs[0]
        }
      }
    }

    if (!outputUrl || typeof outputUrl !== 'string') {
      throw new Error('No valid output from Nano Banana')
    }

    console.log(`[Mockup ${generationId}] Generation complete from Replicate:`, outputUrl.substring(0, 100) + '...')

    // Download result or convert binary data to buffer
    let buffer: Buffer

    if (outputUrl.startsWith('http://') || outputUrl.startsWith('https://')) {
      // It's a URL - download it
      console.log(`[Mockup ${generationId}] 🔗 Detected URL output, downloading...`)
      const response = await fetch(outputUrl)
      if (!response.ok) {
        throw new Error(`Failed to download result: ${response.statusText}`)
      }
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      // It's raw binary data - convert to Buffer
      console.log(`[Mockup ${generationId}] 🔧 Detected binary data, converting to Buffer...`)
      const byteArray = outputUrl.split(',').map(b => parseInt(b.trim()))
      buffer = Buffer.from(byteArray)
      console.log(`[Mockup ${generationId}] 📦 Buffer size:`, buffer.length, 'bytes')
    }

    const uploadResult = await gcsStorage.uploadFile(buffer, {
      userId,
      folder: 'temp',
      filename: `mockup_${generationId}.png`,
      contentType: 'image/png',
      metadata: {
        generationId
      }
    })

    // Update generation record
    await supabase
      .from('mockup_generations')
      .update({
        status: 'completed',
        mockup_url: uploadResult.publicUrl,
        gcs_path: uploadResult.gcsPath
      })
      .eq('id', generationId)

    console.log(`[Mockup ${generationId}] Upload to GCS complete:`, uploadResult.publicUrl)

  } catch (error: any) {
    console.error(`[Mockup ${generationId}] Generation failed:`, error)

    // Get wallet to refund
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (wallet) {
      await refundGeneration(userId, generationId, wallet.itc_balance, 25)
    }

    // Update as failed
    await supabase
      .from('mockup_generations')
      .update({
        status: 'failed',
        error_message: error.message
      })
      .eq('id', generationId)
  }
}

/**
 * Build garment description for Nano Banana
 */
function buildGarmentDescription(modelDescription: any, productTemplate: string): string {
  const { garmentColor, shirtType } = modelDescription

  let garmentType = ''
  if (productTemplate === 'shirts') {
    garmentType = shirtType || 'crew neck t-shirt'
  } else if (productTemplate === 'hoodies') {
    garmentType = 'hoodie'
  } else {
    garmentType = 'tank top'
  }

  // Simple description for the garment
  return `${garmentColor} ${garmentType}`
}

/**
 * Get stock model image URL based on description
 * Falls back to generic models if specific combination not available
 * Validates URLs to ensure they exist before passing to Replicate
 */
async function getStockModelUrlWithFallback(modelDescription: any): Promise<string> {
  const { gender, ethnicity, bodyType } = modelDescription

  // Map to stock photo filename pattern
  const photoKey = `${gender}-${ethnicity}-${bodyType}`.toLowerCase()

  // Primary URL
  const primaryUrl = `https://storage.googleapis.com/imagine-this-printed-media/stock-models/${photoKey}.jpg`

  // Fallback URLs in order of preference
  const fallbackUrls = [
    primaryUrl,
    `https://storage.googleapis.com/imagine-this-printed-media/stock-models/${gender}-caucasian-athletic.jpg`,
    `https://storage.googleapis.com/imagine-this-printed-media/stock-models/${gender}-caucasian-slim.jpg`,
    `https://storage.googleapis.com/imagine-this-printed-media/stock-models/female-caucasian-athletic.jpg`,
    `https://storage.googleapis.com/imagine-this-printed-media/stock-models/male-caucasian-athletic.jpg`
  ]

  console.log('[Stock Model] Trying primary URL:', primaryUrl)
  console.log('[Stock Model] Fallback chain:', fallbackUrls)

  // Check each URL and return first valid one
  for (const url of fallbackUrls) {
    try {
      console.log('[Stock Model] Validating URL:', url)
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok) {
        console.log('[Stock Model] ✅ Using valid URL:', url)
        return url
      } else {
        console.log('[Stock Model] ❌ URL returned status:', response.status)
      }
    } catch (error) {
      console.log('[Stock Model] ❌ URL check failed:', error)
      // Continue to next fallback
    }
  }

  // If all fail, return primary URL anyway and let Replicate handle the error
  console.log('[Stock Model] ⚠️ No valid URLs found in fallback chain, using primary:', primaryUrl)
  console.log('[Stock Model] 🚧 Stock model may not exist yet - check generate-stock-models script status')
  return primaryUrl
}

/**
 * Refund generation cost to user
 */
async function refundGeneration(
  userId: string,
  generationId: string,
  currentBalance: number,
  amount: number
): Promise<void> {
  const newBalance = currentBalance + amount

  await supabase
    .from('user_wallets')
    .update({ itc_balance: newBalance })
    .eq('user_id', userId)

  await supabase
    .from('wallet_transactions')
    .insert({
      user_id: userId,
      transaction_type: 'mockup_refund',
      amount,
      balance_before: currentBalance,
      balance_after: newBalance,
      reference_id: generationId,
      reference_type: 'mockup',
      description: 'Auto-refund due to generation failure'
    })

  await supabase
    .from('mockup_generations')
    .update({ refunded: true })
    .eq('id', generationId)
}

export default router
