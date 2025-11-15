import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Stage, Layer, Image as KonvaImage, Text, Transformer, Rect } from 'react-konva'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { replicateAPI } from '../utils/replicate'
import { gptAssistant } from '../utils/gpt-assistant'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { PRODUCT_TEMPLATES, type ProductTemplateType } from '../utils/product-templates'
import MockupPreview from './MockupPreview'
import RealisticMockupGenerator from './RealisticMockupGenerator'
import type { AIGenerationRequest, Product } from '../types'
import type { DesignSuggestion, DesignAnalysis } from '../utils/gpt-assistant'

interface DesignStudioModalProps {
  isOpen: boolean
  onClose: () => void
  product?: Product
  template?: 'shirt' | 'tumbler' | 'hoodie'
  initialDesignImage?: string
}

const BACKGROUND_REMOVAL_COST = 10 // ITC tokens
const IMAGE_UPSCALE_COST = 15 // ITC tokens
const AI_GENERATION_COST = 25 // ITC tokens

const DesignStudioModal: React.FC<DesignStudioModalProps> = ({
  isOpen,
  onClose,
  product,
  template: initialTemplate,
  initialDesignImage
}) => {
  const stageRef = useRef<any>(null)
  const transformerRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [elements, setElements] = useState<any[]>([])
  const [textInput, setTextInput] = useState('')
  const [fontSize, setFontSize] = useState(24)
  const [fontFamily, setFontFamily] = useState('Arial')
  const [textColor, setTextColor] = useState('#000000')
  const [selectedTemplate, setSelectedTemplate] = useState<'shirt' | 'tumbler' | 'hoodie'>(initialTemplate || 'shirt')
  const [previewMode, setPreviewMode] = useState(false)

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
  const [userBalance, setUserBalance] = useState(100)
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

  // Image processing states
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const [processingMessage, setProcessingMessage] = useState('')
  const [showUpscaleOptions, setShowUpscaleOptions] = useState(false)

  const { addToCart } = useCart()
  const { user } = useAuth()

  // Load ITC balance
  useEffect(() => {
    if (user) {
      supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setUserItcBalance(data.itc_balance || 0)
            setUserBalance(data.itc_balance || 0)
          }
        })
    }
  }, [user])

  // Animation state
  const [isAnimating, setIsAnimating] = useState(false)

  // Handle close with animation
  const handleClose = () => {
    setIsAnimating(false)
    setTimeout(() => {
      onClose()
    }, 200) // Match animation duration
  }

  // Handle open animation
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready for animation
      const timer = setTimeout(() => {
        setIsAnimating(true)
      }, 10)
      return () => clearTimeout(timer)
    } else {
      setIsAnimating(false)
    }
  }, [isOpen])

  // Load initial design image if provided
  useEffect(() => {
    if (initialDesignImage && isOpen) {
      const img = new window.Image()
      img.onload = () => {
        const newElement = {
          id: `image-${Date.now()}`,
          type: 'image',
          src: initialDesignImage,
          x: 280,
          y: 150,
          width: Math.min(200, img.width),
          height: Math.min(200, img.height),
          rotation: 0
        }
        setElements([newElement])
      }
      img.src = initialDesignImage
    }
  }, [initialDesignImage, isOpen])

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  // Transformer effect
  useEffect(() => {
    if (selectedId && transformerRef.current && !previewMode) {
      const selectedNode = stageRef.current?.findOne(`#${selectedId}`)
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode])
        transformerRef.current.getLayer().batchDraw()
      }
    } else if (transformerRef.current) {
      transformerRef.current.nodes([])
      transformerRef.current.getLayer().batchDraw()
    }
  }, [selectedId, previewMode])

  if (!isOpen) return null

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

  const handleRemoveBackground = async () => {
    if (!selectedId) {
      alert('Please select an image element first')
      return
    }

    const selectedElement = elements.find(el => el.id === selectedId)
    if (!selectedElement || selectedElement.type !== 'image') {
      alert('Please select an image element to remove background')
      return
    }

    if (userItcBalance < BACKGROUND_REMOVAL_COST) {
      alert(`Insufficient ITC balance. You need ${BACKGROUND_REMOVAL_COST} ITC to remove background.`)
      setShowPaymentModal(true)
      return
    }

    const confirmed = window.confirm(
      `Remove background from selected image?\n\n` +
      `Cost: ${BACKGROUND_REMOVAL_COST} ITC tokens\n` +
      `Current balance: ${userItcBalance} ITC\n\n` +
      `This will replace the selected image with a background-removed version.`
    )

    if (!confirmed) return

    setIsProcessingImage(true)
    setProcessingMessage('Removing background...')

    try {
      const response = await apiFetch('/api/designer/remove-background', {
        method: 'POST',
        body: JSON.stringify({
          imageUrl: selectedElement.src
        })
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to remove background')
      }

      // Update the element with new image
      setElements(elements.map(el =>
        el.id === selectedId
          ? { ...el, src: response.imageUrl }
          : el
      ))

      // Update balance
      setUserItcBalance(response.newBalance)
      setUserBalance(response.newBalance)

      alert(`Background removed successfully!\n\nCost: ${response.cost} ITC\nNew balance: ${response.newBalance} ITC`)

    } catch (error: any) {
      console.error('Background removal error:', error)
      alert('Failed to remove background: ' + error.message)
    } finally {
      setIsProcessingImage(false)
      setProcessingMessage('')
    }
  }

  const handleUpscaleImage = async (scale: 2 | 4) => {
    if (!selectedId) {
      alert('Please select an image element first')
      return
    }

    const selectedElement = elements.find(el => el.id === selectedId)
    if (!selectedElement || selectedElement.type !== 'image') {
      alert('Please select an image element to upscale')
      return
    }

    if (userItcBalance < IMAGE_UPSCALE_COST) {
      alert(`Insufficient ITC balance. You need ${IMAGE_UPSCALE_COST} ITC to upscale image.`)
      setShowPaymentModal(true)
      return
    }

    const confirmed = window.confirm(
      `Upscale selected image by ${scale}x?\n\n` +
      `Cost: ${IMAGE_UPSCALE_COST} ITC tokens\n` +
      `Current balance: ${userItcBalance} ITC\n\n` +
      `This will replace the selected image with a higher resolution version.`
    )

    if (!confirmed) return

    setIsProcessingImage(true)
    setProcessingMessage(`Upscaling image ${scale}x...`)
    setShowUpscaleOptions(false)

    try {
      const response = await apiFetch('/api/designer/upscale-image', {
        method: 'POST',
        body: JSON.stringify({
          imageUrl: selectedElement.src,
          scale
        })
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to upscale image')
      }

      // Update the element with new image (maintain original dimensions for canvas)
      setElements(elements.map(el =>
        el.id === selectedId
          ? { ...el, src: response.imageUrl }
          : el
      ))

      // Update balance
      setUserItcBalance(response.newBalance)
      setUserBalance(response.newBalance)

      alert(`Image upscaled successfully!\n\nScale: ${scale}x\nCost: ${response.cost} ITC\nNew balance: ${response.newBalance} ITC`)

    } catch (error: any) {
      console.error('Image upscale error:', error)
      alert('Failed to upscale image: ' + error.message)
    } finally {
      setIsProcessingImage(false)
      setProcessingMessage('')
    }
  }

  const handleGenerateRealistic = async () => {
    try {
      setIsGeneratingMockup(true)

      if (!stageRef.current) {
        throw new Error('Canvas not ready')
      }

      const canvasDataUrl = stageRef.current.toDataURL({
        mimeType: 'image/png',
        quality: 1.0,
        pixelRatio: 2
      })

      let productTemplate: 'shirts' | 'hoodies' | 'tumblers'
      if (selectedTemplate === 'shirt') {
        productTemplate = 'shirts'
      } else if (selectedTemplate === 'hoodie') {
        productTemplate = 'hoodies'
      } else {
        productTemplate = 'tumblers'
      }

      const response = await apiFetch('/api/designer/generate-mockup', {
        method: 'POST',
        body: JSON.stringify({
          designImageUrl: canvasDataUrl,
          productTemplate,
          mockupType: 'flat'
        })
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to generate mockup')
      }

      setRealisticMockupUrl(response.mockupUrl)
      setUserItcBalance(response.newBalance)
      setUserBalance(response.newBalance)
      setMockupImageUrl(response.mockupUrl)

      alert(`Realistic mockup generated!\n\nCost: ${response.cost} ITC\nNew balance: ${response.newBalance} ITC`)

    } catch (error: any) {
      console.error('Mockup generation error:', error)
      alert('Failed to generate mockup: ' + error.message)
    } finally {
      setIsGeneratingMockup(false)
    }
  }

  const handleAddToCart = () => {
    if (elements.length === 0) {
      alert('Please add some design elements first')
      return
    }

    const canvasSnapshot = stageRef.current?.toDataURL()

    const templatePrices = {
      shirt: 24.99,
      tumbler: 29.99,
      hoodie: 45.99
    }

    const mockProduct = {
      id: product?.id || `custom-${selectedTemplate}`,
      name: product?.name || `Custom ${selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1)}`,
      description: product?.description || `Your custom ${selectedTemplate} with personalized graphics`,
      price: product?.price || templatePrices[selectedTemplate],
      images: product?.images || [canvasSnapshot || ''],
      category: product?.category || (selectedTemplate === 'shirt' || selectedTemplate === 'hoodie' ? 'shirts' as const : 'tumblers' as const),
      inStock: true
    }

    addToCart(mockProduct, 1, canvasSnapshot, {
      elements,
      template: selectedTemplate,
      mockupUrl: realisticMockupUrl || '',
      canvasSnapshot
    })

    alert('Design added to cart!')
    handleClose()
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

  const selectedElement = elements.find(el => el.id === selectedId)

  // Don't render modal if not open
  if (!isOpen) return null

  const modalContent = (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-all duration-200 ${
        isAnimating ? 'bg-black/70 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'
      }`}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className={`relative w-full h-full max-w-[98vw] max-h-[98vh] bg-bg border-2 border-primary/30 rounded-lg shadow-glowLg overflow-hidden flex flex-col transition-all duration-200 ${
        isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/20 bg-card/50">
          <div>
            <h2 className="text-2xl font-bold text-text">Design Studio</h2>
            <p className="text-sm text-muted">Create your custom design with professional tools</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-primary/10 rounded-lg transition-colors"
            title="Close (Esc)"
          >
            <svg className="w-6 h-6 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 h-full">
            {/* Left Sidebar - Tools */}
            <div className="lg:col-span-1 space-y-4 overflow-y-auto">
              {/* Template Selection */}
              <div className="bg-card p-4 rounded-lg shadow border border-primary/20">
                <h3 className="font-semibold mb-3 flex items-center text-text">
                  <svg className="w-5 h-5 mr-2 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                  Product Template
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {[{ id: 'shirt', name: 'T-Shirt', price: '$24.99' },
                    { id: 'tumbler', name: 'Tumbler', price: '$29.99' },
                    { id: 'hoodie', name: 'Hoodie', price: '$45.99' }].map((template) => (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template.id as any)}
                      className={`p-3 text-left rounded-md border transition-all ${
                        selectedTemplate === template.id
                          ? 'border-primary bg-primary/10 text-primary shadow-glow'
                          : 'border-primary/20 hover:border-primary/40 hover:bg-card'
                      }`}
                    >
                      <div className="font-medium">{template.name}</div>
                      <div className="text-sm text-muted">{template.price}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Image Tools */}
              <div className="bg-card p-4 rounded-lg shadow border border-primary/20">
                <h3 className="font-semibold mb-3 flex items-center text-text">
                  <svg className="w-5 h-5 mr-2 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Image Tools
                </h3>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="space-y-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full btn-primary"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload Image
                  </button>

                  <div className="border-t border-primary/20 pt-3 space-y-2">
                    <button
                      onClick={handleRemoveBackground}
                      disabled={!selectedElement || selectedElement.type !== 'image' || isProcessingImage || userItcBalance < BACKGROUND_REMOVAL_COST}
                      className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-all flex items-center justify-center"
                      title={userItcBalance < BACKGROUND_REMOVAL_COST ? 'Insufficient ITC balance' : 'Remove background from selected image'}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343" />
                      </svg>
                      Remove Background ({BACKGROUND_REMOVAL_COST} ITC)
                    </button>

                    <div className="relative">
                      <button
                        onClick={() => setShowUpscaleOptions(!showUpscaleOptions)}
                        disabled={!selectedElement || selectedElement.type !== 'image' || isProcessingImage || userItcBalance < IMAGE_UPSCALE_COST}
                        className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-all flex items-center justify-center"
                        title={userItcBalance < IMAGE_UPSCALE_COST ? 'Insufficient ITC balance' : 'Upscale selected image quality'}
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                        Upscale Image ({IMAGE_UPSCALE_COST} ITC)
                      </button>
                      {showUpscaleOptions && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-primary/30 rounded-lg shadow-lg p-2 space-y-1 z-10">
                          <button
                            onClick={() => handleUpscaleImage(2)}
                            className="w-full text-left px-3 py-2 hover:bg-primary/10 rounded text-text text-sm"
                          >
                            2x Resolution
                          </button>
                          <button
                            onClick={() => handleUpscaleImage(4)}
                            className="w-full text-left px-3 py-2 hover:bg-primary/10 rounded text-text text-sm"
                          >
                            4x Resolution
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted mt-2">
                    <span>ITC Balance:</span>
                    <span className="font-bold text-primary">{userItcBalance} ITC</span>
                  </div>
                </div>
              </div>

              {/* Text Tools */}
              <div className="bg-card p-4 rounded-lg shadow border border-primary/20">
                <h3 className="font-semibold mb-3 flex items-center text-text">
                  <svg className="w-5 h-5 mr-2 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Add Text
                </h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Enter text"
                    className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
                  />

                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Poppins">Poppins</option>
                    <option value="Orbitron">Orbitron</option>
                  </select>

                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      min="8"
                      max="72"
                      className="flex-1 px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
                      placeholder="Size"
                    />
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-12 h-10 border border-primary/20 rounded-md cursor-pointer"
                    />
                  </div>

                  <button
                    onClick={addText}
                    disabled={!textInput.trim()}
                    className="w-full btn-secondary disabled:opacity-50"
                  >
                    Add Text
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="bg-card p-4 rounded-lg shadow border border-primary/20">
                <h3 className="font-semibold mb-3 flex items-center text-text">
                  <svg className="w-5 h-5 mr-2 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Actions
                </h3>
                <div className="space-y-2">
                  <button
                    onClick={deleteSelected}
                    disabled={!selectedId || previewMode}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    Delete Selected
                  </button>
                  <button
                    onClick={handleAddToCart}
                    disabled={elements.length === 0}
                    className="w-full btn-primary disabled:opacity-50"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Add to Cart
                  </button>
                </div>
              </div>
            </div>

            {/* Center & Right - Canvas and Mockup */}
            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Canvas */}
              <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
                <h3 className="text-lg font-semibold text-text mb-4">Design Editor</h3>
                <div className="border-2 border-dashed border-primary/30 rounded-lg overflow-auto relative flex items-center justify-center bg-gray-100">
                  <Stage
                    ref={stageRef}
                    width={800}
                    height={600}
                    onClick={previewMode ? undefined : handleStageClick}
                    onTap={previewMode ? undefined : handleStageClick}
                  >
                    <Layer>
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
                  Click elements to select, drag to move, use handles to resize
                </p>
              </div>

              {/* Mockup Preview */}
              <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
                <h3 className="text-lg font-semibold text-text mb-4">Mockup Preview</h3>

                {/* Realistic Mockup Generator */}
                <RealisticMockupGenerator
                  designElements={elements}
                  productTemplate={
                    (selectedTemplate === 'shirt' ? 'shirts' : selectedTemplate === 'hoodie' ? 'hoodies' : 'tumblers') as 'shirts' | 'hoodies' | 'tumblers'
                  }
                  canvasRef={stageRef}
                  itcBalance={userItcBalance}
                  onBalanceUpdate={(newBalance) => {
                    setUserItcBalance(newBalance)
                    setUserBalance(newBalance)
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Processing Overlay */}
        {isProcessingImage && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border-2 border-primary rounded-lg p-8 text-center">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-lg font-semibold text-text">{processingMessage}</p>
              <p className="text-sm text-muted mt-2">This may take 10-20 seconds...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // Render modal using portal to ensure it's above all other content
  return createPortal(modalContent, document.body)
}

export default DesignStudioModal

