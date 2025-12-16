import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import multer from 'multer'
import { transcribeAudio } from '../../services/transcribe.js'
import { uploadFromBuffer } from '../../utils/storage.js'
import { generateConversationalResponse, AVAILABLE_VOICES, EMOTIONS } from '../../services/voiceGenerator.js'
import { generateAssistantResponse, resetConversation, getDesignData, setGeneratedDesigns, setConversationStep, getConversationStep } from '../../services/designAssistant.js'
import { generateProductImage } from '../../services/replicate.js'
import { buildDTFPrompt } from '../../services/dtf-optimizer.js'
import crypto from 'crypto'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

/**
 * POST /api/ai/voice-chat
 *
 * Real-time voice assistant endpoint
 *
 * Flow:
 * 1. User speaks (audio uploaded)
 * 2. Transcribe using GPT-4o (Replicate)
 * 3. Generate AI text response
 * 4. Convert response to speech (Minimax Speech-02-Turbo)
 * 5. Return text + audio URL + next prompt
 *
 * Response format:
 * {
 *   "text": "Great! What style are you thinking?",
 *   "audio_url": "https://replicate.delivery/...",
 *   "next_prompt": "What style are you thinking?",
 *   "is_complete": false,
 *   "ready_to_generate": false,
 *   "design_concept": null
 * }
 */
