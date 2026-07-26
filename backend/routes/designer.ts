import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import Replicate from 'replicate'
import { uploadImageFromUrl } from '../services/google-cloud-storage.js'
import { uploadFile } from '../services/gcs-storage.js'
import { removeBackgroundSync } from '../services/replicate.js'
import { logItcTransaction } from '../utils/wallet-logger.js'

const router = Router()

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
})

// Cost in ITC tokens for various operations
const MOCKUP_COST_ITC = 25
const BACKGROUND_REMOVAL_COST_ITC = 10
const IMAGE_UPSCALE_COST_ITC = 15

/**
 * POST /api/designer/generate-mockup
 * Generate a realistic product mockup using Replicate's image generation model
 *
 * Request body:
 * - designImageUrl: string (required) - URL to the design canvas export
 * - productTemplate: 'shirts' | 'hoodies' | 'tumblers' (required)
 * - mockupType: 'flat' | 'lifestyle' (optional, default 'flat')
 *
 * Response:
 * - ok: boolean
 * - mockupUrl: string - URL to generated mockup in GCS
 * - cost: number - ITC tokens deducted
 * - newBalance: number - Updated ITC balance
 */
router.post('/generate-mockup', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    if (!userId) {
      console.log('[designer/generate-mockup] ❌ Unauthorized - no user ID')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { designImageUrl, productTemplate, mockupType = 'flat' } = req.body

    // Validate inputs
    if (!designImageUrl || !productTemplate) {
      console.log('[designer/generate-mockup] ❌ Missing required fields')
      return res.status(400).json({
        error: 'designImageUrl and productTemplate are required'
      })
    }

    // Validate productTemplate
    const validTemplates = ['shirts', 'hoodies', 'tumblers']
    if (!validTemplates.includes(productTemplate)) {
      console.log('[designer/generate-mockup] ❌ Invalid product template:', productTemplate)
      return res.status(400).json({
        error: `Invalid productTemplate. Must be one of: ${validTemplates.join(', ')}`
      })
    }

    // Validate mockupType
    const validMockupTypes = ['flat', 'lifestyle']
    if (!validMockupTypes.includes(mockupType)) {
      console.log('[designer/generate-mockup] ❌ Invalid mockup type:', mockupType)
      return res.status(400).json({
        error: `Invalid mockupType. Must be one of: ${validMockupTypes.join(', ')}`
      })
    }

    console.log('[designer/generate-mockup] 🚀 Request received:', {
      userId,
      productTemplate,
      mockupType,
      designImageUrl: designImageUrl.substring(0, 100) + '...'
    })

    // Step 1: Check user ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      console.error('[designer/generate-mockup] ❌ Failed to fetch wallet:', walletError)
      return res.status(500).json({ error: 'Failed to fetch wallet' })
    }

    if (wallet.itc_balance < MOCKUP_COST_ITC) {
      console.log('[designer/generate-mockup] ❌ Insufficient balance:', wallet.itc_balance)
      return res.status(400).json({
        error: `Insufficient ITC balance. Need ${MOCKUP_COST_ITC}, have ${wallet.itc_balance}`
      })
    }

    console.log('[designer/generate-mockup] ✅ Wallet check passed. Balance:', wallet.itc_balance)

    // Step 2: Get mockup base template from product_mockups table
    // Map mockupType to view_type in database
    const viewTypeMapping: Record<string, string> = {
      'flat': 'flat-lay',
      'lifestyle': 'lifestyle'
    }
    const viewType = viewTypeMapping[mockupType] || 'flat-lay'

    const { data: mockup, error: mockupError } = await supabase
      .from('product_mockups')
      .select('mockup_image_url')
      .eq('category', productTemplate)
      .eq('view_type', viewType)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (mockupError) {
      console.error('[designer/generate-mockup] ❌ Error fetching mockup template:', mockupError)
    }

    let mockupBaseUrl: string
    if (mockup?.mockup_image_url) {
      mockupBaseUrl = mockup.mockup_image_url
      console.log('[designer/generate-mockup] 📸 Using template mockup:', mockupBaseUrl.substring(0, 100) + '...')
    } else {
      // Fall back to using design image directly if no mockup template found
      mockupBaseUrl = designImageUrl
      console.warn(`[designer/generate-mockup] ⚠️ No mockup found for ${productTemplate}/${viewType}, using design image directly`)
    }

    // Step 3: Call Replicate API to generate realistic mockup
    console.log('[designer/generate-mockup] 🎨 Calling Replicate API...')

    let output: any
    try {
      // Using Nano Banana (Gemini 2.5 Flash Image) — the current mockup tier leader.
      // Replaces the deprecated stability-ai/stable-diffusion (2022-pinned) path.
      output = await replicate.run(
        "google/nano-banana",
        {
          input: {
            prompt: `Create a professional flat lay product photograph of a ${productTemplate} with the design applied. Professional studio lighting, high quality, product photography, commercial, clean background`,
            image_input: [mockupBaseUrl],
            aspect_ratio: '1:1',
            output_format: 'png',
          },
        }
      )
    } catch (replicateError: any) {
      console.error('[designer/generate-mockup] ❌ Replicate API error:', replicateError)
      return res.status(500).json({
        error: 'Failed to generate mockup with AI',
        detail: replicateError.message
      })
    }

    console.log('[designer/generate-mockup] ✅ Replicate API response received')

    // Step 4: Extract image URL from Replicate output
    let generatedImageUrl: string
    if (typeof output === 'string') {
      generatedImageUrl = output
    } else if (Array.isArray(output) && output.length > 0) {
      generatedImageUrl = output[0]
    } else if (output && typeof output === 'object' && 'url' in output) {
      generatedImageUrl = typeof output.url === 'function' ? output.url() : output.url
    } else if (output && typeof output === 'object' && 'output' in output) {
      // Some models return { output: [...] } or { output: <url> }
      const outputArray = Array.isArray(output.output) ? output.output : [output.output]
      generatedImageUrl = outputArray[0]
    } else {
      console.error('[designer/generate-mockup] ❌ Unexpected Replicate API response format:', output)
      return res.status(500).json({
        error: 'Unexpected AI response format',
        detail: 'Could not extract image URL from response'
      })
    }

    console.log('[designer/generate-mockup] 🖼️ Generated image URL:', generatedImageUrl.substring(0, 100) + '...')

    // Step 5: Upload result to GCS
    const timestamp = Date.now()
    const destinationPath = `designer-mockups/${userId}/${timestamp}.png`

    console.log('[designer/generate-mockup] 📤 Uploading to GCS:', destinationPath)

    let finalMockupUrl: string
    try {
      const uploadResult = await uploadImageFromUrl(generatedImageUrl, destinationPath)
      finalMockupUrl = uploadResult.publicUrl
      console.log('[designer/generate-mockup] ✅ Uploaded to GCS:', finalMockupUrl.substring(0, 100) + '...')
    } catch (uploadError: any) {
      console.error('[designer/generate-mockup] ❌ GCS upload error:', uploadError)
      return res.status(500).json({
        error: 'Failed to upload mockup to storage',
        detail: uploadError.message
      })
    }

    // Step 6: Deduct ITC from user wallet
    const balanceBefore = wallet.itc_balance
    const balanceAfter = wallet.itc_balance - MOCKUP_COST_ITC

    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: balanceAfter
      })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[designer/generate-mockup] ❌ Failed to update wallet:', updateError)
      // Continue anyway - mockup was generated, we'll handle wallet inconsistency separately
    } else {
      console.log('[designer/generate-mockup] 💰 Deducted', MOCKUP_COST_ITC, 'ITC tokens')

      // Log the transaction
      await logItcTransaction({
        userId,
        amount: -MOCKUP_COST_ITC,
        type: 'debit',
        balanceBefore,
        balanceAfter,
        description: `Generated realistic ${mockupType} mockup for ${productTemplate}`,
        metadata: {
          service: 'mockup_generation',
          productTemplate,
          mockupType,
          designImageUrl: designImageUrl.substring(0, 100),
          resultUrl: finalMockupUrl.substring(0, 100)
        },
        relatedEntityType: 'mockup',
        relatedEntityId: finalMockupUrl
      })
    }

    const newBalance = balanceAfter

    console.log('[designer/generate-mockup] ✅ Mockup generated successfully')

    return res.json({
      ok: true,
      mockupUrl: finalMockupUrl,
      cost: MOCKUP_COST_ITC,
      newBalance
    })

  } catch (error: any) {
    console.error('[designer/generate-mockup] ❌ Unexpected error:', error)
    return res.status(500).json({
      error: error.message || 'Failed to generate mockup'
    })
  }
})

