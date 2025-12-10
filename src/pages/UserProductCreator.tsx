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
    const [mrImagineState, setMrImagineState] = useState<'idle' | 'speaking' | 'listening' | 'thinking' | 'happy'>('idle')
    const [welcomePlayed, setWelcomePlayed] = useState(false)
    const welcomeAudioRef = useRef<HTMLAudioElement | null>(null)

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
                    points: user.wallet.pointsBalance || 0
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

    // Cleanup audio on unmount
    useEffect(() => {
        return () => {
            if (welcomeAudioRef.current) {
                welcomeAudioRef.current.pause()
            }
        }
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
        })

        // Update the prompt with what user said
        setFormData(prev => ({ ...prev, prompt: response.user_said }))

        // Display AI's text response
        setAiMessage(response.text)

        // Update Mr. Imagine's state (audio plays from component)
        setMrImagineState('speaking')

        // If we have a design concept and are ready to generate
        if (response.ready_to_generate && response.design_concept) {
            setDesignConcept(response.design_concept)
            setCurrentStep('generating')
        } else if (response.collected_data?.style) {
            // Style has been collected in conversation
            setFormData(prev => ({ ...prev, imageStyle: response.collected_data.style }))
            setCurrentStep('color')
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
            <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-pink-50 relative overflow-hidden flex items-center justify-center">
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="absolute top-20 left-10 w-72 h-72 bg-purple-200/40 rounded-full blur-3xl animate-float" />
                    <div className="absolute bottom-40 right-20 w-96 h-96 bg-pink-200/30 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
                </div>

                <div className="relative z-10 text-center max-w-lg mx-auto px-6">
                    <div className="relative mb-8">
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-500/30 via-pink-500/20 to-transparent rounded-full blur-3xl" />
                        <img
                            src="/mr-imagine/mr-imagine-waist-up-thinking.png"
                            alt="Mr. Imagine"
                            className="w-48 h-auto mx-auto relative z-10 drop-shadow-2xl"
                        />
                    </div>

                    <h1 className="font-serif text-3xl md:text-4xl text-gray-900 mb-4">
                        Become a <span className="text-gradient">Creator</span>
                    </h1>
                    <p className="text-gray-600 text-lg mb-6 leading-relaxed">
                        Hey there! To create and sell your own designs on the marketplace,
                        you'll need to become a vendor first. It's easy, and you'll earn
                        <span className="font-bold text-green-600"> 10% royalty</span> on every sale!
                    </p>

                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6 mb-8">
                        <h3 className="font-semibold text-green-800 mb-3 flex items-center justify-center gap-2">
                            <span className="text-xl">💰</span> Creator Benefits
                        </h3>
                        <ul className="text-left text-green-700 space-y-2 text-sm">
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5">✓</span>
                                Earn 10% ITC royalty on every sale
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5">✓</span>
                                Your designs featured on the marketplace
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5">✓</span>
                                Build your own brand and following
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-0.5">✓</span>
                                Mr. Imagine helps you create amazing designs
                            </li>
                        </ul>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Link
                            to="/become-vendor"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl shadow-lg hover:shadow-purple-500/40 transition-all"
                        >
                            <span>🚀</span> Apply to Become a Vendor
                        </Link>
                        <Link
                            to="/"
                            className="text-gray-500 hover:text-purple-600 text-sm font-medium"
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
            <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-pink-50 relative overflow-hidden flex items-center justify-center">
                {/* Decorative Background */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="absolute top-20 left-10 w-72 h-72 bg-purple-200/40 rounded-full blur-3xl animate-float" />
                    <div className="absolute bottom-40 right-20 w-96 h-96 bg-pink-200/30 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
                </div>

                {/* Intro Card */}
                <div className="relative z-10 text-center max-w-lg mx-auto px-6">
                    {/* Mr. Imagine Character */}
                    <div className="relative mb-8">
                        <div className="absolute inset-0 bg-gradient-to-t from-purple-500/30 via-pink-500/20 to-transparent rounded-full blur-3xl" />
                        <img
                            src="/mr-imagine/mr-imagine-waist-up-happy.png"
                            alt="Mr. Imagine"
                            className="w-56 h-auto mx-auto relative z-10 drop-shadow-2xl animate-float"
                        />
                    </div>

                    <h1 className="font-serif text-4xl md:text-5xl text-gray-900 mb-4">
                        Meet <span className="text-gradient">Mr. Imagine</span>
                    </h1>
                    <p className="text-gray-600 text-lg mb-8 leading-relaxed">
                        Ready to create something amazing? Just describe your dream design
                        and Mr. Imagine will bring it to life! If you can imagine it, we can print it.
                    </p>

                    {/* ITC Balance Display */}
                    <div className="inline-flex items-center gap-4 px-6 py-3 bg-white/80 backdrop-blur rounded-full shadow-lg mb-6">
                        <span className="flex items-center gap-2 text-yellow-600 font-semibold">
                            <span className="text-lg">💰</span> {wallet.itc_balance} ITC
                        </span>
                        <span className="text-gray-300">|</span>
                        <span className="text-gray-500 text-sm">Cost: {GENERATION_COST_ITC} ITC per design</span>
                    </div>

                    <button
                        onClick={startExperience}
                        className="group relative inline-flex items-center gap-3 px-10 py-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-lg rounded-2xl shadow-2xl shadow-purple-500/40 hover:shadow-purple-500/60 transition-all duration-300 hover:-translate-y-1"
                    >
                        <span className="text-2xl group-hover:scale-110 transition-transform">🎨</span>
                        Start Creating
                        <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                    </button>

                    <p className="mt-6 text-sm text-gray-400">
                        Click to enable audio experience
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-pink-50 relative overflow-hidden">
            {/* Decorative Background Elements */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {/* Floating orbs */}
                <div className="absolute top-20 left-10 w-72 h-72 bg-purple-200/40 rounded-full blur-3xl animate-float" />
                <div className="absolute bottom-40 right-20 w-96 h-96 bg-pink-200/30 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-purple-100/50 to-transparent rounded-full" />

                {/* Subtle grid pattern */}
                <div
                    className="absolute inset-0 opacity-[0.015]"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239333ea' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
                    }}
                />
            </div>

            {/* Header */}
            <header className="relative z-10 px-6 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3 group">
                        <img src="/itp-logo-v3.png" alt="ITP" className="h-10 w-auto" />
                        <span className="font-serif text-xl text-gray-800 group-hover:text-purple-600 transition-colors">
                            Imagine This Printed
                        </span>
                    </Link>

                    <div className="flex items-center gap-4">
                        {/* My Designs Button */}
                        <button
                            onClick={() => setShowHistorySidebar(true)}
                            className="relative flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full shadow-sm hover:shadow-md transition-all"
                        >
                            <span className="text-purple-500">📁</span>
                            <span className="font-medium text-gray-700 text-sm">My Designs</span>
                            {hasDrafts && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full border-2 border-white" />
                            )}
                        </button>
                        {/* ITC Balance Display */}
                        <Link to="/wallet" className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full shadow-sm hover:shadow-md transition-all">
                            <span className="text-yellow-500">💰</span>
                            <span className="font-semibold text-gray-800">{wallet.itc_balance} ITC</span>
                        </Link>
                        <div className="hidden md:flex items-center gap-2">
                            <span className="text-sm text-gray-500">Creating as</span>
                            <span className="font-medium text-gray-800">{user.username || user.email}</span>
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
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md mx-4 p-8 text-center">
                        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-yellow-100 to-amber-100 flex items-center justify-center">
                            <span className="text-4xl">💰</span>
                        </div>
                        <h3 className="font-serif text-2xl text-gray-900 mb-3">Not Enough Credits</h3>
                        <p className="text-gray-600 mb-2">
                            Design generation costs <span className="font-bold text-purple-600">{requiredCredits} ITC</span>
                        </p>
                        <p className="text-gray-500 text-sm mb-6">
                            You currently have <span className="font-bold text-gray-700">{wallet.itc_balance} ITC</span>
                        </p>
                        <div className="flex flex-col gap-3">
                            <Link
                                to="/wallet"
                                className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:shadow-lg transition-all"
                            >
                                Get More ITC
                            </Link>
                            <button
                                onClick={() => setShowInsufficientCreditsModal(false)}
                                className="w-full py-3 border-2 border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="relative z-10 max-w-5xl mx-auto px-6 py-8">
                {/* Title Section */}
                <div className="text-center mb-8">
                    <h1 className="font-serif text-4xl md:text-5xl text-gray-900 mb-3">
                        Create with <span className="text-gradient">Mr. Imagine</span>
                    </h1>
                    <p className="text-gray-600 text-lg max-w-xl mx-auto">
                        Just describe your dream design and watch the magic happen!
                    </p>
                </div>

                {/* Voice Interface Card */}
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-purple-500/10 border border-purple-100/50 p-8 md:p-12 mb-8">
                    {/* Mr. Imagine + Voice Interface */}
                    <VoiceConversationEnhanced
                        onTextInput={handleTextInput}
                        onVoiceResponse={handleVoiceResponse}
                        autoMicOn={false}
                        conversationalMode={true}
                        mrImagineState={mrImagineState}
                    />

                    {/* Mr. Imagine's Text Response Display */}
                    {aiMessage && (
                        <div className="mt-6 max-w-2xl mx-auto animate-fade-in">
                            <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-2xl p-6 shadow-inner">
                                <div className="flex items-start gap-4">
                                    {/* Mini Mr. Imagine avatar */}
                                    <div className="flex-shrink-0">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shadow-lg">
                                            <span className="text-2xl">🎨</span>
                                        </div>
                                    </div>
                                    {/* Speech bubble */}
                                    <div className="flex-1">
                                        <p className="text-xs text-purple-500 font-semibold uppercase tracking-wider mb-2">Mr. Imagine says:</p>
                                        <p className="text-gray-800 text-lg leading-relaxed font-medium">{aiMessage}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Text Input Toggle */}
                    {currentStep === 'welcome' && (
                        <div className="mt-8 text-center">
                            <button
                                onClick={() => setShowTextInput(!showTextInput)}
                                className="text-purple-500 hover:text-purple-600 text-sm font-medium underline underline-offset-4"
                            >
                                {showTextInput ? 'Hide text input' : 'Prefer to type instead?'}
                            </button>

                            {showTextInput && (
                                <div className="mt-4 max-w-lg mx-auto animate-fade-in">
                                    <textarea
                                        value={formData.prompt}
                                        onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                                        placeholder="Describe your dream design... e.g., 'A majestic phoenix rising from purple flames'"
                                        className="w-full p-4 rounded-2xl border-2 border-purple-100 focus:border-purple-300 focus:ring-4 focus:ring-purple-100 transition-all resize-none text-gray-800 placeholder:text-gray-400"
                                        rows={3}
                                    />
                                    <button
                                        onClick={handleTextSubmit}
                                        disabled={!formData.prompt.trim()}
                                        className="mt-3 w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Create This Design
                                    </button>
                                </div>
                            )}

                            {/* Trending Prompts - Inspiration Gallery */}
                            <div className="mt-8 max-w-2xl mx-auto">
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
                        <h2 className="font-serif text-2xl text-gray-800 text-center mb-6">Choose Your Style</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                            <button
                                onClick={() => handleStyleSelect('realistic')}
                                className="group relative bg-white rounded-2xl p-8 border-2 border-purple-100 hover:border-purple-400 transition-all hover:shadow-xl hover:shadow-purple-500/20 hover:-translate-y-1"
                            >
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative">
                                    <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center text-4xl">
                                        📸
                                    </div>
                                    <h3 className="font-serif text-xl text-gray-800 mb-2">Photo-Realistic</h3>
                                    <p className="text-gray-500 text-sm">Detailed, lifelike imagery with rich textures</p>
                                </div>
                            </button>

                            <button
                                onClick={() => handleStyleSelect('cartoon')}
                                className="group relative bg-white rounded-2xl p-8 border-2 border-purple-100 hover:border-pink-400 transition-all hover:shadow-xl hover:shadow-pink-500/20 hover:-translate-y-1"
                            >
                                <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative">
                                    <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-4xl">
                                        🎨
                                    </div>
                                    <h3 className="font-serif text-xl text-gray-800 mb-2">Artistic</h3>
                                    <p className="text-gray-500 text-sm">Stylized illustrations with bold, vibrant colors</p>
                                </div>
                            </button>
                        </div>
                    </div>
                )}

                {/* Color Selection Step */}
                {currentStep === 'color' && (
                    <div className="animate-fade-in">
                        <h2 className="font-serif text-2xl text-gray-800 text-center mb-6">Select Shirt Color</h2>
                        <p className="text-gray-500 text-center mb-8">This helps optimize the design for best print quality</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
                            {[
                                { value: 'black', label: 'Black', bg: 'bg-gray-900', text: 'text-white' },
                                { value: 'white', label: 'White', bg: 'bg-white border-2 border-gray-200', text: 'text-gray-800' },
                                { value: 'grey', label: 'Grey', bg: 'bg-gray-400', text: 'text-white' },
                                { value: 'color', label: 'Colorful', bg: 'bg-gradient-to-br from-red-400 via-yellow-400 to-blue-400', text: 'text-white' },
                            ].map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => handleColorSelect(option.value as any)}
                                    className={`group relative ${option.bg} rounded-2xl p-6 h-32 flex items-center justify-center transition-all hover:scale-105 hover:shadow-xl`}
                                >
                                    <span className={`font-semibold ${option.text}`}>{option.label}</span>
                                    <div className="absolute inset-0 rounded-2xl ring-4 ring-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Generation Progress */}
                {currentStep === 'generating' && (
                    <div className="animate-fade-in text-center py-12">
                        <div className="relative w-40 h-40 mx-auto mb-8">
                            {/* Animated ring */}
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                <circle
                                    cx="50" cy="50" r="45"
                                    fill="none"
                                    stroke="#f3e8ff"
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
                                <span className="text-4xl font-bold text-gray-800">{progress}%</span>
                                <span className="text-sm text-gray-500">Creating</span>
                            </div>
                        </div>

                        <h3 className="font-serif text-2xl text-gray-800 mb-2">
                            Crafting your masterpiece...
                        </h3>
                        <p className="text-gray-500">
                            {progress < 30 ? "Understanding your vision..." :
                                progress < 60 ? "Generating the design..." :
                                    progress < 90 ? "Adding finishing touches..." :
                                        "Almost there!"}
                        </p>

                        {/* Bouncing dots */}
                        <div className="flex justify-center gap-2 mt-6">
                            <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" />
                            <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                            <div className="w-3 h-3 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                        </div>
                    </div>
                )}

                {/* Complete - Show Results */}
                {currentStep === 'complete' && !submitted && (
                    <div className="animate-fade-in">
                        <div className="text-center mb-8">
                            <h2 className="font-serif text-3xl text-gray-800 mb-2">Your Design is Ready!</h2>
                            <p className="text-gray-500">
                                {selectedImageId
                                    ? 'Great choice! Now submit for approval to list on the marketplace.'
                                    : 'Select your favorite design to list on the marketplace'
                                }
                            </p>
                        </div>

                        {/* Generated Images - Selectable */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            {generatedImages.length > 0 ? (
                                generatedImages.map((img, idx) => (
                                    <button
                                        key={img.id}
                                        onClick={() => setSelectedImageId(img.id)}
                                        className={`group relative bg-white rounded-2xl overflow-hidden shadow-lg transition-all ${
                                            selectedImageId === img.id
                                                ? 'ring-4 ring-purple-500 shadow-xl shadow-purple-500/30 scale-[1.02]'
                                                : 'hover:shadow-xl hover:scale-[1.01]'
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
                                        <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity flex items-end p-4 ${
                                            selectedImageId === img.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                        }`}>
                                            <span className="text-white font-medium">
                                                {selectedImageId === img.id ? '✓ Selected' : `Option ${idx + 1}`}
                                            </span>
                                        </div>
                                    </button>
                                ))
                            ) : (
                                <div className="col-span-3 text-center py-12 text-gray-500">
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
                                className={`px-8 py-4 font-semibold rounded-xl transition-all ${
                                    selectedImageId && !submitting
                                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-lg hover:shadow-purple-500/30'
                                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
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
                            <p className="text-center text-gray-400 text-sm mt-4 animate-pulse">
                                👆 Click on an image to select it
                            </p>
                        )}

                        {/* Product Preview Carousel - See design on multiple products */}
                        {selectedImageId && (
                            <div className="mt-8 p-6 bg-white/80 rounded-2xl border border-gray-100">
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
                        <div className="mt-8">
                            <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-400/30 rounded-xl p-5 max-w-md mx-auto">
                                <div className="flex items-center justify-center gap-2 mb-2">
                                    <span className="text-2xl">🎉</span>
                                    <span className="text-xl font-bold text-green-400">10% Creator Royalty!</span>
                                </div>
                                <p className="text-sm text-gray-300 text-center">
                                    Every time someone buys this design, you earn 10% in ITC credits.
                                    That's real money in your pocket!
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Submitted - Success Message */}
                {submitted && (
                    <div className="animate-fade-in text-center py-12">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-xl shadow-green-500/30">
                            <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>

                        <h2 className="font-serif text-3xl text-gray-800 mb-3">Submitted for Review!</h2>
                        <p className="text-gray-600 max-w-md mx-auto mb-8 leading-relaxed">
                            Your design is now being reviewed by our team. Once approved, you'll receive an email
                            with instructions to set up your wallet and start earning from sales!
                        </p>

                        {/* Prominent Royalty Banner */}
                        <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-400/30 rounded-xl p-6 max-w-md mx-auto mb-6">
                            <div className="flex items-center justify-center gap-3 mb-3">
                                <span className="text-3xl">🎉</span>
                                <span className="text-2xl font-bold text-green-400">10% Creator Royalty!</span>
                            </div>
                            <p className="text-gray-300 text-center">
                                Every time someone buys your design, you earn <strong className="text-green-400">10% in ITC credits</strong>.
                                That's real money in your pocket from every sale!
                            </p>
                        </div>

                        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-2xl p-6 max-w-md mx-auto mb-8">
                            <h3 className="font-semibold text-gray-800 mb-3">What happens next?</h3>
                            <ul className="text-left text-gray-600 space-y-2 text-sm">
                                <li className="flex items-start gap-2">
                                    <span className="text-purple-500 mt-0.5">✓</span>
                                    Our team reviews your design (usually within 24 hours)
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-purple-500 mt-0.5">✓</span>
                                    You'll get an email when it's approved
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-purple-500 mt-0.5">✓</span>
                                    Your product goes live on the marketplace
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-purple-500 mt-0.5">✓</span>
                                    Earn 10% ITC on every sale - forever!
                                </li>
                            </ul>
                        </div>

                        <div className="flex flex-wrap justify-center gap-4">
                            <Link
                                to="/my-products"
                                className="px-6 py-3 bg-white border-2 border-purple-200 text-purple-600 font-semibold rounded-xl hover:border-purple-400 hover:bg-purple-50 transition-all"
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
                                className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all"
                            >
                                Create Another Design
                            </button>
                        </div>
                    </div>
                )}

                {/* How It Works - Bottom Section */}
                {currentStep === 'welcome' && (
                    <div className="mt-12 animate-fade-up-delay-2">
                        <h3 className="font-serif text-xl text-gray-700 text-center mb-6">How it works</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[
                                { icon: '🎤', title: 'Speak Your Vision', desc: 'Tell Mr. Imagine what you want to create' },
                                { icon: '✨', title: 'AI Magic', desc: 'Watch as your design comes to life in seconds' },
                                { icon: '💰', title: 'Earn Rewards', desc: 'Publish and earn 10% on every sale' },
                            ].map((step, idx) => (
                                <div key={idx} className="bg-white/60 backdrop-blur-sm rounded-2xl p-6 text-center border border-purple-100/50">
                                    <div className="text-4xl mb-3">{step.icon}</div>
                                    <h4 className="font-semibold text-gray-800 mb-1">{step.title}</h4>
                                    <p className="text-gray-500 text-sm">{step.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
