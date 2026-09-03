import Replicate from 'replicate'
import { buildDTFPrompt } from './dtf-optimizer.js'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export interface ReplicateImageInput {
  prompt: string
  num_outputs?: number
  width?: number
  height?: number
  background?: 'transparent' | 'studio'
  shirtColor?: 'black' | 'white' | 'grey' | 'color'
  printStyle?: 'clean' | 'halftone' | 'grunge'
  // Model selection - defaults to first model if not specified
  modelId?: 'google/imagen-4-ultra' | 'google/imagen-4' | 'black-forest-labs/flux-2-pro'
}

export interface ReplicateTryOnInput {
  garment_image: string // URL or base64 - the design to apply
  template?: 'flat_lay' | 'lifestyle' | 'mr_imagine'
  product_type?: 'shirts' | 'hoodies' | 'tumblers' | 'dtf-transfers'
  shirtColor?: 'black' | 'white' | 'gray' | 'color' // DTF shirt color for mockup matching
  productType?: 'tshirt' | 'hoodie' | 'tank' // Product type for Mr. Imagine mockups
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'front-back' | 'pocket-front-back-full'
}

// Garment categories that support ghost mannequin mockups
export const GHOST_MANNEQUIN_SUPPORTED_CATEGORIES = ['shirts', 'hoodies', 'tanks']
export const GHOST_MANNEQUIN_SUPPORTED_PRODUCT_TYPES = ['tshirt', 'hoodie', 'tank', 'polo', 'youth-tshirt']

// Product types with static Mr. Imagine character bases (MR_IMAGINE_MOCKUPS
// below). Polos have no character asset, so their fan-out must skip the
// mr_imagine template or the composite job 404s on the base image.
export const MR_IMAGINE_SUPPORTED_PRODUCT_TYPES = ['tshirt', 'hoodie', 'tank']

// Mr. Imagine mockup base URLs - using public assets from the frontend
// These should be publicly accessible URLs to the Mr. Imagine mockup images
const MR_IMAGINE_MOCKUPS: Record<string, Record<string, Record<string, string>>> = {
  tshirt: {
    front: {
      black: '/mr-imagine/mockups/mr-imagine-tshirt-black-front.png',
      white: '/mr-imagine/mockups/mr-imagine-tshirt-white-front.png',
      gray: '/mr-imagine/mockups/mr-imagine-tshirt-gray-front.png',
    },
    back: {
      black: '/mr-imagine/mockups/mr-imagine-tshirt-black-back.png',
      white: '/mr-imagine/mockups/mr-imagine-tshirt-white-back.png',
      gray: '/mr-imagine/mockups/mr-imagine-tshirt-gray-back.png',
    },
  },
  hoodie: {
    front: {
      black: '/mr-imagine/mockups/mr-imagine-hoodie-black-front.png',
      white: '/mr-imagine/mockups/mr-imagine-hoodie-white-front.png',
    },
    back: {
      black: '/mr-imagine/mockups/mr-imagine-hoodie-black-back.png',
      white: '/mr-imagine/mockups/mr-imagine-hoodie-white-back.png',
    },
  },
  tank: {
    front: {
      black: '/mr-imagine/mockups/mr-imagine-tank-black-front.png',
      white: '/mr-imagine/mockups/mr-imagine-tank-white-front.png',
    },
  },
}

// Single model configuration - Flux only (best results for DTF printing)
// Migrated 2026-07-28 (Watchtower 335a3416) from flux-1.1-pro-ultra, which
// billed $0.06/image flat. flux-2-pro bills $0.015/MP in + $0.015/MP out, so
// the 1 MP generations below run ~75% cheaper.
const MODELS = [
  {
    id: 'black-forest-labs/flux-2-pro',
    name: 'Flux 2 Pro',
    isSynchronous: true,
  },
]

// Export available models for frontend display
export const AVAILABLE_MODELS = MODELS.map(m => ({ id: m.id, name: m.name }))

