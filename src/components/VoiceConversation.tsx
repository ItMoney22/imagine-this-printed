import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { supabase } from '../lib/supabase'

interface VoiceConversationProps {
    onTextInput: (text: string) => void        // Called when user provides voice/text input
    isListening?: boolean                       // Show listening state
    autoSpeak?: boolean                         // Auto-play AI responses
    textToSpeak?: string                        // Text for AI to speak
    className?: string
}

export const VoiceConversation = ({ onTextInput, isListening, autoSpeak, textToSpeak, className }: VoiceConversationProps) => {
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [error, setError] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const recognitionRef = useRef<any>(null)

    // Initialize Web Speech API
    useEffect(() => {
        if ('webkitSpeechRecognition' in window) {
            const recognition = new (window as any).webkitSpeechRecognition()
            recognition.continuous = false
            recognition.interimResults = true
            recognition.lang = 'en-US'

            recognition.onresult = (event: any) => {
                const current = event.resultIndex
                const transcriptText = event.results[current][0].transcript
                setTranscript(transcriptText)

                if (event.results[current].isFinal) {
                    onTextInput(transcriptText)
                    setTranscript('')
                }
            }

            recognition.onerror = (event: any) => {
                setError(`Voice recognition error: ${event.error}`)
            }

            recognitionRef.current = recognition
        }
    }, [onTextInput])

    // Start/stop listening
    useEffect(() => {
        if (isListening && recognitionRef.current) {
            recognitionRef.current.start()
        } else if (recognitionRef.current) {
            recognitionRef.current.stop()
        }
    }, [isListening])

    // Synthesize speech from text
    const speak = async (text: string) => {
        setIsSpeaking(true)
        try {
            // Get current session for auth token
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) {
                throw new Error('Authentication required')
            }

            const { data } = await axios.post('/api/ai/voice/synthesize',
                { text },
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            )

            if (audioRef.current) {
                audioRef.current.src = data.audioUrl
                audioRef.current.play()
            }
        } catch (err: any) {
            console.error('Speech synthesis error:', err)
            setError(`Speech synthesis failed: ${err.message}`)
        } finally {
            setIsSpeaking(false)
        }
    }

    // Auto-speak effect
    useEffect(() => {
        if (autoSpeak && textToSpeak) {
            speak(textToSpeak)
        }
    }, [textToSpeak, autoSpeak])

    return (
        <div className={`relative ${className}`}>
            {/* Main HUD Container */}
            <div className="relative bg-black/40 backdrop-blur-xl border border-primary/30 rounded-3xl overflow-hidden shadow-[0_0_30px_rgba(147,51,234,0.15)]">
                {/* HUD Decor Elements */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-secondary/50 to-transparent" />
                <div className="absolute top-0 left-0 w-20 h-20 border-l-2 border-t-2 border-primary/30 rounded-tl-3xl" />
                <div className="absolute top-0 right-0 w-20 h-20 border-r-2 border-t-2 border-primary/30 rounded-tr-3xl" />
                <div className="absolute bottom-0 left-0 w-20 h-20 border-l-2 border-b-2 border-secondary/30 rounded-bl-3xl" />
                <div className="absolute bottom-0 right-0 w-20 h-20 border-r-2 border-b-2 border-secondary/30 rounded-br-3xl" />

                <div className="p-8 min-h-[300px] flex flex-col items-center justify-center relative z-10">
                    {/* Status Indicator */}
                    <div className="absolute top-6 right-6 flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-primary animate-ping' : 'bg-gray-500'}`} />
                        <span className="text-xs font-mono text-primary/70 tracking-widest uppercase">
                            {isSpeaking ? 'AI SPEAKING' : 'SYSTEM READY'}
                        </span>
                    </div>

                    {/* Central Visualizer */}
                    <div className="mb-8 relative">
                        {isSpeaking ? (
                            <div className="flex items-center justify-center gap-1 h-16">
                                {[...Array(5)].map((_, i) => (
                                    <div
                                        key={i}
                                        className="w-2 bg-gradient-to-t from-primary to-secondary rounded-full animate-wave"
                                        style={{
                                            height: '100%',
                                            animationDelay: `${i * 0.1}s`,
                                            animationDuration: '0.8s'
                                        }}
                                    />
                                ))}
                            </div>
                        ) : isListening ? (
                            <div className="relative w-24 h-24">
                                <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />
                                <div className="absolute inset-0 border-2 border-red-500/50 rounded-full animate-pulse" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-12 h-12 bg-red-500 rounded-full shadow-[0_0_20px_rgba(239,68,68,0.5)] animate-pulse" />
                                </div>
                            </div>
                        ) : (
                            <div className="w-20 h-20 rounded-full border-2 border-white/10 flex items-center justify-center">
                                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                                    <span className="text-3xl">🤖</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Transcript / Message Area */}
                    <div className="w-full max-w-lg text-center space-y-4">
                        {error ? (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-200 px-4 py-3 rounded-xl backdrop-blur-md">
                                {error}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm font-mono text-primary/60 tracking-widest uppercase mb-2">
                                    {isListening ? 'LISTENING...' : 'AI RESPONSE'}
                                </p>
                                <p className="text-2xl md:text-3xl font-display text-white leading-relaxed drop-shadow-lg">
                                    "{transcript || textToSpeak}"
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Hidden Audio Element */}
            <audio ref={audioRef} className="hidden" onEnded={() => setIsSpeaking(false)} />
        </div>
    )
}
