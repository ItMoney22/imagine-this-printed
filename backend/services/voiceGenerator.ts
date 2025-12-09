import Replicate from 'replicate'
import { uploadFromBuffer } from '../utils/storage.js'
import crypto from 'crypto'

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
})

// Minimax Speech-02-Turbo configuration
const VOICE_MODEL = 'minimax/speech-02-turbo'

// Available voice IDs (system voices from Minimax API)
export const AVAILABLE_VOICES = {
  // Brand Avatar - Mr. Imagine (Custom cloned voice)
  MR_IMAGINE: 'moss_audio_737a299c-734a-11f0-918f-4e0486034804',

  // Female voices
  WISE_WOMAN: 'Wise_Woman',
  CALM_WOMAN: 'Calm_Woman',
  SWEET_GIRL: 'Sweet_Girl_2',
  LOVELY_GIRL: 'Lovely_Girl',
  LIVELY_GIRL: 'Lively_Girl',
  INSPIRATIONAL_GIRL: 'Inspirational_girl',
  EXUBERANT_GIRL: 'Exuberant_Girl',
  ABBESS: 'Abbess',

  // Male voices
  DEEP_VOICE_MAN: 'Deep_Voice_Man',
  PATIENT_MAN: 'Patient_Man',
  DETERMINED_MAN: 'Determined_Man',
  ELEGANT_MAN: 'Elegant_Man',
  CASUAL_GUY: 'Casual_Guy',
  DECENT_BOY: 'Decent_Boy',

  // Neutral/Young
  FRIENDLY_PERSON: 'Friendly_Person',
  YOUNG_KNIGHT: 'Young_Knight',
  IMPOSING_MANNER: 'Imposing_Manner',
} as const

// Available emotions
export const EMOTIONS = {
  AUTO: 'auto', // Let AI detect emotion from text
  HAPPY: 'happy',
  SAD: 'sad',
  ANGRY: 'angry',
  FEARFUL: 'fearful',
  DISGUSTED: 'disgusted',
  SURPRISED: 'surprised',
  CALM: 'calm',
  FLUENT: 'fluent',
  NEUTRAL: 'neutral',
} as const

export interface VoiceGenerationOptions {
  voiceId?: string // Default: Wise_Woman
  emotion?: string // Default: auto
  languageBoost?: string // Default: English
  englishNormalization?: boolean // Default: true
  pitch?: number // -12 to +12 semitones (default: 0)
  speed?: number // 0.5 to 2.0 (default: 1.0)
  volume?: number // 0 to 10 (default: 1.0)
  sampleRate?: number // Default: 32000
  audioFormat?: 'mp3' | 'wav' | 'flac' | 'pcm' // Default: mp3
  bitrate?: number // For MP3: 32000, 64000, 128000, 256000 (default: 128000)
  channel?: 'mono' | 'stereo' // Default: mono
  subtitleEnable?: boolean // Return timestamp metadata (default: false)
}

/**
 * Generate speech audio using Minimax Speech-02-Turbo
 *
 * Usage:
 * const audioUrl = await generateVoiceResponse("Hello! How can I help you design a shirt today?", {
 *   voiceId: AVAILABLE_VOICES.CALM_FEMALE,
 *   emotion: EMOTIONS.HAPPY,
 * })
 *
 * @param text - Text to convert to speech (max 10,000 characters). Use <#0.5#> for 0.5s pauses.
 * @param options - Voice generation options
 * @returns URL to the generated audio file (MP3 by default)
 */
