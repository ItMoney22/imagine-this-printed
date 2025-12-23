import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'
import { supabase } from '../lib/supabase'

interface GeneratedDesign {
    modelId: string
    modelName: string
    imageUrl?: string
    status: 'pending' | 'succeeded' | 'failed'
    error?: string
}

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

interface VoiceConversationEnhancedProps {
    onTextInput: (text: string) => void
    onVoiceResponse?: (response: VoiceChatResponse) => void
    onDesignsGenerated?: (designs: GeneratedDesign[]) => void
    onDesignSelected?: (designIndex: number) => void
    onConversationStart?: () => void  // Called when mic is first activated
    autoMicOn?: boolean
    conversationalMode?: boolean
    textToSpeak?: string
    className?: string
    mrImagineState?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused'
    showVideoBeforeConversation?: boolean  // Show design video until mic is clicked
}

// Mr. Imagine expressions mapped to images
const MR_IMAGINE_EXPRESSIONS = {
    idle: '/mr-imagine/mr-imagine-waist-up.png',
    listening: '/mr-imagine/mr-imagine-waist-up-thinking.png',
    thinking: '/mr-imagine/mr-imagine-waist-up-thinking.png',
    speaking: '/mr-imagine/mr-imagine-waist-up-happy.png',
    happy: '/mr-imagine/mr-imagine-waist-up-happy.png',
    confused: '/mr-imagine/mr-imagine-waist-up-confused.png',
}

