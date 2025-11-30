import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

export interface ReplicateImageInput {
  prompt: string
  num_outputs?: number
  width?: number
  height?: number
  background?: 'transparent' | 'studio'
}

export interface ReplicateTryOnInput {
  garment_image: string // URL or base64
  template?: 'flat_lay' | 'lifestyle'
  product_type?: 'shirts' | 'hoodies' | 'tumblers' | 'dtf-transfers'
}

// Multi-model configuration
const MODELS = [
  {
    id: 'google/imagen-4',
    name: 'Google Imagen 4',
    isSynchronous: true, // Uses replicate.run()
  },
  {
    id: 'leonardoai/lucid-origin',
    name: 'Leonardo Lucid Origin',
    isSynchronous: true, // Uses replicate.run() - returns array of outputs
  }
]

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
    // Google Imagen 4 parameters
    if (modelId.includes('imagen-4') || modelId.includes('imagen-3') || modelId.includes('google/')) {
      modelInput.aspect_ratio = '1:1'
      modelInput.safety_filter_level = 'block_only_high'
      modelInput.output_format = 'png'
    }
    // Leonardo Lucid Origin parameters
    else if (modelId.includes('leonardoai/lucid-origin')) {
      modelInput.aspect_ratio = '1:1'
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
  console.log('[replicate] 🎨🎨 Multi-model generation started with', MODELS.length, 'models')

  // Generate with all configured models
  const results = await Promise.all(
    MODELS.map(model => generateWithSingleModel(model, input))
  )

  console.log('[replicate] ✅ Multi-model generation complete:', results.length, 'outputs')

  // Return a multi-model result object
  return {
    id: 'multi-model-' + Date.now(),
    status: 'succeeded',
    outputs: results,
    isMultiModel: true,
  }
}

export async function removeBackground(imageUrl: string) {
  const modelId = process.env.REPLICATE_REMBG_MODEL_ID!

  console.log('[replicate] 🎨 Removing background from image')

  const params: any = {
    input: {
      image: imageUrl,
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

  const prediction = await replicate.predictions.create(params)

  console.log('[replicate] ✅ Background removal prediction created:', prediction.id)

  return prediction
}

export async function generateMockup(input: ReplicateTryOnInput) {
  const modelId = process.env.REPLICATE_TRYON_MODEL_ID!

  console.log('[replicate] 👕 Generating mockup:', { modelId, template: input.template, product_type: input.product_type, garment_image: input.garment_image })

  // Google Nano Banana uses natural language prompts + image_input array
  // CRITICAL: Must be VERY explicit about using the input image's design

  let prompt = ''

  if (input.template === 'flat_lay') {
    const productName = input.product_type === 'shirts' ? 't-shirt' :
                       input.product_type === 'hoodies' ? 'hoodie' :
                       input.product_type === 'tumblers' ? 'tumbler' : 'product'
    prompt = `Place the graphic design from the input image onto the center front of a ${productName}. IMPORTANT: Copy the graphic EXACTLY as it appears in the input - do NOT modify colors, do NOT add backgrounds, do NOT alter the design in any way. Show a professional flat lay product photography of the ${productName} with the original design printed on it. Studio lighting, clean white background for the product only, high quality product photography.`
  } else {
    const productName = input.product_type === 'shirts' ? 't-shirt' :
                       input.product_type === 'hoodies' ? 'hoodie' : 'product'
    prompt = `A model wearing a ${productName} with a graphic design on the front. CRITICAL REQUIREMENT: The graphic on the ${productName} must be EXACTLY the same as shown in the input image - same colors, same design, same everything. Do NOT modify, do NOT add backgrounds, do NOT change anything about the graphic. Only show the model and ${productName}, with the input graphic perfectly preserved. Professional lifestyle photography.`
  }

  // Nano Banana parameters
  const params: any = {
    input: {
      prompt: prompt,
      image_input: [input.garment_image], // Array of input images - the product design
      aspect_ratio: '1:1', // Square format for product images
      output_format: 'png', // PNG for transparency support
      num_outputs: 1, // Generate only 1 image per prediction
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

  console.log('[replicate] 🔍 Full params being sent to Replicate:', JSON.stringify(params, null, 2))

  const prediction = await replicate.predictions.create(params)

  console.log('[replicate] ✅ Mockup prediction created:', prediction.id)
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
