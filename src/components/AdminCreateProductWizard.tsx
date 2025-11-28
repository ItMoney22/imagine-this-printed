import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import confetti from 'canvas-confetti'
import { aiProducts } from '../lib/api'
import type { AIProductCreationRequest, AIProductCreationResponse, AIJob } from '../types'
import { supabase } from '../lib/supabase'

type WizardStep = 'describe' | 'review' | 'generate' | 'success'

interface NormalizedProduct {
  title: string
  description: string
  category_slug: string
  category_name: string
  tags: string[]
  seo_title: string
  seo_description: string
  summary: string
  variants: Array<{
    name: string
    priceDeltaCents?: number
  }>
  suggested_price_cents: number
  mockup_style: 'flat' | 'human'
  background: 'transparent' | 'studio'
}

export default function AdminCreateProductWizard() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState<WizardStep>('describe')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Describe
  const [prompt, setPrompt] = useState('')
  const [priceTarget, setPriceTarget] = useState(29.99)
  const [mockupStyle, setMockupStyle] = useState<'flat' | 'human'>('flat')
  const [background, setBackground] = useState<'transparent' | 'studio'>('studio')
  const [tone, setTone] = useState<'professional' | 'playful' | 'minimal'>('professional')
  const [imageStyle, setImageStyle] = useState<'realistic' | 'cartoon' | 'semi-realistic'>('semi-realistic')
  const [category, setCategory] = useState<'dtf-transfers' | 'shirts' | 'hoodies' | 'tumblers'>('shirts')
  const [targetAudience, setTargetAudience] = useState('')
  const [primaryColors, setPrimaryColors] = useState('')
  const [designStyle, setDesignStyle] = useState('')
  const [numImages, setNumImages] = useState(1)
  const [useSearch, setUseSearch] = useState(true)

  // Step 2: Review (normalized product from GPT)
  const [normalized, setNormalized] = useState<NormalizedProduct | null>(null)

  // Step 3: Generate (product ID and job status)
  const [productId, setProductId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<AIJob[]>([])
  const [removingBackground, setRemovingBackground] = useState(false)
  const [creatingMockups, setCreatingMockups] = useState(false)

  // Step 4: Success
  const [finalProduct, setFinalProduct] = useState<any>(null)
  const [productAssets, setProductAssets] = useState<any[]>([])
  const [approving, setApproving] = useState(false)

  // Poll job status every 2 seconds during generation
  useEffect(() => {
    if (currentStep === 'generate' && productId) {
      console.log('[Wizard] 🔄 Starting polling for product:', productId)

      const interval = setInterval(async () => {
        try {
          console.log('[Wizard] 📡 Polling status for product:', productId)
          const response = await aiProducts.getStatus(productId)
          console.log('[Wizard] 📊 Status response:', response)

          const jobs = response.jobs || []
          console.log('[Wizard] 📋 Jobs:', jobs.map((j: any) => ({ id: j.id, type: j.type, status: j.status })))
          setJobs(jobs)

          // Update product and assets in real-time (for image previews)
          setFinalProduct(response.product)
          setProductAssets(response.assets || [])
        } catch (err: any) {
          console.error('[Wizard] ❌ Error polling status:', err)
        }
      }, 2000)

      return () => clearInterval(interval)
    }
  }, [currentStep, productId])

  const handleDescribe = async () => {
    if (!prompt.trim()) {
      setError('Please describe your product idea')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Enrich prompt with additional details
      let enrichedPrompt = prompt
      if (targetAudience) enrichedPrompt += `\nTarget Audience: ${targetAudience}`
      if (primaryColors) enrichedPrompt += `\nPrimary Colors: ${primaryColors}`
      if (designStyle) enrichedPrompt += `\nDesign Style: ${designStyle}`
      enrichedPrompt += `\nProduct Category: ${category}`

      const request: AIProductCreationRequest = {
        prompt: enrichedPrompt,
        priceTarget,
        mockupStyle,
        background,
        tone,
        imageStyle,
        category,
        numImages,
        useSearch,
      }

      const response: AIProductCreationResponse = await aiProducts.create(request)

      // Backend returns { productId, product: { ...product, normalized }, jobs }
      setNormalized(response.product.normalized)
      setProductId(response.productId)
      setCurrentStep('review')
    } catch (err: any) {
      setError(err.message || 'Failed to create product')
    } finally {
      setLoading(false)
    }
  }

  const handleReview = () => {
    setCurrentStep('generate')
  }

  const handleStartOver = () => {
    setCurrentStep('describe')
    setPrompt('')
    setNormalized(null)
    setProductId(null)
    setJobs([])
    setFinalProduct(null)
    setProductAssets([])
    setError(null)
  }

  const handleApprove = async () => {
    if (!finalProduct) return

    setApproving(true)
    try {
      // Update product status from 'draft' to 'active' and set is_active to true
      const { error } = await supabase
        .from('products')
        .update({
          status: 'active',
          is_active: true
        })
        .eq('id', finalProduct.id)

      if (error) throw error

      // Show success message
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.5 }
      })

      // Navigate to admin dashboard Products tab after short delay
      setTimeout(() => {
        navigate('/admin?tab=products')
      }, 1500)
    } catch (error: any) {
      setError(error.message || 'Failed to approve product')
      setApproving(false)
    }
  }

  const handleRemoveBackground = async () => {
    if (!productId) return

    setRemovingBackground(true)
    setError(null)

    try {
      console.log('[Wizard] 🔄 Triggering background removal for product:', productId)
      await aiProducts.removeBackground(productId)
      console.log('[Wizard] ✅ Background removal job created')
      setRemovingBackground(false)
    } catch (error: any) {
      console.error('[Wizard] ❌ Error creating background removal job:', error)
      setError(error.message || 'Failed to start background removal')
      setRemovingBackground(false)
    }
  }

  const handleCreateMockups = async () => {
    if (!productId) return

    setCreatingMockups(true)
    setError(null)

    try {
      console.log('[Wizard] 🔄 Triggering mockup creation for product:', productId)
      await aiProducts.createMockups(productId)
      console.log('[Wizard] ✅ Mockup jobs created')
      setCreatingMockups(false)
    } catch (error: any) {
      console.error('[Wizard] ❌ Error creating mockup jobs:', error)
      setError(error.message || 'Failed to start mockup creation')
      setCreatingMockups(false)
    }
  }

  const handleViewProduct = () => {
    // Trigger confetti animation
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    })

    setCurrentStep('success')
  }

  const getJobStatusIcon = (status: AIJob['status']) => {
    switch (status) {
      case 'queued':
        return '⏳'
      case 'running':
        return '🔄'
      case 'succeeded':
        return '✅'
      case 'failed':
        return '❌'
      default:
        return '❓'
    }
  }

  const getJobStatusColor = (status: AIJob['status']) => {
    switch (status) {
      case 'queued':
        return 'bg-gray-100 text-gray-800'
      case 'running':
        return 'bg-blue-100 text-blue-800'
      case 'succeeded':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Progress Steps - Premium Design */}
      <div className="mb-12">
        <div className="relative bg-card/40 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl overflow-hidden">
          {/* Glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent blur-sm" />

          <div className="flex items-center justify-between relative z-10">
            {['describe', 'review', 'generate', 'success'].map((step, index) => (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center z-10 group">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-lg shadow-lg transition-all duration-500 ${currentStep === step
                      ? 'bg-gradient-to-br from-primary to-secondary text-white scale-110 shadow-[0_0_20px_rgba(168,85,247,0.5)] ring-2 ring-white/20'
                      : index < ['describe', 'review', 'generate', 'success'].indexOf(currentStep)
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                        : 'bg-card border border-white/10 text-muted group-hover:border-primary/50 group-hover:text-primary/80'
                      }`}
                  >
                    {index < ['describe', 'review', 'generate', 'success'].indexOf(currentStep) ? (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="font-display">{index + 1}</span>
                    )}
                  </div>
                  <span className={`text-sm mt-4 font-medium capitalize transition-colors duration-300 ${currentStep === step ? 'text-primary drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'text-muted'
                    }`}>{step}</span>
                </div>
                {index < 3 && (
                  <div className="flex-1 h-1 mx-4 rounded-full overflow-hidden bg-white/5 relative">
                    <div
                      className={`absolute inset-0 h-full rounded-full transition-all duration-700 ease-out ${index < ['describe', 'review', 'generate', 'success'].indexOf(currentStep)
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 w-full shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                        : 'w-0'
                        }`}
                    />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-8 bg-red-500/10 border border-red-500/30 rounded-2xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.2)] backdrop-blur-sm animate-shake">
          <div className="flex items-start space-x-3">
            <svg className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-200 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Step 1: Describe */}
      {currentStep === 'describe' && (
        <div className="bg-card/30 rounded-3xl shadow-2xl p-8 border border-white/10 backdrop-blur-sm">
          <div className="mb-8">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-3 drop-shadow-[0_0_10px_rgba(168,85,247,0.3)]">
              Describe Your Product
            </h2>
            <p className="text-muted text-lg">
              Describe your product idea in natural language. Our AI will interpret it and generate everything you need.
            </p>
          </div>

          <div className="space-y-8">
            <div>
              <label className="block text-sm font-semibold text-text mb-3 flex items-center">
                <svg className="w-5 h-5 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Product Description *
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="w-full bg-bg/50 border border-white/10 rounded-xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all shadow-inner text-text placeholder:text-muted/50"
                placeholder="Example: A t-shirt with a futuristic cyberpunk cityscape, neon lights reflecting off rain-soaked streets, featuring a lone figure in a hoodie..."
              />
              <p className="text-xs text-muted mt-2 ml-1">
                Be as detailed as you want. Mention style, colors, themes, target audience, etc.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Product Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="dtf-transfers">DTF Transfers</option>
                  <option value="shirts">T-Shirts</option>
                  <option value="hoodies">Hoodies</option>
                  <option value="tumblers">Tumblers</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Target Price ($)
                </label>
                <input
                  type="number"
                  value={priceTarget}
                  onChange={(e) => setPriceTarget(parseFloat(e.target.value))}
                  step="0.01"
                  min="0"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Target Audience
                </label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g., gamers, fitness enthusiasts"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text placeholder:text-muted/50"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Primary Colors
                </label>
                <input
                  type="text"
                  value={primaryColors}
                  onChange={(e) => setPrimaryColors(e.target.value)}
                  placeholder="e.g., neon blue, hot pink, black"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text placeholder:text-muted/50"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Design Style/Aesthetic
                </label>
                <input
                  type="text"
                  value={designStyle}
                  onChange={(e) => setDesignStyle(e.target.value)}
                  placeholder="e.g., cyberpunk, minimalist, retro"
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text placeholder:text-muted/50"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Number of Images
                </label>
                <select
                  value={numImages}
                  onChange={(e) => setNumImages(parseInt(e.target.value))}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="1">1 Image</option>
                  <option value="2">2 Images</option>
                  <option value="3">3 Images</option>
                  <option value="4">4 Images</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Mockup Style
                </label>
                <select
                  value={mockupStyle}
                  onChange={(e) => setMockupStyle(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="casual">Casual Wear</option>
                  <option value="lifestyle">Lifestyle Shot</option>
                  <option value="product">Product Focus</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Background Style
                </label>
                <select
                  value={background}
                  onChange={(e) => setBackground(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="studio">Studio / White</option>
                  <option value="lifestyle">Lifestyle Scene</option>
                  <option value="urban">Urban Environment</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Brand Tone
                </label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as any)}
                  className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-text cursor-pointer"
                >
                  <option value="professional">Professional</option>
                  <option value="playful">Playful</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>
            </div>

            {/* Web Search Toggle */}
            <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-2xl p-6 border border-blue-500/20 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="block text-lg font-bold text-text mb-2 flex items-center">
                    <svg className="w-6 h-6 mr-2 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    Web Search Enhancement
                  </label>
                  <p className="text-sm text-muted">
                    Uses Google to gather accurate, real-time context about your product topic. Recommended for pop culture, games, movies, and trending topics.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseSearch(!useSearch)}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${useSearch
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-gray-600 border-gray-600'
                    }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${useSearch ? 'translate-x-6' : 'translate-x-0'
                      }`}
                  />
                </button>
              </div>
            </div>

            {/* Image Style Selection - Prominent Feature */}
            <div className="bg-gradient-to-br from-purple-500/10 via-indigo-500/10 to-blue-500/10 rounded-2xl p-8 border border-purple-500/20 shadow-xl backdrop-blur-sm">
              <label className="block text-xl font-bold text-text mb-2 flex items-center">
                <svg className="w-6 h-6 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                Image Art Style *
              </label>
              <p className="text-sm text-muted mb-6">
                Choose the artistic style for your product image. This affects how the AI generates the visual artwork.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <button
                  type="button"
                  onClick={() => setImageStyle('realistic')}
                  className={`p-6 rounded-2xl border transition-all duration-300 transform hover:scale-105 ${imageStyle === 'realistic'
                    ? 'border-primary bg-primary/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] ring-1 ring-primary/50'
                    : 'border-white/10 bg-card/50 hover:border-primary/50 hover:shadow-lg'
                    }`}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">📸</div>
                    <h4 className="font-bold text-text mb-2 text-lg">Realistic</h4>
                    <p className="text-sm text-muted">Photo-realistic, detailed, lifelike imagery</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setImageStyle('semi-realistic')}
                  className={`p-6 rounded-2xl border transition-all duration-300 transform hover:scale-105 ${imageStyle === 'semi-realistic'
                    ? 'border-primary bg-primary/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] ring-1 ring-primary/50'
                    : 'border-white/10 bg-card/50 hover:border-primary/50 hover:shadow-lg'
                    }`}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">🎭</div>
                    <h4 className="font-bold text-text mb-2 text-lg">Semi-Realistic</h4>
                    <p className="text-sm text-muted">Balanced blend of realism and artistic style</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setImageStyle('cartoon')}
                  className={`p-6 rounded-2xl border transition-all duration-300 transform hover:scale-105 ${imageStyle === 'cartoon'
                    ? 'border-primary bg-primary/20 shadow-[0_0_15px_rgba(168,85,247,0.3)] ring-1 ring-primary/50'
                    : 'border-white/10 bg-card/50 hover:border-primary/50 hover:shadow-lg'
                    }`}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">🎨</div>
                    <h4 className="font-bold text-text mb-2 text-lg">Cartoon</h4>
                    <p className="text-sm text-muted">Illustrated, stylized, playful artwork</p>
                  </div>
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={handleDescribe}
                disabled={loading}
                className="group relative bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold px-10 py-4 rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-2xl hover:shadow-purple-500/50 transform hover:scale-105"
              >
                <span className="flex items-center space-x-2">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Product</span>
                      <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {currentStep === 'review' && normalized && (
        <div className="bg-gradient-to-br from-white to-purple-50/30 dark:from-gray-900 dark:to-purple-950/20 rounded-3xl shadow-2xl p-8 border border-purple-200/50 dark:border-purple-800/50 backdrop-blur-sm">
          <div className="mb-8">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent mb-3">
              Review AI Interpretation
            </h2>
            <p className="text-muted text-lg">
              Here's how our AI interpreted your product. You can proceed with generation or start over to make changes.
            </p>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/30 dark:to-indigo-900/30 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-3 text-lg flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Product Title
              </h3>
              <p className="text-text text-xl font-semibold">{normalized.title}</p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-3 text-lg flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                Description
              </h3>
              <p className="text-text leading-relaxed">{normalized.description}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
                <h3 className="font-bold text-text mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  Category
                </h3>
                <p className="text-text capitalize text-lg font-semibold">{normalized.category_slug}</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
                <h3 className="font-bold text-text mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Suggested Price
                </h3>
                <p className="text-text text-2xl font-bold text-green-600">${(normalized.suggested_price_cents / 100).toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Tags
              </h3>
              <div className="flex flex-wrap gap-3">
                {normalized.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-4 py-2 bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/50 dark:to-indigo-900/50 text-purple-800 dark:text-purple-200 rounded-full text-sm font-semibold shadow-md"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
              <h3 className="font-bold text-text mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                Variants
              </h3>
              <div className="space-y-3">
                {normalized.variants.map((variant, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-700"
                  >
                    <span className="text-text font-semibold">
                      {variant.name}
                    </span>
                    <span className="font-bold text-text px-3 py-1 bg-white dark:bg-gray-700 rounded-lg shadow">
                      {variant.priceDeltaCents
                        ? `+$${(variant.priceDeltaCents / 100).toFixed(2)}`
                        : 'Base price'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <button
                onClick={handleStartOver}
                className="group bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                <span className="flex items-center space-x-2">
                  <svg className="w-5 h-5 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                  </svg>
                  <span>Start Over</span>
                </span>
              </button>
              <button
                onClick={handleReview}
                className="group bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-purple-500/50 transform hover:scale-105"
              >
                <span className="flex items-center space-x-2">
                  <span>Generate Assets</span>
                  <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Generate */}
      {currentStep === 'generate' && (
        <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/10 ring-1 ring-white/5">
          <div className="mb-8">
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary via-purple-400 to-secondary bg-clip-text text-transparent mb-3 flex items-center drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              <svg className="w-8 h-8 mr-3 text-primary animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Generating Assets
            </h2>
            <p className="text-muted text-lg">
              Our AI is working through multiple steps to create your product. This process typically takes 2-5 minutes.
            </p>
          </div>

          {/* Progress Timeline */}
          <div className="mb-10 bg-bg/40 backdrop-blur-sm rounded-2xl p-8 border border-white/10 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
            <h3 className="font-semibold text-text mb-6 flex items-center text-lg">
              <svg className="w-5 h-5 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI Generation Process
            </h3>
            <div className="space-y-6 relative">
              {/* Vertical Line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-white/10"></div>

              <div className="flex items-start space-x-4 relative z-10">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold shadow-[0_0_10px_rgba(34,197,94,0.5)]">✓</div>
                <div>
                  <p className="font-medium text-text">Step 1: Search & Context Gathering</p>
                  <p className="text-muted text-sm mt-1">Using SerpAPI to gather accurate, current information about your product topic</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold shadow-[0_0_10px_rgba(34,197,94,0.5)]">✓</div>
                <div>
                  <p className="font-medium text-text">Step 2: AI Product Analysis</p>
                  <p className="text-muted text-sm mt-1">GPT analyzes context and generates detailed product metadata and image descriptions</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ${jobs.some(j => j.type === 'replicate_image' && j.status === 'running') ? 'bg-primary animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.6)]' : jobs.some(j => j.type === 'replicate_image' && j.status === 'succeeded') ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-white/10 border border-white/20'}`}>
                  {jobs.some(j => j.type === 'replicate_image' && j.status === 'succeeded') ? '✓' : '3'}
                </div>
                <div>
                  <p className={`font-medium transition-colors ${jobs.some(j => j.type === 'replicate_image' && j.status === 'running') ? 'text-primary' : 'text-text'}`}>Step 3: Generate Product Image</p>
                  <p className="text-muted text-sm mt-1">Flux Fast creates high-quality product artwork based on GPT's detailed visual description</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ${jobs.some(j => j.type === 'replicate_rembg' && j.status === 'running') ? 'bg-primary animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.6)]' : jobs.some(j => j.type === 'replicate_rembg' && j.status === 'succeeded') ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-white/10 border border-white/20'}`}>
                  {jobs.some(j => j.type === 'replicate_rembg' && j.status === 'succeeded') ? '✓' : '3.5'}
                </div>
                <div>
                  <p className={`font-medium transition-colors ${jobs.some(j => j.type === 'replicate_rembg' && j.status === 'running') ? 'text-primary' : 'text-text'}`}>Step 3.5: Remove Background</p>
                  <p className="text-muted text-sm mt-1">Preparing clean product image for mockup generation (removes background for better mockup quality)</p>
                </div>
              </div>
              <div className="flex items-start space-x-4 relative z-10">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ${jobs.some(j => j.type === 'replicate_mockup' && j.status === 'running') ? 'bg-primary animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.6)]' : jobs.filter(j => j.type === 'replicate_mockup' && j.status === 'succeeded').length === 2 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-white/10 border border-white/20'}`}>
                  {jobs.filter(j => j.type === 'replicate_mockup' && j.status === 'succeeded').length === 2 ? '✓' : '4'}
                </div>
                <div>
                  <p className={`font-medium transition-colors ${jobs.some(j => j.type === 'replicate_mockup' && j.status === 'running') ? 'text-primary' : 'text-text'}`}>Step 4: Generate Product Mockups (2x)</p>
                  <p className="text-muted text-sm mt-1">Nano Banana AI applies the product image to realistic mockup templates (flat lay + lifestyle)</p>
                </div>
              </div>
            </div>
          </div>

          {/* Job Status Cards */}
          <div className="space-y-5">
            {jobs.length === 0 ? (
              <div className="text-center py-12 bg-card/20 backdrop-blur-sm rounded-2xl border border-white/10 shadow-xl">
                <div className="relative w-20 h-20 mx-auto mb-6">
                  <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin shadow-[0_0_15px_rgba(168,85,247,0.4)]"></div>
                </div>
                <p className="text-muted text-lg font-semibold">Initializing AI jobs...</p>
              </div>
            ) : (
              jobs.map((job, index) => (
                <div
                  key={job.id}
                  className={`relative overflow-hidden flex items-center justify-between p-6 rounded-2xl border transition-all duration-500 shadow-lg ${job.status === 'running'
                    ? 'bg-card/60 border-primary/50 shadow-[0_0_20px_rgba(168,85,247,0.15)] ring-1 ring-primary/30'
                    : job.status === 'succeeded'
                      ? 'bg-card/40 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]'
                      : job.status === 'failed'
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-card/20 border-white/5'
                    }`}
                >
                  {job.status === 'running' && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer" style={{ backgroundSize: '200% 100%' }}></div>
                  )}

                  <div className="flex items-center space-x-5 relative z-10">
                    <div className={`text-4xl transition-transform duration-500 ${job.status === 'running' ? 'animate-pulse scale-110' : ''}`}>
                      {getJobStatusIcon(job.status)}
                    </div>
                    <div>
                      <p className="font-bold text-text text-xl mb-1">
                        {job.type === 'replicate_image' && '🎨 Product Image Generation'}
                        {job.type === 'replicate_rembg' && '✂️ Background Removal'}
                        {job.type === 'replicate_mockup' && jobs.filter(j => j.type === 'replicate_mockup').indexOf(job) === 0 && '🖼️ Mockup #1 - Flat Lay'}
                        {job.type === 'replicate_mockup' && jobs.filter(j => j.type === 'replicate_mockup').indexOf(job) === 1 && '🖼️ Mockup #2 - Lifestyle'}
                      </p>
                      <p className="text-sm text-muted font-medium">
                        {job.status === 'queued' && job.type === 'replicate_image' && 'Waiting to start generation...'}
                        {job.status === 'queued' && job.type === 'replicate_rembg' && 'Waiting for source image...'}
                        {job.status === 'queued' && job.type === 'replicate_mockup' && 'Waiting for background removal...'}
                        {job.status === 'running' && job.type === 'replicate_image' && 'Generating artwork with Flux Fast...'}
                        {job.status === 'running' && job.type === 'replicate_rembg' && 'Removing background with rembg...'}
                        {job.status === 'running' && job.type === 'replicate_mockup' && 'Applying design to mockup with Nano Banana...'}
                        {job.status === 'succeeded' && 'Complete! Image ready.'}
                        {job.status === 'failed' && 'Generation failed. Please try again.'}
                      </p>
                      {job.error && (
                        <p className="text-sm text-red-400 mt-2 font-bold bg-red-950/50 border border-red-500/30 px-3 py-1 rounded-lg inline-block">
                          Error: {job.error}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`px-5 py-2 rounded-xl text-sm font-bold uppercase shadow-md relative z-10 backdrop-blur-md border ${getJobStatusColor(
                      job.status
                    )}`}
                  >
                    {job.status}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Manual Workflow: Source Image Preview + Remove Background OR Skip Button */}
          {productAssets.some(asset => asset.kind === 'source') && !jobs.some(j => j.type === 'replicate_rembg') && !jobs.some(j => j.type === 'replicate_mockup') && (
            <div className="mt-10 bg-card/30 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
              <h3 className="font-bold text-text text-2xl mb-4 text-center">Source Image Generated!</h3>
              <div className="bg-bg/50 rounded-xl p-6 mb-6 border border-white/5">
                <img
                  src={productAssets.find(asset => asset.kind === 'source')?.url}
                  alt="Source product image"
                  className="w-full max-w-md mx-auto rounded-lg shadow-lg"
                />
              </div>
              <div className="text-center">
                <p className="text-muted mb-4">Next step: Remove the background for better mockup quality, or skip to mockups</p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={handleRemoveBackground}
                    disabled={removingBackground || creatingMockups}
                    className="group bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-primary/50 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center space-x-2 text-lg">
                      <span>{removingBackground ? 'Starting...' : 'Remove Background'}</span>
                      <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </span>
                  </button>
                  <button
                    onClick={handleCreateMockups}
                    disabled={removingBackground || creatingMockups}
                    className="group bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-green-500/50 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center space-x-2 text-lg">
                      <span>{creatingMockups ? 'Starting...' : 'Skip to Mockups'}</span>
                      <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Manual Workflow: Background Removed Preview + Create Mockups Button */}
          {productAssets.some(asset => asset.kind === 'nobg') && !jobs.some(j => j.type === 'replicate_mockup') && (
            <div className="mt-10 bg-card/30 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
              <h3 className="font-bold text-text text-2xl mb-4 text-center">Background Removed!</h3>
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="bg-bg/50 rounded-xl p-4 border border-white/5">
                  <p className="text-sm text-muted text-center mb-2">With Background</p>
                  <img
                    src={productAssets.find(asset => asset.kind === 'source')?.url}
                    alt="Source product image"
                    className="w-full rounded-lg shadow-lg"
                  />
                </div>
                <div className="bg-bg/50 rounded-xl p-4 border border-white/5">
                  <p className="text-sm text-muted text-center mb-2">Without Background</p>
                  <img
                    src={productAssets.find(asset => asset.kind === 'nobg')?.url}
                    alt="Product without background"
                    className="w-full rounded-lg shadow-lg"
                  />
                </div>
              </div>
              <div className="text-center">
                <p className="text-muted mb-4">Next step: Generate mockups with the clean product image</p>
                <button
                  onClick={handleCreateMockups}
                  disabled={creatingMockups}
                  className="group bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-primary/50 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center space-x-2 text-lg">
                    <span>{creatingMockups ? 'Starting...' : 'Create Mockups'}</span>
                    <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Manual Workflow: Mockups Complete + View Product Button */}
          {jobs.filter(j => j.type === 'replicate_mockup' && j.status === 'succeeded').length === 2 && (
            <div className="mt-10 text-center bg-card/30 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
              <svg className="w-16 h-16 mx-auto mb-4 text-green-500 animate-bounce drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="font-bold text-text text-2xl mb-4">All Mockups Generated!</h3>
              <div className="grid grid-cols-2 gap-6 mb-6">
                {productAssets.filter(asset => asset.kind === 'mockup').map((asset, index) => (
                  <div key={asset.id} className="bg-bg/50 rounded-xl p-4 border border-white/5">
                    <p className="text-sm text-muted text-center mb-2">Mockup #{index + 1}</p>
                    <img
                      src={asset.url}
                      alt={`Product mockup ${index + 1}`}
                      className="w-full rounded-lg shadow-lg"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={handleViewProduct}
                className="group bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold px-12 py-5 rounded-xl transition-all shadow-lg hover:shadow-2xl hover:shadow-primary/50 transform hover:scale-105"
              >
                <span className="flex items-center space-x-2 text-lg">
                  <span>View Product</span>
                  <svg className="w-6 h-6 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Success */}
      {currentStep === 'success' && finalProduct && (
        <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl p-10 border border-white/10 ring-1 ring-white/5">
          {/* Success Header */}
          <div className="text-center mb-10">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full animate-pulse shadow-[0_0_30px_rgba(52,211,153,0.5)]"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-14 h-14 text-white animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent mb-3 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]">
              Product Created Successfully!
            </h2>
            <p className="text-muted text-xl">
              Your AI-generated product is ready for review
            </p>
          </div>

          {/* Product Details Card */}
          <div className="bg-bg/40 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-white/10 shadow-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted mb-1">Product Name</p>
                <p className="font-semibold text-text text-lg">{finalProduct.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Status</p>
                <span className="inline-block px-3 py-1 bg-yellow-500/20 text-yellow-200 border border-yellow-500/30 rounded-full text-sm font-semibold">
                  Draft
                </span>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Price</p>
                <p className="font-semibold text-text text-lg">${finalProduct.price}</p>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Product ID</p>
                <p className="font-mono text-sm text-muted">{finalProduct.id.substring(0, 8)}...</p>
              </div>
            </div>
          </div>

          {/* Generated Assets Gallery */}
          <div className="mb-6">
            <h3 className="font-semibold text-text mb-4 text-lg flex items-center">
              <svg className="w-5 h-5 mr-2 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Generated Images ({productAssets.length})
            </h3>

            {productAssets.length === 0 ? (
              <div className="text-center py-8 bg-bg/30 rounded-lg border border-white/5">
                <p className="text-muted">No images generated yet. Assets may still be processing.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {productAssets.map((asset: any) => (
                  <div key={asset.id} className="border border-white/10 rounded-xl overflow-hidden group hover:shadow-xl hover:shadow-primary/20 transition-all duration-300">
                    <div className="relative">
                      <img
                        src={asset.url}
                        alt={asset.kind}
                        className="w-full h-64 object-cover"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center backdrop-blur-sm">
                        <a
                          href={asset.url}
                          download
                          className="bg-white text-gray-900 px-4 py-2 rounded-lg font-bold hover:bg-gray-100 transition-all flex items-center space-x-2 transform translate-y-4 group-hover:translate-y-0 duration-300"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span>Download</span>
                        </a>
                      </div>
                    </div>
                    <div className="p-3 bg-card/50 backdrop-blur-sm">
                      <p className="text-sm font-medium text-text capitalize">{asset.kind}</p>
                      <p className="text-xs text-muted">{asset.width} x {asset.height}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-8 border-t border-white/10">
            <button
              onClick={handleStartOver}
              className="group w-full md:w-auto bg-white/5 hover:bg-white/10 text-text font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-105 border border-white/10"
            >
              <span className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5 transition-transform group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Create Another Product</span>
              </span>
            </button>
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <button
                onClick={() => navigate('/admin?tab=products')}
                className="group text-center bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:scale-105 border border-white/10"
              >
                <span className="flex items-center justify-center space-x-2">
                  <svg className="w-5 h-5 transition-transform group-hover:rotate-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Edit in Products Tab</span>
                </span>
              </button>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="group bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold px-10 py-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-2xl hover:shadow-emerald-500/50 transform hover:scale-105"
              >
                <span className="flex items-center justify-center space-x-2">
                  {approving ? (
                    <>
                      <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Approving...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-6 h-6 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Approve & Publish</span>
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

