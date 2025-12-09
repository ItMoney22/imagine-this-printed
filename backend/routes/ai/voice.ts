import { Router, Request, Response } from 'express'
import { generateVoiceResponse, AVAILABLE_VOICES, EMOTIONS } from '../../services/voiceGenerator.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

// POST /api/ai/voice/synthesize
// Generate speech from text using Minimax Speech-02-Turbo
router.post('/synthesize', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { text, voiceId, speed, emotion } = req.body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' })
    }

    if (text.length > 10000) {
      return res.status(400).json({ error: 'Text must be less than 10,000 characters' })
    }

    req.log?.info({ textLength: text.length, voiceId }, '[voice] 🎤 Generating speech')

    const audioUrl = await generateVoiceResponse(text, {
      voiceId: voiceId || AVAILABLE_VOICES.MR_IMAGINE,
      speed: speed || 1.0,
      emotion: emotion || EMOTIONS.AUTO,
    })

    req.log?.info({ audioUrl }, '[voice] ✅ Speech generated')

    res.json({
      audioUrl,
      text,
      voiceId: voiceId || AVAILABLE_VOICES.MR_IMAGINE,
    })
  } catch (error: any) {
    req.log?.error({ error }, '[voice] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// GET /api/ai/voice/voices
// Get available voice IDs
router.get('/voices', async (req: Request, res: Response): Promise<any> => {
  res.json({
    voices: AVAILABLE_VOICES,
    emotions: EMOTIONS,
  })
})

export default router
