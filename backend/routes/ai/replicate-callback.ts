import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { supabase } from '../../lib/supabase.js'
import { uploadFromBuffer, downloadImage } from '../../utils/storage.js'

const router = Router()

// Verify Replicate webhook signature
function verifySignature(req: Request): boolean {
  const secret = process.env.AI_WEBHOOK_SECRET

  if (!secret) {
    // A missing secret must never silently disable verification in production —
    // a forged callback could mark arbitrary jobs succeeded/failed.
    if (process.env.NODE_ENV === 'production') {
      console.error('[replicate-callback] ❌ AI_WEBHOOK_SECRET not configured — rejecting webhook')
      return false
    }
    console.warn('[replicate-callback] ⚠️ AI_WEBHOOK_SECRET not configured, skipping signature verification (non-production only)')
    return true
  }

  const signature = req.headers['x-replicate-signature'] as string

  if (!signature) {
    return false
  }

  const payload = JSON.stringify(req.body)
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  const expectedSignature = hmac.digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

// POST /api/ai/replicate/callback
router.post('/callback', async (req: Request, res: Response): Promise<any> => {
  try {
    // Verify signature
    if (!verifySignature(req)) {
      req.log?.error('[replicate-callback] ❌ Invalid signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }

    const { id: predictionId, status, output, error: replicateError } = req.body

    req.log?.info({ predictionId, status, hasOutput: !!output }, '[replicate-callback] 📥 Received')

    // Find the job
    const { data: job, error: jobError } = await supabase
      .from('ai_jobs')
      .select('*')
      .eq('prediction_id', predictionId)
      .single()

    if (jobError || !job) {
      req.log?.error({ predictionId }, '[replicate-callback] ❌ Job not found')
      return res.status(404).json({ error: 'Job not found' })
    }

    if (status === 'succeeded' && output) {
      // Download image from Replicate output
      const imageUrl = Array.isArray(output) ? output[0] : output

      if (!imageUrl) {
        req.log?.error('[replicate-callback] ❌ No image URL in output')
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error: 'No image URL in output',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        return res.status(400).json({ error: 'No image URL' })
      }

      req.log?.info({ imageUrl }, '[replicate-callback] 📥 Downloading image')
      const imageBuffer = await downloadImage(imageUrl)

      // Upload to Supabase Storage
      const timestamp = Date.now()
      const kind = job.type === 'replicate_image' ? 'source' : 'mockup'
      const path = `products/${job.product_id}/${kind}-${timestamp}.png`

      const publicUrl = await uploadFromBuffer({
        bucket: process.env.ASSET_BUCKET || 'products',
        path,
        buffer: imageBuffer,
        contentType: 'image/png',
        isPublic: true,
      })

      req.log?.info({ publicUrl }, '[replicate-callback] ✅ Uploaded to storage')

      // Create product_asset record
      const { error: assetError } = await supabase
        .from('product_assets')
        .insert({
          product_id: job.product_id,
          kind,
          path,
          url: publicUrl,
          width: 1024, // TODO: Get actual dimensions
          height: 1024,
          meta: { replicate_prediction_id: predictionId },
        })

      if (assetError) {
        req.log?.error({ error: assetError }, '[replicate-callback] ❌ Asset error')
      }

      // Update job status
      await supabase
        .from('ai_jobs')
        .update({
          status: 'succeeded',
          output: { imageUrl: publicUrl },
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      // If this was the mockup job, update product images array
      if (kind === 'mockup') {
        const { data: product } = await supabase
          .from('products')
          .select('images')
          .eq('id', job.product_id)
          .single()

        const images = Array.isArray(product?.images) ? product.images : []
        images.push(publicUrl)

        await supabase
          .from('products')
          .update({ images })
          .eq('id', job.product_id)
      }

      req.log?.info({ jobId: job.id }, '[replicate-callback] ✅ Job completed')
    } else if (status === 'failed') {
      // Update job with error
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error: replicateError || 'Replicate generation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      req.log?.error({ jobId: job.id, error: replicateError }, '[replicate-callback] ❌ Job failed')
    }

    res.json({ success: true })
  } catch (error: any) {
    req.log?.error({ error }, '[replicate-callback] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

export default router