// Helper function to generate with a single model
async function generateWithSingleModel(modelConfig: typeof MODELS[0], input: ReplicateImageInput) {
  const modelId = modelConfig.id
  const modelName = modelConfig.name
  const isSynchronous = modelConfig.isSynchronous

  console.log(`[replicate] 🎨 Generating with ${modelName}:`, { modelId, prompt: input.prompt.substring(0, 50) + '...' })

  // Build input parameters based on model
  let modelInput: any = {
    prompt: input.prompt,
  }

  // Synchronous models - Use replicate.run()
  if (isSynchronous) {
    // Google Imagen 4/Ultra parameters
    if (modelId.includes('imagen-4') || modelId.includes('imagen-3') || modelId.includes('google/')) {
      modelInput.aspect_ratio = '1:1'
      modelInput.safety_filter_level = 'block_only_high'
      modelInput.output_format = 'png'
    }
    // Flux 2 Pro parameters. NOTE: flux-2-pro does NOT accept `raw` (that was
    // a flux-1.1-pro-ultra-only param) and has no `negative_prompt`.
    // `output_format` defaults to webp on this model — keep png explicit or
    // DTF loses the alpha channel. `resolution` defaults to "1 MP"; pinned
    // here because it is what sets the per-image price.
    else if (modelId.includes('flux-2-pro') || modelId.includes('black-forest-labs/')) {
      modelInput.aspect_ratio = '1:1'
      modelInput.output_format = 'png'
      modelInput.resolution = '1 MP'
      modelInput.safety_tolerance = 2
    }
    // Lucid Origin parameters (Leonardo AI)
    else if (modelId.includes('lucid-origin') || modelId.includes('leonardoai/')) {
      modelInput.width = 1024
      modelInput.height = 1024
      modelInput.num_outputs = 1
      modelInput.output_format = 'png'
    }
    // Generic fallback
    else {
      modelInput.aspect_ratio = '1:1'
      modelInput.output_format = 'png'
    }

    console.log(`[replicate] 🔍 Using replicate.run() for ${modelName}`)

    // Use replicate.run() which returns the output directly
    const output = await replicate.run(modelId as any, { input: modelInput }) as any

    console.log(`[replicate] ✅ ${modelName} generation complete`)
    console.log(`[replicate] 🔍 ${modelName} raw output type:`, typeof output, Array.isArray(output) ? `array[${output.length}]` : '')

    // Get the URL from the output
    let imageUrl: string

    // Leonardo returns array of objects with .url() method
    if (Array.isArray(output) && output.length > 0) {
      imageUrl = typeof output[0].url === 'function' ? output[0].url() : output[0]
    }
    // Imagen returns string directly or object with url
    else {
      imageUrl = typeof output.url === 'function' ? output.url() : output
    }

    console.log(`[replicate] 🔍 ${modelName} Image URL:`, imageUrl)

    return {
      modelId,
      modelName,
      isSynchronous: true,
      url: imageUrl,
      imageUrl: imageUrl, // Also provide imageUrl for frontend compatibility
      status: 'succeeded',
    }
  }
  // Asynchronous models - Use predictions API for async execution
  else {
    // Check if it's a version hash (contains :)
    const isVersion = modelId.includes(':')

    // Recraft V3 parameters
    if (modelId.includes('recraft-ai/recraft-v3')) {
      modelInput.size = '1024x1024'
      modelInput.style = 'realistic_image'
    }
    // Generic fallback
    else {
      modelInput.aspect_ratio = '1:1'
      modelInput.output_format = 'png'
      modelInput.output_quality = 90
    }

    const params: any = {
      input: modelInput,
      webhook: `${process.env.PUBLIC_URL}/api/ai/replicate/callback`,
      webhook_events_filter: ['completed'],
    }

    // Set model or version
    if (isVersion) {
      params.version = modelId.split(':')[1]
    } else {
      params.model = modelId
    }

    console.log(`[replicate] 🔍 Using predictions.create() for ${modelName}`)

    const prediction = await replicate.predictions.create(params)
    console.log(`[replicate] ✅ ${modelName} prediction created:`, prediction.id)

    return {
      modelId,
      modelName,
      isSynchronous: false,
      predictionId: prediction.id,
      status: 'processing',
    }
  }
}

