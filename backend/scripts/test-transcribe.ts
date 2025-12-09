/**
 * Test script for GPT-4o Transcribe functionality
 *
 * Usage:
 * DOTENV_CONFIG_PATH=.env npx tsx scripts/test-transcribe.ts <audio-url>
 *
 * Example:
 * DOTENV_CONFIG_PATH=.env npx tsx scripts/test-transcribe.ts https://example.com/audio.mp3
 */

import { transcribeAudio } from '../services/transcribe.js'

async function testTranscribe() {
  const audioUrl = process.argv[2]

  if (!audioUrl) {
    console.error('❌ Usage: npx tsx scripts/test-transcribe.ts <audio-url>')
    console.error('Example: npx tsx scripts/test-transcribe.ts https://example.com/audio.mp3')
    process.exit(1)
  }

  console.log('🧪 Testing GPT-4o Transcribe')
  console.log('Audio URL:', audioUrl)
  console.log('')

  try {
    const startTime = Date.now()

    const result = await transcribeAudio({
      audioUrl,
      language: 'en', // Optional: specify English
      temperature: 0.2, // Low temperature for accurate transcription
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('')
    console.log('✅ Transcription successful!')
    console.log('')
    console.log('📝 Transcript:')
    console.log(result.text)
    console.log('')
    console.log('📊 Stats:')
    console.log('- Characters:', result.text.length)
    console.log('- Words:', result.text.split(/\s+/).length)
    console.log('- Processing time:', result.duration ? `${result.duration.toFixed(2)}s` : 'N/A')
    console.log('- Total elapsed:', `${elapsed}s`)
    console.log('')
  } catch (error: any) {
    console.error('')
    console.error('❌ Transcription failed!')
    console.error('Error:', error.message)
    console.error('')
    if (error.response?.data) {
      console.error('Response data:', error.response.data)
    }
    process.exit(1)
  }
}

testTranscribe()