/**
 * GET /api/designer/mockup-cost
 * Get the current cost in ITC tokens for generating a mockup
 * Public endpoint - no authentication required
 */
router.get('/mockup-cost', async (req: Request, res: Response): Promise<any> => {
  return res.json({
    ok: true,
    cost: MOCKUP_COST_ITC,
    currency: 'ITC'
  })
})

/**
 * POST /api/designer/remove-background
 * Remove background from an image using Replicate's background removal model
 *
 * Request body:
 * - imageUrl: string (required) - URL or data URL of the image
 *
 * Response:
 * - ok: boolean
 * - imageUrl: string - URL to processed image in GCS
 * - cost: number - ITC tokens deducted
 * - newBalance: number - Updated ITC balance
 */
router.post('/remove-background', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    if (!userId) {
      console.log('[designer/remove-background] ❌ Unauthorized - no user ID')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { imageUrl } = req.body

    if (!imageUrl) {
      console.log('[designer/remove-background] ❌ Missing imageUrl')
      return res.status(400).json({ error: 'imageUrl is required' })
    }

    console.log('[designer/remove-background] 🚀 Request received:', {
      userId,
      imageUrl: imageUrl.substring(0, 100) + '...'
    })

    // Step 1: Check user ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      console.error('[designer/remove-background] ❌ Failed to fetch wallet:', walletError)
      return res.status(500).json({ error: 'Failed to fetch wallet' })
    }

    if (wallet.itc_balance < BACKGROUND_REMOVAL_COST_ITC) {
      console.log('[designer/remove-background] ❌ Insufficient balance:', wallet.itc_balance)
      return res.status(400).json({
        error: `Insufficient ITC balance. Need ${BACKGROUND_REMOVAL_COST_ITC}, have ${wallet.itc_balance}`
      })
    }

    console.log('[designer/remove-background] ✅ Wallet check passed. Balance:', wallet.itc_balance)

    // Step 2: Upload original image to GCS first (Remove.bg needs HTTP URL)
    const timestamp = Date.now()
    const tempPath = `designer-temp/${userId}/original-${timestamp}.png`

    console.log('[designer/remove-background] 📤 Uploading original image to GCS:', tempPath)

    let originalImageGcsUrl: string
    try {
      if (imageUrl.startsWith('data:')) {
        // It's a data URL - extract base64 and upload
        const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
        if (!matches || matches.length !== 3) {
          return res.status(400).json({ error: 'Invalid data URL format' })
        }
        const base64Data = matches[2]
        const buffer = Buffer.from(base64Data, 'base64')
        const uploadResult = await uploadFile(buffer, {
          userId,
          folder: 'temp',
          filename: `original-${timestamp}.png`,
          contentType: 'image/png'
        })
        originalImageGcsUrl = uploadResult.publicUrl
      } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        // Already an HTTP URL
        originalImageGcsUrl = imageUrl
      } else {
        return res.status(400).json({ error: 'Invalid image URL format' })
      }
      console.log('[designer/remove-background] ✅ Original image URL:', originalImageGcsUrl)
    } catch (uploadError: any) {
      console.error('[designer/remove-background] ❌ Failed to upload original image:', uploadError)
      return res.status(500).json({
        error: 'Failed to upload original image',
        detail: uploadError.message
      })
    }

    // Step 3: Remove background via Replicate 851-labs/background-remover (sync, fractions of a cent)
    // Replaces the Remove.bg path — Remove.bg account has ZERO credits (every `size:auto` call 402s).
    console.log('[designer/remove-background] 🎨 Removing background via Replicate 851-labs...')

    let processedImageUrl: string
    try {
      processedImageUrl = await removeBackgroundSync(originalImageGcsUrl)
    } catch (removebgError: any) {
      console.error('[designer/remove-background] ❌ Background removal error:', removebgError)
      return res.status(500).json({
        error: 'Failed to remove background with AI',
        detail: removebgError.message
      })
    }

    console.log('[designer/remove-background] ✅ Background removed successfully')

    // Step 4: Upload processed image to GCS
    const destinationPath = `designer-processed/${userId}/bg-removed-${timestamp}.png`

    console.log('[designer/remove-background] 📤 Uploading processed image to GCS:', destinationPath)

    let finalImageUrl: string
    try {
      console.log('[designer/remove-background] 📦 Processed image URL:', processedImageUrl.substring(0, 100))

      const uploadResult = await uploadImageFromUrl(processedImageUrl, destinationPath)
      finalImageUrl = uploadResult.publicUrl
      console.log('[designer/remove-background] ✅ Uploaded to GCS:', finalImageUrl)
    } catch (uploadError: any) {
      console.error('[designer/remove-background] ❌ GCS upload error:', uploadError)
      return res.status(500).json({
        error: 'Failed to upload processed image to storage',
        detail: uploadError.message
      })
    }

    // Step 5: Deduct ITC from user wallet
    const balanceBefore = wallet.itc_balance
    const balanceAfter = wallet.itc_balance - BACKGROUND_REMOVAL_COST_ITC

    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: balanceAfter
      })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[designer/remove-background] ❌ Failed to update wallet:', updateError)
    } else {
      console.log('[designer/remove-background] 💰 Deducted', BACKGROUND_REMOVAL_COST_ITC, 'ITC tokens')

      // Log the transaction
      await logItcTransaction({
        userId,
        amount: -BACKGROUND_REMOVAL_COST_ITC,
        type: 'debit',
        balanceBefore,
        balanceAfter,
        description: 'Removed background from image using AI',
        metadata: {
          service: 'background_removal',
          originalImageUrl: imageUrl.substring(0, 100),
          resultUrl: finalImageUrl.substring(0, 100)
        },
        relatedEntityType: 'processed_image',
        relatedEntityId: finalImageUrl
      })
    }

    const newBalance = balanceAfter

    console.log('[designer/remove-background] ✅ Background removed successfully')

    return res.json({
      ok: true,
      imageUrl: finalImageUrl,
      cost: BACKGROUND_REMOVAL_COST_ITC,
      newBalance
    })

  } catch (error: any) {
    console.error('[designer/remove-background] ❌ Unexpected error:', error)
    return res.status(500).json({
      error: error.message || 'Failed to remove background'
    })
  }
})

