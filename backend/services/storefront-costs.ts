/**
 * Cost basis for creator (Merch Studio) products published through POST /api/storefront/products.
 *
 * Shirts: STOREFRONT_BASE_COST_USD ($10) plus STOREFRONT_BACK_PRINT_UPCHARGE_USD ($5) when a back print ships.
 * Any other garmentType reads STOREFRONT_<TYPE>_BASE_COST_USD and, when that env is unset, its own default below
 * before the shirt base (David 2026-10-23: a mug costs $8 to make; ITP had no mug before this).
 *
 * Mugs (11 oz, white, sublimation): ONE wrap print, no back print and no back upcharge. The wrap is 8.5 x 3.5 in;
 * the creator's print master is sent as front_print and the wrap layout rides in placement (see MUG_PRINT_AREA).
 */
export const MUG_PRINT_AREA = { widthIn: 8.5, heightIn: 3.5, method: 'sublimation', locations: ['wrap'] } as const

export const PRODUCT_BASE_COST_DEFAULTS_USD: Record<string, number> = { mug: 8 }

export const isMug = (garmentType: string | null | undefined): boolean =>
  !!garmentType && garmentType.trim().toLowerCase() === 'mug'

/** Base cost (USD) for a creator product of this garment type. */
export function productBaseCostUsd(garmentType: string | null | undefined, shirtBaseUsd: number, env: NodeJS.ProcessEnv = process.env): number {
  if (!garmentType) return shirtBaseUsd
  const key = garmentType.trim().toLowerCase()
  const envVarName = `STOREFRONT_${key.toUpperCase().replace(/[- ]/g, '_')}_BASE_COST_USD`
  const parsed = Number(env[envVarName])
  if (env[envVarName] && Number.isFinite(parsed) && parsed > 0) return parsed
  return PRODUCT_BASE_COST_DEFAULTS_USD[key] ?? shirtBaseUsd
}