export async function generateProductImage(input: ReplicateImageInput) {
  console.log('[replicate] 🎨 Generating image with Flux 1.1 Pro Ultra')

  // Build DTF-aware prompt if shirt color and style are specified
  let finalPrompt = input.prompt
  if (input.shirtColor || input.printStyle) {
    const shirtColor = input.shirtColor || 'black'
    const printStyle = input.printStyle || 'clean'
    finalPrompt = buildDTFPrompt(input.prompt, shirtColor, printStyle)
    console.log('[replicate] 📝 Using DTF-aware prompt for:', { shirtColor, printStyle })
  }

  // Create input with final prompt
  const finalInput = {
    ...input,
    prompt: finalPrompt,
  }

  // Generate with single Flux model
  console.log('[replicate] 🚀 Starting generation with:', MODELS[0].name)

  const results = await Promise.allSettled(
    MODELS.map(model => generateWithSingleModel(model, finalInput))
  )

  // Process results - extract successful ones and log failures
  const outputs: any[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      outputs.push(result.value)
      console.log(`[replicate] ✅ ${MODELS[index].name} succeeded`)
    } else {
      console.error(`[replicate] ❌ ${MODELS[index].name} failed:`, result.reason?.message || result.reason)
      // Still include failed model info so frontend knows what happened
      outputs.push({
        modelId: MODELS[index].id,
        modelName: MODELS[index].name,
        status: 'failed',
        error: result.reason?.message || 'Generation failed',
      })
    }
  })

  console.log('[replicate] ✅ Flux generation complete. Success:', outputs.filter(o => o.status === 'succeeded').length, '/', MODELS.length)

  return {
    id: 'multi-model-' + Date.now(),
    status: 'succeeded',
    outputs,
    isMultiModel: true,
  }
}

export async function generateMockup(input: ReplicateTryOnInput) {
  const modelId = process.env.REPLICATE_TRYON_MODEL_ID!

  console.log('[replicate] 👕 Generating Mr. Imagine mockup:', {
    modelId,
    template: input.template,
    product_type: input.product_type,
    productType: input.productType,
    shirtColor: input.shirtColor,
    printPlacement: input.printPlacement,
    garment_image: input.garment_image
  })

  // Determine product type and color for Mr. Imagine mockup selection
  const productType = input.productType || (input.product_type === 'hoodies' ? 'hoodie' : 'tshirt')
  const shirtColor = input.shirtColor || 'black'
  const printPlacement = input.printPlacement || 'front-center'

  // Determine front or back based on print placement
  const side = printPlacement === 'back-only' ? 'back' : 'front'

  // Get Mr. Imagine base mockup URL
  const siteUrl = process.env.FRONTEND_URL || process.env.APP_ORIGIN || 'https://imaginethisprinted.com'
  const mrImagineMockupPath = MR_IMAGINE_MOCKUPS[productType]?.[side]?.[shirtColor] ||
                              MR_IMAGINE_MOCKUPS[productType]?.front?.[shirtColor] ||
                              MR_IMAGINE_MOCKUPS['tshirt']['front']['black'] // Fallback
  const mrImagineMockupUrl = `${siteUrl}${mrImagineMockupPath}`

  console.log('[replicate] 🎭 Using Mr. Imagine mockup:', mrImagineMockupUrl)

  // Map shirt color to fabric color description
  const shirtColorMap: Record<string, string> = {
    'black': 'black',
    'white': 'white',
    'gray': 'heather gray',
    'grey': 'heather grey',
    'color': 'colored'
  }

  const fabricColor = shirtColorMap[shirtColor] || 'black'

  // Map product type to name
  const productNameMap: Record<string, string> = {
    'tshirt': 't-shirt',
    'hoodie': 'hoodie',
    'tank': 'tank top',
    'shirts': 't-shirt',
    'hoodies': 'hoodie',
  }
  const productName = productNameMap[productType] || productNameMap[input.product_type || 'shirts'] || 't-shirt'

  // Placement-specific instructions for design positioning
  const placementInstructions: Record<string, string> = {
    'front-center': 'centered on the chest area of the shirt',
    'left-pocket': 'small, positioned on the left chest pocket area',
    'back-only': 'large, centered on the back of the shirt',
    'pocket-front-back-full': 'small on the front left pocket and large on the back'
  }

  const placementDesc = placementInstructions[printPlacement] || placementInstructions['front-center']

  // Build the prompt and input images based on template type
  let prompt = ''
  let imageInputs: string[] = []

  if (input.template === 'flat_lay') {
    // Flat lay: Professional product photography, just the design on a garment, no Mr. Imagine
    prompt = `Create a professional flat lay product photograph of a ${fabricColor} ${productName} with the printed design from the input image applied ${placementDesc}.

REQUIREMENTS:
- Professional flat lay photography style - garment laid flat on a neutral surface
- Pure white or light gray background
- The design should be applied ${placementDesc} on the ${productName}
- Preserve the design EXACTLY as shown - same colors, same proportions
- Make the print look like a real DTF transfer on ${fabricColor} cotton fabric
- Professional studio lighting with soft shadows
- High resolution, clean e-commerce product photo style
- Slight natural fabric wrinkles for realism
- No mannequin, no model, no Mr. Imagine - just the garment laid flat`

    imageInputs = [input.garment_image] // Only the design image
  } else {
    // Mr. Imagine mockup: Character wearing the product with the design
    prompt = `Create a lifestyle product mockup featuring Mr. Imagine: The FIRST input image shows Mr. Imagine (a friendly purple furry character) wearing/modeling a ${fabricColor} ${productName}. The SECOND input image is a graphic design.

CRITICAL INSTRUCTIONS:
1. Keep Mr. Imagine exactly as shown in the FIRST image
2. Apply the design from the SECOND image ${placementDesc} on the ${productName}
3. The design should look like a real DTF printed graphic on the fabric
4. Preserve Mr. Imagine's character, pose, and the ${fabricColor} color of the ${productName}
5. Copy the graphic EXACTLY as it appears - same colors, same design elements
6. Professional lifestyle photography style with natural lighting
7. The result should look like Mr. Imagine is proudly showing off the custom ${productName}`

    imageInputs = [mrImagineMockupUrl, input.garment_image] // Mr. Imagine base + design
  }

  // ITP Enhance Engine parameters
  const params: any = {
    input: {
      prompt: prompt,
      image_input: imageInputs,
      aspect_ratio: '1:1',
      output_format: 'png',

    },
    webhook: `${process.env.PUBLIC_URL}/api/ai/replicate/callback`,
    webhook_events_filter: ['completed'],
  }

  // Check if modelId is a version hash (contains :)
  if (modelId.includes(':')) {
    params.version = modelId.split(':')[1]
  } else {
    params.model = modelId
  }

  console.log('[replicate] 🔍 Full Mr. Imagine mockup params:', JSON.stringify(params, null, 2))

  const prediction = await replicate.predictions.create(params)

  console.log('[replicate] ✅ Mr. Imagine mockup prediction created:', prediction.id)
  console.log('[replicate] 🔍 Full prediction response:', JSON.stringify(prediction, null, 2))

  return prediction
}

