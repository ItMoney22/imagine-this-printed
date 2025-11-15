import React, { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

interface ModelDescription {
  garmentColor: string
  shirtType: string
  gender: string
  ethnicity: string
  hairColor: string
  eyeColor: string
  bodyType: string
  additionalDetails: string
}

interface MockupGeneration {
  generationId: string
  status: 'generating' | 'completed' | 'failed' | 'selected' | 'discarded'
  mockupUrl?: string
  timestamp: string
  errorMessage?: string
}

interface RealisticMockupGeneratorProps {
  designElements: any[]
  productTemplate: 'shirts' | 'hoodies' | 'tumblers'
  canvasRef: React.RefObject<any>
  itcBalance: number
  onBalanceUpdate: (newBalance: number) => void
}

const GENERATION_COST = 25

const RealisticMockupGenerator: React.FC<RealisticMockupGeneratorProps> = ({
  designElements,
  productTemplate,
  canvasRef,
  itcBalance,
  onBalanceUpdate
}) => {
  const [showForm, setShowForm] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [sessionMockups, setSessionMockups] = useState<MockupGeneration[]>([])
  const [currentMockup, setCurrentMockup] = useState<MockupGeneration | null>(null)
  const [error, setError] = useState<string>('')

  // Form state
  const [modelDescription, setModelDescription] = useState<ModelDescription>({
    garmentColor: '#FFFFFF',
    shirtType: 'crew-neck',
    gender: 'female',
    ethnicity: 'caucasian',
    hairColor: 'blonde',
    eyeColor: 'blue',
    bodyType: 'athletic',
    additionalDetails: ''
  })

  const handleGenerate = async () => {
    if (itcBalance < GENERATION_COST) {
      setError(`Insufficient ITC balance. You need ${GENERATION_COST} ITC.`)
      return
    }

    if (!canvasRef.current) {
      setError('Canvas not ready')
      return
    }

    setIsGenerating(true)
    setError('')

    try {
      // Get canvas data URL
      const designImageUrl = canvasRef.current.toDataURL({
        mimeType: 'image/png',
        quality: 1.0,
        pixelRatio: 2
      })

      // Start generation
      const response = await apiFetch('/api/realistic-mockups/generate', {
        method: 'POST',
        body: JSON.stringify({
          designImageUrl,
          designElements,
          productTemplate,
          modelDescription
        })
      })

      if (!response.ok) {
        throw new Error(response.error || 'Generation failed')
      }

      onBalanceUpdate(response.newBalance)

      // Add to session mockups
      const newMockup: MockupGeneration = {
        generationId: response.generationId,
        status: 'generating',
        timestamp: new Date().toISOString()
      }

      setSessionMockups(prev => [newMockup, ...prev])
      setCurrentMockup(newMockup)
      setShowForm(false)

      // Poll for completion
      pollGenerationStatus(response.generationId)

    } catch (err: any) {
      console.error('Generation error:', err)
      setError(err.message)
    } finally {
      setIsGenerating(false)
    }
  }

  const pollGenerationStatus = async (generationId: string) => {
    const maxAttempts = 60 // 60 seconds
    let attempts = 0

    const poll = async () => {
      try {
        const response = await apiFetch(`/api/realistic-mockups/${generationId}/status`)

        if (!response.ok) {
          throw new Error('Failed to check status')
        }

        // Update mockup in session
        setSessionMockups(prev =>
          prev.map(m =>
            m.generationId === generationId
              ? { ...m, status: response.status, mockupUrl: response.mockupUrl, errorMessage: response.errorMessage }
              : m
          )
        )

        if (currentMockup?.generationId === generationId) {
          setCurrentMockup(prev => prev ? { ...prev, status: response.status, mockupUrl: response.mockupUrl, errorMessage: response.errorMessage } : null)
        }

        if (response.status === 'completed' || response.status === 'failed') {
          return // Done
        }

        // Continue polling
        attempts++
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000) // Poll every 2 seconds
        }

      } catch (err) {
        console.error('Status poll error:', err)
      }
    }

    poll()
  }

  const handleSelect = async (generationId: string) => {
    try {
      const response = await apiFetch(`/api/realistic-mockups/${generationId}/select`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to select mockup')
      }

      // Update status
      setSessionMockups(prev =>
        prev.map(m =>
          m.generationId === generationId
            ? { ...m, status: 'selected' }
            : m
        )
      )

      if (currentMockup?.generationId === generationId) {
        setCurrentMockup(prev => prev ? { ...prev, status: 'selected' } : null)
      }

      alert(`Mockup selected! Download URL: ${response.downloadUrl}`)

    } catch (err: any) {
      alert('Failed to select mockup: ' + err.message)
    }
  }

  const handleDiscard = async (generationId: string) => {
    const confirmed = window.confirm(
      `Discard this mockup and get refunded ${GENERATION_COST} ITC?`
    )

    if (!confirmed) return

    try {
      const response = await apiFetch(`/api/realistic-mockups/${generationId}/discard`, {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to discard mockup')
      }

      onBalanceUpdate(response.newBalance)

      // Update status
      setSessionMockups(prev =>
        prev.map(m =>
          m.generationId === generationId
            ? { ...m, status: 'discarded' }
            : m
        )
      )

      if (currentMockup?.generationId === generationId) {
        setCurrentMockup(null)
      }

      alert(`Mockup discarded. Refunded ${response.refundAmount} ITC. New balance: ${response.newBalance} ITC`)

    } catch (err: any) {
      alert('Failed to discard mockup: ' + err.message)
    }
  }

  return (
    <div className="space-y-4">
      {/* Generate Button */}
      {!showForm && !isGenerating && (
        <button
          onClick={() => setShowForm(true)}
          disabled={itcBalance < GENERATION_COST}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-all shadow-lg"
        >
          Generate Realistic Preview ({GENERATION_COST} ITC)
        </button>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Model Configuration Form */}
      {showForm && (
        <div className="bg-card border border-primary/30 rounded-lg p-4 space-y-4">
          <h4 className="font-semibold text-text">Customize Your Model</h4>

          <div className="grid grid-cols-2 gap-3">
            {/* Garment Color */}
            <div className="col-span-2">
              <label className="block text-sm text-muted mb-1">Garment Color</label>
              <div className="flex items-center space-x-2">
                <select
                  value={modelDescription.garmentColor}
                  onChange={(e) => setModelDescription(prev => ({ ...prev, garmentColor: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
                >
                  <option value="#FFFFFF">White</option>
                  <option value="#000000">Black</option>
                  <option value="#1E3A8A">Navy</option>
                  <option value="#6B7280">Gray</option>
                  <option value="#DC2626">Red</option>
                </select>
                <input
                  type="color"
                  value={modelDescription.garmentColor}
                  onChange={(e) => setModelDescription(prev => ({ ...prev, garmentColor: e.target.value }))}
                  className="w-12 h-10 border border-primary/20 rounded-md cursor-pointer"
                />
              </div>
            </div>

            {/* Shirt Type */}
            {productTemplate === 'shirts' && (
              <div className="col-span-2">
                <label className="block text-sm text-muted mb-1">Shirt Style</label>
                <select
                  value={modelDescription.shirtType}
                  onChange={(e) => setModelDescription(prev => ({ ...prev, shirtType: e.target.value }))}
                  className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
                >
                  <option value="crew-neck">Crew Neck</option>
                  <option value="v-neck">V-Neck</option>
                  <option value="tank">Tank Top</option>
                </select>
              </div>
            )}

            {/* Gender */}
            <div>
              <label className="block text-sm text-muted mb-1">Gender</label>
              <select
                value={modelDescription.gender}
                onChange={(e) => setModelDescription(prev => ({ ...prev, gender: e.target.value }))}
                className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non-binary">Non-Binary</option>
              </select>
            </div>

            {/* Ethnicity */}
            <div>
              <label className="block text-sm text-muted mb-1">Ethnicity</label>
              <select
                value={modelDescription.ethnicity}
                onChange={(e) => setModelDescription(prev => ({ ...prev, ethnicity: e.target.value }))}
                className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
              >
                <option value="caucasian">Caucasian</option>
                <option value="african">African</option>
                <option value="asian">Asian</option>
                <option value="hispanic">Hispanic</option>
                <option value="middle-eastern">Middle Eastern</option>
              </select>
            </div>

            {/* Hair Color */}
            <div>
              <label className="block text-sm text-muted mb-1">Hair Color</label>
              <select
                value={modelDescription.hairColor}
                onChange={(e) => setModelDescription(prev => ({ ...prev, hairColor: e.target.value }))}
                className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
              >
                <option value="blonde">Blonde</option>
                <option value="brunette">Brunette</option>
                <option value="black">Black</option>
                <option value="red">Red</option>
                <option value="gray">Gray</option>
                <option value="bald">Bald</option>
              </select>
            </div>

            {/* Eye Color */}
            <div>
              <label className="block text-sm text-muted mb-1">Eye Color</label>
              <select
                value={modelDescription.eyeColor}
                onChange={(e) => setModelDescription(prev => ({ ...prev, eyeColor: e.target.value }))}
                className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
              >
                <option value="blue">Blue</option>
                <option value="brown">Brown</option>
                <option value="green">Green</option>
                <option value="hazel">Hazel</option>
                <option value="gray">Gray</option>
              </select>
            </div>

            {/* Body Type */}
            <div className="col-span-2">
              <label className="block text-sm text-muted mb-1">Body Type</label>
              <select
                value={modelDescription.bodyType}
                onChange={(e) => setModelDescription(prev => ({ ...prev, bodyType: e.target.value }))}
                className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
              >
                <option value="slim">Slim</option>
                <option value="athletic">Athletic</option>
                <option value="average">Average</option>
                <option value="plus-size">Plus Size</option>
              </select>
            </div>

            {/* Additional Details */}
            <div className="col-span-2">
              <label className="block text-sm text-muted mb-1">Additional Details (Optional)</label>
              <textarea
                value={modelDescription.additionalDetails}
                onChange={(e) => setModelDescription(prev => ({ ...prev, additionalDetails: e.target.value }))}
                placeholder="e.g., smiling, outdoor setting, holding coffee"
                rows={2}
                className="w-full px-3 py-2 border border-primary/20 rounded-md bg-bg text-text"
              />
            </div>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-all"
            >
              {isGenerating ? 'Generating...' : `Generate (${GENERATION_COST} ITC)`}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-primary/30 rounded-lg text-text hover:bg-primary/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Current Mockup Review */}
      {currentMockup && currentMockup.status === 'completed' && currentMockup.mockupUrl && (
        <div className="bg-card border border-primary/30 rounded-lg p-4 space-y-3">
          <h4 className="font-semibold text-text">Review Your Mockup</h4>
          <img
            src={currentMockup.mockupUrl}
            alt="Generated mockup"
            className="w-full rounded-lg border border-primary/20"
          />
          <div className="flex space-x-2">
            <button
              onClick={() => handleSelect(currentMockup.generationId)}
              disabled={currentMockup.status === 'selected'}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              ✅ Keep & Download
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              🔄 Generate Another
            </button>
            <button
              onClick={() => handleDiscard(currentMockup.generationId)}
              disabled={currentMockup.status === 'discarded'}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              ❌ Discard & Refund
            </button>
          </div>
        </div>
      )}

      {/* Generating State */}
      {currentMockup && currentMockup.status === 'generating' && (
        <div className="bg-card border border-primary/30 rounded-lg p-4 text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text font-semibold">Generating realistic mockup...</p>
          <p className="text-muted text-sm mt-1">This may take 30-60 seconds</p>
        </div>
      )}

      {/* Session Gallery */}
      {sessionMockups.length > 0 && (
        <div className="bg-card border border-primary/30 rounded-lg p-4">
          <h4 className="font-semibold text-text mb-3">Session History</h4>
          <div className="grid grid-cols-3 gap-2">
            {sessionMockups.map((mockup) => (
              <div
                key={mockup.generationId}
                onClick={() => mockup.mockupUrl && setCurrentMockup(mockup)}
                className={`relative aspect-square rounded-lg border-2 cursor-pointer transition-all ${
                  mockup.status === 'selected'
                    ? 'border-green-500'
                    : mockup.status === 'discarded'
                    ? 'border-red-500 opacity-50'
                    : 'border-primary/30 hover:border-primary'
                }`}
              >
                {mockup.mockupUrl ? (
                  <img src={mockup.mockupUrl} alt="Mockup" className="w-full h-full object-cover rounded-lg" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-bg">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <div className="absolute top-1 right-1 bg-black/70 px-2 py-1 rounded text-xs text-white">
                  {mockup.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default RealisticMockupGenerator