export const VoiceConversationEnhanced = ({
    onTextInput,
    onVoiceResponse,
    onDesignsGenerated,
    onDesignSelected,
    onConversationStart,
    autoMicOn = false,
    conversationalMode = true,
    textToSpeak,
    className,
    mrImagineState: externalState,
    showVideoBeforeConversation = false
}: VoiceConversationEnhancedProps) => {
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [isListening, setIsListening] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isGeneratingDesigns, setIsGeneratingDesigns] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [aiResponse, setAiResponse] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [currentExpression, setCurrentExpression] = useState<keyof typeof MR_IMAGINE_EXPRESSIONS>('idle')
    const [audioLevel, setAudioLevel] = useState(0)
    const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([])
    const [selectedMicId, setSelectedMicId] = useState<string>('')
    const [showMicSelector, setShowMicSelector] = useState(false)
    const [generatedDesigns, setGeneratedDesigns] = useState<GeneratedDesign[]>([])
    const [selectedDesignIndex, setSelectedDesignIndex] = useState<number | null>(null)
    const [designConcept, setDesignConcept] = useState<string | null>(null)
    const [conversationStep, setConversationStep] = useState<string>('greeting')
    const [hasStartedConversation, setHasStartedConversation] = useState(false)  // Track if mic has been used
    const [selectedShirtColor, setSelectedShirtColor] = useState<'black' | 'white' | 'gray'>('black')
    const [selectedPrintStyle, setSelectedPrintStyle] = useState<'clean' | 'halftone' | 'grunge'>('clean')
    const [videoEnded, setVideoEnded] = useState(false) // Track if intro video has finished playing
    const [videoNeedsInteraction, setVideoNeedsInteraction] = useState(true) // Video always needs user click to play with sound
    const audioRef = useRef<HTMLAudioElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animationRef = useRef<number | null>(null)

    // Load available microphones on mount
    useEffect(() => {
        const loadMicrophones = async () => {
            try {
                // Request permission first to get device labels
                await navigator.mediaDevices.getUserMedia({ audio: true })
                    .then(stream => stream.getTracks().forEach(track => track.stop()))

                const devices = await navigator.mediaDevices.enumerateDevices()
                const mics = devices.filter(device => device.kind === 'audioinput')
                setAvailableMics(mics)

                // Set default mic if not already set
                if (!selectedMicId && mics.length > 0) {
                    // Try to find a non-webcam mic (usually has "Microphone" in name)
                    const preferredMic = mics.find(mic =>
                        mic.label.toLowerCase().includes('microphone') &&
                        !mic.label.toLowerCase().includes('webcam') &&
                        !mic.label.toLowerCase().includes('camera')
                    ) || mics[0]
                    setSelectedMicId(preferredMic.deviceId)
                }

                console.log('[VoiceConversation] 🎤 Available microphones:', mics.map(m => m.label))
            } catch (err) {
                console.error('[VoiceConversation] Failed to enumerate devices:', err)
            }
        }
        loadMicrophones()
    }, [])

    // Update expression based on external state or internal state
    useEffect(() => {
        if (externalState) {
            setCurrentExpression(externalState)
        } else if (isSpeaking) {
            setCurrentExpression('speaking')
        } else if (isListening) {
            setCurrentExpression('listening')
        } else if (isProcessing) {
            setCurrentExpression('thinking')
        } else {
            setCurrentExpression('idle')
        }
    }, [externalState, isSpeaking, isListening, isProcessing])

    // Auto-activate mic on mount
    useEffect(() => {
        if (autoMicOn && !isListening) {
            setTimeout(() => {
                handleToggleMic()
            }, 2000) // Give user time to see the interface
        }
    }, [autoMicOn])

    // Handle manual video play (browsers block autoplay with sound, so always show play button)
    const handlePlayVideo = () => {
        if (videoRef.current) {
            videoRef.current.muted = false
            videoRef.current.play()
            setVideoNeedsInteraction(false)
        }
    }

    // Audio level visualization
    const updateAudioLevel = () => {
        if (analyserRef.current) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
            analyserRef.current.getByteFrequencyData(dataArray)
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length
            setAudioLevel(average / 255)
        }
        if (isListening) {
            animationRef.current = requestAnimationFrame(updateAudioLevel)
        }
    }

    const startRecording = async () => {
        try {
            // Use selected microphone or default
            const audioConstraints: MediaTrackConstraints = selectedMicId
                ? { deviceId: { exact: selectedMicId } }
                : {}

            console.log('[VoiceConversation] 🎤 Starting recording with mic:', selectedMicId || 'default')

            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

            // Set up audio analyser for visualization
            const audioContext = new AudioContext()
            const source = audioContext.createMediaStreamSource(stream)
            const analyser = audioContext.createAnalyser()
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
                await handleTranscription(audioBlob)
                stream.getTracks().forEach(track => track.stop())
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current)
                }
                setAudioLevel(0)
            }

            mediaRecorder.start()
            setIsListening(true)
            setError(null)
            updateAudioLevel()
        } catch (err) {
            console.error('Error accessing microphone:', err)
            setError('Could not access microphone. Please check permissions.')
            setIsListening(false)
            setCurrentExpression('confused')
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && isListening) {
            mediaRecorderRef.current.stop()
            setIsListening(false)
            setIsProcessing(true)
        }
    }

    const handleTranscription = async (audioBlob: Blob) => {
        try {
            const formData = new FormData()
            formData.append('audio', audioBlob)

            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) throw new Error('Authentication required')

            console.log('[VoiceConversation] 🎤 Sending audio to voice-chat API...')

            // Use the full voice-chat endpoint for conversational flow
            // Note: Don't set Content-Type for FormData - browser sets it automatically with boundary
            const response = await api.post('/api/ai/voice-chat', formData)
            const data = response.data as VoiceChatResponse

            console.log('[VoiceConversation] ✅ Voice chat response:', {
                userSaid: data.user_said,
                aiResponse: data.text?.substring(0, 50) + '...',
                readyToGenerate: data.ready_to_generate,
                designConcept: data.design_concept?.substring(0, 30),
            })

            // Update state with response
            setTranscript(data.user_said)
            setAiResponse(data.text)
            onTextInput(data.user_said)

            // Notify parent of full response
            if (onVoiceResponse) {
                onVoiceResponse(data)
            }

            // Play Mr. Imagine's audio response
            if (data.audio_url && audioRef.current) {
                setIsSpeaking(true)
                setCurrentExpression('speaking')
                audioRef.current.src = data.audio_url
                await audioRef.current.play()
            }

            // Store design concept if ready to generate
            if (data.ready_to_generate && data.design_concept) {
                setDesignConcept(data.design_concept)
                console.log('[VoiceConversation] 🎨 Ready to generate designs!')
                // Automatically trigger design generation
                await generateDesigns(data.design_concept)
            }

            setCurrentExpression('happy')
        } catch (err: any) {
            console.error('[VoiceConversation] ❌ Voice chat error:', err)
            setError('I had trouble understanding that. Please try again.')
            setCurrentExpression('confused')
        } finally {
            setIsProcessing(false)
        }
    }

    // Generate 3 designs from multiple AI models
    const generateDesigns = useCallback(async (concept: string) => {
        setIsGeneratingDesigns(true)
        setCurrentExpression('thinking')

        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) throw new Error('Authentication required')

            console.log('[VoiceConversation] 🎨 Generating 3 design options...')

            const { data } = await api.post('/api/ai/voice-chat/generate-designs', {
                designConcept: concept,
                shirtColor: 'black', // Default, will be selected later
            })

            console.log('[VoiceConversation] ✅ Designs generated:', data.designs?.length)

            setGeneratedDesigns(data.designs || [])
            setConversationStep('select_design')

            // Notify parent
            if (onDesignsGenerated) {
                onDesignsGenerated(data.designs || [])
            }

            setCurrentExpression('happy')
        } catch (err: any) {
            console.error('[VoiceConversation] ❌ Design generation error:', err)
            setError('Failed to generate designs. Please try again.')
            setCurrentExpression('confused')
        } finally {
            setIsGeneratingDesigns(false)
        }
    }, [onDesignsGenerated])

    // Handle design selection
    const handleDesignSelect = useCallback(async (index: number) => {
        setSelectedDesignIndex(index)

        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) throw new Error('Authentication required')

            await api.post('/api/ai/voice-chat/select-design', {
                designIndex: index,
                shirtColor: selectedShirtColor,
                printStyle: selectedPrintStyle
            })

            console.log('[VoiceConversation] ✅ Design selected:', index, 'Color:', selectedShirtColor, 'Style:', selectedPrintStyle)

            // Notify parent
            if (onDesignSelected) {
                onDesignSelected(index)
            }

            // Move to garment options step
            setConversationStep('garment_options')
        } catch (err: any) {
            console.error('[VoiceConversation] ❌ Design selection error:', err)
        }
    }, [onDesignSelected, selectedShirtColor, selectedPrintStyle])

    // Reset conversation
    const resetConversation = useCallback(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (token) {
                await api.post('/api/ai/voice-chat/reset', {})
            }

            setTranscript('')
            setAiResponse('')
            setGeneratedDesigns([])
            setSelectedDesignIndex(null)
            setDesignConcept(null)
            setConversationStep('greeting')
            setSelectedShirtColor('black')
            setSelectedPrintStyle('clean')
            setError(null)

            console.log('[VoiceConversation] 🔄 Conversation reset')
        } catch (err: any) {
            console.error('[VoiceConversation] ❌ Reset error:', err)
        }
    }, [])

    const handleToggleMic = () => {
        if (isListening) {
            stopRecording()
        } else {
            // First time starting conversation - stop video, switch to images
            if (!hasStartedConversation) {
                setHasStartedConversation(true)
                if (videoRef.current) {
                    videoRef.current.pause()
                }
            }
            // Notify parent that conversation is starting (for stopping intro video etc.)
            onConversationStart?.()
            startRecording()
        }
    }

    // Synthesize speech from text using Mr. Imagine's custom voice
    const speak = async (text: string) => {
        setIsSpeaking(true)
        setCurrentExpression('speaking')
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) {
                throw new Error('Authentication required')
            }

            console.log('[VoiceConversation] 🎤 Requesting Mr. Imagine voice synthesis...')

            const { data } = await api.post('/api/ai/voice/synthesize', { text })

            console.log('[VoiceConversation] ✅ Voice response received:', data.audioUrl?.substring(0, 50) + '...')

            if (audioRef.current && data.audioUrl) {
                audioRef.current.src = data.audioUrl
                await audioRef.current.play()
            } else {
                console.error('[VoiceConversation] ❌ No audio URL in response')
                setIsSpeaking(false)
                setCurrentExpression('confused')
            }
        } catch (err: any) {
            console.error('[VoiceConversation] ❌ Speech synthesis error:', err)
            // Show error state instead of falling back to robotic browser TTS
            setError('Voice synthesis unavailable. Please try again.')
            setIsSpeaking(false)
            setCurrentExpression('confused')
        }
    }

    // Auto-speak effect
    useEffect(() => {
        if (textToSpeak) {
            speak(textToSpeak)
        }
    }, [textToSpeak])

    // Spacebar to toggle recording
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only trigger on spacebar, not when typing in an input
            if (e.code === 'Space' &&
                !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
                e.preventDefault()
                handleToggleMic()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isListening]) // Depend on isListening to get current toggle state

    const handleAudioEnded = () => {
        setIsSpeaking(false)
        setCurrentExpression('happy')
        setTimeout(() => setCurrentExpression('idle'), 2000)
    }

    return (
        <div className={`relative flex flex-col items-center px-2 sm:px-0 ${className}`}>
            {/* Mr. Imagine Character - Theatrical Presentation */}
            <div className="relative mb-4 sm:mb-8">
                {/* Ambient glow behind character */}
                <div
                    className={`absolute inset-0 rounded-full blur-3xl transition-all duration-700 ${isSpeaking
                        ? 'bg-gradient-to-t from-purple-500/40 via-pink-500/30 to-transparent scale-125'
                        : isListening
                            ? 'bg-gradient-to-t from-blue-500/40 via-purple-500/30 to-transparent scale-110 animate-pulse'
                            : 'bg-gradient-to-t from-purple-500/20 via-transparent to-transparent scale-100'
                        }`}
                    style={{ transform: 'translateY(20%)' }}
                />

                {/* Sound wave rings when listening */}
                {isListening && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div
                            className="absolute w-full h-full rounded-full border-2 border-purple-400/30 animate-ping"
                            style={{ animationDuration: '1.5s', transform: `scale(${1 + audioLevel * 0.3})` }}
                        />
                        <div
                            className="absolute w-full h-full rounded-full border border-blue-400/20 animate-ping"
                            style={{ animationDuration: '2s', animationDelay: '0.5s' }}
                        />
                    </div>
                )}

                {/* Mr. Imagine Video (before conversation) or Image (after conversation starts or video ends) */}
                <div className="relative z-10">
                    {showVideoBeforeConversation && !hasStartedConversation && !videoEnded ? (
                        <div className="relative">
                            <video
                                ref={videoRef}
                                src="/mr-imagine/design-video.mp4"
                                playsInline
                                onEnded={() => setVideoEnded(true)}
                                className="w-48 sm:w-72 h-auto rounded-2xl drop-shadow-2xl transition-transform duration-500"
                                style={{
                                    filter: 'drop-shadow(0 0 30px rgba(147, 51, 234, 0.4))'
                                }}
                            />
                            {/* Play button overlay when autoplay is blocked */}
                            {videoNeedsInteraction && (
                                <button
                                    onClick={handlePlayVideo}
                                    className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl hover:bg-black/30 transition-colors"
                                >
                                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white/90 flex items-center justify-center shadow-xl">
                                        <svg className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </div>
                                </button>
                            )}
                        </div>
                    ) : (
                        <img
                            src={MR_IMAGINE_EXPRESSIONS[currentExpression]}
                            alt="Mr. Imagine"
                            className={`w-40 sm:w-64 h-auto drop-shadow-2xl transition-transform duration-500 ${isSpeaking ? 'animate-subtle-bob' :
                                isListening ? 'scale-105' :
                                    'hover:scale-105'
                                }`}
                            style={{
                                filter: isSpeaking ? 'drop-shadow(0 0 30px rgba(147, 51, 234, 0.5))' : 'drop-shadow(0 10px 30px rgba(0,0,0,0.3))'
                            }}
                        />
                    )}
                </div>

                {/* Speech bubble when speaking */}
                {isSpeaking && (
                    <div className="absolute -top-4 -right-4 bg-white rounded-2xl px-4 py-2 shadow-xl animate-fade-in z-20">
                        <div className="flex items-center gap-2">
                            <span className="flex gap-1">
                                <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </span>
                        </div>
                        <div className="absolute -bottom-2 left-6 w-4 h-4 bg-white transform rotate-45" />
                    </div>
                )}
            </div>

            {/* Status Message */}
            <div className="text-center mb-4 sm:mb-6 min-h-[50px] sm:min-h-[60px] px-4">
                <p className={`font-serif text-lg sm:text-2xl transition-all duration-300 ${isListening ? 'text-purple-600' :
                    isProcessing ? 'text-blue-600' :
                        isGeneratingDesigns ? 'text-pink-600' :
                            isSpeaking ? 'text-purple-700' :
                                'text-gray-700'
                    }`}>
                    {isListening ? "I'm all ears..." :
                        isProcessing ? "Let me think..." :
                            isGeneratingDesigns ? "Creating design..." :
                                isSpeaking ? "Here's what I think..." :
                                    conversationStep === 'select_design' ? "Pick your favorite!" :
                                        "Tap the mic to talk!"}
                </p>
                {isListening && (
                    <p className="text-xs sm:text-sm text-gray-500 mt-1 animate-pulse">Tap again when done</p>
                )}
                {isGeneratingDesigns && (
                    <p className="text-xs sm:text-sm text-gray-500 mt-1 animate-pulse">Creating with Flux AI...</p>
                )}
            </div>

            {/* Main Microphone Button */}
            <button
                onClick={handleToggleMic}
                disabled={isProcessing || isSpeaking}
                className={`relative group transition-all duration-300 ${isProcessing || isSpeaking ? 'cursor-not-allowed opacity-70' : ''
                    }`}
            >
                {/* Outer glow ring */}
                <div className={`absolute inset-0 rounded-full transition-all duration-500 ${isListening
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 blur-xl opacity-60 scale-150 animate-pulse'
                    : 'bg-purple-500/20 blur-lg opacity-0 group-hover:opacity-100 scale-125'
                    }`} />

                {/* Button circle - smaller on mobile */}
                <div className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isListening
                    ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-2xl shadow-purple-500/50 scale-110'
                    : isProcessing
                        ? 'bg-gradient-to-br from-blue-400 to-purple-500 shadow-lg'
                        : 'bg-white shadow-xl border-2 border-purple-100 group-hover:border-purple-300 group-hover:shadow-2xl group-hover:shadow-purple-200/50'
                    }`}>
                    {isListening ? (
                        <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                    ) : isProcessing ? (
                        <div className="w-6 h-6 sm:w-8 sm:h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <svg className="w-8 h-8 sm:w-10 sm:h-10 text-purple-500 group-hover:text-purple-600 transition-colors" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        </svg>
                    )}
                </div>

                {/* Audio level indicator ring */}
                {isListening && (
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle
                            cx="50"
                            cy="50"
                            r="46"
                            fill="none"
                            stroke="rgba(255,255,255,0.3)"
                            strokeWidth="4"
                        />
                        <circle
                            cx="50"
                            cy="50"
                            r="46"
                            fill="none"
                            stroke="white"
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={`${audioLevel * 290} 290`}
                            className="transition-all duration-100"
                        />
                    </svg>
                )}
            </button>

            {/* Transcript display */}
            {transcript && !isListening && !isProcessing && (
                <div className="mt-4 sm:mt-6 w-full max-w-md animate-fade-in">
                    <div className="bg-purple-50 border border-purple-100 rounded-xl sm:rounded-2xl p-3 sm:p-4">
                        <p className="text-xs text-purple-500 font-medium uppercase tracking-wider mb-1">You said:</p>
                        <p className="text-gray-800 text-sm sm:text-lg leading-relaxed">{transcript}</p>
                    </div>
                </div>
            )}

            {/* AI Response display */}
            {aiResponse && !isListening && !isProcessing && (
                <div className="mt-3 sm:mt-4 w-full max-w-md animate-fade-in">
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-xl sm:rounded-2xl p-3 sm:p-4">
                        <p className="text-xs text-purple-600 font-medium uppercase tracking-wider mb-1">Mr. Imagine:</p>
                        <p className="text-gray-800 text-sm sm:text-base leading-relaxed">{aiResponse}</p>
                    </div>
                </div>
            )}

            {/* Generated Design - Single Design Display */}
            {generatedDesigns.length > 0 && conversationStep === 'select_design' && (
                <div className="mt-6 sm:mt-8 w-full max-w-md animate-fade-in">
                    <h3 className="text-center font-serif text-lg sm:text-xl text-gray-800 mb-3 sm:mb-4">Your Design</h3>

                    {/* Single Design Display */}
                    {generatedDesigns[0] && (
                        <div className="flex justify-center mb-4 sm:mb-6">
                            <div className="relative bg-white rounded-xl sm:rounded-2xl overflow-hidden shadow-xl w-48 h-48 sm:w-64 sm:h-64">
                                {generatedDesigns[0].status === 'succeeded' && generatedDesigns[0].imageUrl ? (
                                    <img
                                        src={generatedDesigns[0].imageUrl}
                                        alt="Your design"
                                        className="w-full h-full object-cover"
                                    />
                                ) : generatedDesigns[0].status === 'pending' ? (
                                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                                        <div className="w-8 h-8 border-4 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                                    </div>
                                ) : (
                                    <div className="w-full h-full bg-red-50 flex items-center justify-center">
                                        <span className="text-red-400 text-sm">Generation failed</span>
                                    </div>
                                )}
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                                    <p className="text-white text-xs font-medium">Flux 1.1 Pro Ultra</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Select Options */}
                    {generatedDesigns[0]?.status === 'succeeded' && (
                        <div className="space-y-4 sm:space-y-5">
                            {/* Shirt Color Selection */}
                            <div>
                                <p className="text-xs sm:text-sm text-gray-600 text-center mb-2">Shirt Color</p>
                                <div className="flex justify-center gap-2 sm:gap-3">
                                    <button
                                        onClick={() => setSelectedShirtColor('black')}
                                        className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black border-3 sm:border-4 transition-all shadow-md ${
                                            selectedShirtColor === 'black'
                                                ? 'border-purple-500 ring-2 ring-purple-300 scale-110'
                                                : 'border-gray-300 hover:border-purple-400'
                                        }`}
                                        title="Black"
                                    />
                                    <button
                                        onClick={() => setSelectedShirtColor('white')}
                                        className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border-3 sm:border-4 transition-all shadow-md ${
                                            selectedShirtColor === 'white'
                                                ? 'border-purple-500 ring-2 ring-purple-300 scale-110'
                                                : 'border-gray-300 hover:border-purple-400'
                                        }`}
                                        title="White"
                                    />
                                    <button
                                        onClick={() => setSelectedShirtColor('gray')}
                                        className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-400 border-3 sm:border-4 transition-all shadow-md ${
                                            selectedShirtColor === 'gray'
                                                ? 'border-purple-500 ring-2 ring-purple-300 scale-110'
                                                : 'border-gray-300 hover:border-purple-400'
                                        }`}
                                        title="Gray"
                                    />
                                </div>
                            </div>

                            {/* Print Style Selection */}
                            <div>
                                <p className="text-xs sm:text-sm text-gray-600 text-center mb-2">Print Style</p>
                                <div className="flex justify-center gap-1.5 sm:gap-2">
                                    <button
                                        onClick={() => setSelectedPrintStyle('clean')}
                                        className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                                            selectedPrintStyle === 'clean'
                                                ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        Clean
                                    </button>
                                    <button
                                        onClick={() => setSelectedPrintStyle('halftone')}
                                        className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                                            selectedPrintStyle === 'halftone'
                                                ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        Halftone
                                    </button>
                                    <button
                                        onClick={() => setSelectedPrintStyle('grunge')}
                                        className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                                            selectedPrintStyle === 'grunge'
                                                ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                    >
                                        Grunge
                                    </button>
                                </div>
                            </div>

                            {/* Continue Button */}
                            <div className="flex justify-center pt-1 sm:pt-2">
                                <button
                                    onClick={() => handleDesignSelect(0)}
                                    className="px-6 sm:px-8 py-2.5 sm:py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all text-sm sm:text-base"
                                >
                                    Use This Design
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Design Generation Progress */}
            {isGeneratingDesigns && (
                <div className="mt-8 w-full max-w-xs animate-fade-in">
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-2xl p-6">
                        <div className="flex items-center justify-center gap-3 mb-4">
                            <div className="w-8 h-8 border-4 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                            <span className="text-purple-700 font-medium">Creating design...</span>
                        </div>
                        <div className="flex justify-center">
                            <div className="text-center">
                                <div className="w-32 h-32 bg-purple-100 rounded-lg flex items-center justify-center animate-pulse">
                                    <svg className="w-12 h-12 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                </div>
                                <p className="text-xs text-purple-600 mt-2">Flux 1.1 Pro Ultra</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Error display */}
            {error && (
                <div className="mt-4 w-full max-w-md animate-fade-in">
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-3">
                        <span className="text-2xl">😅</span>
                        <p className="text-red-600 text-sm">{error}</p>
                    </div>
                </div>
            )}

            {/* Hidden audio element */}
            <audio
                ref={audioRef}
                onEnded={handleAudioEnded}
                onError={() => {
                    setIsSpeaking(false)
                    setCurrentExpression('confused')
                }}
                className="hidden"
            />

            {/* Microphone Selector */}
            <div className="mt-6 w-full max-w-md">
                <button
                    onClick={() => setShowMicSelector(!showMicSelector)}
                    className="flex items-center gap-2 mx-auto text-sm text-gray-500 hover:text-purple-600 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Microphone: {availableMics.find(m => m.deviceId === selectedMicId)?.label || 'Default'}</span>
                    <svg className={`w-4 h-4 transition-transform ${showMicSelector ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {showMicSelector && availableMics.length > 0 && (
                    <div className="mt-3 bg-white border border-purple-100 rounded-xl shadow-lg overflow-hidden animate-fade-in">
                        <div className="px-4 py-2 bg-purple-50 border-b border-purple-100">
                            <p className="text-xs font-medium text-purple-600 uppercase tracking-wider">Select Microphone</p>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                            {availableMics.map((mic) => (
                                <button
                                    key={mic.deviceId}
                                    onClick={() => {
                                        setSelectedMicId(mic.deviceId)
                                        setShowMicSelector(false)
                                        console.log('[VoiceConversation] 🎤 Selected microphone:', mic.label)
                                    }}
                                    className={`w-full px-4 py-3 text-left text-sm transition-colors flex items-center gap-3 ${selectedMicId === mic.deviceId
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'hover:bg-gray-50 text-gray-700'
                                        }`}
                                >
                                    <svg className={`w-5 h-5 flex-shrink-0 ${selectedMicId === mic.deviceId ? 'text-purple-500' : 'text-gray-400'}`} fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                                    </svg>
                                    <span className="truncate">{mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`}</span>
                                    {selectedMicId === mic.deviceId && (
                                        <svg className="w-5 h-5 text-purple-500 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Keyboard shortcut hint */}
            <p className="mt-4 text-xs text-gray-400">
                Or press <kbd className="px-2 py-1 bg-gray-100 rounded text-gray-600 font-mono text-xs">Space</kbd> to talk
            </p>

            {/* Reset conversation button */}
            {(transcript || generatedDesigns.length > 0) && (
                <button
                    onClick={resetConversation}
                    className="mt-6 text-sm text-gray-400 hover:text-purple-600 transition-colors flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Start Over
                </button>
            )}
        </div>
    )
}