export async function generateVoiceResponse(
  text: string,
  options: VoiceGenerationOptions = {}
): Promise<string> {
  const {
    voiceId = AVAILABLE_VOICES.MR_IMAGINE, // Default: Mr. Imagine brand avatar voice
    emotion = EMOTIONS.AUTO, // Let AI detect emotion
    languageBoost = 'English',
    englishNormalization = true,
    pitch = 0,
    speed = 1.0,
    volume = 1.0,
    sampleRate = 32000,
    audioFormat = 'mp3',
    bitrate = 128000,
    channel = 'mono',
    subtitleEnable = false,
  } = options

  // Validate text length
  if (text.length > 10000) {
    throw new Error('Text exceeds maximum length of 10,000 characters')
  }

  console.log('[voice] 🎤 Generating speech with Minimax Speech-02-Turbo:', {
    textLength: text.length,
    textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
    voiceId,
    emotion,
    speed,
  })

  try {
    const input = {
      text,
      voice_id: voiceId,
      emotion,
      language_boost: languageBoost,
      english_normalization: englishNormalization,
      pitch,
      speed,
      volume,
      sample_rate: sampleRate,
      audio_format: audioFormat,
      bitrate,
      channel,
      subtitle_enable: subtitleEnable,
    }

    // Use replicate.run() for synchronous execution with "Prefer: wait"
    const output = await replicate.run(VOICE_MODEL as any, { input })

    console.log('[voice] 📦 Raw Replicate output type:', typeof output)
    console.log('[voice] 📦 Output constructor:', output?.constructor?.name)

    // Output structure from Minimax Speech-02-Turbo via Replicate SDK:
    // - FileOutput object with .url() method that returns the actual URL
    // - A string URL directly (older API versions)
    // - An object with audio_file/url/output property
    let audioUrl: string

    if (typeof output === 'string') {
      audioUrl = output
    } else if (output && output.constructor?.name === 'FileOutput') {
      // FileOutput from Replicate SDK - call .url() to get the actual URL
      console.log('[voice] 📦 FileOutput detected, extracting URL...')
      const fileOutput = output as any

      // FileOutput has a url() method that returns a URL object (not string!)
      if (typeof fileOutput.url === 'function') {
        const urlResult = fileOutput.url()
        // url() returns a URL object, need to extract href property
        if (urlResult && typeof urlResult === 'object' && urlResult.href) {
          audioUrl = urlResult.href
          console.log('[voice] ✅ Got URL href from FileOutput:', audioUrl)
        } else if (typeof urlResult === 'string') {
          audioUrl = urlResult
          console.log('[voice] ✅ Got URL string from FileOutput:', audioUrl)
        } else {
          // Try toString() as fallback
          audioUrl = String(urlResult)
          console.log('[voice] ⚠️ Converted URL to string:', audioUrl)
        }
      } else if (fileOutput.href) {
        // Direct href access
        audioUrl = fileOutput.href
        console.log('[voice] ✅ Got href directly:', audioUrl)
      } else if (typeof fileOutput.url === 'string') {
        audioUrl = fileOutput.url
      } else {
        // Try to get the URL by converting to string or accessing href
        audioUrl = fileOutput.href || fileOutput.toString()
        console.log('[voice] ⚠️ Fallback URL extraction:', audioUrl)
      }
    } else if (output && typeof output === 'object') {
      // Check for common output formats
      if ('audio_file' in output) {
        audioUrl = (output as any).audio_file
      } else if (typeof (output as any).url === 'function') {
        // Handle any object with a url() method
        audioUrl = (output as any).url()
      } else if ('url' in output) {
        audioUrl = (output as any).url
      } else if ('output' in output) {
        audioUrl = (output as any).output
      } else if (Array.isArray(output) && output.length > 0) {
        audioUrl = output[0]
      } else {
        // Try to stringify and log for debugging
        console.error('[voice] ❌ Unexpected output format:', JSON.stringify(output, null, 2))
        throw new Error('Unexpected output format from voice model')
      }
    } else {
      throw new Error('Invalid output from voice model')
    }

    // Validate that we got an actual URL string
    if (typeof audioUrl !== 'string' || !audioUrl.startsWith('http')) {
      console.error('[voice] ❌ Invalid audioUrl:', audioUrl)
      throw new Error('Failed to extract valid audio URL from Replicate output')
    }

    console.log('[voice] ✅ Speech generated:', {
      audioUrl: typeof audioUrl === 'string' ? audioUrl.substring(0, 100) + '...' : audioUrl,
      format: audioFormat,
      voiceId,
    })

    return audioUrl
  } catch (error: any) {
    console.error('[voice] ❌ Speech generation failed:', {
      message: error.message,
      status: error.status,
      details: error.response?.data,
    })
    throw new Error(`Voice generation failed: ${error.message}`)
  }
}

/**
 * Detect emotion from text content for more expressive speech
 */
function detectEmotionFromText(text: string): string {
  const lowerText = text.toLowerCase()

  // Happy/excited indicators
  if (lowerText.match(/love|awesome|amazing|great|perfect|wonderful|fantastic|excellent|ooh|wow|yes!/)) {
    return EMOTIONS.HAPPY
  }

  // Thinking/contemplative indicators
  if (lowerText.match(/hmm|let me think|interesting|consider|perhaps|maybe/)) {
    return EMOTIONS.CALM
  }

  // Surprised indicators
  if (lowerText.match(/oh!|wow!|really\?|that's incredible|no way/)) {
    return EMOTIONS.SURPRISED
  }

  // Default to auto for natural variation
  return EMOTIONS.AUTO
}

/**
 * Generate conversational response with natural pauses
 * If the text already contains Minimax pause markers <#X.X#>, use as-is
 * Otherwise, add pauses at sentence boundaries
 */
export async function generateConversationalResponse(
  text: string,
  options: VoiceGenerationOptions = {}
): Promise<string> {
  // Check if text already contains Minimax pause markers
  const hasPauseMarkers = text.includes('<#')

  let textWithPauses = text

  // Only add pauses if GPT didn't include them
  if (!hasPauseMarkers) {
    textWithPauses = text
      .replace(/\. /g, '.<#0.3#> ') // Short pause after statements
      .replace(/\? /g, '?<#0.5#> ') // Longer pause after questions
      .replace(/! /g, '!<#0.4#> ') // Medium pause after exclamations
  }

  // Auto-detect emotion if set to AUTO
  const emotion = options.emotion === EMOTIONS.AUTO
    ? detectEmotionFromText(text)
    : (options.emotion || EMOTIONS.AUTO)

  return generateVoiceResponse(textWithPauses, {
    ...options,
    emotion,
    speed: options.speed || 0.95, // Slightly slower for clarity
  })
}
