import React, { useState, useRef, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Stage, Layer, Image as KonvaImage, Text, Transformer, Rect } from 'react-konva'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { replicateAPI } from '../utils/replicate'
import { gptAssistant } from '../utils/gpt-assistant'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { PRODUCT_TEMPLATES, type ProductTemplateType } from '../utils/product-templates'
import MockupPreview from '../components/MockupPreview'
import type { AIGenerationRequest, Product } from '../types'
import type { DesignSuggestion, DesignAnalysis } from '../utils/gpt-assistant'

const ProductDesigner: React.FC = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const stageRef = useRef<any>(null)
  const transformerRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [elements, setElements] = useState<any[]>([])
  const [textInput, setTextInput] = useState('')
  const [fontSize, setFontSize] = useState(24)
  const [fontFamily, setFontFamily] = useState('Arial')
  const [textColor, setTextColor] = useState('#000000')
  const [selectedTemplate, setSelectedTemplate] = useState<'shirt' | 'tumbler' | 'hoodie'>('shirt')
  const [previewMode, setPreviewMode] = useState(false)

  // URL parameter states
  const [loadedProduct, setLoadedProduct] = useState<Product | null>(null)
  const [isLoadingProduct, setIsLoadingProduct] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Mockup preview states
  const [mockupImageUrl, setMockupImageUrl] = useState<string>('')
  const [isGeneratingMockup, setIsGeneratingMockup] = useState(false)
  const [userItcBalance, setUserItcBalance] = useState<number>(0)
  const [realisticMockupUrl, setRealisticMockupUrl] = useState<string>('')
  
  // AI Generation State
  const [showAIModal, setShowAIModal] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiStyle, setAiStyle] = useState<AIGenerationRequest['style']>('realistic')
  const [isGenerating, setIsGenerating] = useState(false)
  const [userBalance, setUserBalance] = useState(100) // Mock ITC balance
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  
  // GPT Assistant State
  const [showAssistantModal, setShowAssistantModal] = useState(false)
  const [assistantTab, setAssistantTab] = useState<'suggestions' | 'analysis' | 'chat'>('suggestions')
  const [designSuggestions, setDesignSuggestions] = useState<DesignSuggestion[]>([])
  const [designAnalysis, setDesignAnalysis] = useState<DesignAnalysis | null>(null)
  const [chatMessages, setChatMessages] = useState<Array<{id: string, type: 'user' | 'assistant', content: string, timestamp: string}>>([])
  const [chatInput, setChatInput] = useState('')
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isChatting, setIsChatting] = useState(false)
  const [designContext, setDesignContext] = useState('')
  const [targetAudience, setTargetAudience] = useState('general')
  
  const { addToCart } = useCart()
  const { user } = useAuth()

  const AI_GENERATION_COST = 25 // ITC cost per generation

  const getTemplateBackground = () => {
    switch (selectedTemplate) {
      case 'shirt':
        return { width: 300, height: 350, color: '#f3f4f6', label: 'T-Shirt Preview' }
      case 'tumbler':
        return { width: 200, height: 400, color: '#e5e7eb', label: 'Tumbler Preview' }
      case 'hoodie':
        return { width: 320, height: 380, color: '#d1d5db', label: 'Hoodie Preview' }
      default:
        return { width: 300, height: 300, color: '#ffffff', label: 'Design Area' }
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const img = new window.Image()
        img.onload = () => {
          const newElement = {
            id: `image-${Date.now()}`,
            type: 'image',
            src: event.target?.result as string,
            x: 280,
            y: 150,
            width: Math.min(200, img.width),
            height: Math.min(200, img.height),
            rotation: 0
          }
          setElements([...elements, newElement])
        }
        img.src = event.target?.result as string
      }
      reader.readAsDataURL(file)
    }
  }

  const addText = () => {
    if (textInput.trim()) {
      const newElement = {
        id: `text-${Date.now()}`,
        type: 'text',
        text: textInput,
        x: 320,
        y: 250,
        fontSize,
        fontFamily,
        fill: textColor,
        rotation: 0
      }
      setElements([...elements, newElement])
      setTextInput('')
    }
  }

  const deleteSelected = () => {
    if (selectedId) {
      setElements(elements.filter(el => el.id !== selectedId))
      setSelectedId('')
    }
  }

  const downloadDesign = () => {
    const uri = stageRef.current.toDataURL()
    const link = document.createElement('a')
    link.download = `custom-design-${selectedTemplate}.png`
    link.href = uri
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const showPreviewModal = (mockupUrl: string | null): Promise<boolean> => {
    return new Promise((resolve) => {
      const modal = document.createElement('div')
      modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
      modal.innerHTML = `
        <div class="bg-card rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
          <h3 class="text-xl font-bold text-text mb-4">Preview Your Design</h3>
          <div class="mb-4 max-h-96 overflow-auto">
            ${mockupUrl
              ? `<img src="${mockupUrl}" alt="Design Preview" class="w-full rounded-lg" />`
              : `<p class="text-muted text-center py-8">No realistic preview generated. Design will be saved as-is.</p>`
            }
          </div>
          <div class="flex justify-end space-x-3">
            <button id="preview-cancel" class="btn-secondary">Cancel</button>
            <button id="preview-confirm" class="btn-primary">Add to Cart</button>
          </div>
        </div>
      `

      document.body.appendChild(modal)

      const confirmBtn = modal.querySelector('#preview-confirm')
      const cancelBtn = modal.querySelector('#preview-cancel')

      const cleanup = () => {
        document.body.removeChild(modal)
      }

      confirmBtn?.addEventListener('click', () => {
        cleanup()
        resolve(true)
      })

      cancelBtn?.addEventListener('click', () => {
        cleanup()
        resolve(false)
      })

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup()
          resolve(false)
        }
      })

      document.addEventListener('keydown', function escapeHandler(e) {
        if (e.key === 'Escape') {
          cleanup()
          document.removeEventListener('keydown', escapeHandler)
          resolve(false)
        }
      })
    })
  }

  const addToCartWithDesign = async () => {
    try {
      if (elements.length === 0) {
        alert('Please add some design elements before adding to cart')
        return
      }

      let finalMockupUrl = realisticMockupUrl

      if (!finalMockupUrl) {
        const shouldGenerate = window.confirm(
          'Generate realistic preview before adding to cart?\n\n' +
          'Cost: 25 ITC tokens\n' +
          'This will show how your design will look on the final product.\n\n' +
          'Click OK to generate, or Cancel to skip.'
        )

        if (shouldGenerate) {
          setIsGeneratingMockup(true)

          try {
            await handleGenerateRealistic()
            finalMockupUrl = realisticMockupUrl
          } catch (error) {
            console.error('[ProductDesigner] Failed to generate mockup for cart:', error)
            alert('Failed to generate preview. Adding to cart without realistic mockup.')
          } finally {
            setIsGeneratingMockup(false)
          }
        }
      }

      const confirmed = await showPreviewModal(finalMockupUrl)

      if (!confirmed) {
        return
      }

      const canvasSnapshot = stageRef.current?.toDataURL()

      const templatePrices = {
        shirt: 24.99,
        tumbler: 29.99,
        hoodie: 45.99
      }

      const mockProduct = {
        id: loadedProduct?.id || `custom-${selectedTemplate}`,
        name: loadedProduct?.name || `Custom ${selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1)}`,
        description: loadedProduct?.description || `Your custom ${selectedTemplate} with personalized graphics`,
        price: loadedProduct?.price || templatePrices[selectedTemplate],
        images: loadedProduct?.images || [canvasSnapshot || ''],
        category: loadedProduct?.category || (selectedTemplate === 'shirt' || selectedTemplate === 'hoodie' ? 'shirts' as const : 'tumblers' as const),
        inStock: true
      }

      addToCart(mockProduct, 1, canvasSnapshot, {
        elements,
        template: selectedTemplate,
        mockupUrl: finalMockupUrl || '',
        canvasSnapshot
      })

      alert('Design added to cart!')

      const goToCart = window.confirm('Go to cart now?')
      if (goToCart) {
        navigate('/cart')
      }

    } catch (error: any) {
      console.error('[ProductDesigner] Error adding to cart:', error)
      alert('Failed to add to cart: ' + error.message)
    }
  }

  const handleSaveDesign = async () => {
    try {
      if (elements.length === 0) {
        alert('Please add some design elements before saving')
        return
      }

      const designData = {
        elements,
        template: selectedTemplate,
        timestamp: Date.now(),
        productId: loadedProduct?.id,
        mockupUrl: realisticMockupUrl
      }

      const savedDesigns = JSON.parse(localStorage.getItem('savedDesigns') || '[]')
      savedDesigns.push(designData)
      localStorage.setItem('savedDesigns', JSON.stringify(savedDesigns))

      const snapshot = stageRef.current?.toDataURL()
      if (snapshot) {
        localStorage.setItem(`design-snapshot-${designData.timestamp}`, snapshot)
      }

      alert('Design saved successfully! You can load it later from your saved designs.')
    } catch (error: any) {
      console.error('[ProductDesigner] Error saving design:', error)
      alert('Failed to save design: ' + error.message)
    }
  }

  const generateAIImage = async () => {
    if (!aiPrompt.trim()) {
      alert('Please enter a prompt for AI generation')
      return
    }

    if (userBalance < AI_GENERATION_COST) {
      setShowPaymentModal(true)
      return
    }

    setIsGenerating(true)
    try {
      const imageUrl = await replicateAPI.generateImage(aiPrompt, aiStyle)
      
      // Deduct ITC cost
      setUserBalance(prev => prev - AI_GENERATION_COST)
      
      // Add generated image to canvas
      const img = new window.Image()
      img.onload = () => {
        const newElement = {
          id: `ai-image-${Date.now()}`,
          type: 'image',
          src: imageUrl,
          x: 280,
          y: 150,
          width: Math.min(200, img.width),
          height: Math.min(200, img.height),
          rotation: 0
        }
        setElements([...elements, newElement])
      }
      img.src = imageUrl

      setShowAIModal(false)
      setAiPrompt('')
      alert('AI image generated and added to your design!')

    } catch (error) {
      console.error('Error generating AI image:', error)
      alert('Failed to generate AI image. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const purchaseITC = async (amount: number) => {
    // In real app, integrate with Stripe here
    const usdCost = amount * parseFloat(import.meta.env.VITE_ITC_USD_RATE || '0.10')
    
    if (window.confirm(`Purchase ${amount} ITC for $${usdCost.toFixed(2)}?`)) {
      // Mock successful payment
      setUserBalance(prev => prev + amount)
      setShowPaymentModal(false)
      alert(`Successfully purchased ${amount} ITC!`)
    }
  }

  const getDesignSuggestions = async () => {
    setIsLoadingSuggestions(true)
    try {
      const suggestions = await gptAssistant.getDesignSuggestions(
        selectedTemplate,
        designContext || 'Custom design',
        targetAudience
      )
      setDesignSuggestions(suggestions)
    } catch (error) {
      console.error('Error getting design suggestions:', error)
      alert('Failed to get design suggestions. Please try again.')
    } finally {
      setIsLoadingSuggestions(false)
    }
  }

  const analyzeCurrentDesign = async () => {
    setIsAnalyzing(true)
    try {
      const analysis = await gptAssistant.analyzeDesign(elements, selectedTemplate)
      setDesignAnalysis(analysis)
    } catch (error) {
      console.error('Error analyzing design:', error)
      alert('Failed to analyze design. Please try again.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return
    
    const userMessage = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: chatInput,
      timestamp: new Date().toISOString()
    }
    
    setChatMessages(prev => [...prev, userMessage])
    setChatInput('')
    setIsChatting(true)
    
    try {
      const context = {
        productType: selectedTemplate,
        elementsCount: elements.length,
        hasText: elements.some(el => el.type === 'text'),
        hasImages: elements.some(el => el.type === 'image')
      }
      
      const response = await gptAssistant.getChatResponse(chatInput, context)
      
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant' as const,
        content: response,
        timestamp: new Date().toISOString()
      }
      
      setChatMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error in chat:', error)
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant' as const,
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      }
      setChatMessages(prev => [...prev, errorMessage])
    } finally {
      setIsChatting(false)
    }
  }

  const applySuggestion = (suggestion: DesignSuggestion) => {
    // Apply typography suggestions
    if (suggestion.typography && elements.some(el => el.type === 'text')) {
      setElements(prev => prev.map(el => {
        if (el.type === 'text') {
          return {
            ...el,
            fontFamily: suggestion.typography!.fontFamily,
            fontSize: suggestion.typography!.fontSize
          }
        }
        return el
      }))
    }

    // Set suggested values for new elements
    if (suggestion.typography) {
      setFontFamily(suggestion.typography.fontFamily)
      setFontSize(suggestion.typography.fontSize)
    }

    // Apply color suggestions (use first color as text color)
    if (suggestion.colorPalette && suggestion.colorPalette.length > 0) {
      setTextColor(suggestion.colorPalette[0])
    }

    // Generate AI image if prompt provided
    if (suggestion.aiPrompt) {
      setAiPrompt(suggestion.aiPrompt)
      setAiStyle('realistic')
    }

    alert(`Applied suggestion: ${suggestion.title}`)
  }

  const handleGenerateRealistic = async () => {
    try {
      setIsGeneratingMockup(true)
      setLoadError(null)

      console.log('[ProductDesigner] 🎨 Generate realistic preview clicked')

      // Validate stage ref exists
      if (!stageRef.current) {
        throw new Error('Canvas not ready. Please wait a moment and try again.')
      }

      // Export current canvas as data URL
      const canvasDataUrl = stageRef.current.toDataURL({
        mimeType: 'image/png',
        quality: 1.0,
        pixelRatio: 2 // Higher quality export
      })

      console.log('[ProductDesigner] 📸 Canvas exported, size:', canvasDataUrl.length, 'characters')

      // Determine product template
      let productTemplate: 'shirts' | 'hoodies' | 'tumblers'
      if (selectedTemplate === 'shirt') {
        productTemplate = 'shirts'
      } else if (selectedTemplate === 'hoodie') {
        productTemplate = 'hoodies'
      } else if (selectedTemplate === 'tumbler') {
        productTemplate = 'tumblers'
      } else {
        productTemplate = 'shirts' // fallback
      }

      console.log('[ProductDesigner] 🏷️ Template:', productTemplate)
      console.log('[ProductDesigner] 🚀 Calling backend API...')

      // Call backend API
      const response = await apiFetch('/api/designer/generate-mockup', {
        method: 'POST',
        body: JSON.stringify({
          designImageUrl: canvasDataUrl,
          productTemplate,
          mockupType: 'flat'
        })
      })

      // Validate response
      if (!response.ok) {
        throw new Error(response.error || 'Failed to generate mockup')
      }

      console.log('[ProductDesigner] ✅ Mockup generated successfully')
      console.log('[ProductDesigner] 🖼️ Mockup URL:', response.mockupUrl?.substring(0, 100) + '...')
      console.log('[ProductDesigner] 💰 Cost:', response.cost, 'ITC')
      console.log('[ProductDesigner] 💵 New balance:', response.newBalance, 'ITC')

      // Update state with new mockup URL
      setRealisticMockupUrl(response.mockupUrl)
      setUserItcBalance(response.newBalance)
      setMockupImageUrl(response.mockupUrl)

      // Show success message
      const message = `Realistic mockup generated successfully!\n\n` +
        `Cost: ${response.cost} ITC\n` +
        `New balance: ${response.newBalance} ITC\n\n` +
        `The mockup is now displayed in the preview panel.`

      alert(message)

    } catch (error: any) {
      console.error('[ProductDesigner] ❌ Error generating mockup:', error)

      // Parse error message
      let errorMessage = error.message || 'Unknown error occurred'

      // Check for specific error types
      if (errorMessage.includes('Insufficient ITC balance')) {
        setLoadError('Insufficient ITC balance. Please purchase more tokens from your wallet.')
        alert('Insufficient ITC balance.\n\nYou need at least 25 ITC tokens to generate a realistic mockup.\nPlease visit your Wallet page to purchase more tokens.')
      } else if (errorMessage.includes('Unauthorized')) {
        setLoadError('Authentication error. Please log in again.')
        alert('Authentication error. Please log in again.')
      } else if (errorMessage.includes('Canvas not ready')) {
        setLoadError(errorMessage)
        alert(errorMessage)
      } else {
        setLoadError('Failed to generate realistic mockup: ' + errorMessage)
        alert('Failed to generate realistic mockup.\n\nError: ' + errorMessage + '\n\nPlease try again in a moment.')
      }

    } finally {
      setIsGeneratingMockup(false)
    }
  }

  const handleElementClick = (e: any) => {
    if (!previewMode) {
      const id = e.target.id()
      setSelectedId(id)
    }
  }

  const handleStageClick = (e: any) => {
    if (!previewMode && e.target === e.target.getStage()) {
      setSelectedId('')
    }
  }

  const handleDragEnd = (e: any) => {
    if (!previewMode) {
      const id = e.target.id()
      setElements(elements.map(el => 
        el.id === id 
          ? { ...el, x: e.target.x(), y: e.target.y() }
          : el
      ))
    }
  }

  const handleTransformEnd = (e: any) => {
    if (!previewMode) {
      const id = e.target.id()
      const node = e.target
      const scaleX = node.scaleX()
      const scaleY = node.scaleY()

      setElements(elements.map(el => 
        el.id === id 
          ? { 
              ...el, 
              x: node.x(),
              y: node.y(),
              width: node.width() * scaleX,
              height: node.height() * scaleY,
              rotation: node.rotation()
            }
          : el
      ))

      node.scaleX(1)
      node.scaleY(1)
    }
  }

  React.useEffect(() => {
    if (selectedId && transformerRef.current && !previewMode) {
      const selectedNode = stageRef.current.findOne(`#${selectedId}`)
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode])
        transformerRef.current.getLayer().batchDraw()
      }
    } else if (transformerRef.current) {
      transformerRef.current.nodes([])
      transformerRef.current.getLayer().batchDraw()
    }
  }, [selectedId, previewMode])

  // Load ITC balance from user wallet
  useEffect(() => {
    if (user) {
      supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data) setUserItcBalance(data.itc_balance || 0)
        })
    }
  }, [user])

  // Load product and design from URL parameters
  useEffect(() => {
    const loadProductAndDesign = async () => {
      const productId = searchParams.get('productId')
      const template = searchParams.get('template')
      const designImage = searchParams.get('designImage')

      console.log('[ProductDesigner] URL params:', { productId, template, designImage })

      // Set initial template if provided
      if (template) {
        const validTemplates = ['shirt', 'tumbler', 'hoodie']
        if (validTemplates.includes(template)) {
          console.log('[ProductDesigner] Setting template from URL:', template)
          setSelectedTemplate(template as 'shirt' | 'tumbler' | 'hoodie')
        } else {
          console.warn('[ProductDesigner] Invalid template in URL:', template)
        }
      }

      // Load product from database if productId provided
      if (productId) {
        console.log('[ProductDesigner] Loading product from database:', productId)
        setIsLoadingProduct(true)
        setLoadError(null)

        try {
          const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single()

          if (error) {
            console.error('[ProductDesigner] Error loading product:', error)
            setLoadError(`Failed to load product: ${error.message}`)
          } else if (data) {
            console.log('[ProductDesigner] Product loaded successfully:', data)
            setLoadedProduct(data as Product)

            // Set template based on product category if not already set
            if (!template && data.category) {
              const categoryToTemplate: Record<string, 'shirt' | 'tumbler' | 'hoodie'> = {
                'shirts': 'shirt',
                'hoodies': 'hoodie',
                'tumblers': 'tumbler'
              }
              const productTemplate = categoryToTemplate[data.category]
              if (productTemplate) {
                console.log('[ProductDesigner] Setting template from product category:', productTemplate)
                setSelectedTemplate(productTemplate)
              }
            }
          } else {
            console.warn('[ProductDesigner] Product not found:', productId)
            setLoadError('Product not found')
          }
        } catch (err) {
          console.error('[ProductDesigner] Exception loading product:', err)
          setLoadError('An error occurred while loading the product')
        } finally {
          setIsLoadingProduct(false)
        }
      }

      // Auto-load design image if provided
      if (designImage) {
        const decodedImageUrl = decodeURIComponent(designImage)
        console.log('[ProductDesigner] Auto-loading design image:', decodedImageUrl)

        if (decodedImageUrl && decodedImageUrl !== 'undefined' && decodedImageUrl !== 'null') {
          try {
            const img = new window.Image()
            img.crossOrigin = 'anonymous' // Handle CORS if needed

            img.onload = () => {
              console.log('[ProductDesigner] Design image loaded successfully')
              const newElement = {
                id: `image-${Date.now()}`,
                type: 'image',
                src: decodedImageUrl,
                x: 280,
                y: 150,
                width: Math.min(200, img.width),
                height: Math.min(200, img.height),
                rotation: 0
              }
              setElements(prev => [...prev, newElement])
            }

            img.onerror = (err) => {
              console.error('[ProductDesigner] Failed to load design image:', err)
              // Don't show error to user, just log it
            }

            img.src = decodedImageUrl
          } catch (err) {
            console.error('[ProductDesigner] Exception loading design image:', err)
          }
        }
      }
    }

    loadProductAndDesign()
  }, [searchParams])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text mb-2">Product Designer</h1>
        <p className="text-muted">Create custom designs with our drag-and-drop editor</p>

        {/* Loading state */}
        {isLoadingProduct && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center">
            <svg className="animate-spin h-5 w-5 text-blue-600 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-blue-800 font-medium">Loading product information...</span>
          </div>
        )}

        {/* Error state */}
        {loadError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center">
            <svg className="w-5 h-5 text-red-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-red-800 font-medium">{loadError}</span>
          </div>
        )}

        {/* Loaded product info */}
        {loadedProduct && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-green-900 font-semibold">Customizing: {loadedProduct.name}</h3>
                <p className="text-green-700 text-sm mt-1">{loadedProduct.description}</p>
                <div className="flex items-center mt-2 text-sm">
                  <span className="text-green-800 font-medium">${loadedProduct.price.toFixed(2)}</span>
                  <span className="mx-2 text-green-600">•</span>
                  <span className="text-green-700 capitalize">{loadedProduct.category}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-card p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-3">Product Template</h3>
            <div className="grid grid-cols-1 gap-2">
              {[{ id: 'shirt', name: 'T-Shirt', price: '$24.99' }, 
                { id: 'tumbler', name: 'Tumbler', price: '$29.99' },
                { id: 'hoodie', name: 'Hoodie', price: '$45.99' }].map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template.id as any)}
                  className={`p-3 text-left rounded-md border ${
                    selectedTemplate === template.id
                      ? 'border-purple-600 bg-purple-50 text-purple-700'
                      : 'card-border hover:card-border'
                  }`}
                >
                  <div className="font-medium">{template.name}</div>
                  <div className="text-sm text-muted">{template.price}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-card p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-3">Add Image</h3>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full btn-primary mb-3"
            >
              Upload Image
            </button>
            
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-text">ITC Balance</span>
                <span className="text-sm font-bold text-purple-600">{userBalance} ITC</span>
              </div>
              <button
                onClick={() => setShowAIModal(true)}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-2 px-4 rounded-lg transition-all flex items-center justify-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Generate AI Image
              </button>
              <p className="text-xs text-muted mt-1 text-center">Costs {AI_GENERATION_COST} ITC</p>
            </div>
          </div>

          <div className="bg-card p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-3">Add Text</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Enter text"
                className="w-full px-3 py-2 border rounded-md"
              />
              
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Verdana">Verdana</option>
              </select>

              <div className="flex space-x-2">
                <input
                  type="number"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  min="8"
                  max="72"
                  className="flex-1 px-3 py-2 border rounded-md"
                  placeholder="Size"
                />
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-12 h-10 border rounded-md"
                />
              </div>

              <button
                onClick={addText}
                disabled={!textInput.trim()}
                className="w-full btn-secondary disabled:bg-gray-400"
              >
                Add Text
              </button>
            </div>
          </div>

          <div className="bg-card p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-3">Smart Assistant</h3>
            <div className="space-y-2">
              <button
                onClick={() => setShowAssistantModal(true)}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-all flex items-center justify-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                GPT Design Assistant
              </button>
              <p className="text-xs text-muted text-center">Get AI-powered design suggestions</p>
            </div>
          </div>

          <div className="bg-card p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-3">Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => setPreviewMode(!previewMode)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {previewMode ? 'Edit Mode' : 'Preview Mode'}
              </button>
              <button
                onClick={deleteSelected}
                disabled={!selectedId || previewMode}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Delete Selected
              </button>
              <button
                onClick={downloadDesign}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Download PNG
              </button>
              <button
                onClick={handleSaveDesign}
                disabled={elements.length === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Save Design
              </button>
              <button
                onClick={addToCartWithDesign}
                disabled={isGeneratingMockup || elements.length === 0}
                className="w-full btn-primary disabled:bg-gray-400 flex items-center justify-center"
              >
                {isGeneratingMockup ? (
                  <>
                    <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating Preview...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Add to Cart
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          {/* Two-Panel Layout: Canvas (Left) | Mockup Preview (Right) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Panel - Design Editor (Konva Canvas) */}
            <div className="bg-card rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Design Editor</h3>
              <div className="border-2 border-dashed card-border rounded-lg overflow-auto relative flex items-center justify-center bg-gray-100">
                <Stage
                  ref={stageRef}
                  width={800}
                  height={600}
                  onClick={previewMode ? undefined : handleStageClick}
                  onTap={previewMode ? undefined : handleStageClick}
                >
                  <Layer>
                    {/* Template Background */}
                    <Rect
                      x={250}
                      y={100}
                      width={getTemplateBackground().width}
                      height={getTemplateBackground().height}
                      fill={getTemplateBackground().color}
                      stroke={previewMode ? 'transparent' : '#9CA3AF'}
                      strokeWidth={2}
                      dash={previewMode ? [] : [5, 5]}
                    />

                    {/* Print Area Boundaries */}
                    {(() => {
                      const templateKey = selectedTemplate === 'shirt' ? 'shirts' : selectedTemplate === 'hoodie' ? 'hoodies' : 'tumblers'
                      const template = PRODUCT_TEMPLATES[templateKey as ProductTemplateType]
                      const printArea = {
                        x: template.printArea.x * 800,
                        y: template.printArea.y * 600,
                        width: template.printArea.width * 800,
                        height: template.printArea.height * 600
                      }
                      return (
                        <Rect
                          x={printArea.x}
                          y={printArea.y}
                          width={printArea.width}
                          height={printArea.height}
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          dash={[5, 5]}
                          listening={false}
                        />
                      )
                    })()}

                    {elements.map((element) => {
                      if (element.type === 'image') {
                        const img = new window.Image()
                        img.src = element.src
                        return (
                          <KonvaImage
                            key={element.id}
                            id={element.id}
                            image={img}
                            x={element.x}
                            y={element.y}
                            width={element.width}
                            height={element.height}
                            rotation={element.rotation}
                            draggable={!previewMode}
                            onClick={previewMode ? undefined : handleElementClick}
                            onTap={previewMode ? undefined : handleElementClick}
                            onDragEnd={previewMode ? undefined : handleDragEnd}
                            onTransformEnd={previewMode ? undefined : handleTransformEnd}
                          />
                        )
                      } else if (element.type === 'text') {
                        return (
                          <Text
                            key={element.id}
                            id={element.id}
                            text={element.text}
                            x={element.x}
                            y={element.y}
                            fontSize={element.fontSize}
                            fontFamily={element.fontFamily}
                            fill={element.fill}
                            rotation={element.rotation}
                            draggable={!previewMode}
                            onClick={previewMode ? undefined : handleElementClick}
                            onTap={previewMode ? undefined : handleElementClick}
                            onDragEnd={previewMode ? undefined : handleDragEnd}
                            onTransformEnd={previewMode ? undefined : handleTransformEnd}
                          />
                        )
                      }
                      return null
                    })}

                    {!previewMode && (
                      <Transformer
                        ref={transformerRef}
                        boundBoxFunc={(oldBox, newBox) => {
                          if (newBox.width < 5 || newBox.height < 5) {
                            return oldBox
                          }
                          return newBox
                        }}
                      />
                    )}
                  </Layer>
                </Stage>
              </div>
              <p className="text-sm text-muted mt-2">
                {previewMode
                  ? 'Preview mode: See how your design will look on the product'
                  : 'Edit mode: Click elements to select and transform. Drag to move, use handles to resize and rotate.'}
              </p>
            </div>

            {/* Right Panel - Mockup Preview */}
            <div className="bg-card rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Mockup Preview</h3>
              <MockupPreview
                designElements={elements}
                selectedTemplate={
                  (selectedTemplate === 'shirt' ? 'shirts' : selectedTemplate === 'hoodie' ? 'hoodies' : 'tumblers') as ProductTemplateType
                }
                mockupImage={realisticMockupUrl || mockupImageUrl}
                onGenerateRealistic={handleGenerateRealistic}
                isGenerating={isGeneratingMockup}
                itcBalance={userItcBalance}
              />
            </div>
          </div>
        </div>
      </div>

      {/* AI Generation Modal */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-text">Generate AI Image</h3>
              <button
                onClick={() => setShowAIModal(false)}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Prompt</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Describe what you want to generate (e.g., 'a cute cartoon cat wearing sunglasses')"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Style</label>
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value as AIGenerationRequest['style'])}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="realistic">Realistic</option>
                  <option value="cartoon">Cartoon</option>
                  <option value="vaporwave">Vaporwave</option>
                  <option value="minimalist">Minimalist</option>
                  <option value="vintage">Vintage</option>
                </select>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-purple-900">Generation Cost</p>
                    <p className="text-sm text-purple-700">
                      This will cost {AI_GENERATION_COST} ITC from your balance ({userBalance} ITC available)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={generateAIImage}
                disabled={isGenerating || !aiPrompt.trim()}
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-all flex items-center justify-center"
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                  </>
                ) : (
                  '✨ Generate Image'
                )}
              </button>
              <button
                onClick={() => setShowAIModal(false)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-text py-2 px-4 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-text">Insufficient ITC Balance</h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="text-center mb-6">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-sm text-muted mb-4">
                You need {AI_GENERATION_COST} ITC to generate an AI image, but you only have {userBalance} ITC.
              </p>
              <p className="text-sm font-medium text-text">Purchase ITC to continue:</p>
            </div>

            <div className="space-y-3 mb-6">
              {[
                { amount: 50, price: 5.00, popular: false },
                { amount: 100, price: 10.00, popular: true },
                { amount: 250, price: 25.00, popular: false },
                { amount: 500, price: 50.00, popular: false }
              ].map((package_) => (
                <button
                  key={package_.amount}
                  onClick={() => purchaseITC(package_.amount)}
                  className={`w-full p-3 border rounded-lg text-left hover:bg-card transition-colors ${
                    package_.popular ? 'border-purple-600 bg-purple-50' : 'card-border'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium text-text">{package_.amount} ITC</div>
                      {package_.popular && (
                        <div className="text-xs text-purple-600 font-medium">Most Popular</div>
                      )}
                    </div>
                    <div className="text-lg font-bold text-text">${package_.price.toFixed(2)}</div>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowPaymentModal(false)}
              className="w-full bg-gray-300 hover:bg-gray-400 text-text py-2 px-4 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* GPT Assistant Modal */}
      {showAssistantModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-xl font-semibold text-text flex items-center">
                <svg className="w-6 h-6 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                GPT Smart Design Assistant
              </h3>
              <button
                onClick={() => setShowAssistantModal(false)}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Assistant Tabs */}
            <div className="border-b card-border">
              <nav className="flex space-x-8 px-6">
                {[{ id: 'suggestions', label: 'Design Ideas', icon: '💡' }, 
                  { id: 'analysis', label: 'Analysis', icon: '📊' }, 
                  { id: 'chat', label: 'Chat Assistant', icon: '💬' }].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setAssistantTab(tab.id as any)}
                    className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center ${
                      assistantTab === tab.id
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-muted hover:text-text hover:card-border'
                    }`}
                  >
                    <span className="mr-2">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Design Suggestions Tab */}
              {assistantTab === 'suggestions' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">Design Context</label>
                      <input
                        type="text"
                        value={designContext}
                        onChange={(e) => setDesignContext(e.target.value)}
                        placeholder="e.g., birthday party, business logo, motivational quote"
                        className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">Target Audience</label>
                      <select
                        value={targetAudience}
                        onChange={(e) => setTargetAudience(e.target.value)}
                        className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="general">General Audience</option>
                        <option value="teenagers">Teenagers</option>
                        <option value="young adults">Young Adults</option>
                        <option value="professionals">Professionals</option>
                        <option value="families">Families</option>
                        <option value="fitness enthusiasts">Fitness Enthusiasts</option>
                        <option value="gamers">Gamers</option>
                        <option value="artists">Artists</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={getDesignSuggestions}
                    disabled={isLoadingSuggestions}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
                  >
                    {isLoadingSuggestions ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Getting AI Suggestions...
                      </>
                    ) : (
                      '✨ Get Design Suggestions'
                    )}
                  </button>

                  {designSuggestions.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {designSuggestions.map((suggestion) => (
                        <div key={suggestion.id} className="border rounded-lg p-6 hover:shadow-lg transition-shadow">
                          <div className="flex justify-between items-start mb-4">
                            <h4 className="text-lg font-semibold text-text">{suggestion.title}</h4>
                            <div className="flex space-x-1">
                              {suggestion.tags.map((tag) => (
                                <span key={tag} className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-full">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          
                          <p className="text-muted mb-3">{suggestion.description}</p>
                          <p className="text-sm text-muted mb-4">{suggestion.reasoning}</p>
                          
                          {suggestion.colorPalette && (
                            <div className="mb-4">
                              <p className="text-sm font-medium text-text mb-2">Color Palette:</p>
                              <div className="flex space-x-2">
                                {suggestion.colorPalette.map((color, index) => (
                                  <div
                                    key={index}
                                    className="w-8 h-8 rounded-full border card-border"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                  ></div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {suggestion.typography && (
                            <div className="mb-4">
                              <p className="text-sm font-medium text-text mb-2">Typography:</p>
                              <div className="text-sm text-muted">
                                {suggestion.typography.fontFamily} • {suggestion.typography.fontSize}px • {suggestion.typography.fontWeight}
                              </div>
                            </div>
                          )}
                          
                          <button
                            onClick={() => applySuggestion(suggestion)}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg transition-colors"
                          >
                            Apply This Design
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Design Analysis Tab */}
              {assistantTab === 'analysis' && (
                <div className="space-y-6">
                  <div className="text-center">
                    <button
                      onClick={analyzeCurrentDesign}
                      disabled={isAnalyzing || elements.length === 0}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center mx-auto"
                    >
                      {isAnalyzing ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Analyzing Design...
                        </>
                      ) : (
                        '📊 Analyze Current Design'
                      )}
                    </button>
                    {elements.length === 0 && (
                      <p className="text-sm text-muted mt-2">Add some elements to your design first</p>
                    )}
                  </div>

                  {designAnalysis && (
                    <div className="space-y-6">
                      <div className="text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4">
                          <span className="text-2xl font-bold text-indigo-600">{designAnalysis.overallRating}/10</span>
                        </div>
                        <h3 className="text-lg font-semibold text-text">Overall Design Score</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          <h4 className="font-semibold text-green-800 mb-2 flex items-center">
                            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Strengths
                          </h4>
                          <ul className="space-y-1">
                            {designAnalysis.strengths.map((strength, index) => (
                              <li key={index} className="text-sm text-green-700">• {strength}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                          <h4 className="font-semibold text-yellow-800 mb-2 flex items-center">
                            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Areas for Improvement
                          </h4>
                          <ul className="space-y-1">
                            {designAnalysis.improvements.map((improvement, index) => (
                              <li key={index} className="text-sm text-yellow-700">• {improvement}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {designAnalysis.suggestions.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <h4 className="font-semibold text-blue-800 mb-3">Specific Suggestions</h4>
                          <div className="space-y-3">
                            {designAnalysis.suggestions.map((suggestion) => (
                              <div key={suggestion.id} className="bg-card rounded p-3">
                                <h5 className="font-medium text-blue-900">{suggestion.title}</h5>
                                <p className="text-sm text-blue-700 mb-1">{suggestion.description}</p>
                                <p className="text-xs text-blue-600">{suggestion.reasoning}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {designAnalysis.marketTrends.length > 0 && (
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                          <h4 className="font-semibold text-purple-800 mb-2 flex items-center">
                            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
                            </svg>
                            Current Market Trends
                          </h4>
                          <ul className="space-y-1">
                            {designAnalysis.marketTrends.map((trend, index) => (
                              <li key={index} className="text-sm text-purple-700">• {trend}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Chat Assistant Tab */}
              {assistantTab === 'chat' && (
                <div className="flex flex-col h-96">
                  <div className="flex-1 overflow-y-auto mb-4 border rounded-lg p-4 bg-card">
                    {chatMessages.length === 0 ? (
                      <div className="text-center text-muted py-8">
                        <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <p>Hi! I'm your design assistant. Ask me about:</p>
                        <ul className="text-sm mt-2 space-y-1">
                          <li>• Color combinations and psychology</li>
                          <li>• Typography and font suggestions</li>
                          <li>• Layout and composition tips</li>
                          <li>• Market trends and target audiences</li>
                          <li>• Design principles and best practices</li>
                        </ul>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {chatMessages.map((message) => (
                          <div key={message.id} className={`flex ${
                            message.type === 'user' ? 'justify-end' : 'justify-start'
                          }`}>
                            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                              message.type === 'user' 
                                ? 'bg-indigo-600 text-white'
                                : 'bg-card border text-text'
                            }`}>
                              <p className="text-sm">{message.content}</p>
                              <p className={`text-xs mt-1 ${
                                message.type === 'user' ? 'text-indigo-200' : 'text-muted'
                              }`}>
                                {new Date(message.timestamp).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        ))}
                        {isChatting && (
                          <div className="flex justify-start">
                            <div className="bg-card border rounded-lg px-4 py-2">
                              <div className="flex space-x-1">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask me anything about design..."
                      className="flex-1 px-4 py-2 border card-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !isChatting) {
                          sendChatMessage()
                        }
                      }}
                    />
                    <button
                      onClick={sendChatMessage}
                      disabled={!chatInput.trim() || isChatting}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg transition-colors flex items-center"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductDesigner
