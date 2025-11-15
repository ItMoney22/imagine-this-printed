/**
 * Usage Examples for Mockup Generator
 *
 * This file demonstrates how to use the mockup-generator utility
 * for creating real-time product mockups in the browser.
 */

import {
  generateMockupPreview,
  createDebouncedMockupGenerator,
  canvasToDataURL,
  canvasToBlob,
  validateDesignElements,
  calculateCanvasDimensions,
  generateMockupBatch,
  createMockupThumbnail,
  cleanupCanvas
} from './mockup-generator'
import type { DesignElement, MockupGeneratorOptions } from './mockup-generator'

// Example 1: Basic mockup generation
async function basicExample() {
  const designElements: DesignElement[] = [
    {
      id: 'text-1',
      type: 'text',
      x: 200,
      y: 150,
      text: 'Custom Text',
      fontSize: 32,
      fontFamily: 'Arial',
      fill: '#000000'
    },
    {
      id: 'logo-1',
      type: 'image',
      x: 300,
      y: 300,
      width: 150,
      height: 150,
      src: 'https://example.com/logo.png'
    }
  ]

  const options: MockupGeneratorOptions = {
    mockupImageUrl: 'https://example.com/shirt-mockup.png',
    designElements,
    productTemplate: 'shirts',
    canvasWidth: 800,
    canvasHeight: 600,
    showPrintArea: false
  }

  const canvas = await generateMockupPreview(options)

  // Append to DOM
  document.body.appendChild(canvas)

  // Or convert to data URL
  const dataUrl = canvasToDataURL(canvas)
  console.log('Mockup data URL:', dataUrl)
}

// Example 2: Debounced mockup generation for real-time preview
function debouncedExample() {
  const debouncedGenerator = createDebouncedMockupGenerator(200) // 200ms delay

  // Call multiple times rapidly - only last call will execute
  window.addEventListener('input', async (e) => {
    const options: MockupGeneratorOptions = {
      mockupImageUrl: 'https://example.com/shirt-mockup.png',
      designElements: [
        {
          id: 'text-1',
          type: 'text',
          x: 200,
          y: 150,
          text: (e.target as HTMLInputElement).value,
          fontSize: 32
        }
      ],
      productTemplate: 'shirts'
    }

    const canvas = await debouncedGenerator(options)
    console.log('Preview updated')
  })
}

// Example 3: Validation before rendering
async function validationExample() {
  const designElements: DesignElement[] = [
    {
      id: 'text-1',
      type: 'text',
      x: 200,
      y: 150,
      text: 'Valid Text'
    },
    {
      id: 'invalid-image',
      type: 'image',
      x: 100,
      y: 100
      // Missing 'src' property
    }
  ]

  const validation = validateDesignElements(designElements)

  if (!validation.valid) {
    console.error('Validation errors:', validation.errors)
    return
  }

  // Proceed with generation...
}

// Example 4: Batch generation for multiple views
async function batchExample() {
  const designElements: DesignElement[] = [
    {
      id: 'text-1',
      type: 'text',
      x: 200,
      y: 150,
      text: 'Same Design'
    }
  ]

  const optionsList: MockupGeneratorOptions[] = [
    {
      mockupImageUrl: 'https://example.com/shirt-front.png',
      designElements,
      productTemplate: 'shirts'
    },
    {
      mockupImageUrl: 'https://example.com/shirt-back.png',
      designElements,
      productTemplate: 'shirts'
    },
    {
      mockupImageUrl: 'https://example.com/hoodie-front.png',
      designElements,
      productTemplate: 'hoodies'
    }
  ]

  const canvases = await generateMockupBatch(optionsList)
  console.log(`Generated ${canvases.length} mockups`)
}

// Example 5: Create thumbnail for product card
async function thumbnailExample() {
  const options: MockupGeneratorOptions = {
    mockupImageUrl: 'https://example.com/shirt-mockup.png',
    designElements: [
      {
        id: 'text-1',
        type: 'text',
        x: 200,
        y: 150,
        text: 'Product'
      }
    ],
    productTemplate: 'shirts'
  }

  const fullCanvas = await generateMockupPreview(options)
  const thumbnailCanvas = await createMockupThumbnail(fullCanvas, 200, 200)

  // Use thumbnail for product card
  document.querySelector('.product-card')?.appendChild(thumbnailCanvas)
}

