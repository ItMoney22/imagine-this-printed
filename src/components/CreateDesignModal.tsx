import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Coins, Wand2, ArrowRight, RefreshCw, Save, Mic, MicOff, Loader2, Sparkles, Send, Volume2, Eraser, ZoomIn, Paintbrush, ChevronDown, ChevronUp, CheckCircle, PartyPopper } from 'lucide-react'
import { supabase } from '../lib/supabase'
import confetti from 'canvas-confetti'

interface GeneratedDesign {
  modelId: string
  modelName: string
  imageUrl?: string
  status: 'pending' | 'succeeded' | 'failed'
  error?: string
}

interface CreateDesignModalProps {
  isOpen: boolean
  onClose: () => void
  itcBalance: number
  onDesignCreated?: (designId: string, imageUrl: string) => void
  onBalanceChange?: (newBalance: number) => void
}

// ITC costs for different operations
const ITC_COSTS = {
  generate: 10,
  removeBg: 5,
  upscale: 5,
  reimagine: 10
}

// Style presets for quick selection
const STYLE_PRESETS = [
  { id: 'realistic', label: 'Realistic', emoji: '📸' },
  { id: 'cartoon', label: 'Cartoon', emoji: '🎨' },
  { id: 'minimalist', label: 'Minimalist', emoji: '✨' },
  { id: 'vintage', label: 'Vintage', emoji: '📻' },
  { id: 'cyberpunk', label: 'Cyberpunk', emoji: '🌃' },
  { id: 'fantasy', label: 'Fantasy', emoji: '🐉' },
]

// Category options
const CATEGORIES = [
  { id: 'shirts', label: 'T-Shirts' },
  { id: 'hoodies', label: 'Hoodies' },
  { id: 'tumblers', label: 'Tumblers' },
  { id: 'dtf-transfers', label: 'DTF Transfers' },
]

// AI tool definitions
const AI_TOOLS = [
  {
    id: 'removeBg',
    label: 'Remove Background',
    icon: Eraser,
    cost: ITC_COSTS.removeBg,
    description: 'Make it print-ready with a clean transparent background'
  },
  {
    id: 'upscale',
    label: 'Upscale 2x',
    icon: ZoomIn,
    cost: ITC_COSTS.upscale,
    description: 'Double the resolution for crisp, detailed prints'
  },
  {
    id: 'reimagine',
    label: 'Reimagine',
    icon: Paintbrush,
    cost: ITC_COSTS.reimagine,
    description: 'Add new elements or transform the style'
  },
]

