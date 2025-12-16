import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

interface ProductPreviewCarouselProps {
  designImageUrl: string
  designName?: string
  onWalletUpdate?: (newBalance: number) => void
}

interface ProductMockup {
  id: string
  name: string
  icon: string
  mockupType: string
  loading: boolean
  mockupUrl: string | null
  error: string | null
  locked: boolean  // NEW: Premium mockups are locked
  cost: number     // NEW: ITC cost (0 for free, 25 for premium)
}

// Cost for additional mockups
const MOCKUP_COST_ITC = 25

// Products we actually sell - first one is FREE, rest require ITC
const PRODUCTS: Omit<ProductMockup, 'loading' | 'mockupUrl' | 'error' | 'locked'>[] = [
  {
    id: 'tshirt-black',
    name: 'Black T-Shirt',
    icon: '👕',
    mockupType: 'ghost-mannequin',
    cost: 0,  // FREE - included with design generation
  },
  {
    id: 'hoodie-black',
    name: 'Black Hoodie',
    icon: '🧥',
    mockupType: 'ghost-mannequin',
    cost: MOCKUP_COST_ITC,
  },
  {
    id: 'tumbler',
    name: 'Tumbler',
    icon: '🥤',
    mockupType: 'product',
    cost: MOCKUP_COST_ITC,
  },
  {
    id: 'metal-print-4x6',
    name: 'Metal Print 4x6',
    icon: '🖼️',
    mockupType: 'flat-lay',
    cost: MOCKUP_COST_ITC,
  },
  {
    id: 'metal-print-8x10',
    name: 'Metal Print 8x10',
    icon: '🖼️',
    mockupType: 'flat-lay',
    cost: MOCKUP_COST_ITC,
  },
]

