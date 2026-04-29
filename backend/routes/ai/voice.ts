import { Router, Request, Response } from 'express'
import { generateVoiceResponse, AVAILABLE_VOICES, EMOTIONS } from '../../services/voiceGenerator.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

// Per-user rate limit on TTS. Each `/synthesize` call costs real money on
// Replicate/MiniMax (per-character billing on the upstream), so a buggy
// retry loop or a logged-in attacker hammering the endpoint racks up bills
// fast. 30 requests / minute / user is well above any legit conversational
// flow (Mr. Imagine voice replies are at most a few per minute) and below
// what could do meaningful damage before alerting fires. In-memory is fine
// at our scale; restart-clearing the window is acceptable for a soft cap.
const ttsRateLimit = new Map<string, { count: number; resetAt: number }>()
const TTS_LIMIT = 30
const TTS_WINDOW_MS = 60_000

function checkTtsLimit(userId: string): boolean {
  const now = Date.now()
  const state = ttsRateLimit.get(userId)
  if (!state || state.resetAt < now) {
    ttsRateLimit.set(userId, { count: 1, resetAt: now + TTS_WINDOW_MS })
    return true
  }
  if (state.count >= TTS_LIMIT) return false
  state.count++
  return true
}

// POST /api/ai/voice/synthesize
// Generate speech from text using Minimax Speech-02-Turbo
router.post('/synthesize', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!checkTtsLimit(userId)) {
      return res.status(429).json({
        error: `Too many TTS requests. Try again in a moment (limit: ${TTS_LIMIT}/min).`
      })
    }

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
