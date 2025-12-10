import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { supabase } from '../lib/supabase'
import { getMrImagineAsset, MR_IMAGINE_CONFIG } from './mr-imagine/config'

// Voice chat response from backend
interface VoiceChatResponse {
  text: string
  audio_url: string
  next_prompt: string
  is_complete: boolean
  user_said: string
  processing_time: number
  ready_to_generate: boolean
  design_concept: string | null
  garment_ready: boolean
  collected_data: Record<string, any>
}

// Design action extracted from voice command
export interface DesignAction {
  type: 'add_text' | 'change_color' | 'change_template' | 'upload_image' | 'generate_ai' | 'clear_canvas' | 'download' | 'add_to_cart' | 'save_gallery' | 'none'
  params?: {
    text?: string
    color?: string
    template?: 'shirt' | 'tumbler' | 'hoodie'
    style?: string
    prompt?: string
  }
}

type MrImagineExpression = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused'

interface MrImagineVoicePanelProps {
  onDesignAction?: (action: DesignAction) => void
  onTranscript?: (text: string) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  className?: string
  welcomeMessage?: string
  contextHint?: string // e.g., "You're working on a shirt design"
}

// Mr. Imagine waist-up expressions
const EXPRESSIONS = {
  idle: '/mr-imagine/mr-imagine-waist-up.png',
  listening: '/mr-imagine/mr-imagine-waist-up-thinking.png',
  thinking: '/mr-imagine/mr-imagine-waist-up-thinking.png',
  speaking: '/mr-imagine/mr-imagine-waist-up-happy.png',
  happy: '/mr-imagine/mr-imagine-waist-up-happy.png',
  confused: '/mr-imagine/mr-imagine-waist-up-confused.png',
}