export const ProductPreviewCarousel = ({ designImageUrl, designName, onWalletUpdate }: ProductPreviewCarouselProps) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const [mockups, setMockups] = useState<ProductMockup[]>(
    PRODUCTS.map((p, index) => ({
      ...p,
      loading: index === 0, // Only first one loads automatically
      mockupUrl: null,
      error: null,
      locked: index !== 0,  // First one is FREE, rest are locked
    }))
  )
  const [wallet, setWallet] = useState({ itc_balance: 0 })
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [pendingUnlockIndex, setPendingUnlockIndex] = useState<number | null>(null)
  const [unlocking, setUnlocking] = useState(false)

  // Fetch wallet balance on mount
  useEffect(() => {
    const fetchWallet = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      const { data } = await supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', session.user.id)
        .single()

      if (data) {
        setWallet({ itc_balance: Number(data.itc_balance) || 0 })
      }
    }
    fetchWallet()
  }, [])

  // Generate a single mockup
  const generateMockup = useCallback(async (productIndex: number): Promise<ProductMockup | null> => {
    const product = PRODUCTS[productIndex]
    if (!product) return null

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      console.error('[ProductPreviewCarousel] No auth token')
      return null
    }

    try {
      console.log(`[ProductPreviewCarousel] Generating mockup for ${product.name}...`)

      const { data } = await axios.post('/api/mockups/itp-enhance', {
        design_url: designImageUrl,
        product_type: product.id,
        mockup_type: product.mockupType,
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      console.log(`[ProductPreviewCarousel] ✅ Mockup ready for ${product.name}:`, data.mockup_url?.substring(0, 50))

      return {
        ...product,
        loading: false,
        mockupUrl: data.mockup_url,
        error: null,
        locked: false,
      }
    } catch (err: any) {
      console.error(`[ProductPreviewCarousel] ❌ Error generating mockup for ${product.name}:`, err.message)
      return {
        ...product,
        loading: false,
        mockupUrl: null,
        error: err.message || 'Failed to generate mockup',
        locked: product.cost > 0, // Keep locked if it's a premium product that failed
      }
    }
  }, [designImageUrl])

  // Generate FREE t-shirt mockup automatically when design URL changes
  useEffect(() => {
    if (!designImageUrl) return

    const generateFreeMockup = async () => {
      // Set first mockup to loading
      setMockups(prev => prev.map((m, i) => i === 0 ? { ...m, loading: true } : m))

      const result = await generateMockup(0)
      if (result) {
        setMockups(prev => prev.map((m, i) => i === 0 ? result : m))
      }
    }

    generateFreeMockup()
  }, [designImageUrl, generateMockup])

  // Handle unlocking a premium mockup
  const handleUnlockMockup = async (index: number) => {
    const product = mockups[index]
    if (!product.locked || product.cost === 0) return

    // Check if user has enough credits
    if (wallet.itc_balance < product.cost) {
      setPendingUnlockIndex(index)
      setShowUnlockModal(true)
      return
    }

    // Deduct credits and generate mockup
    setUnlocking(true)
    setMockups(prev => prev.map((m, i) => i === index ? { ...m, loading: true, locked: false } : m))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) throw new Error('Not authenticated')

      // Deduct ITC via API
      await axios.post('/api/wallet/deduct-itc', {
        amount: product.cost,
        reason: `Mockup generation: ${product.name}`
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Update local wallet
      const newBalance = wallet.itc_balance - product.cost
      setWallet({ itc_balance: newBalance })
      onWalletUpdate?.(newBalance)

      // Generate the mockup
      const result = await generateMockup(index)
      if (result) {
        setMockups(prev => prev.map((m, i) => i === index ? result : m))
        setActiveIndex(index) // Switch to the newly generated mockup
      }
    } catch (err: any) {
      console.error('[ProductPreviewCarousel] Error unlocking mockup:', err)
      setMockups(prev => prev.map((m, i) => i === index ? { ...m, loading: false, locked: true, error: err.message } : m))
    } finally {
      setUnlocking(false)
    }
  }

  // Handle thumbnail click - either show mockup or unlock prompt
  const handleThumbnailClick = (index: number) => {
    const product = mockups[index]
    if (product.locked && product.cost > 0) {
      handleUnlockMockup(index)
    } else {
      setActiveIndex(index)
    }
  }

  const activeProduct = mockups[activeIndex]

  return (
    <div className="w-full">
      {/* Header with wallet */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Preview on Products</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-purple-300/70">{activeIndex + 1} / {mockups.length}</span>
          <span className="text-xs text-amber-400/80 bg-amber-500/10 px-2 py-1 rounded-full">
            💰 {wallet.itc_balance} ITC
          </span>
        </div>
      </div>

      {/* Main preview */}
      <div className="relative mb-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden aspect-square max-h-[400px]">
        {activeProduct.loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-400 rounded-full animate-spin mb-4" />
            <p className="text-purple-200/70 text-sm">
              {unlocking ? 'Unlocking' : 'Generating'} {activeProduct.name} mockup...
            </p>
          </div>
        ) : activeProduct.mockupUrl ? (
          <img
            src={activeProduct.mockupUrl}
            alt={`${designName || 'Design'} on ${activeProduct.name}`}
            className="w-full h-full object-contain"
          />
        ) : activeProduct.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
            <span className="text-4xl mb-2">😕</span>
            <p className="text-purple-200/70 text-sm text-center">Couldn't generate mockup</p>
            <div className="mt-4 w-32 h-32 rounded-lg overflow-hidden shadow-lg border border-white/10">
              <img src={designImageUrl} alt={designName || 'Design'} className="w-full h-full object-cover" />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={designImageUrl} alt={designName || 'Design'} className="max-w-[80%] max-h-[80%] object-contain rounded-lg shadow-lg" />
          </div>
        )}

        {/* Product label overlay */}
        <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
          <span className="text-lg mr-2">{activeProduct.icon}</span>
          <span className="font-medium text-white">{activeProduct.name}</span>
          {activeProduct.cost === 0 && (
            <span className="ml-2 text-xs text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">FREE</span>
          )}
        </div>
      </div>

      {/* Thumbnail selector */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {mockups.map((mockup, index) => (
          <button
            key={mockup.id}
            onClick={() => handleThumbnailClick(index)}
            className={`relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden transition-all duration-200 border ${
              activeIndex === index
                ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-transparent scale-105 border-purple-400/50'
                : mockup.locked
                ? 'opacity-70 hover:opacity-100 border-amber-500/30 hover:border-amber-400/50'
                : 'opacity-60 hover:opacity-100 border-white/10'
            }`}
          >
            {mockup.loading ? (
              <div className="w-full h-full bg-white/5 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
              </div>
            ) : mockup.mockupUrl ? (
              <img
                src={mockup.mockupUrl}
                alt={mockup.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-white/5 flex items-center justify-center text-2xl">
                {mockup.icon}
              </div>
            )}

            {/* Lock overlay for premium mockups */}
            {mockup.locked && mockup.cost > 0 && (
              <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex flex-col items-center justify-center">
                <span className="text-lg">🔒</span>
                <span className="text-[10px] text-amber-300 font-medium mt-0.5">{mockup.cost} ITC</span>
              </div>
            )}

            {/* FREE badge for first product */}
            {index === 0 && (
              <div className="absolute top-1 right-1 bg-emerald-500 text-white text-[8px] font-bold px-1 rounded">
                FREE
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Product name labels */}
      <div className="flex gap-3 mt-2">
        {mockups.map((mockup, index) => (
          <span
            key={mockup.id}
            className={`flex-shrink-0 w-20 text-xs text-center truncate ${
              activeIndex === index ? 'text-purple-300 font-medium' : 'text-white/50'
            }`}
          >
            {mockup.name.split(' ')[0]}
          </span>
        ))}
      </div>

      {/* Quick action */}
      {activeProduct.mockupUrl && (
        <div className="mt-6 text-center">
          <p className="text-sm text-purple-200/70 mb-2">
            Love how it looks on {activeProduct.name.toLowerCase()}?
          </p>
          <button className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-full shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all hover:scale-105">
            Add {activeProduct.name} to Cart
          </button>
        </div>
      )}

      {/* Unlock modal - insufficient credits */}
      {showUnlockModal && pendingUnlockIndex !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1235] border border-white/10 rounded-3xl shadow-2xl max-w-md w-full p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center">
              <span className="text-3xl">🔒</span>
            </div>
            <h3 className="font-display text-xl text-white mb-2">Unlock {mockups[pendingUnlockIndex].name} Mockup</h3>
            <p className="text-purple-100/80 mb-4">
              See your design on {mockups[pendingUnlockIndex].name.toLowerCase()} for just{' '}
              <span className="font-bold text-amber-400">{mockups[pendingUnlockIndex].cost} ITC</span>
            </p>
            <p className="text-purple-200/50 text-sm mb-6">
              You have <span className="font-bold text-amber-300">{wallet.itc_balance} ITC</span>
              {wallet.itc_balance < mockups[pendingUnlockIndex].cost && (
                <span className="text-red-400"> (need {mockups[pendingUnlockIndex].cost - wallet.itc_balance} more)</span>
              )}
            </p>
            <div className="flex flex-col gap-3">
              {wallet.itc_balance >= mockups[pendingUnlockIndex].cost ? (
                <button
                  onClick={() => {
                    setShowUnlockModal(false)
                    handleUnlockMockup(pendingUnlockIndex)
                  }}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-amber-500/30 transition-all"
                >
                  Unlock for {mockups[pendingUnlockIndex].cost} ITC
                </button>
              ) : (
                <Link
                  to="/wallet"
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all text-center"
                >
                  Get More ITC
                </Link>
              )}
              <button
                onClick={() => {
                  setShowUnlockModal(false)
                  setPendingUnlockIndex(null)
                }}
                className="w-full py-3 border border-white/10 text-purple-200/70 font-medium rounded-xl hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductPreviewCarousel
