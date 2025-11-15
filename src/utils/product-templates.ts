/**
 * Product Template Configuration
 *
 * Defines print area configurations for each product type in the designer.
 * All coordinates are normalized (0-1) as percentages of the canvas/mockup dimensions.
 */

export interface PrintArea {
  /** X position as percentage (0-1) from left edge */
  x: number
  /** Y position as percentage (0-1) from top edge */
  y: number
  /** Width as percentage (0-1) of total width */
  width: number
  /** Height as percentage (0-1) of total height */
  height: number
  /** Rotation in degrees (0-360) */
  rotation: number
}

export interface ProductTemplate {
  /** Display name of the product template */
  name: string
  /** Print area configuration defining where designs can be placed */
  printArea: PrintArea
}

export type ProductTemplateType = 'shirts' | 'hoodies' | 'tumblers'

/**
 * Product template configurations
 *
 * Each template defines the printable area for a product category.
 * The print area coordinates are normalized (0-1) to work with any canvas size.
 */
export const PRODUCT_TEMPLATES: Record<ProductTemplateType, ProductTemplate> = {
  shirts: {
    name: 'T-Shirt',
    printArea: {
      x: 0.25,      // 25% from left
      y: 0.30,      // 30% from top
      width: 0.50,  // 50% of total width
      height: 0.40, // 40% of total height
      rotation: 0   // No rotation
    }
  },
  hoodies: {
    name: 'Hoodie',
    printArea: {
      x: 0.25,      // 25% from left
      y: 0.25,      // 25% from top
      width: 0.50,  // 50% of total width
      height: 0.50, // 50% of total height
      rotation: 0   // No rotation
    }
  },
  tumblers: {
    name: 'Tumbler',
    printArea: {
      x: 0.30,      // 30% from left
      y: 0.20,      // 20% from top
      width: 0.40,  // 40% of total width
      height: 0.60, // 60% of total height
      rotation: 0   // No rotation
    }
  }
}

/**
 * Get template by type
 * @param type Product template type
 * @returns Product template configuration or undefined if not found
 */
export function getTemplate(type: ProductTemplateType): ProductTemplate | undefined {
  return PRODUCT_TEMPLATES[type]
}

/**
 * Get all available template types
 * @returns Array of product template type keys
 */
export function getTemplateTypes(): ProductTemplateType[] {
  return Object.keys(PRODUCT_TEMPLATES) as ProductTemplateType[]
}

/**
 * Check if a template type is valid
 * @param type String to check
 * @returns True if the type is a valid product template
 */
export function isValidTemplateType(type: string): type is ProductTemplateType {
  return type in PRODUCT_TEMPLATES
}

/**
 * Convert normalized print area coordinates to pixel coordinates
 * @param printArea Normalized print area (0-1)
 * @param canvasWidth Canvas width in pixels
 * @param canvasHeight Canvas height in pixels
 * @returns Print area in pixel coordinates
 */
export function printAreaToPixels(
  printArea: PrintArea,
  canvasWidth: number,
  canvasHeight: number
): Required<Omit<PrintArea, 'rotation'>> & { rotation: number } {
  return {
    x: printArea.x * canvasWidth,
    y: printArea.y * canvasHeight,
    width: printArea.width * canvasWidth,
    height: printArea.height * canvasHeight,
    rotation: printArea.rotation
  }
}

/**
 * Convert pixel coordinates to normalized print area coordinates
 * @param x X position in pixels
 * @param y Y position in pixels
 * @param width Width in pixels
 * @param height Height in pixels
 * @param rotation Rotation in degrees
 * @param canvasWidth Canvas width in pixels
 * @param canvasHeight Canvas height in pixels
 * @returns Normalized print area (0-1)
 */
export function pixelsToPrintArea(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  canvasWidth: number,
  canvasHeight: number
): PrintArea {
  return {
    x: x / canvasWidth,
    y: y / canvasHeight,
    width: width / canvasWidth,
    height: height / canvasHeight,
    rotation
  }
}

/**
 * Check if a point is within the print area
 * @param pointX X coordinate in pixels
 * @param pointY Y coordinate in pixels
 * @param printArea Print area in pixels
 * @returns True if the point is within the print area bounds
 */
export function isPointInPrintArea(
  pointX: number,
  pointY: number,
  printArea: ReturnType<typeof printAreaToPixels>
): boolean {
  return (
    pointX >= printArea.x &&
    pointX <= printArea.x + printArea.width &&
    pointY >= printArea.y &&
    pointY <= printArea.y + printArea.height
  )
}

