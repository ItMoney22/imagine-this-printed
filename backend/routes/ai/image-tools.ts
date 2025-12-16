import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import Replicate from 'replicate'

const router = Router()

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

/**
 * POST /api/ai/upscale
 * Upscale an image using Real-ESRGAN model
 *
 * Note: ITC deduction should be handled by the client BEFORE calling this endpoint
 */
router.post('/upscale', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { image_url, scale = 4 } = req.body

    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required' })
    }

    console.log('[image-tools] 🔍 Upscaling image:', {
      url: image_url.substring(0, 50) + '...',
      scale
    })

    // Use Real-ESRGAN for upscaling
    const output = await replicate.run(
      'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
      {
        input: {
          image: image_url,
          scale: scale,
          face_enhance: false,
        }
      }
    )

    console.log('[image-tools] ✅ Upscale complete:', output)

    res.json({
      ok: true,
      upscaled_url: output,
      original_url: image_url,
      scale
    })
  } catch (error: any) {
    console.error('[image-tools] ❌ Upscale error:', error)
    res.status(500).json({ error: error.message || 'Failed to upscale image' })
  }
})

/**
 * POST /api/ai/remove-background
 * Remove background using rembg model
 *
 * Note: ITC deduction should be handled by the client BEFORE calling this endpoint
 */
router.post('/remove-background', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { image_url } = req.body

    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required' })
    }

    console.log('[image-tools] ✂️ Removing background:', image_url.substring(0, 50) + '...')

    // Use rembg for background removal
    const output = await replicate.run(
      'cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003',
      {
        input: {
          image: image_url,
        }
      }
    )

    console.log('[image-tools] ✅ Background removal complete:', output)

    res.json({
      ok: true,
      result_url: output,
      original_url: image_url,
    })
  } catch (error: any) {
    console.error('[image-tools] ❌ Background removal error:', error)
    res.status(500).json({ error: error.message || 'Failed to remove background' })
  }
})

/**
 * POST /api/ai/enhance
 * Enhance image quality using AI
 */
router.post('/enhance', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { image_url } = req.body

    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required' })
    }

    console.log('[image-tools] ✨ Enhancing image:', image_url.substring(0, 50) + '...')

    // Use GFPGAN for face/image enhancement
    const output = await replicate.run(
      'tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d976b2f0896856a3',
      {
        input: {
          img: image_url,
          version: 'v1.4',
          scale: 2,
        }
      }
    )

    console.log('[image-tools] ✅ Enhancement complete:', output)

    res.json({
      ok: true,
      enhanced_url: output,
      original_url: image_url,
    })
  } catch (error: any) {
    console.error('[image-tools] ❌ Enhancement error:', error)
    res.status(500).json({ error: error.message || 'Failed to enhance image' })
  }
})

export default router