export function CreateDesignModal({
  isOpen,
  onClose,
  itcBalance,
  onDesignCreated,
  onBalanceChange
}: CreateDesignModalProps) {
  const navigate = useNavigate()

  // Form state
  const [prompt, setPrompt] = useState('')
  const [selectedStyle, setSelectedStyle] = useState('realistic')
  const [selectedCategory, setSelectedCategory] = useState('shirts')
  const [colors, setColors] = useState('')

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedDesigns, setGeneratedDesigns] = useState<GeneratedDesign[]>([])
  const [selectedDesignIndex, setSelectedDesignIndex] = useState<number | null>(null)
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [currentBalance, setCurrentBalance] = useState(itcBalance)
  const [error, setError] = useState<string | null>(null)

  // Submission success state
  const [submissionSuccess, setSubmissionSuccess] = useState(false)
  const [submittedDesignId, setSubmittedDesignId] = useState<string | null>(null)

  // AI Tools state
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [isProcessingTool, setIsProcessingTool] = useState(false)
  const [reimaginePrompt, setReimaginPrompt] = useState('')
  const [showTools, setShowTools] = useState(true)
  const [editHistory, setEditHistory] = useState<string[]>([]) // Track image history for undo

  // Voice input state (optional feature)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const recognitionRef = useRef<any>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mr. Imagine responses with TTS
  const [mrImagineMessage, setMrImagineMessage] = useState<string | null>(null)
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string, content: string}>>([])

  // Sync with prop changes
  useEffect(() => {
    setCurrentBalance(itcBalance)
  }, [itcBalance])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPrompt('')
      setSelectedStyle('realistic')
      setSelectedCategory('shirts')
      setColors('')
      setGeneratedDesigns([])
      setSelectedDesignIndex(null)
      setHasGeneratedOnce(false)
      setError(null)
      setMrImagineMessage(null)
      setConversationHistory([])
      setActiveTool(null)
      setReimaginPrompt('')
      setEditHistory([])
      setSubmissionSuccess(false)
      setSubmittedDesignId(null)

      // Clear speech queue to prevent leftover messages
      speechQueueRef.current = []
      isProcessingSpeechRef.current = false

      // Get dynamic welcome from Mr. Imagine
      setTimeout(() => {
        getMrImagineResponse('greeting', '')
      }, 500)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Initialize speech recognition for optional voice input
  useEffect(() => {
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('')

        setPrompt(prev => prev + ' ' + transcript)
      }

      recognitionRef.current.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current.onerror = () => {
        setIsListening(false)
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
      }
    }
  }, [])

  // Audio element ref for playing Mr. Imagine's voice
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Speech queue to prevent overlapping messages
  const speechQueueRef = useRef<string[]>([])
  const isProcessingSpeechRef = useRef(false)

  // Get dynamic response from Mr. Imagine via GPT
  const getMrImagineResponse = async (context: string, userInput: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        // Fallback to static messages if not authenticated
        speakMessage(getStaticFallback(context))
        return
      }

      const apiBase = import.meta.env.VITE_API_BASE || ''

      // Build context message for GPT
      let contextMessage = ''
      switch (context) {
        case 'greeting':
          contextMessage = "The user just opened the design creation modal. Give them an enthusiastic, creative welcome. Be funny and unique - make them smile! Keep it to 1-2 sentences."
          break
        case 'generating':
          contextMessage = `The user is generating a design with this concept: "${userInput}". Say something funny and encouraging while they wait. Be creative! 1-2 sentences.`
          break
        case 'generated':
          contextMessage = `The design is ready! The concept was: "${userInput}". Celebrate with them in a fun, unique way. Maybe make a joke about their idea. 1-2 sentences.`
          break
        case 'selected':
          contextMessage = "The user just selected a design they like. Be excited but also let them know they can enhance it with our AI tools. Be playful! 1-2 sentences."
          break
        case 'tool_removeBg':
          contextMessage = "The user is about to remove the background from their design. Make a funny comment about giving backgrounds the boot or something creative. 1 sentence."
          break
        case 'tool_upscale':
          contextMessage = "The user is upscaling their design. Make a fun comment about going bigger or HD-ifying things. 1 sentence."
          break
        case 'tool_reimagine':
          contextMessage = `The user wants to reimagine their design with this prompt: "${userInput}". Get excited about the transformation. Be creative! 1 sentence.`
          break
        case 'tool_complete':
          contextMessage = `The AI enhancement is done! Say something satisfying about the result. Be playful and encouraging. 1 sentence.`
          break
        case 'error':
          contextMessage = "Something went wrong. Make light of it in a friendly way and encourage them to try again. Be funny but supportive. 1-2 sentences."
          break
        case 'insufficient_balance':
          contextMessage = "The user doesn't have enough ITC tokens. Gently encourage them to top up their wallet. Maybe make a light joke about it. 1-2 sentences."
          break
        default:
          contextMessage = userInput
      }

      const response = await fetch(`${apiBase}/api/ai/mr-imagine/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          message: contextMessage,
          conversationHistory: conversationHistory.slice(-6) // Keep last 6 messages for context
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.response) {
          // Update conversation history
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: contextMessage },
            { role: 'assistant', content: data.response }
          ])
          speakMessage(data.response)
          return
        }
      }

      // Fallback to static message if API fails
      speakMessage(getStaticFallback(context))
    } catch (error) {
      console.error('[Mr. Imagine] GPT error:', error)
      speakMessage(getStaticFallback(context))
    }
  }

  // Static fallback messages when GPT is unavailable
  const getStaticFallback = (context: string): string => {
    const fallbacks: Record<string, string[]> = {
      greeting: [
        "Hey there! I'm Mr. Imagine. Tell me about your design idea and I'll bring it to life!",
        "Welcome to the creation station! What masterpiece shall we create today?",
        "Oh boy, a new canvas! I'm buzzing with ideas. What's on your mind?"
      ],
      generating: [
        "Let me work my magic... this is gonna be good!",
        "Brewing up something special for you...",
        "My creative gears are spinning! Almost there..."
      ],
      generated: [
        "Ta-da! Here's your design. You can refine it further or create more variations!",
        "Fresh out of the imagination oven! What do you think?",
        "Boom! Check out what we created together!"
      ],
      selected: [
        "Nice choice! You can enhance it with our AI tools or save it for approval.",
        "Great pick! Want to polish it up with some AI magic?",
        "Love your taste! Let's make it even better!"
      ],
      error: [
        "Oops, something went wrong. Let's try that again!",
        "Well that didn't go as planned. Mind if we give it another shot?",
        "My bad! Let's dust ourselves off and try again."
      ],
      default: [
        "I'm here to help! What would you like to do?",
        "Ready when you are!",
        "Let's create something amazing!"
      ]
    }

    const options = fallbacks[context] || fallbacks.default
    return options[Math.floor(Math.random() * options.length)]
  }

  // Process the speech queue - plays one message at a time
  const processSpeechQueue = async () => {
    if (isProcessingSpeechRef.current || speechQueueRef.current.length === 0) {
      return
    }

    isProcessingSpeechRef.current = true
    const message = speechQueueRef.current.shift()!

    try {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }

      setIsSpeaking(true)

      // Get auth token
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        console.warn('[Mr. Imagine] No auth session for voice synthesis')
        setIsSpeaking(false)
        isProcessingSpeechRef.current = false
        processSpeechQueue() // Try next in queue
        return
      }

      // Call the Mr. Imagine voice API
      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/ai/voice/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          text: message,
          speed: 0.95,
          emotion: 'auto'
        })
      })

      if (!response.ok) {
        console.warn('[Mr. Imagine] Voice synthesis failed:', response.status)
        setIsSpeaking(false)
        isProcessingSpeechRef.current = false
        processSpeechQueue() // Try next in queue
        return
      }

      const data = await response.json()

      if (data.audioUrl) {
        // Create and play audio
        const audio = new Audio(data.audioUrl)
        audioRef.current = audio

        audio.onplay = () => setIsSpeaking(true)
        audio.onended = () => {
          setIsSpeaking(false)
          audioRef.current = null
          isProcessingSpeechRef.current = false
          processSpeechQueue() // Process next message in queue
        }
        audio.onerror = () => {
          console.warn('[Mr. Imagine] Audio playback error')
          setIsSpeaking(false)
          audioRef.current = null
          isProcessingSpeechRef.current = false
          processSpeechQueue() // Try next in queue
        }

        await audio.play()
      } else {
        setIsSpeaking(false)
        isProcessingSpeechRef.current = false
        processSpeechQueue() // Try next in queue
      }
    } catch (error) {
      console.error('[Mr. Imagine] Voice error:', error)
      setIsSpeaking(false)
      isProcessingSpeechRef.current = false
      processSpeechQueue() // Try next in queue
    }
  }

  // Mr. Imagine TTS function - queues messages to prevent overlap
  const speakMessage = async (message: string) => {
    setMrImagineMessage(message)

    // Add to queue and process
    speechQueueRef.current.push(message)
    processSpeechQueue()
  }

  // Cleanup audio and speech queue on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      // Clear speech queue
      speechQueueRef.current = []
      isProcessingSpeechRef.current = false
    }
  }, [])

  // Toggle voice input
  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      setError('Voice input not supported in your browser')
      return
    }

    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      recognitionRef.current.start()
      setIsListening(true)
    }
  }

  // Generate design
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe your design idea')
      getMrImagineResponse('error', 'empty prompt')
      return
    }

    if (currentBalance < ITC_COSTS.generate) {
      setError('Insufficient ITC balance')
      getMrImagineResponse('insufficient_balance', '')
      return
    }

    setIsGenerating(true)
    setError(null)
    getMrImagineResponse('generating', prompt)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Please sign in to create designs')
        return
      }

      // Build enriched prompt with DTF print guidelines
      const stylePreset = STYLE_PRESETS.find(s => s.id === selectedStyle)
      let enrichedPrompt = prompt
      if (stylePreset) {
        enrichedPrompt += `\n\nStyle: ${stylePreset.label}`
      }
      if (colors) {
        enrichedPrompt += `\nColors: ${colors}`
      }
      enrichedPrompt += `\nProduct: ${selectedCategory}`

      // Add DTF print-ready guidelines for apparel
      if (['shirts', 'hoodies'].includes(selectedCategory)) {
        enrichedPrompt += `\n\nIMPORTANT - Design for DTF printing on fabric:
- Create a design with a transparent or clean solid background that will print well on fabric
- Use high contrast, bold colors that pop against shirt colors
- Avoid thin lines and small details under 2mm - they may not print clearly
- Design should work on both light and dark garments
- Keep text readable and at least 8pt equivalent
- Avoid gradients that fade to nothing - they look like printing errors`
      }

      // Call API to generate design
      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/imagination-station/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          prompt: enrichedPrompt,
          style: selectedStyle,
          category: selectedCategory,
          numImages: 2
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to generate design')
      }

      const data = await response.json()

      // Backend already handles ITC deduction via pricingService
      // Update the balance display if cost was returned
      if (data.cost && data.cost > 0) {
        const newBalance = currentBalance - data.cost
        setCurrentBalance(newBalance)
        onBalanceChange?.(newBalance)
        setHasGeneratedOnce(true)
      }

      // Set generated designs - handle both formats:
      // 1. Single image: { imageUrl, url, output, cost }
      // 2. Multiple images: { images: [...] }
      const imageUrl = data.imageUrl || data.url || data.output
      if (imageUrl) {
        // Single image response
        setGeneratedDesigns([{
          modelId: `design-${Date.now()}`,
          modelName: 'Mr. Imagine AI',
          imageUrl: imageUrl,
          status: 'succeeded' as const
        }])
        setHasGeneratedOnce(true)
        getMrImagineResponse('generated', prompt)
      } else if (data.images && data.images.length > 0) {
        // Multiple images response
        setGeneratedDesigns(data.images.map((img: any, index: number) => ({
          modelId: img.id || `design-${index}`,
          modelName: img.model || 'AI Generated',
          imageUrl: img.url,
          status: 'succeeded' as const
        })))
        setHasGeneratedOnce(true)
        getMrImagineResponse('generated', prompt)
      } else if (data.jobId) {
        // Poll for results if async
        pollForResults(data.jobId, session.access_token)
      } else {
        throw new Error('No images returned from AI service')
      }

    } catch (err: any) {
      console.error('Generation error:', err)
      setError(err.message || 'Failed to generate design')
      getMrImagineResponse('error', err.message)
    } finally {
      setIsGenerating(false)
    }
  }

  // Poll for async results
  const pollForResults = async (jobId: string, token: string) => {
    const apiBase = import.meta.env.VITE_API_BASE || ''
    let attempts = 0
    const maxAttempts = 60 // 2 minutes max

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setError('Design generation timed out. Please try again.')
        setIsGenerating(false)
        return
      }

      try {
        const response = await fetch(`${apiBase}/api/imagination-station/status/${jobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })

        if (response.ok) {
          const data = await response.json()

          if (data.status === 'completed' && data.images) {
            setGeneratedDesigns(data.images.map((img: any, index: number) => ({
              modelId: img.id || `design-${index}`,
              modelName: img.model || 'AI Generated',
              imageUrl: img.url,
              status: 'succeeded' as const
            })))
            setHasGeneratedOnce(true)
            setIsGenerating(false)
            getMrImagineResponse('generated', prompt)
            return
          } else if (data.status === 'failed') {
            setError(data.error || 'Generation failed')
            setIsGenerating(false)
            return
          }
        }

        attempts++
        setTimeout(poll, 2000)
      } catch (err) {
        console.error('Polling error:', err)
        attempts++
        setTimeout(poll, 2000)
      }
    }

    poll()
  }

  const handleDesignSelect = (index: number) => {
    setSelectedDesignIndex(index)
    setEditHistory([]) // Reset edit history when selecting a new design
    getMrImagineResponse('selected', '')
  }

  // AI Tool handlers
  const handleRemoveBackground = async () => {
    if (selectedDesignIndex === null || !generatedDesigns[selectedDesignIndex]?.imageUrl) return
    if (currentBalance < ITC_COSTS.removeBg) {
      setError(`Insufficient ITC. Need ${ITC_COSTS.removeBg} ITC for background removal.`)
      getMrImagineResponse('insufficient_balance', '')
      return
    }

    setIsProcessingTool(true)
    setActiveTool('removeBg')
    getMrImagineResponse('tool_removeBg', '')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const currentImage = generatedDesigns[selectedDesignIndex].imageUrl!

      // Save current image to history before modifying
      setEditHistory(prev => [...prev, currentImage])

      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/imagination-station/ai/remove-bg`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ imageUrl: currentImage })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Background removal failed')
      }

      const data = await response.json()
      const processedUrl = data.processedUrl || data.imageUrl || data.url

      if (processedUrl) {
        // Update the design with the processed image
        setGeneratedDesigns(prev => prev.map((d, i) =>
          i === selectedDesignIndex ? { ...d, imageUrl: processedUrl } : d
        ))

        // Update balance
        if (data.cost && data.cost > 0) {
          const newBalance = currentBalance - data.cost
          setCurrentBalance(newBalance)
          onBalanceChange?.(newBalance)
        }

        getMrImagineResponse('tool_complete', 'background removed')
      }
    } catch (err: any) {
      console.error('Remove background error:', err)
      setError(err.message || 'Failed to remove background')
      getMrImagineResponse('error', err.message)
    } finally {
      setIsProcessingTool(false)
      setActiveTool(null)
    }
  }

  const handleUpscale = async () => {
    if (selectedDesignIndex === null || !generatedDesigns[selectedDesignIndex]?.imageUrl) return
    if (currentBalance < ITC_COSTS.upscale) {
      setError(`Insufficient ITC. Need ${ITC_COSTS.upscale} ITC for upscaling.`)
      getMrImagineResponse('insufficient_balance', '')
      return
    }

    setIsProcessingTool(true)
    setActiveTool('upscale')
    getMrImagineResponse('tool_upscale', '')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const currentImage = generatedDesigns[selectedDesignIndex].imageUrl!

      // Save current image to history before modifying
      setEditHistory(prev => [...prev, currentImage])

      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/imagination-station/ai/upscale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ imageUrl: currentImage, factor: 2 })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Upscaling failed')
      }

      const data = await response.json()
      const processedUrl = data.processedUrl || data.imageUrl || data.url

      if (processedUrl) {
        // Update the design with the processed image
        setGeneratedDesigns(prev => prev.map((d, i) =>
          i === selectedDesignIndex ? { ...d, imageUrl: processedUrl } : d
        ))

        // Update balance
        if (data.cost && data.cost > 0) {
          const newBalance = currentBalance - data.cost
          setCurrentBalance(newBalance)
          onBalanceChange?.(newBalance)
        }

        getMrImagineResponse('tool_complete', 'upscaled')
      }
    } catch (err: any) {
      console.error('Upscale error:', err)
      setError(err.message || 'Failed to upscale')
      getMrImagineResponse('error', err.message)
    } finally {
      setIsProcessingTool(false)
      setActiveTool(null)
    }
  }

  const handleReimagine = async () => {
    if (selectedDesignIndex === null || !generatedDesigns[selectedDesignIndex]?.imageUrl) return
    if (!reimaginePrompt.trim()) {
      setError('Please describe how you want to transform the design')
      return
    }
    if (currentBalance < ITC_COSTS.reimagine) {
      setError(`Insufficient ITC. Need ${ITC_COSTS.reimagine} ITC for reimagining.`)
      getMrImagineResponse('insufficient_balance', '')
      return
    }

    setIsProcessingTool(true)
    setActiveTool('reimagine')
    getMrImagineResponse('tool_reimagine', reimaginePrompt)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')

      const currentImage = generatedDesigns[selectedDesignIndex].imageUrl!

      // Save current image to history before modifying
      setEditHistory(prev => [...prev, currentImage])

      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/imagination-station/ai/reimagine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          imageUrl: currentImage,
          prompt: reimaginePrompt
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Reimagine failed')
      }

      const data = await response.json()
      const processedUrl = data.processedUrl || data.imageUrl || data.url

      if (processedUrl) {
        // Update the design with the processed image
        setGeneratedDesigns(prev => prev.map((d, i) =>
          i === selectedDesignIndex ? { ...d, imageUrl: processedUrl } : d
        ))

        // Update balance
        if (data.cost && data.cost > 0) {
          const newBalance = currentBalance - data.cost
          setCurrentBalance(newBalance)
          onBalanceChange?.(newBalance)
        }

        setReimaginPrompt('') // Clear the input
        getMrImagineResponse('tool_complete', 'reimagined')
      }
    } catch (err: any) {
      console.error('Reimagine error:', err)
      setError(err.message || 'Failed to reimagine')
      getMrImagineResponse('error', err.message)
    } finally {
      setIsProcessingTool(false)
      setActiveTool(null)
    }
  }

  const handleUndo = () => {
    if (editHistory.length === 0 || selectedDesignIndex === null) return

    const previousImage = editHistory[editHistory.length - 1]
    setEditHistory(prev => prev.slice(0, -1))

    setGeneratedDesigns(prev => prev.map((d, i) =>
      i === selectedDesignIndex ? { ...d, imageUrl: previousImage } : d
    ))

    speakMessage("Whoops, let's go back to the previous version!")
  }

  const handleSaveAsDraft = async () => {
    console.log('[CreateDesignModal] handleSaveAsDraft called, selectedDesignIndex:', selectedDesignIndex)
    if (selectedDesignIndex === null || !generatedDesigns[selectedDesignIndex]?.imageUrl) {
      console.warn('[CreateDesignModal] Early return: no design selected')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      console.log('[CreateDesignModal] Session check:', !!session?.access_token)
      if (!session?.access_token) {
        setError('Please sign in to save your design')
        setIsSaving(false) // Reset isSaving on early return
        return
      }

      const selectedDesign = generatedDesigns[selectedDesignIndex]
      const apiBase = import.meta.env.VITE_API_BASE || ''

      console.log('[CreateDesignModal] Submitting design to:', `${apiBase}/api/imagination-station/designs/submit`)
      console.log('[CreateDesignModal] Design data:', {
        name: prompt.substring(0, 50) || 'My Design',
        preview_url: selectedDesign.imageUrl?.substring(0, 50) + '...',
        style: selectedStyle,
        category: selectedCategory
      })

      // Submit design for admin approval
      const response = await fetch(`${apiBase}/api/imagination-station/designs/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          name: prompt.substring(0, 50) || 'My Design',
          design_concept: prompt,
          preview_url: selectedDesign.imageUrl,
          style: selectedStyle,
          category: selectedCategory
        })
      })

      console.log('[CreateDesignModal] Response status:', response.status, response.ok)

      if (response.ok) {
        const data = await response.json()
        setSubmittedDesignId(data.id)
        setSubmissionSuccess(true)
        onDesignCreated?.(data.id, selectedDesign.imageUrl!)

        // Trigger confetti celebration
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#7c3aed', '#ec4899', '#f59e0b', '#10b981']
        })

        // Second burst
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 60,
            spread: 55,
            origin: { x: 0 }
          })
          confetti({
            particleCount: 50,
            angle: 120,
            spread: 55,
            origin: { x: 1 }
          })
        }, 250)

        getMrImagineResponse('tool_complete', 'design submitted for approval')
      } else {
        const errorData = await response.json().catch(() => ({}))
        setError(errorData.error || 'Failed to save design. Please try again.')
      }
    } catch (err) {
      console.error('Failed to save draft:', err)
      setError('Failed to save design. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEditInImaginationStation = () => {
    if (selectedDesignIndex === null || !generatedDesigns[selectedDesignIndex]?.imageUrl) return

    const selectedDesign = generatedDesigns[selectedDesignIndex]

    navigate('/imagination-station', {
      state: {
        preloadImage: selectedDesign.imageUrl,
        designConcept: prompt
      }
    })
    onClose()
  }

  const handleRegenerate = () => {
    setGeneratedDesigns([])
    setSelectedDesignIndex(null)
    setEditHistory([])
    getMrImagineResponse('greeting', '') // Fresh start
  }

  if (!isOpen) return null

  const insufficientBalance = currentBalance < ITC_COSTS.generate
  const selectedDesign = selectedDesignIndex !== null ? generatedDesigns[selectedDesignIndex] : null
  const canProceed = selectedDesign?.status === 'succeeded' && selectedDesign?.imageUrl

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-4xl max-h-[100vh] sm:max-h-[90vh] mx-0 sm:mx-4 bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-bold text-white truncate">Create Your Design</h2>
              <p className="text-xs sm:text-sm text-purple-300/70 hidden sm:block">Tell Mr. Imagine what you want to create</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5 sm:w-6 sm:h-6 text-white/70" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {insufficientBalance ? (
            // Insufficient balance state
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] sm:min-h-[400px] text-center px-4">
              <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mb-6">
                <Coins className="w-10 h-10 text-amber-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Insufficient ITC Balance</h3>
              <p className="text-purple-300/70 mb-2">
                Design generation costs <span className="font-semibold text-amber-400">{ITC_COSTS.generate} ITC</span>
              </p>
              <p className="text-purple-300/70 mb-6">
                Your current balance: <span className="font-semibold text-white">{currentBalance} ITC</span>
              </p>
              <button
                onClick={() => {
                  onClose()
                  navigate('/wallet')
                }}
                className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-amber-500/30 transition-all"
              >
                Add ITC to Wallet
              </button>
            </div>
          ) : submissionSuccess ? (
            // Submission success screen
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] sm:min-h-[400px] text-center px-4">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mb-6 animate-bounce">
                <PartyPopper className="w-12 h-12 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Design Submitted! 🎉</h3>
              <p className="text-purple-300/80 mb-2 max-w-md">
                Your design has been submitted for review. Our team will review it within 24 hours.
              </p>
              <p className="text-purple-300/60 text-sm mb-6 max-w-md">
                You'll receive an email when your design is approved. Once approved, we'll generate professional mockups!
              </p>

              {/* Preview of submitted design */}
              {selectedDesign?.imageUrl && (
                <div className="w-32 h-32 rounded-xl overflow-hidden border-2 border-green-500/30 mb-6">
                  <img
                    src={selectedDesign.imageUrl}
                    alt="Submitted design"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => navigate('/my-designs')}
                  className="px-6 py-3 border border-purple-400/30 text-purple-300 rounded-xl hover:bg-purple-500/20 transition-colors"
                >
                  View My Designs
                </button>
                <button
                  onClick={onClose}
                  className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-green-500/30 transition-all"
                >
                  Done
                </button>
              </div>
            </div>
          ) : generatedDesigns.length > 0 ? (
            // Generated designs view with AI tools
            <div className="space-y-4">
              {/* Mr. Imagine message */}
              {mrImagineMessage && (
                <div className="flex items-start gap-3 bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    {isSpeaking ? (
                      <Volume2 className="w-5 h-5 text-white animate-pulse" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <p className="text-purple-200 text-sm flex-1">{mrImagineMessage}</p>
                </div>
              )}

              {/* Click instruction - only show before a design is selected */}
              {selectedDesignIndex === null && (
                <div className="flex items-center justify-center gap-2 py-2 text-purple-300/80 text-sm animate-pulse">
                  <span className="text-lg">👆</span>
                  <span>Click on a design to select it and unlock editing tools</span>
                </div>
              )}

              {/* Design grid */}
              <div className="grid grid-cols-2 gap-4">
                {generatedDesigns.map((design, index) => (
                  <button
                    key={design.modelId}
                    onClick={() => handleDesignSelect(index)}
                    disabled={isProcessingTool}
                    className={`relative aspect-square rounded-2xl overflow-hidden border-2 transition-all ${
                      selectedDesignIndex === index
                        ? 'border-purple-500 ring-4 ring-purple-500/30 scale-[1.02]'
                        : 'border-white/10 hover:border-purple-500/50'
                    } ${isProcessingTool ? 'opacity-50' : ''}`}
                  >
                    {design.imageUrl ? (
                      <img
                        src={design.imageUrl}
                        alt={`Design ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-white/5 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                      </div>
                    )}
                    {selectedDesignIndex === index && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm">✓</span>
                      </div>
                    )}
                    {isProcessingTool && selectedDesignIndex === index && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-white animate-spin" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* AI Enhancement Tools */}
              {selectedDesign && (
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowTools(!showTools)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Wand2 className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-white">AI Enhancement Tools</span>
                    </div>
                    {showTools ? (
                      <ChevronUp className="w-4 h-4 text-white/60" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/60" />
                    )}
                  </button>

                  {showTools && (
                    <div className="px-4 pb-4 space-y-3">
                      {/* Tool buttons */}
                      <div className="grid grid-cols-3 gap-2">
                        {AI_TOOLS.map((tool) => (
                          <button
                            key={tool.id}
                            onClick={() => {
                              if (tool.id === 'removeBg') handleRemoveBackground()
                              else if (tool.id === 'upscale') handleUpscale()
                              else if (tool.id === 'reimagine') setActiveTool('reimagine')
                            }}
                            disabled={isProcessingTool}
                            className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
                              activeTool === tool.id
                                ? 'border-purple-500 bg-purple-500/20'
                                : 'border-white/10 bg-white/5 hover:border-purple-500/50'
                            } disabled:opacity-50`}
                          >
                            <tool.icon className="w-5 h-5 text-purple-400" />
                            <span className="text-xs text-white font-medium">{tool.label}</span>
                            <span className="text-xs text-amber-400">{tool.cost} ITC</span>
                          </button>
                        ))}
                      </div>

                      {/* Reimagine prompt input */}
                      {activeTool === 'reimagine' && (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={reimaginePrompt}
                            onChange={(e) => setReimaginPrompt(e.target.value)}
                            placeholder="Describe the transformation (e.g., 'add wings', 'make it glow')"
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => setActiveTool(null)}
                              className="flex-1 px-4 py-2 border border-white/20 text-white/70 rounded-lg text-sm hover:bg-white/10"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleReimagine}
                              disabled={!reimaginePrompt.trim() || isProcessingTool}
                              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-500 disabled:opacity-50"
                            >
                              {isProcessingTool ? 'Processing...' : 'Reimagine'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Undo button */}
                      {editHistory.length > 0 && (
                        <button
                          onClick={handleUndo}
                          disabled={isProcessingTool}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-white/20 text-white/70 rounded-lg text-sm hover:bg-white/10 disabled:opacity-50"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Undo Last Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Info notice about approval */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <p className="text-amber-200 text-sm">
                  <strong>Note:</strong> Your design will be submitted for admin approval. Once approved,
                  professional mockups will be generated and you can start earning commissions!
                </p>
              </div>
            </div>
          ) : (
            // Text input form
            <div className="space-y-6">
              {/* Mr. Imagine message */}
              {mrImagineMessage && (
                <div className="flex items-start gap-3 bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    {isSpeaking ? (
                      <Volume2 className="w-5 h-5 text-white animate-pulse" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <p className="text-purple-200 text-sm flex-1">{mrImagineMessage}</p>
                </div>
              )}

              {/* Main prompt input */}
              <div>
                <label className="block text-sm font-semibold text-white mb-2">
                  Describe Your Design *
                </label>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all resize-none"
                    placeholder="Example: A playful cartoon cat wearing sunglasses, riding a skateboard through a neon city at night..."
                    disabled={isGenerating}
                  />
                  {/* Voice input button */}
                  <button
                    onClick={toggleVoiceInput}
                    disabled={isGenerating}
                    className={`absolute right-3 bottom-3 p-2 rounded-lg transition-all ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
                    }`}
                    title={isListening ? 'Stop listening' : 'Voice input'}
                  >
                    {isListening ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  Be descriptive! Include style, colors, mood, and any specific elements you want.
                </p>
              </div>

              {/* Style presets */}
              <div>
                <label className="block text-sm font-semibold text-white mb-3">
                  Art Style
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {STYLE_PRESETS.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id)}
                      disabled={isGenerating}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        selectedStyle === style.id
                          ? 'border-purple-500 bg-purple-500/20 ring-2 ring-purple-500/30'
                          : 'border-white/10 bg-white/5 hover:border-purple-500/50'
                      }`}
                    >
                      <div className="text-xl mb-1">{style.emoji}</div>
                      <div className="text-xs text-white/80">{style.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category and colors row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Product Category
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    disabled={isGenerating}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all cursor-pointer"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id} className="bg-slate-900">
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Primary Colors (optional)
                  </label>
                  <input
                    type="text"
                    value={colors}
                    onChange={(e) => setColors(e.target.value)}
                    disabled={isGenerating}
                    placeholder="e.g., neon pink, electric blue"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
                  />
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating Your Design...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Design
                    <Send className="w-4 h-4 ml-1" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-white/10 bg-black/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* ITC Balance Display */}
            <div className="flex items-center justify-center sm:justify-start gap-2 px-3 py-2 bg-white/5 rounded-xl text-xs sm:text-sm">
              <Coins className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="text-purple-300/70">
                <span className="font-semibold text-amber-400">{ITC_COSTS.generate} ITC</span>/design
              </span>
              <span className="text-purple-300/40">|</span>
              <span className="text-purple-300/70">
                Bal: <span className="font-semibold text-white">{currentBalance.toLocaleString()}</span>
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              {hasGeneratedOnce && !isGenerating && !isProcessingTool && (
                <button
                  onClick={handleRegenerate}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 border border-white/20 text-white/70 rounded-xl hover:bg-white/10 transition-colors text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Start Over
                </button>
              )}

              {canProceed && !isProcessingTool && !submissionSuccess && (
                <>
                  <button
                    onClick={handleSaveAsDraft}
                    disabled={isSaving}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 border border-purple-400/30 text-purple-300 rounded-xl hover:bg-purple-500/20 transition-colors disabled:opacity-50 text-sm"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Submitting...' : 'Submit for Approval'}
                  </button>

                  <button
                    onClick={handleEditInImaginationStation}
                    className="flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all text-sm"
                  >
                    <span className="hidden sm:inline">Add to Imagination Sheet</span>
                    <span className="sm:hidden">Add to Sheet</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {submissionSuccess && (
                <button
                  onClick={onClose}
                  className="flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-green-500/30 transition-all text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
