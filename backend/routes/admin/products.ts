import express from 'express'
import multer from 'multer'
import OpenAI from 'openai'
import { uploadImageFromBuffer } from '../../services/google-cloud-storage.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
import { requireVendorOrAdmin } from '../../middleware/requireVendorOrAdmin.js'
import { renderPersonalizedPrintForProduct } from '../../services/personalization-print.js'
import { nanoid } from 'nanoid'

const router = express.Router()

// Configure multer for file uploads
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Accept images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    }
    // Accept digital files
    else if ([
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'model/stl',
      'application/octet-stream',
      'application/postscript',
      'image/vnd.adobe.photoshop',
      'image/svg+xml',
      'application/illustrator'
    ].includes(file.mimetype) || file.originalname.match(/\.(stl|pdf|zip|ai|psd|svg|eps)$/i)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type'))
    }
  }
})

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// gpt-4o is retired from OpenAI's current model + pricing pages (gpt-4
// family hard shutdown 2026-10-23). This route sends an image_url, so it
// reads the shared OPENAI_VISION_MODEL var used by services/ai-product.ts
// and routes/ai/mr-imagine-chat.ts — a future migration is a one-var change.
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reasoning models reject a non-default `temperature` and
// the legacy `max_tokens` param; they want `max_completion_tokens` instead.
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

/**
 * POST /api/admin/upload-product-image
 * Upload a product image to GCS
 */
router.post('/upload-product-image', requireAuth, requireVendorOrAdmin, upload.single('image'), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: 'No image file provided' })
    }

    const folder = req.body.folder || 'products'
    const fileId = nanoid(10)
    const extension = file.originalname.split('.').pop() || 'png'
    const destinationPath = `${folder}/${fileId}.${extension}`

    console.log('[admin/products] Uploading image:', destinationPath)

    const result = await uploadImageFromBuffer(
      file.buffer,
      destinationPath,
      file.mimetype
    )

    res.json({
      success: true,
      url: result.publicUrl,
      path: result.path
    })
  } catch (error: any) {
    console.error('[admin/products] Error uploading image:', error)
    res.status(500).json({ error: error.message || 'Failed to upload image' })
  }
})

/**
 * POST /api/admin/upload-digital-file
 * Upload a digital product file to GCS
 */
router.post('/upload-digital-file', requireAuth, requireVendorOrAdmin, upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: 'No file provided' })
    }

    const folder = req.body.folder || 'digital-products'
    const fileId = nanoid(10)
    const extension = file.originalname.split('.').pop() || 'bin'
    const destinationPath = `${folder}/${fileId}.${extension}`

    console.log('[admin/products] Uploading digital file:', destinationPath)

    const result = await uploadImageFromBuffer(
      file.buffer,
      destinationPath,
      file.mimetype
    )

    res.json({
      success: true,
      url: result.publicUrl,
      path: result.path,
      name: file.originalname,
      size: file.size
    })
  } catch (error: any) {
    console.error('[admin/products] Error uploading digital file:', error)
    res.status(500).json({ error: error.message || 'Failed to upload file' })
  }
})

/**
 * POST /api/products/ai-suggest
 * Get AI suggestions for product name and description based on an image
 */
router.post('/ai-suggest', requireAuth, async (req, res) => {
  try {
    const { imageUrl, category } = req.body

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' })
    }

    console.log('[admin/products] Getting AI suggestion for image:', imageUrl, 'category:', category)

    // Map category to friendly name
    const categoryNames: Record<string, string> = {
      'shirts': 'T-Shirts',
      'hoodies': 'Hoodies',
      'tumblers': 'Tumblers',
      'dtf-transfers': 'DTF Transfers',
      '3d-models': '3D Models'
    }
    const categoryName = categoryNames[category] || category

    const response = await openai.chat.completions.create({
      model: OPENAI_VISION_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a product naming expert for an e-commerce print shop. Generate catchy, marketable product names and compelling descriptions that highlight the design appeal.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this product image for an e-commerce print shop.
Category: ${categoryName}

Generate:
1. A catchy product name (max 60 characters) - be specific about the design theme/style
2. A compelling description (2-3 sentences) highlighting the design appeal and what makes it special

Focus on the design, style, colors, and visual appeal. Be specific about what's shown in the image.

Respond in JSON format:
{
  "suggestedName": "...",
  "suggestedDescription": "..."
}`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'low'
              }
            }
          ]
        }
      ],
      ...(isReasoningModel(OPENAI_VISION_MODEL)
        // Reasoning models bill hidden reasoning tokens against the same
        // allowance, so a 300-token budget can truncate the JSON. Triple it.
        ? { max_completion_tokens: 900 }
        : { max_tokens: 300, temperature: 0.7 }),
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from AI')
    }

    const suggestion = JSON.parse(content)

    console.log('[admin/products] AI suggestion:', suggestion)

    res.json({
      success: true,
      suggestedName: suggestion.suggestedName,
      suggestedDescription: suggestion.suggestedDescription
    })
  } catch (error: any) {
    console.error('[admin/products] Error getting AI suggestion:', error)
    res.status(500).json({ error: error.message || 'Failed to get AI suggestion' })
  }
})

// ---------------------------------------------------------------------------
// Personalization preview (2026-09-09)
//
// Zones are pixel geometry on the print file. Authoring them as four numbers
// with no way to look at the result is how you end up selling a shirt with the
// player's name printed across his face, so the admin editor renders the real
// artwork with sample text through the SAME code path a real order uses.
// ---------------------------------------------------------------------------

/** Plain-English reasons — the admin should not have to read a slug. */
const PERSONALIZATION_PREVIEW_MESSAGES: Record<string, string> = {
  'product-not-found': 'That product no longer exists.',
  'not-personalizable': 'Turn on "Let buyers personalize this" first, then save.',
  'no-zones': 'No print zones yet — add a zone for at least one field so there is somewhere to put the text.',
  'nothing-to-print': 'Type some sample text into at least one field to preview it.',
  'no-print-file': 'This product has no print file (no DTF and no design asset) to print onto.'
}

router.post('/products/:id/personalization/preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await renderPersonalizedPrintForProduct({
      productId: req.params.id,
      values: req.body?.values ?? {}
    })
    if (!result.ok) {
      // src/lib/api.ts throws `error.error` FIRST, so the human sentence has to
      // be in `error` or the admin would just see the slug 'no-zones'.
      return res.status(422).json({
        error: PERSONALIZATION_PREVIEW_MESSAGES[result.reason] || result.reason,
        reason: result.reason
      })
    }
    res.json({ url: result.url, path: result.path })
  } catch (error: any) {
    // A zone outside the artwork lands here (PersonalizationRenderError) — a
    // real setup mistake the admin needs to see, not a 500.
    console.warn('[admin/products] personalization preview failed:', error?.message)
    res.status(400).json({ error: error?.message || 'Could not render the preview', reason: 'render-failed' })
  }
})

export default router
