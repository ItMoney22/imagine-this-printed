import { Router, Request, Response, NextFunction } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import multer from 'multer'
import { transcribeAudio } from '../../services/transcribe.js'
import { uploadImageFromBuffer } from '../../services/google-cloud-storage.js'
import crypto from 'crypto'

const router = Router()

// Every call here pays Replicate for a transcription, and the upload lands in
// GCS. Unbounded before (no size cap, no rate limit), so a single account could
// post giant files in a loop. 12 MB is ~10 minutes of webm/opus speech.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
})

const buckets = new Map<string, number[]>()
const PER_MINUTE = Number(process.env.TRANSCRIBE_LIMIT_PER_MIN) || 20
function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = String((req as any).user?.id || req.ip)
  const windowStart = Date.now() - 60_000
  const hits = (buckets.get(key) || []).filter((t) => t > windowStart)
  if (hits.length >= PER_MINUTE) {
    res.status(429).json({ error: 'Slow down a moment — too many transcriptions in a row.' })
    return
  }
  hits.push(Date.now())
  buckets.set(key, hits)
  next()
}

// Context prompt to help the transcription model understand the domain
const TRANSCRIPTION_PROMPT = `This is a conversation about custom t-shirt and apparel design. Common topics include: design styles like streetwear, vintage, minimal, bold graphics; themes like nature, sports, abstract, floral, geometric; colors; mockup preferences; and text or typography on shirts. The speaker is describing their creative vision for a custom shirt design.`

/**
 * POST /api/ai/transcribe
 * Transcribe audio using Replicate's GPT-4o Transcribe model
 *
 * Accepts multipart/form-data with 'audio' file field.
 * Supports: mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
 *
 * Optional query params:
 * - prompt: Text to guide the model's style
 * - language: ISO-639-1 language code (e.g., 'en')
 * - temperature: Sampling temperature 0-1 (default: 0.2)
 */
router.post('/', requireAuth, rateLimit, upload.single('audio'), async (req: Request, res: Response): Promise<any> => {
  try {
    const file = (req as any).file
    if (!file) {
      return res.status(400).json({ error: 'Audio file is required' })
    }

    const { prompt, language, temperature } = req.query

    console.log('[transcribe] 🎙️ Transcribing audio with Replicate GPT-4o Transcribe:', {
      size: file.size,
      mimetype: file.mimetype,
      hasPrompt: !!prompt,
      language,
      temperature,
    })

    // Step 1: Upload audio to GCS to get a signed URL
    // (Replicate requires a publicly accessible URL)
    const fileExtension = file.mimetype.split('/')[1] || 'webm'
    const filename = `transcribe-${crypto.randomUUID()}.${fileExtension}`
    const storagePath = `audio/transcribe/${filename}`

    console.log('[transcribe] 📤 Uploading audio to GCS...')

    const { publicUrl: audioUrl } = await uploadImageFromBuffer(
      file.buffer,
      storagePath,
      file.mimetype
    )

    console.log('[transcribe] ✅ Audio uploaded:', audioUrl.substring(0, 100) + '...')

    // Step 2: Transcribe using Replicate GPT-4o
    // Use the domain-specific prompt if no custom prompt is provided
    const result = await transcribeAudio({
      audioUrl,
      prompt: (prompt as string) || TRANSCRIPTION_PROMPT,
      language: (language as string) || 'en',
      temperature: temperature ? parseFloat(temperature as string) : 0.0, // Use 0.0 for more accurate transcription
    })

    console.log('[transcribe] ✅ Transcription complete:', result.text.substring(0, 100) + '...')

    // Return response in the same format as before (backward-compatible)
    res.json({
      text: result.text,
      language: result.language,
      duration: result.duration,
    })
  } catch (error: any) {
    console.error('[transcribe] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
