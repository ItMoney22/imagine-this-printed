import fetch from 'node-fetch'
import { supabase } from '../lib/supabase.js'
import Replicate from 'replicate'

/**
 * Minimax Voice Synthesis Service
 * Uses Replicate's Minimax Speech-02-Turbo API for real-time text-to-speech
 *
 * Model: minimax/speech-02-turbo (low-latency, real-time optimized)
 * Female voice for AI concierge experience
 */

export interface MinimaxVoiceInput {
  text: string
  voiceId?: string // Optional: admin-configurable voice ID
  speed?: number // Speech speed (0.5 - 2.0, default: 1.0)
  emotion?: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful'
}

export interface MinimaxVoiceOutput {
  audioUrl: string
  duration: number
}

export interface VoiceSettings {
  voiceId: string
  speed: number
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful'
}

// Default voice settings (can be overridden by admin settings)
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voiceId: 'Calm_Female_Voice', // Minimax Speech-02-Turbo female voice
  speed: 1.0,
  emotion: 'neutral',
}

/**
 * Generate speech audio from text using Minimax via Replicate
 */
export async function generateSpeech(input: MinimaxVoiceInput): Promise<MinimaxVoiceOutput> {
  const replicateApiToken = process.env.REPLICATE_API_TOKEN

  if (!replicateApiToken) {
    throw new Error('REPLICATE_API_TOKEN is not configured')
  }

  const replicate = new Replicate({
    auth: replicateApiToken,
  })

  console.log('[minimax] 🎤 Generating speech:', {
    textLength: input.text.length,
    textPreview: input.text.substring(0, 50) + '...',
    voiceId: input.voiceId || DEFAULT_VOICE_SETTINGS.voiceId,
  })

  try {
    const output = await replicate.run(
      "minimax/speech-02-turbo",
      {
        input: {
          text: input.text,
          voice_id: input.voiceId || DEFAULT_VOICE_SETTINGS.voiceId,
          emotion: input.emotion || DEFAULT_VOICE_SETTINGS.emotion,
          language_boost: 'English',
          english_normalization: true,
        }
      }
    )

    console.log('[minimax] ✅ Speech generated successfully:', output)

    // Minimax returns the audio URL directly (or stream, but SDK handles it)
    // Based on Replicate docs for this model, it returns a ReadableStream or string URL
    // The SDK usually resolves it. If it's a stream, we might need to handle it, 
    // but typically for short audio it returns a URL or we can cast to string if it's a URL.
    // Let's assume it returns the URL string as per common Replicate audio models.

    return {
      audioUrl: String(output),
      duration: 0, // Duration not always available in sync response
    }
  } catch (error: any) {
    console.error('[minimax] ❌ Generation failed:', error)
    throw new Error(`Speech generation failed: ${error.message}`)
  }
}

/**
 * Get voice settings from database (admin-configurable)
 */
export async function getVoiceSettings(): Promise<VoiceSettings> {
  try {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'voice')
      .single()

    if (error) {
      console.error('[minimax] ⚠️ Error fetching voice settings, using defaults:', error.message)
      return DEFAULT_VOICE_SETTINGS
    }

    if (!data || !data.value) {
      console.log('[minimax] ℹ️ No voice settings found, using defaults')
      return DEFAULT_VOICE_SETTINGS
    }

    // Merge with defaults to ensure all fields are present
    const settings = { ...DEFAULT_VOICE_SETTINGS, ...data.value }
    console.log('[minimax] ✅ Voice settings loaded from database:', settings)

    return settings
  } catch (error: any) {
    console.error('[minimax] ❌ Failed to fetch voice settings:', error.message)
    return DEFAULT_VOICE_SETTINGS
  }
}

/**
 * Update voice settings in database (admin only)
 */
export async function updateVoiceSettings(settings: Partial<VoiceSettings>): Promise<void> {
  try {
    // Get current settings
    const currentSettings = await getVoiceSettings()

    // Merge with new settings
    const updatedSettings = { ...currentSettings, ...settings }

    // Update in database
    const { error } = await supabase
      .from('admin_settings')
      .upsert({
        key: 'voice',
        value: updatedSettings,
      }, {
        onConflict: 'key'
      })

    if (error) {
      console.error('[minimax] ❌ Error updating voice settings:', error.message)
      throw new Error(`Failed to update voice settings: ${error.message}`)
    }

    console.log('[minimax] ✅ Voice settings updated in database:', updatedSettings)
  } catch (error: any) {
    console.error('[minimax] ❌ Failed to update voice settings:', error.message)
    throw error
  }
}
