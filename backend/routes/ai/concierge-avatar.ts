import { Router, Request, Response } from 'express'
import { generateProductImage } from '../../services/replicate.js'

const router = Router()

// Static cache for avatar (generate once, reuse)
let cachedAvatarUrl: string | null = null

/**
 * GET /api/ai/concierge/avatar
 * Generate or retrieve cached AI concierge avatar image
 */
router.get('/avatar', async (req: Request, res: Response): Promise<any> => {
  try {
    // Return cached avatar if available
    if (cachedAvatarUrl) {
      return res.json({ avatarUrl: cachedAvatarUrl })
    }

    console.log('[concierge] 🎨 Generating AI concierge avatar...')

    // Generate professional AI concierge portrait
    const prompt = `Professional headshot portrait of a friendly female AI assistant with a warm smile, modern professional attire, studio lighting, clean white background, photorealistic, high quality, corporate photography style, approachable and professional demeanor, 4k resolution`

    const result = await generateProductImage({
      prompt,
      width: 512,
      height: 512,
    })

    // Cache the result (use first output from first model)
    // generateProductImage returns { outputs: [{ url: '...', ... }] }
    cachedAvatarUrl = result.outputs[0].url || null

    console.log('[concierge] ✅ Avatar generated and cached:', cachedAvatarUrl)

    res.json({ avatarUrl: cachedAvatarUrl })
  } catch (error: any) {
    console.error('[concierge] ❌ Error generating avatar:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
