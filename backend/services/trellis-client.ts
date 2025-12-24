/**
 * 3D Model Generation Client Service
 *
 * Uses firtoz/trellis on Replicate for multi-view image to 3D model generation.
 * This model accepts an array of images for multi-view 3D generation.
 *
 * For single-image generation, use tencent/hunyuan3d-2 (faster but single view only)
 */

import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
})

// TRELLIS - multi-view 3D generation (supports images array)
// Using version hash for predictions.create API
const TRELLIS_VERSION = 'firtoz/trellis:e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c' as const

// Hunyuan3D-2 - single image 3D generation (higher quality but single view)
const HUNYUAN_VERSION = 'tencent/hunyuan3d-2:b1b9449a1277e10402781c5d41eb30c0a0683504fb23fab591ca9dfc2aabe1cb' as const

export interface TrellisInput {
  images: string[] // Array of image URLs [front, back, left, right]
  meshFormat?: 'glb' | 'obj' | 'ply' | 'stl'
  textureResolution?: number // 512-2048 (texture_size)
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
 * @param input - Input configuration with image URLs [front, back, left, right]
 * @returns GLB URL and processing metadata
 */
export async function generate3DModel(input: TrellisInput): Promise<TrellisOutput> {
  const { images, textureResolution = 1024, seed } = input

  // Filter out undefined/null images
  const validImages = images.filter(img => img && typeof img === 'string')

  console.log('[3d-gen] Starting multi-view 3D generation via TRELLIS:', {
    imageCount: validImages.length,
    images: validImages.map(img => img.substring(0, 60) + '...'),
    textureResolution,
    seed: seed || 'random'
  })

  const startTime = Date.now()

  try {
    console.log('[3d-gen] Creating Replicate prediction with TRELLIS...')

    // TRELLIS accepts an images array for multi-view generation
    const modelInput: Record<string, any> = {
      images: validImages,
      seed: seed ?? Math.floor(Math.random() * 2147483647),
      randomize_seed: seed === undefined,
      texture_size: textureResolution,
      mesh_simplify: 0.95,
      generate_color: true,
      generate_model: true, // Required to get GLB output
      generate_normal: false,
      ss_sampling_steps: 12,
      slat_sampling_steps: 12,
      ss_guidance_strength: 7.5,
      slat_guidance_strength: 3
    }

    console.log('[3d-gen] TRELLIS input:', {
      imageCount: validImages.length,
      texture_size: textureResolution,
      generate_model: true
    })

    let prediction = await replicate.predictions.create({
      version: TRELLIS_VERSION,
      input: modelInput
    })

    console.log('[3d-gen] Prediction created:', prediction.id, 'status:', prediction.status)

    // Wait for the prediction to complete
    prediction = await replicate.wait(prediction)

    const processingTime = (Date.now() - startTime) / 1000
    console.log('[3d-gen] Prediction completed:', prediction.id, 'status:', prediction.status)
    console.log('[3d-gen] Processing time:', processingTime.toFixed(2), 'seconds')

    if (prediction.status === 'failed') {
      throw new Error(`3D generation failed: ${prediction.error || 'Unknown error'}`)
    }

    if (prediction.status === 'canceled') {
      throw new Error('3D generation was canceled')
    }

    // Extract GLB URL from output
    const output = prediction.output as any
    console.log('[3d-gen] Raw output:', JSON.stringify(output).substring(0, 500))

    let glbUrl = ''

    // TRELLIS output format - model_file contains the GLB URL
    if (output?.model_file) {
      glbUrl = output.model_file
    } else if (typeof output === 'string' && output.includes('.glb')) {
      glbUrl = output
    } else if (Array.isArray(output)) {
      // Find the mesh file in the array
      const meshFile = output.find((item: any) =>
        typeof item === 'string' && (
          item.includes('.glb') ||
          item.includes('.obj') ||
          item.includes('.ply') ||
          item.includes('.stl')
        )
      )
      if (meshFile) {
        glbUrl = meshFile
      }
    } else if (output && typeof output === 'object') {
      // Try to find any mesh URL in the object
      const values = Object.values(output)
      const meshValue = values.find((v: any) =>
        typeof v === 'string' && (
          v.includes('.glb') ||
          v.includes('.obj') ||
          v.includes('.ply') ||
          v.includes('.stl')
        )
      )
      if (meshValue) {
        glbUrl = meshValue as string
      }
    }

    if (!glbUrl) {
      console.error('[3d-gen] Could not extract mesh URL from output:', JSON.stringify(output, null, 2))
      throw new Error('No mesh URL in 3D generation response')
    }

    console.log('[3d-gen] Mesh URL:', glbUrl.substring(0, 100) + '...')

    return {
      glbUrl,
      processingTime,
      raw: output
    }
  } catch (error: any) {
    const elapsed = (Date.now() - startTime) / 1000
    console.error('[3d-gen] Generation failed after', elapsed.toFixed(2), 'seconds')
    console.error('[3d-gen] Error details:', {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 500)
    })
    throw new Error(`3D generation failed: ${error.message}`)
  }
}