/**
 * POST /api/designer/upscale-image
 * Upscale an image to higher resolution using Replicate's upscaling model
 *
 * Request body:
 * - imageUrl: string (required) - URL or data URL of the image
 * - scale: 2 | 4 (required) - Upscale factor
 *
 * Response:
 * - ok: boolean
 * - imageUrl: string - URL to upscaled image in GCS
 * - cost: number - ITC tokens deducted
 * - newBalance: number - Updated ITC balance
 */
router.post('/upscale-image', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    if (!userId) {
      console.log('[designer/upscale-image] ❌ Unauthorized - no user ID')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { imageUrl, scale = 2 } = req.body

    if (!imageUrl) {
      console.log('[designer/upscale-image] ❌ Missing imageUrl')
      return res.status(400).json({ error: 'imageUrl is required' })
    }

    if (![2, 4].includes(scale)) {
      console.log('[designer/upscale-image] ❌ Invalid scale:', scale)
      return res.status(400).json({ error: 'scale must be 2 or 4' })
    }

    console.log('[designer/upscale-image] 🚀 Request received:', {
      userId,
      scale,
      imageUrl: imageUrl.substring(0, 100) + '...'
    })

    // Step 1: Check user ITC balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      console.error('[designer/upscale-image] ❌ Failed to fetch wallet:', walletError)
      return res.status(500).json({ error: 'Failed to fetch wallet' })
    }

    if (wallet.itc_balance < IMAGE_UPSCALE_COST_ITC) {
      console.log('[designer/upscale-image] ❌ Insufficient balance:', wallet.itc_balance)
      return res.status(400).json({
        error: `Insufficient ITC balance. Need ${IMAGE_UPSCALE_COST_ITC}, have ${wallet.itc_balance}`
      })
    }

    console.log('[designer/upscale-image] ✅ Wallet check passed. Balance:', wallet.itc_balance)

    // Step 2: Call Replicate API to upscale image
    console.log('[designer/upscale-image] 🎨 Calling Replicate API...')

    let output: any
    try {
      // Using Recraft Crisp Upscale — the value leader ($0.004-0.006/image) per 2026 benchmarks.
      // Replaces nightmareai/real-esrgan.
      const upscaleModel = 'recraft-ai/recraft-crisp-upscale'
      output = await replicate.run(
        upscaleModel,
        {
          input: {
            image: imageUrl,
            upscale: true,
            size: scale === 4 ? '2048x2048' : '1024x1024',
            style: 'realistic_image',
          },
        }
      )
    } catch (replicateError: any) {
      console.error('[designer/upscale-image] ❌ Replicate API error:', replicateError)
      return res.status(500).json({
        error: 'Failed to upscale image with AI',
        detail: replicateError.message
      })
    }

    console.log('[designer/upscale-image] ✅ Replicate API response received')

    // Step 3: Extract image URL from Replicate output
    let upscaledImageUrl: string
    if (typeof output === 'string') {
      upscaledImageUrl = output
    } else if (Array.isArray(output) && output.length > 0) {
      upscaledImageUrl = output[0]
    } else if (output && typeof output === 'object' && 'url' in output) {
      upscaledImageUrl = typeof output.url === 'function' ? output.url() : output.url
    } else if (output && typeof output === 'object' && 'output' in output) {
      const outputArray = Array.isArray(output.output) ? output.output : [output.output]
      upscaledImageUrl = outputArray[0]
    } else {
      console.error('[designer/upscale-image] ❌ Unexpected Replicate API response format:', output)
      return res.status(500).json({
        error: 'Unexpected AI response format'
      })
    }

    console.log('[designer/upscale-image] 🖼️ Upscaled image URL:', upscaledImageUrl.substring(0, 100) + '...')

    // Step 4: Upload result to GCS
    const timestamp = Date.now()
    const destinationPath = `designer-processed/${userId}/upscaled-${scale}x-${timestamp}.png`

    console.log('[designer/upscale-image] 📤 Uploading to GCS:', destinationPath)

    let finalImageUrl: string
    try {
      const uploadResult = await uploadImageFromUrl(upscaledImageUrl, destinationPath)
      finalImageUrl = uploadResult.publicUrl
      console.log('[designer/upscale-image] ✅ Uploaded to GCS:', finalImageUrl.substring(0, 100) + '...')
    } catch (uploadError: any) {
      console.error('[designer/upscale-image] ❌ GCS upload error:', uploadError)
      return res.status(500).json({
        error: 'Failed to upload upscaled image to storage',
        detail: uploadError.message
      })
    }

    // Step 5: Deduct ITC from user wallet
    const balanceBefore = wallet.itc_balance
    const balanceAfter = wallet.itc_balance - IMAGE_UPSCALE_COST_ITC

    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: balanceAfter
      })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[designer/upscale-image] ❌ Failed to update wallet:', updateError)
    } else {
      console.log('[designer/upscale-image] 💰 Deducted', IMAGE_UPSCALE_COST_ITC, 'ITC tokens')

      // Log the transaction
      await logItcTransaction({
        userId,
        amount: -IMAGE_UPSCALE_COST_ITC,
        type: 'debit',
        balanceBefore,
        balanceAfter,
        description: `Upscaled image to ${scale}x resolution using AI`,
        metadata: {
          service: 'image_upscale',
          scale,
          originalImageUrl: imageUrl.substring(0, 100),
          resultUrl: finalImageUrl.substring(0, 100)
        },
        relatedEntityType: 'processed_image',
        relatedEntityId: finalImageUrl
      })
    }

    const newBalance = balanceAfter

    console.log('[designer/upscale-image] ✅ Image upscaled successfully')

    return res.json({
      ok: true,
      imageUrl: finalImageUrl,
      scale,
      cost: IMAGE_UPSCALE_COST_ITC,
      newBalance
    })

  } catch (error: any) {
    console.error('[designer/upscale-image] ❌ Unexpected error:', error)
    return res.status(500).json({
      error: error.message || 'Failed to upscale image'
    })
  }
})

export default router
