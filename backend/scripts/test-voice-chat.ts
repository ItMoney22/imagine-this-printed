/**
 * Test script for voice chat system
 *
 * Usage:
 * DOTENV_CONFIG_PATH=.env npx tsx backend/scripts/test-voice-chat.ts
 */

import { generateVoiceResponse, AVAILABLE_VOICES, EMOTIONS } from '../services/voiceGenerator.js'
import { generateAssistantResponse, resetConversation } from '../services/designAssistant.js'

// Test user ID
const TEST_USER_ID = 'test-user-123'

async function testVoiceGeneration() {
  console.log('\n🧪 TEST 1: Voice Generation')
  console.log('=' .repeat(60))

  const testText = "Hi! I'm your AI design assistant. Let's create an amazing shirt design together. What style are you thinking?"

  console.log('Input text:', testText)
  console.log('')

  try {
    const audioUrl = await generateVoiceResponse(testText, {
      voiceId: AVAILABLE_VOICES.CALM_WOMAN,
      emotion: EMOTIONS.HAPPY,
      speed: 0.95,
    })

    console.log('✅ Voice generated successfully!')
    console.log('Audio URL:', audioUrl)
    console.log('')
  } catch (error: any) {
    console.error('❌ Voice generation failed:', error.message)
    process.exit(1)
  }
}

async function testConversationFlow() {
  console.log('\n🧪 TEST 2: Conversation Flow')
  console.log('=' .repeat(60))

  // Reset conversation
  resetConversation(TEST_USER_ID)

  const conversation = [
    "I want to design a shirt",
    "streetwear style",
    "with a lion",
    "black and gold",
    "yes, 'KING OF THE JUNGLE'",
    "flat lay",
    "yes, that's perfect"
  ]

  for (const userMessage of conversation) {
    console.log('\n👤 User:', userMessage)

    try {
      const response = await generateAssistantResponse(TEST_USER_ID, userMessage)

      console.log('🤖 AI:', response.text)
      console.log('📋 Next prompt:', response.nextPrompt)
      console.log('✅ Complete:', response.isComplete)

      if (response.isComplete) {
        console.log('\n🎉 Design conversation complete!')
        break
      }
    } catch (error: any) {
      console.error('❌ Error:', error.message)
      process.exit(1)
    }
  }
}

async function testFullVoiceCycle() {
  console.log('\n🧪 TEST 3: Full Voice Cycle (Text → AI → Voice)')
  console.log('=' .repeat(60))

  resetConversation(TEST_USER_ID)

  const userText = "I want a shirt with a cool dragon design"

  console.log('\n👤 User:', userText)

  try {
    // Generate AI response
    const aiResponse = await generateAssistantResponse(TEST_USER_ID, userText)
    console.log('🤖 AI text:', aiResponse.text)

    // Generate voice
    console.log('\n🎤 Generating voice...')
    const audioUrl = await generateVoiceResponse(aiResponse.text, {
      voiceId: AVAILABLE_VOICES.CALM_WOMAN,
      emotion: EMOTIONS.AUTO,
      speed: 0.95,
    })

    console.log('✅ Voice generated!')
    console.log('Audio URL:', audioUrl)
    console.log('')
    console.log('🎯 Full cycle complete!')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

async function runAllTests() {
  console.log('\n🚀 Voice Chat System Test Suite')
  console.log('=' .repeat(60))

  try {
    await testVoiceGeneration()
    await testConversationFlow()
    await testFullVoiceCycle()

    console.log('\n✅ All tests passed!')
    console.log('')
  } catch (error: any) {
    console.error('\n❌ Test suite failed:', error.message)
    process.exit(1)
  }
}

runAllTests()
