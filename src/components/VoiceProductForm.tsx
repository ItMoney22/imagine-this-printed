import { useState, useEffect } from 'react'
import axios from 'axios'
import { supabase } from '../lib/supabase'
import { VoiceConversationEnhanced } from './VoiceConversationEnhanced'

interface VoiceProductFormProps {
    onComplete: (productId: string) => void
}

const AI_MESSAGES = {
    welcome: "Hi! I'm your AI design assistant. Let's create an amazing product together! What would you like to print?",
    afterPrompt: "That's a great idea! Now, what style would you like for your design?",
    afterImageStyle: "Perfect choice! For the best print quality, I need to know what shirt color you're thinking of.",
    afterDTFSettings: "Excellent! I'm generating your design now. This usually takes about 30 seconds...",
    generationComplete: "Your design is ready! You can now remove the background, create mockups, or publish it to the marketplace. What would you like to do?",
}

export const VoiceProductForm = ({ onComplete }: VoiceProductFormProps) => {
    const [currentStep, setCurrentStep] = useState(1)
    const [isListening, setIsListening] = useState(false)
    const [aiMessage, setAiMessage] = useState(AI_MESSAGES.welcome)

    const [formData, setFormData] = useState({
        prompt: '',
        imageStyle: 'realistic' as 'realistic' | 'cartoon',
        shirtColor: 'black' as 'black' | 'white' | 'grey' | 'color',
        printStyle: 'dtf' as 'dtf' | 'screen-print',
        background: 'transparent'
    })

    const [productId, setProductId] = useState<string | null>(null)
    const [jobStatus, setJobStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle')
    const [progress, setProgress] = useState(0)
    const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null)

    // AI Brain Integration
    const getAIResponse = async (userInput: string, context: string) => {
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            const { data } = await axios.post('/api/ai/chat', {
                model: 'gpt-5.1',
                message: userInput,
                context: context,
                systemPrompt: "You are an expert AI design assistant for a print-on-demand site. Your goal is to help customers create amazing products. Be enthusiastic, helpful, and concise. Guide them through the creation process. Keep your responses short and conversational."
            }, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
            setAiMessage(data.response)
        } catch (error) {
            console.warn('AI Brain offline, falling back to local responses')
        }
    }

    // Step 1: Handle prompt input
    const handlePromptInput = async (text: string) => {
        setFormData(prev => ({ ...prev, prompt: text }))
        // Get AI reaction to the idea
        await getAIResponse(text, "User just described their product idea. Compliment it and ask for the image style (Realistic or Artistic).")
    }

    // Advance to next step and update AI message
    const nextStep = async (step: number) => {
        setCurrentStep(step)

        if (step === 2) {
            // Already handled by handlePromptInput usually, but if manually clicked:
            if (aiMessage === AI_MESSAGES.welcome) {
                setAiMessage(AI_MESSAGES.afterPrompt)
            }
        }
        if (step === 3) {
            await getAIResponse(`Selected style: ${formData.imageStyle}`, "User selected the image style. Now ask them to choose a shirt color (Black, White, Grey, or Color) for the best print result.")
        }
        if (step === 4) {
            setAiMessage("I'm creating your design now. This will just take a moment.")
            startGeneration()
        }
    }

    const startGeneration = async () => {
        setJobStatus('generating')
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            if (!token) throw new Error('Authentication required')

            const { data } = await axios.post('/api/admin/products/ai/create', {
                prompt: formData.prompt,
                imageStyle: formData.imageStyle,
                shirtColor: formData.shirtColor,
                printStyle: formData.printStyle,
                background: 'transparent',
                mockupStyle: 'realistic',
                tone: 'professional',
                useSearch: false,
                priceTarget: 2500
            }, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setProductId(data.productId)
        } catch (error) {
            console.error('Generation failed:', error)
            setJobStatus('error')
            setAiMessage("I apologize, but I encountered an error starting the generation. Please try again.")
        }
    }

    // Poll status endpoint
    useEffect(() => {
        if (!productId || jobStatus !== 'generating') return

        const interval = setInterval(async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession()
                const token = session?.access_token

                const { data } = await axios.get(`/api/admin/products/ai/${productId}/status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                })
                const imageJob = data.jobs.find((j: any) => j.type === 'replicate_image')

                if (imageJob?.status === 'succeeded') {
                    setJobStatus('success')
                    setProgress(100)
                    setAiMessage(AI_MESSAGES.generationComplete)
                    if (data.assets && data.assets.length > 0) {
                        setGeneratedImageUrl(data.assets[0].url)
                    }
                } else if (imageJob?.status === 'failed') {
                    setJobStatus('error')
                    setAiMessage("I'm sorry, but the design generation failed. Please try again.")
                } else {
                    setProgress((prev) => Math.min(prev + 5, 90))
                }
            } catch (e) {
                console.error("Polling error", e)
            }
        }, 2000)

        return () => clearInterval(interval)
    }, [productId, jobStatus])

    const handleRemoveBackground = async () => {
        if (!productId) return
        setAiMessage("Removing the background for you now.")
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token
            await axios.post(`/api/admin/products/ai/${productId}/remove-background`, {}, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
        } catch (e) {
            setAiMessage("I couldn't start the background removal. Please try again.")
        }
    }

    const handleCreateMockups = async () => {
        if (!productId) return
        setAiMessage("Creating product mockups so you can see how it looks.")
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token
            await axios.post(`/api/admin/products/ai/${productId}/create-mockups`, {}, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
        } catch (e) {
            setAiMessage("I couldn't start the mockup creation. Please try again.")
        }
    }

    const handleDownloadDTF = () => {
        alert('Download DTF not implemented yet')
    }

    const handlePublish = () => {
        if (productId) {
            onComplete(productId)
        }
    }

    return (
        <div className="max-w-2xl mx-auto">
            {/* Voice Interface */}
            <div className="mb-8">
                <VoiceConversationEnhanced
                    onTextInput={handlePromptInput}
                    autoMicOn={true}
                    conversationalMode={true}
                    textToSpeak={aiMessage}
                />
            </div>

            {/* Step 1: Product Description */}
            {currentStep === 1 && (
                <div className="space-y-6 animate-fade-in">
                    <div className="bg-card/60 backdrop-blur-md border border-primary/20 rounded-2xl p-6 shadow-glowSm">
                        <p className="text-text font-display text-lg leading-relaxed">
                            {AI_MESSAGES.welcome}
                        </p>
                    </div>

                    <div>
                        <label className="block text-muted text-sm mb-3 font-display tracking-wider uppercase">Or type your vision</label>
                        <textarea
                            value={formData.prompt}
                            onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                            className="w-full bg-bg/40 border border-white/10 rounded-xl p-5 text-text resize-none focus:border-primary focus:ring-1 focus:ring-primary/50 focus:outline-none transition-all placeholder:text-white/20 text-lg"
                            rows={4}
                            placeholder="Example: A futuristic cyberpunk dragon breathing neon blue fire..."
                        />
                    </div>

                    <button
                        onClick={() => nextStep(2)}
                        disabled={!formData.prompt}
                        className="w-full bg-white/10 hover:bg-white/20 border border-white/10 text-white font-display py-4 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-glowSm"
                    >
                        Continue to Style Selection
                    </button>
                </div>
            )}

            {/* Step 2: Image Style Selection */}
            {currentStep === 2 && (
                <div className="grid grid-cols-2 gap-6 animate-fade-in">
                    <button
                        onClick={() => {
                            setFormData({ ...formData, imageStyle: 'realistic' })
                            nextStep(3)
                        }}
                        className={`
              relative overflow-hidden group bg-card/40 backdrop-blur-xl border rounded-2xl p-8 text-center transition-all duration-300 hover:scale-105
              ${formData.imageStyle === 'realistic'
                                ? 'border-primary shadow-glow bg-primary/10'
                                : 'border-white/10 hover:border-primary/50'}
            `}
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="relative z-10">
                            <div className="text-6xl mb-4 drop-shadow-lg">📷</div>
                            <h3 className="font-display text-2xl text-white mb-2">Realistic</h3>
                            <p className="text-muted text-sm">Photo-quality details & textures</p>
                        </div>
                    </button>

                    <button
                        onClick={() => {
                            setFormData({ ...formData, imageStyle: 'cartoon' })
                            nextStep(3)
                        }}
                        className={`
              relative overflow-hidden group bg-card/40 backdrop-blur-xl border rounded-2xl p-8 text-center transition-all duration-300 hover:scale-105
              ${formData.imageStyle === 'cartoon'
                                ? 'border-secondary shadow-glow bg-secondary/10'
                                : 'border-white/10 hover:border-secondary/50'}
            `}
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-secondary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="relative z-10">
                            <div className="text-6xl mb-4 drop-shadow-lg">🎨</div>
                            <h3 className="font-display text-2xl text-white mb-2">Artistic</h3>
                            <p className="text-muted text-sm">Vibrant illustrations & stylized art</p>
                        </div>
                    </button>
                </div>
            )}

            {/* Step 3: DTF Settings */}
            {currentStep === 3 && (
                <div className="space-y-8 animate-fade-in">
                    {/* Shirt Color */}
                    <div className="bg-card/40 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                        <label className="block text-white font-display text-lg mb-4">Select Shirt Color</label>
                        <div className="grid grid-cols-4 gap-4">
                            {[
                                { value: 'black', label: 'Black', color: 'bg-black', border: 'border-white/20' },
                                { value: 'white', label: 'White', color: 'bg-white', border: 'border-gray-800' },
                                { value: 'grey', label: 'Grey', color: 'bg-gray-600', border: 'border-white/20' },
                                { value: 'color', label: 'Color', color: 'bg-gradient-to-br from-red-500 via-yellow-500 to-blue-500', border: 'border-white/20' },
                            ].map(({ value, label, color, border }) => (
                                <button
                                    key={value}
                                    onClick={() => setFormData({ ...formData, shirtColor: value as any })}
                                    className={`
                    ${color} ${border} border-2 rounded-xl h-24 flex items-center justify-center transition-all duration-300 transform hover:scale-105
                    ${formData.shirtColor === value ? 'ring-4 ring-primary shadow-glow scale-105' : 'opacity-70 hover:opacity-100'}
                  `}
                                >
                                    <span className={`font-display font-bold ${value === 'white' ? 'text-black' : 'text-white drop-shadow-md'}`}>
                                        {label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Print Style */}
                    <div className="bg-card/40 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                        <label className="block text-white font-display text-lg mb-4">Print Technology</label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setFormData({ ...formData, printStyle: 'dtf' })}
                                className={`
                  p-5 text-left rounded-xl border transition-all duration-300
                  ${formData.printStyle === 'dtf'
                                        ? 'bg-primary/20 border-primary shadow-glow'
                                        : 'bg-bg/30 border-white/10 hover:bg-bg/50'}
                `}
                            >
                                <h4 className="font-display text-white text-lg mb-1">DTF Transfer</h4>
                                <p className="text-muted text-sm">High detail, unlimited colors</p>
                            </button>

                            <button
                                onClick={() => setFormData({ ...formData, printStyle: 'screen-print' })}
                                className={`
                  p-5 text-left rounded-xl border transition-all duration-300
                  ${formData.printStyle === 'screen-print'
                                        ? 'bg-secondary/20 border-secondary shadow-glow'
                                        : 'bg-bg/30 border-white/10 hover:bg-bg/50'}
                `}
                            >
                                <h4 className="font-display text-white text-lg mb-1">Screen Print</h4>
                                <p className="text-muted text-sm">Bold colors, durable finish</p>
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => nextStep(4)}
                        className="w-full bg-gradient-to-r from-primary to-secondary text-white font-display text-xl py-4 rounded-xl hover:shadow-glowLg transition-all transform hover:scale-[1.02]"
                    >
                        ✨ Generate Masterpiece
                    </button>
                </div>
            )}

            {/* Step 4: Generation Progress */}
            {currentStep === 4 && jobStatus !== 'success' && (
                <div className="text-center space-y-8 animate-fade-in py-12">
                    <div className="relative w-48 h-48 mx-auto">
                        {/* Outer Glow */}
                        <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />

                        <svg className="transform -rotate-90 w-48 h-48 relative z-10 drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
                            <circle
                                cx="96"
                                cy="96"
                                r="88"
                                stroke="currentColor"
                                strokeWidth="8"
                                fill="transparent"
                                className="text-white/5"
                            />
                            <circle
                                cx="96"
                                cy="96"
                                r="88"
                                stroke="url(#gradient)"
                                strokeWidth="8"
                                fill="transparent"
                                strokeDasharray={2 * Math.PI * 88}
                                strokeDashoffset={2 * Math.PI * 88 * (1 - progress / 100)}
                                strokeLinecap="round"
                                className="transition-all duration-500"
                            />
                            <defs>
                                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#9333ea" />
                                    <stop offset="100%" stopColor="#3b82f6" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
                            <span className="text-4xl font-display font-bold text-white">{progress}%</span>
                            <span className="text-xs text-muted uppercase tracking-widest mt-1">Processing</span>
                        </div>
                    </div>

                    <div>
                        <h3 className="font-display text-2xl text-white mb-3 animate-pulse">Crafting Your Vision...</h3>
                        <p className="text-muted text-lg">Our AI is dreaming up something unique</p>
                    </div>

                    <div className="flex items-center justify-center gap-3">
                        <div className="w-3 h-3 bg-primary rounded-full animate-bounce" />
                        <div className="w-3 h-3 bg-secondary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                        <div className="w-3 h-3 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                </div>
            )}

            {/* Step 5: Post-Generation Options */}
            {currentStep === 4 && jobStatus === 'success' && (
                <div className="space-y-8 animate-fade-in">
                    {/* Generated Image Preview */}
                    <div className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-3xl p-2 shadow-2xl relative group">
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl z-10" />
                        {generatedImageUrl ? (
                            <img
                                src={generatedImageUrl}
                                alt="Generated design"
                                className="w-full rounded-2xl shadow-inner"
                            />
                        ) : (
                            <div className="w-full h-80 bg-black/40 rounded-2xl flex items-center justify-center text-muted border border-white/5">
                                Image not available
                            </div>
                        )}
                        <div className="absolute bottom-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="bg-black/50 backdrop-blur-md text-white px-4 py-2 rounded-lg text-sm border border-white/20 hover:bg-black/70">
                                🔍 Zoom
                            </button>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={handleRemoveBackground}
                            className="bg-card/60 backdrop-blur-md border border-white/10 rounded-xl p-5 hover:bg-card/80 hover:border-primary/50 transition-all group text-left"
                        >
                            <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">🎭</div>
                            <h4 className="font-display text-white text-lg">Remove Background</h4>
                            <p className="text-muted text-sm">Make transparent</p>
                        </button>

                        <button
                            onClick={handleCreateMockups}
                            className="bg-card/60 backdrop-blur-md border border-white/10 rounded-xl p-5 hover:bg-card/80 hover:border-secondary/50 transition-all group text-left"
                        >
                            <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">👕</div>
                            <h4 className="font-display text-white text-lg">Create Mockups</h4>
                            <p className="text-muted text-sm">See on products</p>
                        </button>

                        <button
                            onClick={handleDownloadDTF}
                            className="bg-card/60 backdrop-blur-md border border-white/10 rounded-xl p-5 hover:bg-card/80 hover:border-accent/50 transition-all group text-left"
                        >
                            <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">📄</div>
                            <h4 className="font-display text-white text-lg">DTF Sheet</h4>
                            <p className="text-muted text-sm">Print-ready file</p>
                        </button>

                        <button
                            onClick={handlePublish}
                            className="bg-gradient-to-br from-primary to-secondary text-white rounded-xl p-5 hover:shadow-glow transition-all group text-left relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                            <div className="relative z-10">
                                <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">🚀</div>
                                <h4 className="font-display text-lg font-bold">Publish & Sell</h4>
                                <p className="text-white/80 text-sm">List for sale</p>
                            </div>
                        </button>
                    </div>

                    {/* Earnings Info */}
                    <div className="bg-gradient-to-r from-accent/20 to-primary/20 border border-accent/30 rounded-xl p-4 text-center backdrop-blur-sm">
                        <p className="text-accent font-display text-lg mb-1 flex items-center justify-center gap-2">
                            <span>💰</span> Earn 10% ITC on Every Sale!
                        </p>
                        <p className="text-white/70 text-sm">
                            You'll receive ITC credits when customers buy your design
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
