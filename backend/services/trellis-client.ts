/**
 * TRELLIS Client Service
 *
 * Integrates with TRELLIS on Replicate (firtoz/trellis) for converting
 * images into 3D GLB models.
 *
 * TRELLIS uses a structured latent representation for scalable 3D generation.
 *
 * Note: This uses the Replicate API instead of Hugging Face Space for reliability.
 */

import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
})

// TRELLIS model on Replicate
const TRELLIS_MODEL = 'firtoz/trellis' as const

export interface TrellisInput {
  images: string[] // Array of image URLs (we'll use the first/front view)
  meshFormat?: 'glb' | 'obj'
  textureResolution?: number // 512, 1024, 2048
  seed?: number
}

export interface TrellisOutput {
  glbUrl: string
  processingTime: number
  raw?: unknown
}

/**
 * Generate a 3D model from an image using TRELLIS via Replicate
 *
 * @param input - Input configuration with image URLs
 * @returns GLB URL and processing metadata
 */
export async function generate3DModel(input: TrellisInput): Promise<TrellisOutput> {
  const { images, textureResolution = 1024, seed } = input

  // Use the front view as the primary image
  const primaryImage = images[0]

  console.log('[trellis] Starting 3D generation via Replicate:', {
    imageCount: images.length,
    primaryImage: primaryImage.substring(0, 80) + '...',
    textureResolution,
    seed: seed || 'random'
  })

  const startTime = Date.now()

  try {
    // Create prediction with TRELLIS model on Replicate
    console.log('[trellis] Creating Replicate prediction...')

    let prediction = await replicate.predictions.create({
      model: TRELLIS_MODEL,
      input: {
        image: primaryImage,
        seed: seed ?? Math.floor(Math.random() * 2147483647),
        texture_size: textureResolution,
        mesh_simplify: 0.95,
        generate_color: true,
        generate_model: true,
        randomize_seed: seed === undefined,
        generate_normal: true,
        ss_sampling_steps: 12,
        slat_sampling_steps: 12,
        ss_guidance_strength: 7.5,
        slat_guidance_strength: 3
      }
    })

    console.log('[trellis] Prediction created:', prediction.id, 'status:', prediction.status)

    // Wait for the prediction to complete
    prediction = await replicate.wait(prediction)

    const processingTime = (Date.now() - startTime) / 1000
    console.log('[trellis] Prediction completed:', prediction.id, 'status:', prediction.status)
    console.log('[trellis] Processing time:', processingTime.toFixed(2), 'seconds')

    if (prediction.status === 'failed') {
      throw new Error(`TRELLIS prediction failed: ${prediction.error || 'Unknown error'}`)
    }

    if (prediction.status === 'canceled') {
      throw new Error('TRELLIS prediction was canceled')
    }

    // Extract GLB URL from output
    const output = prediction.output as any
    console.log('[trellis] Raw output:', JSON.stringify(output).substring(0, 500))

    let glbUrl = ''

    // The output format from firtoz/trellis contains:
    // - model_file: the GLB file URL
    // - video: preview video
    // - color_image, normal_image: rendered views
    if (output?.model_file) {
      glbUrl = output.model_file
    } else if (typeof output === 'string' && output.endsWith('.glb')) {
      glbUrl = output
    } else if (Array.isArray(output)) {
      // Find the GLB file in the array
      const glbFile = output.find((item: any) =>
        typeof item === 'string' && item.includes('.glb')
      )
      if (glbFile) {
        glbUrl = glbFile
      }
    } else if (output && typeof output === 'object') {
      // Try to find any GLB URL in the object
      const values = Object.values(output)
      const glbValue = values.find((v: any) =>
        typeof v === 'string' && v.includes('.glb')
      )
      if (glbValue) {
        glbUrl = glbValue as string
      }
    }

    if (!glbUrl) {
      console.error('[trellis] Could not extract GLB URL from output:', JSON.stringify(output, null, 2))
      throw new Error('No GLB URL in TRELLIS response')
    }

    console.log('[trellis] GLB URL:', glbUrl.substring(0, 100) + '...')

    return {
      glbUrl,
      processingTime,
      raw: output
    }
  } catch (error: any) {
    const elapsed = (Date.now() - startTime) / 1000
    console.error('[trellis] Generation failed after', elapsed.toFixed(2), 'seconds')
    console.error('[trellis] Error details:', {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 500)
    })
    throw new Error(`TRELLIS 3D generation failed: ${error.message}`)
  }
}

/**
 * Check if TRELLIS is available via Replicate
 */
export async function checkTrellisHealth(): Promise<boolean> {
  try {
    // Just verify the model exists
    const model = await replicate.models.get('firtoz', 'trellis')
    console.log('[trellis] Health check passed - Model available:', model.name)
    return true
  } catch (error: any) {
    console.error('[trellis] Health check failed:', error.message)
    return false
  }
}

/**
 * Generate 3D model from a single image
 */
export async function generate3DFromSingleImage(
  imageUrl: string,
  options?: Omit<TrellisInput, 'images'>
): Promise<TrellisOutput> {
  return generate3DModel({
    images: [imageUrl],
    ...options
  })
}
