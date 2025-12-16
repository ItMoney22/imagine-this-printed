import React, { useEffect, useRef, useState } from 'react'
import { PRODUCT_TEMPLATES, printAreaToPixels, type ProductTemplateType } from '../utils/product-templates'

interface DesignElement {
  id: string
  type: 'image' | 'text'
  x: number
  y: number
  width?: number
  height?: number
  rotation: number
  // Image-specific
  src?: string
  // Text-specific
  text?: string
  fontSize?: number
  fontFamily?: string
  fill?: string
}

interface MockupPreviewProps {
  /** Array of design elements from the Konva canvas */
  designElements: DesignElement[]
  /** Selected product template type */
  selectedTemplate: ProductTemplateType
  /** URL of the mockup base image (placeholder if none) */
  mockupImage?: string
  /** Callback when realistic preview is requested */
  onGenerateRealistic?: () => void
  /** Whether realistic preview generation is in progress */
  isGenerating?: boolean
  /** Current ITC balance for displaying cost */
  itcBalance?: number
}

interface RealisticMockupDisplayProps {
  mockupUrl: string
  onDownload: () => void
}

const REALISTIC_PREVIEW_COST = 25 // ITC tokens

/**
 * RealisticMockupDisplay Component
 * Displays a realistic mockup image with download option
 */
const RealisticMockupDisplay: React.FC<RealisticMockupDisplayProps> = ({ mockupUrl, onDownload }) => {
  return (
    <div className="relative">
      <img
        src={mockupUrl}
        alt="Realistic Mockup"
        className="w-full h-auto rounded-lg shadow-lg border-2 border-primary/30"
      />
      <div className="absolute top-3 right-3 flex gap-2">
        <div className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-lg flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Realistic Preview
        </div>
        <button
          onClick={onDownload}
          className="bg-primary hover:bg-primary/90 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-lg transition-all flex items-center gap-1"
          title="Download mockup"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </button>
      </div>
    </div>
  )
}

/**
 * MockupPreview Component
 *
 * Displays a real-time preview of the design composited onto a product mockup.
 * Uses HTML Canvas to render design elements within the print area boundaries.
 * Provides button to generate a realistic preview via ITP Enhance Engine API.
 */
