/**
 * 3D Model Generation Client Service
 *
 * Uses Hunyuan3D-2mv on Replicate for multi-view image to 3D model generation.
 * This model accepts front, back, left, and right view images for better quality.
 *
 * Alternative: firtoz/trellis for single-image generation (faster but lower quality)
 */

import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
})

// Hunyuan3D-2mv - multi-view 3D generation (better quality with multiple angles)
const MULTIVIEW_MODEL = 'tencent/hunyuan3d-2mv' as const

// TRELLIS - single image 3D generation (fallback, faster)
const SINGLE_IMAGE_MODEL = 'firtoz/trellis' as const

export interface TrellisInput {
  images: string[] // Array of image URLs [front, back, left, right]
  meshFormat?: 'glb' | 'obj' | 'ply' | 'stl'
  textureResolution?: number // 256, 512 (octree_resolution)
  seed?: number
}

export interface TrellisOutput {
  glbUrl: string
  processingTime: number
  raw?: unknown
}

/**
 * Generate a 3D model from multi-view images using Hunyuan3D-2mv
 *
 * @param input - Input configuration with image URLs [front, back, left, right]
 * @returns GLB URL and processing metadata
 */
export async function generate3DModel(input: TrellisInput): Promise<TrellisOutput> {
  const { images, meshFormat = 'glb', textureResolution = 512, seed } = input

  // Map images to views: [front, back, left, right]
  const [frontImage, backImage, leftImage, rightImage] = images

  // Hunyuan3D-2mv supports octree_resolution of 256, 384, or 512
  // Clamp to nearest valid value
  const validResolutions = [256, 384, 512]
  const octreeResolution = validResolutions.reduce((prev, curr) =>
    Math.abs(curr - textureResolution) < Math.abs(prev - textureResolution) ? curr : prev
  )

  console.log('[3d-gen] Starting multi-view 3D generation via Hunyuan3D-2mv:', {
    imageCount: images.length,
    hasFront: !!frontImage,
    hasBack: !!backImage,
    hasLeft: !!leftImage,
    hasRight: !!rightImage,
    meshFormat,
    requestedResolution: textureResolution,
    octreeResolution,
    seed: seed || 'random'
  })

  const startTime = Date.now()

  try {
    console.log('[3d-gen] Creating Replicate prediction with Hunyuan3D-2mv...')

    // Build input with available views
    const modelInput: Record<string, any> = {
      front_image: frontImage,
      steps: 30,
      guidance_scale: 5,
      seed: seed ?? Math.floor(Math.random() * 2147483647),
      randomize_seed: seed === undefined,
      file_type: meshFormat,
      octree_resolution: octreeResolution,
      remove_background: false, // Our images already have clean backgrounds
      target_face_num: 10000
    }

    // Add optional views if available
    if (backImage) modelInput.back_image = backImage
    if (leftImage) modelInput.left_image = leftImage
    if (rightImage) modelInput.right_image = rightImage

    console.log('[3d-gen] Input views:', {
      front: frontImage?.substring(0, 60) + '...',
      back: backImage ? backImage.substring(0, 60) + '...' : 'not provided',
      left: leftImage ? leftImage.substring(0, 60) + '...' : 'not provided',
      right: rightImage ? rightImage.substring(0, 60) + '...' : 'not provided'
    })

    let prediction = await replicate.predictions.create({
      model: MULTIVIEW_MODEL,
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

    // Hunyuan3D-2mv output format - typically returns the mesh file URL directly
    if (typeof output === 'string') {
      glbUrl = output
    } else if (output?.mesh || output?.model || output?.glb) {
      glbUrl = output.mesh || output.model || output.glb
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
 * Generate 3D model from a single image using TRELLIS (faster, single-view)
 */
export async function generate3DFromSingleImage(
  imageUrl: string,
  options?: Omit<TrellisInput, 'images'>
): Promise<TrellisOutput> {
  const { meshFormat = 'glb', textureResolution = 1024, seed } = options || {}

  console.log('[3d-gen] Starting single-image 3D generation via TRELLIS:', {
    imageUrl: imageUrl.substring(0, 80) + '...',
    meshFormat,
    textureResolution,
    seed: seed || 'random'
  })

  const startTime = Date.now()

  try {
    let prediction = await replicate.predictions.create({
      model: SINGLE_IMAGE_MODEL,
      input: {
        image: imageUrl,
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

    console.log('[3d-gen] TRELLIS prediction created:', prediction.id)
    prediction = await replicate.wait(prediction)

    const processingTime = (Date.now() - startTime) / 1000
    console.log('[3d-gen] TRELLIS completed in', processingTime.toFixed(2), 'seconds')

    if (prediction.status === 'failed') {
      throw new Error(`TRELLIS failed: ${prediction.error || 'Unknown error'}`)
    }

    const output = prediction.output as any
    let glbUrl = output?.model_file || ''

    if (!glbUrl && typeof output === 'string' && output.includes('.glb')) {
      glbUrl = output
    }

    if (!glbUrl) {
      throw new Error('No GLB URL in TRELLIS response')
    }

    return { glbUrl, processingTime, raw: output }
  } catch (error: any) {
    throw new Error(`TRELLIS 3D generation failed: ${error.message}`)
  }
}

/**
 * Check if 3D generation service is available
 */
export async function checkTrellisHealth(): Promise<boolean> {
  try {
    const model = await replicate.models.get('tencent', 'hunyuan3d-2mv')
    console.log('[3d-gen] Health check passed - Hunyuan3D-2mv available:', model.name)
    return true
  } catch (error: any) {
    console.error('[3d-gen] Health check failed:', error.message)
    return false
  }
}
