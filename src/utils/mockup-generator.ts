/**
 * Client-Side Mockup Composite Generator
 *
 * Provides real-time mockup preview generation using HTML Canvas.
 * Composites design elements onto product mockup images with proper scaling and positioning.
 */

import { PRODUCT_TEMPLATES, printAreaToPixels } from './product-templates'
import type { PrintArea, ProductTemplateType } from './product-templates'

export interface DesignElement {
  id: string
  type: 'text' | 'image'
  x: number
  y: number
  width?: number
  height?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  fill?: string
  src?: string
  rotation?: number
}

export interface MockupGeneratorOptions {
  mockupImageUrl: string
  designElements: DesignElement[]
  productTemplate: ProductTemplateType
  canvasWidth?: number
  canvasHeight?: number
  showPrintArea?: boolean
}

/**
 * Generate client-side mockup preview by compositing design onto mockup base
 * Returns a canvas element with the composite
 */
export async function generateMockupPreview(
  options: MockupGeneratorOptions
): Promise<HTMLCanvasElement> {
  const {
    mockupImageUrl,
    designElements,
    productTemplate,
    canvasWidth = 800,
    canvasHeight = 600,
    showPrintArea = false
  } = options

  // Create canvas
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Could not get canvas context')
  }

  // Load mockup base image
  const mockupImg = await loadImage(mockupImageUrl)

  // Draw mockup as background
  ctx.drawImage(mockupImg, 0, 0, canvasWidth, canvasHeight)

  // Get template configuration
  const template = PRODUCT_TEMPLATES[productTemplate]
  if (!template) {
    throw new Error(`Unknown product template: ${productTemplate}`)
  }

  // Calculate print area in pixels
  const printArea = printAreaToPixels(template.printArea, canvasWidth, canvasHeight)

  // Draw print area boundary (optional - for debugging)
  if (showPrintArea) {
    ctx.save()
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(printArea.x, printArea.y, printArea.width, printArea.height)
    ctx.restore()
  }

  // Draw each design element scaled to print area
  for (const element of designElements) {
    await drawElement(ctx, element, printArea, canvasWidth, canvasHeight)
  }

  return canvas
}

/**
 * Draw a single design element onto the canvas
 */
async function drawElement(
  ctx: CanvasRenderingContext2D,
  element: DesignElement,
  printArea: ReturnType<typeof printAreaToPixels>,
  sourceWidth: number,
  sourceHeight: number
): Promise<void> {
  // Calculate scale factors from source canvas (800x600) to print area
  const scaleX = printArea.width / sourceWidth
  const scaleY = printArea.height / sourceHeight

  // Map element position to print area
  const mappedX = printArea.x + element.x * scaleX
  const mappedY = printArea.y + element.y * scaleY

  ctx.save()

  // Apply rotation if present
  if (element.rotation) {
    const centerX = mappedX + ((element.width || 0) * scaleX) / 2
    const centerY = mappedY + ((element.height || 0) * scaleY) / 2
    ctx.translate(centerX, centerY)
    ctx.rotate((element.rotation * Math.PI) / 180)
    ctx.translate(-centerX, -centerY)
  }

  if (element.type === 'image' && element.src) {
    // Load and draw image
    const img = await loadImage(element.src)
    const scaledWidth = (element.width || img.width) * scaleX
    const scaledHeight = (element.height || img.height) * scaleY
    ctx.drawImage(img, mappedX, mappedY, scaledWidth, scaledHeight)
  } else if (element.type === 'text' && element.text) {
    // Draw text
    const fontSize = (element.fontSize || 24) * scaleX
    ctx.font = `${fontSize}px ${element.fontFamily || 'Arial'}`
    ctx.fillStyle = element.fill || '#000000'
    ctx.fillText(element.text, mappedX, mappedY)
  }

  ctx.restore()
}

/**
 * Load an image from URL
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // Handle CORS
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/**
 * Debounced version of generateMockupPreview for performance
 */
export function createDebouncedMockupGenerator(delayMs: number = 100) {
  let timeoutId: NodeJS.Timeout | null = null
  let lastCanvas: HTMLCanvasElement | null = null

  return async (options: MockupGeneratorOptions): Promise<HTMLCanvasElement> => {
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    // Return last canvas immediately if available
    if (lastCanvas) {
      return lastCanvas
    }

    // Wait for debounce delay
    await new Promise(resolve => {
      timeoutId = setTimeout(resolve, delayMs)
    })

    // Generate new mockup
    lastCanvas = await generateMockupPreview(options)
    return lastCanvas
  }
}

/**
 * Export canvas as data URL
 */
export function canvasToDataURL(canvas: HTMLCanvasElement, format: string = 'image/png'): string {
  return canvas.toDataURL(format)
}

/**
 * Export canvas as blob
 */
export function canvasToBlob(canvas: HTMLCanvasElement, format: string = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to create blob'))
      },
      format
    )
  })
}

/**
 * Batch generate multiple mockups
 * Useful for generating mockups for different views of the same product
 */
export async function generateMockupBatch(
  optionsList: MockupGeneratorOptions[]
): Promise<HTMLCanvasElement[]> {
  return Promise.all(optionsList.map(options => generateMockupPreview(options)))
}

/**
 * Calculate optimal canvas dimensions while maintaining aspect ratio
 */
export function calculateCanvasDimensions(
  maxWidth: number,
  maxHeight: number,
  aspectRatio: number = 4 / 3
): { width: number; height: number } {
  let width = maxWidth
  let height = maxWidth / aspectRatio

  if (height > maxHeight) {
    height = maxHeight
    width = maxHeight * aspectRatio
  }

  return { width: Math.floor(width), height: Math.floor(height) }
}

/**
 * Validate design elements before rendering
 */
export function validateDesignElements(elements: DesignElement[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  elements.forEach((element, index) => {
    if (!element.id) {
      errors.push(`Element at index ${index} missing required 'id' field`)
    }

    if (!['text', 'image'].includes(element.type)) {
      errors.push(`Element ${element.id} has invalid type: ${element.type}`)
    }

    if (typeof element.x !== 'number' || typeof element.y !== 'number') {
      errors.push(`Element ${element.id} has invalid position coordinates`)
    }

    if (element.type === 'text' && !element.text) {
      errors.push(`Text element ${element.id} missing 'text' property`)
    }

    if (element.type === 'image' && !element.src) {
      errors.push(`Image element ${element.id} missing 'src' property`)
    }
  })

  return { valid: errors.length === 0, errors }
}

/**
 * Create thumbnail from mockup canvas
 */
export async function createMockupThumbnail(
  canvas: HTMLCanvasElement,
  maxWidth: number = 200,
  maxHeight: number = 200
): Promise<HTMLCanvasElement> {
  const { width, height } = calculateCanvasDimensions(maxWidth, maxHeight, canvas.width / canvas.height)

  const thumbnailCanvas = document.createElement('canvas')
  thumbnailCanvas.width = width
  thumbnailCanvas.height = height

  const ctx = thumbnailCanvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not get canvas context for thumbnail')
  }

  ctx.drawImage(canvas, 0, 0, width, height)
  return thumbnailCanvas
}

/**
 * Memory-efficient canvas cleanup utility
 */
export function cleanupCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  canvas.width = 0
  canvas.height = 0
}

