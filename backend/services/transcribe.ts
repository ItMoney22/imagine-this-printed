import Replicate from 'replicate'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

// GPT-4o Transcribe model from OpenAI via Replicate
const TRANSCRIBE_MODEL = 'openai/gpt-4o-transcribe'

export interface TranscribeInput {
  audioUrl: string // Public URL to audio file (GCS, Supabase, or any publicly accessible URL)
  prompt?: string // Optional text to guide the model's style
  language?: string // Language hint (e.g., 'en', 'es', 'fr')
  temperature?: number // Sampling temperature 0-1 (default: 0)
}

export interface TranscriptResult {
  text: string // The full transcription text
  language?: string // Detected or specified language
  duration?: number // Processing duration in seconds
  raw?: unknown // Full original response for debugging
}

/**
 * Transcribe audio using OpenAI GPT-4o Transcribe via Replicate.
 *
 * Supports: mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
 *
 * @param input - Transcription input parameters
 * @returns Normalized transcript result
 */
export async function transcribeAudio(input: TranscribeInput): Promise<TranscriptResult> {
  const { audioUrl, prompt, language = 'en', temperature = 0 } = input

  console.log('[transcribe] 🎙️ Starting GPT-4o Transcribe via Replicate:', {
    model: TRANSCRIBE_MODEL,
    audioUrl: audioUrl.substring(0, 100) + '...',
    language,
    hasPrompt: !!prompt,
    temperature,
  })

  const startTime = Date.now()

  try {
    const replicateInput: Record<string, unknown> = {
      audio_file: audioUrl,
      language,
      temperature,
    }

    // Only add prompt if provided
    if (prompt) {
      replicateInput.prompt = prompt
    }

    // Run the model
    const output = await replicate.run(TRANSCRIBE_MODEL as `${string}/${string}`, {
      input: replicateInput,
    }) as unknown

    const duration = (Date.now() - startTime) / 1000
    console.log('[transcribe] ✅ GPT-4o transcription complete in', duration.toFixed(2), 'seconds')
    console.log('[transcribe] 📦 Raw output type:', typeof output)

    // Extract text from response
    // GPT-4o Transcribe returns an array of strings or a single string
    let text = ''
    if (typeof output === 'string') {
      text = output.trim()
    } else if (Array.isArray(output)) {
      text = output.join('').trim()
    } else if (output && typeof output === 'object') {
      // Check for common response formats
      const obj = output as Record<string, unknown>
      if ('text' in obj) {
        text = String(obj.text).trim()
      } else if ('transcription' in obj) {
        text = String(obj.transcription).trim()
      } else if ('output' in obj) {
        const out = obj.output
        if (typeof out === 'string') {
          text = out.trim()
        } else if (Array.isArray(out)) {
          text = out.join('').trim()
        }
      }
    }

    if (!text) {
      console.error('[transcribe] ❌ Could not extract text from output:', JSON.stringify(output, null, 2))
      throw new Error('No transcription text returned from model')
    }

    // Clean up transcription artifacts (pause markers, filler text)
    // GPT-4o Transcribe sometimes adds [pause], [2s pause], [music], etc.
    const cleanedText = text
      .replace(/\[\d*\.?\d*s?\s*pause\]/gi, '') // [pause], [2s pause], [0.5s pause]
      .replace(/\[music\]/gi, '')
      .replace(/\[applause\]/gi, '')
      .replace(/\[laughter\]/gi, '')
      .replace(/\[inaudible\]/gi, '')
      .replace(/\[crosstalk\]/gi, '')
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()

    console.log('[transcribe] 📝 Transcript:', cleanedText.substring(0, 200) + (cleanedText.length > 200 ? '...' : ''))

    return {
      text: cleanedText,
      language,
      duration,
      raw: output,
    }
  } catch (error: any) {
    console.error('[transcribe] ❌ Transcription error:', {
      message: error.message,
      status: error.status,
      details: error.response?.data,
    })
    throw new Error(`Transcription failed: ${error.message}`)
  }
}

/**
 * Transcribe audio from a local file buffer.
 * Note: This requires uploading the buffer to a public URL first.
 *
 * @param buffer - Audio file buffer
 * @param mimeType - MIME type of the audio (e.g., 'audio/webm')
 * @param options - Additional transcription options
 * @returns Normalized transcript result
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  mimeType: string,
  options?: Omit<TranscribeInput, 'audioUrl'>
): Promise<TranscriptResult> {
  // Note: Buffer needs to be uploaded to a public URL first
  // This is handled by the route that calls this function
  throw new Error('transcribeAudioBuffer requires uploading to a public URL first. Use transcribeAudio with audioUrl instead.')
}