const MockupPreview: React.FC<MockupPreviewProps> = ({
  designElements,
  selectedTemplate,
  mockupImage,
  onGenerateRealistic,
  isGenerating = false,
  itcBalance = 0
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isLoadingMockup, setIsLoadingMockup] = useState(false)
  const [mockupLoadError, setMockupLoadError] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 700 })

  // Get template configuration
  const template = PRODUCT_TEMPLATES[selectedTemplate]

  // Check if mockupImage is a realistic mockup (from designer-mockups folder)
  const isRealisticMockup = mockupImage && mockupImage.includes('designer-mockups')

  /**
   * Download the realistic mockup
   */
  const handleDownloadMockup = () => {
    if (mockupImage) {
      const link = document.createElement('a')
      link.href = mockupImage
      link.download = `realistic-mockup-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  /**
   * Load and cache images for rendering
   */
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous' // Handle CORS
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
      img.src = src
    })
  }

  /**
   * Draw the composite preview on canvas
   */
  const drawPreview = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw mockup background (placeholder or actual mockup)
    if (mockupImage) {
      try {
        setIsLoadingMockup(true)
        setMockupLoadError(null)
        const mockupImg = await loadImage(mockupImage)
        ctx.drawImage(mockupImg, 0, 0, canvas.width, canvas.height)
        setIsLoadingMockup(false)
      } catch (error) {
        console.error('Failed to load mockup:', error)
        setMockupLoadError('Failed to load mockup image')
        setIsLoadingMockup(false)
        // Draw fallback background
        drawFallbackBackground(ctx, canvas.width, canvas.height)
      }
    } else {
      // Draw fallback background with template indication
      drawFallbackBackground(ctx, canvas.width, canvas.height)
    }

    // Calculate print area in pixels
    const printArea = printAreaToPixels(
      template.printArea,
      canvas.width,
      canvas.height
    )

    // Draw print area boundaries (semi-transparent overlay)
    ctx.save()
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(printArea.x, printArea.y, printArea.width, printArea.height)
    ctx.restore()

    // Draw design elements within print area
    for (const element of designElements) {
      ctx.save()

      // Calculate element position relative to print area
      // Elements from Konva are in their own coordinate space (800x600 typically)
      // We need to map them to the print area
      const scaleX = printArea.width / 800 // Assuming Konva canvas is 800px wide
      const scaleY = printArea.height / 600 // Assuming Konva canvas is 600px tall

      const mappedX = printArea.x + element.x * scaleX
      const mappedY = printArea.y + element.y * scaleY

      // Apply rotation if any
      if (element.rotation) {
        ctx.translate(mappedX, mappedY)
        ctx.rotate((element.rotation * Math.PI) / 180)
        ctx.translate(-mappedX, -mappedY)
      }

      if (element.type === 'image' && element.src) {
        try {
          const img = await loadImage(element.src)
          const mappedWidth = (element.width || img.width) * scaleX
          const mappedHeight = (element.height || img.height) * scaleY
          ctx.drawImage(img, mappedX, mappedY, mappedWidth, mappedHeight)
        } catch (error) {
          console.error('Failed to load design image:', error)
          // Draw placeholder rectangle
          ctx.fillStyle = '#e5e7eb'
          ctx.fillRect(
            mappedX,
            mappedY,
            (element.width || 100) * scaleX,
            (element.height || 100) * scaleY
          )
        }
      } else if (element.type === 'text' && element.text) {
        const mappedFontSize = (element.fontSize || 24) * scaleY
        ctx.font = `${mappedFontSize}px ${element.fontFamily || 'Arial'}`
        ctx.fillStyle = element.fill || '#000000'
        ctx.fillText(element.text, mappedX, mappedY)
      }

      ctx.restore()
    }

    // Add watermark for preview
    ctx.save()
    ctx.font = '12px Arial'
    ctx.fillStyle = 'rgba(139, 92, 246, 0.3)'
    ctx.fillText('Preview Only', 10, canvas.height - 10)
    ctx.restore()
  }

  /**
   * Draw fallback background when no mockup image is provided
   */
  const drawFallbackBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#f3f4f6')
    gradient.addColorStop(1, '#e5e7eb')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Template label
    ctx.save()
    ctx.font = '20px Arial'
    ctx.fillStyle = '#9ca3af'
    ctx.textAlign = 'center'
    ctx.fillText(
      `${template.name} Mockup`,
      width / 2,
      height / 2
    )
    ctx.font = '14px Arial'
    ctx.fillText(
      'Upload mockup in Admin Panel',
      width / 2,
      height / 2 + 30
    )
    ctx.restore()
  }

  /**
   * Redraw canvas when design elements or template changes
   */
  useEffect(() => {
    drawPreview()
  }, [designElements, selectedTemplate, mockupImage, canvasSize])

  /**
   * Handle window resize for responsive canvas
   */
  useEffect(() => {
    const handleResize = () => {
      const container = canvasRef.current?.parentElement
      if (container) {
        const containerWidth = container.clientWidth
        const aspectRatio = 7 / 6 // Maintain aspect ratio
        setCanvasSize({
          width: Math.min(containerWidth, 600),
          height: Math.min(containerWidth * aspectRatio, 700)
        })
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const canAffordRealistic = itcBalance >= REALISTIC_PREVIEW_COST

  return (
    <div className="flex flex-col h-full bg-card border border-primary/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-primary/20">
        <h3 className="text-lg font-semibold text-text">Mockup Preview</h3>
        <span className="text-sm text-muted">
          {template.name}
        </span>
      </div>

      {/* Canvas Container */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <div className="relative w-full max-w-2xl">
          {isLoadingMockup && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg/50 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted">Loading mockup...</span>
              </div>
            </div>
          )}

          {mockupLoadError && (
            <div className="absolute top-4 left-4 right-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 z-10">
              <p className="text-sm text-red-400">{mockupLoadError}</p>
            </div>
          )}

          {isRealisticMockup ? (
            <RealisticMockupDisplay
              mockupUrl={mockupImage!}
              onDownload={handleDownloadMockup}
            />
          ) : (
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              className="w-full h-auto rounded-lg shadow-lg border-2 border-primary/30"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          )}
        </div>
      </div>

      {/* Footer with Generate Button */}
      <div className="p-4 border-t border-primary/20 bg-card/50">
        <div className="flex flex-col gap-3">
          {/* Info Text */}
          <div className="text-sm text-muted">
            <p>
              {isRealisticMockup
                ? 'Realistic mockup generated! You can regenerate with updated design or download above.'
                : 'This is a quick preview. Generate a realistic mockup for a professional view.'}
            </p>
          </div>

          {/* Generate Button */}
          <button
            onClick={onGenerateRealistic}
            disabled={isGenerating || !canAffordRealistic || !onGenerateRealistic}
            className={`
              w-full px-6 py-3 rounded-lg font-semibold transition-all duration-200
              flex items-center justify-center gap-2
              ${
                isGenerating
                  ? 'bg-primary/50 cursor-wait'
                  : !canAffordRealistic
                  ? 'bg-gray-600 cursor-not-allowed opacity-50'
                  : 'bg-primary hover:bg-primary/90 hover:shadow-glow'
              }
              text-white
            `}
            title={
              !canAffordRealistic
                ? `Insufficient ITC balance. Need ${REALISTIC_PREVIEW_COST} ITC.`
                : undefined
            }
          >
            {isGenerating ? (
              <>
                <div className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin" />
                <span>Generating Realistic Mockup...</span>
                <span className="text-xs opacity-75">(10-20s)</span>
              </>
            ) : (
              <>
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <span>{isRealisticMockup ? 'Regenerate' : 'Generate'} Realistic Preview</span>
                <span className="text-xs opacity-75">({REALISTIC_PREVIEW_COST} ITC)</span>
              </>
            )}
          </button>

          {/* Balance Display */}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Your ITC Balance:</span>
            <span
              className={`font-semibold ${
                canAffordRealistic ? 'text-primary' : 'text-red-400'
              }`}
            >
              {itcBalance} ITC
            </span>
          </div>

          {/* Warning if insufficient balance */}
          {!canAffordRealistic && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
              Insufficient ITC balance to generate realistic preview. You need at least{' '}
              {REALISTIC_PREVIEW_COST} ITC.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default MockupPreview