/**
 * Generate 3D model from a single image using Hunyuan3D-2 (higher quality single-view)
 */
export async function generate3DFromSingleImage(
  imageUrl: string,
  options?: Omit<TrellisInput, 'images'>
): Promise<TrellisOutput> {
  const { textureResolution = 512, seed } = options || {}

  // Hunyuan3D-2 supports octree_resolution of 256, 384, or 512
  const validResolutions = [256, 384, 512]
  const octreeResolution = validResolutions.reduce((prev, curr) =>
    Math.abs(curr - textureResolution) < Math.abs(prev - textureResolution) ? curr : prev
  )

  console.log('[3d-gen] Starting single-image 3D generation via Hunyuan3D-2:', {
    imageUrl: imageUrl.substring(0, 80) + '...',
    octreeResolution,
    seed: seed || 'random'
  })

  const startTime = Date.now()

  try {
    let prediction = await replicate.predictions.create({
      version: HUNYUAN_VERSION,
      input: {
        image: imageUrl,
        steps: 50,
        guidance_scale: 5.5,
        seed: seed ?? 1234,
        octree_resolution: octreeResolution,
        remove_background: true
      }
    })

    console.log('[3d-gen] Hunyuan3D-2 prediction created:', prediction.id)
    prediction = await replicate.wait(prediction)

    const processingTime = (Date.now() - startTime) / 1000
    console.log('[3d-gen] Hunyuan3D-2 completed in', processingTime.toFixed(2), 'seconds')

    if (prediction.status === 'failed') {
      throw new Error(`Hunyuan3D-2 failed: ${prediction.error || 'Unknown error'}`)
    }

    const output = prediction.output as any
    console.log('[3d-gen] Hunyuan3D-2 output:', JSON.stringify(output).substring(0, 300))

    // Hunyuan3D-2 returns the mesh URL directly or in output.mesh
    let glbUrl = ''
    if (typeof output === 'string') {
      glbUrl = output
    } else if (output?.mesh) {
      glbUrl = output.mesh
    }

    if (!glbUrl) {
      throw new Error('No GLB URL in Hunyuan3D-2 response')
    }

    return { glbUrl, processingTime, raw: output }
  } catch (error: any) {
    throw new Error(`Hunyuan3D-2 3D generation failed: ${error.message}`)
  }
}

/**
 * Check if 3D generation service is available
 */
export async function checkTrellisHealth(): Promise<boolean> {
  try {
    const model = await replicate.models.get('firtoz', 'trellis')
    console.log('[3d-gen] Health check passed - TRELLIS available:', model.name)
    return true
  } catch (error: any) {
    console.error('[3d-gen] Health check failed:', error.message)
    return false
  }
}
