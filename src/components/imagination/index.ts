// Shared utilities
export { CHECKERBOARD_BG } from './checkerboard'

// Canvas
export { default as SheetCanvas } from './SheetCanvas'

// Left Sidebar – live components
export { default as AddElementPanel } from './AddElementPanel'

// Modals
export { default as ImageCompareModal } from './ImageCompareModal'
export { default as MrImagineModal } from './MrImagineModal'
export { default as ReimagineItModal } from './ReimagineItModal'
export { default as ITPEnhanceModal } from './ITPEnhanceModal'
export { default as MakeProductModal } from './MakeProductModal'

// Error Boundary
export { default as ImaginationErrorBoundary } from './ImaginationErrorBoundary'

// Re-export types from central types file
export type { Sheet, Layer, Pricing, FreeTrials, AutoLayoutPricing } from '../../types'
