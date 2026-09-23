/**
 * Tumbler Dimension & Specification Matrix
 *
 * Canonical source of truth for drinkware sizing, liquid capacity,
 * physical dimensions, and cup-holder compatibility on Imagine This Printed.
 *
 * Supports both standardized tumbler models (20 oz Skinny, 30 oz Travel,
 * 12 oz Wine, 40 oz Adventure Handle) and dynamic overrides pulled from
 * product metadata (e.g. metadata.tumbler_specs or metadata.size_guide).
 */

import type { Product } from '../types'

export type TumblerMeasurementUnit = 'imperial' | 'metric'

export interface TumblerDimensions {
  heightInches: number
  heightCm: number
  topDiameterInches: number
  topDiameterCm: number
  baseDiameterInches: number
  baseDiameterCm: number
  circumferenceInches: number
  circumferenceCm: number
}

export interface TumblerSpec {
  id: string
  name: string
  shortLabel: string
  volumeOz: number
  volumeMl: number
  dimensions: TumblerDimensions
  weightEmptyOz: number
  weightEmptyGrams: number
  cupHolderFit: {
    fits: boolean
    rating: 'Universal' | 'Most Standard' | 'Wide Only' | 'Desk / Dock'
    description: string
  }
  insulation: {
    type: string
    coldHours: number
    hotHours: number
    description: string
  }
  lidAndStraw: {
    lidType: string
    strawIncluded: boolean
    strawMaterial?: string
    description: string
  }
  material: {
    grade: string
    description: string
    bpaFree: boolean
    sweatProof: boolean
  }
  printSpecs: {
    method: string
    wrapWidthInches: number
    wrapHeightInches: number
    description: string
  }
  bestFor: string
  isDefault?: boolean
}

/** Standardized tumbler specifications matrix */
export const TUMBLER_SIZE_MATRIX: Record<string, TumblerSpec> = {
  '20oz': {
    id: '20oz',
    name: '20 oz Skinny Tumbler',
    shortLabel: '20 oz',
    volumeOz: 20,
    volumeMl: 590,
    dimensions: {
      heightInches: 8.25,
      heightCm: 21.0,
      topDiameterInches: 2.9,
      topDiameterCm: 7.4,
      baseDiameterInches: 2.9,
      baseDiameterCm: 7.4,
      circumferenceInches: 9.125,
      circumferenceCm: 23.2,
    },
    weightEmptyOz: 10.5,
    weightEmptyGrams: 298,
    cupHolderFit: {
      fits: true,
      rating: 'Universal',
      description: 'Universal fit — slides cleanly into all standard automotive, truck, and stroller cup holders (< 3.0" base).',
    },
    insulation: {
      type: 'Double-Wall Vacuum Insulation',
      coldHours: 24,
      hotHours: 12,
      description: 'Keeps iced drinks chilled for 24 hours and steaming coffee hot for up to 12 hours with zero outer condensation.',
    },
    lidAndStraw: {
      lidType: 'Clear Splash-Resistant Sliding Lid',
      strawIncluded: true,
      strawMaterial: 'Reusable Food-Grade Stainless Steel & Straw Tip',
      description: 'BPA-free acrylic push-on slider lid with silicone gasket seal plus reusable metal straw.',
    },
    material: {
      grade: '18/8 (304) Kitchen-Grade Stainless Steel',
      description: 'Food-safe interior lining will not rust, absorb lingering flavors, or retain beverage odors.',
      bpaFree: true,
      sweatProof: true,
    },
    printSpecs: {
      method: 'High-Resolution UV-DTF / Sublimation Wrap',
      wrapWidthInches: 9.3,
      wrapHeightInches: 8.2,
      description: 'Full 360-degree seamless graphic wrap with vibrant color depth and high scratch resistance.',
    },
    bestFor: 'Everyday hydration, iced lattes, smoothies, gym, and commuter vehicle cup holders.',
    isDefault: true,
  },
  '30oz': {
    id: '30oz',
    name: '30 oz Travel Tumbler',
    shortLabel: '30 oz',
    volumeOz: 30,
    volumeMl: 887,
    dimensions: {
      heightInches: 7.75,
      heightCm: 19.7,
      topDiameterInches: 4.0,
      topDiameterCm: 10.2,
      baseDiameterInches: 2.75,
      baseDiameterCm: 7.0,
      circumferenceInches: 12.5,
      circumferenceCm: 31.8,
    },
    weightEmptyOz: 14.0,
    weightEmptyGrams: 397,
    cupHolderFit: {
      fits: true,
      rating: 'Universal',
      description: 'Tapered base profile (2.75" bottom) engineered to seat securely into standard vehicle cup holders.',
    },
    insulation: {
      type: 'Double-Wall Vacuum Insulation',
      coldHours: 24,
      hotHours: 10,
      description: 'Double-wall copper vacuum barrier keeps cold brew icy cold for 24 hours or soup/coffee warm for 10 hours.',
    },
    lidAndStraw: {
      lidType: 'Clear Dual-Sip Slide Lid',
      strawIncluded: true,
      strawMaterial: 'Clear Tritan Wide-Bore Straw',
      description: 'Snap-closure slider lid accepts wide straws or direct sip.',
    },
    material: {
      grade: '18/8 (304) Stainless Steel',
      description: 'Premium stainless construction with durable powder-coat exterior finish.',
      bpaFree: true,
      sweatProof: true,
    },
    printSpecs: {
      method: 'Precision UV-DTF Direct Print',
      wrapWidthInches: 9.8,
      wrapHeightInches: 4.5,
      description: 'Front and back graphic placement or partial body wrap.',
    },
    bestFor: 'Road trips, long shifts, sports, and outdoor activities requiring maximum hydration.',
  },
  '12oz': {
    id: '12oz',
    name: '12 oz Wine & Coffee Tumbler',
    shortLabel: '12 oz',
    volumeOz: 12,
    volumeMl: 355,
    dimensions: {
      heightInches: 4.5,
      heightCm: 11.4,
      topDiameterInches: 3.1,
      topDiameterCm: 7.9,
      baseDiameterInches: 2.4,
      baseDiameterCm: 6.1,
      circumferenceInches: 9.75,
      circumferenceCm: 24.8,
    },
    weightEmptyOz: 6.8,
    weightEmptyGrams: 193,
    cupHolderFit: {
      fits: true,
      rating: 'Most Standard',
      description: 'Compact curved base fits in most standard car cup holders, camp chairs, and desk dock stations.',
    },
    insulation: {
      type: 'Double-Wall Thermal Vacuum',
      coldHours: 9,
      hotHours: 3,
      description: 'Maintains ideal temperature for cocktails, chilled wine, or morning flat whites.',
    },
    lidAndStraw: {
      lidType: 'Spill-Resistant Push-On Lid',
      strawIncluded: false,
      description: 'Clear lid with sipping hole and silicone gasket for airtight thermal retention.',
    },
    material: {
      grade: '18/8 (304) Stainless Steel',
      description: 'Shatterproof alternative to fragile glass wine drinkware, sweat-free finish.',
      bpaFree: true,
      sweatProof: true,
    },
    printSpecs: {
      method: 'Curved Surface UV-DTF Print',
      wrapWidthInches: 8.5,
      wrapHeightInches: 3.2,
      description: 'Vibrant wrap print contoured to the curved bowl profile.',
    },
    bestFor: 'Cocktails, wine, hot cider, poolside drinks, espresso drinks, and gift bundles.',
  },
  '40oz': {
    id: '40oz',
    name: '40 oz Adventure Handle Tumbler',
    shortLabel: '40 oz',
    volumeOz: 40,
    volumeMl: 1182,
    dimensions: {
      heightInches: 10.5,
      heightCm: 26.7,
      topDiameterInches: 3.8,
      topDiameterCm: 9.7,
      baseDiameterInches: 2.9,
      baseDiameterCm: 7.4,
      circumferenceInches: 11.9,
      circumferenceCm: 30.2,
    },
    weightEmptyOz: 18.5,
    weightEmptyGrams: 524,
    cupHolderFit: {
      fits: true,
      rating: 'Universal',
      description: 'Stepped slim base (2.9") fits standard car cup holders despite huge 40 oz capacity.',
    },
    insulation: {
      type: 'Pro-Grade Vacuum Insulation',
      coldHours: 30,
      hotHours: 14,
      description: 'Extreme thermal barrier maintains ice for over 30 hours.',
    },
    lidAndStraw: {
      lidType: '3-Position Rotating Cover Lid',
      strawIncluded: true,
      strawMaterial: 'Reusable Silicone-Tipped Extra-Long Straw',
      description: 'Versatile rotating cover with straw seal, open drink spout, and full cover prevention.',
    },
    material: {
      grade: '18/8 (304) Stainless Steel',
      description: 'Heavy-gauge steel with reinforced ergonomic comfort-grip handle.',
      bpaFree: true,
      sweatProof: true,
    },
    printSpecs: {
      method: 'High-Density UV-DTF Panel Print',
      wrapWidthInches: 7.5,
      wrapHeightInches: 5.5,
      description: 'Flank placement on opposite face of handle.',
    },
    bestFor: 'All-day hydration, intense workouts, long driving shifts, and gym sessions.',
  },
}

