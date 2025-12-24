/**
 * TRELLIS Client Service
 *
 * Integrates with Hugging Face TRELLIS Space (JeffreyXiang/TRELLIS) via @gradio/client
 * for converting multi-view 2D images into 3D GLB models.
 *
 * TRELLIS uses a structured latent representation for scalable 3D generation.
 */

import { Client } from '@gradio/client'

// TRELLIS HF Space configuration
const TRELLIS_SPACE = 'JeffreyXiang/TRELLIS'
const TRELLIS_TIMEOUT_MS = 300000 // 5 minutes for 3D generation

export interface TrellisInput {
  images: string[] // Array of image URLs (ideally 4 angle views)
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
 * Generate a 3D model from multi-view images using TRELLIS
 *
 * @param input - Input configuration with image URLs
 * @returns GLB URL and processing metadata
 */
export async function generate3DModel(input: TrellisInput): Promise<TrellisOutput> {
  const { images, meshFormat = 'glb', textureResolution = 1024, seed } = input

  console.log('[trellis] Starting 3D generation:', {
    imageCount: images.length,
    meshFormat,
    textureResolution,
    seed: seed || 'random'
  })

  const startTime = Date.now()

  try {
    // Connect to TRELLIS Space
    // Note: @gradio/client uses HF_TOKEN env var automatically
    const client = await Client.connect(TRELLIS_SPACE)

    console.log('[trellis] Connected to TRELLIS Space')

    // TRELLIS accepts images via the /image_to_3d endpoint
    // The Space has multiple modes - we use multi-image mode for best results
    const result = await Promise.race([
      client.predict('/image_to_3d', {
        images: images,
        output_format: meshFormat,
        texture_resolution: textureResolution,
        seed: seed ?? Math.floor(Math.random() * 2147483647)
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TRELLIS timeout')), TRELLIS_TIMEOUT_MS)
      )
    ])

    const processingTime = (Date.now() - startTime) / 1000
    console.log('[trellis] 3D generation complete in', processingTime.toFixed(2), 'seconds')

    // Extract GLB URL from result
    // TRELLIS returns file data in result.data
    const data = (result as any).data
    let glbUrl = ''

    if (Array.isArray(data)) {
      // Result is typically [glb_file_data, ...metadata]
      const fileData = data[0]
      if (typeof fileData === 'string') {
        glbUrl = fileData
      } else if (fileData?.url) {
        glbUrl = fileData.url
      } else if (fileData?.path) {
        glbUrl = fileData.path
      }
    } else if (typeof data === 'object' && data !== null) {
      glbUrl = data.url || data.path || data.output || ''
    }

    if (!glbUrl) {
      console.error('[trellis] Could not extract GLB URL from result:', JSON.stringify(data, null, 2))
      throw new Error('No GLB URL in TRELLIS response')
    }

    console.log('[trellis] GLB URL:', glbUrl.substring(0, 100) + '...')

    return {
      glbUrl,
      processingTime,
      raw: data
    }
  } catch (error: any) {
    const elapsed = (Date.now() - startTime) / 1000
    console.error('[trellis] Generation failed after', elapsed.toFixed(2), 'seconds:', {
      message: error.message,
      name: error.name
    })
    throw new Error(`TRELLIS 3D generation failed: ${error.message}`)
  }
}

/**
 * Check if TRELLIS Space is available and responsive
 */
export async function checkTrellisHealth(): Promise<boolean> {
  try {
    const client = await Client.connect(TRELLIS_SPACE)

    // Just check connection - don't run inference
    console.log('[trellis] Health check passed - Space is accessible')
    return true
  } catch (error: any) {
    console.error('[trellis] Health check failed:', error.message)
    return false
  }
}

/**
 * Alternative: Use single image mode if multi-view not available
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
