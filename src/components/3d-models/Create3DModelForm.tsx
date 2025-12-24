import { useState } from 'react'
import { Box, Camera, Hexagon, Smile, Star, Loader2, Coins, AlertCircle } from 'lucide-react'
import type { Model3DStyle, Model3DPricing, Model3DStyleInfo } from '../../types'
import api from '../../lib/api'

interface Create3DModelFormProps {
  itcBalance: number
  onModelCreated: (modelId: string) => void
  onBalanceChange?: (newBalance: number) => void
}

const STYLES: Model3DStyleInfo[] = [
  {
    key: 'realistic',
    name: 'Realistic',
    descriptor: 'Photorealistic, highly detailed sculpture'
  },
  {
    key: 'cartoon',
    name: 'Cartoon',
    descriptor: 'Stylized Pixar-Disney style'
  },
  {
    key: 'low_poly',
    name: 'Low Poly',
    descriptor: 'Geometric, minimalist design'
  },
  {
    key: 'anime',
    name: 'Anime',
    descriptor: 'Japanese animation aesthetic'
  }
]

const STYLE_ICONS: Record<Model3DStyle, React.ComponentType<{ className?: string }>> = {
  realistic: Camera,
  cartoon: Smile,
  low_poly: Hexagon,
  anime: Star
}

export function Create3DModelForm({
  itcBalance,
  onModelCreated,
  onBalanceChange
}: Create3DModelFormProps) {
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<Model3DStyle>('realistic')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pricing, setPricing] = useState<Model3DPricing | null>(null)

  // Load pricing on mount
  useState(() => {
    api.get('/3d-models/pricing')
      .then(res => {
        if (res.data?.costs) {
          setPricing(res.data.costs)
        }
      })
      .catch(err => console.error('Failed to load pricing:', err))
  })

  const conceptCost = pricing?.concept || 20
  const totalCost = pricing?.total || 100
  const hasEnoughBalance = itcBalance >= conceptCost

  const handleSubmit = async () => {
    if (!prompt.trim() || prompt.length < 10) {
      setError('Please describe your figurine in at least 10 characters')
      return
    }

    if (!hasEnoughBalance) {
      setError('Insufficient ITC balance')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await api.post('/3d-models/create', {
        prompt: prompt.trim(),
        style
      })

      if (response.data?.ok && response.data?.model?.id) {
        onModelCreated(response.data.model.id)
        setPrompt('')
        if (onBalanceChange && response.data.costs?.concept) {
          onBalanceChange(itcBalance - response.data.costs.concept)
        }
      } else {
        throw new Error(response.data?.error || 'Failed to create model')
      }
    } catch (err: any) {
      const message = err.response?.data?.error || err.message || 'Failed to create 3D model'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="card-editorial p-6 bg-card border border-border rounded-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
          <Box className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-display font-bold text-text text-xl">
            Create a 3D Figurine
          </h3>
          <p className="text-muted text-sm">
            AI-powered custom figurine generation
          </p>
        </div>
      </div>

      {/* Prompt Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-text mb-2">
          Describe your figurine
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A cute dragon sitting on a treasure chest, wearing a tiny crown..."
          className="w-full p-4 bg-bg border border-border rounded-xl text-text placeholder:text-muted resize-none h-24 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
          disabled={isLoading}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-muted">Min 10 characters</span>
          <span className={`text-xs ${prompt.length < 10 ? 'text-muted' : 'text-green-500'}`}>
            {prompt.length}/500
          </span>
        </div>
      </div>

      {/* Style Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-text mb-2">
          Choose a style
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STYLES.map((s) => {
            const Icon = STYLE_ICONS[s.key]
            const isSelected = style === s.key
            return (
              <button
                key={s.key}
                onClick={() => setStyle(s.key)}
                disabled={isLoading}
                className={`p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                    : 'border-border hover:border-purple-400/50 text-muted hover:text-text'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Icon className="w-5 h-5 mx-auto mb-1" />
                <span className="text-sm font-medium block">{s.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-500" />
            <div>
              <span className="text-amber-400 font-semibold">
                First step: {conceptCost} ITC
              </span>
              <p className="text-xs text-muted">
                Total for complete 3D model: ~{totalCost} ITC
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-muted text-sm">Your balance:</span>
            <p className={`font-bold ${hasEnoughBalance ? 'text-green-400' : 'text-red-400'}`}>
              {itcBalance.toLocaleString()} ITC
            </p>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!prompt.trim() || prompt.length < 10 || isLoading || !hasEnoughBalance}
        className={`w-full py-3 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
          !prompt.trim() || prompt.length < 10 || isLoading || !hasEnoughBalance
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg hover:shadow-purple-500/25'
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Creating...</span>
          </>
        ) : (
          <>
            <Box className="w-5 h-5" />
            <span>Start Creating</span>
          </>
        )}
      </button>

      {/* Info Text */}
      <p className="mt-3 text-center text-xs text-muted">
        Generation takes 1-2 minutes. You'll approve the concept before proceeding.
      </p>
    </div>
  )
}

export default Create3DModelForm