export const ALL_TUMBLER_SPECS: TumblerSpec[] = Object.values(TUMBLER_SIZE_MATRIX)
export const DEFAULT_TUMBLER_SPEC: TumblerSpec = TUMBLER_SIZE_MATRIX['20oz']

/**
 * Normalizes a size string (e.g. '20oz', '20 oz', '20-oz', '20 OZ', 'Skinny 20oz')
 * into a matching key in TUMBLER_SIZE_MATRIX.
 */
export function normalizeTumblerSizeKey(rawSize?: string | null): string | null {
  if (!rawSize) return null
  const cleaned = String(rawSize).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (cleaned.includes('20')) return '20oz'
  if (cleaned.includes('30')) return '30oz'
  if (cleaned.includes('12')) return '12oz'
  if (cleaned.includes('40')) return '40oz'
  return null
}

/**
 * Checks whether a product qualifies as a tumbler by category or metadata.
 */
export function isTumblerCategory(category?: string | null, metadata?: Record<string, any> | null): boolean {
  const c = String(category || '').toLowerCase()
  const t = String(metadata?.product_template || metadata?.category || metadata?.product_type || '').toLowerCase()
  return c.includes('tumbler') || t.includes('tumbler')
}

export interface ResolvedTumblerSpecs {
  /** The primary specs applicable to this product (matching product.sizes if set) */
  applicableSizes: TumblerSpec[]
  /** Complete comparison matrix for customers comparing across models */
  allSizes: TumblerSpec[]
  /** Default active spec to display initially */
  defaultSpec: TumblerSpec
  /** Whether the data was enhanced/overridden by custom product metadata */
  hasCustomMetadata: boolean
}

/**
 * Dynamically resolves tumbler specifications for a given product.
 *
 * If the product row or metadata specifies custom tumbler dimensions/specs,
 * those values are merged in. Otherwise, standard tumbler matrix specs are used.
 */
export function resolveTumblerSpecs(product?: Pick<Product, 'category' | 'metadata' | 'sizes'> | null): ResolvedTumblerSpecs {
  const customSpecs = product?.metadata?.tumbler_specs || product?.metadata?.size_guide
  const hasCustomMetadata = Boolean(customSpecs && typeof customSpecs === 'object')

  // Check product sizes column
  const productSizes: string[] = Array.isArray(product?.sizes) && product.sizes.length > 0
    ? product.sizes
    : Array.isArray((product?.metadata as any)?.sizes) && (product?.metadata as any).sizes.length > 0
      ? (product?.metadata as any).sizes
      : []

  const matchedSpecs: TumblerSpec[] = []
  for (const s of productSizes) {
    const key = normalizeTumblerSizeKey(s)
    if (key && TUMBLER_SIZE_MATRIX[key]) {
      const baseSpec = { ...TUMBLER_SIZE_MATRIX[key] }
      // Merge custom attributes if present
      if (hasCustomMetadata && customSpecs[key]) {
        Object.assign(baseSpec, customSpecs[key])
      }
      matchedSpecs.push(baseSpec)
    }
  }

  // If no sizes matched or product has no explicit sizes, default to the standard 20 oz flagship
  const applicableSizes = matchedSpecs.length > 0 ? matchedSpecs : [DEFAULT_TUMBLER_SPEC]
  const defaultSpec = applicableSizes[0] || DEFAULT_TUMBLER_SPEC

  return {
    applicableSizes,
    allSizes: ALL_TUMBLER_SPECS,
    defaultSpec,
    hasCustomMetadata,
  }
}
