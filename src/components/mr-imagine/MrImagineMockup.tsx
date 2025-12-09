import React, { useState, useEffect, useRef } from 'react'
import { MR_IMAGINE_CONFIG, getMrImagineMockup } from './config'

export interface MrImagineMockupProps {
  /** The design image URL to overlay on the product */
  designUrl?: string
  /** Product type */
  product?: 'tshirt' | 'hoodie' | 'tank'
  /** Product color */
  color?: 'white' | 'black' | 'gray'
  /** Front or back view */
  side?: 'front' | 'back'
  /** Size of the mockup container */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Additional CSS classes */
  className?: string
  /** Callback when mockup is ready */
  onMockupReady?: (dataUrl: string) => void
}

const sizeClasses = {
  sm: 'w-48 h-48',
  md: 'w-64 h-64',
  lg: 'w-80 h-80',
  xl: 'w-96 h-96',
}

export const MrImagineMockup: React.FC<MrImagineMockupProps> = ({
  designUrl,
  product = 'tshirt',
  color = 'white',
  side = 'front',
  size = 'md',
  className = '',
  onMockupReady,
}) => {
  const [mockupLoaded, setMockupLoaded] = useState(false)
  const [designLoaded, setDesignLoaded] = useState(false)
  const [error, setError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mockupUrl = getMrImagineMockup(product, color, side)

  // Get design zone for the product
  const productMockup = MR_IMAGINE_CONFIG.mockups[product]
  const designZoneConfig = productMockup?.designZone as Record<string, { x: number; y: number; width: number; height: number }> | undefined
  const designZone = designZoneConfig?.[side] || {
    x: 150,
    y: 180,
    width: 200,
    height: 250,
  }

  // Composite the design onto the mockup using canvas
  useEffect(() => {
    if (!canvasRef.current || !mockupLoaded || !designUrl || !designLoaded) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mockupImg = new Image()
    const designImg = new Image()

    mockupImg.crossOrigin = 'anonymous'
    designImg.crossOrigin = 'anonymous'

    let mockupReady = false
    let designReady = false

    const compositeImages = () => {
      if (!mockupReady || !designReady) return

      // Set canvas size to mockup size
      canvas.width = mockupImg.naturalWidth || 500
      canvas.height = mockupImg.naturalHeight || 600

      // Draw mockup first
      ctx.drawImage(mockupImg, 0, 0, canvas.width, canvas.height)

      // Calculate design position (scale design zone to canvas size)
      const scaleX = canvas.width / 500
      const scaleY = canvas.height / 600
      const dx = designZone.x * scaleX
      const dy = designZone.y * scaleY
      const dw = designZone.width * scaleX
      const dh = designZone.height * scaleY

      // Draw design with multiply blend mode for realistic effect
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(designImg, dx, dy, dw, dh)

      // Reset blend mode
      ctx.globalCompositeOperation = 'source-over'

      // Callback with data URL if needed
      if (onMockupReady) {
        try {
          onMockupReady(canvas.toDataURL('image/png'))
        } catch {
          console.warn('Could not export mockup as data URL (CORS restriction)')
        }
      }
    }

    mockupImg.onload = () => {
      mockupReady = true
      compositeImages()
    }

    designImg.onload = () => {
      designReady = true
      compositeImages()
    }

    mockupImg.onerror = () => setError(true)
    designImg.onerror = () => setError(true)

    mockupImg.src = mockupUrl
    designImg.src = designUrl
  }, [mockupLoaded, designLoaded, designUrl, mockupUrl, designZone, onMockupReady])

  return (
    <div className={`relative ${sizeClasses[size]} ${className}`}>
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-2xl" />

      {/* Loading state */}
      {(!mockupLoaded || (designUrl && !designLoaded)) && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted">
          <span className="text-4xl mb-2">👕</span>
          <span className="text-sm">Mockup unavailable</span>
        </div>
      )}

      {/* Canvas for compositing design onto mockup */}
      {designUrl && (
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full object-contain ${
            mockupLoaded && designLoaded ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-300`}
        />
      )}

      {/* Static mockup (when no design) */}
      {!designUrl && (
        <img
          src={mockupUrl}
          alt={`${MR_IMAGINE_CONFIG.name} wearing ${color} ${product}`}
          className={`w-full h-full object-contain ${
            mockupLoaded ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-300`}
          onLoad={() => setMockupLoaded(true)}
          onError={() => setError(true)}
        />
      )}

      {/* Hidden images for loading status */}
      <img
        src={mockupUrl}
        alt=""
        className="hidden"
        onLoad={() => setMockupLoaded(true)}
        onError={() => setError(true)}
      />
      {designUrl && (
        <img
          src={designUrl}
          alt=""
          className="hidden"
          onLoad={() => setDesignLoaded(true)}
          onError={() => setError(true)}
        />
      )}

      {/* Product info badge */}
      <div className="absolute bottom-2 left-2 px-2 py-1 bg-bg/80 backdrop-blur-sm rounded-lg text-xs text-muted">
        {MR_IMAGINE_CONFIG.name} • {product} • {color}
      </div>
    </div>
  )
}

// Utility hook for generating mockups programmatically
export function useMrImagineMockup() {
  const generateMockup = async (
    designUrl: string,
    options: {
      product?: 'tshirt' | 'hoodie' | 'tank'
      color?: 'white' | 'black' | 'gray'
      side?: 'front' | 'back'
    } = {}
  ): Promise<string> => {
    const { product = 'tshirt', color = 'white', side = 'front' } = options
    const mockupUrl = getMrImagineMockup(product, color, side)
    const productMockup = MR_IMAGINE_CONFIG.mockups[product]
    const designZoneConfig = productMockup?.designZone as Record<string, { x: number; y: number; width: number; height: number }> | undefined
    const designZone = designZoneConfig?.[side]

    if (!designZone) {
      throw new Error(`No design zone defined for ${product} ${side}`)
    }

    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }

      const mockupImg = new Image()
      const designImg = new Image()

      mockupImg.crossOrigin = 'anonymous'
      designImg.crossOrigin = 'anonymous'

      let mockupReady = false
      let designReady = false

      const composite = () => {
        if (!mockupReady || !designReady) return

        canvas.width = mockupImg.naturalWidth
        canvas.height = mockupImg.naturalHeight

        ctx.drawImage(mockupImg, 0, 0)

        const scaleX = canvas.width / 500
        const scaleY = canvas.height / 600

        ctx.globalCompositeOperation = 'multiply'
        ctx.drawImage(
          designImg,
          designZone.x * scaleX,
          designZone.y * scaleY,
          designZone.width * scaleX,
          designZone.height * scaleY
        )

        try {
          resolve(canvas.toDataURL('image/png'))
        } catch {
          reject(new Error('Failed to export mockup (CORS)'))
        }
      }

      mockupImg.onload = () => {
        mockupReady = true
        composite()
      }
      designImg.onload = () => {
        designReady = true
        composite()
      }

      mockupImg.onerror = () => reject(new Error('Failed to load mockup'))
      designImg.onerror = () => reject(new Error('Failed to load design'))

      mockupImg.src = mockupUrl
      designImg.src = designUrl
    })
  }

  return { generateMockup }
}
