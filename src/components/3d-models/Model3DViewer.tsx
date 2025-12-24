import { useEffect, useRef, useState } from 'react'
import { Box, Loader2, RotateCw } from 'lucide-react'

interface Model3DViewerProps {
  glbUrl: string
  alt?: string
  className?: string
  autoRotate?: boolean
  showControls?: boolean
}

export function Model3DViewer({
  glbUrl,
  alt = '3D Model',
  className = '',
  autoRotate = true,
  showControls = true
}: Model3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Dynamically load model-viewer if not already loaded
    if (!customElements.get('model-viewer')) {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js'
      document.head.appendChild(script)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current || !glbUrl) return

    // Create model-viewer element imperatively to avoid TypeScript JSX issues
    const existingViewer = containerRef.current.querySelector('model-viewer')
    if (existingViewer) {
      existingViewer.remove()
    }

    const modelViewer = document.createElement('model-viewer')
    modelViewer.setAttribute('src', glbUrl)
    modelViewer.setAttribute('alt', alt)
    if (autoRotate) modelViewer.setAttribute('auto-rotate', '')
    if (showControls) modelViewer.setAttribute('camera-controls', '')
    modelViewer.setAttribute('shadow-intensity', '1')
    modelViewer.setAttribute('exposure', '1')
    modelViewer.setAttribute('environment-image', 'neutral')
    modelViewer.setAttribute('loading', 'eager')
    modelViewer.setAttribute('reveal', 'auto')
    modelViewer.style.width = '100%'
    modelViewer.style.height = '100%'
    modelViewer.style.minHeight = '300px'

    // Listen for load event
    modelViewer.addEventListener('load', () => setIsLoading(false))
    modelViewer.addEventListener('error', () => setIsLoading(false))

    containerRef.current.appendChild(modelViewer)

    return () => {
      modelViewer.remove()
    }
  }, [glbUrl, alt, autoRotate, showControls])

  if (!glbUrl) {
    return (
      <div className={`flex items-center justify-center bg-bg rounded-xl ${className}`}>
        <div className="text-center text-muted">
          <Box className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No 3D model available</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative bg-gradient-to-b from-gray-800 to-gray-900 rounded-xl overflow-hidden ${className}`}>
      <div ref={containerRef} className="w-full h-full min-h-[300px]" />

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-2" />
            <p className="text-muted text-sm">Loading 3D model...</p>
          </div>
        </div>
      )}

      {/* Rotation Hint */}
      {showControls && !isLoading && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-white/70 text-xs">
          <RotateCw className="w-3 h-3" />
          <span>Drag to rotate</span>
        </div>
      )}
    </div>
  )
}

/**
 * Fallback viewer using a simple image carousel of angle views
 * Used when model-viewer is not available
 */
export function Model3DFallbackViewer({
  conceptUrl,
  angleImages,
  className = ''
}: {
  conceptUrl?: string | null
  angleImages?: Record<string, string>
  className?: string
}) {
  const images = [
    conceptUrl,
    angleImages?.front,
    angleImages?.back,
    angleImages?.left,
    angleImages?.right
  ].filter(Boolean) as string[]

  const [currentIndex, setCurrentIndex] = useState(0)

  if (images.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-bg rounded-xl ${className}`}>
        <div className="text-center text-muted">
          <Box className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No images available</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative bg-bg rounded-xl overflow-hidden ${className}`}>
      <img
        src={images[currentIndex]}
        alt={`View ${currentIndex + 1}`}
        className="w-full h-full object-contain"
      />

      {/* Navigation Dots */}
      {images.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentIndex
                  ? 'bg-purple-500 w-4'
                  : 'bg-white/50 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default Model3DViewer