// Example 6: Export as blob for upload
async function exportExample() {
  const options: MockupGeneratorOptions = {
    mockupImageUrl: 'https://example.com/shirt-mockup.png',
    designElements: [
      {
        id: 'text-1',
        type: 'text',
        x: 200,
        y: 150,
        text: 'Upload This'
      }
    ],
    productTemplate: 'shirts'
  }

  const canvas = await generateMockupPreview(options)
  const blob = await canvasToBlob(canvas, 'image/png')

  // Upload to server
  const formData = new FormData()
  formData.append('mockup', blob, 'mockup.png')

  await fetch('/api/upload', {
    method: 'POST',
    body: formData
  })
}

// Example 7: Calculate responsive canvas dimensions
function responsiveDimensionsExample() {
  const containerWidth = window.innerWidth * 0.8
  const containerHeight = window.innerHeight * 0.6

  const dimensions = calculateCanvasDimensions(
    containerWidth,
    containerHeight,
    4 / 3 // aspect ratio
  )

  console.log('Canvas dimensions:', dimensions)
  // Use these dimensions in MockupGeneratorOptions
}

// Example 8: Memory cleanup after rendering
async function cleanupExample() {
  const options: MockupGeneratorOptions = {
    mockupImageUrl: 'https://example.com/shirt-mockup.png',
    designElements: [
      {
        id: 'text-1',
        type: 'text',
        x: 200,
        y: 150,
        text: 'Temporary'
      }
    ],
    productTemplate: 'shirts'
  }

  const canvas = await generateMockupPreview(options)

  // Use canvas...
  const dataUrl = canvasToDataURL(canvas)

  // Clean up when done
  cleanupCanvas(canvas)
  canvas.remove()
}

// Example 9: React component integration
function ReactComponentExample() {
  // In a React component:
  /*
  import { useEffect, useRef, useState } from 'react'
  import { generateMockupPreview } from '../utils/mockup-generator'

  function MockupPreview({ designElements }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
      let mounted = true

      async function updatePreview() {
        setLoading(true)
        try {
          const canvas = await generateMockupPreview({
            mockupImageUrl: '/mockups/shirt.png',
            designElements,
            productTemplate: 'shirts',
            canvasWidth: 800,
            canvasHeight: 600
          })

          if (mounted && canvasRef.current) {
            // Replace canvas content
            const ctx = canvasRef.current.getContext('2d')
            if (ctx) {
              canvasRef.current.width = canvas.width
              canvasRef.current.height = canvas.height
              ctx.drawImage(canvas, 0, 0)
            }
          }
        } catch (error) {
          console.error('Failed to generate mockup:', error)
        } finally {
          if (mounted) {
            setLoading(false)
          }
        }
      }

      updatePreview()

      return () => {
        mounted = false
      }
    }, [designElements])

    return (
      <div>
        {loading && <div>Generating preview...</div>}
        <canvas ref={canvasRef} />
      </div>
    )
  }
  */
}

// Example 10: Handle CORS errors
async function corsHandlingExample() {
  try {
    const options: MockupGeneratorOptions = {
      mockupImageUrl: 'https://cors-enabled-cdn.com/shirt-mockup.png',
      designElements: [
        {
          id: 'text-1',
          type: 'text',
          x: 200,
          y: 150,
          text: 'Test'
        }
      ],
      productTemplate: 'shirts'
    }

    const canvas = await generateMockupPreview(options)
    console.log('Success!')
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to load image')) {
      console.error('CORS error or image not found:', error.message)
      // Fallback to placeholder or show error message
    }
  }
}

export {
  basicExample,
  debouncedExample,
  validationExample,
  batchExample,
  thumbnailExample,
  exportExample,
  responsiveDimensionsExample,
  cleanupExample,
  corsHandlingExample
}

