import express from 'express'
import multer from 'multer'
import OpenAI from 'openai'
import { uploadImageFromBuffer } from '../../services/google-cloud-storage.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
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

/**
 * POST /api/admin/upload-product-image
 * Upload a product image to GCS
 */
router.post('/upload-product-image', requireAuth, requireAdmin, upload.single('image'), async (req, res) => {
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
router.post('/upload-digital-file', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
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
      model: 'gpt-4o',
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
      max_tokens: 300,
      temperature: 0.7,
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

export default router
