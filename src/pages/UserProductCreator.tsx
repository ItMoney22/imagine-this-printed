import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { Navigate, Link } from 'react-router-dom'
import { VoiceConversationEnhanced } from '../components/VoiceConversationEnhanced'
import { DesignHistorySidebar } from '../components/DesignHistorySidebar'
import { ProductPreviewCarousel } from '../components/ProductPreviewCarousel'
import { SocialShareButtons } from '../components/SocialShareButtons'
import { TrendingPrompts } from '../components/TrendingPrompts'
import axios from 'axios'
import { supabase } from '../lib/supabase'

// Design session interface
interface DesignSession {
    id: string
    status: 'draft' | 'generating' | 'completed' | 'submitted' | 'archived'
    prompt: string | null
    style: string | null
    color: string | null
    product_type: string | null
    step: string | null
    conversation_history: any[]
    generated_images: { url: string; replicate_id?: string }[]
    selected_image_url: string | null
    product_id: string | null
    created_at: string
    updated_at: string
}

// ITC cost per design generation
const GENERATION_COST_ITC = 50

// Mr. Imagine's conversational prompts (fallback if AI unavailable)
// Note: Mr. Imagine is a REAL mascot, not an "AI companion"
const MR_IMAGINE_FALLBACK = {
    welcome: "Yo! I'm Mr. Imagine! Ready to create something amazing? Tell me what you're dreaming up and I'll bring it to life!",
    afterPrompt: "Ohhh I LOVE that! This is gonna be fire! Now - do you want it photo-realistic or more artistic?",
    afterStyle: "Perfect! Last thing - what color shirt we putting this masterpiece on?",
    generating: "Alright, let me work my magic! *cracks knuckles* This is gonna be good...",
    complete: "BOOM! Check it out! If you can imagine it, we can print it! What do you think?",
    error: "Aw man, something went sideways. Let's try that again - I got you!"
}

type Step = 'welcome' | 'prompt' | 'style' | 'color' | 'generating' | 'complete'

// Interface for voice chat response from unified endpoint
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

interface GeneratedDesign {
    modelId: string
    modelName: string
    imageUrl?: string
    status: 'pending' | 'succeeded' | 'failed'
    error?: string
}