export async function upscaleImage(imageUrl: string) {
  const modelId = 'recraft-ai/recraft-v3'

  console.log('[replicate] 📈 Upscaling image with recraft-crisp-upscale')

  const params: any = {
    model: modelId,
    input: {
      image: imageUrl,
      style: 'realistic_image',
      upscale: true,
      size: '2048x2048', // Upscale to higher resolution
    },
    webhook: `${process.env.PUBLIC_URL}/api/ai/replicate/callback`,
    webhook_events_filter: ['completed'],
  }

  const prediction = await replicate.predictions.create(params)

  console.log('[replicate] ✅ Upscale prediction created:', prediction.id)

  return prediction
}

export async function getPrediction(predictionId: string) {
  return await replicate.predictions.get(predictionId)
}

/**
 * Synchronous background removal via Replicate 851-labs/background-remover.
 * Returns a (temporary) image URL — the caller persists it to GCS.
 *
 * Replaces the old Remove.bg path for the admin product builder: the Remove.bg
 * account has ZERO credits (every `size:auto` call 402s), and the platform
 * already pays for Replicate. Mirrors the Imagination Station fix.
 */
export async function removeBackgroundSync(imageUrl: string): Promise<string> {
  console.log('[replicate] 🎨 Removing background (851-labs, sync):', imageUrl.substring(0, 80))
  const output = await replicate.run(
    // Pinned version — the version-less `owner/name` form hits Replicate's
    // official-models endpoint (/models/.../predictions) and 404s for this
    // community model. Pinning the version routes through /predictions, which works.
    '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc' as `${string}/${string}:${string}`,
    { input: { image: imageUrl, format: 'png', background_type: 'rgba' } }
  )
  const extractUrl = (item: any): string => {
    if (!item) return ''
    if (typeof item === 'string') return item
    if (item instanceof URL) return item.href
    if (typeof item.href === 'string') return item.href
    if (typeof item.url === 'function') { const u = item.url(); return u instanceof URL ? u.href : String(u) }
    if (typeof item.url === 'string') return item.url
    return ''
  }
  const url = Array.isArray(output) ? extractUrl(output[0]) : extractUrl(output)
  if (!url) throw new Error('Background remover returned no image URL')
  return url
}