export const MrImagineVoicePanel = ({
  onDesignAction,
  onTranscript,
  isCollapsed = false,
  onToggleCollapse,
  className = '',
  welcomeMessage = "Hey! I'm Mr. Imagine, your design buddy! Click the mic and tell me what you want to create!",
  contextHint,
}: MrImagineVoicePanelProps) => {
  // State
  const [expression, setExpression] = useState<MrImagineExpression>('idle')
  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState(welcomeMessage)
  const [error, setError] = useState<string | null>(null)
  const [hasPlayedWelcome, setHasPlayedWelcome] = useState(false)

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Update expression based on state
  useEffect(() => {
    if (isSpeaking) {
      setExpression('speaking')
    } else if (isListening) {
      setExpression('listening')
    } else if (isProcessing) {
      setExpression('thinking')
    } else {
      setExpression('idle')
    }
  }, [isSpeaking, isListening, isProcessing])

  // Play welcome message on mount
  useEffect(() => {
    if (!hasPlayedWelcome && !isCollapsed) {
      const welcomeAudio = new Audio('/mr-imagine/audio/welcome.mp3')
      welcomeAudio.volume = 0.5
      welcomeAudio.play().catch(() => {
        // Auto-play blocked, that's okay
        console.log('[MrImagineVoicePanel] Auto-play blocked for welcome audio')
      })
      setHasPlayedWelcome(true)
    }
  }, [hasPlayedWelcome, isCollapsed])

  // Audio level visualization
  const updateAudioLevel = useCallback(() => {
    if (analyserRef.current && isListening) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteFrequencyData(dataArray)
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length
      setAudioLevel(average / 255)
      animationRef.current = requestAnimationFrame(updateAudioLevel)
    }
  }, [isListening])

  // Start recording
  const startRecording = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Set up audio analyser
      audioContextRef.current = new AudioContext()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      const analyser = audioContextRef.current.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await processVoiceInput(audioBlob)
        stream.getTracks().forEach(track => track.stop())
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current)
        }
        setAudioLevel(0)
      }

      mediaRecorder.start()
      setIsListening(true)
      updateAudioLevel()

      // Play ding sound
      const ding = new Audio('/mr-imagine/audio/ding.mp3')
      ding.volume = 0.3
      ding.play().catch(() => {})

    } catch (err) {
      console.error('[MrImagineVoicePanel] Microphone error:', err)
      setError('Could not access microphone. Please check permissions.')
      setExpression('confused')
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop()
      setIsListening(false)
      setIsProcessing(true)
    }
  }

  // Toggle mic
  const toggleMic = () => {
    if (isListening) {
      stopRecording()
    } else if (!isProcessing && !isSpeaking) {
      startRecording()
    }
  }

  // Process voice input and get response
  const processVoiceInput = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob)

      // Add context hint to help AI understand the design context
      if (contextHint) {
        formData.append('context', contextHint)
      }

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        throw new Error('Please log in to use voice features')
      }

      console.log('[MrImagineVoicePanel] Sending audio to voice-chat API...')

      const { data } = await axios.post<VoiceChatResponse>('/api/ai/voice-chat', formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      })

      console.log('[MrImagineVoicePanel] Response:', {
        userSaid: data.user_said,
        aiResponse: data.text?.substring(0, 50) + '...',
      })

      // Update state
      setTranscript(data.user_said)
      setResponse(data.text)

      // Notify parent of transcript
      if (onTranscript) {
        onTranscript(data.user_said)
      }

      // Parse for design actions
      const action = parseDesignAction(data.user_said, data.text)
      if (action.type !== 'none' && onDesignAction) {
        onDesignAction(action)
      }

      // Play audio response
      if (data.audio_url && audioRef.current) {
        setIsSpeaking(true)
        audioRef.current.src = data.audio_url
        await audioRef.current.play()
      }

      setExpression('happy')
    } catch (err: any) {
      console.error('[MrImagineVoicePanel] Error:', err)
      setError(err.response?.data?.error || err.message || 'Something went wrong. Please try again.')
      setExpression('confused')
      setResponse("Oops! I had trouble understanding that. Can you try again?")
    } finally {
      setIsProcessing(false)
    }
  }

  // Parse user input for design actions
  const parseDesignAction = (userSaid: string, aiResponse: string): DesignAction => {
    const lower = userSaid.toLowerCase()

    // Add text commands
    if (lower.includes('add text') || lower.includes('write') || lower.includes('type')) {
      // Try to extract the text to add
      const textMatch = lower.match(/(?:add text|write|type)\s*[:\-]?\s*["']?(.+?)["']?$/i)
      return {
        type: 'add_text',
        params: { text: textMatch?.[1] || '' }
      }
    }

    // Color changes
    if (lower.includes('change color') || lower.includes('make it')) {
      const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'pink', 'orange', 'black', 'white', 'gray']
      const foundColor = colors.find(c => lower.includes(c))
      if (foundColor) {
        return {
          type: 'change_color',
          params: { color: foundColor }
        }
      }
    }

    // Template changes
    if (lower.includes('shirt') || lower.includes('t-shirt')) {
      return { type: 'change_template', params: { template: 'shirt' } }
    }
    if (lower.includes('hoodie') || lower.includes('sweatshirt')) {
      return { type: 'change_template', params: { template: 'hoodie' } }
    }
    if (lower.includes('tumbler') || lower.includes('cup') || lower.includes('mug')) {
      return { type: 'change_template', params: { template: 'tumbler' } }
    }

    // AI generation
    if (lower.includes('generate') || lower.includes('create') || lower.includes('make me') || lower.includes('ai')) {
      const promptMatch = lower.match(/(?:generate|create|make me)\s*(?:an?\s*)?(?:image of|picture of|design of)?\s*(.+)/i)
      return {
        type: 'generate_ai',
        params: { prompt: promptMatch?.[1] || userSaid }
      }
    }

    // Upload
    if (lower.includes('upload') || lower.includes('add image') || lower.includes('add picture')) {
      return { type: 'upload_image' }
    }

    // Clear
    if (lower.includes('clear') || lower.includes('start over') || lower.includes('reset')) {
      return { type: 'clear_canvas' }
    }

    // Download
    if (lower.includes('download') || lower.includes('save to computer')) {
      return { type: 'download' }
    }

    // Add to cart
    if (lower.includes('add to cart') || lower.includes('buy') || lower.includes('purchase')) {
      return { type: 'add_to_cart' }
    }

    // Save to gallery
    if (lower.includes('save') || lower.includes('gallery') || lower.includes('keep')) {
      return { type: 'save_gallery' }
    }

    return { type: 'none' }
  }

  // Handle audio ended
  const handleAudioEnded = () => {
    setIsSpeaking(false)
    setExpression('happy')
  }

  // Collapsed view
  if (isCollapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className={`fixed right-4 bottom-4 z-50 w-16 h-16 rounded-full bg-primary shadow-lg hover:scale-110 transition-transform ${className}`}
        title="Talk to Mr. Imagine"
      >
        <img
          src="/mr-imagine/mr-imagine-head.png"
          alt="Mr. Imagine"
          className="w-full h-full object-cover rounded-full"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/itp-logo-v3.png'
          }}
        />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse" />
      </button>
    )
  }

  return (
    <div className={`flex flex-col bg-card border border-primary/30 rounded-xl shadow-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-secondary">
        <div className="flex items-center gap-2">
          <img
            src="/mr-imagine/mr-imagine-head.png"
            alt="Mr. Imagine"
            className="w-8 h-8 rounded-full"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/itp-logo-v3.png'
            }}
          />
          <span className="text-white font-semibold">Mr. Imagine</span>
        </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="text-white/80 hover:text-white p-1"
            title="Minimize"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Avatar */}
      <div className="relative flex justify-center p-4 bg-bg/50">
        <div className="relative">
          <img
            src={EXPRESSIONS[expression]}
            alt={`Mr. Imagine - ${expression}`}
            className="w-32 h-32 object-contain transition-transform duration-300"
            style={{
              transform: isSpeaking ? 'scale(1.05)' : 'scale(1)',
              filter: `drop-shadow(0 0 10px ${MR_IMAGINE_CONFIG.style.glowColor})`
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/itp-logo-v3.png'
            }}
          />
          {/* Audio level indicator */}
          {isListening && (
            <div
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-1 bg-primary rounded-full transition-all duration-100"
              style={{ width: `${audioLevel * 100}%`, maxWidth: '100px' }}
            />
          )}
        </div>
      </div>

      {/* Response bubble */}
      <div className="px-4 pb-3">
        <div className="bg-card/80 border border-primary/20 rounded-lg p-3 max-h-32 overflow-y-auto">
          <p className="text-text text-sm">
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <span className="animate-pulse">Thinking</span>
                <span className="flex gap-1">
                  <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </span>
            ) : response}
          </p>
        </div>
      </div>

      {/* Transcript */}
      {transcript && (
        <div className="px-4 pb-3">
          <p className="text-muted text-xs">
            You said: "{transcript}"
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 pb-3">
          <p className="text-red-500 text-xs">{error}</p>
        </div>
      )}

      {/* Mic button */}
      <div className="flex justify-center p-4 border-t border-primary/20">
        <button
          onClick={toggleMic}
          disabled={isProcessing}
          className={`
            relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300
            ${isListening
              ? 'bg-red-500 hover:bg-red-600 animate-pulse'
              : isProcessing
                ? 'bg-gray-500 cursor-wait'
                : 'bg-primary hover:bg-primary/80 hover:scale-105'
            }
          `}
          title={isListening ? 'Stop recording' : 'Start talking'}
        >
          {isListening ? (
            // Stop icon
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : isProcessing ? (
            // Loading spinner
            <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            // Mic icon
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}

          {/* Audio level ring */}
          {isListening && (
            <div
              className="absolute inset-0 rounded-full border-4 border-white/50"
              style={{
                transform: `scale(${1 + audioLevel * 0.3})`,
                opacity: 0.5 + audioLevel * 0.5
              }}
            />
          )}
        </button>
      </div>

      {/* Quick tips */}
      <div className="px-4 pb-4">
        <p className="text-muted text-xs text-center">
          Try saying: "Add text Hello World" or "Generate a cool dragon"
        </p>
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        className="hidden"
      />
    </div>
  )
}

export default MrImagineVoicePanel
