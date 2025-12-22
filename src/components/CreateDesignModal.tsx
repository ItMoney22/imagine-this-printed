import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Coins, Wand2, ArrowRight, RefreshCw, Save } from 'lucide-react'
import { VoiceConversationEnhanced } from './VoiceConversationEnhanced'
import { supabase } from '../lib/supabase'

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

const ITC_COST = 10

export function CreateDesignModal({
  isOpen,
  onClose,
  itcBalance,
  onDesignCreated,
  onBalanceChange
}: CreateDesignModalProps) {
  const navigate = useNavigate()
  const [generatedDesigns, setGeneratedDesigns] = useState<GeneratedDesign[]>([])
  const [selectedDesignIndex, setSelectedDesignIndex] = useState<number | null>(null)
  const [designConcept, setDesignConcept] = useState<string | null>(null)
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [currentBalance, setCurrentBalance] = useState(itcBalance)
  const [error, setError] = useState<string | null>(null)

  // Sync with prop changes
  useEffect(() => {
    setCurrentBalance(itcBalance)
  }, [itcBalance])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setGeneratedDesigns([])
      setSelectedDesignIndex(null)
      setDesignConcept(null)
      setHasGeneratedOnce(false)
      setError(null)
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

  const handleDesignsGenerated = async (designs: GeneratedDesign[]) => {
    setGeneratedDesigns(designs)
    setHasGeneratedOnce(true)

    // Deduct ITC on first generation
    if (!hasGeneratedOnce) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        // Call API to deduct ITC
        const response = await fetch('/api/wallet/deduct', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            amount: ITC_COST,
            description: 'Voice design generation'
          })
        })

        if (response.ok) {
          const data = await response.json()
          setCurrentBalance(data.newBalance)
          onBalanceChange?.(data.newBalance)
        }
      } catch (err) {
        console.error('Failed to deduct ITC:', err)
      }
    }
  }

  const handleDesignSelected = (index: number) => {
    setSelectedDesignIndex(index)
  }

  const handleSaveAsDraft = async () => {
    if (selectedDesignIndex === null || !generatedDesigns[selectedDesignIndex]?.imageUrl) return

    setIsSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Please sign in to save your design')
        return
      }

      const selectedDesign = generatedDesigns[selectedDesignIndex]

      // Save as a draft design
      const response = await fetch('/api/imagination-station/sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          name: designConcept || 'Voice Design',
          status: 'draft',
          preview_url: selectedDesign.imageUrl,
          design_concept: designConcept
        })
      })

      if (response.ok) {
        const data = await response.json()
        onDesignCreated?.(data.id, selectedDesign.imageUrl!)
        onClose()
      } else {
        setError('Failed to save design. Please try again.')
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

    // Navigate to Imagination Station with the design
    navigate('/imagination-station', {
      state: {
        preloadImage: selectedDesign.imageUrl,
        designConcept: designConcept
      }
    })
    onClose()
  }

  const handleRegenerate = () => {
    setGeneratedDesigns([])
    setSelectedDesignIndex(null)
    // The VoiceConversationEnhanced will handle the regeneration
  }

  if (!isOpen) return null

  const insufficientBalance = currentBalance < ITC_COST
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
      <div className="relative w-full max-w-4xl max-h-[90vh] mx-4 bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Create Your Design</h2>
              <p className="text-sm text-purple-300/70">Talk with Mr. Imagine to bring your vision to life</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="w-6 h-6 text-white/70" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {insufficientBalance ? (
            // Insufficient balance state
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mb-6">
                <Coins className="w-10 h-10 text-amber-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Insufficient ITC Balance</h3>
              <p className="text-purple-300/70 mb-2">
                Voice design generation costs <span className="font-semibold text-amber-400">{ITC_COST} ITC</span>
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
          ) : (
            // Voice conversation interface
            <div className="flex flex-col items-center">
              <VoiceConversationEnhanced
                onTextInput={(text) => setDesignConcept(text)}
                onDesignsGenerated={handleDesignsGenerated}
                onDesignSelected={handleDesignSelected}
                conversationalMode={true}
                showVideoBeforeConversation={true}
                className="w-full"
              />

              {/* Error display */}
              {error && (
                <div className="mt-4 w-full max-w-md bg-red-500/20 border border-red-500/30 rounded-xl p-4 text-center">
                  <p className="text-red-300">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/20">
          <div className="flex items-center justify-between">
            {/* ITC Balance Display */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-purple-300/70">
                <span className="font-semibold text-amber-400">{ITC_COST} ITC</span> per design
              </span>
              <span className="text-purple-300/40 mx-2">•</span>
              <span className="text-sm text-purple-300/70">
                Balance: <span className="font-semibold text-white">{currentBalance} ITC</span>
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {hasGeneratedOnce && (
                <button
                  onClick={handleRegenerate}
                  className="flex items-center gap-2 px-4 py-2.5 border border-white/20 text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate
                </button>
              )}

              {canProceed && (
                <>
                  <button
                    onClick={handleSaveAsDraft}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2.5 border border-purple-400/30 text-purple-300 rounded-xl hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Save as Draft'}
                  </button>

                  <button
                    onClick={handleEditInImaginationStation}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all"
                  >
                    Edit in Imagination Station
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