export const UserProductCreator = () => {
    const { user } = useAuth()
    const [currentStep, setCurrentStep] = useState<Step>('welcome')
    const [aiMessage, setAiMessage] = useState('')
    const [displayedMessage, setDisplayedMessage] = useState('') // For typing effect
    const [isTyping, setIsTyping] = useState(false)
    const [mrImagineState, setMrImagineState] = useState<'idle' | 'speaking' | 'listening' | 'thinking' | 'happy'>('idle')
    const [welcomePlayed, setWelcomePlayed] = useState(false)
    const welcomeAudioRef = useRef<HTMLAudioElement | null>(null)
    const introVideoRef = useRef<HTMLVideoElement | null>(null)
    const [conversationStarted, setConversationStarted] = useState(false)

    const [formData, setFormData] = useState({
        prompt: '',
        imageStyle: '' as 'realistic' | 'cartoon' | '',
        shirtColor: 'black' as 'black' | 'white' | 'grey' | 'color',
    })

    const [productId, setProductId] = useState<string | null>(null)
    const [progress, setProgress] = useState(0)
    const [generatedImages, setGeneratedImages] = useState<{ id: string; url: string }[]>([])
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
    const [showTextInput, setShowTextInput] = useState(false)
    const [showIntro, setShowIntro] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [mockupsReady, setMockupsReady] = useState(false)

    // Design concept from voice chat - used when ready_to_generate is true
    const [designConcept, setDesignConcept] = useState<string | null>(null)

    // Design session (draft) management
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [showHistorySidebar, setShowHistorySidebar] = useState(false)
    const [hasDrafts, setHasDrafts] = useState(false)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Wallet state for ITC credits - initialized from user.wallet (auth context)
    const [wallet, setWallet] = useState({ itc_balance: 0, points: 0 })
    const [showInsufficientCreditsModal, setShowInsufficientCreditsModal] = useState(false)
    const [requiredCredits, setRequiredCredits] = useState(GENERATION_COST_ITC)

    // Sync wallet from auth context and refresh on mount
    useEffect(() => {
        if (user) {
            // First, use cached wallet from auth context if available
            if (user.wallet) {
                setWallet({
                    itc_balance: user.wallet.itcBalance || 0,
                    points: 0 // Points are stored separately in user_wallets table
                })
            }
            // Then do a fresh fetch to ensure we have latest balance
            supabase.from('user_wallets')
                .select('itc_balance, points')
                .eq('user_id', user.id)
                .single()
                .then(({ data, error }) => {
                    if (data && !error) {
                        setWallet({
                            itc_balance: Number(data.itc_balance) || 0,
                            points: data.points || 0
                        })
                    }
                })
        }
    }, [user])

    // Typing effect for Mr. Imagine's messages
    useEffect(() => {
        if (!aiMessage) {
            setDisplayedMessage('')
            setIsTyping(false)
            return
        }

        // If same message, don't re-type
        if (displayedMessage === aiMessage) return

        setIsTyping(true)
        setDisplayedMessage('')

        let currentIndex = 0
        const typingSpeed = 25 // ms per character - fast but readable

        const typeNextChar = () => {
            if (currentIndex < aiMessage.length) {
                setDisplayedMessage(aiMessage.slice(0, currentIndex + 1))
                currentIndex++
                setTimeout(typeNextChar, typingSpeed)
            } else {
                setIsTyping(false)
            }
        }

        // Start typing after a brief delay
        const startDelay = setTimeout(typeNextChar, 100)

        return () => clearTimeout(startDelay)
    }, [aiMessage])

    // Check for existing drafts on mount
    useEffect(() => {
        const checkForDrafts = async () => {
            if (!user) return
            try {
                const { data: { session } } = await supabase.auth.getSession()
                const token = session?.access_token
                if (!token) return

                const { data } = await axios.get('/api/user-products/design-sessions/drafts', {
                    headers: { Authorization: `Bearer ${token}` }
                })

                if (data.drafts && data.drafts.length > 0) {
                    setHasDrafts(true)
                }
            } catch (error) {
                console.error('Failed to check drafts:', error)
            }
        }
        checkForDrafts()
    }, [user])

    // Auto-save draft when form data changes
    const saveDraft = useCallback(async () => {
        if (!user || currentStep === 'complete' || currentStep === 'generating') return

        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token
            if (!token) return

            const sessionData = {
                prompt: formData.prompt || null,
                style: formData.imageStyle || null,
                color: formData.shirtColor || null,
                product_type: 't-shirt',
                step: currentStep,
                status: 'draft'
            }

            if (currentSessionId) {
                // Update existing session
                await axios.patch(`/api/user-products/design-sessions/${currentSessionId}`, sessionData, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            } else if (formData.prompt) {
                // Create new session only if we have a prompt
                const { data } = await axios.post('/api/user-products/design-sessions', sessionData, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                setCurrentSessionId(data.session.id)
                setHasDrafts(true)
            }
        } catch (error) {
            console.error('Failed to save draft:', error)
        }
    }, [user, currentSessionId, currentStep, formData])

    // Debounced auto-save (save after 2 seconds of inactivity)
    useEffect(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current)
        }

        // Only save if we have meaningful data
        if (formData.prompt || formData.imageStyle) {
            saveTimeoutRef.current = setTimeout(() => {
                saveDraft()
            }, 2000)
        }

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current)
            }
        }
    }, [formData, currentStep, saveDraft])

    // Load session handler
    const handleLoadSession = useCallback((session: DesignSession) => {
        setCurrentSessionId(session.id)
        setFormData({
            prompt: session.prompt || '',
            imageStyle: (session.style as 'realistic' | 'cartoon' | '') || '',
            shirtColor: (session.color as 'black' | 'white' | 'grey' | 'color') || 'black'
        })
        setCurrentStep((session.step as Step) || 'welcome')
        setShowIntro(false)
        if (session.generated_images?.length > 0) {
            setGeneratedImages(session.generated_images.map((img, idx) => ({
                id: `img-${idx}`,
                url: img.url
            })))
        }
    }, [])

    // Remix session handler
    const handleRemixSession = useCallback((session: DesignSession) => {
        setCurrentSessionId(session.id)
        setFormData({
            prompt: session.prompt || '',
            imageStyle: '',
            shirtColor: 'black'
        })
        setCurrentStep('prompt')
        setShowIntro(false)
        setGeneratedImages([])
        setSelectedImageId(null)
    }, [])

    // Play welcome audio after user clicks "Start" (required for browser autoplay policy)
    const startExperience = async () => {
        setShowIntro(false)

        try {
            // Create audio element for welcome message
            const audio = new Audio('/mr-imagine/audio/welcome.mp3')
            welcomeAudioRef.current = audio

            // Set state to speaking while welcome plays
            setMrImagineState('speaking')

            audio.onended = () => {
                setMrImagineState('idle')
                setWelcomePlayed(true)
            }

            audio.onerror = () => {
                console.warn('Welcome audio failed to load, using fallback')
                setMrImagineState('idle')
                setWelcomePlayed(true)
            }

            // Small delay before playing for better UX
            await new Promise(resolve => setTimeout(resolve, 300))
            await audio.play()
        } catch (err) {
            console.error('Failed to play welcome audio:', err)
            setMrImagineState('idle')
            setWelcomePlayed(true)
        }
    }

    // Cleanup audio and video on unmount
    useEffect(() => {
        return () => {
            if (welcomeAudioRef.current) {
                welcomeAudioRef.current.pause()
            }
            if (introVideoRef.current) {
                introVideoRef.current.pause()
            }
        }
    }, [])

    // Stop intro video when conversation starts (mic clicked)
    const handleConversationStart = useCallback(() => {
        if (introVideoRef.current) {
            introVideoRef.current.pause()
        }
        setConversationStarted(true)
    }, [])

    // Handle voice response from unified voice-chat endpoint
    // The VoiceConversationEnhanced component now handles:
    // 1. Transcription via GPT-4o
    // 2. AI response generation
    // 3. Voice synthesis via Minimax
    // We just need to react to the response and update our UI
    const handleVoiceResponse = useCallback((response: VoiceChatResponse) => {
        console.log('[UserProductCreator] 📥 Voice response received:', {
            userSaid: response.user_said,
            aiResponse: response.text?.substring(0, 50) + '...',
            readyToGenerate: response.ready_to_generate,
            designConcept: response.design_concept?.substring(0, 30),
            collectedData: response.collected_data,
        })

        // Display AI's text response
        setAiMessage(response.text)

        // Update Mr. Imagine's state (audio plays from component)
        setMrImagineState('speaking')

        // AUTO-FILL form fields from collected_data (no button presses needed!)
        const collected = response.collected_data || {}
        setFormData(prev => {
            const updated = { ...prev }

            // Update prompt from design concept if available
            if (collected.designConcept) {
                updated.prompt = collected.designConcept
            }

            // Auto-select image style from voice (photorealistic/cartoon)
            if (collected.imageStyle === 'realistic' || collected.imageStyle === 'cartoon') {
                updated.imageStyle = collected.imageStyle
                console.log('[UserProductCreator] 🎨 Auto-selected image style:', collected.imageStyle)
            }

            // Auto-select shirt color from voice
            if (collected.shirtColor === 'black' || collected.shirtColor === 'white' || collected.shirtColor === 'gray') {
                updated.shirtColor = collected.shirtColor === 'gray' ? 'grey' : collected.shirtColor
                console.log('[UserProductCreator] 👕 Auto-selected shirt color:', collected.shirtColor)
            }

            return updated
        })

        // If we have a design concept and are ready to generate - GO DIRECTLY TO GENERATION
        if (response.ready_to_generate && response.design_concept) {
            setDesignConcept(response.design_concept)
            setCurrentStep('generating')
        }
        // Auto-advance steps based on what's been collected
        else if (collected.imageStyle && currentStep === 'style') {
            // Style was selected via voice, move to color
            setCurrentStep('color')
        } else if (collected.shirtColor && currentStep === 'color') {
            // Color was selected via voice, ready to generate!
            setCurrentStep('generating')
        } else if (response.user_said && currentStep === 'welcome') {
            // User provided initial prompt, move to style selection
            setCurrentStep('style')
        }
    }, [currentStep])

    // Handle text input (for text-based interaction)
    const handleTextInput = useCallback((text: string) => {
        // Just update the form data - the voice component handles the rest
        setFormData(prev => ({ ...prev, prompt: text }))
    }, [])

    // Handle text submit button (skips voice, goes to style selection)
    const handleTextSubmit = useCallback(() => {
        if (!formData.prompt.trim()) return
        setAiMessage(MR_IMAGINE_FALLBACK.afterPrompt)
        setMrImagineState('happy')
        setCurrentStep('style')
    }, [formData.prompt])

    // Handle style selection - move to color selection
    const handleStyleSelect = (style: 'realistic' | 'cartoon') => {
        setFormData(prev => ({ ...prev, imageStyle: style }))
        setMrImagineState('happy')

        // Show a quick message for style selection
        const styleMessage = style === 'realistic'
            ? "Photo-realistic - great choice! Now let's pick a shirt color."
            : "Artistic style - I love it! Now let's choose a shirt color."

        setAiMessage(styleMessage)
        setCurrentStep('color')
    }

    // Handle color selection and start generation
    const handleColorSelect = async (color: 'black' | 'white' | 'grey' | 'color') => {
        setFormData(prev => ({ ...prev, shirtColor: color }))
        setMrImagineState('thinking')

        // Show generating message
        setAiMessage(MR_IMAGINE_FALLBACK.generating)
        setCurrentStep('generating')

        // Start the actual generation using user-products API (creates with pending_approval status)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) throw new Error('Authentication required')

            const { data } = await axios.post('/api/user-products/create', {
                prompt: formData.prompt,
                imageStyle: formData.imageStyle,
                shirtColor: color,
                printStyle: 'dtf',
                productType: 'tshirt',
                printPlacement: 'front-center',
                modelId: 'black-forest-labs/flux-1.1-pro-ultra' // Flux only
            }, {
                headers: { Authorization: `Bearer ${token}` }
            })

            setProductId(data.productId)
            // Update wallet balance after successful deduction
            setWallet(prev => ({ ...prev, itc_balance: prev.itc_balance - GENERATION_COST_ITC }))
        } catch (error: any) {
            console.error('Generation failed:', error)

            // Handle insufficient credits (402 response)
            if (error.response?.status === 402) {
                const { required, current } = error.response.data
                setRequiredCredits(required || GENERATION_COST_ITC)
                setWallet(prev => ({ ...prev, itc_balance: current || 0 }))
                setShowInsufficientCreditsModal(true)
                setCurrentStep('color') // Go back to color selection
            }

            setAiMessage(MR_IMAGINE_FALLBACK.error)
            setMrImagineState('idle')
        }
    }

    // Poll for generation status using user-products API
    useEffect(() => {
        if (!productId || currentStep !== 'generating') return

        const interval = setInterval(async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession()
                const token = session?.access_token

                const { data } = await axios.get(`/api/user-products/${productId}/status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                })

                const imageJob = data.jobs.find((j: any) => j.type === 'replicate_image')

                if (imageJob?.status === 'succeeded') {
                    setProgress(100)
                    setAiMessage(MR_IMAGINE_FALLBACK.complete)
                    setMrImagineState('happy')
                    setCurrentStep('complete')

                    if (data.assets && data.assets.length > 0) {
                        // Store both ID and URL for image selection
                        setGeneratedImages(data.assets.map((a: any) => ({ id: a.id, url: a.url })))
                    }
                } else if (imageJob?.status === 'failed') {
                    setAiMessage(MR_IMAGINE_FALLBACK.error)
                    setMrImagineState('idle')
                } else {
                    setProgress(prev => Math.min(prev + 3, 90))
                }
            } catch (e) {
                console.error('Polling error', e)
            }
        }, 2000)

        return () => clearInterval(interval)
    }, [productId, currentStep])

    if (!user) {
        return <Navigate to="/login" replace />
    }

    // Vendor role gate - only vendors can create products for marketplace
    const isVendor = user.role === 'vendor' || user.role === 'admin'
    if (!isVendor) {
        return (
            <div className="min-h-screen bg-[#0f0a29] relative overflow-hidden flex items-center justify-center">
                {/* Rich gradient background */}
                <div className="absolute inset-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-900/40 via-[#0f0a29] to-pink-900/30" />
                    <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[120px]" />
                    <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-pink-600/15 rounded-full blur-[100px]" />
                </div>

                <div className="relative z-10 text-center max-w-lg mx-auto px-6 py-12">
                    {/* Mr. Imagine with glow */}
                    <div className="relative mb-10">
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-500/40 to-transparent rounded-full blur-3xl scale-150" />
                        <img
                            src="/mr-imagine/mr-imagine-waist-up-thinking.png"
                            alt="Mr. Imagine"
                            className="w-44 h-auto mx-auto relative z-10 drop-shadow-[0_0_30px_rgba(147,51,234,0.5)]"
                        />
                    </div>

                    <h1 className="font-display text-4xl md:text-5xl text-white mb-5 tracking-tight">
                        Become a <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Creator</span>
                    </h1>
                    <p className="text-purple-100/80 text-lg mb-8 leading-relaxed font-body">
                        Hey there! To create and sell your own designs on the marketplace,
                        you'll need to become a vendor first. It's easy, and you'll earn
                        <span className="font-bold text-emerald-400"> 10% royalty</span> on every sale!
                    </p>

                    {/* Benefits card with glass effect */}
                    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 mb-8 text-left">
                        <h3 className="font-display text-lg text-white mb-4 flex items-center gap-3">
                            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-xl shadow-lg shadow-emerald-500/30">💰</span>
                            Creator Benefits
                        </h3>
                        <ul className="space-y-3 text-sm">
                            {[
                                'Earn 10% ITC royalty on every sale',
                                'Your designs featured on the marketplace',
                                'Build your own brand and following',
                                'Mr. Imagine helps you create amazing designs'
                            ].map((benefit, i) => (
                                <li key={i} className="flex items-start gap-3 text-purple-100/90">
                                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    </span>
                                    {benefit}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="flex flex-col gap-4">
                        <Link
                            to="/become-vendor"
                            className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-2xl overflow-hidden transition-all hover:scale-[1.02] hover:shadow-2xl hover:shadow-purple-500/30"
                        >
                            <span className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="relative flex items-center gap-2">
                                <span className="text-xl">🚀</span> Apply to Become a Vendor
                            </span>
                        </Link>
                        <Link
                            to="/"
                            className="text-purple-300/70 hover:text-white text-sm font-medium transition-colors"
                        >
                            ← Back to Home
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    // Intro screen - user must click to start (required for audio autoplay)
    if (showIntro) {
        return (
            <div className="min-h-screen bg-white relative overflow-hidden flex items-center justify-center">
                {/* Immersive gradient background */}
                <div className="absolute inset-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-gray-100" />
                    <div className="absolute top-1/4 left-1/3 w-[700px] h-[700px] bg-purple-200/20 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: '4s' }} />
                    <div className="absolute bottom-1/4 right-1/3 w-[500px] h-[500px] bg-pink-200/20 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />
                    {/* Subtle grid overlay */}
                    <div className="absolute inset-0 opacity-[0.03]" style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239333ea' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
                    }} />
                </div>

                {/* Content */}
                <div className="relative z-10 text-center max-w-xl mx-auto px-6 py-12">
                    {/* Mr. Imagine Static Image with glow */}
                    <div className="relative mb-10">
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-200/50 via-pink-200/30 to-transparent rounded-full blur-[60px] scale-150" />
                        <img
                            src="/mr-imagine/mr-imagine-waist-up-happy.png"
                            alt="Mr. Imagine"
                            className="w-72 md:w-96 h-auto mx-auto relative z-10 drop-shadow-[0_0_40px_rgba(147,51,234,0.3)]"
                        />
                    </div>

                    {/* Elegant typography */}
                    <h1 className="font-display text-5xl md:text-6xl text-gray-900 mb-5 tracking-tight leading-tight">
                        Meet <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600">Mr. Imagine</span>
                    </h1>
                    <p className="text-gray-600 text-lg md:text-xl mb-10 leading-relaxed font-body max-w-md mx-auto">
                        Describe your dream design and watch the magic happen.
                        <span className="block mt-2 text-purple-600/90 font-medium italic">If you can imagine it, we can print it.</span>
                    </p>

                    {/* ITC Balance - Glass card */}
                    <div className="inline-flex items-center gap-4 px-6 py-3 bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl mb-8 shadow-sm">
                        <span className="flex items-center gap-2 text-amber-500 font-semibold">
                            <span className="text-xl">💰</span> {wallet.itc_balance} ITC
                        </span>
                        <span className="w-px h-5 bg-gray-300" />
                        <span className="text-gray-500 text-sm">Cost: {GENERATION_COST_ITC} ITC</span>
                    </div>

                    {/* Start button - bold CTA */}
                    <div>
                        <button
                            onClick={startExperience}
                            className="group relative inline-flex items-center gap-4 px-12 py-5 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 bg-[length:200%_100%] text-white font-bold text-lg rounded-2xl shadow-xl shadow-purple-500/20 hover:shadow-purple-500/40 transition-all duration-500 hover:bg-right hover:scale-[1.03]"
                        >
                            <span className="text-2xl group-hover:scale-125 transition-transform duration-300">🎨</span>
                            <span>Start Creating</span>
                            <svg className="w-5 h-5 group-hover:translate-x-2 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                        </button>
                    </div>

                    <p className="mt-8 text-sm text-gray-400 font-body">
                        🎙️ Voice-enabled experience • Click to begin
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-white relative overflow-hidden">
            {/* Rich light gradient background */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-b from-white via-gray-50 to-gray-100" />
                <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-200/20 rounded-full blur-[150px]" />
                <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] bg-pink-200/20 rounded-full blur-[120px]" />
                {/* Subtle grid */}
                <div className="absolute inset-0 opacity-[0.02]" style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239333ea' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
                }} />
            </div>

            {/* Header - Glass effect */}
            <header className="relative z-10 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200/50">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2 md:gap-3 group">
                        <img src="/itp-logo-v3.png" alt="ITP" className="h-8 md:h-10 w-auto" />
                        <span className="hidden sm:block font-display text-lg md:text-xl text-gray-900 group-hover:text-purple-600 transition-colors">
                            Imagine This Printed
                        </span>
                    </Link>

                    <div className="flex items-center gap-2 md:gap-3">
                        {/* My Designs Button */}
                        <button
                            onClick={() => setShowHistorySidebar(true)}
                            className="relative flex items-center gap-2 px-3 md:px-4 py-2 bg-white/60 backdrop-blur-xl border border-gray-200 rounded-xl hover:bg-white/80 transition-all shadow-sm"
                        >
                            <span className="text-purple-600">📁</span>
                            <span className="hidden sm:block font-medium text-gray-700 text-sm">My Designs</span>
                            {hasDrafts && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-white" />
                            )}
                        </button>
                        {/* ITC Balance Display */}
                        <Link to="/wallet" className="flex items-center gap-2 px-3 md:px-4 py-2 bg-amber-50 data-[state=active]:bg-amber-100 backdrop-blur-xl border border-amber-200 rounded-xl hover:bg-amber-100 transition-all shadow-sm">
                            <span className="text-amber-500">💰</span>
                            <span className="font-semibold text-amber-600 text-sm">{wallet.itc_balance}</span>
                        </Link>
                        <div className="hidden lg:flex items-center gap-2 px-3 py-2 bg-white/60 rounded-xl border border-gray-100 shadow-sm">
                            <span className="text-xs text-gray-500">Creating as</span>
                            <span className="font-medium text-gray-700 text-sm">{user.username || user.email?.split('@')[0]}</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Design History Sidebar */}
            <DesignHistorySidebar
                isOpen={showHistorySidebar}
                onClose={() => setShowHistorySidebar(false)}
                onLoadSession={handleLoadSession}
                onRemixSession={handleRemixSession}
                currentSessionId={currentSessionId}
            />

            {/* Insufficient Credits Modal */}
            {showInsufficientCreditsModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in p-4">
                    <div className="bg-[#1a1235] border border-white/10 rounded-3xl shadow-2xl max-w-md w-full p-8 text-center">
                        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center">
                            <span className="text-4xl">💰</span>
                        </div>
                        <h3 className="font-display text-2xl text-white mb-3">Not Enough Credits</h3>
                        <p className="text-purple-100/80 mb-2">
                            Design generation costs <span className="font-bold text-purple-300">{requiredCredits} ITC</span>
                        </p>
                        <p className="text-purple-200/50 text-sm mb-8">
                            You currently have <span className="font-bold text-amber-400">{wallet.itc_balance} ITC</span>
                        </p>
                        <div className="flex flex-col gap-3">
                            <Link
                                to="/wallet"
                                className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all"
                            >
                                Get More ITC
                            </Link>
                            <button
                                onClick={() => setShowInsufficientCreditsModal(false)}
                                className="w-full py-4 border border-white/10 text-purple-200/70 font-medium rounded-xl hover:bg-white/5 transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="relative z-10 max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
                {/* Title Section - Compact on mobile */}
                <div className="text-center mb-6 md:mb-8">
                    <h1 className="font-display text-3xl md:text-5xl text-gray-900 mb-2 md:mb-3 tracking-tight">
                        Create with <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">Mr. Imagine</span>
                    </h1>
                    <p className="text-gray-600 text-base md:text-lg max-w-xl mx-auto">
                        Describe your dream design and watch the magic happen
                    </p>
                </div>

                {/* Voice Interface Card - Glass morphism */}
                <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white/60 shadow-xl shadow-purple-500/5 p-5 md:p-10 mb-6 md:mb-8">
                    {/* Mr. Imagine + Voice Interface */}
                    <VoiceConversationEnhanced
                        onTextInput={handleTextInput}
                        onVoiceResponse={handleVoiceResponse}
                        onConversationStart={handleConversationStart}
                        autoMicOn={false}
                        conversationalMode={true}
                        mrImagineState={mrImagineState}
                        showVideoBeforeConversation={!conversationStarted}
                    />

                    {/* Mr. Imagine's Text Response Display with Typing Effect */}
                    {aiMessage && (
                        <div className="mt-6 max-w-2xl mx-auto animate-fade-in">
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4 md:p-6">
                                <div className="flex items-start gap-3 md:gap-4">
                                    {/* Mini Mr. Imagine avatar */}
                                    <div className="flex-shrink-0">
                                        <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30 ${isTyping ? 'animate-pulse' : ''}`}>
                                            <span className="text-xl md:text-2xl">🎨</span>
                                        </div>
                                    </div>
                                    {/* Speech bubble with typing effect */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[10px] md:text-xs text-purple-400 font-semibold uppercase tracking-wider mb-1.5">Mr. Imagine</p>
                                        <p className="text-purple-50 text-base md:text-lg leading-relaxed">
                                            {displayedMessage}
                                            {isTyping && (
                                                <span className="inline-block w-0.5 h-5 md:h-6 bg-purple-400 ml-0.5 animate-pulse" />
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Text Input Toggle */}
                    {currentStep === 'welcome' && (
                        <div className="mt-6 md:mt-8 text-center">
                            <button
                                onClick={() => setShowTextInput(!showTextInput)}
                                className="text-purple-300/70 hover:text-purple-200 text-sm font-medium transition-colors"
                            >
                                {showTextInput ? '← Back to voice' : 'Prefer to type instead?'}
                            </button>

                            {showTextInput && (
                                <div className="mt-4 max-w-lg mx-auto animate-fade-in">
                                    <textarea
                                        value={formData.prompt}
                                        onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                                        placeholder="Describe your dream design... e.g., 'A majestic phoenix rising from purple flames'"
                                        className="w-full p-4 rounded-2xl bg-white/5 border border-white/10 focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all resize-none text-white placeholder:text-purple-300/40"
                                        rows={3}
                                    />
                                    <button
                                        onClick={handleTextSubmit}
                                        disabled={!formData.prompt.trim()}
                                        className="mt-3 w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Create This Design
                                    </button>
                                </div>
                            )}

                            {/* Trending Prompts - Inspiration Gallery */}
                            <div className="mt-6 md:mt-8 max-w-2xl mx-auto">
                                <TrendingPrompts
                                    onSelectPrompt={(prompt) => {
                                        setFormData({ ...formData, prompt })
                                        setShowTextInput(true)
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Style Selection Step */}
                {currentStep === 'style' && (
                    <div className="animate-fade-in">
                        <h2 className="font-display text-2xl md:text-3xl text-white text-center mb-6">Choose Your Style</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 max-w-2xl mx-auto">
                            <button
                                onClick={() => handleStyleSelect('realistic')}
                                className={`group relative bg-white/5 backdrop-blur rounded-2xl p-6 md:p-8 border-2 transition-all hover:-translate-y-1 ${formData.imageStyle === 'realistic'
                                    ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/20'
                                    : 'border-white/10 hover:border-purple-500/50 hover:bg-white/10'
                                    }`}
                            >
                                <div className="relative">
                                    <div className="w-16 h-16 md:w-20 md:h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 flex items-center justify-center text-3xl md:text-4xl">
                                        📸
                                    </div>
                                    <h3 className="font-display text-lg md:text-xl text-white mb-2">Photo-Realistic</h3>
                                    <p className="text-purple-200/60 text-sm">Detailed, lifelike imagery with rich textures</p>
                                </div>
                                {formData.imageStyle === 'realistic' && (
                                    <div className="absolute top-4 right-4 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                )}
                            </button>

                            <button
                                onClick={() => handleStyleSelect('cartoon')}
                                className={`group relative bg-white/5 backdrop-blur rounded-2xl p-6 md:p-8 border-2 transition-all hover:-translate-y-1 ${formData.imageStyle === 'cartoon'
                                    ? 'border-pink-500 bg-pink-500/10 shadow-lg shadow-pink-500/20'
                                    : 'border-white/10 hover:border-pink-500/50 hover:bg-white/10'
                                    }`}
                            >
                                <div className="relative">
                                    <div className="w-16 h-16 md:w-20 md:h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-3xl md:text-4xl">
                                        🎨
                                    </div>
                                    <h3 className="font-display text-lg md:text-xl text-white mb-2">Artistic</h3>
                                    <p className="text-purple-200/60 text-sm">Stylized illustrations with bold, vibrant colors</p>
                                </div>
                                {formData.imageStyle === 'cartoon' && (
                                    <div className="absolute top-4 right-4 w-6 h-6 bg-pink-500 rounded-full flex items-center justify-center">
                                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Color Selection Step */}
                {currentStep === 'color' && (
                    <div className="animate-fade-in">
                        <h2 className="font-display text-2xl md:text-3xl text-white text-center mb-4">Select Shirt Color</h2>
                        <p className="text-purple-200/50 text-center mb-6 text-sm md:text-base">This helps optimize the design for best print quality</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-w-2xl mx-auto">
                            {[
                                { value: 'black', label: 'Black', bg: 'bg-gray-900', ring: 'ring-purple-500' },
                                { value: 'white', label: 'White', bg: 'bg-white', ring: 'ring-purple-500' },
                                { value: 'grey', label: 'Grey', bg: 'bg-gray-400', ring: 'ring-purple-500' },
                                { value: 'color', label: 'Colorful', bg: 'bg-gradient-to-br from-red-500 via-yellow-500 to-blue-500', ring: 'ring-pink-500' },
                            ].map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => handleColorSelect(option.value as any)}
                                    className={`group relative ${option.bg} rounded-2xl h-24 md:h-32 flex items-center justify-center transition-all hover:scale-105 hover:shadow-xl overflow-hidden border-2 border-transparent hover:border-purple-500/50`}
                                >
                                    <span className={`font-semibold text-sm md:text-base ${option.value === 'white' ? 'text-gray-800' : 'text-white'} drop-shadow-lg`}>{option.label}</span>
                                    {formData.shirtColor === option.value && (
                                        <div className={`absolute inset-0 rounded-2xl ring-4 ${option.ring}`} />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Generation Progress */}
                {currentStep === 'generating' && (
                    <div className="animate-fade-in text-center py-8 md:py-12">
                        <div className="relative w-32 h-32 md:w-40 md:h-40 mx-auto mb-6 md:mb-8">
                            {/* Animated ring */}
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                <circle
                                    cx="50" cy="50" r="45"
                                    fill="none"
                                    stroke="rgba(147, 51, 234, 0.1)"
                                    strokeWidth="6"
                                />
                                <circle
                                    cx="50" cy="50" r="45"
                                    fill="none"
                                    stroke="url(#progressGradient)"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeDasharray={`${progress * 2.83} 283`}
                                    className="transition-all duration-500"
                                />
                                <defs>
                                    <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#9333ea" />
                                        <stop offset="100%" stopColor="#ec4899" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-3xl md:text-4xl font-bold text-white">{progress}%</span>
                                <span className="text-xs md:text-sm text-purple-300/60">Creating</span>
                            </div>
                        </div>

                        <h3 className="font-display text-xl md:text-2xl text-white mb-2">
                            Crafting your masterpiece...
                        </h3>
                        <p className="text-purple-200/60 text-sm md:text-base">
                            {progress < 30 ? "Understanding your vision..." :
                                progress < 60 ? "Generating the design..." :
                                    progress < 90 ? "Adding finishing touches..." :
                                        "Almost there!"}
                        </p>

                        {/* Bouncing dots */}
                        <div className="flex justify-center gap-2 mt-6">
                            <div className="w-2.5 h-2.5 md:w-3 md:h-3 bg-purple-500 rounded-full animate-bounce" />
                            <div className="w-2.5 h-2.5 md:w-3 md:h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                            <div className="w-2.5 h-2.5 md:w-3 md:h-3 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                        </div>
                    </div>
                )}

                {/* Complete - Show Results */}
                {currentStep === 'complete' && !submitted && (
                    <div className="animate-fade-in">
                        <div className="text-center mb-6 md:mb-8">
                            <h2 className="font-display text-2xl md:text-3xl text-white mb-2">Your Design is Ready!</h2>
                            <p className="text-purple-200/60 text-sm md:text-base">
                                {selectedImageId
                                    ? 'Great choice! Now submit for approval to list on the marketplace.'
                                    : 'Select your favorite design to list on the marketplace'
                                }
                            </p>
                        </div>

                        {/* Generated Images - Selectable */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
                            {generatedImages.length > 0 ? (
                                generatedImages.map((img, idx) => (
                                    <button
                                        key={img.id}
                                        onClick={() => setSelectedImageId(img.id)}
                                        className={`group relative bg-white/5 backdrop-blur rounded-2xl overflow-hidden transition-all ${selectedImageId === img.id
                                            ? 'ring-4 ring-purple-500 shadow-xl shadow-purple-500/30 scale-[1.02]'
                                            : 'hover:bg-white/10 hover:scale-[1.01] border border-white/10'
                                            }`}
                                    >
                                        <img
                                            src={img.url}
                                            alt={`Generated design ${idx + 1}`}
                                            className="w-full aspect-square object-cover"
                                        />
                                        {selectedImageId === img.id && (
                                            <div className="absolute top-3 right-3 w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center shadow-lg">
                                                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        )}
                                        <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity flex items-end p-4 ${selectedImageId === img.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                            }`}>
                                            <span className="text-white font-medium text-sm">
                                                {selectedImageId === img.id ? '✓ Selected' : `Option ${idx + 1}`}
                                            </span>
                                        </div>
                                    </button>
                                ))
                            ) : (
                                <div className="col-span-full text-center py-12 text-purple-300/50">
                                    Images loading...
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap justify-center gap-4">
                            <button
                                onClick={async () => {
                                    if (!selectedImageId || !productId) return
                                    setSubmitting(true)
                                    try {
                                        const { data: { session } } = await supabase.auth.getSession()
                                        const token = session?.access_token

                                        // Step 1: Select the image (triggers mockup generation)
                                        await axios.post(`/api/user-products/${productId}/select-image`, {
                                            selectedAssetId: selectedImageId
                                        }, {
                                            headers: { Authorization: `Bearer ${token}` }
                                        })

                                        // Step 2: Submit for approval
                                        await axios.post(`/api/user-products/${productId}/submit-for-approval`, {}, {
                                            headers: { Authorization: `Bearer ${token}` }
                                        })

                                        setSubmitted(true)
                                        setMrImagineState('happy')
                                    } catch (error) {
                                        console.error('Submission failed:', error)
                                        setAiMessage('Oops! Something went wrong. Please try again.')
                                    } finally {
                                        setSubmitting(false)
                                    }
                                }}
                                disabled={!selectedImageId || submitting}
                                className={`px-8 py-4 font-semibold rounded-xl transition-all ${selectedImageId && !submitting
                                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:shadow-lg hover:shadow-purple-500/30'
                                    : 'bg-white/10 text-purple-300/40 cursor-not-allowed'
                                    }`}
                            >
                                {submitting ? (
                                    <span className="flex items-center gap-2">
                                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Submitting...
                                    </span>
                                ) : (
                                    <>
                                        🚀 List on Marketplace
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Selection hint */}
                        {!selectedImageId && generatedImages.length > 0 && (
                            <p className="text-center text-purple-300/40 text-sm mt-4 animate-pulse">
                                👆 Tap an image to select it
                            </p>
                        )}

                        {/* Product Preview Carousel - See design on multiple products */}
                        {selectedImageId && (
                            <div className="mt-6 md:mt-8 p-4 md:p-6 bg-white/5 backdrop-blur rounded-2xl border border-white/10">
                                <ProductPreviewCarousel
                                    designImageUrl={generatedImages.find(img => img.id === selectedImageId)?.url || ''}
                                    designName={formData.prompt?.substring(0, 50)}
                                />
                            </div>
                        )}

                        {/* Social Share Buttons */}
                        {selectedImageId && (
                            <div className="mt-6 flex justify-center">
                                <SocialShareButtons
                                    productId={productId || undefined}
                                    designImageUrl={generatedImages.find(img => img.id === selectedImageId)?.url}
                                    designName={formData.prompt?.substring(0, 50)}
                                />
                            </div>
                        )}

                        {/* 10% Creator Royalty Banner */}
                        <div className="mt-6 md:mt-8">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 max-w-md mx-auto">
                                <div className="flex items-center justify-center gap-2 mb-2">
                                    <span className="text-2xl">🎉</span>
                                    <span className="text-lg md:text-xl font-bold text-emerald-400">10% Creator Royalty!</span>
                                </div>
                                <p className="text-sm text-purple-100/70 text-center">
                                    Every time someone buys this design, you earn 10% in ITC credits.
                                    That's real money in your pocket!
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Submitted - Success Message */}
                {submitted && (
                    <div className="animate-fade-in text-center py-8 md:py-12">
                        <div className="w-20 h-20 md:w-24 md:h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-xl shadow-emerald-500/30">
                            <svg className="w-10 h-10 md:w-12 md:h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>

                        <h2 className="font-display text-2xl md:text-3xl text-white mb-3">Submitted for Review!</h2>
                        <p className="text-purple-200/70 max-w-md mx-auto mb-8 leading-relaxed text-sm md:text-base">
                            Your design is now being reviewed by our team. Once approved, you'll receive an email
                            with instructions to set up your wallet and start earning from sales!
                        </p>

                        {/* Prominent Royalty Banner */}
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 max-w-md mx-auto mb-6">
                            <div className="flex items-center justify-center gap-3 mb-3">
                                <span className="text-3xl">🎉</span>
                                <span className="text-xl md:text-2xl font-bold text-emerald-400">10% Creator Royalty!</span>
                            </div>
                            <p className="text-purple-100/70 text-sm md:text-base text-center">
                                Every time someone buys your design, you earn <strong className="text-emerald-400">10% in ITC credits</strong>.
                                That's real money in your pocket from every sale!
                            </p>
                        </div>

                        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 max-w-md mx-auto mb-8">
                            <h3 className="font-display text-lg text-white mb-4">What happens next?</h3>
                            <ul className="text-left space-y-3 text-sm">
                                {[
                                    'Our team reviews your design (usually within 24 hours)',
                                    "You'll get an email when it's approved",
                                    'Your product goes live on the marketplace',
                                    'Earn 10% ITC on every sale - forever!'
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-purple-100/80">
                                        <span className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <svg className="w-3 h-3 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                        </span>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 md:gap-4">
                            <Link
                                to="/my-products"
                                className="px-6 py-3 bg-white/5 border border-white/10 text-purple-200 font-semibold rounded-xl hover:bg-white/10 transition-all"
                            >
                                View My Products
                            </Link>
                            <button
                                onClick={() => {
                                    // Reset for creating another product
                                    setCurrentStep('welcome')
                                    setFormData({ prompt: '', imageStyle: '', shirtColor: 'black' })
                                    setProductId(null)
                                    setGeneratedImages([])
                                    setSelectedImageId(null)
                                    setSubmitted(false)
                                    setAiMessage('')
                                    setProgress(0)
                                    setShowIntro(true)
                                }}
                                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all"
                            >
                                Create Another Design
                            </button>
                        </div>
                    </div>
                )}

                {/* How It Works - Bottom Section */}
                {currentStep === 'welcome' && (
                    <div className="mt-8 md:mt-12 animate-fade-up-delay-2">
                        <h3 className="font-display text-lg md:text-xl text-purple-200/80 text-center mb-6">How it works</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                            {[
                                { icon: '🎤', title: 'Speak Your Vision', desc: 'Tell Mr. Imagine what you want to create' },
                                { icon: '✨', title: 'AI Magic', desc: 'Watch as your design comes to life in seconds' },
                                { icon: '💰', title: 'Earn Rewards', desc: 'Publish and earn 10% on every sale' },
                            ].map((step, idx) => (
                                <div key={idx} className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 md:p-6 text-center border border-white/10">
                                    <div className="text-3xl md:text-4xl mb-3">{step.icon}</div>
                                    <h4 className="font-semibold text-white mb-1 text-sm md:text-base">{step.title}</h4>
                                    <p className="text-purple-200/50 text-xs md:text-sm">{step.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
