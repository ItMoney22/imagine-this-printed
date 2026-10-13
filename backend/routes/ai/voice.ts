import { Router, Request, Response } from 'express'
import { generateVoiceResponse, isPersona, PERSONAS } from '../../services/voiceGenerator.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

// Per-user rate limit on TTS. Each `/synthesize` call costs real money on
// Gemini TTS (billed per second of audio), so a buggy
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
// Speak text as Mr. Imagine (default) or Mrs. Imagine (`persona: 'mrs-imagine'`), Gemini 3.8 Flash TTS
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

    const { text } = req.body
    const persona = isPersona(req.body?.persona) ? req.body.persona : 'mr-imagine'

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' })
    }

    if (text.length > 10000) {
      return res.status(400).json({ error: 'Text must be less than 10,000 characters' })
    }

    req.log?.info({ textLength: text.length, persona }, '[voice] 🎤 Generating speech')

    const audioUrl = await generateVoiceResponse(text, { persona })

    req.log?.info({ persona, bytes: audioUrl.length }, '[voice] ✅ Speech generated')

    res.json({
      audioUrl,
      text,
      persona,
    })
  } catch (error: any) {
    req.log?.error({ error }, '[voice] ❌ Error')
    res.status(500).json({ error: error.message })
  }
})

// GET /api/ai/voice/voices
// Who can speak, and in which Gemini voice
router.get('/voices', async (req: Request, res: Response): Promise<any> => {
  res.json({ personas: PERSONAS })
})

export default router