router.post('/', requireAuth, upload.single('audio'), async (req: Request, res: Response): Promise<any> => {
  const startTime = Date.now()

  try {
    const file = (req as any).file
    const userId = (req as any).user?.sub || (req as any).user?.id

    if (!file) {
      return res.status(400).json({ error: 'Audio file is required' })
    }

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' })
    }

    console.log('[voice-chat] 🎙️ Processing voice input:', {
      userId,
      audioSize: file.size,
      mimetype: file.mimetype,
    })

    // STEP 1: Upload audio to Supabase Storage
    const fileExtension = file.mimetype.split('/')[1] || 'webm'
    const filename = `voice-chat-${crypto.randomUUID()}.${fileExtension}`
    const storagePath = `audio/${filename}`

    console.log('[voice-chat] 📤 Uploading audio...')
    const audioUrl = await uploadFromBuffer({
      bucket: 'products',
      path: storagePath,
      buffer: file.buffer,
      contentType: file.mimetype,
      isPublic: true,
    })

    // STEP 2: Transcribe using GPT-4o
    console.log('[voice-chat] 🎧 Transcribing with GPT-4o...')
    const transcriptionResult = await transcribeAudio({
      audioUrl,
      language: 'en',
      temperature: 0.2,
    })

    const userText = transcriptionResult.text
    console.log('[voice-chat] ✅ Transcription:', userText)

    // STEP 3: Generate AI response
    console.log('[voice-chat] 🤖 Generating AI response...')
    const aiResponse = await generateAssistantResponse(userId, userText)

    console.log('[voice-chat] ✅ AI response:', {
      text: aiResponse.text.substring(0, 100) + '...',
      step: aiResponse.nextPrompt,
      complete: aiResponse.isComplete,
      readyToGenerate: aiResponse.readyToGenerate,
    })

    // STEP 4: Generate voice audio (Mr. Imagine - brand mascot voice)
    console.log('[voice-chat] 🎤 Generating Mr. Imagine voice response...')
    const voiceUrl = await generateConversationalResponse(aiResponse.text, {
      voiceId: AVAILABLE_VOICES.MR_IMAGINE,
      emotion: EMOTIONS.AUTO,
      speed: 0.95, // Slightly slower for clarity
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log('[voice-chat] ✅ Complete voice turn in', elapsed, 'seconds')

    // Clean up display text - remove pause markers meant for voice synthesis
    // These markers like <#0.3#> are for TTS natural pauses but shouldn't show in UI
    const displayText = aiResponse.text
      .replace(/<#[\d.]+#>/g, '') // Remove pause markers like <#0.3#>, <#0.5#>, etc.
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim()

    // STEP 5: Return complete response with new fields
    res.json({
      text: displayText,
      audio_url: voiceUrl,
      next_prompt: aiResponse.nextPrompt,
      is_complete: aiResponse.isComplete,
      user_said: userText,
      processing_time: parseFloat(elapsed),
      // NEW fields for design flow
      ready_to_generate: aiResponse.readyToGenerate || false,
      design_concept: aiResponse.designConcept || null,
      garment_ready: aiResponse.garmentReady || false,
      collected_data: aiResponse.collectedData || {},
    })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/ai/voice-chat/generate-designs
 *
 * Generate 3 design options using multi-model AI (Imagen, Flux, Lucid)
 * Called when readyToGenerate is true
 */
router.post('/generate-designs', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.sub || (req as any).user?.id
    const { designConcept, shirtColor = 'black' } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' })
    }

    if (!designConcept) {
      return res.status(400).json({ error: 'Design concept is required' })
    }

    console.log('[voice-chat] 🎨 Generating 3 design options:', {
      userId,
      conceptPreview: designConcept.substring(0, 100) + '...',
      shirtColor,
    })

    // Build DTF-optimized prompt
    const dtfPrompt = buildDTFPrompt(designConcept, shirtColor, 'clean')

    console.log('[voice-chat] 📝 DTF prompt built:', dtfPrompt.substring(0, 200) + '...')

    // Generate from all 3 models in parallel
    const result = await generateProductImage({
      prompt: dtfPrompt,
      shirtColor: shirtColor,
      printStyle: 'clean',
    })

    console.log('[voice-chat] ✅ Multi-model generation complete:', {
      totalOutputs: result.outputs.length,
      succeeded: result.outputs.filter((o: any) => o.status === 'succeeded').length,
    })

    // Store generated designs in conversation state
    setGeneratedDesigns(userId, result.outputs)

    // Return the generated designs
    res.json({
      success: true,
      designs: result.outputs,
      message: 'Designs generated successfully',
    })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Design generation error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/ai/voice-chat/select-design
 *
 * User selects one of the 3 generated designs
 */
router.post('/select-design', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.sub || (req as any).user?.id
    const { designIndex } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' })
    }

    if (designIndex === undefined || designIndex < 0 || designIndex > 2) {
      return res.status(400).json({ error: 'Design index must be 0, 1, or 2' })
    }

    console.log('[voice-chat] ✅ Design selected:', { userId, designIndex })

    // The design selection is handled through the conversation flow
    // This endpoint is for explicit selection from the UI

    res.json({
      success: true,
      selectedIndex: designIndex,
      message: 'Design selected successfully',
    })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Design selection error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/ai/voice-chat/reset
 *
 * Reset conversation for the current user
 */
router.post('/reset', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.sub || (req as any).user?.id

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' })
    }

    resetConversation(userId)

    console.log('[voice-chat] 🔄 Conversation reset for user:', userId)

    res.json({ message: 'Conversation reset successfully' })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Reset error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/ai/voice-chat/design-data
 *
 * Get current design data collected during conversation
 */
router.get('/design-data', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.sub || (req as any).user?.id

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' })
    }

    const designData = getDesignData(userId)
    const currentStep = getConversationStep(userId)

    console.log('[voice-chat] 📊 Design data requested:', { userId, step: currentStep })

    res.json({
      designData,
      currentStep,
    })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Error fetching design data:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/ai/voice-chat/set-step
 *
 * Manually set conversation step (for UI triggers)
 */
router.post('/set-step', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.sub || (req as any).user?.id
    const { step } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' })
    }

    const validSteps = ['greeting', 'exploring', 'refining', 'confirm_design', 'generating', 'select_design', 'garment_options', 'final_confirm', 'complete']
    if (!validSteps.includes(step)) {
      return res.status(400).json({ error: 'Invalid step', validSteps })
    }

    setConversationStep(userId, step)

    console.log('[voice-chat] 📍 Step manually set:', { userId, step })

    res.json({
      success: true,
      step,
    })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Error setting step:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/ai/voice-chat/test
 *
 * Test endpoint - send text and get back audio instantly (no transcription)
 */
router.post('/test', async (req: Request, res: Response): Promise<any> => {
  try {
    const { text } = req.body

    if (!text) {
      return res.status(400).json({ error: 'Text is required' })
    }

    console.log('[voice-chat] 🧪 Test Mr. Imagine voice generation:', text.substring(0, 50) + '...')

    const audioUrl = await generateConversationalResponse(text, {
      voiceId: AVAILABLE_VOICES.MR_IMAGINE,
      emotion: EMOTIONS.AUTO,
    })

    console.log('[voice-chat] ✅ Test voice generated:', audioUrl)

    res.json({
      text,
      audio_url: audioUrl,
      message: 'Voice generated successfully',
    })
  } catch (error: any) {
    console.error('[voice-chat] ❌ Test error:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
